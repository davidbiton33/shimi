import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaults, configText, parseConfig, loadConfig } from '../src/config.js';
import { init, start, end, status, checkpoint, doctor, pack, rules, handoff } from '../src/commands.js';
import { mergeManaged } from '../src/ignore.js';
import { gitSnapshot } from '../src/git.js';
import { detectProject } from '../src/profile.js';
import { matchGlob, PackManifest } from '../src/pack.js';
import { getSession } from '../src/state.js';
import { isProcessAlive } from '../src/watcher.js';

const git=(cwd:string,...args:string[])=>execFileSync('git',args,{cwd,stdio:['ignore','pipe','pipe'],encoding:'utf8'}).trim();
function fixture(){
  const root=mkdtempSync(join(tmpdir(),'agentos-test-'));
  git(root,'init','-q');git(root,'config','user.email','test@example.com');git(root,'config','user.name','Test');
  mkdirSync(join(root,'src'));
  writeFileSync(join(root,'package.json'),JSON.stringify({name:'fixture',dependencies:{react:'*',vite:'*'}}));
  writeFileSync(join(root,'vite.config.ts'),'export default {}');
  writeFileSync(join(root,'src','index.ts'),'export const answer = 42;\n');
  git(root,'add','.');git(root,'commit','-qm','initial');
  return root;
}

test('strict configuration roundtrip and constraints',()=>{
 const parsed=parseConfig(configText());assert.deepEqual(parsed,defaults);
 assert.throws(()=>parseConfig('version: 5'),/version/);
 assert.throws(()=>parseConfig('version: 1\nrepomix:\n  ignore: [oops]'),/Bad YAML scalar/);
 assert.throws(()=>parseConfig('version: 1\n  bogus: true'),/Unexpected indentation|Unknown/);
 assert.throws(()=>parseConfig('watcher:\n  intervalSeconds: 0'),/intervalSeconds/);
});

test('managed markers preserve custom content; partial blocks refuse overwrite',()=>{
 const before='user rules\n# >>> AGENTOS MANAGED >>>\nold\n# <<< AGENTOS MANAGED <<<\nuser after\n';
 const after=mergeManaged(before,['new']);
 assert.match(after,/user rules/);assert.match(after,/user after/);assert.doesNotMatch(after,/old/);
 assert.throws(()=>mergeManaged('# >>> AGENTOS MANAGED >>>\nhello',['a']),/incomplete/);
});

