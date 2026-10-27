import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { Config, Session } from './types.js';
import { createCheckpoint, latestCheckpoint } from './checkpoint.js';
import { loadConfig, saveDefaultConfig } from './config.js';
import { gitAvailable, gitSnapshot, gitTop, isGitRepo } from './git.js';
import { syncGitignore, syncIgnores } from './ignore.js';
import { event } from './journal.js';
import { updateProject } from './profile.js';
import { generateRules } from './rules.js';
import { exportHandoff, getSession, getWatcher, initialTask, refresh, saveSession, writeChanged, writeHandoff, writeSessionDoc } from './state.js';
import { now, pathFor, readText, uid, writeAtomic } from './utils.js';
import { isProcessAlive, startDetachedWatcher, stopWatcher, watcherAlive } from './watcher.js';
import { withProjectLock, withProjectLockSync } from './lock.js';
import { treeSitterStatus } from './treesitter.js';

export function findRoot(cwd:string):string {
  let p=resolve(cwd);
  for(;;){if(existsSync(join(p,'agentos.yml')))return p;const up=dirname(p);if(up===p)return resolve(cwd);p=up;}
}
export function init(root:string) {
  if(existsSync(join(root,'agentos.yml')))throw new Error('Already initialized. Existing agentos.yml was not overwritten.');
  for(const dir of ['packs','checkpoints','journal','exports','runtime'])mkdirSync(pathFor(root,dir),{recursive:true});
  saveDefaultConfig(root);
  syncIgnores(root,[]);syncGitignore(root);
  const defaults:Record<string,string>={
    'AI_RULES.md':'# AI Rules\n\nGit is the source of truth. Read AI_CONTEXT, AI_TASK, SESSION, HANDOFF and pack before coding. Preserve decisions in project files. Verify tests before claiming success.\n',
    'AI_CONTEXT.md':'# Project Context\n\nRecord architectural decisions, known constraints, and conventions here.\n',
    'AI_HANDOFF.md':'# AgentOS Handoff\n\nNo completed session yet.\n',
    'SESSION.md':'# AgentOS Session\n\nState: idle\n',
    'CHANGED_FILES.md':'# Changed Files\n\nNo session active.\n'
  };
  for(const [file,contents] of Object.entries(defaults))if(!existsSync(pathFor(root,file)))writeAtomic(pathFor(root,file),contents);
  initialTask(root);
  const config=loadConfig(root);
  const adapters=generateRules(root,config.editorOrder);
  const profile=updateProject(root);
  event(root,'initialized',{name:profile.name,adapters});
  return {root,name:profile.name,frameworks:profile.frameworks,adapters,git:isGitRepo(root)};
}
export function requireGit(root:string){
 if(!gitAvailable(root))throw new Error('Git is not installed.');
 if(!isGitRepo(root))throw new Error('Not a Git repository. Run `git init` yourself first.');
}
export async function start(root:string,background=true) {
 return withProjectLock(root,async()=>{
  const cfg=loadConfig(root);requireGit(root);
  const prev=getSession(root);
  if(prev?.state==='active'){
    // Upgrade an active v0.2 session to native packing without losing its identity.
    if(prev.packStatus==='repomix-missing')refresh(root,cfg,prev,gitSnapshot(root),true);
    const pid=(background&&cfg.watcher.autoStart&&!watcherAlive(root,prev.id))?startDetachedWatcher(root,prev):getWatcher(root)?.pid||null;
    return {session:prev,reused:true,watcherPid:pid};
  }
  syncIgnores(root,cfg.customIgnore);syncGitignore(root);
  const git=gitSnapshot(root);
  const session:Session={id:uid(),state:'active',startedAt:now(),updatedAt:now(),branch:git.branch,head:git.head,task:'',lastCheckpoint:null,packStatus:'disabled'};
  refresh(root,cfg,session,git,true);
  session.lastCheckpoint=createCheckpoint(root,cfg,session,git,'start');
  saveSession(root,session);writeSessionDoc(root,session,git);
  event(root,'session_started',{session:session.id});
  const watcherPid=background && cfg.watcher.autoStart ? startDetachedWatcher(root,session) : null;
  return {session,reused:false,watcherPid};
 });
}
export async function end(root:string) {
 return withProjectLock(root,async()=>{
 const cfg=loadConfig(root);requireGit(root);
 const session=getSession(root);
 if(!session||session.state!=='active')throw new Error('No active session. Run `agentos start` first.');
 const watcherStopped=await stopWatcher(root,session.id);
 const git=gitSnapshot(root);
 refresh(root,cfg,session,git,true);
 session.state='ended';session.endedAt=now();session.updatedAt=now();
 session.lastCheckpoint=createCheckpoint(root,cfg,session,git,'end');
 saveSession(root,session);writeSessionDoc(root,session,git);
 writeHandoff(root,session,git);
 const exported=exportHandoff(root);
 event(root,'session_ended',{session:session.id,checkpoint:session.lastCheckpoint});
 return {session,exported,watcherStopped,warning:watcherStopped?undefined:'Watcher stop is pending; the daemon will exit after observing the ended session.'};
 });
}
export function status(root:string) {
 const session=getSession(root), watch=getWatcher(root), checkpoint=latestCheckpoint(root);
 return {root,initialized:existsSync(join(root,'agentos.yml')),session,watcher:{running:watcherAlive(root),pid:watch?.pid||null},latestCheckpoint:checkpoint?{id:checkpoint.id,createdAt:checkpoint.createdAt,reason:checkpoint.reason}:null,pack:existsSync(pathFor(root,'packs','current-task.md'))};
}
export function doctor(root:string) {
 const checks:{name:string;ok:boolean;message:string;required:boolean}[]=[];
 checks.push({name:'Node.js',ok:Number(process.versions.node.split('.')[0])>=20,message:process.version,required:true});
 checks.push({name:'Git',ok:gitAvailable(root),message:gitAvailable(root)?'Installed':'Not on PATH',required:true});
 checks.push({name:'Git repository',ok:isGitRepo(root),message:gitTop(root)||'Not a working tree',required:true});
 let cfg:Config|null=null;let err='';try{cfg=loadConfig(root);}catch(e){err=String(e);}
 checks.push({name:'Configuration',ok:!!cfg,message:cfg?'agentos.yml valid':err,required:true});
 checks.push({name:'Native context packer',ok:!!cfg?.packer.enabled,message:cfg?.packer.enabled?'Bundled TS AST + multilingual parser registry; no extra runtime npm packages':'Disabled in config',required:false});
 const wasm=treeSitterStatus();
 checks.push({name:'Bundled Tree-sitter WASM',ok:wasm.runtime==='ready'&&wasm.grammars.length===11,message:`${wasm.runtime}: ${wasm.grammars.length}/11 grammars loaded${Object.keys(wasm.failed).length?' (check parsers --json for failures)':''}`,required:false});
 const session=getSession(root);
 checks.push({name:'Project profile',ok:existsSync(pathFor(root,'PROJECT_PROFILE.json')),message:'Generated by init/start',required:false});
 checks.push({name:'Context pack',ok:existsSync(pathFor(root,'packs','current-task.md')),message:'Generated by start/pack',required:false});
 checks.push({name:'Checkpoint',ok:!!latestCheckpoint(root),message:'Generated by start/checkpoint',required:false});
 checks.push({name:'Watcher',ok:!session||session.state!=='active'||watcherAlive(root,session.id),message:session?.state==='active'?'Expected when session is active':'No active session',required:false});
 return {healthy:checks.filter(c=>c.required).every(c=>c.ok),checks};
}
export function checkpoint(root:string) {
 return withProjectLockSync(root,()=>{
 const cfg=loadConfig(root);requireGit(root);
 const session=getSession(root);if(!session||session.state!=='active')throw new Error('No active session');
 const git=gitSnapshot(root);session.lastCheckpoint=createCheckpoint(root,cfg,session,git,'manual');
 session.updatedAt=now();saveSession(root,session);writeSessionDoc(root,session,git);
 return session.lastCheckpoint;
 });
}
export function pack(root:string){
 return withProjectLockSync(root,()=>{
 const cfg=loadConfig(root);requireGit(root);
 const git=gitSnapshot(root);
 const session=getSession(root)||{id:'manual',state:'idle' as const,startedAt:now(),updatedAt:now(),branch:git.branch,head:git.head,task:'',lastCheckpoint:null,packStatus:'disabled' as const};
 refresh(root,cfg,session,git,true);return {status:session.packStatus,error:session.lastError};
 });
}
export function rules(root:string){const cfg=loadConfig(root);return generateRules(root,cfg.editorOrder);}
export function handoff(root:string){
 return withProjectLockSync(root,()=>{
 const session=getSession(root);if(!session)throw new Error('No session yet. Run `agentos start`.');
 const git=gitSnapshot(root);writeHandoff(root,session,git);
 return exportHandoff(root);
 });
}
