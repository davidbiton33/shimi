import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {init,start,checkpoint,end,handoff} from '../src/commands.js';
import {createSubtask,addSubtaskDependency,removeSubtaskDependency,readySubtasks,blockedSubtasks,finishSubtask} from '../src/context-requests.js';
import {addMemory,listMemories,getMemory,searchMemories} from '../src/memory.js';
import {captureNote,captureStructuredTranscript,listNotes,sessionTimeline} from '../src/session-notes.js';

function repo(){
 const root=mkdtempSync(join(tmpdir(),'agentos-v12-'));
 const git=spawnSync('git',['init','-q'],{cwd:root});assert.equal(git.status,0);
 mkdirSync(join(root,'src'));
 writeFileSync(join(root,'src','index.ts'),'export const total = (n: number) => n + 1;\n');
 spawnSync('git',['add','.'],{cwd:root});
 spawnSync('git',['-c','user.email=test@example.org','-c','user.name=QA','commit','-qm','baseline'],{cwd:root});
 init(root);return root;
}

test('dependent subtasks support ready queues, blocker rejection, cycles and persistence',()=>{
 const root=repo();try{
  const parent=createSubtask(root,{title:'Feature'});
  const a=createSubtask(root,{title:'Step A',parentId:parent.id});
  const b=createSubtask(root,{title:'Step B',parentId:parent.id});
  addSubtaskDependency(root,b.id,a.id);
  assert.deepEqual(readySubtasks(root).map(t=>t.id),[a.id]);
  assert.equal(blockedSubtasks(root).some(x=>x.task.id===b.id&&x.waitingOn.includes(a.id)),true);
  assert.throws(()=>finishSubtask(root,b.id,'early'),/blocked/);
  assert.throws(()=>addSubtaskDependency(root,a.id,b.id),/cycle/);
  assert.throws(()=>addSubtaskDependency(root,a.id,parent.id),/parents and children/);
  assert.equal(readySubtasks(root).length,1);
  finishSubtask(root,a.id,'Verified');
  assert.deepEqual(readySubtasks(root).map(t=>t.id),[b.id]);
  finishSubtask(root,b.id,'Passed');
  assert.deepEqual(readySubtasks(root).map(t=>t.id),[parent.id]);
  finishSubtask(root,parent.id,'Finished');
  assert.equal(readySubtasks(root).length,0);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('dependency removing restores readiness, invalid IDs do not cause writes',()=>{
 const root=repo();try{
  const a=createSubtask(root,{title:'A'}),b=createSubtask(root,{title:'B'});
  addSubtaskDependency(root,b.id,a.id);
  removeSubtaskDependency(root,b.id,a.id);
  assert.equal(readySubtasks(root).length,2);
  assert.throws(()=>addSubtaskDependency(root,b.id,'../tmp'));
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('project memory is durable, searchable, scoped and survives session end',async()=>{
 const root=repo();try{
  const fact=addMemory(root,{kind:'fact',text:'Payment gateway is mock-only in tests',tags:['Payments'],source:'test-suite'});
  const decision=addMemory(root,{kind:'decision',text:'Use a dedicated service for refunds',tags:['payments'],source:'design-review'});
  assert.equal(getMemory(root,fact.id).kind,'fact');
  assert.equal(searchMemories(root,'refunds').at(0)?.id,decision.id);
  assert.equal(listMemories(root).length,2);
  assert.throws(()=>getMemory(root,'../../etc/passwd'));
  assert.throws(()=>addMemory(root,{kind:'unknown',text:'x'}));
  assert.throws(()=>addMemory(root,{kind:'fact',text:'X',tags:['bad/../tag']}));
  await start(root,false);
  const item=captureNote(root,{kind:'decision',text:'Do not make a network request',source:'agent-A'});
  assert.equal(listNotes(root).at(-1)?.id,item.id);
  const exportPath=handoff(root);
  assert.ok(readFileSync(exportPath,'utf8').includes('Do not make a network request'));
  assert.ok(readFileSync(exportPath,'utf8').includes('Payment gateway is mock-only'));
  await end(root);
  assert.equal(listMemories(root).length,2);
  assert.equal(listNotes(root).length,1);
  assert.equal(sessionTimeline(root).some(x=>x.type==='agent-note'),true);
  assert.equal(sessionTimeline(root).some(x=>x.type==='cli-event'),true);
  assert.throws(()=>captureNote(root,{kind:'progress',text:'after end'}),/active session/);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('structured transcript is opt-in, transactional on invalid input, path-confined',async()=>{
 const root=repo();try{
  await start(root,false);
  writeFileSync(join(root,'events.jsonl'),'[{"kind":"progress","text":"not-jsonl"}]\n'+JSON.stringify({kind:'invalid',text:'nope'}));
  assert.throws(()=>captureStructuredTranscript(root,'events.jsonl'));
  assert.equal(listNotes(root).length,0);
  writeFileSync(join(root,'events.jsonl'),JSON.stringify({kind:'intent',text:'Fix validation'})+'\n'+JSON.stringify({kind:'next',text:'Run tests'})+'\n');
  assert.equal(captureStructuredTranscript(root,'events.jsonl').length,2);
  assert.equal(listNotes(root).length,2);
  assert.throws(()=>captureStructuredTranscript(root,'../events.jsonl'));
  await end(root);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('CLI commands expose memory, capture, dependencies and MCP config',()=>{
 const root=repo();try{
  const bin=resolve('dist/src/cli.js');
  const run=(...args:string[])=>{const p=spawnSync(process.execPath,[bin,...args,'--cwd',root,'--json'],{encoding:'utf8'});assert.equal(p.status,0,p.stderr);return JSON.parse(p.stdout);};
  const a=run('subtask','create','--title','Create API');
  const b=run('subtask','create','--title','Frontend');
  run('subtask','depend','--id',b.id,'--on',a.id);
  assert.deepEqual(run('subtask','ready').map((x:{id:string})=>x.id),[a.id]);
  assert.equal(run('subtask','blocked').length,1);
  assert.equal(run('memory','add','--kind','fact','--text','Node 22 supported').kind,'fact');
  assert.equal(run('memory','search','--query','Node').length,1);
  assert.ok(run('mcp','config').mcpServers.shimi.args.includes('serve'));
  assert.ok(!readFileSync(join(root,'.gitignore'),'utf8').includes('.ai/memory/'));
  assert.ok(readFileSync(join(root,'.gitignore'),'utf8').includes('.ai/session-notes/'));
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('MCP stdio supports initialize, tool discovery, tool execution and resources',async()=>{
 const root=repo();try{
  await start(root,false);
  const child=spawn(process.execPath,[resolve('dist/src/cli.js'),'mcp','serve','--cwd',root],{stdio:['pipe','pipe','pipe']});
  let buffer='',received:Record<string,unknown>[]=[];
  child.stdout.on('data',(part:Buffer)=>{buffer+=part.toString();let pos;while((pos=buffer.indexOf('\n'))!==-1){const line=buffer.slice(0,pos);buffer=buffer.slice(pos+1);try{received.push(JSON.parse(line) as Record<string,unknown>);}catch{}}});
  const send=(id:number,method:string,params:unknown)=>child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
  const until=async(id:number)=>{for(let i=0;i<100;i++){const r=received.find(x=>x.id===id);if(r)return r;await new Promise(ok=>setTimeout(ok,20));}throw Error('MCP timeout '+id);};
  send(1,'initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'test',version:'1'}});
  assert.equal((await until(1)).result && ((await until(1)).result as {protocolVersion:string}).protocolVersion,'2025-06-18');
  send(2,'tools/list',{});
  const names=((await until(2)).result as {tools:{name:string}[]}).tools.map(x=>x.name);
  assert.ok(names.includes('agentos_handoff'));assert.ok(names.includes('agentos_tasks_ready'));
  send(3,'tools/call',{name:'agentos_session_capture',arguments:{kind:'decision',text:'Keep public API stable'}});
  assert.equal(((await until(3)).result as {isError:boolean}).isError,false);
  send(4,'tools/call',{name:'agentos_handoff',arguments:{}});
  const r=(await until(4)).result as {content:{text:string}[]};
  assert.match(r.content[0].text,/Keep public API stable/);
  send(5,'resources/read',{uri:'agentos://task'});
  assert.ok(((await until(5)).result as {contents:{text:string}[]}).contents[0].text);
  child.stdin.end();await new Promise<void>(resolve=>child.on('exit',()=>resolve()));
  assert.equal(child.exitCode,0);
  await end(root);
 }finally{rmSync(root,{recursive:true,force:true});}
});
