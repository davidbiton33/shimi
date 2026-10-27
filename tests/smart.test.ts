import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeSource, exactSyntaxTokens, makeSmartSnippet, queryTerms, rankSegments, tokenEstimate } from '../src/smart.js';
import { init, pack, start, end } from '../src/commands.js';
import { parseConfig, configText, defaults } from '../src/config.js';
import type { PackManifest } from '../src/pack.js';

const junk=(n:number)=>'  const internal = '+JSON.stringify('x'.repeat(n))+';\n';
const sample=[
 'import { verify } from "./security.js";',
 'export class AuthService {',
 '  login(user: string) {',
 '    const isValid = verify(user);',
 '    return isValid;',
 '  }',
 '  logout() {',
 junk(900),
 '    return "bye";',
 '  }',
 '}',
 'export function renderDashboard(){',
 junk(1600),
 ' return true;',
 '}',
 ''].join('\n');

test('vendored TypeScript parser creates real AST nodes for TSX methods, imports and declarations',()=>{
 const code='import React from "react"; export class View { render(){return <main>Hello</main>} }';
 const a=analyzeSource('src/view.tsx',code);
 assert.equal(a.parser,'typescript-ast');assert.equal(a.diagnostics,0);
 assert.deepEqual(a.imports,['react']);
 assert.ok(a.segments.some(x=>x.name==='View.render'&&x.kind==='function'));
 assert.ok(a.exports.includes('View'));
 assert.equal(analyzeSource('README.md','# hello').parser,'plain');
});

test('smart extraction selects relevant method and outlines unrelated bodies',()=>{
 const s=makeSmartSnippet('src/auth.ts',sample,'Fix AuthService.login failing to verify user',{
   budgetBytes:12000,minScore:30,alwaysFull:false,changed:false,explicitPath:false});
 assert.equal(s.mode,'smart');
 const login=s.segments.find(x=>x.name==='AuthService.login');
 assert.equal(login?.mode,'full');
 const logout=s.segments.find(x=>x.name==='AuthService.logout');
 assert.equal(logout?.mode,'outline');
 assert.doesNotMatch(s.text,/x{400}/);
 assert.match(s.text,/return isValid/);
 assert.ok(s.includedBytes<s.originalBytes);
 assert.ok(login!.startLine<logout!.startLine);
});

test('one-hop dependency closure retains called helper but not unrelated work',()=>{
 const t=`export function checkSession(value:string){return validateSession(value);}\n`+
    `function validateSession(value:string){${junk(650)}return !!value;}\n`+
    `function updateAnalytics(){${junk(700)}return true;}\n`;
 const s=makeSmartSnippet('src/session.ts',t,'Fix checkSession bug',{
   budgetBytes:20000,minScore:30,alwaysFull:false,changed:false,explicitPath:false});
 assert.equal(s.segments.find(x=>x.name==='checkSession')?.mode,'full');
 assert.equal(s.segments.find(x=>x.name==='validateSession')?.mode,'full');
 assert.equal(s.segments.find(x=>x.name==='updateAnalytics')?.mode,'outline');
});

test('malformed code fails safely to full text rather than corrupting code',()=>{
 const raw='function foo( { \n'+junk(1300);
 const s=makeSmartSnippet('src/broken.ts',raw,'Fix foo',{
  budgetBytes:10000,minScore:20,alwaysFull:false,changed:false,explicitPath:false});
 assert.equal(s.mode,'full');assert.equal(s.text,raw);assert.ok(s.diagnostics>0);
});

test('token counting is explicit: syntax count exact, LLM count only estimated',()=>{
 assert.equal(exactSyntaxTokens('a.ts','const a=1;'),5);
 assert.equal(exactSyntaxTokens('README.md','const a=1;'),null);
 assert.ok(tokenEstimate('שלום עולם')>=Buffer.byteLength('שלום עולם')/2);
 assert.deepEqual(queryTerms('Fix loginUser()'),new Set(['fix','login','user']));
});

test('v0.3 config is accepted and smart config round-trips, validates fields',()=>{
 assert.deepEqual(parseConfig(configText()),defaults);
 assert.equal(parseConfig('version: 1\npacker:\n  enabled: true').packer.smart.mode,'smart');
 assert.throws(()=>parseConfig('smart:\n  mode: whoops'),/must be smart or full/);
 assert.throws(()=>parseConfig('smart:\n  fileBudgetBytes: 10'),/fileBudgetBytes/);
});

