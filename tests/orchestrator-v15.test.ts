import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {init} from '../src/commands.js';
const cli=resolve('dist/src/cli.js');
function git(root:string,...argv:string[]){const r=spawnSync('git',argv,{cwd:root,encoding:'utf8'});assert.equal(r.status,0,`git ${argv.join(' ')}: ${r.stderr}`);return r.stdout;}
function repo(){const root=mkdtempSync(join(tmpdir(),'agentos-simple-שלום '));git(root,'init','-q');git(root,'config','user.name','Test');git(root,'config','user.email','test@invalid.example');mkdirSync(join(root,'src'));writeFileSync(join(root,'src','service.ts'),'export function total(x:number){return x*2;}\n');git(root,'add','src');git(root,'commit','-qm','Initial');return root;}
function run(root:string,...args:string[]){const r=spawnSync(process.execPath,[cli,...args,'--cwd',root,'--json'],{encoding:'utf8',timeout:70000});let data:any;try{if(r.status===0)data=JSON.parse(r.stdout)}catch{}return {...r,data};}

test('setup single command initializes, installs three Skills and three MCP configs, idempotently',()=>{
 const root=repo();try{
  const preview=run(root,'setup','--dry-run');assert.equal(preview.status,0,preview.stderr);
  assert.equal(preview.data.wouldInitialize,true);assert.equal(existsSync(join(root,'agentos.yml')),false);
  const done=run(root,'setup');assert.equal(done.status,0,done.stderr);
  for(const path of ['agentos.yml','AGENTS.md','.claude/skills/shimi/SKILL.md','.cursor/skills/shimi/SKILL.md','.agents/skills/shimi/SKILL.md','.mcp.json','.cursor/mcp.json','.codex/config.toml'])assert.ok(existsSync(join(root,path)),path);
  assert.match(readFileSync(join(root,'AGENTS.md'),'utf8'),/Only the USER initiates/);
  const second=run(root,'setup');assert.equal(second.status,0,second.stderr);
  assert.equal(second.data.createdProject,false);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('setup refuses collision before initialization or other writes',()=>{
 const root=repo();try{
  mkdirSync(join(root,'.cursor/skills/shimi'),{recursive:true});
  writeFileSync(join(root,'.cursor/skills/shimi/SKILL.md'),'MY OWN SKILL');
  const r=run(root,'setup');assert.equal(r.status,1);
  assert.match(r.stderr,/Refusing to overwrite/);
  assert.equal(existsSync(join(root,'agentos.yml')),false);
  assert.equal(existsSync(join(root,'.mcp.json')),false);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('user command switch and continue transfer via two separate CLI processes without prior chat',()=>{
 const root=repo();try{
  init(root);
  const no=run(root,'switch');assert.equal(no.status,1);
  const work=run(root,'work','--no-watch');assert.equal(work.status,0,work.stderr);
  assert.equal(work.data.mode,'work');const first=work.data.session;
  const second=run(root,'work','--no-watch');assert.equal(second.status,0,second.stderr);
  assert.equal(second.data.sessionReused,true);assert.equal(second.data.session,first);
  writeFileSync(join(root,'.ai/AI_TASK.md'),'# Task\n\nFix total calculation; next: add tests.\n');
  writeFileSync(join(root,'src','service.ts'),'export function total(x:number){return x*3;}\n');
  const note=run(root,'session','capture','--kind','next','--text','Add regression tests for total(x)');assert.equal(note.status,0,note.stderr);
  const out=run(root,'switch');assert.equal(out.status,0,out.stderr);
  assert.equal(out.data.mode,'switch');assert.equal(out.data.sessionClosed,true);
  assert.match(readFileSync(join(root,'.ai/exports/handoff.md'),'utf8'),/Add regression tests for total/);
  assert.equal(run(root,'continue','--no-watch').status,0);
  const incoming=run(root,'status');assert.equal(incoming.status,0,incoming.stderr);
  assert.equal(incoming.data.session.state,'active');assert.notEqual(incoming.data.session.id,first);
  const old=out.data.previousSession;assert.equal(old,first);
  assert.equal(out.data.verification.git.changed.includes('src/service.ts'),true);
  const last=run(root,'switch');assert.equal(last.status,0,last.stderr);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('continue refuses to terminate an active session without explicit user switch',()=>{
 const root=repo();try{
  init(root);assert.equal(run(root,'work','--no-watch').status,0);
  const before=run(root,'status').data.session.id;
  const continued=run(root,'continue','--no-watch');assert.equal(continued.status,1);
  assert.match(continued.stderr,/Run `shimi switch`/);
  assert.equal(run(root,'status').data.session.id,before);
  assert.equal(run(root,'switch').status,0);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('switch works when previous AI has stopped writing notes and no tests are executed automatically',()=>{
 const root=repo();try{
  init(root);
  const flag=join(root,'EXECUTED.txt');
  writeFileSync(join(root,'.agentos-evidence.json'),JSON.stringify({version:1,checks:[{id:'unsafe',command:'node',args:['-e',`require('fs').writeFileSync(${JSON.stringify(flag)},'run')`],inputs:['src/service.ts']}]}));
  assert.equal(run(root,'work','--no-watch').status,0);
  assert.equal(run(root,'switch').status,0);
  const next=run(root,'continue','--no-watch');assert.equal(next.status,0,next.stderr);
  assert.equal(next.data.mode,'continue');assert.match(next.data.handoff,/AgentOS Portable Handoff/);
  assert.equal(existsSync(flag),false);
  run(root,'switch');
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('flags reject orchestration options and client validation',()=>{
 const root=repo();try{
  assert.equal(run(root,'setup','--client','unknown').status,1);
  assert.equal(run(root,'setup','--lang','en').status,1);
  assert.equal(run(root,'switch','--request','something').status,1);
  assert.equal(run(root,'continue','--check','x').status,1);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('MCP agentos_work is advertised, no MCP tool can execute user-only switch/continue',()=>{
 const root=repo();try{
  init(root);
  const lines=[{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26'}},{jsonrpc:'2.0',id:2,method:'tools/list',params:{}},{jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'agentos_work',arguments:{}}}];
  const r=spawnSync(process.execPath,[cli,'mcp','serve','--cwd',root],{encoding:'utf8',input:lines.map(x=>JSON.stringify(x)).join('\n')+'\n',timeout:70000});
  assert.equal(r.status,0,r.stderr);
  const out=r.stdout.trim().split(/\r?\n/).map(x=>JSON.parse(x));
  const names=out[1].result.tools.map((x:any)=>x.name);
  assert.ok(names.includes('agentos_work'));
  assert.ok(!names.includes('agentos_switch')&&!names.includes('agentos_continue'));
  assert.equal(out[2].result.isError,false);
  assert.equal(JSON.parse(out[2].result.content[0].text).mode,'work');
  assert.equal(run(root,'switch').status,0);
 }finally{rmSync(root,{recursive:true,force:true});}
});


test('setup upgrades only recognizable old AgentOS-owned MCP entries and preserves unrelated client settings',()=>{
 const root=repo();try{
  init(root);const old={command:process.execPath,args:['/old/npm/node_modules/@agentos/cli/dist/src/cli.js','mcp','serve','--cwd',root]};
  writeFileSync(join(root,'.mcp.json'),JSON.stringify({mcpServers:{other:{command:'test'},agentos:old},other:'preserved'}));
  const codex=join(root,'.codex/config.toml');mkdirSync(join(root,'.codex'),{recursive:true});
  writeFileSync(codex,`theme = "dark"\n# AGENTOS MANAGED MCP BEGIN\n[mcp_servers.agentos]\ncommand = ${JSON.stringify(old.command)}\nargs = [${old.args.map(x=>JSON.stringify(x)).join(', ')}]\n# AGENTOS MANAGED MCP END\n`);
  const res=run(root,'setup');assert.equal(res.status,0,res.stderr);
  const cfg=JSON.parse(readFileSync(join(root,'.mcp.json'),'utf8'));
  assert.equal(cfg.other,'preserved');assert.equal(cfg.mcpServers.other.command,'test');assert.equal(cfg.mcpServers.shimi.args[0],cli);
  assert.match(readFileSync(codex,'utf8'),/theme = "dark"/);
  assert.match(readFileSync(codex,'utf8'),/SHIMI MANAGED MCP BEGIN/);
  const re=run(root,'setup');assert.equal(re.status,0,re.stderr);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('setup refuses unrecognized MCP change instead of overwriting',()=>{
 const root=repo();try{
  init(root);writeFileSync(join(root,'.mcp.json'),JSON.stringify({mcpServers:{agentos:{command:'evil',args:['--other']}}}));
  const res=run(root,'setup');assert.equal(res.status,1);assert.match(res.stderr,/refusing to overwrite/i);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('setup invoked from nested source folder initializes the Git root, not a nested project',()=>{
 const root=repo();try{
  const nested=join(root,'src');
  const r=run(nested,'setup','--client','codex');assert.equal(r.status,0,r.stderr);
  assert.equal(existsSync(join(root,'agentos.yml')),true);
  assert.equal(existsSync(join(nested,'agentos.yml')),false);
  assert.equal(existsSync(join(root,'.agents/skills/shimi/SKILL.md')),true);
 }finally{rmSync(root,{recursive:true,force:true});}
});
