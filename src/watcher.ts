import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';
import { Config, Session, WatcherInfo } from './types.js';
import { createCheckpoint, latestCheckpoint } from './checkpoint.js';
import { gitSnapshot, isGitRepo } from './git.js';
import { event } from './journal.js';
import { getSession, getWatcher, refresh, saveSession, writeSessionDoc } from './state.js';
import { ProjectBusyError, withProjectLockSync } from './lock.js';
import { epoch, now, pathFor, readJson, readText, saveJson, sha } from './utils.js';

const STOP_FILE='watcher-stop.json';
export function isProcessAlive(pid:number):boolean {
  if(!Number.isInteger(pid)||pid<2)return false;
  try{process.kill(pid,0);return true;}catch(e){return (e as NodeJS.ErrnoException).code==='EPERM';}
}
function sameWatcher(a:WatcherInfo|null,b:WatcherInfo|null){
  return !!a && !!b && a.pid===b.pid && a.sessionId===b.sessionId && a.nonce===b.nonce;
}
export function watcherAlive(root:string,sessionId?:string){
  const info=getWatcher(root);
  if(!info|| (sessionId&&info.sessionId!==sessionId)||!isProcessAlive(info.pid))return false;
  // A reused PID cannot keep a stale lease 'alive': require a fresh heartbeat.
  const maxAge=60_000;
  return Date.now()-epoch(info.updatedAt)<maxAge;
}
/** Cooperative stop: no OS signal to a PID which may have been reused by an unrelated process. */
export async function stopWatcher(root:string,sessionId?:string):Promise<boolean> {
  const info=getWatcher(root);
  if(!info|| (sessionId && info.sessionId!==sessionId))return false;
  if(!watcherAlive(root,info.sessionId)){
    if(sameWatcher(getWatcher(root),info))rmSync(pathFor(root,'runtime','watcher.json'),{force:true});
    return true;
  }
  if(info.pid===process.pid)return false;
  saveJson(pathFor(root,'runtime',STOP_FILE),{sessionId:info.sessionId,nonce:info.nonce||null,requestedAt:now()});
  for(let i=0;i<40;i++){
    if(!sameWatcher(getWatcher(root),info))return true;
    await new Promise(r=>setTimeout(r,100));
  }
  // Leave its lease intact: a slow daemon must not be mistaken for a stopped daemon.
  return false;
}
export function startDetachedWatcher(root:string,session:Session):number {
  if(watcherAlive(root,session.id))return getWatcher(root)!.pid;
  const nonce=randomUUID();
  const child=spawn(process.execPath,[fileURLToPath(new URL('./cli.js',import.meta.url)),'__watch','--cwd',root,'--session',session.id],{
    cwd:root,detached:true,stdio:'ignore',windowsHide:true
  });
  child.unref();
  if(!child.pid)throw new Error('Unable to spawn background watcher');
  saveJson(pathFor(root,'runtime','watcher.json'),{pid:child.pid,sessionId:session.id,nonce,startedAt:now(),updatedAt:now()} satisfies WatcherInfo);
  rmSync(pathFor(root,'runtime',STOP_FILE),{force:true});
  event(root,'watcher_started',{pid:child.pid,session:session.id});
  return child.pid;
}
export async function runWatchLoop(root:string,config:Config,sessionId:string):Promise<void> {
  if(!isGitRepo(root))throw new Error('Watcher requires a Git working tree');
  let stopping=false;
  const stop=()=>{stopping=true;};process.on('SIGINT',stop);process.on('SIGTERM',stop);
  const owner=getWatcher(root);
  // Foreground `agentos watch` is supported without a recorded background lease.
  const owned=owner?.pid===process.pid && owner.sessionId===sessionId?owner:null;
  const stopRequested=()=>{
    if(!owned)return false;
    const current=getWatcher(root);
    if(!sameWatcher(current,owned))return true;
    const request=readJson<{sessionId:string;nonce:string|null}|null>(pathFor(root,'runtime',STOP_FILE),null);
    return !!request && request.sessionId===sessionId && request.nonce===(owned.nonce||null);
  };
  let session=getSession(root);
  if(session?.id!==sessionId||session.state!=='active'){
    if(sameWatcher(getWatcher(root),owned))rmSync(pathFor(root,'runtime','watcher.json'),{force:true});
    return;
  }
  let lastGit=gitSnapshot(root);
  try{withProjectLockSync(root,()=>{
    const current=getSession(root);if(current?.id===sessionId&&current.state==='active')refresh(root,config,current,lastGit,false);
  });}catch(e){if(!(e instanceof ProjectBusyError))throw e;}
  let lastTask=sha(readText(pathFor(root,'AI_TASK.md')));
  let lastCheckpoint=Date.now();
  const startedDirty=latestCheckpoint(root)?.fingerprint!==lastGit.fingerprint;
  let lastPack=startedDirty?0:Date.now();
  let dirtyPack=startedDirty;
  let nextRun=Date.now()+config.watcher.intervalSeconds*1000;
  let lastHeartbeat=Date.now();
  try {
    while(!stopping && !stopRequested()){
      // Short sleeps make cooperative shutdown responsive even for long poll intervals.
      const wait=Math.max(0,Math.min(150,nextRun-Date.now()));
      if(wait>0)await new Promise(r=>setTimeout(r,wait));
      if(stopping||stopRequested())break;
      if(owned && Date.now()-lastHeartbeat>5000){
        const info=getWatcher(root);
        if(sameWatcher(info,owned))saveJson(pathFor(root,'runtime','watcher.json'),{...info,updatedAt:now()});
        lastHeartbeat=Date.now();
      }
      if(Date.now()<nextRun)continue;
      nextRun=Date.now()+config.watcher.intervalSeconds*1000;
      session=getSession(root);
      if(session?.id!==sessionId||session.state!=='active')break;
      try {
        const git=gitSnapshot(root),task=sha(readText(pathFor(root,'AI_TASK.md')));
        const changed=git.fingerprint!==lastGit.fingerprint||task!==lastTask;
        const shouldPack=dirtyPack && Date.now()-lastPack>=config.watcher.packDebounceSeconds*1000;
        const shouldCheckpoint=Date.now()-lastCheckpoint>=config.watcher.checkpointSeconds*1000;
        if(changed||shouldPack||shouldCheckpoint){
          try{withProjectLockSync(root,()=>{
            const current=getSession(root);
            if(current?.id!==sessionId||current.state!=='active')return;
            if(changed||shouldPack){
              refresh(root,config,current,git,shouldPack);
              if(shouldPack){dirtyPack=false;lastPack=Date.now();}
              if(changed){dirtyPack=true;event(root,'change_detected',{session:current.id,changedFiles:git.changed.length,untracked:git.untracked.length});}
            }
            if(shouldCheckpoint){
              current.lastCheckpoint=createCheckpoint(root,config,current,git,'periodic');
              current.updatedAt=now();saveSession(root,current);writeSessionDoc(root,current,git);
              lastCheckpoint=Date.now();
            }
            lastGit=git;lastTask=task;
          });}catch(e){if(!(e instanceof ProjectBusyError))throw e;}
        }
        const info=getWatcher(root);
        if(sameWatcher(info,owned))saveJson(pathFor(root,'runtime','watcher.json'),{...info,updatedAt:now()});
      } catch(e){event(root,'watcher_error',{error:String(e)});}
    }
  } finally {
    const info=getWatcher(root);
    if(sameWatcher(info,owned)){
      rmSync(pathFor(root,'runtime','watcher.json'),{force:true});
      const req=readJson<{nonce?:string|null}|null>(pathFor(root,'runtime',STOP_FILE),null);
      if(req?.nonce===(owned?.nonce||null))rmSync(pathFor(root,'runtime',STOP_FILE),{force:true});
    }
    event(root,'watcher_stopped',{session:sessionId});
    process.off('SIGINT',stop);process.off('SIGTERM',stop);
  }
}
