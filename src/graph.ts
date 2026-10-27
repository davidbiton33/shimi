/** Bounded, deterministic, offline project-wide module graph. */
import { posix as path } from 'node:path';
import { adapterFor, analyzeLanguage, type LanguageAnalysis } from './languages.js';
import { queryTerms, taskKeywords, taskSpecificApiMember } from './smart.js';
import { cacheLookup, loadCache, saveCache } from './cache.js';
import { type SymbolReport } from './symbols.js';
import { resolveSymbolsIncremental, type IncrementalStats } from './incremental-symbols.js';
import { dirname, join } from 'node:path';
import type { SemanticReferenceEdge, ScipStaticCallsite, ScipGraphCoverage } from './scip-graph.js';
export type GraphNode={path:string;language:string;parser:string;symbols:string[];namespace?:string};
export type GraphEdge={from:string;to:string;specifier:string;symbols:string[];certainty:'ast'|'heuristic'};
export type GraphReport={version:1;semanticReferences?:SemanticReferenceEdge[];scipCallsites?:ScipStaticCallsite[];scipCoverage?:ScipGraphCoverage;cache?:{hits:number;misses:number;removed:number;stored:boolean};incrementalSymbols?:IncrementalStats;nodes:GraphNode[];edges:GraphEdge[];unresolved:{from:string;specifier:string}[];scannedFiles:number;skippedForGraph:number;truncated:boolean;limits:{maxFiles:number;maxBytes:number};symbols?:SymbolReport;};
export type GraphSelection={path:string;distance:number;relation:'anchor'|'dependency'|'dependent'|'definition'|'semantic-definition'|'semantic-callsite';via:string|null;symbols:string[]};
const extensions=['.ts','.tsx','.js','.jsx','.mts','.cts','.mjs','.cjs','.py','.pyi','.go','.java','.cs','.rs','.rb','.php','.c','.cc','.cpp','.cxx','.h','.hpp','.hxx','.kt','.kts','.dart'];
const names=(base:string)=>[base,...extensions.map(x=>base+x),...extensions.map(x=>path.join(base,'index'+x)),path.join(base,'__init__.py'),path.join(base,'mod.rs')];
const firstMatch=(candidate:string,files:Set<string>):string|undefined=>{
 const normalized=path.normalize(candidate);
 const variants=[normalized];
 // Transpiled JS imports generally point at .js even when the source is .ts.
 if(/\.[cm]?js$/.test(normalized))variants.push(normalized.replace(/\.[cm]?js$/,'.ts'),normalized.replace(/\.[cm]?js$/,'.tsx'),normalized.replace(/\.[cm]?js$/,'.mts'),normalized.replace(/\.[cm]?js$/,'.cts'));
 return variants.flatMap(v=>names(v)).find(n=>files.has(n));
};
const strip=(s:string,prefix:string)=>s.startsWith(prefix)?s.slice(prefix.length):s;
function resolveImport(from:string,spec:string,info:LanguageAnalysis,files:Set<string>,namespaces:Map<string,string[]>,goModule:string,infos:Map<string,LanguageAnalysis>):string|undefined{
 const folder=path.dirname(from);
 if(info.language==='TypeScript'||info.language==='JavaScript'||info.language==='Ruby'||info.language==='PHP'||info.language==='C'||info.language==='C++'||info.language==='Dart'){
   if(spec.startsWith('package:')){
     const seg=spec.split('/').slice(1);return firstMatch(path.join('lib',...seg),files);
   }
   // Dart relative imports omit './' (import 'pricing.dart';). Only explicit
   // dart:/package: URIs are external; ordinary URIs stay local to the file.
   if(info.language==='Dart' && !spec.startsWith('.') && !spec.startsWith('dart:') && !spec.includes(':'))return firstMatch(path.join(folder,spec),files);
   if(!spec.startsWith('.'))return undefined;
   return firstMatch(path.join(folder,spec),files);
 }
 if(info.language==='Python'){
   // Dots: '.foo' is sibling, '..foo' is a parent package; absolute searches root/src.
   const dots=spec.match(/^\.+/)?.[0].length||0;
   let base=dots?folder:'';
   for(let i=1;i<dots;i++)base=path.dirname(base);
   const mod=strip(spec,'.'.repeat(dots)).replace(/\./g,'/');
   const tries=dots?[path.join(base,mod)]:[mod,path.join('src',mod)];
   for(const t of tries){const hit=firstMatch(t,files);if(hit)return hit;}
   return undefined;
 }
 if(info.language==='Go'){
   const clean=goModule && (spec===goModule || spec.startsWith(goModule+'/')) ? strip(strip(spec,goModule),'/') : '';
   if(!clean)return undefined;
   const dir=clean;
   const inPackage=[...files].filter(f=>path.dirname(f)===dir && f.endsWith('.go')).sort();
   return inPackage[0];
 }
 if(info.language==='Java'||info.language==='Kotlin'||info.language==='C#'){
   if(info.language==='C#'){
     const hits=namespaces.get(spec)||[];return hits.find(h=>h!==from);
   }
   const candidate=spec.replace(/\.\*$/,'').replace(/\./g,'/');
   for(const base of ['', 'src/main/java/','src/main/kotlin/','src/']){
     const hit=firstMatch(path.join(base,candidate),files);if(hit)return hit;
     // Java import com.example.Auth typically points at Class.java, but
     // wildcard imports point to packages, requiring cautious fallback.
     if(spec.endsWith('.*')){
       const inPackage=[...files].filter(f=>path.dirname(f)===path.join(base,candidate)).sort();
       if(inPackage.length===1)return inPackage[0];
     }
   }
   // Kotlin top-level declarations are imported by package + symbol rather
   // than by source filename (lab.applyDiscount might be in Pricing.kt).
   // Require a unique symbol in that exact package, never choose arbitrarily.
   if(info.language==='Kotlin'){
     const at=spec.lastIndexOf('.');
     if(at>0){
       const pkg=spec.slice(0,at),sym=spec.slice(at+1);
       if(sym!=='*'){
         const matches=(namespaces.get(pkg)||[]).filter(p=>p!==from&&
          infos.get(p)?.symbols.some(n=>n===sym||n.endsWith('.'+sym)));
         if(matches.length===1)return matches[0];
       }
     }
   }
   return undefined;
 }
 if(info.language==='Rust'){
   // `use crate::pricing::apply_discount` refers to pricing.rs, not
   // src/pricing/apply_discount.rs. Walk toward module ancestors and retain
   // the nearest file that actually exists. No external crate guessing.
   let base:string|undefined,parts:string[]=[];
   if(spec.startsWith('crate::')){base='src';parts=strip(spec,'crate::').split('::');}
   else if(spec.startsWith('self::')){base=folder;parts=strip(spec,'self::').split('::');}
   else if(spec.startsWith('super::')){base=path.dirname(folder);parts=strip(spec,'super::').split('::');}
   if(base){
     for(let len=parts.length;len>0;len--){
       const candidate=path.join(base,...parts.slice(0,len));
       const hit=firstMatch(candidate,files);
       if(hit&&hit!==from)return hit;
     }
     return undefined;
   }
   if(/^[A-Za-z_]\w*$/.test(spec))return firstMatch(path.join(folder,spec),files);
 }
 return undefined;
}
export function buildGraph(paths:string[],loader:(p:string)=>string|null,limits={maxFiles:3000,maxBytes:20_000_000},cachePath?:string):GraphReport{
 const previous=loadCache(cachePath),cacheEntries=new Map<string,{source:string;analysis:LanguageAnalysis}>();let hits=0,misses=0;
 const sorted=[...new Set(paths)].filter(p=>!!adapterFor(p)).sort();
 const infos=new Map<string,LanguageAnalysis>();let bytes=0,skipped=0;
 let goModule='';
 const go=loader('go.mod');if(go)goModule=go.match(/^module\s+(\S+)/m)?.[1]||'';
 for(const p of sorted){
   if(infos.size>=limits.maxFiles){skipped++;continue;}
   const source=loader(p);if(source===null){skipped++;continue;}
   const size=Buffer.byteLength(source);
   if(bytes+size>limits.maxBytes){skipped++;continue;}
   const cached=cacheLookup(previous,p,source);if(cached)hits++;else misses++;
   const analysis=cached||analyzeLanguage(p,source);infos.set(p,analysis);cacheEntries.set(p,{source,analysis});bytes+=size;
 }
 const available=new Set(infos.keys());
 const namespaces=new Map<string,string[]>();
 for(const [p,i] of infos)if(i.namespace){const v=namespaces.get(i.namespace)||[];v.push(p);namespaces.set(i.namespace,v);}
 const edges:GraphEdge[]=[],unresolved:GraphReport['unresolved']=[];
 for(const [p,i] of infos)for(const imp of i.links){
   const to=resolveImport(p,imp.specifier,i,available,namespaces,goModule,infos);
   let targets=to?[to]:[];
   // Package/namespace imports can refer to more than one source file.
   // Retain a deterministic capped fan-out rather than choosing arbitrarily.
   if(i.language==='Go' && goModule && imp.specifier.startsWith(goModule+'/')){
     const dir=imp.specifier.slice(goModule.length+1);
     targets=[...available].filter(f=>path.dirname(f)===dir&&f.endsWith('.go')).sort().slice(0,32);
   }
   if(i.language==='C#' && namespaces.has(imp.specifier))targets=(namespaces.get(imp.specifier)||[]).slice(0,32);
   if((i.language==='Java'||i.language==='Kotlin') && imp.specifier.endsWith('.*')){
     const dir=imp.specifier.slice(0,-2).replace(/\./g,'/');
     const expanded=[...available].filter(f=>f.includes(dir+'/')&&path.dirname(f).endsWith(dir)).sort().slice(0,32);
     if(expanded.length)targets=expanded;
   }
   targets=[...new Set(targets)].filter(t=>t!==p);
   if(targets.length)for(const target of targets)edges.push({from:p,to:target,specifier:imp.specifier,symbols:imp.symbols,certainty:imp.certainty});
   else unresolved.push({from:p,specifier:imp.specifier});
 }
 const nodes=[...infos].map(([p,i])=>({path:p,language:i.language,parser:i.parser,symbols:i.symbols,...(i.namespace?{namespace:i.namespace}:{})}));
 const symbolRecords=[...infos].map(([p,i])=>({path:p,imports:i.bindings||[],exports:i.exports||[]}));
 const removed=Object.keys(previous.files).filter(p=>!infos.has(p)).length;
 // Ensure cache directory exists before the separate symbol-cache writer runs.
 // Missing cache directories are normal for a newly initialized project.
 const stored=saveCache(cachePath,cacheEntries);
 const {symbols,incremental}=resolveSymbolsIncremental(symbolRecords,edges,cachePath?join(dirname(cachePath),'incremental-symbol-graph.json'):undefined);
 return {version:1,...(cachePath?{cache:{hits,misses,removed,stored}}:{}),nodes,edges:edges.sort((a,b)=>a.from.localeCompare(b.from)||a.to.localeCompare(b.to)),unresolved,symbols,...(cachePath?{incrementalSymbols:incremental}:{}),scannedFiles:infos.size,skippedForGraph:skipped,truncated:skipped>0,limits};
}
/** Prefer explicitly touched files, add immediate dependencies, then dependents. */
export function selectGraphContext(graph:GraphReport,task:string,anchors:Iterable<string>,depth=2,maxRelated=36):GraphSelection[]{
 const files=new Set(graph.nodes.map(n=>n.path));
 // Semantic anchors are inferred even when Git reports unrelated changes.
 // An incidental dirty file must never displace the implementation files named
 // by the task (the v0.8.3 Naya regression was Cart.tsx -> distance=2).
 const words=taskKeywords(task);
 const semanticCandidates=graph.nodes.map(node=>{
   const base=path.basename(node.path).replace(/\.[^.]+$/,'');
   const baseWords=taskKeywords(base);
   const symbolWords=taskKeywords(node.symbols.join(' '));
   const hits=[...words].filter(w=>baseWords.has(w)).length;
   const symbolHits=[...words].filter(w=>symbolWords.has(w)).length;
   const generic=/^(?:app|index|main|router|routes?|types?|constants?|config|notfoundpage)$/i.test(base)||/layout$/i.test(base);
   const admin=/(?:^|\/)admin(?:\/|[^/]*)/i.test(node.path) && !words.has('admin');
   const score=hits*25+(hits>0&&baseWords.size===1?18:0)+Math.min(symbolHits,3)*4-(generic?14:0)-(admin?28:0);
   return {path:node.path,score};
 }).filter(x=>x.score>=23).sort((a,b)=>b.score-a.score||a.path.localeCompare(b.path,'en')).slice(0,3);
 // A compiler-indexed reference from an explicitly named task path
 // disambiguates same-named declarations. Suppress competing heuristic roots
 // only for that exact symbol; never suppress an explicitly named file.
 const mentionedIdentifiers=new Set(task.match(/[A-Za-z_$][A-Za-z0-9_$]*/g)||[]);
 const scopedTargets=new Map<string,Set<string>>();
 for(const e of graph.semanticReferences||[]){
   if(!task.includes(e.from)||!mentionedIdentifiers.has(e.symbolName))continue;
   const dest=scopedTargets.get(e.symbolName)||new Set<string>();
   dest.add(e.to);scopedTargets.set(e.symbolName,dest);
 }
 const semantic=new Set(semanticCandidates.filter(x=>{
   const node=graph.nodes.find(n=>n.path===x.path);
   return !node?.symbols.some(name=>scopedTargets.has(name)&&!scopedTargets.get(name)!.has(x.path)&&!task.includes(x.path));
 }).map(x=>x.path));
 const supplied=[...anchors].filter(p=>files.has(p));
 // Explicit task paths are protected; otherwise keep dirty-file anchors only
 // when no semantic match was possible. This also preserves generic-task mode.
 const exactSymbolAnchor=(p:string)=>graph.nodes.some(n=>n.path===p&&n.symbols.some(symbol=>symbol.length>=7&&/[A-Z_]/.test(symbol)&&mentionedIdentifiers.has(symbol)));
 // Exact AST-indexed callable names named in the task are protected like
 // explicit paths; unrelated dirty files still cannot displace semantic roots.
 const initial=new Set([...supplied.filter(p=>task.includes(p)||!semantic.size||semantic.has(p)||exactSymbolAnchor(p)),...semantic]);
 const incomingCount=new Map<string,number>();
 const outgoingCount=new Map<string,number>();
 for(const e of graph.edges)outgoingCount.set(e.from,(outgoingCount.get(e.from)||0)+1);
 const broadRouter=(p:string)=>/(?:^|\/)(?:app|routes?|router|.*layout)\.[cm]?[jt]sx?$/i.test(p);
 for(const e of graph.edges)incomingCount.set(e.to,(incomingCount.get(e.to)||0)+1);
 const taskWords=taskKeywords(task);
 const directlyRelevant=(p:string)=>{
   const base=path.basename(p).replace(/\.[^.]+$/,'');
   const node=graph.nodes.find(n=>n.path===p);
   const words=taskKeywords(`${base} ${(node?.symbols||[]).join(' ')}`);
   return [...taskWords].some(w=>words.has(w));
 };
 const out=new Map<string,GraphSelection>();
 let layer=[...initial].sort();for(const p of layer)out.set(p,{path:p,distance:0,relation:'anchor',via:null,symbols:[]});
 for(let distance=1;distance<=depth && layer.length;distance++){
   const next:string[]=[];
   for(const p of layer){
     const related=[...graph.edges.filter(e=>e.from===p).map(e=>({edge:e,target:e.to,relation:'dependency' as const})),
       ...graph.edges.filter(e=>e.to===p).map(e=>({edge:e,target:e.from,relation:'dependent' as const}))]
       .sort((a,b)=>Number(a.relation==='dependent')-Number(b.relation==='dependent')||a.target.localeCompare(b.target));
     for(const item of related){
       const target=item.target;
       if(out.has(target)||out.size>=initial.size+maxRelated)continue;
       // A broad App/router/layout file is not a reason to copy every route,
       // administration screen, newsletter and cosmetic widget into a focused task.
       if(item.relation==='dependency' && (outgoingCount.get(p)||0)>8 && broadRouter(p) &&
         !directlyRelevant(target) && !initial.has(target))continue;
       // Shared hubs (types.ts, index barrels, configuration) can have dozens
       // of unrelated consumers. Do not traverse their reverse fan-out unless
       // a consumer matches the task or is an explicit anchor.
       if(item.relation==='dependent' && (incomingCount.get(p)||0)>8 &&
         !directlyRelevant(target) && !initial.has(target))continue;
       out.set(target,{path:target,distance,relation:item.relation,via:p,symbols:item.relation==='dependency'?item.edge.symbols:[]});
       next.push(target);
     }
   }
   layer=[...new Set(next)].sort();
 }
 // SCIP supplies symbol identity for references, never verified runtime call edges.
 // Only promote one-hop forward definitions from task-grounded roots; do not
 // traverse reverse references (which otherwise flood the pack with consumers).
 let semanticPromoted=0;
 // Exact AST invocation location + SCIP-resolved static target takes priority
 // over import-only links. Still no runtime dynamic dispatch guarantee.
 for(const edge of graph.scipCallsites||[]){
   if(semanticPromoted>=8||out.size>=initial.size+maxRelated)break;
   if(!initial.has(edge.from)||!files.has(edge.to)||out.has(edge.to))continue;
   if(!taskSpecificApiMember(edge.symbolName,task))continue;
   out.set(edge.to,{path:edge.to,distance:1,relation:'semantic-callsite',via:edge.from,symbols:[edge.symbolName]});
   semanticPromoted++;
 }
 for(const edge of graph.semanticReferences||[]){
   if(semanticPromoted>=12||out.size>=initial.size+maxRelated)break;
   if(!initial.has(edge.from)||!files.has(edge.to)||out.has(edge.to))continue;
   // SCIP indexes every type/property/import reference. An unfiltered expansion
   // floods a narrowly scoped task with unrelated DTOs and type-only files.
   // Require task-specific symbol evidence; the semantic ID then selects the
   // unambiguous source, but it does NOT prove execution of that source.
   if(!taskSpecificApiMember(edge.symbolName,task))continue;
   if(/(?:Interface|Props|Args|Envelope|Input|DTO|Dto)$/.test(edge.symbolName)&&!task.includes(edge.symbolName))continue;
   out.set(edge.to,{path:edge.to,distance:1,relation:'semantic-definition',via:edge.from,symbols:[edge.symbolName]});
   semanticPromoted++;
 }
 // Add definitions reached through aliases and export barrels, even when the
 // module path is more than `depth` hops away. Never promote an ambiguous match.
 for(const resolution of graph.symbols?.resolutions||[]){
   if(resolution.status!=='resolved'||!resolution.definition||!initial.has(resolution.from))continue;
   const target=resolution.definition.path;
   if(out.size>=initial.size+maxRelated&&!out.has(target))continue;
   if(target!==resolution.from&&files.has(target)){
     const prev=out.get(target);
     if(prev){prev.symbols=[...new Set([...prev.symbols,resolution.definition.symbol])].sort();}
     else out.set(target,{path:target,distance:1,relation:'definition',via:resolution.from,symbols:[resolution.definition.symbol]});
   }
 }
 return [...out.values()].sort((a,b)=>a.distance-b.distance||a.path.localeCompare(b.path));
}
