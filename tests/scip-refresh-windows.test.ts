import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {resolveIndexerCommand} from '../src/scip-refresh.js';

function fakeInstall(mode:'local'|'global'){
 const root=mkdtempSync(join(tmpdir(),'agentos scip windows-עברית '));
 const bin=mode==='local'?join(root,'node_modules','.bin'):root;
 const main=mode==='local'
   ?join(root,'node_modules','@sourcegraph','scip-typescript','dist','src','main.js')
   :join(root,'node_modules','@sourcegraph','scip-typescript','dist','src','main.js');
 mkdirSync(bin,{recursive:true});mkdirSync(dirname(main),{recursive:true});
 writeFileSync(join(bin,'scip-typescript.cmd'),'@echo off\r\n');
 writeFileSync(main,"console.log('fake indexer')\n");
 return {root,bin,main};
}

test('Windows local npm .cmd shim resolves to Node JS entry without invoking shell',()=>{
 const f=fakeInstall('local');
 try{
  const original={cmd:'scip-typescript',args:['index','--output','C:\\A&B (QA)\\generated.scip'],generated:'x'};
  const c=resolveIndexerCommand('typescript',original,'C:\\absent;'+f.bin,'win32');
  assert.equal(c.cmd,process.execPath);
  assert.deepEqual(c.args,[f.main,...original.args]);
  assert.equal(c.generated,'x');
 }finally{rmSync(f.root,{recursive:true,force:true});}
});

test('Windows globally installed npm indexer resolves',()=>{
 const f=fakeInstall('global');
 try{
  const c=resolveIndexerCommand('typescript',{cmd:'scip-typescript',args:['index'],generated:'x'},f.bin,'win32');
  assert.equal(c.cmd,process.execPath);assert.equal(c.args[0],f.main);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});

test('does not turn missing indexer into success or invoke arbitrary shell',()=>{
 const f=fakeInstall('local');
 try{
  rmSync(f.main);
  const orig={cmd:'scip-typescript',args:['index'],generated:'x'};
  assert.deepEqual(resolveIndexerCommand('typescript',orig,f.bin,'win32'),orig);
  assert.deepEqual(resolveIndexerCommand('typescript',orig,f.bin,'linux'),orig);
  assert.deepEqual(resolveIndexerCommand('java',{...orig,cmd:'scip-java'},f.bin,'win32'),{...orig,cmd:'scip-java'});
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
