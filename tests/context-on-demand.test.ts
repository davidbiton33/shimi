import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { init, pack } from '../src/commands.js';
import { requestContext, createSubtask, listSubtasks, finishSubtask, subtaskLineage } from '../src/context-requests.js';
const git=(root:string,...args:string[])=>execFileSync('git',args,{cwd:root,encoding:'utf8'});
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'agentos-ondemand-'));
 git(root,'init','-q');git(root,'config','user.email','unit@example.org');git(root,'config','user.name','Unit');
 mkdirSync(join(root,'src'));
 writeFileSync(join(root,'src','cart.ts'),`import { computeTax } from './tax.js';\nexport function calculateTotal(subtotal: number) { return subtotal + computeTax(subtotal); }\nexport class Cart { save() { return calculateTotal(100); } }\n`);
 writeFileSync(join(root,'src','tax.ts'),`export function computeTax(amount: number) { return amount * .17; }\nexport class TaxRepo { save() { return 17; } }\n`);
 writeFileSync(join(root,'.env'),'API_KEY=not-for-agents');
 git(root,'add','.');git(root,'commit','-qm','initial');
 init(root);
 writeFileSync(join(root,'.ai','AI_TASK.md'),'Repair Cart calculation and the computeTax function');
 return root;
}

test('on-demand returns bounded exact definition and graph neighbors without modifying main pack',()=>{
 const root=fixture();try {
  pack(root);const before=readFileSync(join(root,'.ai','packs','current-task.md'),'utf8');
  const result=requestContext(root,{symbol:'calculateTotal',maxTokens:1000,includeDependencies:true});
  assert.equal(result.status,'ok');assert.equal(result.matches.length,1);
  assert.equal(result.matches[0].path,'src/cart.ts');
  assert.match(result.matches[0].code,/calculateTotal/);
  assert.equal(result.related.source,'last-pack-snapshot');
  assert.ok(result.related.files.some(f=>f.path==='src/tax.ts'));
  assert.equal(readFileSync(join(root,'.ai','packs','current-task.md'),'utf8'),before);
  assert.equal(existsSync(join(root,'.ai','subtasks')),false);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('ambiguous names return candidates, file selection disambiguates and secret paths are excluded',()=>{
 const root=fixture();try{
  const ambiguous=requestContext(root,{symbol:'save'});
  assert.equal(ambiguous.status,'ambiguous');
  assert.equal(ambiguous.candidates.length,2);
  const exact=requestContext(root,{file:'src/cart.ts',symbol:'save'});
  assert.equal(exact.status,'ok');assert.equal(exact.matches.length,1);
  const secret=requestContext(root,{file:'.env'});
  assert.equal(secret.status,'not_found');
  const escape=requestContext(root,{file:'../etc/passwd'});
  assert.equal(escape.status,'not_found');
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('subtasks preserve original current task, maintain parent/child lineage and enforce completion order',()=>{
 const root=fixture();try{
  const before=readFileSync(join(root,'.ai','AI_TASK.md'),'utf8');
  const parent=createSubtask(root,{title:'Checkout bug'});
  const child=createSubtask(root,{title:'Investigate tax',parentId:parent.id});
  assert.deepEqual(subtaskLineage(root,child.id).map(s=>s.title),['Checkout bug','Investigate tax']);
  assert.equal(listSubtasks(root,parent.id).length,1);
  assert.throws(()=>finishSubtask(root,parent.id,'done'),/Finish child subtasks/);
  assert.equal(requestContext(root,{symbol:'computeTax',subtaskId:child.id}).status,'ok');
  finishSubtask(root,child.id,'found root cause');finishSubtask(root,parent.id,'fixed');
  assert.throws(()=>requestContext(root,{symbol:'save',subtaskId:child.id}),/completed subtask/);
  assert.equal(readFileSync(join(root,'.ai','AI_TASK.md'),'utf8'),before);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('CLI context and subtask commands output machine-readable JSON',()=>{
 const root=fixture();try{
  const cli=(...args:string[])=>JSON.parse(execFileSync(process.execPath,[join(process.cwd(),'dist','src','cli.js'),...args,'--cwd',root,'--json'],{cwd:root,encoding:'utf8'}));
  const task=cli('subtask','create','--title','Review discount');
  assert.equal(task.title,'Review discount');
  const data=cli('context','--symbol','computeTax','--subtask',task.id,'--max-tokens','600');
  assert.equal(data.status,'ok');assert.equal(data.matches[0].path,'src/tax.ts');
  const done=cli('subtask','complete','--id',task.id,'--result','reviewed');
  assert.equal(done.status,'done');
  assert.equal(cli('context','--file','.env').status,'not_found');
 }finally{rmSync(root,{recursive:true,force:true});}
});
