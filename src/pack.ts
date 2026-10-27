/**
 * AgentOS native source packer. Uses Node's standard library and Git's file inventory.
 * Security defaults are intentionally conservative: no links, binaries or secret files.
 * The only project files accessed are those returned by Git's safe file listing.
 */
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { makeSmartSnippet, analyzeSource, parserRegistry, discoverImportedMemberCalls, classifyTaskRootedMembers, taskKeywords, taskSpecificApiMember, tokenEstimate, exactSyntaxTokens, type SemanticDependency } from './smart.js';
import { buildGraph, selectGraphContext, type GraphSelection } from './graph.js';
import { enrichGraphWithScip } from './scip-graph.js';
import { analyzeLanguage } from './languages.js';
import { resolveConstructedReceiver, resolveInjectedReceiver, resolveModuleReceiver } from './receiver-grounding.js';
import { discoverFrameworkEvents, type FrameworkEvent } from './framework-flow.js';
import { scanDI, type DIReport } from './di-resolution.js';
import { scanFrameworkBridges, type FrameworkBridge } from './framework-bridges.js';
import { scanFrameworkState, frameworkStateBindingForCall, inlineEventScope, statePropagationEvidence, type StatePropagation, type StateScan } from './framework-state.js';
import { findTaskPaths, taskActionNames } from './task-path.js';
import { Config, GitSnapshot, PackStatus, ProjectProfile } from './types.js';
import { gitPaths } from './git.js';
import { safeIgnores } from './ignore.js';
import { inRoot, pathFor, readText, safeProjectPath, sha, writeAtomic } from './utils.js';

export type PackEntry = { path:string; bytes:number; sha256:string; priority:number; redactedLines:number; mode?:'smart'|'full'; graph?:{distance:number;relation:string;via:string|null}; includedBytes?:number; estimatedTokens?:number; exactSyntaxTokens?:number|null; parser?:string; segments?:Array<{name:string;kind:string;mode:'full'|'outline';startLine:number;endLine:number;startOffset?:number;endOffset?:number;score:number;bytesBefore:number;bytesAfter:number;reason?:string;critical?:boolean}> };
export type SkippedEntry = { path:string; reason:string };
export type TaskPathVerification = {
 path:string;target:string;line:number;column:number;handler:string|null;
 // Source byte offsets are not used: TypeScript AST positions are UTF-16 units.
 eventPreserved:boolean;handlerPreserved:boolean;
 actionDefinitionPreserved:boolean|null;
 definitionStatus:'preserved'|'omitted'|'unresolved';
 definitionFile?:string;
 included:boolean; // UI event + local handler, for v0.8.5 compatibility.
 threeStageEvidence:boolean; // All three independently retained AST stages; cross-file binding is NOT verified.
 reason?:'task-path-event-not-preserved'|'task-path-handler-not-preserved'|'task-path-event-and-handler-not-preserved'|'task-path-file-not-included';
};
export type PackManifest = { scip?:{
 status:'not-imported'|'imported';indexer?:string;freshDefinitions:number;staleDocuments:number;
 navigationLinks:number;staticCallsites:number;taskScopedLinks:number;taskScopedCallsites:number;disambiguatedDeclarations:number;includedTargets:number;bodyPreserved:number;
 limitations:string[];items:Array<{from:string;to:string;symbol:string;symbolId:string;
  mode:'body-preserved'|'target-included'|'omitted';evidence:'scip-symbol-reference'}>;
}; frameworkBridgeCoverage?:{discovered:number;bodyPreserved:number;declarationOnly:number;omitted:number;items:Array<FrameworkBridge&{mode:'body-preserved'|'declaration-only'|'omitted'}>;limitations:string}; diResolution?:{registrations:number;bindings:number;ambiguous:number;verifiedBindings:number;items:DIReport['bindings'];limitations:string};frameworkStateCoverage?:{discovered:number;verified:number;unresolved:number;propagated:number;items:Array<StateScan['bindings'][number]&{mode:'full'|'unresolved';propagation?:StatePropagation}>;limitations:string}; frameworkFlowCoverage?:{discovered:number;linked:number;verified:number;rootOnly:number;unresolved:number;items:Array<FrameworkEvent&{mode:'full'|'root-only'|'unresolved';linkedDefinitions:Array<{path:string;name:string;mode:'full'|'outline'|'unresolved'}>}>;limitedTo:string}; crossLanguageSymbolCoverage?:{discovered:number;preserved:number;implementationBodies:number;outlined:number;unresolved:number;items:Array<{path:string;name:string;caller:string;mode:'full'|'outline'|'unresolved';evidence:string;definitionKind:'body'|'declaration-only';reason?:string}>;limitedTo:string}; taskRootedCallCoverage?:{scanned:number;rooted:number;excluded:number;heuristicRoots?:number;structuralRoots?:number;status?:'no-static-calls'|'no-grounded-calls'|'heuristic-only'|'mixed'|'grounded';roots:Array<{path:string;qualifiedName:string;caller:string;root:string;reason:string}>;excludedSamples:Array<{path:string;qualifiedName:string;caller:string;reason:string}>;limitedTo:string}; importedMemberCoverage?:{discovered:number;preserved:number;outlined:number;unresolved:number;items:Array<{path:string;qualifiedName:string;caller:string;mode:'full'|'outline'|'unresolved';reason?:string}>;limitedTo:string}; semanticDependencyCoverage?:{discovered:number;preserved:number;outlined:number;omitted:number;items:Array<{path:string;graphVia?:string;graphRelation?:string}&SemanticDependency>;limitedTo:string}; taskPathCoverage?:{
 actionTargets:string[];callsiteCount:number;distinctEventCount:number;
 included:number;omitted:number;threeStageEvidence:number;unverifiedDefinitions:number;
 callsites:TaskPathVerification[];
 }; engine:'agentos-native'; version:1; omittedRelevantSegments?:{count:number;samples:{path:string;name:string;score:number;reason:string}[]}; branch:string; head:string|null; taskHash:string; entries:PackEntry[]; skipped:SkippedEntry[]; totalSourceBytes:number; outputBytes:number; estimatedTokens:number; exactModelTokens:null; tokenAccounting:"conservative-estimate-not-provider-exact"; compressionRatio:number; truncated:boolean; graph?:{nodes:number;edges:number;unresolved:number;truncated:boolean;relatedFiles:number}; limits:{maxFiles:number;maxFileBytes:number;maxTotalBytes:number;maxOutputBytes:number;maxEstimatedTokens:number} };


