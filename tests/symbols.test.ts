import assert from 'node:assert/strict';
import { mkdtempSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {test} from 'node:test';
import {buildGraph,selectGraphContext} from '../src/graph.js';
import {analyzeTree, initializeTreeSitter, treeSitterStatus} from '../src/treesitter.js';
import {parserRegistry} from '../src/smart.js';

const graph=(data:Record<string,string>)=>buildGraph(Object.keys(data),p=>data[p]??null);
const get=(data:Record<string,string>,local:string)=>graph(data).symbols?.resolutions.find(r=>r.local===local);

test('AST resolves named and aliased imports to original declarations',()=>{
 const r=get({'src/main.ts':'import { verify as guard } from "./security"; guard();','src/security.ts':'export function verify(token:string){return !!token;}'},'guard');
 assert.deepEqual(r?.definition,{path:'src/security.ts',symbol:'verify'});assert.equal(r?.certainty,'ast');assert.equal(r?.status,'resolved');
});
test('default import with named declaration resolves through AST',()=>{
 const r=get({'src/main.ts':'import Guard from "./guard"; new Guard();','src/guard.ts':'export default class Guard {}'},'Guard');
 assert.deepEqual(r?.definition,{path:'src/guard.ts',symbol:'Guard'});
});
test('named re-export and alias through barrel resolve original file',()=>{
 const r=get({'src/main.ts':'import { authenticate as guard } from "./index";','src/index.ts':'export {verify as authenticate} from "./security";','src/security.ts':'export const verify=(x:string)=>true'},'guard');
 assert.deepEqual(r?.definition,{path:'src/security.ts',symbol:'verify'});assert.deepEqual(r?.via,['src/index.ts','src/security.ts']);
});
test('export star follows chain; never selects a default through star',()=>{
 const data={'src/main.ts':'import { verify as v } from "./index";','src/index.ts':'export * from "./lib";','src/lib.ts':'export const verify=()=>true;'};
 assert.deepEqual(get(data,'v')?.definition,{path:'src/lib.ts',symbol:'verify'});
});
test('cyclic reexport is unresolved, never infinite',()=>{
 const r=get({'a.ts':'import {foo as bar} from "./b"; export {bar as foo};','b.ts':'export {foo} from "./a";','c.ts':'import {foo as x} from "./a";'},'x');
 assert.equal(r?.status,'unresolved');
});
test('conflicting star reexports reported as ambiguous',()=>{
 const r=get({'main.ts':'import {verify as x} from "./barrel";','barrel.ts':'export * from "./a"; export * from "./b";','a.ts':'export const verify=1;','b.ts':'export const verify=2;'},'x');
 assert.equal(r?.status,'ambiguous');assert.equal(r?.candidates?.length,2);
});
test('namespace import explicitly unsupported instead of false-positive resolution',()=>{
 const r=get({'main.ts':'import * as security from "./lib"; security.verify();','lib.ts':'export const verify=()=>true'},'security');
 assert.equal(r?.status,'unsupported');
});
test('cannot resolve unknown external package as local definition',()=>{
 const r=get({'main.ts':'import {anything as x} from "vendor-package";'},'x');
 assert.equal(r?.status,'unresolved');
});
test('Python from-import alias conservatively resolves to definition with heuristic certainty',()=>{
 const r=get({'app.py':'from auth import verify as check\ncheck()', 'auth.py':'def verify(x):\n    return True'},'check');
 assert.deepEqual(r?.definition,{path:'auth.py',symbol:'verify'});assert.equal(r?.certainty,'heuristic');
});
test('symbol closure brings original definition into pack even through long barrel chain',()=>{
 const files={'src/main.ts':'import {verify} from "./one"; verify();','src/one.ts':'export {verify} from "./two"','src/two.ts':'export {verify} from "./three"','src/three.ts':'export {verify} from "./four"','src/four.ts':'export const verify=(v:string)=>true;'};
 const g=graph(files);
 const sel=selectGraphContext(g,'fix verify',['src/main.ts'],2,20);
 const impl=sel.find(r=>r.path==='src/four.ts');
 assert.deepEqual(impl?.symbols,['verify']);assert.equal(impl?.relation,'definition');
});
test('incremental cache stores binding metadata but does not contain the source body',()=>{
 const folder=mkdtempSync(join(tmpdir(),'agentos-bindings-')),file=join(folder,'cache.json');
 try{
  const code={'main.ts':'import {verify as x} from \"./auth\";','auth.ts':'export function verify(){return \"SENSITIVE_LITERAL_DO_NOT_CACHE\"}'};
  buildGraph(Object.keys(code),p=>code[p as keyof typeof code]??null,undefined,file);
  const first=readFileSync(file,'utf8');assert.doesNotMatch(first,/SENSITIVE_LITERAL_DO_NOT_CACHE/);
  const updated=buildGraph(Object.keys(code),p=>code[p as keyof typeof code]??null,undefined,file);
  assert.equal(updated.cache?.hits,2);
  assert.equal(updated.symbols?.resolved,1);
 }finally{rmSync(folder,{recursive:true,force:true});}
});
test('WASM runtime reports the installed state, rather than assuming it is always missing',async()=>{
 const status=await initializeTreeSitter();
 const python=parserRegistry.describe().find(x=>x.extensions.includes('.py'));
 assert.deepEqual(status,treeSitterStatus());
 assert.equal(python?.quality,status.grammars.includes('python')?'ast':'structural');
 if(status.enabled)assert.equal(status.runtime,'ready');
 else assert.ok(status.runtime==='missing'||status.runtime==='invalid');
});
test('Tree-sitter AST node walk extracts a real typed declaration with offsets and safe refs',()=>{
 const source='def login(token):\n    return verify(token)\n';
 const noFields=(type:string,startIndex:number,endIndex:number,children:any[]=[])=>({type,startIndex,endIndex,startPosition:{row:0},endPosition:{row:1},namedChildren:children,childForFieldName:(key:string)=>key==='name'?children[0]:key==='body'?children[1]:null});
 const name=noFields('identifier',4,9),body=noFields('block',18,source.length,[noFields('identifier',29,35)]);
 const func=noFields('function_definition',0,source.length,[name,body]);
 const root=noFields('module',0,source.length,[func]);
 const analysis=analyzeTree(root,'a.py',source);
 assert.equal(analysis.parser,'tree-sitter-wasm');assert.equal(analysis.segments[0].name,'login');assert.match(analysis.segments[0].body,/return verify/);
});
