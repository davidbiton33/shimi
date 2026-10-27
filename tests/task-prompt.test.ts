import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {taskPrompt} from '../src/task-prompt.js';

const executable=fileURLToPath(new URL('../src/cli.js',import.meta.url));
function cli(args:string[],cwd:string){return spawnSync(process.execPath,[executable,...args,'--cwd',cwd],{encoding:'utf8',timeout:15_000});}

test('task prompt defaults to Hebrew and embeds supplied request as quoted text',()=>{
  const p=taskPrompt({request:'  לתקן את כפתור השמירה  '});
  assert.equal(p.language,'he');assert.equal(p.taskFile,'.ai/AI_TASK.md');
  assert.match(p.prompt,/אתה סוכן פיתוח/);
  assert.match(p.prompt,/בקשת המשתמש/);
  assert.match(p.prompt,/לתקן את כפתור השמירה/);
  assert.match(p.prompt,/בקש אישור לפני החלפת/);
  assert.equal(p.requestProvided,true);
});

test('task prompt supports English and does not mix Hebrew instruction phrases',()=>{
  const p=taskPrompt({language:'en',request:'  Add order validation  '});
  assert.equal(p.language,'en');assert.match(p.prompt,/You are a coding agent/);
  assert.match(p.prompt,/Add order validation/);
  assert.match(p.prompt,/never silently overwrite/);
  assert.doesNotMatch(p.prompt,/בקשת המשתמש/);
});

test('task prompt without request instructs agent to use current user message',()=>{
  const he=taskPrompt();const en=taskPrompt({language:'en'});
  assert.equal(he.requestProvided,false);assert.match(he.prompt,/המשימה האחרונה/);
  assert.equal(en.requestProvided,false);assert.match(en.prompt,/most recent explicit development task/);
});

test('task prompt rejects unknown languages, empty or oversized requests',()=>{
  assert.throws(()=>taskPrompt({language:'fr'}),/--lang must be he or en/);
  assert.throws(()=>taskPrompt({language:'EN'}),/--lang must be he or en/);
  assert.throws(()=>taskPrompt({request:'  '}),/must not be empty/);
  assert.throws(()=>taskPrompt({request:'a'.repeat(4001)}),/4000 characters/);
});

test('CLI --lang en prints English instructions; --lang he prints Hebrew',()=>{
  const root=mkdtempSync(join(tmpdir(),'agentos-task-lang-'));
  try{
    const he=cli(['task','prompt','--lang','he','--request','טיפול בהרשאות'],root);
    assert.equal(he.status,0,he.stderr);
    assert.match(he.stdout,/אתה סוכן פיתוח/);
    const en=cli(['task','prompt','--lang','en','--request','Fix permission handling'],root);
    assert.equal(en.status,0,en.stderr);assert.match(en.stdout,/You are a coding agent/);
    assert.match(en.stdout,/Fix permission handling/);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('CLI JSON output includes language and task file, without writing project files',()=>{
  const root=mkdtempSync(join(tmpdir(),'agentos-task-json-'));
  try{
    const ai=join(root,'.ai');mkdirSync(ai);
    const task=join(ai,'AI_TASK.md');writeFileSync(task,'# Important existing work\n');
    const res=cli(['task','prompt','--lang','en','--request','Implement X','--json'],root);
    assert.equal(res.status,0,res.stderr);
    const doc=JSON.parse(res.stdout);
    assert.equal(doc.language,'en');assert.equal(doc.taskFile,'.ai/AI_TASK.md');
    assert.equal(doc.requestProvided,true);assert.match(doc.prompt,/Implement X/);
    assert.equal(readFileSync(task,'utf8'),'# Important existing work\n');
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('CLI rejects unsupported language, duplicate/missing flags and task-only flags elsewhere',()=>{
  const root=mkdtempSync(join(tmpdir(),'agentos-task-invalid-'));
  try{
    const cases:[string[],RegExp][]=[
      [['task','prompt','--lang','fr'],/--lang must be he or en/],
      [['task','prompt','--lang'],/--lang requires a value/],
      [['task','prompt','--lang','he','--lang','en'],/Duplicate option/],
      [['task','prompt','--request',''],/must not be empty/],
      [['task','prompt','--lang','en','--title','not allowed'],/Unsupported task option/],
      [['task','invalid'],/Unexpected extra argument/],
      [['pack','--lang','en'],/Options are not supported/],
    ];
    for(const [args,expected] of cases){
      const r=cli(args,root);
      assert.notEqual(r.status,0,'should reject '+args.join(' '));
      assert.match(r.stderr,expected,args.join(' '));
    }
  }finally{rmSync(root,{recursive:true,force:true});}
});
