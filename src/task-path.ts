/**
 * Task-path coverage: AST-based caller discovery for strongly related user actions.
 * Deliberately bounded, deterministic and offline. This is NOT whole-program call
 * resolution; each reported path is evidence of a JSX event-to-action reference.
 */
import {analyzeSource,discoverJsxTaskCallsites,rankSegments,taskKeywords,type TaskPathCallsite} from './smart.js';
import type {GraphSelection} from './graph.js';

export type TaskPathCandidate={path:string;calls:TaskPathCallsite[];targets:string[]};
/** Discover action identifiers from relevant implementation files, not a fixed
 * shopping-cart dictionary. Generic 'item' or 'product' alone is too weak. */
export function taskActionNames(task:string,related:GraphSelection[],loader:(path:string)=>string|null):string[]{
 const terms=taskKeywords(task);const matches=new Map<string,number>();
 const seeds=related.filter(r=>r.distance<=1 && r.relation!=='dependent').slice(0,25);
 for(const seed of seeds){
   if(!/\.[mc]?[jt]sx?$/.test(seed.path))continue;
   const source=loader(seed.path);if(source===null)continue;
   const analyzed=analyzeSource(seed.path,source,{forceReactSplit:true});
   const ranked=rankSegments(analyzed,terms,false,false);
   for(const s of ranked){
     if(s.kind!=='function'||s.role==='jsx-action'||s.role==='jsx-expression')continue;
     const name=s.name.split('.').at(-1)||'';
     if(!/^[A-Za-z_$][\w$]{5,}$/.test(name))continue;
     const actionWords=taskKeywords(name);
     const matching=[...actionWords].filter(w=>terms.has(w));
     // Never extrapolate a path from generic domain nouns alone.
     if(!matching.length || matching.every(w=>['item','product','store','page','data','component','user'].includes(w)))continue;
     matches.set(name,Math.max(matches.get(name)||0,s.score+matching.length*20));
   }
 }
 return [...matches].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,18).map(([name])=>name);
}
export function findTaskPaths(paths:string[],targetNames:string[],loader:(path:string)=>string|null,limit=5):TaskPathCandidate[]{
 const targets=new Set(targetNames);
 if(!targets.size)return [];
 const candidates:TaskPathCandidate[]=[];
 for(const path of [...new Set(paths)].sort()){
   if(!/\.[jt]sx$/i.test(path)||/(?:^|\/)admin(?:\/|[^/]*)/i.test(path))continue;
   const text=loader(path);if(text===null)continue;
   const calls=discoverJsxTaskCallsites(path,text,targets);
   if(!calls.length)continue;
   candidates.push({path,calls:calls.slice(0,32),targets:[...new Set(calls.map(c=>c.target))].sort()});
 }
 return candidates.sort((a,b)=>b.targets.length-a.targets.length||b.calls.length-a.calls.length||a.path.localeCompare(b.path)).slice(0,limit);
}
