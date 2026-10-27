import assert from 'node:assert/strict';
import {test} from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import { analyzeLanguage, adapterFor } from '../src/languages.js';
import {buildGraph,selectGraphContext} from '../src/graph.js';
import {init,pack,start,end} from '../src/commands.js';
import type { PackManifest } from '../src/pack.js';

function graphFrom(files:Record<string,string>){return buildGraph(Object.keys(files),p=>files[p]??null);}
function edge(graph:ReturnType<typeof buildGraph>,from:string,to:string){return graph.edges.find(e=>e.from===from&&e.to===to);}

test('language adapter registry covers 11 families and marks non-JS scanners as heuristic',()=>{
 const expected:{[key:string]:string}={'main.ts':'typescript-ast','app.tsx':'typescript-ast','a.py':'static-scan','b.go':'static-scan','b.java':'static-scan','b.cs':'static-scan','b.rs':'static-scan','b.rb':'static-scan','b.php':'static-scan','b.cpp':'static-scan','b.kt':'static-scan','b.dart':'static-scan'};
 for(const [file,parser] of Object.entries(expected)){assert.ok(adapterFor(file));assert.equal(analyzeLanguage(file,'').parser,parser);}
 assert.equal(adapterFor('test.md'),undefined);
});

test('JS TypeScript AST captures named imports and maps emitted .js extension to source .ts',()=>{
 const g=graphFrom({'src/app.ts':'import { verify as guard } from "./security.js"; export const x=guard();','src/security.ts':'export const verify=()=>true;'});
 assert.deepEqual(edge(g,'src/app.ts','src/security.ts')?.symbols,['verify']);
 assert.equal(edge(g,'src/app.ts','src/security.ts')?.certainty,'ast');
});

test('Python relative import, root module import and sibling dependency resolve',()=>{
 const g=graphFrom({'pkg/app.py':'from .security import verify\nimport pkg.helpers','pkg/security.py':'def verify():\n return True','pkg/helpers.py':'def work(): pass'});
 assert.ok(edge(g,'pkg/app.py','pkg/security.py'));
 assert.deepEqual(edge(g,'pkg/app.py','pkg/security.py')?.symbols,['verify']);
 assert.ok(edge(g,'pkg/app.py','pkg/helpers.py'));
});

test('Go module path resolves to internal source package',()=>{
 const files={'go.mod':'module example.com/demo\n','cmd/api/main.go':'package main\nimport "example.com/demo/internal/auth"','internal/auth/auth.go':'package auth\nfunc Verify() bool {return true}'};
 const g=graphFrom(files);assert.ok(edge(g,'cmd/api/main.go','internal/auth/auth.go'));
});

test('Java packages/imports, C# namespaces and Kotlin imports resolve',()=>{
 const g=graphFrom({
  'src/main/java/com/acme/App.java':'package com.acme;\nimport com.acme.Auth;\nclass App {}',
  'src/main/java/com/acme/Auth.java':'package com.acme;\npublic class Auth {}',
  'App.cs':'using My.Auth;\nclass Program {}',
  'Auth.cs':'namespace My.Auth;\npublic class Controller {}',
  'src/main/kotlin/com/demo/App.kt':'package com.demo\nimport com.demo.Auth\nclass App {}',
  'src/main/kotlin/com/demo/Auth.kt':'package com.demo\nclass Auth {}'
 });
 assert.ok(edge(g,'src/main/java/com/acme/App.java','src/main/java/com/acme/Auth.java'));
 assert.ok(edge(g,'App.cs','Auth.cs'));
 assert.ok(edge(g,'src/main/kotlin/com/demo/App.kt','src/main/kotlin/com/demo/Auth.kt'));
});

