/**
 * Import/export binding model and conservative project-wide symbol resolution.
 * Resolves explicit local exports, aliases, defaults and re-export chains.
 * Never claims to resolve dynamic imports, reflection, method dispatch, or type identity.
 */
import type { GraphEdge } from './graph.js';
export type BoundImport={specifier:string;local:string;imported:string;kind:'named'|'default'|'namespace';certainty:'ast'|'heuristic'};
export type BoundExport={name:string;local?:string;from?:string;imported?:string;star?:boolean;certainty:'ast'|'heuristic'};
export type SymbolRecord={path:string;imports:BoundImport[];exports:BoundExport[]};
export type SymbolResolution={from:string;local:string;imported:string;specifier:string;status:'resolved'|'unresolved'|'ambiguous'|'unsupported';definition?:{path:string;symbol:string};candidates?:{path:string;symbol:string}[];certainty:'ast'|'heuristic';reason?:string;via:string[]};
export type SymbolReport={version:1;totalImports:number;resolved:number;unresolved:number;ambiguous:number;unsupported:number;truncated:boolean;maxReported:number;resolutions:SymbolResolution[]};
const limit=48, MAX_REPORTED=2400, MAX_VISITS=1200;
const key=(path:string,symbol:string)=>`${path}\0${symbol}`;
const unique=<T>(values:T[],identity:(v:T)=>string):T[]=>[...new Map(values.map(v=>[identity(v),v])).values()];
export function resolveSymbols(records:SymbolRecord[],edges:GraphEdge[],onlyFrom?:ReadonlySet<string>):SymbolReport{
 const index=new Map(records.map(record=>[record.path,record]));
 const edgeIndex=new Map<string,string[]>();
 for(const edge of edges){const k=`${edge.from}\0${edge.specifier}`,arr=edgeIndex.get(k)||[];arr.push(edge.to);edgeIndex.set(k,arr);}
 const targets=(p:string,spec:string):string[]=>[...new Set(edgeIndex.get(`${p}\0${spec}`)||[])].sort();
 type Candidate={path:string;symbol:string;certainty:'ast'|'heuristic';via:string[]};
 const find=(file:string,name:string,stack:Set<string>,depth:number,remaining:{visits:number}):Candidate[]=>{
  if(--remaining.visits<0||depth>limit||stack.has(key(file,name)))return [];
  const doc=index.get(file);if(!doc)return [];
  const next=new Set(stack);next.add(key(file,name));
  const results:Candidate[]=[];
  const named=doc.exports.filter(x=>!x.star&&x.name===name);
  const exports=named.length?named:doc.exports.filter(x=>x.star&&name!=='default');
  for(const exp of exports){
    if(exp.from){
      for(const to of targets(file,exp.from)){
        const imported=exp.star?name:(exp.imported||exp.local||exp.name);
        for(const value of find(to,imported,next,depth+1,remaining))results.push({...value,certainty:exp.certainty==='ast'?value.certainty:'heuristic',via:[file,...value.via]});
      }
    }else if(exp.local){
      const binding=doc.imports.filter(b=>b.local===exp.local);
      if(binding.length){
        for(const b of binding){
          if(b.kind==='namespace')continue;
          for(const to of targets(file,b.specifier))for(const value of find(to,b.imported,next,depth+1,remaining))results.push({...value,certainty:b.certainty==='ast'&&value.certainty==='ast'&&exp.certainty==='ast'?'ast':'heuristic',via:[file,...value.via]});
        }
      }else{
        results.push({path:file,symbol:exp.local,certainty:exp.certainty,via:[file]});
      }
    }
  }
  return unique(results,v=>key(v.path,v.symbol)).slice(0,limit);
 };
 const resolutions:SymbolResolution[]=[];let totalImports=0;
 for(const doc of records)if(!onlyFrom||onlyFrom.has(doc.path))for(const binding of doc.imports){
   totalImports++;if(resolutions.length>=MAX_REPORTED)continue;
   const base={from:doc.path,local:binding.local,imported:binding.imported,specifier:binding.specifier,certainty:binding.certainty,via:[] as string[]};
   if(binding.kind==='namespace'){
     resolutions.push({...base,status:'unsupported',reason:'namespace-member-resolution-is-not-static'});continue;
   }
   const next=targets(doc.path,binding.specifier);
   if(!next.length){resolutions.push({...base,status:'unresolved',reason:'local-module-not-resolved'});continue;}
   const remaining={visits:MAX_VISITS};
   const candidates=unique(next.flatMap(to=>find(to,binding.imported,new Set(),0,remaining)),v=>key(v.path,v.symbol));
   if(remaining.visits<0){resolutions.push({...base,status:'unsupported',reason:'symbol-search-limit'});continue;}
   if(candidates.length===1){const c=candidates[0];resolutions.push({...base,status:'resolved',definition:{path:c.path,symbol:c.symbol},certainty:c.certainty==='ast'&&binding.certainty==='ast'?'ast':'heuristic',via:c.via});}
   else if(candidates.length>1){resolutions.push({...base,status:'ambiguous',candidates:candidates.map(c=>({path:c.path,symbol:c.symbol})),reason:'multiple-definitions'});}
   else {resolutions.push({...base,status:'unresolved',reason:'export-not-found-or-cycle'});}
 }
 resolutions.sort((a,b)=>a.from.localeCompare(b.from)||a.local.localeCompare(b.local)||a.specifier.localeCompare(b.specifier));
 return {version:1,totalImports,resolved:resolutions.filter(r=>r.status==='resolved').length,unresolved:resolutions.filter(r=>r.status==='unresolved').length,ambiguous:resolutions.filter(r=>r.status==='ambiguous').length,unsupported:resolutions.filter(r=>r.status==='unsupported').length,truncated:totalImports>MAX_REPORTED,maxReported:MAX_REPORTED,resolutions};
}
