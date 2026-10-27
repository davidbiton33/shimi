import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { analyzeStructured, maskSource, supportsStructure } from '../src/structural.js';
import { buildGraph } from '../src/graph.js';
import { makeSmartSnippet } from '../src/smart.js';
import { init, pack, start, end } from '../src/commands.js';

const bulk='    const noise = "'+ 'z'.repeat(1300)+'";\n';
const smart=(path:string,text:string,task:string,focusSymbols:string[]=[])=>makeSmartSnippet(path,text,task,{budgetBytes:20_000,minScore:30,alwaysFull:false,changed:false,explicitPath:false,focusSymbols});
const python=`class AuthService:\n    def login(self, user):\n        return verify(user)\n\n    def logout(self):\n        return "other" + "x" * 1700\n\ndef helper(x):\n    return x\n`;

test('python indentation parser extracts class + methods + top-level symbols with exact source spans',()=>{
 const a=analyzeStructured('pkg/auth.py',python);
 assert.equal(a.parser,'structural-lexer');assert.equal(a.diagnostics,0);
 assert.deepEqual(a.segments.map(s=>s.name),['AuthService','AuthService.login','AuthService.logout','helper']);
 assert.match(a.segments.find(s=>s.name==='AuthService.login')!.body,/verify\(user\)/);
 assert.equal(a.segments.find(s=>s.name==='AuthService.login')!.startLine,2);
});

test('python smart context only expands login, emits outlines and keeps call closure',()=>{
 const text=python.replace("\"x\" * 1700","\""+"x".repeat(1700)+"\"")+`def verify(user):\n    return bool(user)\n`;
 const s=smart('pkg/auth.py',text,'Fix AuthService.login');
 assert.equal(s.mode,'smart');assert.equal(s.parser,'structural-lexer');
 assert.equal(s.segments.find(x=>x.name==='AuthService.login')?.mode,'full');
 assert.equal(s.segments.find(x=>x.name==='verify')?.mode,'full');
 assert.equal(s.segments.find(x=>x.name==='AuthService.logout')?.mode,'outline');
 assert.ok(s.includedBytes<s.originalBytes);
});

test('Go braced functions are bounded; braces in strings and comments ignored',()=>{
 const a=analyzeStructured('x.go',`package x\nfunc login(v string) bool {\n // fake }\n println("{ inside string }")\n return verify(v)\n}\nfunc logout() { /* } */ }`);
 assert.equal(a.diagnostics,0);assert.deepEqual(a.segments.map(s=>s.name),['login','logout']);
 assert.ok(a.segments[0].end<a.segments[1].start);
});

test('Rust functions and structs extract body ranges including multiline signatures',()=>{
 const a=analyzeStructured('lib.rs',`pub struct User { id: String }\npub async fn login(\n user: &User,\n) -> bool {\n  validate(user)\n}\npub fn other() -> bool { false }`);
 assert.equal(a.diagnostics,0);assert.deepEqual(a.segments.map(s=>s.name),['User','login','other']);
});

for(const [path,source,method] of [
 ['App.java',`public class Auth {\n public boolean login(String s) { return valid(s); }\n public boolean logout() { return false; }\n}`, 'Auth.login'],
 ['App.cs',`public class Auth {\n public bool Login(string s) { return Valid(s); }\n public bool Logout() { return false; }\n}`, 'Auth.Login'],
 ['App.kt',`class Auth {\n fun login(user: String): Boolean { return valid(user) }\n fun logout() { }\n}`, 'Auth.login'],
 ['App.dart',`class Auth {\n bool login(String s) { return valid(s); }\n bool logout() { return false; }\n}`, 'Auth.login'],
 ['App.php',`<?php\nclass Auth {\n public function login($s) { return valid($s); }\n public function logout() { return false; }\n}`, 'Auth.login'],
 ['app.cpp',`class Auth { public:\n bool login(int x) { return valid(x); }\n bool logout() { return false; }\n};`, 'Auth.login']
] as const){
 test(`${path} structural parser recognizes nested method ${method}`,()=>{
  const a=analyzeStructured(path,source);assert.equal(a.diagnostics,0);
  assert.ok(a.segments.some(s=>s.name===method),JSON.stringify(a.segments.map(s=>s.name)));
 });
}