test('Rust mod, Ruby require_relative, PHP include, C header and Dart local URI resolve',()=>{
 const g=graphFrom({
  'src/lib.rs':'mod helpers;','src/helpers.rs':'pub fn helper() {}',
  'lib/app.rb':'require_relative "helper"','lib/helper.rb':'def helper; end',
  'site/index.php':'<?php require "helper.php";','site/helper.php':'<?php function helper() {}',
  'native/main.cpp':'#include "util.h"','native/util.h':'int add(int a, int b);',
  'lib/main.dart':"import 'package:demo/src/logic.dart';",'lib/src/logic.dart':'class Logic {}'
 });
 for(const [from,to] of [['src/lib.rs','src/helpers.rs'],['lib/app.rb','lib/helper.rb'],['site/index.php','site/helper.php'],['native/main.cpp','native/util.h'],['lib/main.dart','lib/src/logic.dart']]) assert.ok(edge(g,from,to),from+' -> '+to);
});

test('graph context ranks dependencies ahead of dependents, traverses two hops and excludes unrelated code',()=>{
 const g=graphFrom({'src/a.ts':'import {go} from "./b.js";','src/b.ts':'import {run} from "./c.js"; export const go=()=>run();','src/c.ts':'export const run=()=>true;', 'src/consumer.ts':'import "./a.js"','src/unrelated.ts':'export const unrelated=1;'});
 const selected=selectGraphContext(g,'Fix source',new Set(['src/a.ts']));
 assert.equal(selected.find(s=>s.path==='src/b.ts')?.distance,1);
 assert.equal(selected.find(s=>s.path==='src/c.ts')?.distance,2);
 assert.equal(selected.find(s=>s.path==='src/consumer.ts')?.relation,'dependent');
 assert.equal(selected.some(s=>s.path==='src/unrelated.ts'),false);
});

test('graph bounded limits are explicit and no file gets invented',()=>{
 const files=Object.fromEntries(Array.from({length:6},(_,i)=>[`src/file${i}.py`,`def f${i}(): pass`]));
 const g=buildGraph(Object.keys(files),p=>files[p]??null,{maxFiles:2,maxBytes:1024});
 assert.equal(g.nodes.length,2);assert.equal(g.skippedForGraph,4);assert.equal(g.truncated,true);
});

