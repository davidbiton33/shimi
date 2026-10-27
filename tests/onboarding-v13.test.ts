import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,existsSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync,spawn} from 'node:child_process';
import {init} from '../src/commands.js';

function repo(){const root=mkdtempSync(join(tmpdir(),'agentos-onboard-'));init(root);return root;}
const bin=resolve('dist/src/cli.js');
function run(root:string,...params:string[]){const p=spawnSync(process.execPath,[bin,...params,'--cwd',root,'--json'],{encoding:'utf8'});return {...p,data:p.status===0?JSON.parse(p.stdout):null};}

test('skill install creates valid frontmatter at exact client locations, idempotently',()=>{
 const root=repo();try{
  const dry=run(root,'skill','install','--dry-run');assert.equal(dry.status,0,dry.stderr);
  assert.equal(dry.data.files.length,3);
  assert.equal(existsSync(join(root,'.claude/skills/shimi/SKILL.md')),false);
  const added=run(root,'skill','install');assert.equal(added.status,0,added.stderr);
  for(const file of ['.claude/skills/shimi/SKILL.md','.cursor/skills/shimi/SKILL.md','.agents/skills/shimi/SKILL.md']){
   const txt=readFileSync(join(root,file),'utf8');assert.match(txt,/^---\nname: shimi\ndescription: /);assert.match(txt,/## Handoff/);
  }
  const again=run(root,'skill','install');assert.equal(again.status,0,again.stderr);
  assert.ok(again.data.files.every((x:{status:string})=>x.status==='unchanged'));
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('skill supports client selection and unknown clients fail before writing',()=>{
 const root=repo();try{
  const bad=run(root,'skill','install','--client','evil');assert.equal(bad.status,1);
  assert.match(bad.stderr,/--client must be/);
  const one=run(root,'skill','install','--client','codex');assert.equal(one.status,0,one.stderr);
  assert.ok(existsSync(join(root,'.agents/skills/shimi/SKILL.md')));
  assert.equal(existsSync(join(root,'.claude/skills/shimi/SKILL.md')),false);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('Skill collision preflight protects all clients without partial writes',()=>{
 const root=repo();try{
  mkdirSync(join(root,'.cursor/skills/shimi'),{recursive:true});
  writeFileSync(join(root,'.cursor/skills/shimi/SKILL.md'),'CUSTOM USER SKILL');
  const r=run(root,'skill','install');assert.equal(r.status,1);
  assert.match(r.stderr,/Refusing to overwrite/);
  assert.equal(readFileSync(join(root,'.cursor/skills/shimi/SKILL.md'),'utf8'),'CUSTOM USER SKILL');
  assert.equal(existsSync(join(root,'.claude/skills/shimi/SKILL.md')),false);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('MCP install writes 3 client-specific configurations and preserves unrelated settings',()=>{
 const root=repo();try{
  writeFileSync(join(root,'.mcp.json'),JSON.stringify({mcpServers:{other:{command:'other-server'}},note:'retain'}));
  mkdirSync(join(root,'.cursor'),{recursive:true});
  writeFileSync(join(root,'.cursor/mcp.json'),JSON.stringify({mcpServers:{keep:{command:'node',args:['test']}}}));
  mkdirSync(join(root,'.codex'),{recursive:true});
  writeFileSync(join(root,'.codex/config.toml'),'model = "dummy"\n[mcp_servers.other]\ncommand = "other"\n');
  const dry=run(root,'mcp','install','--dry-run');assert.equal(dry.status,0,dry.stderr);
  assert.equal(JSON.parse(readFileSync(join(root,'.mcp.json'),'utf8')).mcpServers.shimi,undefined);
  const installed=run(root,'mcp','install');assert.equal(installed.status,0,installed.stderr);
  assert.equal(installed.data.files.length,3);
  const claude=JSON.parse(readFileSync(join(root,'.mcp.json'),'utf8'));
  const cursor=JSON.parse(readFileSync(join(root,'.cursor/mcp.json'),'utf8'));
  assert.equal(claude.note,'retain');assert.equal(claude.mcpServers.other.command,'other-server');
  assert.equal(cursor.mcpServers.keep.command,'node');
  for(const config of [claude,cursor]){
   const server=config.mcpServers.shimi;
   assert.equal(server.command,process.execPath);
   assert.deepEqual(server.args.slice(1,3),['mcp','serve']);
   assert.equal(server.args.at(-1),root);
  }
  const toml=readFileSync(join(root,'.codex/config.toml'),'utf8');
  assert.match(toml,/model = "dummy"/);assert.match(toml,/\[mcp_servers.other\]/);
  assert.match(toml,/\[mcp_servers.shimi\]/);
  assert.match(toml,/SHIMI MANAGED MCP BEGIN/);
  assert.equal(run(root,'mcp','install').status,0);
  assert.equal(readFileSync(join(root,'.codex/config.toml'),'utf8'),toml);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('MCP collision leaves other config files untouched; invalid JSON safely fails',()=>{
 const root=repo();try{
  mkdirSync(join(root,'.cursor'),{recursive:true});
  writeFileSync(join(root,'.cursor/mcp.json'),'{not-json');
  const invalid=run(root,'mcp','install');assert.equal(invalid.status,1);
  assert.match(invalid.stderr,/Invalid JSON/);
  assert.equal(existsSync(join(root,'.mcp.json')),false);
  writeFileSync(join(root,'.cursor/mcp.json'),JSON.stringify({mcpServers:{agentos:{command:'malicious',args:[]}}}));
  const conflict=run(root,'mcp','install');assert.equal(conflict.status,1);
  assert.match(conflict.stderr,/Existing agentos MCP entry/);
  assert.equal(existsSync(join(root,'.mcp.json')),false);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('MCP installer refuses existing unmarked Codex table and existing symlink escape',()=>{
 const root=repo();const outside=mkdtempSync(join(tmpdir(),'agentos-outside-'));try{
  mkdirSync(join(root,'.codex'),{recursive:true});
  writeFileSync(join(root,'.codex/config.toml'),'[mcp_servers.shimi]\ncommand = "user"\n');
  assert.equal(run(root,'mcp','install','--client','codex').status,1);
  rmSync(join(root,'.codex'),{recursive:true,force:true});
  symlinkSync(outside,join(root,'.codex'),'dir');
  const danger=run(root,'mcp','install','--client','codex');assert.equal(danger.status,1);
  assert.match(danger.stderr,/Unsafe symlink/);
  assert.equal(existsSync(join(outside,'config.toml')),false);
 }finally{rmSync(root,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
});

test('CLI rejects install-only flags for other commands and refuses non-initialized directories',()=>{
 const root=mkdtempSync(join(tmpdir(),'agentos-blank-'));try{
  assert.equal(run(root,'skill','install').status,1);
  assert.equal(run(root,'mcp','install').status,1);
  init(root);
  const bad=run(root,'mcp','config','--client','claude');assert.equal(bad.status,1);
  assert.match(bad.stderr,/MCP options are only supported/);
  assert.equal(run(root,'skill','install','--client','claude','--lang','en').status,1);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('installed MCP command can actually launch and return 14 tools using stdio',async()=>{
 const root=repo();try{
  assert.equal(run(root,'mcp','install','--client','claude').status,0);
  const {command,args}=JSON.parse(readFileSync(join(root,'.mcp.json'),'utf8')).mcpServers.shimi;
  const child=spawn(command,args,{stdio:['pipe','pipe','pipe']});
  let output='';child.stdout.on('data',x=>{output+=x.toString()});
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'acceptance',version:'1'}}})+'\n');
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list',params:{}})+'\n');child.stdin.end();
  const status=await new Promise<number|null>(res=>child.once('exit',res));
  assert.equal(status,0);
  const lines=output.trim().split('\n').map(s=>JSON.parse(s));
  assert.equal(lines.length,2);assert.equal(lines[1].result.tools.length,14);
  assert.equal(lines[0].result.serverInfo.name,'shimi');
 }finally{rmSync(root,{recursive:true,force:true});}
});
