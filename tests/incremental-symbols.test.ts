import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {buildGraph} from '../src/graph.js';

function setup(t:import('node:test').TestContext){
 const dir=mkdtempSync(join(tmpdir(),'agentos-igraph-')),file=join(dir,'dependency-cache.json');
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const build=(code:Record<string,string>)=>buildGraph(Object.keys(code),p=>code[p]??null,undefined,file);
 return {dir,file,symbolFile:join(dir,'incremental-symbol-graph.json'),build};
}
function status(report:ReturnType<typeof buildGraph>,local:string){return report.symbols?.resolutions.find(x=>x.local===local);}
function clean(code:Record<string,string>){return buildGraph(Object.keys(code),p=>code[p]??null);}

test('cold build, warm build, identical exact result, and zero recomputed files',t=>{
 const {build}=setup(t);const files={'app.ts':'import { login } from "./auth"; login();','auth.ts':'export function login(){return true}'};
 const a=build(files),b=build(files);
 assert.equal(a.incrementalSymbols?.mode,'cold');assert.equal(a.incrementalSymbols?.recomputedFiles,2);
 assert.equal(b.incrementalSymbols?.mode,'incremental');assert.equal(b.incrementalSymbols?.recomputedFiles,0);
 assert.equal(b.incrementalSymbols?.reusedFiles,2);
 assert.deepEqual(b.symbols,a.symbols);
});
test('function body-only edit is reused; metadata has no code source body',t=>{
 const {build,symbolFile}=setup(t);const data={'app.ts':'import { login } from "./auth";', 'auth.ts':'export function login(){return "SECRET_BODY_DO_NOT_PERSIST";}'};
 build(data);data['auth.ts']='export function login(){return "ANOTHER_SECRET_DO_NOT_PERSIST";}';
 const r=build(data);
 assert.equal(r.cache?.misses,1);assert.equal(r.incrementalSymbols?.recomputedFiles,0);
 assert.equal(r.symbols?.resolved,1);
 assert.doesNotMatch(readFileSync(symbolFile,'utf8'),/SECRET_BODY|ANOTHER_SECRET/);
});
test('changing exported name invalidates transitive barrel-import chain, not unrelated graph component',t=>{
 const {build}=setup(t);const data={
  'main.ts':'import {verify as check} from "./barrel";',
  'barrel.ts':'export {verify} from "./auth";',
  'auth.ts':'export function verify(){return true;}',
  'other.ts':'import {find} from "./helpers";',
  'helpers.ts':'export function find(){return 2;}'
 };
 build(data);data['auth.ts']='export function renamed(){return true;}';
 const changed=build(data);
 assert.equal(status(changed,'check')?.status,'unresolved');
 assert.equal(status(changed,'find')?.status,'resolved');
 assert.equal(changed.incrementalSymbols?.recomputedFiles,3);
 assert.equal(changed.incrementalSymbols?.reusedFiles,2);
 assert.deepEqual(changed.symbols,clean(data).symbols);
});
test('adding previously missing local module invalidates importer and resolves binding',t=>{
 const {build}=setup(t);const data:Record<string,string>={'main.ts':'import {foo as answer} from "./helper";', 'unrelated.ts':'export function bar(){}'};
 assert.equal(status(build(data),'answer')?.status,'unresolved');
 data['helper.ts']='export const foo = 42;';
 const next=build(data);
 assert.equal(status(next,'answer')?.status,'resolved');
 assert.equal(next.incrementalSymbols?.reusedFiles,1);
 assert.ok((next.incrementalSymbols?.changedEdges||0)>0);
 assert.deepEqual(next.symbols,clean(data).symbols);
});
test('removing a module invalidates prior importers; removed symbol not retained',t=>{
 const {build}=setup(t);const data:Record<string,string>={'main.ts':'import {secret as x} from "./auth";','auth.ts':'export const secret=1;','other.ts':'export const test=3;'};
 assert.equal(status(build(data),'x')?.status,'resolved');delete data['auth.ts'];
 const r=build(data);assert.equal(status(r,'x')?.status,'unresolved');assert.equal(r.incrementalSymbols?.removedFiles,1);
 assert.equal(r.incrementalSymbols?.reusedFiles,1);assert.deepEqual(r.symbols,clean(data).symbols);
});
test('changing imported binding invalidates only source and reverse dependents',t=>{
 const {build}=setup(t);const data={
  'main.ts':'import {x} from "./barrel";', 'barrel.ts':'export {x} from "./target";',
  'target.ts':'export const x=1; export const y=2;', 'other.ts':'export const foo=5;'
 };
 build(data);data['main.ts']='import {y} from "./barrel";';
 const r=build(data);assert.equal(status(r,'y')?.status,'unresolved');
 assert.equal(r.incrementalSymbols?.recomputedFiles,1);assert.deepEqual(r.symbols,clean(data).symbols);
});
test('corrupt cache and invalid schema safely fall back to cold resolution',t=>{
 const {build,symbolFile}=setup(t);const data={'main.ts':'import {x} from "./auth";', 'auth.ts':'export const x=1;'};
 build(data);writeFileSync(symbolFile,'{"schema":100}');
 const r=build(data);assert.equal(r.incrementalSymbols?.mode,'cold');assert.equal(r.symbols?.resolved,1);
 writeFileSync(symbolFile,'{broken json');
 assert.equal(build(data).incrementalSymbols?.mode,'cold');
});
test('cached resolutions are discarded for import topology changes and cyclic graphs',t=>{
 const {build}=setup(t);const data={
  'app.ts':'import {x as z} from "./barrel";',
  'barrel.ts':'export {x} from "./target";',
  'target.ts':'export const x=1;','extra.ts':'export const x=2;'
 };
 assert.equal(status(build(data),'z')?.status,'resolved');
 data['barrel.ts']='export * from "./target"; export * from "./extra";';
 const r=build(data);assert.equal(status(r,'z')?.status,'ambiguous');assert.deepEqual(r.symbols,clean(data).symbols);
 data['extra.ts']='export {x} from "./barrel";';
 const v=build(data);assert.equal(status(v,'z')?.status,'resolved');assert.deepEqual(v.symbols,clean(data).symbols);
});
