import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,symlinkSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {init,pack,rules} from '../src/commands.js';
import {safeProjectPath,pathFor} from '../src/utils.js';
function fixture():string{
 const root=mkdtempSync(join(tmpdir(),'agentos-security-'));
 const git=(...args:string[])=>execFileSync('git',args,{cwd:root,stdio:'pipe'});
 git('init','-q');git('config','user.email','audit@example.invalid');git('config','user.name','Security Audit');
 writeFileSync(join(root,'index.ts'),'export function addToCart(x:number){return x+1}\n');
 git('add','index.ts');git('commit','-qm','initial');init(root);
 writeFileSync(join(root,'.ai','AI_TASK.md'),'# Current Task\nAnalyze addToCart\n');
 return root;
}
function asLink(target:string,path:string){symlinkSync(target,path,process.platform==='win32'?'junction':'dir');}

test('security: pack refuses a linked .ai/packs directory and never writes outside the repo',()=>{
 const root=fixture(), external=mkdtempSync(join(tmpdir(),'agentos-external-'));
 try{
  rmSync(join(root,'.ai','packs'),{recursive:true});asLink(external,join(root,'.ai','packs'));
  assert.throws(()=>pack(root),/Unsafe symlink/);
  assert.equal(existsSync(join(external,'current-task.md')),false);
  assert.equal(existsSync(join(external,'current-task.manifest.json')),false);
 }finally{rmSync(root,{recursive:true,force:true});rmSync(external,{recursive:true,force:true});}
});
test('security: cannot read a linked task file from outside the repo',()=>{
 const root=fixture(), external=mkdtempSync(join(tmpdir(),'agentos-external-'));
 try{
  writeFileSync(join(external,'private.txt'),'dummy_private_audit_token');
  rmSync(join(root,'.ai','AI_TASK.md'));
  symlinkSync(join(external,'private.txt'),join(root,'.ai','AI_TASK.md'));
  assert.throws(()=>pack(root),/Unsafe symlink/);
  assert.equal(existsSync(join(root,'.ai','packs','current-task.md')),false);
 }finally{rmSync(root,{recursive:true,force:true});rmSync(external,{recursive:true,force:true});}
});
test('security: linked .ai itself is rejected',()=>{
 const root=fixture(),external=mkdtempSync(join(tmpdir(),'agentos-external-'));
 try{
  rmSync(join(root,'.ai'),{recursive:true});asLink(external,join(root,'.ai'));
  assert.throws(()=>pack(root),/Unsafe symlink/);
  assert.equal(existsSync(join(external,'packs','current-task.md')),false);
 }finally{rmSync(root,{recursive:true,force:true});rmSync(external,{recursive:true,force:true});}
});
test('security: adapter parent path symlink cannot redirect rule generation',()=>{
 const root=fixture(), external=mkdtempSync(join(tmpdir(),'agentos-external-'));
 try{
  rmSync(join(root,'.cursor'),{recursive:true});asLink(external,join(root,'.cursor'));
  assert.throws(()=>rules(root),/Unsafe symlink/);
  assert.equal(existsSync(join(external,'rules','agentos.mdc')),false);
 }finally{rmSync(root,{recursive:true,force:true});rmSync(external,{recursive:true,force:true});}
});
test('security: cannot escape project path or read linked ignore/config files',()=>{
 const root=fixture(),external=mkdtempSync(join(tmpdir(),'agentos-external-'));
 try{
  assert.throws(()=>pathFor(root,'..','..','outside'),/Unsafe project path/);
  assert.throws(()=>safeProjectPath(root,'../outside'),/Unsafe project path/);
  rmSync(join(root,'.agentosignore'));
  symlinkSync(join(external,'ignore.txt'),join(root,'.agentosignore'));
  assert.throws(()=>pack(root),/Unsafe symlink/);
 }finally{rmSync(root,{recursive:true,force:true});rmSync(external,{recursive:true,force:true});}
});
test('security: ordinary project paths still work after hardening',()=>{
 const root=fixture();try{
  const result=pack(root);assert.equal(result.status,'ready');
  const output=readFileSync(join(root,'.ai','packs','current-task.md'),'utf8');
  assert.match(output,/addToCart/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
