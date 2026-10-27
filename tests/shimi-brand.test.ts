import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync,spawn} from 'node:child_process';

const cli=resolve('dist/src/cli.js');
const pkg=JSON.parse(readFileSync(resolve('package.json'),'utf8'));
function git(root:string,...args:string[]){const v=spawnSync('git',args,{cwd:root,encoding:'utf8'});assert.equal(v.status,0,v.stderr);}
function repo(){const root=mkdtempSync(join(tmpdir(),'shimi-שלום space '));git(root,'init','-q');git(root,'config','user.name','SHIMI Test');git(root,'config','user.email','test@invalid.example');mkdirSync(join(root,'src'));writeFileSync(join(root,'src','main.ts'),'export const greeting = "hello";\n');git(root,'add','src');git(root,'commit','-qm','Initial');return root;}
function call(root:string,...args:string[]){const p=spawnSync(process.execPath,[cli,...args,'--cwd',root,'--json'],{encoding:'utf8',timeout:70000});return {...p,json:p.status===0?JSON.parse(p.stdout):undefined};}

test('SHIMI brand exposes shimi and legacy agentos binaries in a single beta package',()=>{
 assert.equal(pkg.name,'shimi-agent-cli');
 assert.equal(pkg.version,'1.6.0-beta.1');
 assert.equal(pkg.bin.shimi,pkg.bin.agentos);
 const v=spawnSync(process.execPath,[cli,'--version'],{encoding:'utf8'});
 assert.equal(v.stdout.trim(),'1.6.0-beta.1');
 const help=spawnSync(process.execPath,[cli,'help'],{encoding:'utf8'});
 assert.match(help.stdout,/SHIMI/);assert.match(help.stdout,/shimi switch/);
});

test('fresh setup produces SHIMI Skills/MCP with unchanged legacy project state',()=>{
 const root=repo();try{
   const dry=call(root,'setup','--dry-run');assert.equal(dry.status,0,dry.stderr);
   assert.equal(existsSync(join(root,'agentos.yml')),false);
   const out=call(root,'setup');assert.equal(out.status,0,out.stderr);
   assert.ok(existsSync(join(root,'agentos.yml')));
   for(const path of ['.claude/skills/shimi/SKILL.md','.cursor/skills/shimi/SKILL.md','.agents/skills/shimi/SKILL.md']){
     const skill=readFileSync(join(root,path),'utf8');assert.match(skill,/^---\nname: shimi/);assert.match(skill,/shimi switch/);
   }
   const config=JSON.parse(readFileSync(join(root,'.mcp.json'),'utf8'));
   assert.ok(config.mcpServers.shimi);assert.equal(config.mcpServers.agentos,undefined);
   assert.match(readFileSync(join(root,'.codex/config.toml'),'utf8'),/\[mcp_servers\.shimi\]/);
   assert.equal(call(root,'setup').status,0);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('legacy generated AgentOS MCP entries upgrade to SHIMI without deleting unrelated settings',()=>{
 const root=repo();try{
   const legacy={command:process.execPath,args:[cli,'mcp','serve','--cwd',root]};
   writeFileSync(join(root,'.mcp.json'),JSON.stringify({mcpServers:{agentos:legacy,another:{command:'unchanged'}},custom:'retained'}));
   mkdirSync(join(root,'.cursor'),{recursive:true});
   writeFileSync(join(root,'.cursor/mcp.json'),JSON.stringify({mcpServers:{agentos:legacy}}));
   mkdirSync(join(root,'.codex'),{recursive:true});
   writeFileSync(join(root,'.codex/config.toml'),`model = "test"\n# AGENTOS MANAGED MCP BEGIN\n[mcp_servers.agentos]\ncommand = ${JSON.stringify(legacy.command)}\nargs = [${legacy.args.map(x=>JSON.stringify(x)).join(', ')}]\n# AGENTOS MANAGED MCP END\n`);
   const before=call(root,'setup','--dry-run');assert.equal(before.status,0,before.stderr);
   const actual=call(root,'setup');assert.equal(actual.status,0,actual.stderr);
   const cfg=JSON.parse(readFileSync(join(root,'.mcp.json'),'utf8'));
   assert.equal(cfg.mcpServers.agentos,undefined);
   assert.deepEqual(cfg.mcpServers.shimi,legacy);assert.equal(cfg.mcpServers.another.command,'unchanged');
   assert.equal(cfg.custom,'retained');
   const txt=readFileSync(join(root,'.codex/config.toml'),'utf8');
   assert.match(txt,/SHIMI MANAGED MCP BEGIN/);assert.match(txt,/\[mcp_servers\.shimi\]/);assert.match(txt,/model = "test"/);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('user-owned SHIMI configuration is never silently overwritten',()=>{
 const root=repo();try{
   writeFileSync(join(root,'.mcp.json'),JSON.stringify({mcpServers:{shimi:{command:'unknown',args:[]}}}));
   const rejected=call(root,'setup');assert.equal(rejected.status,1);
   assert.match(rejected.stderr,/refusing to overwrite/);
   assert.equal(existsSync(join(root,'agentos.yml')),false);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('new SHIMI Skill installer rejects symlink escape',()=>{
 const root=repo(),outside=mkdtempSync(join(tmpdir(),'shimi-outside-'));try{
   mkdirSync(join(root,'.claude'),{recursive:true});
   symlinkSync(outside,join(root,'.claude/skills'),'dir');
   const rejected=call(root,'setup');assert.equal(rejected.status,1);
   assert.match(rejected.stderr,/Unsafe symlink/);
   assert.equal(existsSync(join(outside,'shimi/SKILL.md')),false);
   assert.equal(existsSync(join(root,'agentos.yml')),false);
 }finally{rmSync(root,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
});

test('MCP identifies as SHIMI, lists new resources, and accepts legacy resource URIs',async()=>{
 const root=repo();try{
   assert.equal(call(root,'setup','--client','claude').status,0);
   const {command,args}=JSON.parse(readFileSync(join(root,'.mcp.json'),'utf8')).mcpServers.shimi;
   const child=spawn(command,args,{stdio:['pipe','pipe','pipe']});let output='';child.stdout.on('data',d=>output+=d.toString());
   for(const [id,method,params] of [[1,'initialize',{protocolVersion:'2025-06-18'}],[2,'tools/list',{}],[3,'resources/list',{}],[4,'resources/read',{uri:'agentos://task'}],[5,'resources/read',{uri:'shimi://task'}]] as const){child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');}
   child.stdin.end();
   const rc=await new Promise<number|null>(resolve=>child.on('exit',resolve));assert.equal(rc,0);
   const lines=output.trim().split('\n').map(x=>JSON.parse(x));
   assert.equal(lines.length,5);assert.equal(lines[0].result.serverInfo.name,'shimi');
   assert.equal(lines[1].result.tools.length,14);
   assert.equal(lines[2].result.resources.length,3);
   assert.equal(lines[2].result.resources[0].uri,'shimi://handoff');
   assert.equal(lines[3].result.contents[0].text,lines[4].result.contents[0].text);
 }finally{rmSync(root,{recursive:true,force:true});}
});