test('full pipeline promotes cross-file imported symbol and persists auditable local graph',async()=>{
 const root=mkdtempSync(join(tmpdir(),'agentos-polygraph-'));
 function put(p:string,value:string){mkdirSync(dirname(join(root,p)),{recursive:true});writeFileSync(join(root,p),value);}
 const git=(...args:string[])=>execFileSync('git',args,{cwd:root,stdio:'pipe'});
 try{
  git('init','-q');git('config','user.name','Test');git('config','user.email','test@example.com');
  put('src/app.ts','import { validateToken } from "./security.js";\nexport function run(){return validateToken("x")};\n');
  put('src/security.ts',`export function validateToken(token:string){return !!token}\n`+`export function irrelevant(){const filler = "${'x'.repeat(1500)}";return filler}\n`);
  put('src/unrelated.ts',`export function neverUsed(){const filler = "${'z'.repeat(1600)}";return filler}\n`);
  git('add','.');git('commit','-qm','fixture');init(root);
  put('.ai/AI_TASK.md','# Task\nFix src/app.ts routing behavior.\n');
  await start(root,false);
  const graph=JSON.parse(readFileSync(join(root,'.ai/packs/dependency-graph.json'),'utf8')) as ReturnType<typeof buildGraph>;
  assert.ok(edge(graph,'src/app.ts','src/security.ts'));
  const manifest=JSON.parse(readFileSync(join(root,'.ai/packs/current-task.manifest.json'),'utf8')) as PackManifest;
  const security=manifest.entries.find(e=>e.path==='src/security.ts');
  assert.equal(security?.graph?.relation,'dependency');
  assert.equal(security?.graph?.distance,1);
  assert.equal(security?.segments?.find(s=>s.name==='validateToken')?.mode,'full');
  assert.equal(security?.segments?.find(s=>s.name==='irrelevant')?.mode,'outline');
  assert.ok(manifest.graph && manifest.graph.edges>=1);
  assert.equal(pack(root).status,'ready');
  await end(root);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('secrets, symlinks and ignored directories never enter dependency graph',async()=>{
 const root=mkdtempSync(join(tmpdir(),'agentos-graph-security-'));
 const {symlinkSync}=await import('node:fs');const other=mkdtempSync(join(tmpdir(),'agentos-other-'));
 const git=(...args:string[])=>execFileSync('git',args,{cwd:root,stdio:'pipe'});
 try{
  git('init','-q');git('config','user.name','Test');git('config','user.email','test@example.com');
  mkdirSync(join(root,'src'));writeFileSync(join(root,'src/app.py'),'from .security import verify');
  writeFileSync(join(root,'src/security.py'),'def verify(): return True');
  writeFileSync(join(root,'.env'),'PRIVATE_TOKEN=secret-value');
  writeFileSync(join(other,'secret.py'),'def private(): return 1');
  symlinkSync(join(other,'secret.py'),join(root,'src','linked.py'));
  git('add','src/app.py','src/security.py','src/linked.py');git('commit','-qm','fixture');
  init(root);await start(root,false);
  const g=JSON.parse(readFileSync(join(root,'.ai/packs/dependency-graph.json'),'utf8')) as ReturnType<typeof buildGraph>;
  assert.ok(g.nodes.some(n=>n.path==='src/app.py'));
  assert.equal(g.nodes.some(n=>n.path==='src/linked.py'),false);
  assert.equal(g.nodes.some(n=>n.path==='.env'),false);
  await end(root);
 }finally{rmSync(root,{recursive:true,force:true});rmSync(other,{recursive:true,force:true});}
});

test('Go package import and C# namespace using expand to all local implementation files',()=>{
 const g=graphFrom({
  'go.mod':'module corp.local/demo',
  'app/main.go':'package app\nimport "corp.local/demo/auth"',
  'auth/first.go':'package auth',
  'auth/second.go':'package auth',
  'ui.cs':'using X.Services;\nclass UI {}',
  'first.cs':'namespace X.Services;\nclass One {}',
  'second.cs':'namespace X.Services;\nclass Two {}'
 });
 assert.ok(edge(g,'app/main.go','auth/first.go'));
 assert.ok(edge(g,'app/main.go','auth/second.go'));
 assert.ok(edge(g,'ui.cs','first.cs'));
 assert.ok(edge(g,'ui.cs','second.cs'));
});

test('shared types hub does not fan out into unrelated admin screens during cart work',()=>{
 const files:Record<string,string>={
  'pages/store/Cart.tsx':'import { createCheckout } from "../../src/lib/payment.js";\nimport type { Product } from "../../types.js"; export const Cart=()=>createCheckout();',
  'src/lib/payment.ts':'export function createCheckout(){return true}',
  'types.ts':'export type Product={id:string};',
 };
 for(let n=0;n<25;n++)files[`pages/admin/AdminScreen${n}.tsx`]=`import type { Product } from "../../types.js"; export const Screen${n}=()=>null;`;
 const g=graphFrom(files);
 const s=selectGraphContext(g,'Analyze the shopping cart flow',new Set(['pages/store/Cart.tsx']),2,36);
 assert.ok(s.some(e=>e.path==='pages/store/Cart.tsx'&&e.relation==='anchor'));
 assert.ok(s.some(e=>e.path==='src/lib/payment.ts'));
 assert.equal(s.some(e=>e.path.startsWith('pages/admin/')),false);
});

test('task-focused packs reserve budget for Cart.tsx even with many large admin pages',async()=>{
 const root=mkdtempSync(join(tmpdir(),'agentos-cart-ranking-'));
 const put=(p:string,value:string)=>{mkdirSync(dirname(join(root,p)),{recursive:true});writeFileSync(join(root,p),value);};
 const git=(...args:string[])=>execFileSync('git',args,{cwd:root,stdio:'pipe'});
 try{
  git('init','-q');git('config','user.name','Test');git('config','user.email','test@example.com');
  const unused='x'.repeat(12000);
  put('types.ts','export type Product = { id: string };\n');
  put('pages/store/Cart.tsx','import type {Product} from "../../types.js";\nimport {checkout} from "../../src/lib/payment.js";\nexport function Cart(){ return checkout(); }\n');
  put('src/lib/payment.ts','export function checkout(){return 1;}\n');
  for(let n=0;n<16;n++)put(`pages/admin/AdminScreen${n}.tsx`,`import type {Product} from "../../types.js";\nexport const AdminScreen${n}=()=>"${unused}";\n`);
  git('add','.');git('commit','-qm','synthetic jewelry site');init(root);
  put('.ai/AI_TASK.md','# Task\nAnalyze the shopping cart flow. Find where products are added to the cart and trace quantity updates and totals.');
  let cfg=readFileSync(join(root,'agentos.yml'),'utf8');
  cfg=cfg.replace('maxEstimatedTokens: 200000','maxEstimatedTokens: 4500').replace('maxOutputBytes: 1048576','maxOutputBytes: 20000');
  put('agentos.yml',cfg);
  await start(root,false);
  const m=JSON.parse(readFileSync(join(root,'.ai/packs/current-task.manifest.json'),'utf8')) as PackManifest;
  assert.ok(m.entries.some(x=>x.path==='pages/store/Cart.tsx'),'Cart source must be present');
  assert.equal(m.skipped.some(x=>x.path==='pages/store/Cart.tsx'),false);
  assert.ok(m.entries.some(x=>x.path==='src/lib/payment.ts'),'the payment helper must be selected');
  assert.equal(m.entries.some(x=>x.path.startsWith('pages/admin/')),false,'generic types fanout must not consume budget');
  assert.ok(m.estimatedTokens<=4500);
  await end(root);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('task semantics promote Cart even when changed files point to unrelated UI components',()=>{
 const sources:Record<string,string>={
  'pages/store/Cart.tsx':`import { CartContext } from '../../App.js'; export function Cart(){ return CartContext; }`,
  'App.tsx':`export const CartContext = {items:[]};`,
  'components/ProductCard.tsx':`export const ProductCard=({addToCart}:any)=>addToCart;`,
  'components/ProductCarousel.tsx':`export const ProductCarousel=({products}:any)=>products;`,
  'components/StoreLayout.tsx':`export const StoreLayout=()=>null;`,
  'pages/admin/AdminProducts.tsx':`export const AdminProducts=()=>null;`,
  'pages/store/NotFoundPage.tsx':`export const NotFoundPage=()=>null;`
 };
 const g=graphFrom(sources);
 const task=`# Current Task\nAnalyze the shopping cart flow in the Naya jewelry store.\nFind where products are added to the cart. Identify components managing cart state. Locate quantity updates and total price calculations. Trace relevant imports and dependencies. Identify potential bugs or inconsistencies. Do not modify source files.`;
 const s=selectGraphContext(g,task,new Set(['components/ProductCard.tsx','components/ProductCarousel.tsx','components/StoreLayout.tsx','pages/store/NotFoundPage.tsx','pages/admin/AdminProducts.tsx']));
 assert.equal(s.find(x=>x.path==='pages/store/Cart.tsx')?.relation,'anchor','Cart must be a task anchor despite unrelated Git changes');
 assert.equal(s.some(x=>x.path==='pages/store/NotFoundPage.tsx'&&x.relation==='anchor'),false,'dirty NotFound cannot crowd out task');
 assert.equal(s.some(x=>x.path==='pages/admin/AdminProducts.tsx'&&x.relation==='anchor'),false,'dirty admin page cannot crowd out shopping cart task');
});

test('generic tasks retain Git-change anchors and explicit task paths are protected',()=>{
 const g=graphFrom({'src/a.ts':'export const a=1;','src/b.ts':'export const b=1;','pages/store/Cart.tsx':'export const Cart=1;'});
 assert.equal(selectGraphContext(g,'Fix source',new Set(['src/a.ts'])).find(x=>x.path==='src/a.ts')?.relation,'anchor');
 assert.equal(selectGraphContext(g,'Inspect src/b.ts and the shopping cart',new Set(['src/b.ts'])).find(x=>x.path==='src/b.ts')?.relation,'anchor');
});
