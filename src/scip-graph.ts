/**
 * Fresh project-local SCIP symbols supplement AgentOS's navigation graph.
 * TypeScript CallExpression AST + SCIP symbol identity can establish a STATIC
 * source callsite, NOT a runtime dispatch guarantee. Ordinary SCIP references
 * remain navigation hints and never masquerade as calls.
 */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScip,scipFreshness } from './scip.js';
import type { GraphReport } from './graph.js';
const requireLocal=createRequire(import.meta.url);
const ts:any=requireLocal(join(dirname(fileURLToPath(import.meta.url)),'..','vendor','typescript.cjs'));
const hash=(s:string)=>createHash('sha256').update(Buffer.from(s,'utf8')).digest('hex');
export type SemanticReferenceEdge={
 from:string;to:string;symbolId:string;symbolName:string;
 line:number;column:number;targetLine:number;
 evidence:'scip-symbol-reference';
};
export type ScipStaticCallsite={
 from:string;to:string;symbolId:string;symbolName:string;line:number;column:number;
 evidence:'scip-symbol-and-typescript-call-ast';certainty:'static-target-only';
};
export type ScipGraphCoverage={
 status:'not-imported'|'imported';indexer?:string;
 definitions:number;references:number;freshDefinitions:number;staleDocuments:number;
 ambiguousSymbols:number;crossFileReferences:number;links:number;staticCallsites:number;limitations:string[];
};
export function enrichGraphWithScip(root:string,graph:GraphReport,loader:(path:string)=>string|null):ScipGraphCoverage{
 const limitations=['SCIP ordinary references are navigation, not executed calls',
  'TypeScript AST callsites + SCIP identity prove a static source call target, not runtime virtual/dynamic dispatch',
  'SCIP import cannot prove the index was current when originally produced',
  'Only unchanged local source documents and unique definitions are linked'];
 const s=loadScip(root);
 const coverage:ScipGraphCoverage={status:s?'imported':'not-imported',...(s?{indexer:s.indexer}:{}),
  definitions:s?.definitions.length||0,references:s?.references.length||0,freshDefinitions:0,
  staleDocuments:0,ambiguousSymbols:0,crossFileReferences:0,links:0,staticCallsites:0,limitations};
 graph.semanticReferences=[];graph.scipCallsites=[];graph.scipCoverage=coverage;
 if(!s)return coverage;
 const indexFreshness=scipFreshness(root,s);
 if(!indexFreshness.fresh){coverage.staleDocuments=indexFreshness.staleDocuments;coverage.limitations.push('SCIP invalidated because source inventory, configuration or indexed bytes changed. Regenerate index before using graph evidence.');return coverage;}
 const paths=new Set(graph.nodes.map(n=>n.path));
 const fresh=new Map<string,boolean>();
 const sources=new Map<string,string>();
 const isFresh=(p:string)=>{
  if(fresh.has(p))return fresh.get(p)!;
  const content=paths.has(p)?loader(p):null;
  const valid=content!==null&&s.documentHashes[p]!==undefined&&hash(content)===s.documentHashes[p];
  fresh.set(p,valid);if(!valid)coverage.staleDocuments++;else sources.set(p,content!);
  return valid;
 };
 const defs=new Map<string,typeof s.definitions>();
 for(const d of s.definitions){
  if(!isFresh(d.path))continue;
  coverage.freshDefinitions++;
  const existing=defs.get(d.symbolId)||[];existing.push(d);defs.set(d.symbolId,existing);
 }
 // Parse each caller ONCE. Only identifiers in an exact CallExpression callee
 // are indexed; import/type references are deliberately excluded.
 const callPositions=new Map<string,Set<string>>();
 const callsites=(p:string)=>{
   if(callPositions.has(p))return callPositions.get(p)!;
   const positions=new Set<string>();callPositions.set(p,positions);
   if(!/\.[cm]?[jt]sx?$/.test(p))return positions;
   const source=sources.get(p);if(source===undefined)return positions;
   const mode=/\.[jt]sx$/.test(p)?ts.ScriptKind.TSX:/\.[cm]?js$/.test(p)?ts.ScriptKind.JS:ts.ScriptKind.TS;
   const sf=ts.createSourceFile(p,source,ts.ScriptTarget.Latest,true,mode);
   const visit=(n:any)=>{
     if(ts.isCallExpression(n)||ts.isNewExpression(n)){
       const expr=n.expression;
       const callee=ts.isPropertyAccessExpression(expr)?expr.name:expr;
       if(ts.isIdentifier(callee)){
         const loc=sf.getLineAndCharacterOfPosition(callee.getStart(sf));
         positions.add(`${loc.line}:${loc.character}`);
       }
     }
     ts.forEachChild(n,visit);
   };
   visit(sf);return positions;
 };
 const isStaticCall=(p:string,line:number,rawColumn:number)=>{
   if(!isFresh(p))return false;
   const encoding=s.documentEncodings?.[p];
   // Unknown encodings must not be reported as AST-aligned callsites.
   if(encoding!==1&&encoding!==2&&encoding!==3)return false;
   const source=sources.get(p)!;
   const textLine=source.split(/\r?\n/)[line];if(textLine===undefined)return false;
   let column=rawColumn;
   if(encoding===1){
     const data=Buffer.from(textLine,'utf8');
     if(rawColumn>data.length)return false;
     const prefix=data.subarray(0,rawColumn).toString('utf8');
     if(Buffer.byteLength(prefix,'utf8')!==rawColumn)return false;
     column=prefix.length;
   }else if(encoding===3){
     column=[...textLine].slice(0,rawColumn).join('').length;
   }
   return callsites(p).has(`${line}:${column}`);
 };
 const seen=new Set<string>(),seenCalls=new Set<string>();
 for(const r of s.references){
  if(graph.semanticReferences.length>=10000||graph.scipCallsites.length>=10000)break;
  if(!isFresh(r.path))continue;
  const matching=defs.get(r.symbolId)||[];
  if(matching.length>1){coverage.ambiguousSymbols++;continue;}
  if(matching.length!==1)continue;
  const d=matching[0]!;
  if(d.path===r.path)continue;
  coverage.crossFileReferences++;
  const call=isStaticCall(r.path,r.line,r.column);
  const key=[r.path,d.path,r.symbolId].join('\0');
  if(!seen.has(key)){
    seen.add(key);
    graph.semanticReferences.push({from:r.path,to:d.path,symbolId:r.symbolId,symbolName:d.name,
     line:r.line+1,column:r.column,targetLine:d.startLine+1,evidence:'scip-symbol-reference'});
  }
  if(call){
    const callKey=[r.path,d.path,r.symbolId,r.line,r.column].join('\0');
    if(!seenCalls.has(callKey)){
      seenCalls.add(callKey);
      graph.scipCallsites.push({from:r.path,to:d.path,symbolId:r.symbolId,symbolName:d.name,
       line:r.line+1,column:r.column,evidence:'scip-symbol-and-typescript-call-ast',certainty:'static-target-only'});
    }
  }
 }
 graph.semanticReferences.sort((a,b)=>a.from.localeCompare(b.from)||a.to.localeCompare(b.to)||a.symbolId.localeCompare(b.symbolId));
 graph.scipCallsites.sort((a,b)=>a.from.localeCompare(b.from)||a.to.localeCompare(b.to)||a.line-b.line||a.column-b.column);
 coverage.links=graph.semanticReferences.length;coverage.staticCallsites=graph.scipCallsites.length;
 return coverage;
}
