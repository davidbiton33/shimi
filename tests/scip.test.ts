import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { init } from '../src/commands.js';
import { importScip, scipStatus } from '../src/scip.js';
import { requestContext } from '../src/context-requests.js';
const v=(n:number)=>{const out=[];do{const byte=n%128;n=Math.floor(n/128);out.push(n?byte|128:byte);}while(n);return Buffer.from(out);};
const fld=(id:number,bytes:Buffer|string)=>Buffer.concat([v(id*8+2),v(Buffer.byteLength(bytes)),Buffer.from(bytes)]);
const num=(id:number,n:number)=>Buffer.concat([v(id*8),v(n)]);
const msg=(...fields:Buffer[])=>Buffer.concat(fields);
const R=(line:number,start:number,end:number)=>fld(8,msg(num(1,line),num(2,start),num(3,end)));
const old=(line:number,start:number,end:number)=>fld(1,msg(v(line),v(start),v(end)));
const symA='scip npm demo 1 src/cart.ts/calculateTotal().';
const symB='scip npm demo 1 src/tax.ts/computeTax().';
function doc(path:string, occ:Buffer[]){return fld(2,msg(fld(1,path),...occ.map(x=>fld(2,x)),num(6,2)));}
function occ(symbol:string,range:Buffer,definition:boolean){return msg(fld(2,symbol),range, ...(definition?[num(3,1)]:[]));}
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'agentos-scip-'));
 const git=(...args:string[])=>execFileSync('git',args,{cwd:root,stdio:'ignore'});
 git('init','-q');git('config','user.email','tests@example.com');git('config','user.name','Tests');
 mkdirSync(join(root,'src'));
 writeFileSync(join(root,'src','cart.ts'),"import { computeTax } from './tax.js';\nexport function calculateTotal(x: number) { return computeTax(x); }\n");
 writeFileSync(join(root,'src','tax.ts'),"export function computeTax(x: number) { return x * 1.17; }\n");
 writeFileSync(join(root,'.env'),'PASSWORD=hunter2');
 git('add','.');git('commit','-qm','first');init(root);
 const bytes=msg(
   fld(1,msg(fld(2,fld(1,'scip-typescript')),fld(3,'file://'+root))),
   doc('src/cart.ts',[
     occ(symA,R(1,16,30),true),
     occ(symB,R(1,56,66),false),
   ]),
   doc('src\\tax.ts',[occ(symB,old(0,16,26),true)]),
   doc('../escape.ts',[occ('scip fake',R(0,0,3),true)]),
   doc('src\\..\\.env',[occ('scip traversal',R(0,0,3),true)]),
   doc('C:\\secret.ts',[occ('scip drive path',R(0,0,3),true)]),
   doc('\\\\server\\share\\secret.ts',[occ('scip UNC path',R(0,0,3),true)]),
   doc('.env',[occ('scip secret',R(0,0,3),true)]),
 );
 const index=join(root,'index.scip');writeFileSync(index,bytes);
 return {root,index};
}
test('SCIP import resolves protobuf old/new ranges, definitions, references and code snippets',()=>{
 const {root,index}=fixture();try{
   assert.equal(scipStatus(root).status,'not_imported');
   const result=importScip(root,index);assert.equal(result.status,'imported');
   assert.equal(result.definitions,2);assert.equal(result.references,1);
   assert.equal(result.skipped,5);
   const found=requestContext(root,{symbol:'calculateTotal'});
   assert.equal(found.status,'ok');assert.equal(found.matches.length,1);
   assert.equal(found.matches[0].provenance,'scip-definition');
   assert.equal(found.semantic?.symbolId,symA);
   assert.match(found.matches[0].code,/computeTax\(x\)/);
   const byId=requestContext(root,{symbolId:symB});assert.equal(byId.status,'ok');
   assert.equal(byId.matches[0].path,'src/tax.ts');
   assert.equal('references' in byId.semantic! && byId.semantic.references[0]?.path,'src/cart.ts');
   assert.equal(requestContext(root,{symbolId:'no-matches'}).status,'not_found');
   assert.equal(requestContext(root,{symbol:'missing'}).status,'not_found');
 }finally{rmSync(root,{force:true,recursive:true});}
});
test('SCIP definition fails closed when source changes after import; AST remains fallback',()=>{
 const {root,index}=fixture();try{
   importScip(root,index);
   writeFileSync(join(root,'src','tax.ts'),"export function computeTax(x: number) { return x * 1.5; }\n");
   assert.equal(scipStatus(root).status,'stale');
   const exact=requestContext(root,{symbolId:symB});assert.equal(exact.status,'not_found');
   assert.match(exact.reason||'',/stale/);
   const fallback=requestContext(root,{symbol:'computeTax'});
   assert.equal(fallback.status,'ok');assert.notEqual(fallback.matches[0].provenance,'scip-definition');
   const cart=requestContext(root,{symbol:'calculateTotal'});
   assert.equal(cart.status,'ok');
 }finally{rmSync(root,{force:true,recursive:true});}
});
test('SCIP rejects wrong root, malformed index and refuses non-project files',()=>{
 const {root,index}=fixture();try{
   const original=readFileSync(index);
   writeFileSync(index,msg(fld(1,msg(fld(3,'file:///another/project')))));
   assert.throws(()=>importScip(root,index),/project root mismatch/);
   writeFileSync(index,Buffer.from([0xff]));
   assert.throws(()=>importScip(root,index),/varint|Truncated|Oversized/);
   writeFileSync(index,original);assert.equal(importScip(root,index).status,'imported');
   assert.equal(requestContext(root,{file:'.env',symbolId:'scip secret'}).status,'not_found');
 }finally{rmSync(root,{force:true,recursive:true});}
});
test('CLI exposes SCIP import and status',()=>{
 const {root,index}=fixture();try{
   const cmd=(...args:string[])=>JSON.parse(execFileSync(process.execPath,[join(process.cwd(),'dist','src','cli.js'),...args,'--cwd',root,'--json'],{encoding:'utf8'}));
   assert.equal(cmd('scip','import','--index',index).status,'imported');
   assert.equal(cmd('scip','status').status,'ready');
   assert.equal(cmd('context','--symbol-id',symA).matches[0].provenance,'scip-definition');
 }finally{rmSync(root,{force:true,recursive:true});}
});
test('SCIP enriches the main graph and pack with non-runtime semantic reference evidence',()=>{
 const {root,index}=fixture();try{
   importScip(root,index);
   const cli=join(process.cwd(),'dist','src','cli.js');
   writeFileSync(join(root,'.ai','AI_TASK.md'),'# Task\nTrace computeTax from src/cart.ts into src/tax.ts.\n');
   execFileSync(process.execPath,[cli,'pack','--cwd',root,'--json'],{encoding:'utf8'});
   const graph=JSON.parse(readFileSync(join(root,'.ai','packs','dependency-graph.json'),'utf8'));
   const manifest=JSON.parse(readFileSync(join(root,'.ai','packs','current-task.manifest.json'),'utf8'));
   assert.equal(graph.scipCoverage.status,'imported');
   assert.ok(graph.semanticReferences.some((x:any)=>x.from==='src/cart.ts'&&x.to==='src/tax.ts'&&x.symbolId===symB));
   assert.ok(graph.edges.every((e:any)=>e.certainty!=='scip')); // not a verified call
   assert.equal(manifest.scip.status,'imported');
   assert.ok(manifest.scip.navigationLinks>0);
   // Reimport and change a referenced document: stale evidence must not survive.
   writeFileSync(join(root,'src','tax.ts'),'export function computeTax(x:number) { return x*3; }\n');
   execFileSync(process.execPath,[cli,'pack','--cwd',root,'--json'],{encoding:'utf8'});
   const stale=JSON.parse(readFileSync(join(root,'.ai','packs','dependency-graph.json'),'utf8'));
   assert.equal(stale.semanticReferences.some((x:any)=>x.to==='src/tax.ts'),false);
   assert.ok(stale.scipCoverage.staleDocuments>=1);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('SCIP fails closed on build configuration changes and source-file additions',()=>{
 const {root,index}=fixture();try{
   writeFileSync(join(root,'package.json'),'{}\n');
   execFileSync('git',['add','package.json'],{cwd:root});
   importScip(root,index);
   assert.equal(scipStatus(root).status,'ready');
   writeFileSync(join(root,'package.json'),'{"type":"module"}\n');
   const status=scipStatus(root);
   assert.equal(status.status,'stale');
   if('freshness' in status)assert.ok(status.freshness?.changedConfigs.includes('package.json'));
   assert.equal(requestContext(root,{symbolId:symA}).status,'not_found');
   // Re-importing the same old SCIP bytes is NOT a semantic regeneration.
   // It resets post-import freshness; index correctness before import remains unproven.
   importScip(root,index);
   writeFileSync(join(root,'src','new-feature.ts'),'export const fresh = 1;\n');
   assert.equal(scipStatus(root).status,'stale');
   const cli=join(process.cwd(),'dist','src','cli.js');
   execFileSync(process.execPath,[cli,'pack','--cwd',root,'--json'],{encoding:'utf8'});
   const graph=JSON.parse(readFileSync(join(root,'.ai','packs','dependency-graph.json'),'utf8'));
   assert.equal(graph.semanticReferences.length,0);
   assert.match(graph.scipCoverage.limitations.join(' '),/invalidated/i);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('opt-in automatic indexer is disabled by default and fails safely if unavailable',()=>{
 const {root}=fixture();try{
   const cli=join(process.cwd(),'dist','src','cli.js');
   const cmd=(...a:string[])=>JSON.parse(execFileSync(process.execPath,[cli,...a,'--cwd',root,'--json'],{encoding:'utf8'}));
   assert.equal(cmd('scip','status').auto.enabled,false);
   assert.equal(cmd('scip','auto-enable').enabled,true);
   assert.equal(cmd('scip','status').auto.enabled,true);
   // The pack should not be broken by a missing third-party binary.
   assert.equal(cmd('pack').status,'ready');
   assert.equal(cmd('scip','status').auto.enabled,true);
   assert.equal(cmd('scip','auto-disable').enabled,false);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('CLI graph and explain reject stale cached SCIP links before a new pack',()=>{
 const {root,index}=fixture();try{
   importScip(root,index);
   const cli=join(process.cwd(),'dist','src','cli.js');
   const cmd=(...args:string[])=>JSON.parse(execFileSync(process.execPath,[cli,...args,'--cwd',root,'--json'],{encoding:'utf8'}));
   writeFileSync(join(root,'.ai','AI_TASK.md'),'# Task\nTrace computeTax from cart to tax.\n');
   cmd('pack');
   assert.ok(cmd('graph').semanticReferences.length>0);
   writeFileSync(join(root,'src','tax.ts'),'export function computeTax(x: number) { return 42; }\n');
   const staleGraph=cmd('graph');
   assert.equal(staleGraph.semanticReferences.length,0);
   assert.equal(staleGraph.packSnapshotStale,true);
   const staleManifest=cmd('explain');
   assert.equal(staleManifest.scip.status,'stale');
   assert.equal(staleManifest.packSnapshotStale,true);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('opt-in on-demand auto refresh invokes a fixed local tool (mocked; NOT official indexer)',{skip:process.platform==='win32'},()=>{
 const {root,index}=fixture();try{
   const shimdir=join(root,'shims');mkdirSync(shimdir);
   const shim=join(shimdir,'scip-typescript');
   const bytes=readFileSync(index).toString('base64');
   writeFileSync(shim,`#!/usr/bin/env node
const fs=require('fs'); const out=process.argv[process.argv.indexOf('--output')+1];
fs.writeFileSync(out,Buffer.from('${bytes}','base64'));
`);chmodSync(shim,0o755);
   const cli=join(process.cwd(),'dist','src','cli.js');
   const env={...process.env,PATH:shimdir+':'+process.env.PATH};
   const cmd=(...args:string[])=>JSON.parse(execFileSync(process.execPath,[cli,...args,'--cwd',root,'--json'],{encoding:'utf8',env}));
   assert.equal(cmd('scip','auto-enable').enabled,true);
   const answer=cmd('context','--symbol','computeTax');
   assert.equal(answer.status,'ok');assert.equal(answer.matches[0].provenance,'scip-definition');
   assert.equal(cmd('scip','status').status,'ready');
 }finally{rmSync(root,{recursive:true,force:true});}
});