test('Ruby simple def/end extraction conservative',()=>{
 const a=analyzeStructured('app.rb',`def login(user)\n  return verify(user)\nend\ndef logout\n  return false\nend\n`);
 assert.deepEqual(a.segments.map(s=>s.name),['login','logout']);
});

test('Python triple quote false declaration is masked, unterminated string returns diagnostics',()=>{
 const a=analyzeStructured('x.py',`"""\ndef fake():\n  return None\n"""\ndef real():\n    return 1\n`);
 assert.deepEqual(a.segments.map(s=>s.name),['real']);
 assert.ok(maskSource(`def x():\n  """ never closed`,'x.py').diagnostics>0);
});

test('brace mismatch turns compression off to avoid silently losing code',()=>{
 const broken=`func login() {\n${'longvalue'.repeat(180)}\n`;
 const s=smart('x.go',broken,'Fix login');
 assert.equal(s.mode,'full');assert.ok(s.diagnostics>0);assert.equal(s.text,broken);
});

test('unsupported language keeps original intact and never claims parsing',()=>{
 assert.equal(supportsStructure('src/foo.elm'),false);
 const raw='do not change this'.repeat(130);
 assert.equal(smart('src/foo.elm',raw,'fix foo').text,raw);
});

test('budget overflow labels omitted function body rather than hiding it',()=>{
 const text=`func login(v string) bool {\n  ${'longvalue'.repeat(1100)}\n return true\n}\n`;
 const s=makeSmartSnippet('x.go',text,'Fix login',{budgetBytes:530,minScore:30,alwaysFull:false,changed:false,explicitPath:false});
 assert.equal(s.mode,'smart');assert.equal(s.segments.find(x=>x.name==='login')?.reason,'per-file-budget');
 assert.match(s.text,/body omitted/);
});

test('incremental graph cache reports misses, hits and invalidation, avoids raw source',()=>{
 const folder=mkdtempSync(join(tmpdir(),'agentos-cache-'));
 const path=join(folder,'graph.json');
 let files:Record<string,string>={'src/app.py':'from .security import verify\n'+'x'.repeat(20),'src/security.py':'def verify(): return True'};
 try {
  const make=()=>buildGraph(Object.keys(files),p=>files[p]??null,undefined,path);
  const first=make();assert.deepEqual(first.cache,{hits:0,misses:2,removed:0,stored:true});
  const second=make();assert.deepEqual(second.cache,{hits:2,misses:0,removed:0,stored:true});
  const raw=readFileSync(path,'utf8');assert.doesNotMatch(raw,/return True/);
  files['src/security.py']='def verify(): return None';
  const third=make();assert.equal(third.cache?.hits,1);assert.equal(third.cache?.misses,1);
  files={'src/app.py':files['src/app.py']};const fourth=make();assert.equal(fourth.cache?.removed,1);
  assert.deepEqual(fourth.nodes.map(n=>n.path),['src/app.py']);
 }finally{rmSync(folder,{recursive:true,force:true});}
});

test('corrupt cache recovers deterministically without fatal errors',()=>{
 const folder=mkdtempSync(join(tmpdir(),'agentos-corrupt-'));const file=join(folder,'index.json');
 try{
  writeFileSync(file,'{junk');const g=buildGraph(['x.py'],()=>`def x():\n return True`,undefined,file);
  assert.equal(g.cache?.misses,1);assert.equal(g.nodes.length,1);assert.equal(g.cache?.stored,true);
 }finally{rmSync(folder,{recursive:true,force:true});}
});

test('cache symlink is rejected and link target remains untouched',()=>{
 const folder=mkdtempSync(join(tmpdir(),'agentos-cache-link-'));const target=join(folder,'target.json'),file=join(folder,'index.json');
 try{
  writeFileSync(target,'unchanged');symlinkSync(target,file);
  const graph=buildGraph(['x.py'],()=>`def x():\n return True`,undefined,file);
  assert.equal(graph.cache?.stored,false);
  assert.equal(readFileSync(target,'utf8'),'unchanged');
 }finally{rmSync(folder,{recursive:true,force:true});}
});