test('init writes project memory and adapters without overwriting user documents',()=>{
 const root=fixture();try{
 writeFileSync(join(root,'CLAUDE.md'),'# Existing valuable instructions\n');
 const a=init(root);assert.equal(a.name,'fixture');assert.ok(a.frameworks.includes('React'));
 assert.ok(a.frameworks.includes('Vite'));
 assert.equal(a.git,true);
 assert.match(readFileSync(join(root,'CLAUDE.md'),'utf8'),/Existing valuable instructions/);
 assert.ok(existsSync(join(root,'.cursor','rules','agentos.mdc')));
 assert.ok(readFileSync(join(root,'.cursor','rules','agentos.mdc'),'utf8').startsWith('---\n'));
 assert.ok(existsSync(join(root,'.ai','PROJECT_PROFILE.json')));
 assert.match(readFileSync(join(root,'.gitignore'),'utf8'),/AGENTOS MANAGED/);
 assert.throws(()=>init(root),/Already initialized/);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('Git tracks uncommitted changes, spaces and task files',()=>{
 const root=fixture();try{
 init(root);writeFileSync(join(root,'src','index.ts'),'export const answer = 43;\n');
 writeFileSync(join(root,'file with space.ts'),'const x = 1;');
 const snapshot=gitSnapshot(root);
 assert.ok(snapshot.changed.includes('src/index.ts'));assert.ok(snapshot.untracked.includes('file with space.ts'));
 assert.equal(snapshot.branch==='(detached)',false);
 const profile=detectProject(root);assert.ok(profile.languages.includes('TypeScript'));
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('end-to-end session + checkpoint + portable handoff without external packer',async()=>{
 const root=fixture();try{
 init(root);
 writeFileSync(join(root,'.ai','AI_TASK.md'),'# Current task\n\nUpdate src/index.ts and test.\n');
 const res=await start(root,false);assert.equal(res.session.state,'active');
 assert.equal(res.session.packStatus,'ready');
 assert.ok(existsSync(join(root,'.ai','packs','current-task.md')));
 const first=checkpoint(root);assert.ok(first);
 writeFileSync(join(root,'src','index.ts'),'export const answer = 44;\n');
 const done=await end(root);assert.equal(done.session.state,'ended');
 assert.ok(done.session.lastCheckpoint);assert.ok(existsSync(done.exported));
 assert.match(readFileSync(join(root,'.ai','AI_HANDOFF.md'),'utf8'),/src\/index.ts/);
 assert.match(readFileSync(done.exported,'utf8'),/Update src\/index.ts/);
 assert.match(readFileSync(join(root,'.ai','packs','current-task.md'),'utf8'),/export const answer = 44/);
 assert.equal(status(root).session?.state,'ended');
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('doctor verifies native packer availability',()=>{
 const root=fixture();try{
 init(root);const report=doctor(root);assert.equal(report.healthy,true);
 assert.equal(report.checks.find(x=>x.name==='Native context packer')?.ok,true);
 assert.equal(report.checks.find(x=>x.name==='Configuration')?.ok,true);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('reuse active session instead of discarding earlier context',async()=>{
 const root=fixture();try{
 init(root);const a=await start(root,false);const b=await start(root,false);
 assert.equal(a.session.id,b.session.id);assert.equal(b.reused,true);
 const exported=handoff(root);assert.ok(existsSync(exported));
 assert.equal(rules(root).length>=7,true);
 await end(root);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('checkpoint pruning respects configuration',async()=>{
 const root=fixture();try{
 init(root);
 let c=readFileSync(join(root,'agentos.yml'),'utf8');c=c.replace('keep: 30','keep: 2');writeFileSync(join(root,'agentos.yml'),c);
 await start(root,false);for(let i=0;i<6;i++)checkpoint(root);
 const files=(await import('node:fs')).readdirSync(join(root,'.ai','checkpoints')).filter(x=>x.endsWith('.json'));
 assert.equal(files.length,2);await end(root);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('start refuses to run outside a Git working tree',async()=>{
 const root=mkdtempSync(join(tmpdir(),'agentos-notgit-'));
 try{init(root);await assert.rejects(()=>start(root,false),/Not a Git repository/);}
 finally{rmSync(root,{recursive:true,force:true});}
});

test('native engine integrates into start/pack/end without any external packer',async()=>{
 const root=fixture();try{
 init(root);
 const initial=await start(root,false);
 assert.equal(initial.session.packStatus,'ready');
 const output=readFileSync(join(root,'.ai','packs','current-task.md'),'utf8');
 assert.match(output,/AgentOS — Native Context Pack/);
 assert.match(output,/export const answer = 42/);
 assert.match(output,/vite.config.ts/);
 const manifest=JSON.parse(readFileSync(join(root,'.ai','packs','current-task.manifest.json'),'utf8')) as PackManifest;
 assert.equal(manifest.engine,'agentos-native');
 assert.ok(manifest.entries.some(e=>e.path==='src/index.ts'));
 assert.equal(pack(root).status,'ready');
 await end(root);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('detached CLI watcher observes edits and shuts down on end',async()=>{
 const root=fixture();try{
 init(root);
 const cfgPath=join(root,'agentos.yml');
 writeFileSync(cfgPath,readFileSync(cfgPath,'utf8').replace('intervalSeconds: 10','intervalSeconds: 1').replace('checkpointSeconds: 120','checkpointSeconds: 1').replace('packDebounceSeconds: 20','packDebounceSeconds: 0'));
 const executable=join(process.cwd(),'dist','src','cli.js');
 const cli=(...args:string[])=>JSON.parse(execFileSync(process.execPath,[executable,...args,'--cwd',root,'--json'],{cwd:root,encoding:'utf8'}));
 const started=cli('start');assert.ok(started.watcherPid);
 assert.equal(isProcessAlive(started.watcherPid),true);
 writeFileSync(join(root,'src','index.ts'),'export const answer = 56;\n');
 let changed=false;
 for(let n=0;n<35;n++){
  await new Promise(r=>setTimeout(r,150));
  if(readFileSync(join(root,'.ai','CHANGED_FILES.md'),'utf8').includes('src/index.ts')) {changed=true;break;}
 }
 assert.ok(changed,'watcher should notice source edits');
 let packedChange=false;
 for(let n=0;n<20;n++){
  if(readFileSync(join(root,'.ai','packs','current-task.md'),'utf8').includes('src/index.ts')){packedChange=true;break;}
  await new Promise(r=>setTimeout(r,100));
 }
 assert.ok(packedChange,'watcher should repack even if edit races with startup');
 const ended=cli('end');assert.equal(ended.session.state,'ended');
 assert.equal(status(root).watcher.running,false);
 }finally{
  const watcher=status(root).watcher;
  if(watcher.running&&watcher.pid)try{process.kill(watcher.pid,'SIGTERM');}catch{}
  rmSync(root,{recursive:true,force:true});
 }
});

import { withProjectLock, withProjectLockSync, ProjectBusyError } from '../src/lock.js';
import { stopWatcher, watcherAlive } from '../src/watcher.js';
import { spawn } from 'node:child_process';
import { saveJson, pathFor } from '../src/utils.js';
import { utimesSync } from 'node:fs';

test('project lock serializes competing session starts',async()=>{
 const root=fixture();try{
  init(root);
  const [a,b]=await Promise.all([start(root,false),start(root,false)]);
  assert.equal(a.session.id,b.session.id);
  assert.equal([a.reused,b.reused].filter(x=>x).length,1);
  assert.ok(!existsSync(pathFor(root,'runtime','project.lock')),'lock must be released');
  await end(root);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('sync operation refuses a lock held by another action and lock is released on errors',async()=>{
 const root=fixture();try{
  init(root);
  await withProjectLock(root,async()=>{
    assert.throws(()=>withProjectLockSync(root,()=>checkpoint(root)),ProjectBusyError);
  });
  assert.throws(()=>withProjectLockSync(root,()=>{throw new Error('deliberate failure');}),/deliberate failure/);
  assert.doesNotThrow(()=>withProjectLockSync(root,()=>42));
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('stale lock owned by dead process is reclaimed safely',async()=>{
 const root=fixture();try{
  init(root);
  const lock=pathFor(root,'runtime','project.lock');
  mkdirSync(lock);writeFileSync(join(lock,'owner.json'),JSON.stringify({host:(await import('node:os')).hostname(),pid:999999999,token:'stale',createdAt:'2000-01-01'}));
  const old=new Date(Date.now()-5000);utimesSync(lock,old,old);
  const result=await start(root,false);assert.equal(result.session.state,'active');
  assert.equal(existsSync(lock),false);
  await end(root);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('cooperative stale watcher cleanup never sends signals to a reused PID',async()=>{
 const root=fixture();
 const other=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
 try{
  init(root);assert.ok(other.pid);
  saveJson(pathFor(root,'runtime','watcher.json'),{pid:other.pid,sessionId:'a',nonce:'x',startedAt:'2000-01-01T00:00:00Z',updatedAt:'2000-01-01T00:00:00Z'});
  assert.equal(watcherAlive(root),false);
  assert.equal(await stopWatcher(root),true);
  assert.equal(isProcessAlive(other.pid!),true,'must not kill unrelated process');
  assert.equal(existsSync(pathFor(root,'runtime','watcher.json')),false);
 }finally{other.kill('SIGTERM');rmSync(root,{recursive:true,force:true});}
});


test('native glob matcher handles nested, root and exact matches deterministically',()=>{
 assert.equal(matchGlob('src/x.ts','src/**/*'),true);
 assert.equal(matchGlob('src/deep/x.ts','src/**/*'),true);
 assert.equal(matchGlob('src/x.ts','src/*.ts'),true);
 assert.equal(matchGlob('src/deep/x.ts','src/*.ts'),false);
 assert.equal(matchGlob('.env','**/.env'),true);
 assert.equal(matchGlob('sub/.env','**/.env'),true);
 assert.equal(matchGlob('package.json','package.json'),true);
 assert.equal(matchGlob('src/package.json','package.json'),true);
 assert.equal(matchGlob('src/test.ts','!src/**'),false);
});

test('native packer blocks git-tracked secrets and inline tokens',async()=>{
 const root=fixture();try{
 writeFileSync(join(root,'.env'),'PASSWORD=hunter2\n');
 const fakeToken = "ghp_" + "abcdefghijklmnopqrstuvwxzy123456"; // synthetic test fixture only
 writeFileSync(join(root,'src','auth.ts'), `export const token = "${fakeToken}";\nexport const safe=42;\n`);
 git(root,'add','-f','.env','src/auth.ts');git(root,'commit','-qm','test secret');
 init(root);await start(root,false);
 const packed=readFileSync(join(root,'.ai','packs','current-task.md'),'utf8');
 const manifest=JSON.parse(readFileSync(join(root,'.ai','packs','current-task.manifest.json'),'utf8')) as PackManifest;
 assert.ok(!packed.includes("hunter2") && !packed.includes(fakeToken));
 assert.match(packed,/REDACTED BY AGENTOS/);
 assert.ok(!manifest.entries.some(e=>e.path==='.env')); // sensitive files are never packed even if Git tracks them
 assert.ok(manifest.entries.some(e=>e.path==='src/auth.ts'&&e.redactedLines===1));
 await end(root);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('native packer does not follow tracked symlinks or embed binary data',async()=>{
 const root=fixture();const outside=mkdtempSync(join(tmpdir(),'agentos-outside-'));
 try{
 writeFileSync(join(outside,'secret.ts'),'TOP_SECRET_OUTSIDE_ROOT');
 symlinkSync(join(outside,'secret.ts'),join(root,'src','external.ts'));
 writeFileSync(join(root,'src','binary.ts'),Buffer.from([0,1,2,3,4]));
 git(root,'add','src/external.ts','src/binary.ts');git(root,'commit','-qm','malicious fixture');
 init(root);await start(root,false);
 const output=readFileSync(join(root,'.ai','packs','current-task.md'),'utf8');
 const manifest=JSON.parse(readFileSync(join(root,'.ai','packs','current-task.manifest.json'),'utf8')) as PackManifest;
 assert.doesNotMatch(output,/TOP_SECRET_OUTSIDE_ROOT/);
 assert.ok(manifest.skipped.some(e=>e.path==='src/external.ts'&&e.reason==='unsafe-link-or-unreadable'));
 assert.ok(manifest.skipped.some(e=>e.path==='src/binary.ts'&&e.reason==='binary-or-invalid-utf8'));
 await end(root);
 }finally{rmSync(root,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
});

test('native pack budgets limit file count and preserve priority for task hints',async()=>{
 const root=fixture();try{
 writeFileSync(join(root,'src','important.ts'),'export const important = "keep";\n');
 writeFileSync(join(root,'src','optional.ts'),'export const optional = "ignore";\n');
 git(root,'add','.');git(root,'commit','-qm','more sources');
 init(root);
 writeFileSync(join(root,'.ai','AI_TASK.md'),'# Task\n\nFix src/important.ts and inspect src/optional.ts');
 let config=readFileSync(join(root,'agentos.yml'),'utf8');
 config=config.replace('maxFiles: 200','maxFiles: 1');
 writeFileSync(join(root,'agentos.yml'),config);
 await start(root,false);
 const manifest=JSON.parse(readFileSync(join(root,'.ai','packs','current-task.manifest.json'),'utf8')) as PackManifest;
 assert.equal(manifest.entries.length,1);
 assert.equal(manifest.entries[0].path,'src/important.ts');
 assert.equal(manifest.truncated,true);
 assert.ok(manifest.skipped.some(e=>e.reason==='max-files'));
 await end(root);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('native packer honors custom ignore even for changed tracked files',async()=>{
 const root=fixture();try{
 init(root);
 writeFileSync(join(root,'src','private.ts'),'SECRET_CONTENT_SHOULD_NOT_PACK\n');
 let config=readFileSync(join(root,'agentos.yml'),'utf8');
 config=config.replace('  ignore: []','  ignore: ["src/private.ts"]');
 writeFileSync(join(root,'agentos.yml'),config);
 await start(root,false);
 const packed=readFileSync(join(root,'.ai','packs','current-task.md'),'utf8');
 assert.doesNotMatch(packed,/SECRET_CONTENT_SHOULD_NOT_PACK/);
 await end(root);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('legacy Repomix configuration migrates without external executable',()=>{
 const old='version: 1\nrepomix:\n  enabled: true\n  compress: false\n  include: ["src/**"]\n  ignore: ["tests/**"]\n  timeoutSeconds: 60\n';
 const migrated=parseConfig(old);
 assert.equal(migrated.packer.enabled,true);
 assert.deepEqual(migrated.packer.include,['src/**']);
 assert.deepEqual(migrated.packer.ignore,['tests/**']);
 assert.throws(()=>parseConfig(old+'packer:\n  enabled: true\n'),/either packer or legacy/);
});

test('native packer sanitizes task text and respects pack size cap',async()=>{
 const root=fixture();try{
 init(root);
 writeFileSync(join(root,'.ai','AI_TASK.md'),'# Task\n\nUse sk-abcdefghijklmnop1234567890 as test key\n');
 await start(root,false);
 let packed=readFileSync(join(root,'.ai','packs','current-task.md'),'utf8');
 assert.doesNotMatch(packed,/sk-abcdefghijklmnop1234567890/);
 assert.match(packed,/REDACTED BY AGENTOS/);
 const before=packed;
 let c=readFileSync(join(root,'agentos.yml'),'utf8');c=c.replace('maxOutputBytes: 1048576','maxOutputBytes: 1024');writeFileSync(join(root,'agentos.yml'),c);
 writeFileSync(join(root,'.ai','AI_TASK.md'),'x'.repeat(2000));
 assert.equal(pack(root).status,'error');
 packed=readFileSync(join(root,'.ai','packs','current-task.md'),'utf8');
 assert.equal(packed,before,'oversized task must retain last successful pack');
 await end(root);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('native pack output and manifest remain byte-stable for unchanged Git state',async()=>{
 const root=fixture();try{
 init(root);await start(root,false);
 const p=join(root,'.ai','packs','current-task.md');
 const m=join(root,'.ai','packs','current-task.manifest.json');
 const a=readFileSync(p);const x=readFileSync(m);
 assert.equal(pack(root).status,'ready');
 assert.deepEqual(readFileSync(p),a);
 assert.deepEqual(readFileSync(m),x);
 await end(root);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('private key blocks and JSON-quoted credential values are fully redacted',async()=>{
 const root=fixture();try{
 writeFileSync(join(root,'src','authconfig.ts'),[
 'export const privateKey=`-----BEGIN PRIVATE KEY-----',
 'MII_SECRET_BODY_SHOULD_NEVER_ESCAPE',
 '-----END PRIVATE KEY-----`;',
 'export const config={"apiKey": "supersecretvalue123456"};',
 'export const harmless = "kept";',
 ''].join('\n'));
 git(root,'add','.');git(root,'commit','-qm','inline credential fixture');
 init(root);await start(root,false);
 const output=readFileSync(join(root,'.ai','packs','current-task.md'),'utf8');
 assert.doesNotMatch(output,/MII_SECRET_BODY_SHOULD_NEVER_ESCAPE|supersecretvalue123456/);
 assert.match(output,/harmless/);
 const manifest=JSON.parse(readFileSync(join(root,'.ai','packs','current-task.manifest.json'),'utf8')) as PackManifest;
 assert.equal(manifest.entries.find(e=>e.path==='src/authconfig.ts')?.redactedLines,4);
 await end(root);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('native packer blocks secret directories even when explicitly requested',async()=>{
 const root=fixture();try{
 mkdirSync(join(root,'secrets'));
 writeFileSync(join(root,'secrets','connection.ts'),'SHOULD_STAY_SECRET');
 git(root,'add','secrets/connection.ts');git(root,'commit','-qm','secret directory fixture');
 init(root);
 const config=readFileSync(join(root,'agentos.yml'),'utf8').replace('  include: []','  include: ["secrets/**/*"]');
 writeFileSync(join(root,'agentos.yml'),config);
 await start(root,false);
 assert.doesNotMatch(readFileSync(join(root,'.ai','packs','current-task.md'),'utf8'),/SHOULD_STAY_SECRET/);
 const manifest=JSON.parse(readFileSync(join(root,'.ai','packs','current-task.manifest.json'),'utf8')) as PackManifest;
 assert.ok(manifest.skipped.some(e=>e.path==='secrets/connection.ts'&&e.reason==='ignored'));
 await end(root);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('active v0.2 session upgrades native pack without losing session identity',async()=>{
 const root=fixture();try{
 init(root);
 const initial=await start(root,false);
 const session={...initial.session,packStatus:'repomix-missing' as const};
 saveJson(pathFor(root,'runtime','session.json'),session);
 let cfg=readFileSync(join(root,'agentos.yml'),'utf8');
 cfg=cfg.replace(/packer:\n(?:  .*\n)+/, 'repomix:\n  enabled: true\n  include: ["src/**/*"]\n  ignore: []\n  compress: false\n  timeoutSeconds: 120\n');
 writeFileSync(join(root,'agentos.yml'),cfg);
 const upgraded=await start(root,false);
 assert.equal(upgraded.session.id,initial.session.id);
 assert.equal(upgraded.session.packStatus,'ready');
 assert.equal(upgraded.reused,true);
 assert.match(readFileSync(pathFor(root,'packs','current-task.md'),'utf8'),/Native Context Pack/);
 await end(root);
 }finally{rmSync(root,{recursive:true,force:true});}
});
