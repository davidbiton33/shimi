import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {init,pack} from '../src/commands.js';

test('end-to-end: symbol definition beyond graph depth is fully selected, unrelated function outlined',()=>{
 const root=mkdtempSync(join(tmpdir(),'agentos-symbol-packer-'));
 try {
  const git=(...args:string[])=>execFileSync('git',args,{cwd:root,stdio:'pipe'});
  git('init','-q');git('config','user.email','test@example.com');git('config','user.name','Test');
  mkdirSync(join(root,'src'));
  writeFileSync(join(root,'src','app.ts'),'import {verify} from "./one";\nverify("a");');
  writeFileSync(join(root,'src','one.ts'),'export {verify} from "./two";');
  writeFileSync(join(root,'src','two.ts'),'export {verify} from "./three";');
  writeFileSync(join(root,'src','three.ts'),'export {verify} from "./four";');
  const important='export function verify(token:string) { return token.length>0; }';
  writeFileSync(join(root,'src','four.ts'),important+'\nexport function unrelated(){ return '+JSON.stringify('X'.repeat(4500))+'; }\n');
  git('add','src');git('commit','-qm','fixture');init(root);
  writeFileSync(join(root,'.ai','AI_TASK.md'),'Fix src/app.ts when verify incorrectly rejects a token.');
  assert.equal(pack(root).status,'ready');
  const manifest=JSON.parse(readFileSync(join(root,'.ai','packs','current-task.manifest.json'),'utf8'));
  const entry=manifest.entries.find((e:{path:string})=>e.path==='src/four.ts');
  assert.ok(entry,'original definition file is added beyond regular graph depth');
  assert.equal(entry.graph.relation,'definition');
  assert.equal(entry.segments.find((s:{name:string})=>s.name==='verify').mode,'full');
  assert.equal(entry.segments.find((s:{name:string})=>s.name==='unrelated').mode,'outline');
  const source=readFileSync(join(root,'.ai','packs','current-task.md'),'utf8');
  assert.match(source,/function verify\(token:string\)/);assert.doesNotMatch(source,/X{400}/);
 }finally {rmSync(root,{recursive:true,force:true});}
});