test('full pipeline produces compressed Python pack, cache survives second pack and source remains excluded',async()=>{
 const root=mkdtempSync(join(tmpdir(),'agentos-universal-e2e-'));
 const git=(...args:string[])=>execFileSync('git',args,{cwd:root,stdio:'pipe'});
 try{
  git('init','-q');git('config','user.name','Test');git('config','user.email','test@example.com');
  mkdirSync(join(root,'src'));writeFileSync(join(root,'src','auth.py'),python+`def unrelated():\n    return '${'secretvalue'.repeat(180)}'\n`);
  git('add','.');git('commit','-qm','fixture');init(root);
  writeFileSync(join(root,'.ai','AI_TASK.md'),'# Task\nFix AuthService.login failing to verify user\n');
  await start(root,false);
  const p=join(root,'.ai','packs','current-task.manifest.json');
  const manifest=JSON.parse(readFileSync(p,'utf8'));
  const entry=manifest.entries.find((e:{path:string})=>e.path==='src/auth.py');
  assert.equal(entry.parser,'structural-lexer');assert.equal(entry.mode,'smart');
  assert.equal(entry.segments.find((s:{name:string})=>s.name==='AuthService.login').mode,'full');
  const graph=JSON.parse(readFileSync(join(root,'.ai','packs','dependency-graph.json'),'utf8'));
  assert.equal(graph.cache.hits,0);assert.ok(graph.cache.misses>=1);
  assert.equal(pack(root).status,'ready');
  const graph2=JSON.parse(readFileSync(join(root,'.ai','packs','dependency-graph.json'),'utf8'));
  assert.ok(graph2.cache.hits>=1);assert.equal(graph2.cache.misses,0);
  await end(root);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('explicit file mention does not select every large unrelated method body',()=>{
 const raw=`class AuthService:\n    def login(self):\n        return validate()\n    def logout(self):\n        return '${'z'.repeat(1800)}'\n`;
 const selected=makeSmartSnippet('auth.py',raw,'Fix AuthService.login in auth.py',{budgetBytes:10000,minScore:30,alwaysFull:false,changed:false,explicitPath:true});
 assert.equal(selected.mode,'smart');
 assert.equal(selected.segments.find(x=>x.name==='AuthService.login')?.mode,'full');
 assert.equal(selected.segments.find(x=>x.name==='AuthService.logout')?.mode,'outline');
 assert.doesNotMatch(selected.text,/z{500}/);
});

test('dependency graph exposes method-qualified structural symbols for task ranking',()=>{
 const source=`class AuthService:\n    def login(self, v):\n        return v\n    def logout(self):\n        return None\n`;
 const g=buildGraph(['src/auth.py','src/misc.py'],p=>p==='src/auth.py'?source:'def misc(): pass');
 const node=g.nodes.find(x=>x.path==='src/auth.py');
 assert.ok(node?.symbols.includes('AuthService.login'));
});

test('parser registry is extendable with isolated local adapters and rejects accidental conflicts',async()=>{
 const {ParserRegistry}=await import('../src/parser.js');
 const reg=new ParserRegistry();
 reg.register({id:'custom-elm',quality:'structural',extensions:['.elm'],analyze:(path,source)=>({parser:'structural-lexer',segments:[],imports:[],exports:[],importLines:[],diagnostics:0,sourceBytes:Buffer.byteLength(source)})});
 assert.equal(reg.select('file.elm')?.id,'custom-elm');
 assert.equal(reg.analyze('test.elm','x').parser,'structural-lexer');
 assert.throws(()=>reg.register({id:'collision',quality:'ast',extensions:['.elm'],analyze:()=>({parser:'plain',segments:[],imports:[],exports:[],importLines:[],diagnostics:0,sourceBytes:0})}),/already registered/);
});
