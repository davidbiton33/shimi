import { tryAutoScip } from './scip-refresh.js';
/**
 * Bounded, source-grounded on-demand context requests for coding agents using the local CLI.
 * Never changes AI_TASK.md or current-task.md. Exact symbol matches are AST
 * evidence, not compiler-verified runtime dispatch.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { basename } from 'node:path';
import { gitPaths } from './git.js';
import { isIgnored, safelyResolveFile, isBinary, sanitize } from './pack.js';
import { safeIgnores } from './ignore.js';
import { loadConfig } from './config.js';
import { parserRegistry, tokenEstimate, taskKeywords, type Segment } from './smart.js';
import type { GraphReport } from './graph.js';
import { now, pathFor, readJson, readText, safeProjectPath, saveJson, uid } from './utils.js';
import { scipCandidates } from './scip.js';
import { withProjectLockSync } from './lock.js';

const SOURCE = /\.(?:[cm]?[jt]sx?|pyi?|go|java|cs|rs|rb|php|c|cc|cpp|cxx|h|hpp|hxx|kt|kts|dart)$/i;
const ID = /^[0-9a-f]{12}$/;
const MAX_FILES = 2500, MAX_SCAN_BYTES = 16 * 1024 * 1024;
const MAX_RESULT_TOKENS = 12000;

export type Subtask = { id:string; parentId:string|null; title:string; description:string; status:'open'|'done'; createdAt:string; updatedAt:string; result?:string; blockedBy?:string[] };
export type ContextRequest = { file?:string; symbol?:string; symbolId?:string; query?:string; subtaskId?:string; maxTokens?:number; includeDependencies?:boolean };
export type ContextItem = { path:string; startLine:number; endLine:number; kind:string; name:string; provenance:'ast-definition'|'structural-definition'|'scip-definition'|'filename'|'text-match'; code:string; redactedLines:number };

function subtaskPath(root:string,id:string){
  if(!ID.test(id))throw new Error('Invalid subtask id');
  return pathFor(root,'subtasks',id+'.json');
}
function fetchSubtask(root:string,id:string):Subtask{
  const doc=readJson<Subtask|null>(subtaskPath(root,id),null);
  if(!doc || doc.id!==id)throw new Error('Subtask does not exist');
  return doc;
}
export function listSubtasks(root:string, parentId?:string):Subtask[]{
  if(parentId!==undefined)fetchSubtask(root,parentId);
  let files:string[]=[];
  try{ files=readdirSync(pathFor(root,'subtasks')); }
  catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw e;}
  return files.filter(x=>ID.test(x.replace(/\.json$/,''))&&x.endsWith('.json'))
    .map(x=>fetchSubtask(root,x.slice(0,-5)))
    .filter(x=>parentId===undefined||x.parentId===parentId)
    .sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
}
export function createSubtask(root:string,input:{title:string;description?:string;parentId?:string}):Subtask{
 return withProjectLockSync(root,()=>{
  if(typeof input.title!=='string'||!input.title.trim()||input.title.length>180)throw new Error('title must be 1–180 characters');
  if(input.description!==undefined&&(typeof input.description!=='string'||input.description.length>5000))throw new Error('description exceeds 5000 characters');
  let parentId:string|null=null;
  if(input.parentId){
    let parent=fetchSubtask(root,input.parentId),depth=1;
    if(parent.status==='done')throw new Error('Cannot create a child under a completed subtask');
    parentId=parent.id;
    while(parent.parentId){parent=fetchSubtask(root,parent.parentId);if(++depth>4)throw new Error('Subtask nesting exceeds 4 levels');}
  }
  const at=now(), task:Subtask={id:randomBytes(6).toString('hex'),parentId,title:input.title.trim(),description:(input.description||'').trim(),status:'open',createdAt:at,updatedAt:at};
  saveJson(subtaskPath(root,task.id),task);
  return task;
 });
}
export function finishSubtask(root:string,id:string,result:string):Subtask{
 return withProjectLockSync(root,()=>{
  if(typeof result!=='string'||result.length>6000)throw new Error('result must be at most 6000 characters');
  const task=fetchSubtask(root,id);
  if(task.status==='done')throw new Error('Subtask is already completed');
  if(listSubtasks(root,id).some(x=>x.status==='open'))throw new Error('Finish child subtasks before their parent');
  if((task.blockedBy||[]).some(dep=>fetchSubtask(root,dep).status!=='done'))throw new Error('Cannot finish a blocked subtask; complete dependencies first');
  task.status='done';task.result=result;task.updatedAt=now();saveJson(subtaskPath(root,id),task);return task;
 });
}
export function subtaskLineage(root:string,id:string):Subtask[]{
  const items:Subtask[]=[], visited=new Set<string>();let cursor:string|null=id;
  while(cursor){if(visited.has(cursor))throw new Error('Cyclic subtask tree');visited.add(cursor);const doc=fetchSubtask(root,cursor);items.unshift(doc);cursor=doc.parentId;}
  return items;
}
/** Dependency edges are independent from parent/child ownership, and must form a DAG. */
export function addSubtaskDependency(root:string,id:string,blockedBy:string):Subtask{
 return withProjectLockSync(root,()=>{
   const task=fetchSubtask(root,id), blocker=fetchSubtask(root,blockedBy);
   if(task.status==='done'||blocker.status==='done')throw Error('Both dependency tasks must be open');
   if(id===blockedBy)throw Error('A subtask cannot depend on itself');
   // Child -> ancestor creates an impossible state because parent completion awaits children.
   const family=(x:string,y:string)=>subtaskLineage(root,x).some(n=>n.id===y);
   if(family(id,blockedBy)||family(blockedBy,id))throw Error('Dependencies cannot connect parents and children');
   if((task.blockedBy||[]).includes(blockedBy))return task;
   const visited=new Set<string>();
   const walk=(cursor:string):boolean=>{
     if(cursor===id)return true;
     if(visited.has(cursor))return false;visited.add(cursor);
     return (fetchSubtask(root,cursor).blockedBy||[]).some(walk);
   };
   if(walk(blockedBy))throw Error('Dependency cycle rejected');
   task.blockedBy=[...(task.blockedBy||[]),blockedBy].sort();task.updatedAt=now();saveJson(subtaskPath(root,id),task);return task;
 });
}
export function removeSubtaskDependency(root:string,id:string,blockedBy:string):Subtask{
 return withProjectLockSync(root,()=>{
  const task=fetchSubtask(root,id);if(task.status==='done')throw Error('Completed subtasks cannot be changed');
  fetchSubtask(root,blockedBy);
  task.blockedBy=(task.blockedBy||[]).filter(x=>x!==blockedBy);task.updatedAt=now();saveJson(subtaskPath(root,id),task);return task;
 });
}
export function readySubtasks(root:string):Subtask[]{
 const tasks=listSubtasks(root);const byId=new Map(tasks.map(x=>[x.id,x]));
 return tasks.filter(task=>task.status==='open' && !tasks.some(other=>other.parentId===task.id&&other.status==='open')
  && (task.blockedBy||[]).every(id=>byId.get(id)?.status==='done'));
}
export function blockedSubtasks(root:string){
 const tasks=listSubtasks(root),byId=new Map(tasks.map(x=>[x.id,x]));
 return tasks.filter(x=>x.status==='open').map(task=>({task,waitingOn:(task.blockedBy||[]).filter(id=>byId.get(id)?.status!=='done'),openChildren:tasks.filter(x=>x.parentId===task.id&&x.status==='open').map(x=>x.id)}))
 .filter(x=>x.waitingOn.length>0||x.openChildren.length>0);
}
function codeFile(root:string,file:string,limit:number,ignores:string[]):{content:string;redactedLines:number}|null {
  if(isIgnored(file,ignores))return null;
  const resolved=safelyResolveFile(root,file);
  if(!resolved)return null;
  try {
    if(statSync(resolved).size>limit)return null;
    const buffer=readFileSync(resolved);
    if(buffer.length>limit||isBinary(buffer))return null;
    const cleaned=sanitize(buffer.toString('utf8'));
    return {content:cleaned.value,redactedLines:cleaned.count};
  }catch{return null;}
}
function matchesSymbol(segment:Segment,symbol:string):boolean{
  const name=segment.name, wanted=symbol;
  return name===wanted||name.endsWith('.'+wanted);
}
function location(text:string, start:number, end:number){
  // Segment start/end offsets are UTF-16 positions, as are string indices.
  const a=Math.max(0,Math.min(text.length,start)), b=Math.max(a,Math.min(text.length,end));
  return {startLine:text.slice(0,a).split('\n').length,endLine:text.slice(0,b).split('\n').length};
}
function safeSnippet(content:string,segment:Segment){
  const loc=location(content,segment.start,segment.end);
  return {...loc,code:content.slice(segment.start,segment.end)};
}
function queryTerms(query:string){
  const common=new Set(['where','does','the','this','that','how','from','with','find','show','file','function','class','method','get','need','code','for','and','in','of','to','a']);
  return [...taskKeywords(query)].filter(x=>x.length>2&&!common.has(x)).slice(0,12);
}
function relatedFromLastPack(root:string,anchors:string[],allowed:Set<string>){
  // Dependency edges come from the last pack snapshot; they are navigation
  // hints, NOT verified call targets. Never trust a cached path on its own.
  let graph:GraphReport;
  try{ graph=JSON.parse(readFileSync(pathFor(root,'packs','dependency-graph.json'),'utf8')) as GraphReport; }
  catch{return {source:'none' as const,files:[]};}
  if(!Array.isArray(graph.edges))return {source:'none' as const,files:[]};
  const sources=new Set(anchors), results=new Map<string,{path:string;relation:'dependency'|'dependent';via:string;certainty:string}>();
  for(const edge of graph.edges){
    let target:string,relation:'dependency'|'dependent',via:string;
    if(sources.has(edge.from)){target=edge.to;relation='dependency';via=edge.from;}
    else if(sources.has(edge.to)){target=edge.from;relation='dependent';via=edge.to;}
    else continue;
    if(sources.has(target)||!allowed.has(target))continue;
    const previous=results.get(target);
    if(!previous||relation==='dependency')results.set(target,{path:target,relation,via,certainty:edge.certainty});
    if(results.size>=24)break;
  }
  // Forward SCIP references are navigation hints, never validated call edges.
  // Recheck BOTH reference and definition documents, because cached graph
  // snapshots may outlive the source files they described.
  let scipAdded=0;
  for(const e of graph.semanticReferences||[]){
    if(scipAdded>=12||!sources.has(e.from)||sources.has(e.to)||!allowed.has(e.to))continue;
    const current=scipCandidates(root,{symbolId:e.symbolId,path:e.to},allowed);
    if(!current?.definitions.some(d=>d.symbolId===e.symbolId))continue;
    if(!current.refs(e.symbolId).some(r=>r.path===e.from))continue;
    if(!results.has(e.to)){
      const called=(graph.scipCallsites||[]).some(c=>c.from===e.from&&c.to===e.to&&c.symbolId===e.symbolId);
      results.set(e.to,{path:e.to,relation:'dependency',via:e.from,certainty:called?'scip-static-callsite':'scip-symbol-reference'});
      scipAdded++;
    }
  }
  return {source:'last-pack-snapshot' as const,files:[...results.values()].sort((a,b)=>a.path.localeCompare(b.path)).slice(0,12)};
}
export function requestContext(root:string,input:ContextRequest){
  // Explicitly opted-in projects may regenerate stale TypeScript evidence before on-demand lookup.
  tryAutoScip(root);
  const cfg=loadConfig(root);
  const maxTokens=input.maxTokens===undefined?6000:input.maxTokens;
  if(!Number.isInteger(maxTokens)||maxTokens<128||maxTokens>MAX_RESULT_TOKENS)throw new Error('maxTokens must be an integer from 128 to 12000');
  if(input.symbol!==undefined&&(typeof input.symbol!=='string'||input.symbol.length<1||input.symbol.length>160))throw new Error('Invalid symbol');
  if(input.symbolId!==undefined&&(typeof input.symbolId!=='string'||!input.symbolId.trim()||input.symbolId.length>1024))throw new Error('Invalid symbolId');
  if(input.query!==undefined&&(typeof input.query!=='string'||input.query.length>350))throw new Error('Invalid query');
  if(input.file!==undefined&&(typeof input.file!=='string'||input.file.length>500))throw new Error('Invalid file');
  if(!input.file&&!input.symbol&&!input.symbolId&&!input.query)throw new Error('Provide file, symbol, symbolId, or query');
  if(input.includeDependencies!==undefined && typeof input.includeDependencies!=='boolean')throw new Error('includeDependencies must be boolean');
  const lineage=input.subtaskId?subtaskLineage(root,input.subtaskId):[];
  if(lineage.some(x=>x.status==='done'))throw new Error('Cannot request new context for a completed subtask');
  const mainTask=sanitize(readText(pathFor(root,'AI_TASK.md'))).value.trim().slice(0,1500);
  const requestId=uid();
  const ignores=[...safeIgnores,...cfg.customIgnore,...cfg.packer.ignore,...readText(safeProjectPath(root,'.agentosignore')).split(/\r?\n/).map(s=>s.trim()).filter(s=>s&&!s.startsWith('#'))];
  const all=gitPaths(root).filter(p=>SOURCE.test(p)&&!isIgnored(p,ignores));
  const file=input.file?.replace(/\\/g,'/').replace(/^\.\//,'');
  if(file && !all.includes(file))return {requestId,status:'not_found' as const,reason:'File not present in allowed Git inventory',matches:[],mainTask,subtasks:lineage,estimatedTokens:0};
  const candidates=file?[file]:all.slice(0,MAX_FILES);
  const indexTruncated=!file&&all.length>MAX_FILES;
  const defs:ContextItem[]=[], alternatives:ContextItem[]=[], scipIds=new Map<ContextItem,string>();
  const semantic=(input.symbol||input.symbolId)?scipCandidates(root,{name:input.symbol,symbolId:input.symbolId,path:file},new Set(all)):null;
  const usingScip=Boolean(semantic?.definitions.length);
  if(input.symbolId&&!usingScip){
    return {requestId,status:'not_found' as const,reason:semantic?.stale?'SCIP definition is stale or excluded':'No matching indexed SCIP symbol. Import an index first.',matches:[],mainTask,subtasks:lineage,estimatedTokens:0,semantic:{source:semantic?'scip':'none',stale:semantic?.stale||0}};
  }
  if(semantic?.definitions.length){
    for(const d of semantic.definitions.slice(0,32)){
      const source=codeFile(root,d.path,Math.min(cfg.packer.maxFileBytes,256*1024),ignores);
      if(!source)continue;
      const analysis=parserRegistry.analyze(d.path,source.content);
      const parts=source.content.split('\n');
      const segment=analysis.segments.map(seg=>({...seg,...location(source.content,seg.start,seg.end)}))
        .filter(seg=>seg.startLine<=d.startLine+1&&seg.endLine>=d.endLine+1)
        .sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0];
      const snippet=segment?safeSnippet(source.content,segment):{startLine:Math.max(1,d.startLine+1),endLine:Math.min(parts.length,d.endLine+8),code:parts.slice(d.startLine,Math.min(parts.length,d.endLine+8)).join('\n')};
      if(!snippet.code.trim())continue;
      const item:ContextItem={path:d.path,startLine:snippet.startLine,endLine:snippet.endLine,kind:segment?.kind||'symbol',name:d.name,provenance:'scip-definition',code:snippet.code,redactedLines:source.redactedLines};
      defs.push(item);scipIds.set(item,d.symbolId);
    }
  }

  const needle=input.symbol?.trim(), terms=input.query?queryTerms(input.query):[];
  let scanned=0,scannedBytes=0,skipped=0;
  for(const path of usingScip?[]:candidates){
    if(scannedBytes>=MAX_SCAN_BYTES)break;
    const source=codeFile(root,path,Math.min(cfg.packer.maxFileBytes,256*1024),ignores);
    if(!source){skipped++;continue;}
    scanned++;scannedBytes+=Buffer.byteLength(source.content);
    const analysis=parserRegistry.analyze(path,source.content);
    for(const seg of analysis.segments){
      if(needle){if(!matchesSymbol(seg,needle))continue;}
      else if(input.query){
        const search=seg.name.toLowerCase().replace(/([a-z])([A-Z])/g,'$1 $2');
        const hit=terms.filter(x=>search.includes(x.toLowerCase())||path.toLowerCase().includes(x.toLowerCase())).length;
        if(!hit)continue;
      } else continue;
      const {startLine,endLine,code}=safeSnippet(source.content,seg);
      if(!code.trim())continue;
      defs.push({path,startLine,endLine,kind:seg.kind,name:seg.name,provenance:analysis.parser==='typescript-ast'?'ast-definition':'structural-definition',code,redactedLines:source.redactedLines});
      if(defs.length>=32)break;
    }
    if(defs.length>=32)break;
    if(input.query && !needle && (basename(path).toLowerCase().includes(input.query.toLowerCase()) || terms.length>0&&terms.every(t=>path.toLowerCase().includes(t)))){
      alternatives.push({path,startLine:1,endLine:1,kind:'file',name:path,provenance:'filename',code:'',redactedLines:0});
    }
    if(file&&!needle&&!input.query){
      defs.push({path,startLine:1,endLine:source.content.split('\n').length,kind:'file',name:path,provenance:'filename',code:source.content,redactedLines:source.redactedLines});
    }
  }
  const sorted=defs.sort((a,b)=>a.path.localeCompare(b.path)||a.startLine-b.startLine);
  // Never fabricate an exact target when multiple definitions share the name.
  if(needle&&sorted.length>1){
    return {requestId,status:'ambiguous' as const,reason:'Several definitions match. Specify file or exact --symbol-id to disambiguate.',candidates:sorted.map(item=>({path:item.path,startLine:item.startLine,name:item.name,kind:item.kind,provenance:item.provenance,symbolId:scipIds.get(item)})),matches:[],mainTask,subtasks:lineage,estimatedTokens:0,scanned,skipped};
  }
  const selected=(sorted.length?sorted:alternatives).slice(0,8);
  let used=0,truncated=false;
  const matches:ContextItem[]=[];
  for(const match of selected){
    const remaining=maxTokens-used;
    if(remaining<32){truncated=true;break;}
    const cap=remaining*4;
    const code=Buffer.byteLength(match.code)>cap?match.code.slice(0,cap):match.code;
    if(code.length<match.code.length)truncated=true;
    const tok=tokenEstimate(code);
    if(tok>remaining){truncated=true;break;}
    used+=tok;
    matches.push({...match,code,endLine:match.startLine+code.split('\n').length-1});
  }
  const related=input.includeDependencies?relatedFromLastPack(root,matches.map(m=>m.path),new Set(all)):{source:'disabled' as const,files:[]};
  const searchIncomplete=!usingScip&&(indexTruncated || scannedBytes>=MAX_SCAN_BYTES || defs.length>=32);
  const chosenMatch=sorted.find(d=>d.path===matches[0]?.path&&d.name===matches[0]?.name&&d.startLine===matches[0]?.startLine);
  const chosenId=chosenMatch?scipIds.get(chosenMatch):undefined;
  const chosen=usingScip?semantic!.definitions.find(d=>d.symbolId===chosenId):undefined;
  const semanticEvidence=semantic?{source:'scip-index',indexer:semantic.snapshot.indexer,symbolId:chosen?.symbolId||null,importedAt:semantic.snapshot.importedAt,staleDefinitions:semantic.stale,references:chosen?semantic.refs(chosen.symbolId):[],relationships:chosen?semantic.relationships(chosen.symbolId):[],limitations:['SCIP links source symbols, not runtime calls','Index freshness before import cannot be established; source changes after import are checked']}:undefined;
  return {requestId,status:matches.length?'ok' as const:searchIncomplete?'incomplete' as const:'not_found' as const,reason:matches.length?undefined:searchIncomplete?'Search budget exhausted; refine by file or symbol':'No matching source definition found in scanned files',matches,related,semantic:semanticEvidence,mainTask,subtasks:lineage,estimatedTokens:used,truncated,searchIncomplete,scanned,skipped,limitations:['SCIP definitions (when present) are indexer-resolved, not proof of runtime dispatch; fallback is AST/structural','Related files come from the last pack snapshot and may be stale; they are navigation hints, not call proof','Generated files, excluded secrets, and outside-Git files are not read']};
}