const SECRET_FILE = /(^|\/)(?:\.env(?:\..*)?|\.npmrc|\.pypirc|\.netrc|\.aws|\.ssh|\.gnupg|\.kube|credentials(?:\..*)?|secrets?(?:\..*)?|id_(?:rsa|ed25519)(?:\.pub)?|.*\.(?:pem|p12|pfx|key|keystore|jks))$/i;
const SECURE_DIR = /(^|\/)(?:\.git|\.ai|node_modules|vendor|\.next|\.nuxt|dist|build|coverage|\.cache|\.turbo|target|\.aws|\.ssh|\.gnupg|\.kube|secrets?)(\/|$)/i;
const EXCLUDE_EXT = /\.(?:png|jpe?g|gif|webp|avif|ico|pdf|zip|gz|tar|7z|rar|exe|dll|so|dylib|woff2?|ttf|otf|mp[34]|mov|webm|sqlite3?|db|class|jar|wasm|map|lock)$/i;
const REDACT_LINE = [
 /-----BEGIN (?:[\w ]* )?PRIVATE KEY-----/i,
 /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
 /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/,
 /\b(?:sk-[A-Za-z0-9_-]{16,}|sk_live_[A-Za-z0-9]{12,}|rk_live_[A-Za-z0-9]{12,})\b/,
 /\bxox[baprs]-[A-Za-z0-9-]{16,}\b/,
 /\bAIza[0-9A-Za-z_-]{30,}\b/,
 /\b(?:api[_-]?key|access[_-]?token|secret[_-]?key|client[_-]?secret|password|passwd|auth[_-]?token)[\"']?\s*[:=]\s*["']?[A-Za-z0-9\/+_!@#$%^&*.=:-]{8,}/i,
];
const normalizePattern=(p:string)=>p.trim().replace(/\\/g,'/').replace(/^\.\//,'').replace(/^\//,'');

// Deliberately small, documented glob language: *, **, ?, prefix directories, and root paths.
// No negation or arbitrary glob evaluation. **/ matches zero or more nested directories.
export function matchGlob(path:string, raw:string):boolean {
 let pattern=normalizePattern(raw);
 if (!pattern || pattern.startsWith('!')) return false;
 if (pattern.endsWith('/')) pattern+='**';
 if (!pattern.includes('/') && !pattern.includes('*') && !pattern.includes('?')) {
   return path===pattern || path.startsWith(pattern+'/') || path.split('/').includes(pattern);
 }
 let reg='^';
 for(let i=0;i<pattern.length;i++){
   const c=pattern[i];
   if(c==='*' && pattern[i+1]==='*'){
     if(pattern[i+2]==='/'){reg+='(?:.*/)?';i+=2;}else {reg+='.*';i++;}
   } else if(c==='*')reg+='[^/]*';
   else if(c==='?')reg+='[^/]';
   else reg+=c.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 }
 return new RegExp(reg+'$').test(path);
}
export function isIgnored(p:string, ignores:string[]):boolean {
 if(SECURE_DIR.test(p)||SECRET_FILE.test(p)||EXCLUDE_EXT.test(p))return true;
 return ignores.some(x=>matchGlob(p,x));
}
export function safelyResolveFile(root:string,p:string):string|null {
 const full=resolve(root,p);
 if(!inRoot(root,full))return null;
 // Refuse any symlink in the path, not only a symlink at the final component.
 let cursor=resolve(root);
 for(const part of p.split('/')){
   if(!part || part==='.' || part==='..')return null;
   cursor=join(cursor,part);
   try{if(lstatSync(cursor).isSymbolicLink())return null;}catch{return null;}
 }
 try{if(!statSync(full).isFile())return null; if(!inRoot(realpathSync(root),realpathSync(full)))return null;}catch{return null;}
 return full;
}
export function isBinary(buf:Buffer):boolean {
 if (buf.includes(0))return true;
 // Strict UTF-8: reject malformed bytes rather than silently corrupt source.
 try{new TextDecoder('utf-8',{fatal:true}).decode(buf);}catch{return true;}
 return false;
}
export function sanitize(text:string):{value:string;count:number}{
 let count=0; let privateBlock=false;
 const value=text.split('\n').map(l=>{
   const begin=/-----BEGIN (?:[\w ]* )?PRIVATE KEY-----/i.test(l);
   if(begin)privateBlock=true;
   if(privateBlock){count++;if(/-----END (?:[\w ]* )?PRIVATE KEY-----/i.test(l))privateBlock=false;return '[REDACTED BY AGENTOS: possible credential]';}
   if(REDACT_LINE.some(pattern=>pattern.test(l))){count++;return '[REDACTED BY AGENTOS: possible credential]';}
   return l;
 }).join('\n');
 return {value,count};
}
function fenced(text:string):string {
 const runs=text.match(/`+/g)||[];const longest=runs.reduce((max,s)=>Math.max(max,s.length),3);const ticks='`'.repeat(longest+1);
 return `${ticks}text\n${text.endsWith('\n')?text:text+'\n'}${ticks}\n`;
}
function filePriority(path:string,hints:Set<string>,changed:Set<string>):number{
 if(hints.has(path))return 0;
 if(changed.has(path))return 1;
 if(/(^|\/)(?:README(?:\.md)?|AGENTS\.md|package\.json|tsconfig\.json|pyproject\.toml|go\.mod|Cargo\.toml|.*\.config\.[^/]+)$/.test(path))return 2;
 return 3;
}

export function buildPack(root:string,cfg:Config,profile:ProjectProfile,git:GitSnapshot):{status:PackStatus;message:string;patterns:string[]}{
 const output=pathFor(root,'packs','current-task.md');
 const manifestPath=pathFor(root,'packs','current-task.manifest.json');
 const task=readText(pathFor(root,'AI_TASK.md'));
 const {value:safeTask,count:taskRedactions}=sanitize(task);
 const opts=cfg.packer;
 const all=gitPaths(root);
 // Task hints must be exact discovered file names; no arbitrary paths from task text.
 const hints=new Set(all.filter(p=>task.includes(p)).slice(0,80));
 const changes=new Set([...git.changed,...git.untracked]);
 const patterns=[...new Set([...profile.include,...opts.include])];
 const ignores=[...new Set([...safeIgnores,...cfg.customIgnore,...opts.ignore,...readText(safeProjectPath(root,'.agentosignore')).split(/\r?\n/).map(s=>s.trim()).filter(s=>s&&!s.startsWith('#'))])];
 const terms=taskKeywords(task);
 // Lightweight filename relevance before doing any file reads. AST scores operate inside files.
 // Directory names like `store/` or `admin/` are too generic for file-level
 // relevance. Only score the basename; the graph handles directory context.
 const fileScore=(p:string)=>{const basename=p.split('/').at(-1)!.replace(/\.[^.]+$/,'');const fileWords=taskKeywords(basename.replace(/[_-]/g,' '));let score=0;for(const term of terms)if(fileWords.has(term))score+=12;return score;};
 const isGeneratedRule=(p:string)=>/^(?:\.clinerules\/agentos\.md|\.cursor\/rules\/agentos\.mdc|\.kiro\/steering\/agentos\.md|\.roo\/rules\/agentos\.md|\.trae\/rules\/agentos\.md|\.windsurf\/rules\/agentos\.md)$/i.test(p);
 // Graph only indexes safe, bounded local source. It never follows a symlink,
 // invokes project code, or resolves packages into node_modules/vendor.
 const graph=buildGraph(all,(p)=>{
   if(isIgnored(p,ignores))return null;
   const abs=safelyResolveFile(root,p);if(!abs)return null;
   try{
     if(statSync(abs).size>Math.min(opts.maxFileBytes,262144))return null;
     const data=readFileSync(abs);if(isBinary(data))return null;
     return data.toString('utf8');
   }catch{return null;}
 },undefined,pathFor(root,'cache','dependency-graph-index.json'));
 // Named functions explicitly mentioned by the task are stronger anchors
 // than keyword similarity in a filename. Only AST-indexed declarations
 // qualify; text mentions inside comments cannot create a symbol anchor.
 // Bounded to prevent a long task prompt from anchoring an entire project.
 // Build conservative synthetic graph edges BEFORE task selection: DI registrations
 // and UI state provider/viewmodel bindings need not appear as source imports.
 // All files are still loaded with the same safe, bounded, symlink-resistant loader.
 const semanticRead=(p:string):string|null=>{
  if(isIgnored(p,ignores))return null;
  const abs=safelyResolveFile(root,p);if(!abs)return null;
  try{if(statSync(abs).size>Math.min(opts.maxFileBytes,262144))return null;
    const data=readFileSync(abs);return isBinary(data)?null:data.toString('utf8');}catch{return null;}
 };
 const scip=enrichGraphWithScip(root,graph,semanticRead);
 const di=scanDI(graph.nodes,semanticRead);
 const bridges=scanFrameworkBridges(graph.nodes,semanticRead);
 const frameworkState=scanFrameworkState(graph.nodes,semanticRead);
 for(const extra of [...di.edges,...frameworkState.edges,...bridges.edges]){
  if(!graph.edges.some(e=>e.from===extra.from&&e.to===extra.to&&e.specifier===extra.specifier))graph.edges.push(extra);
 }
 graph.edges.sort((a,b)=>a.from.localeCompare(b.from)||a.to.localeCompare(b.to)||a.specifier.localeCompare(b.specifier));
 const namedSymbols=new Set((task.match(/[A-Za-z_$][A-Za-z0-9_$]*/g)||[]).filter(x=>x.length>=7&&/[A-Z_]/.test(x)));
 // An explicitly named symbol may exist in multiple files. If a SCIP
 // reference from an explicitly task-named caller uniquely identifies its
 // target, suppress same-name heuristic anchors in other files.
 const scipScoped=new Map<string,Set<string>>();
 for(const edge of graph.semanticReferences||[]){
   if(!hints.has(edge.from)||!namedSymbols.has(edge.symbolName))continue;
   const targets=scipScoped.get(edge.symbolName)||new Set<string>();
   targets.add(edge.to);scipScoped.set(edge.symbolName,targets);
 }
 const disambiguatedDeclarations=graph.nodes.filter(node=>node.symbols.some(symbol=>
   namedSymbols.has(symbol)&&scipScoped.has(symbol)&&!scipScoped.get(symbol)!.has(node.path)
 )).length;
 const symbolAnchors=graph.nodes.filter(node=>node.symbols.some(symbol=>
   namedSymbols.has(symbol)&&(!scipScoped.has(symbol)||scipScoped.get(symbol)!.has(node.path))
 )).map(node=>node.path).slice(0,12);
 // A path in task is an explicit anchor. Changed code also anchors the graph.
 const graphRelated=selectGraphContext(graph,task,new Set([...hints,...changes,...symbolAnchors]),2,36);
 const relations=new Map(graphRelated.map(r=>[r.path,r] as const));
 // Reuse only already indexed, safe local sources. AST path discovery checks
 // actual JSX event handlers; mere spelling matches in comments don't count.
 const sourceCache=new Map<string,string|null>();
 const taskLoader=(p:string):string|null=>{
   if(sourceCache.has(p))return sourceCache.get(p)!;
   let result:string|null=null;
   if(!isIgnored(p,ignores)){
     const abs=safelyResolveFile(root,p);
     if(abs)try{if(statSync(abs).size<=Math.min(opts.maxFileBytes,262144)){
       const data=readFileSync(abs);if(!isBinary(data))result=data.toString('utf8');
     }}catch{/* safety-first: unreadable source is never promoted */}
   }
   sourceCache.set(p,result);return result;
 };
 const actionTargets=taskActionNames(task,graphRelated,taskLoader);
 const taskPaths=findTaskPaths(graph.nodes.map(n=>n.path),actionTargets,taskLoader,6);
 const taskPathMap=new Map(taskPaths.map(p=>[p.path,p] as const));
 // React task-path callers can be discovered independently of the original
 // graph anchors. If a protected path invokes an exact, statically declared
 // imported API member, include the one-hop definition module as a bounded
 // forward dependency. Do NOT add arbitrary imports or reverse consumers.
 let extraApiEdges=0;
 for(const edge of graph.edges){
   if(extraApiEdges>=8||!taskPathMap.has(edge.from)||relations.has(edge.to))continue;
   const src=taskLoader(edge.from),target=taskLoader(edge.to);
   if(src===null||target===null)continue;
   const calls=discoverImportedMemberCalls(edge.from,src,edge.specifier);
   if(!calls.length)continue;
   const actual=new Set(analyzeSource(edge.to,target,{forceApiSplit:true}).segments.filter(s=>s.role==='api-member').map(s=>s.name));
   if(!actual.size)continue;
   const decisions=classifyTaskRootedMembers(edge.from,src,task,actionTargets,calls,taskPathMap.get(edge.from)?.calls||[]);
   const methods=decisions.filter(d=>d.rooted&&actual.has(d.call.qualifiedName)).map(d=>d.call.qualifiedName);
   if(!methods.length)continue;
   relations.set(edge.to,{path:edge.to,distance:1,relation:'dependency',via:edge.from,symbols:[...new Set(methods)]});
   extraApiEdges++;
 }
 // Weak graph dependents may still implement an explicitly requested UI
 // operation. Require TWO independent task words from the exact API member
 // and a matching caller basename; a generic 'products' match alone never
 // turns AdminProducts into a shopping-cart anchor. Validate against source.
 let namedApiUiAnchors=0;
 for(const edge of graph.edges){
   if(namedApiUiAnchors>=4||taskPathMap.has(edge.from))continue;
   // Do not require filename overlap: a domain-specific API name such as
   // analytics.revenueReport may be exact even if ReportsView is tokenized
   // as a generic display name. Require two method-level task terms below.
   const src=taskLoader(edge.from),target=taskLoader(edge.to);
   if(src===null||target===null)continue;
   const definitions=new Set(analyzeSource(edge.to,target,{forceApiSplit:true}).segments.filter(x=>x.role==='api-member').map(x=>x.name));
   if(!definitions.size)continue;
   const calls=discoverImportedMemberCalls(edge.from,src,edge.specifier);
   const qualified=calls.filter(call=>{
     // Two generic CRUD/domain words are not independent evidence for a
     // task-specific UI anchor: "products update" occurs in cart tasks but
     // must not promote an unrelated product administration screen. Require
     // at least one discriminative subject and a second task word. A caller
     // with a verified JSX task action can still be selected via taskPathMap.
     return taskSpecificApiMember(call.qualifiedName,task,terms)&&definitions.has(call.qualifiedName);
   });
   if(!qualified.length)continue;
   const decisions=classifyTaskRootedMembers(edge.from,src,task,actionTargets,qualified,taskPathMap.get(edge.from)?.calls||[]);
   const rooted=decisions.filter(x=>x.rooted);
   if(!rooted.length)continue;
   relations.set(edge.from,{path:edge.from,distance:0,relation:'anchor',via:null,symbols:[]});
   if(!relations.has(edge.to))relations.set(edge.to,{path:edge.to,distance:1,relation:'dependency',via:edge.from,symbols:rooted.map(x=>x.call.qualifiedName)});
   namedApiUiAnchors++;
 }
 // A task-focused pack must not be padded with arbitrary files from a broad
 // project preset. Generated editor rules are delivered separately to agents,
 // not repeated six times in a source-code context pack.
 const focused=relations.size>0 || hints.size>0;
 const selected=all.filter(p=>{
   if(isGeneratedRule(p) && !hints.has(p))return false;
   if(hints.has(p)||relations.has(p)||taskPathMap.has(p))return true;
   if(!focused)return changes.has(p)||patterns.some(x=>matchGlob(p,x));
   // When task anchors exist, unrelated Git changes and broad include patterns
   // are not evidence of relevance. They remain visible in the header.
   // A single generic noun ("product" in AdminProducts) must not pull a
   // changed file outside the task's bounded dependency graph. Require two
   // filename-keyword hits for this non-graph fallback; explicit task paths
   // and selected graph dependencies already pass through above.
   return fileScore(p)>=24 && (changes.has(p)||patterns.some(x=>matchGlob(p,x)));
 }).sort((a,b)=>{
   const prio=(p:string)=>{
     if(hints.has(p))return 0;
     const r=relations.get(p);
     if(r?.relation==='anchor')return 1; // CRITICAL: anchors precede neighbors
     if(taskPathMap.has(p))return 2; // callers precede incidental graph neighbors
     if(r?.relation==='definition'||r?.relation==='semantic-definition'||r?.relation==='semantic-callsite')return 3;
     if(r?.relation==='dependency')return r.distance===1?4:6;
     if(r?.relation==='dependent')return r.distance===1?5:7;
     if(changes.has(p))return 8;
     return 9;
   };
   return prio(a)-prio(b)||((hints.has(a)&&hints.has(b))?task.indexOf(a)-task.indexOf(b):0)||fileScore(b)-fileScore(a)||a.localeCompare(b,'en');
 });
 // Resolve exact imported API member calls only from task anchors or files
 // containing verified user-action paths. A reverse dependent cannot promote
 // everything in a shared service; no dependency module can seed itself.
 const importedMembers=new Map<string,Array<{qualifiedName:string;caller:string}>>();
 const memberSeen=new Set<string>();
 const apiPrecisionTargets=new Set<string>();
 const apiDeclarationCache=new Map<string,Set<string>>();
 const taskRootedCallCoverage:NonNullable<PackManifest['taskRootedCallCoverage']>={
   scanned:0,rooted:0,excluded:0,roots:[],excludedSamples:[],
   limitedTo:'bounded AST task root chains with at most two heuristic task-data-reference fallbacks per caller file; heuristics are not proof of runtime reachability'
 };
 const selectedPaths=new Set(selected);
 // Classification is made on caller AST nodes, BEFORE imported target modules
 // receive budget or critical status. Shared graph membership is never a root.
 for(const edge of graph.edges){
   if(!selectedPaths.has(edge.to)||!selectedPaths.has(edge.from))continue;
   const r=relations.get(edge.from);
   if(!(hints.has(edge.from)||r?.relation==='anchor'||taskPathMap.has(edge.from)))continue;
   const src=taskLoader(edge.from);if(src===null)continue;
   const calls=discoverImportedMemberCalls(edge.from,src,edge.specifier);
   if(calls.length)apiPrecisionTargets.add(edge.to);
   const decisions=classifyTaskRootedMembers(edge.from,src,task,actionTargets,calls,taskPathMap.get(edge.from)?.calls||[]);
   if(!apiDeclarationCache.has(edge.to)){
     const target=taskLoader(edge.to);
     apiDeclarationCache.set(edge.to,new Set(target===null?[]:analyzeSource(edge.to,target,{forceApiSplit:true}).segments
       .filter(segment=>segment.role==='api-member').map(segment=>segment.name)));
   }
   const actualApiDeclarations=apiDeclarationCache.get(edge.to)!;
   for(const decision of decisions){
     const item=decision.call;
     const key=`${edge.to}|${item.qualifiedName}|${item.caller}`;
     if(memberSeen.has(key))continue;
     memberSeen.add(key);taskRootedCallCoverage.scanned++;
     // A .map/.set/.find call on an imported Map/array is not an API member
     // declaration in the target module. Do not call it 'rooted' if no exact
     // static exported API object exists. Missing methods of verified API
     // objects remain explicitly UNRESOLVED (not silently discarded).
     if(!decision.rooted||!actualApiDeclarations.has(item.qualifiedName)&&!Array.from(actualApiDeclarations).some(name=>name.startsWith(item.qualifiedName.split('.')[0]+'.'))){
       taskRootedCallCoverage.excluded++;
       const reason=decision.rooted?'no-exact-static-member-definition':decision.reason;
       if(taskRootedCallCoverage.excludedSamples.length<30)taskRootedCallCoverage.excludedSamples.push({path:edge.from,qualifiedName:item.qualifiedName,caller:item.caller,reason});
       continue;
     }
     const prev=importedMembers.get(edge.to)||[];
     if(prev.length>=32||taskRootedCallCoverage.rooted>=120){
       taskRootedCallCoverage.excluded++;
       if(taskRootedCallCoverage.excludedSamples.length<30)taskRootedCallCoverage.excludedSamples.push({path:edge.from,qualifiedName:item.qualifiedName,caller:item.caller,reason:'bounded-selection-cap'});
       continue;
     }
     taskRootedCallCoverage.rooted++;
     if(taskRootedCallCoverage.roots.length<80)taskRootedCallCoverage.roots.push({path:edge.from,qualifiedName:item.qualifiedName,caller:item.caller,root:decision.root||'',reason:decision.reason});
     prev.push({qualifiedName:item.qualifiedName,caller:item.caller});
     importedMembers.set(edge.to,prev);
   }
 }
 taskRootedCallCoverage.heuristicRoots=taskRootedCallCoverage.roots.filter(x=>x.reason==='task-semantic-fallback').length;
 taskRootedCallCoverage.structuralRoots=taskRootedCallCoverage.rooted-taskRootedCallCoverage.heuristicRoots;
 taskRootedCallCoverage.status=taskRootedCallCoverage.scanned===0?'no-static-calls':taskRootedCallCoverage.rooted===0?'no-grounded-calls':taskRootedCallCoverage.structuralRoots===0?'heuristic-only':taskRootedCallCoverage.heuristicRoots>0?'mixed':'grounded';
 // Framework actions can be task roots even if the handler name was not
 // mentioned in the task. Only source in selected files and real Tree-sitter
 // function declarations can establish an action root. The event/route syntax
 // is conservative and is *not* claimed as compiler-resolved flow.
 const frameworkEvents:FrameworkEvent[]=[];
 const frameworkByFile=new Map<string,FrameworkEvent[]>();
 for(const path of selected){
   if(!/\.(?:dart|kt|kts|java|cs)$/i.test(path))continue;
   const source=taskLoader(path);if(source===null)continue;
   const analysis=parserRegistry.analyze(path,source);
   if(analysis.parser!=='tree-sitter-wasm'||analysis.diagnostics)continue;
   const events=discoverFrameworkEvents(path,source,analysis.segments,task);
   if(events.length){frameworkEvents.push(...events);frameworkByFile.set(path,events);}
 }
 // Multi-language semantic evidence. Walk only graph-resolved local imports
 // from selected task roots. A method must be an AST *call* in a task-named
 // function, not a string, comment, or arbitrary symbol occurrence.
 const crossLanguageTargets=new Map<string,Array<{name:string;caller:string}>>();
 const crossLanguageItems:Array<{path:string;name:string;caller:string;mode:'full'|'outline'|'unresolved';evidence:string;definitionKind:'body'|'declaration-only';reason?:string}>=[];
 const crossSeen=new Set<string>();
 const selectedSet=new Set(selected);
 for(let hop=0;hop<3;hop++){
 for(const edge of graph.edges){
   if(crossLanguageItems.length>=120)break;
   if(!selectedSet.has(edge.from)||!selectedSet.has(edge.to)||/\.[mc]?[jt]sx?$/i.test(edge.from)||/\.[mc]?[jt]sx?$/i.test(edge.to))continue;
   const rel=relations.get(edge.from);
   if(!hints.has(edge.from)&&rel?.relation!=='anchor'&&!taskPathMap.has(edge.from)&&!(hop>0&&crossLanguageTargets.has(edge.from)))continue;
   const source=taskLoader(edge.from),destination=taskLoader(edge.to);
   if(source===null||destination===null)continue;
   const a=parserRegistry.analyze(edge.from,source),b=parserRegistry.analyze(edge.to,destination);
   if(a.parser!=='tree-sitter-wasm'||b.parser!=='tree-sitter-wasm'||a.diagnostics||b.diagnostics)continue;
   const bound=analyzeLanguage(edge.from,source).bindings?.filter(x=>x.specifier===edge.specifier)||[];
   const methods=a.segments.filter(s=>s.kind==='function');
   const roots=methods.filter(s=>{
     const name=s.name.split('.').at(-1)||'';
     // Literal callable identifier must appear in the task as a word.
     const importedRoot=(crossLanguageTargets.get(edge.from)||[]).some(x=>x.name===s.name);
     const frameworkRoot=(frameworkByFile.get(edge.from)||[]).some(x=>x.root===s.name);
     return importedRoot||frameworkRoot||(hop===0&&name.length>=4&&new RegExp('(^|[^\\w$])'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?=$|[^\\w$])').test(task));
   });
   const queue=roots.slice(0,16).map(method=>({method,depth:0,root:method.name}));
   const seenCalls=new Set<string>();
   while(queue.length&&seenCalls.size<64){
     const {method:caller,depth,root}=queue.shift()!;
     if(seenCalls.has(caller.name))continue;seenCalls.add(caller.name);
     const actions=(frameworkByFile.get(edge.from)||[]).filter(x=>x.root===caller.name);
     const scopedCalls=actions.filter(x=>x.onlyCalls!==undefined).flatMap(x=>x.onlyCalls!);
     const exactCalls=actions.length>0&&actions.every(x=>x.onlyCalls!==undefined) ? scopedCalls : null;
     // BLoC registers an event handler indirectly (on<Event>(handler));
     // that handler is not a literal call at the UI site. Require both the
     // parsed `add` call and an exact, unique event-to-handler registration.
     const stateCandidates=frameworkState.bindings.filter(x=>x.from===edge.from&&x.to===edge.to);
     const scopedBody=actions.length&&actions.every(x=>x.onlyCalls!==undefined)
       ?actions.map(event=>inlineEventScope(source,event.offset)).filter((body):body is string=>body!==null).join('\n') :caller.body;
     // A nested ref.read(...).method / BLoC.add(Event()) call is a
     // call AST node, but the Dart WASM collector currently reports only
     // the inner `.read`. Promote the METHOD only when that inner call is
     // in the AST and the complete outer dispatch is in the exact callback.
     const hasStateReader=(caller.calls||[]).some(x=>x==='ref.read'||x==='context.read'||x.endsWith('.read'));
     const indirectStateCalls=actions.length&&hasStateReader
       ?stateCandidates.filter(x=>frameworkStateBindingForCall([x],edge.from,edge.to,scopedBody,x.method)).map(x=>x.method):[];
     for(const expression of [...new Set([...(caller.calls||[]),...indirectStateCalls])]){
       const stateProof=actions.length?frameworkStateBindingForCall(stateCandidates,edge.from,edge.to,scopedBody,expression.split('.').at(-1)||expression):undefined;
       if(edge.specifier.startsWith('state:')&&!stateProof)continue;

       if(exactCalls&&!stateProof&&!exactCalls.some(x=>x===expression||expression.endsWith('.'+x)))continue;
       const called=(expression.match(/[A-Za-z_$][\w$]*$/)||[])[0]||expression;
       // A local declaration takes precedence over imported source guesses.
       // Follow up to three bounded local AST-call edges.
       const local=methods.filter(x=>x.name.split('.').at(-1)===called&&x.name!==caller.name);
       if(local.length===1&&depth<3){queue.push({method:local[0]!,depth:depth+1,root});continue;}
       if(local.length>0&&!stateProof)continue;
       const imported=bound.find(x=>x.local===called)?.imported||called;
       // A Python named import gives explicit alias evidence; an unrelated
       // unqualified symbol is not evidence of this target module.
       if(a.parser==='tree-sitter-wasm'&&edge.from.endsWith('.py')&&bound.length&&
          !expression.includes('.')&&!bound.some(x=>x.local===called))continue;
       const defs=b.segments.filter(s=>s.kind==='function'&&s.name.split('.').at(-1)===imported&&(!stateProof||s.name.startsWith(stateProof.owner+'.')));
       if(defs.length!==1)continue; // Never arbitrarily choose same-name methods.
       const def=defs[0]!;
       if(edge.specifier.startsWith('di:')&&!di.bindings.some(x=>x.controllerPath===edge.from&&x.implementationPath===edge.to&&x.implementation===def.name.split('.').at(-2)&&x.method===called))continue;

       // Distinguish receiver class, locally constructed object, and module alias.
       // No symbol guess is permitted based solely on matching a method name.
       const receiver=expression.includes('.')?expression.split('.').at(-2):undefined;
       const declaringClass=def.name.includes('.')?def.name.split('.').at(-2):undefined;
       let receiverEvidence='';
       if(receiver&&declaringClass&&receiver!==declaringClass){
         const registeredProof=di.bindings.find(x=>x.controllerPath===edge.from&&x.implementationPath===edge.to&&x.field===receiver&&x.method===called&&x.implementation===declaringClass);
         const proof=resolveConstructedReceiver(edge.from,caller.body,receiver,declaringClass,bound,edge.specifier,called)||
           resolveInjectedReceiver(edge.from,source,receiver,declaringClass,called)||
           (registeredProof?{kind:'registered-interface-injection' as const,type:declaringClass}:null)||
           (stateProof?.kind==='compose-viewmodel'?{kind:'compose-viewmodel-binding' as const,type:declaringClass}:null);

         if(!proof)continue;
         receiverEvidence=proof.kind;
       }
       if(receiver&&!declaringClass&&!expression.includes('::')){
         const moduleProof=resolveModuleReceiver(receiver,edge.specifier,bound);
         if(!moduleProof&&!stateProof){
           // Go methods are represented as standalone function declarations
           // by Tree-sitter. Validate the declared receiver type explicitly.
           const receiverType=edge.to.endsWith('.go')?
             def.body.match(/\bfunc\s*\(\s*(?:[A-Za-z_]\w*\s+)?\*?([A-Za-z_]\w*)\s*\)\s*[A-Za-z_]\w*\s*\(/)?.[1]:undefined;
           const proof=receiverType?resolveConstructedReceiver(edge.from,caller.body,receiver,receiverType,bound,edge.specifier,called):null;
           if(!proof)continue;
           receiverEvidence=proof.kind;
         }else receiverEvidence=stateProof?'framework-state:'+stateProof.kind:moduleProof!.kind;
       }
       const key=`${edge.to}|${def.name}|${edge.from}:${caller.startLine}`;
       if(crossSeen.has(key))continue;crossSeen.add(key);
       const callerRef=`${edge.from}:${caller.startLine}:${root}${depth?` => ${caller.name}`:''}`;
       const entry={path:edge.to,name:def.name,caller:callerRef,mode:'unresolved' as const,
          definitionKind:(/;\s*$/.test(def.body.trim())&&!/[{}]/.test(def.body)?'declaration-only':'body') as 'body'|'declaration-only',
          evidence:(actions.length?'framework-action+':'')+(stateProof?'framework-state:'+stateProof.kind+'+':'')+(receiverEvidence?'ast-call+'+receiverEvidence+'+resolved-file':bound.some(x=>x.local===called&&x.imported===imported)?'ast-call+named-import+resolved-file':'ast-call+resolved-local-import'),reason:'not-packed'};
       crossLanguageItems.push(entry);
       const list=crossLanguageTargets.get(edge.to)||[];
       if(list.length<24&&!list.some(x=>x.name===def.name&&x.caller===callerRef))list.push({name:def.name,caller:callerRef});
       crossLanguageTargets.set(edge.to,list);
     }
   }

 }
 }
 // Propagate only task-rooted, already-selected framework bridge targets into
 // symbol-level budgeting. The bridge scan alone cannot promote arbitrary
 // framework implementations into a task pack.
 const bridgeTargets=new Map<string,Array<{name:string;caller:string}>>();
 let promotedBridges=0;
 for(const bridge of bridges.bridges){
  if(promotedBridges>=16||bridge.certainty==='framework-boundary'||!selectedSet.has(bridge.from)||!selectedSet.has(bridge.to))continue;
  if(!hints.has(bridge.from)&&relations.get(bridge.from)?.relation!=='anchor'&&fileScore(bridge.from)<12)continue;
  const method=bridge.target.split('.').at(-1)||bridge.target;
  const taskExplicit=new RegExp('(^|[^\\w$])'+method.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?=$|[^\\w$])','i').test(task);
  if(!taskExplicit&&fileScore(bridge.from)<24&&bridge.kind!=='compose-callback-forwarding'&&bridge.kind!=='compose-forwarded-widget')continue;
  const prev=bridgeTargets.get(bridge.to)||[];
  if(prev.some(x=>x.name===bridge.target)||prev.length>=8)continue;
  prev.push({name:bridge.target,caller:bridge.from+':'+bridge.caller});bridgeTargets.set(bridge.to,prev);promotedBridges++;
  if(bridge.kind==='compose-callback-forwarding'){
   const callerSource=taskLoader(bridge.from);
   const method=bridge.caller.match(/viewModel::([A-Za-z_]\w*)/)?.[1];
   if(callerSource!==null&&method){
    const re=new RegExp('\\bviewModel\\s*::\\s*'+method+'\\b','g');
    const locations=[...callerSource.matchAll(re)];
    if(locations.length===1){
     const offset=locations[0]!.index!;
     const owner=parserRegistry.analyze(bridge.from,callerSource).segments.filter(x=>x.kind==='function'&&x.start<=offset&&x.end>offset)
       .sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0];
     if(owner){
      const roots=bridgeTargets.get(bridge.from)||[];
      if(!roots.some(x=>x.name===owner.name))roots.push({name:owner.name,caller:bridge.from+':'+bridge.caller});
      bridgeTargets.set(bridge.from,roots);
     }
    }
   }
  }
  if(bridge.kind==='flutter-command-dispatch'){
   // The user's action is in the widget build() body, which would normally
   // be reduced to an outline despite the target VM method being packed.
   // Focus the enclosing exact AST declaration of the already-grounded event.
   const source=taskLoader(bridge.from);
   const command=bridge.caller.match(/^onPressed:([A-Za-z_]\w*)\.execute$/)?.[1];
   if(source!==null&&command){
    const finder=new RegExp('\\bonPressed\\s*:\\s*[\\s\\S]{0,210}?widget\\s*\\.\\s*viewModel\\s*\\.\\s*'+command+'\\s*\\.\\s*execute\\b','g');
    const occurrences=[...source.matchAll(finder)];
    if(occurrences.length===1){
     const start=occurrences[0]!.index!;
     const enclosing=parserRegistry.analyze(bridge.from,source).segments.filter(x=>x.kind==='function'&&x.start<=start&&x.end>=start+occurrences[0]![0].length)
       .sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0];
     if(enclosing){
      const prevCaller=bridgeTargets.get(bridge.from)||[];
      if(!prevCaller.some(x=>x.name===enclosing.name))prevCaller.push({name:enclosing.name,caller:bridge.from+':'+bridge.caller});
      bridgeTargets.set(bridge.from,prevCaller);
     }
    }
   }
  }

 }
 const frameworkItems=frameworkEvents.map(e=>({...e,mode:'unresolved' as 'full'|'root-only'|'unresolved',linkedDefinitions:[] as Array<{path:string;name:string;mode:'full'|'outline'|'unresolved'}>}));
 const stateItems:Array<StateScan['bindings'][number]&{mode:'full'|'unresolved';propagation?:StatePropagation}>=frameworkState.bindings.map(x=>({...x,mode:'unresolved'}));
 const selectedSemantic=(graph.semanticReferences||[]).filter(e=>
   ['semantic-definition','semantic-callsite'].includes(relations.get(e.to)?.relation||'')&&relations.get(e.to)?.via===e.from);
 const scipReport:NonNullable<PackManifest['scip']>={
  status:scip.status,...(scip.indexer?{indexer:scip.indexer}:{}),
  freshDefinitions:scip.freshDefinitions,staleDocuments:scip.staleDocuments,
  navigationLinks:scip.links,staticCallsites:scip.staticCallsites,taskScopedLinks:selectedSemantic.length,
  taskScopedCallsites:(graph.scipCallsites||[]).filter(e=>relations.get(e.to)?.relation==='semantic-callsite'&&relations.get(e.to)?.via===e.from).length,disambiguatedDeclarations,includedTargets:0,bodyPreserved:0,
  limitations:scip.limitations,
  items:selectedSemantic.slice(0,24).map(e=>({from:e.from,to:e.to,symbol:e.symbolName,
   symbolId:e.symbolId,mode:'omitted' as const,evidence:e.evidence}))
 };
 const manifest:PackManifest={scip:scipReport,frameworkBridgeCoverage:{discovered:bridges.bridges.length,bodyPreserved:0,declarationOnly:0,omitted:0,items:bridges.bridges.map(x=>({...x,mode:'omitted' as const})),limitations:bridges.limitations},diResolution:{registrations:di.registrations.length,bindings:di.bindings.length,ambiguous:di.ambiguous.length,verifiedBindings:0,items:di.bindings,limitations:'Unique project-local C# AddScoped/AddSingleton/AddTransient<I,Impl> or Java @Service/@Component/@Repository class implements I; constructor field identity and AST method only. No runtime IoC, scan/conditional registration, decorators, or virtual dispatch proof'},frameworkStateCoverage:{discovered:stateItems.length,verified:0,unresolved:0,propagated:0,items:stateItems,limitations:'Unique local Riverpod provider, BLoC event registration, Cubit action, or explicitly typed Compose ViewModel; bounded AST callback plus source-preserved method, not runtime state/data flow'},frameworkFlowCoverage:{discovered:frameworkItems.length,linked:0,verified:0,rootOnly:0,unresolved:0,items:frameworkItems,limitedTo:'Static framework syntax (Flutter callback, Compose click, Spring MVC and ASP.NET HTTP method attributes) intersected with AST function declarations and local graph imports; no runtime execution, container configuration, virtual dispatch or general UI state flow proof'},crossLanguageSymbolCoverage:{discovered:crossLanguageItems.length,preserved:0,implementationBodies:0,outlined:0,unresolved:0,items:crossLanguageItems,limitedTo:'Task-named AST callable -> bounded local AST calls -> up to 3 resolved local import hops -> unambiguous target AST declarations; not whole-program dispatch, type resolution, FFI or network call graph'},taskRootedCallCoverage,importedMemberCoverage:{discovered:0,preserved:0,outlined:0,unresolved:0,items:[],limitedTo:'task-rooted static imported-member calls only; calls outside recognized task roots are reported separately; dynamic calls, aliases across reexports and runtime dispatch not verified'},semanticDependencyCoverage:{discovered:0,preserved:0,outlined:0,omitted:0,items:[],limitedTo:'task-grounded, bounded local AST reference closure, provider wiring and action-state JSX; not complete semantic/call graph'},taskPathCoverage:{actionTargets,callsiteCount:taskPaths.reduce((n,p)=>n+p.calls.length,0),distinctEventCount:new Set(taskPaths.flatMap(p=>p.calls.map(c=>`${p.path}|${c.attributeStart}|${c.attributeEnd}`))).size,included:0,omitted:0,threeStageEvidence:0,unverifiedDefinitions:0,callsites:[]},engine:'agentos-native',version:1,branch:git.branch,head:git.head,taskHash:sha(task),entries:[],skipped:[],totalSourceBytes:0,outputBytes:0,estimatedTokens:0,exactModelTokens:null,tokenAccounting:"conservative-estimate-not-provider-exact",compressionRatio:1,truncated:false,graph:{nodes:graph.nodes.length,edges:graph.edges.length,unresolved:graph.unresolved.length,truncated:graph.truncated,relatedFiles:graphRelated.length},limits:{maxFiles:opts.maxFiles,maxFileBytes:opts.maxFileBytes,maxTotalBytes:opts.maxTotalBytes,maxOutputBytes:opts.maxOutputBytes,maxEstimatedTokens:opts.smart.maxEstimatedTokens}};
 const header=[
 '# AgentOS — Native Context Pack (Framework DI + State Semantic Flow v0.8.18-rc.1)','',
 '> Local, deterministic context. Review this file before sharing outside your machine.','',
 `Project: ${JSON.stringify(profile.name)}`,
 `Git branch: ${JSON.stringify(git.branch)}`,
 `Git HEAD: ${git.head??'(none)'}`,'',
 '## Current task',safeTask,'',
 `## Changed paths\n${[...changes].sort().map(p=>'- '+JSON.stringify(p)).join('\n')||'(none)'}`,'',
 `Dependency graph: ${graph.nodes.length} nodes / ${graph.edges.length} local edges; ${graphRelated.length} task-related files (bounded to two hops).`,'',
 '## Source files',''
 ].join('\n');
 let content=header;let bytes=Buffer.byteLength(content);
 const effectiveLimit=Math.min(opts.maxOutputBytes,opts.smart.maxEstimatedTokens*2);
 // Disable the pack entirely if the owner asks. Never fall back to Repomix.
 if(!opts.enabled){
   content='# AgentOS — Context packing disabled\n\nSet `packer.enabled: true` in agentos.yml.\n';
   writeAtomic(output,content);
   writeAtomic(manifestPath,JSON.stringify(manifest,null,2)+'\n');
   return {status:'disabled',message:'Native packer disabled by configuration',patterns};
 }
 const skipped=(p:string,reason:string)=>{manifest.skipped.push({path:p,reason}); if(reason==='max-files'||reason==='total-budget'||reason==='output-budget')manifest.truncated=true;};
 const seenSourceHashes=new Set<string>();
 for(const p of selected){
   if(isIgnored(p,ignores)){skipped(p,'ignored');continue;}
   if(manifest.entries.length>=opts.maxFiles){skipped(p,'max-files');continue;}
   const abs=safelyResolveFile(root,p);
   if(!abs){skipped(p,'unsafe-link-or-unreadable');continue;}
   let size:number;try{size=statSync(abs).size;}catch{skipped(p,'stat-error');continue;}
   if(size>opts.maxFileBytes){skipped(p,'file-too-large');continue;}
   if(manifest.totalSourceBytes+size>opts.maxTotalBytes){skipped(p,'total-budget');continue;}
   let buffer:Buffer;try{buffer=readFileSync(abs);}catch{skipped(p,'read-error');continue;}
   if(buffer.length!==size){skipped(p,'changed-during-read');continue;}
   if(isBinary(buffer)){skipped(p,'binary-or-invalid-utf8');continue;}
   const raw=buffer.toString('utf8');
   const sourceHash=sha(raw);
   // Identical rules and generated boilerplate waste context without adding
   // information. Preserve the first copy and report later duplicates.
   if(seenSourceHashes.has(sourceHash)){skipped(p,'duplicate-content');continue;}
   const remaining=effectiveLimit-bytes;
   const relation=relations.get(p);
   // Reserve space for core files by giving graph neighbors modest budgets;
   // huge reverse dependents must not consume 60KB each.
   // Generic low-confidence two-hop dependencies deserve a short outline, not
   // the same budget as an explicit task path or directly referenced module.
   // This is based on graph depth, lexical relevance and observed action names,
   // not hardcoded /admin or /review exclusions.
   const lowConfidenceTwoHop=!!relation&&relation.distance>=2&&!hints.has(p)&&
     !taskPathMap.has(p)&&fileScore(p)<24&&
     !actionTargets.some(target=>taskLoader(p)?.includes(target));
   const relatedBudget=focused ? (
       taskPathMap.has(p) && relation?.relation!=='anchor' ? Math.min(opts.smart.fileBudgetBytes,18000)
     : hints.has(p) ? Math.min(opts.smart.fileBudgetBytes,32000)
     : relation?.relation==='anchor' ? Math.min(opts.smart.fileBudgetBytes,fileScore(p)>0?28000:18000)
     : (relation?.relation==='definition'||relation?.relation==='semantic-definition'||relation?.relation==='semantic-callsite') ? Math.min(opts.smart.fileBudgetBytes,16000)
     : relation?.relation==='dependency' ? Math.min(opts.smart.fileBudgetBytes,
       graph.nodes.find(n=>n.path===p)?.symbols.some(name=>[...terms].some(t=>taskKeywords(name).has(t)))?11000:7000)
     : relation?.relation==='dependent' ? Math.min(opts.smart.fileBudgetBytes,2300)
     : Math.min(opts.smart.fileBudgetBytes,2000)
   ) : opts.smart.fileBudgetBytes;
   const budgetWithDepthCap=lowConfidenceTwoHop?Math.min(relatedBudget,2000):relatedBudget;
   const safetyRemaining=Math.max(0,remaining-Buffer.byteLength(p)-130);
   // Only task anchors, actual JSX callsites, explicit task files and forward
   // one-hop dependencies receive semantic expansion. Depth-two and reverse
   // dependents remain eligible for lightweight regular scoring, not fan-out.
   // The rule depends on graph evidence, never directory names like /admin.
   const semanticGrounding= hints.has(p)?'explicit-task-file' as const
     :taskPathMap.has(p)?'task-path' as const
     :relation?.relation==='anchor'?'task-anchor' as const
     :relation?.relation==='definition'||relation?.relation==='semantic-definition'||relation?.relation==='semantic-callsite'||(relation?.relation==='dependency'&&relation.distance===1)?'direct-dependency' as const
     :'unverified' as const;
   const makeAtBudget=(budgetBytes:number)=>makeSmartSnippet(p,raw,task,{
     budgetBytes,minScore:opts.smart.minSymbolScore,
     alwaysFull:opts.smart.mode==='full'||size<=opts.smart.fullFileThresholdBytes,
     changed:changes.has(p),explicitPath:hints.has(p),focusSymbols:relations.get(p)?.symbols||[],
     callsiteTargets:taskPathMap.get(p)?.targets||[],semanticTargets:actionTargets,semanticGrounding,importedMembers:importedMembers.get(p)||[],crossLanguageTargets:[...(crossLanguageTargets.get(p)||[]),...(bridgeTargets.get(p)||[])],precisionApiOnly:apiPrecisionTargets.has(p)
   });
   let available=Math.min(budgetWithDepthCap,safetyRemaining);
   let smart=makeAtBudget(available);
   // Redistribute UNUSED global capacity to protected task paths before adding
   // irrelevant neighboring files. Never exceed the explicit per-file limit.
   if((taskPathMap.has(p)&&smart.segments.some(s=>s.critical&&s.mode!=='full')) ||
      smart.semanticDependencies?.some(s=>s.mode!=='full')){
     for(const candidate of [24000,32000,opts.smart.fileBudgetBytes]){
       const larger=Math.min(candidate,opts.smart.fileBudgetBytes,safetyRemaining);
       if(larger<=available)continue;
       const retry=makeAtBudget(larger);
       const retained=(x:typeof smart)=>x.segments.filter(s=>s.critical&&s.mode==='full').length+
          (x.semanticDependencies||[]).filter(s=>s.mode==='full').length;
       if(retained(retry)>retained(smart)||retained(retry)===retained(smart)&&retry.includedBytes<=smart.includedBytes){
         smart=retry;available=larger;
       }
       if(!smart.segments.some(s=>s.critical&&s.mode!=='full') && !smart.semanticDependencies?.some(s=>s.mode!=='full'))break;
     }
   }
   // Security is ALWAYS applied after AST extraction so code fragments cannot bypass it.
   const processed=sanitize(smart.text);
   const section=`\n### ${JSON.stringify(p)} [${smart.mode}; ${smart.parser}]\n\n${fenced(processed.value)}\n`;
   const sectionBytes=Buffer.byteLength(section);
   if(bytes+sectionBytes>effectiveLimit){skipped(p,'output-budget');continue;}
   content+=section;bytes+=sectionBytes;seenSourceHashes.add(sourceHash);
   manifest.entries.push({path:p,bytes:size,sha256:sourceHash,priority:filePriority(p,hints,changes),redactedLines:processed.count,
     mode:smart.mode,...(relation?.relation==='anchor' ? {graph:{distance:0,relation:'anchor',via:null}} :
       taskPathMap.has(p) ? {graph:{distance:0,relation:'task-path',via:null}} :
       relation ? {graph:{distance:relation.distance,relation:relation.relation,via:relation.via}} : {}),includedBytes:Buffer.byteLength(processed.value),estimatedTokens:tokenEstimate(section),exactSyntaxTokens:exactSyntaxTokens(p,processed.value),
     parser:smart.parser,segments:smart.segments.map(s=>({...s,name:sanitize(s.name).value}))});
   for(const member of importedMembers.get(p)||[]){
     const stats=manifest.importedMemberCoverage!;
     const segment=smart.segments.find(s=>s.name===member.qualifiedName);
     // An imported member must have an exact segment. Mere mention of its
     // name elsewhere in this file does not count as retained evidence.
     const fullApiMember=smart.mode==='full'&&analyzeSource(p,raw,{forceApiSplit:true}).segments.some(s=>s.name===member.qualifiedName&&s.role==='api-member');
     const source=segment?raw.slice(segment.startOffset??0,segment.endOffset??0):'';
     const valid=smart.mode==='full'?fullApiMember:
       segment?.mode==='full'&&!!source&&processed.value.includes(source);
     const mode=valid?'full' as const:segment?.bytesAfter?'outline' as const:'unresolved' as const;
     const reason=!segment?'member-definition-not-resolved':!valid?'member-definition-not-preserved':undefined;
     stats.discovered++;if(mode==='full')stats.preserved++;else if(mode==='outline')stats.outlined++;else stats.unresolved++;
     if(stats.items.length<100)stats.items.push({path:p,qualifiedName:member.qualifiedName,caller:member.caller,mode,...(reason?{reason}:{})});
     if(mode!=='full')manifest.truncated=true;
   }
   for(const dependency of smart.semanticDependencies||[]){
     // Security redaction can replace the full AST fragment after selection.
     // A redacted source fragment is NOT preserved evidence, even if the
     // parser marked it full before the redaction pass.
     const segment=smart.segments.find(s=>s.name===dependency.name);
     const original=segment?raw.slice(segment.startOffset,segment.endOffset):'';
     const redacted=dependency.mode==='full'&&!!original&&!processed.value.includes(original);
     const verified={...dependency,mode:redacted?'omitted' as const:dependency.mode};
     const stats=manifest.semanticDependencyCoverage!;stats.discovered++;
     if(verified.mode==='full')stats.preserved++;else if(verified.mode==='outline')stats.outlined++;else stats.omitted++;
     if(stats.items.length<100)stats.items.push({path:p,...verified,...(relation?.via?{graphVia:relation.via,graphRelation:relation.relation}:{})});
     if(verified.mode!=='full')manifest.truncated=true;
   }
   for(const call of taskPathMap.get(p)?.calls||[]){
     const result=manifest.taskPathCoverage!;
     // An AST event is retained only if a FULL emitted JSX segment spans the
     // actual event attribute. Source-offset inclusion alone is not enough:
     // check its exact source text is present after credential redaction.
     const attribute=raw.slice(call.attributeStart,call.attributeEnd);
     const eventSegment=smart.segments.find(seg=>seg.kind==='jsx'&&seg.mode==='full'&&seg.bytesAfter>0&&
       (seg.startOffset??Infinity)<=call.attributeStart&&(seg.endOffset??-1)>=call.attributeEnd);
     const eventPreserved=!!attribute&&processed.value.includes(attribute)&&(smart.mode==='full'||!!eventSegment);
     const handlerPreserved=!call.handler||
       (smart.mode==='full'&&processed.value.includes(call.handler))||
       smart.segments.some(seg=>seg.name.endsWith('.'+call.handler)&&seg.mode==='full'&&seg.bytesAfter>0);
     const included=eventPreserved&&handlerPreserved;
     if(included)result.included++;else result.omitted++;
     const reason=!eventPreserved&&!handlerPreserved?'task-path-event-and-handler-not-preserved':
       !eventPreserved?'task-path-event-not-preserved':
       !handlerPreserved?'task-path-handler-not-preserved':undefined;
     result.callsites.push({path:p,target:call.target,line:call.line,column:call.column,handler:call.handler,
       eventPreserved,handlerPreserved,actionDefinitionPreserved:null,definitionStatus:'unresolved',included,threeStageEvidence:false,
       ...(reason?{reason}:{} )});
     if(!included)manifest.truncated=true;
   }
   // Report partial-context omissions independently of skipped whole files.
   // This is lexical relevance, not a claim that a function is required.
   for(const segment of smart.segments){
     if(segment.bytesAfter!==0||segment.score<opts.smart.minSymbolScore)continue;
     const omitted=manifest.omittedRelevantSegments??{count:0,samples:[]};
     omitted.count++;
     if(omitted.samples.length<24)omitted.samples.push({path:p,name:sanitize(segment.name).value,score:segment.score,reason:segment.reason||'omitted'});
     manifest.omittedRelevantSegments=omitted;
     manifest.truncated=true;
   }
   manifest.totalSourceBytes+=size;
 }
 // Reconcile exact declaration bodies against emitted snippets. A whole
 // source file counts only when no security redaction changed its contents.
 for(const item of crossLanguageItems){
   const entry=manifest.entries.find(e=>e.path===item.path);
   const exact=entry?.segments?.find(s=>s.name===item.name);
   if(entry?.mode==='full'&&entry.redactedLines===0 || exact?.mode==='full'&&exact.bytesAfter>0&&entry?.redactedLines===0){
     item.mode='full';delete item.reason;manifest.crossLanguageSymbolCoverage!.preserved++;
     if(item.definitionKind==='body')manifest.crossLanguageSymbolCoverage!.implementationBodies++;
   }else if(exact&&exact.bytesAfter>0){item.mode='outline';item.reason='declaration-outline-or-redacted';manifest.crossLanguageSymbolCoverage!.outlined++;}
   else{item.mode='unresolved';item.reason=entry?'definition-omitted-or-redacted':'definition-file-not-packed';manifest.crossLanguageSymbolCoverage!.unresolved++;}
 }
 // An explicit DI / state edge is verified only when a task-rooted AST
 // callee was included with its complete implementation in the final pack.
 for(const item of stateItems){
  const linked=crossLanguageItems.some(x=>x.path===item.to&&x.name===item.owner+'.'+item.method&&x.mode==='full'&&x.definitionKind==='body'&&x.evidence.includes('framework-state:'+item.kind));
  if(linked){
    item.mode='full';manifest.frameworkStateCoverage!.verified++;
    const consumer=taskLoader(item.from),producer=taskLoader(item.to);
    if(consumer!==null&&producer!==null){
      const segment=parserRegistry.analyze(item.to,producer).segments.filter(x=>x.kind==='function'&&x.name===item.owner+'.'+item.method);
      const propagation=segment.length===1?statePropagationEvidence(item,consumer,producer,segment[0]!.body):null;
      if(propagation){item.propagation=propagation;manifest.frameworkStateCoverage!.propagated++;}
    }
  }else manifest.frameworkStateCoverage!.unresolved++;
 }
 // Framework bridges are not marked verified merely because the path was packed.
 // Require exact implementation segment to be preserved; source-only convention
 // links and external frameworks keep explicit boundary/declaration statuses.
 for(const item of manifest.frameworkBridgeCoverage!.items){
  const entry=manifest.entries.find(x=>x.path===item.to);
  if(item.certainty==='framework-boundary'){
   item.mode=entry?'declaration-only':'omitted';
   if(entry)manifest.frameworkBridgeCoverage!.declarationOnly++;
   else manifest.frameworkBridgeCoverage!.omitted++;
   continue;
  }
  const exact=entry?.segments?.find(s=>s.name===item.target&&s.mode==='full'&&s.bytesAfter>0);
  if(exact){item.mode='body-preserved';manifest.frameworkBridgeCoverage!.bodyPreserved++;}
  else{item.mode='omitted';manifest.frameworkBridgeCoverage!.omitted++;}
 }
 manifest.diResolution!.verifiedBindings=di.bindings.filter(x=>crossLanguageItems.some(item=>item.path===x.implementationPath&&item.name===x.implementation+'.'+x.method&&item.mode==='full'&&item.evidence.includes('registered-interface-injection'))).length;
 // Framework coverage distinguishes a retained action handler from a
 // proven imported implementation. A route/callback alone is NOT a full flow.
 for(const e of frameworkItems){
   const entry=manifest.entries.find(x=>x.path===e.path);
   const rootSegment=entry?.segments?.find(s=>s.name===e.root&&s.mode==='full'&&s.bytesAfter>0);
   const rootRetained=!!entry&&(entry.mode==='full'&&entry.redactedLines===0||!!rootSegment&&entry.redactedLines===0);
   const linked=manifest.crossLanguageSymbolCoverage!.items.filter(item=>{
     if(!item.caller.startsWith(`${e.path}:`)||!item.caller.includes(e.root.split('.').at(-1)||e.root)||!item.evidence.startsWith('framework-action+'))return false;
     if(e.onlyCalls===undefined)return true;
     const callee=item.name.split('.').at(-1)||'';
     if(e.onlyCalls.some(call=>call.split('.').at(-1)===callee))return true;
     // FrameworkState indirect dispatch (Riverpod/Bloc) has an AST `read`
     // call but its nested target was resolved by the provider registry.
     // Attribute it to THIS callback body only, not a sibling's click.
     const src=taskLoader(e.path);
     if(src===null)return false;
     const callback=inlineEventScope(src,e.offset);
     if(callback===null)return false;
     return frameworkState.bindings.some(binding=>binding.from===e.path&&binding.to===item.path&&
       binding.owner+'.'+binding.method===item.name&&frameworkStateBindingForCall([binding],e.path,item.path,callback,binding.method));
   });
   e.linkedDefinitions=linked.map(item=>({path:item.path,name:item.name,mode:item.mode}));
   if(linked.length)manifest.frameworkFlowCoverage!.linked++;
   // Interfaces and header-only declarations cannot disqualify a proven
   // concrete implementation, or count as a complete service body.
   const completeImplementations=linked.filter(x=>x.definitionKind==='body');
   if(rootRetained&&completeImplementations.length&&completeImplementations.every(x=>x.mode==='full')){
     e.mode='full';manifest.frameworkFlowCoverage!.verified++;
   }else if(rootRetained){e.mode='root-only';manifest.frameworkFlowCoverage!.rootOnly++;}
   else{e.mode='unresolved';manifest.frameworkFlowCoverage!.unresolved++;}
 }
 // A protected caller that could not be packed must never vanish silently.
 for(const candidate of taskPaths){
   if(manifest.taskPathCoverage!.callsites.some(c=>c.path===candidate.path))continue;
   for(const call of candidate.calls){
     manifest.taskPathCoverage!.omitted++;
     manifest.taskPathCoverage!.callsites.push({path:candidate.path,target:call.target,line:call.line,column:call.column,handler:call.handler,eventPreserved:false,handlerPreserved:false,actionDefinitionPreserved:null,definitionStatus:'unresolved',included:false,threeStageEvidence:false,reason:'task-path-file-not-included'});
   }
   manifest.truncated=true;
 }
 // Reconcile a *same-name action definition candidate* separately from the JSX event and
 // intermediate handler. Only claim a verified definition when its exact AST
 // declaration is emitted FULL in the pack. Unresolved definitions remain
 // explicitly unknown (for example, actions supplied by an external package).
 const coverage=manifest.taskPathCoverage!;
 const definitions=new Map<string,Set<string>>();
 const isTargetDefinition=(name:string,kind:string,role:string|undefined,target:string)=>
   name.split('.').at(-1)===target && (kind==='function'||role==='callback'||kind==='variable');
 const targetSet=new Set(actionTargets);
 for(const node of graph.nodes){
   if(!/\.[mc]?[jt]sx?$/i.test(node.path))continue;
   const raw=taskLoader(node.path);if(raw===null)continue;
   if(![...targetSet].some(t=>raw.includes(t)))continue;
   const analysis=analyzeSource(node.path,raw,{forceReactSplit:true});
   for(const segment of analysis.segments){
     for(const target of targetSet){
       if(isTargetDefinition(segment.name,segment.kind,segment.role,target)){
         if(!definitions.has(target))definitions.set(target,new Set());
         definitions.get(target)!.add(node.path);
       }
     }
   }
 }
 for(const call of coverage.callsites){
   const paths=definitions.get(call.target);
   if(paths?.size){
     const definition=manifest.entries.find(entry=>paths.has(entry.path) && (
       entry.mode==='full'||(entry.segments||[]).some(seg=>seg.mode==='full'&&seg.bytesAfter>0&&
         isTargetDefinition(seg.name,seg.kind,undefined,call.target))
     ));
     call.actionDefinitionPreserved=!!definition;
     call.definitionStatus=definition?'preserved':'omitted';
     if(definition)call.definitionFile=definition.path;
   }
   // A UI caller can be present even if the action definition could not be
   // established; never count such a path as having all three evidence stages.
   call.threeStageEvidence=call.included&&call.actionDefinitionPreserved===true;
   if(call.threeStageEvidence)coverage.threeStageEvidence++;
   if(call.actionDefinitionPreserved===null)coverage.unverifiedDefinitions++;
 }
 // A Flutter Command constructor can be invisible to a structural lexer
 // even when its named target body is retained. Emit a tiny exact source
 // witness for the already-validated Command binding (never a guessed edge).
 let commandWitnesses=0;
 for(const bridge of manifest.frameworkBridgeCoverage?.items||[]){
  if(commandWitnesses>=4||bridge.kind!=='flutter-command-dispatch'||bridge.mode!=='body-preserved')continue;
  if(!manifest.entries.some(e=>e.path===bridge.from)||!manifest.entries.some(e=>e.path===bridge.to))continue;
  const code=taskLoader(bridge.to);if(code===null)continue;
  const command=bridge.caller.match(/^onPressed:([A-Za-z_]\w*)\.execute$/)?.[1];
  const method=bridge.target.split('.').at(-1);if(!command||!method)continue;
  const assignment=new RegExp('\\b'+command+'\\s*=\\s*Command[01]\\s*\\(\\s*'+method+'\\s*\\)\\s*;','g');
  const found=[...code.matchAll(assignment)];if(found.length!==1)continue;
  const exact=found[0]![0];
  if(content.includes(exact))continue;
  const location=code.slice(0,found[0]!.index!).split('\n').length;
  const snippet=sanitize(exact).value;
  if(snippet!==exact)continue; // Do not append secrets or altered evidence.
  const section=`\n### Verified framework-command binding [source excerpt]\n\n${JSON.stringify(bridge.to)}:${location}\n\n${fenced(snippet)}\n`;
  if(Buffer.byteLength(content+section)+400>effectiveLimit)continue;
  content+=section;commandWitnesses++;
 }
 // Modern C# primary constructors and expression-bodied HTTP actions can
 // fall back to a structural lexer and lose the action body even when the
 // MediatR target Handler is retained. Emit ONLY the checked action signature
 // and exact source body, not unrelated sibling routes in the controller.
 let mediatorWitnesses=0;
 for(const bridge of manifest.frameworkBridgeCoverage?.items||[]){
  if(mediatorWitnesses>=4||bridge.kind!=='mediator-request-handler'||bridge.mode!=='body-preserved')continue;
  if(!manifest.entries.some(e=>e.path===bridge.from))continue;
  const code=taskLoader(bridge.from);if(code===null)continue;
  const action=bridge.caller.match(/^([A-Za-z_]\w*):mediator\.Send\(([A-Za-z_]\w*)\)$/);
  if(!action)continue;
  // Attach an HTTP attribute to this *specific* method, then stop at the
  // expression terminator. This cannot collect a later sibling action.
  const re=new RegExp('\\[Http(?:Get|Post|Put|Delete|Patch)\\b[^\\]]*\\][^;{}]{0,600}?\\b'+action[1]+'\\s*\\([\\s\\S]{0,450}?\\)\\s*=>[^;{}]{0,900};','g');
  const matches=[...code.matchAll(re)].filter(m=>new RegExp('\\bmediator\\s*\\.\\s*Send\\s*\\(\\s*'+action[2]+'\\s*[,)]').test(m[0]));
  if(matches.length!==1)continue;
  const exact=matches[0]![0];if(content.includes(exact))continue;
  const safe=sanitize(exact).value;if(safe!==exact)continue;
  const line=code.slice(0,matches[0]!.index!).split('\n').length;
  const section=`\n### Verified HTTP action → Mediator dispatch [source excerpt]\n\n${JSON.stringify(bridge.from)}:${line}\n\n${fenced(exact)}\n`;
  if(Buffer.byteLength(content+section)+400>effectiveLimit)continue;
  content+=section;mediatorWitnesses++;
 }
 // Reconcile each SCIP navigation link against EXACT retained source; links
 // never count as a proven runtime call, regardless of body-preservation.
 for(const item of manifest.scip?.items||[]){
   const entry=manifest.entries.find(e=>e.path===item.to);
   if(!entry)continue;
   item.mode='target-included';manifest.scip!.includedTargets++;
   const raw=taskLoader(item.to);if(raw===null)continue;
   const name=item.symbol;
   const segments=entry.segments||[];
   const body=segments.some(seg=>seg.kind==='function'&&seg.mode==='full'&&
     (seg.name===name||seg.name.endsWith('.'+name))&&
     typeof seg.startOffset==='number'&&typeof seg.endOffset==='number'&&
     content.includes(raw.slice(seg.startOffset,seg.endOffset)));
   // Small full-file mode returns no segments. Require a real function AST
   // declaration instead of counting an interface/type alias as a body.
   const fullFileCallable=entry.mode==='full'&&entry.redactedLines===0&&
     parserRegistry.analyze(item.to,raw).segments.some(seg=>seg.kind==='function'&&
       (seg.name===name||seg.name.endsWith('.'+name)));
   if(body||fullFileCallable){item.mode='body-preserved';manifest.scip!.bodyPreserved++;}
 }
 // Avoid leaking skipped file contents; list paths and reasons in the local manifest only.
 const info=`\n---\n\nIncluded: ${manifest.entries.length} files. Skipped: ${manifest.skipped.length} files. Redacted lines: ${taskRedactions+manifest.entries.reduce((n,e)=>n+e.redactedLines,0)}.\nManifest: .ai/packs/current-task.manifest.json\n`;
 if(Buffer.byteLength(content+info)<=effectiveLimit)content+=info;
 // Even the task header has a budget: fail without writing an oversized pack.
 if(Buffer.byteLength(content)>effectiveLimit){
   return {status:'error',message:'Task and metadata alone exceed packer.maxOutputBytes; previous pack preserved',patterns};
 }
 manifest.outputBytes=Buffer.byteLength(content);
 manifest.estimatedTokens=tokenEstimate(content); // conservative LLM estimate; no claim of exact model tokenization
 manifest.compressionRatio=Number((manifest.entries.reduce((n,e)=>n+e.bytes,0)/Math.max(1,manifest.entries.reduce((n,e)=>n+(e.includedBytes??e.bytes),0))).toFixed(3));
 writeAtomic(output,content);
 writeAtomic(pathFor(root,'packs','dependency-graph.json'),JSON.stringify(graph,null,2)+'\n');
 writeAtomic(manifestPath,JSON.stringify(manifest,null,2)+'\n');
 return {status:'ready',message:`Native pack: ${manifest.entries.length} files, ${manifest.outputBytes} bytes, ${manifest.skipped.length} skipped`,patterns};
}
