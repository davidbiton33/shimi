/**
 * Incremental symbol resolution. Reuses only results whose input metadata and
 * transitive import/export graph remain unchanged. Stores NO source bodies.
 * Cached results are advisory and a corrupt/unknown schema forces recompute.
 */
import { lstatSync, readFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { sha, writeAtomic } from './utils.js';
import { resolveSymbols, type SymbolRecord, type SymbolResolution, type SymbolReport } from './symbols.js';
import type { GraphEdge } from './graph.js';

const SCHEMA=1, MAX_BYTES=8*1024*1024, MAX_FILES=6000, MAX_EDGES=120000;
type Stored={schema:number; hashes:Record<string,string>;edges:{from:string;to:string;specifier:string}[];resolutions:SymbolResolution[]};
export type IncrementalStats={mode:'cold'|'incremental'|'fallback';recomputedFiles:number;reusedFiles:number;dirtyFiles:number;invalidatedFiles:number;removedFiles:number;changedEdges:number;stored:boolean};
function safePath(file:string):boolean{
 try { if(lstatSync(dirname(file)).isSymbolicLink())return false; }catch{return false;}
 try { if(lstatSync(file).isSymbolicLink())return false; }catch(e){ if((e as NodeJS.ErrnoException).code!=='ENOENT')return false; }
 return true;
}
function edgeKey(e:{from:string;to:string;specifier:string}){return JSON.stringify([e.from,e.to,e.specifier]);}
function readStore(file?:string):Stored|null{
 if(!file||!safePath(file))return null;
 try {
  if(statSync(file).size>MAX_BYTES)return null;
  const store=JSON.parse(readFileSync(file,'utf8')) as Stored;
  if(store.schema!==SCHEMA||!store.hashes||typeof store.hashes!=='object'||Array.isArray(store.hashes)||Object.keys(store.hashes).length>MAX_FILES||!Array.isArray(store.edges)||store.edges.length>MAX_EDGES||!Array.isArray(store.resolutions)||store.resolutions.length>50000)return null;
  for(const [p,h] of Object.entries(store.hashes))if(p==='__proto__'||p==='constructor'||!/^([0-9a-f]{64})$/.test(h))return null;
  for(const e of store.edges)if(!e||typeof e.from!=='string'||typeof e.to!=='string'||typeof e.specifier!=='string'||[e.from,e.to,e.specifier].some(s=>s.length>1000))return null;
  for(const r of store.resolutions)if(!r||typeof r.from!=='string'||!Object.hasOwn(store.hashes,r.from)||typeof r.local!=='string'||typeof r.specifier!=='string'||!['resolved','unresolved','ambiguous','unsupported'].includes(r.status))return null;
  return store;
 }catch{return null;}
}
function reverseMap(edges:Stored['edges']){
 const rev=new Map<string,Set<string>>();
 for(const e of edges){if(!rev.has(e.to))rev.set(e.to,new Set());rev.get(e.to)!.add(e.from);}
 return rev;
}
function closure(start:Set<string>,older:Stored['edges'],newer:Stored['edges']):Set<string>{
 const reverseOld=reverseMap(older),reverseNew=reverseMap(newer);
 const dirty=new Set(start),queue=[...start];
 for(let i=0;i<queue.length;i++){
  const current=queue[i];
  for(const r of [reverseOld,reverseNew])for(const dependant of r.get(current)||[]){
   if(!dirty.has(dependant)){dirty.add(dependant);queue.push(dependant);}
  }
 }
 return dirty;
}
function report(records:SymbolRecord[],resolutions:SymbolResolution[]):SymbolReport {
 resolutions.sort((a,b)=>a.from.localeCompare(b.from)||a.local.localeCompare(b.local)||a.specifier.localeCompare(b.specifier));
 const totalImports=records.reduce((n,r)=>n+r.imports.length,0);
 const MAX_REPORTED=2400;
 const limited=resolutions.slice(0,MAX_REPORTED);
 return {version:1,totalImports,resolved:limited.filter(r=>r.status==='resolved').length,unresolved:limited.filter(r=>r.status==='unresolved').length,ambiguous:limited.filter(r=>r.status==='ambiguous').length,unsupported:limited.filter(r=>r.status==='unsupported').length,truncated:totalImports>MAX_REPORTED,maxReported:MAX_REPORTED,resolutions:limited};
}
export function resolveSymbolsIncremental(records:SymbolRecord[],edges:GraphEdge[],file?:string):{symbols:SymbolReport;incremental:IncrementalStats}{
 const previous=readStore(file);
 const hashes:Record<string,string>=Object.create(null);
 for(const r of records)hashes[r.path]=sha(JSON.stringify({imports:r.imports,exports:r.exports}));
 const inputEdges=edges.map(({from,to,specifier})=>({from,to,specifier})).sort((a,b)=>edgeKey(a).localeCompare(edgeKey(b)));
 const currentPaths=new Set(records.map(r=>r.path));
 const newKeys=new Set(inputEdges.map(edgeKey)), oldKeys=new Set(previous?.edges.map(edgeKey)||[]);
 const changedEdges=new Set([...newKeys].filter(k=>!oldKeys.has(k)).concat([...oldKeys].filter(k=>!newKeys.has(k))));
 const modified=new Set(records.filter(r=>previous?.hashes[r.path]!==hashes[r.path]).map(r=>r.path));
 const removed=previous?Object.keys(previous.hashes).filter(p=>!currentPaths.has(p)):[];
 const changes=new Set([...modified,...removed]);
 const oldEdgeIndex=new Map((previous?.edges||[]).map(e=>[edgeKey(e),e]));
 const newEdgeIndex=new Map(inputEdges.map(e=>[edgeKey(e),e]));
 for(const key of changedEdges){const edge=oldEdgeIndex.get(key)||newEdgeIndex.get(key)!;changes.add(edge.from);changes.add(edge.to);}
 const invalidated=previous?closure(changes,previous.edges,inputEdges):new Set(currentPaths);
 const invalidCurrent=new Set([...invalidated].filter(p=>currentPaths.has(p)));
 const reused=new Set<string>();
 const validResults:SymbolResolution[]=[];
 if(previous)for(const p of currentPaths){if(!invalidCurrent.has(p))reused.add(p);}
 if(previous)for(const r of previous.resolutions)if(reused.has(r.from))validResults.push(r);
 // Do not silently cache a truncated resolver report: if the project exceeds
 // its supported symbol budget, recompute deterministically using base resolver.
 const totalImports=records.reduce((n,r)=>n+r.imports.length,0);
 let mode:IncrementalStats['mode']=previous?'incremental':'cold';
 if(totalImports>2400){reused.clear();validResults.length=0;invalidCurrent.clear();for(const p of currentPaths)invalidCurrent.add(p);mode='fallback';}
 const subset=resolveSymbols(records,edges,invalidCurrent);
 const combined=report(records,[...validResults,...subset.resolutions]);
 let stored=false;
 if(file&&safePath(file)&&records.length<=MAX_FILES&&inputEdges.length<=MAX_EDGES&&!combined.truncated){
  const snapshot:Stored={schema:SCHEMA,hashes,edges:inputEdges,resolutions:combined.resolutions};
  const serial=JSON.stringify(snapshot);
  if(Buffer.byteLength(serial)<MAX_BYTES){try{writeAtomic(file,serial+'\n');stored=true;}catch{/* valid result, cache optional */}}
 }
 return {symbols:combined,incremental:{mode,recomputedFiles:invalidCurrent.size,reusedFiles:reused.size,dirtyFiles:modified.size,invalidatedFiles:invalidated.size,removedFiles:removed.length,changedEdges:changedEdges.size,stored}};
}