test('full pipeline emits auditable symbol ranges and sensible compression ratios',async()=>{
 const root=mkdtempSync(join(tmpdir(),'agentos-smart-'));
 const git=(...args:string[])=>execFileSync('git',args,{cwd:root,stdio:'pipe'});
 try{
  git('init','-q');git('config','user.name','Test');git('config','user.email','test@example.com');
  mkdirSync(join(root,'src'));writeFileSync(join(root,'package.json'),'{"name":"smart", "type":"module"}');
  writeFileSync(join(root,'src','auth.ts'),sample);
  git('add','.');git('commit','-qm','fixture');
  init(root);
  writeFileSync(join(root,'.ai','AI_TASK.md'),'# Task\n\nFix AuthService.login verification failing.\n');
  await start(root,false);
  const m=JSON.parse(readFileSync(join(root,'.ai','packs','current-task.manifest.json'),'utf8')) as PackManifest;
  const entry=m.entries.find(x=>x.path==='src/auth.ts')!;
  assert.ok(entry);assert.equal(entry.mode,'smart');
  assert.equal(entry.parser,'typescript-ast');
  assert.ok(entry.segments!.some(x=>x.name==='AuthService.login'&&x.mode==='full'));
  assert.equal(m.exactModelTokens,null);assert.equal(m.tokenAccounting,'conservative-estimate-not-provider-exact');
  assert.ok(m.compressionRatio>1);assert.ok(m.estimatedTokens>0);
  const output=readFileSync(join(root,'.ai','packs','current-task.md'),'utf8');
  assert.match(output,/FULL AuthService.login/);assert.match(output,/OUTLINE AuthService.logout/);
  const saved=readFileSync(join(root,'.ai','packs','current-task.manifest.json'));
  assert.equal(pack(root).status,'ready');
  assert.deepEqual(readFileSync(join(root,'.ai','packs','current-task.manifest.json')),saved);
  await end(root);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('sensitive secrets in selected AST function get redacted before pack export',async()=>{
 const root=mkdtempSync(join(tmpdir(),'agentos-smart-secret-'));
 const git=(...args:string[])=>execFileSync('git',args,{cwd:root,stdio:'pipe'});
 try{
  git('init','-q');git('config','user.name','Test');git('config','user.email','test@example.com');
  mkdirSync(join(root,'src'));
  writeFileSync(join(root,'src','app.ts'),`export function secureLogin(){\n  const apiKey = "very_secret_data_123456789";\n  return true;\n}\n`+`function other(){${junk(2200)}}`);
  git('add','.');git('commit','-qm','fixture');init(root);
  writeFileSync(join(root,'.ai','AI_TASK.md'),'# Task\nFix secureLogin\n');
  await start(root,false);
  const output=readFileSync(join(root,'.ai','packs','current-task.md'),'utf8');
  assert.doesNotMatch(output,/very_secret_data_123456789/);
  assert.match(output,/REDACTED BY AGENTOS/);
  await end(root);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('large priority body falls back to clearly labeled outline instead of vanishing',()=>{
 const s=makeSmartSnippet('src/heavy.ts',
   `export function fixBilling(){${junk(7000)}return true;}\n`+
   `function unrelated(){${junk(1000)}}\n`,
   'Fix fixBilling',{
     budgetBytes:520,minScore:30,alwaysFull:false,changed:false,explicitPath:false});
 assert.equal(s.mode,'smart');
 assert.equal(s.segments.find(x=>x.name==='fixBilling')?.mode,'outline');
 assert.equal(s.segments.find(x=>x.name==='fixBilling')?.reason,'per-file-budget');
 assert.match(s.text,/body omitted: per-file-budget/);
 assert.doesNotMatch(s.text,/x{1000}/);
});

test('fallback full mode restores complete original source without AST compression',()=>{
 const s=makeSmartSnippet('src/heavy.ts',sample,'Fix login',{
  budgetBytes:500,minScore:30,alwaysFull:true,changed:false,explicitPath:false});
 assert.equal(s.mode,'full');assert.equal(s.text,sample);
});
