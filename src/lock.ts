import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathFor } from './utils.js';

/** Directory creation is an atomic, cross-platform exclusive lock primitive. */
export class ProjectBusyError extends Error {
  constructor(){ super('AgentOS project is being updated by another process. Retry shortly.'); this.name='ProjectBusyError'; }
}
type Owner = { pid:number; host:string; token:string; createdAt:string };
const STALE_EMPTY_MS=30_000;
function alive(pid:number){if(!Number.isInteger(pid)||pid<2)return false;try{process.kill(pid,0);return true;}catch(e){return (e as NodeJS.ErrnoException).code==='EPERM';}}
function acquire(root:string):()=>void {
  const dir=pathFor(root,'runtime','project.lock');
  mkdirSync(pathFor(root,'runtime'),{recursive:true});
  const owner:Owner={pid:process.pid,host:hostname(),token:randomUUID(),createdAt:new Date().toISOString()};
  for(let attempt=0;attempt<2;attempt++){
    try{mkdirSync(dir);}catch(e){
      if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;
      let former:Owner|null=null;
      try{former=JSON.parse(readFileSync(join(dir,'owner.json'),'utf8')) as Owner;}catch{}
      let age=0;try{age=Date.now()-statSync(dir).mtimeMs;}catch{}
      // Never steal from a known live owner. A fresh partially-created lock must also be respected.
      const definitelyDead=former?.host===hostname() && !alive(former.pid) && age>1000;
      const abandonedEmpty=!former && age>STALE_EMPTY_MS;
      if(attempt===0&&(definitelyDead||abandonedEmpty)){rmSync(dir,{recursive:true,force:true});continue;}
      throw new ProjectBusyError();
    }
    try{writeFileSync(join(dir,'owner.json'),JSON.stringify(owner),{flag:'wx',mode:0o600});}
    catch(e){rmSync(dir,{recursive:true,force:true});throw e;}
    return ()=>{
      try{
        const actual=JSON.parse(readFileSync(join(dir,'owner.json'),'utf8')) as Owner;
        if(actual.token===owner.token)rmSync(dir,{recursive:true,force:true});
      }catch{}
    };
  }
  throw new ProjectBusyError();
}
export function withProjectLockSync<T>(root:string,action:()=>T):T {
  const release=acquire(root);try{return action();}finally{release();}
}
export async function withProjectLock<T>(root:string,action:()=>Promise<T>|T,timeoutMs=15_000):Promise<T> {
  const deadline=Date.now()+timeoutMs;
  while(true){
    let release:()=>void;
    try{release=acquire(root);}catch(e){
      if(!(e instanceof ProjectBusyError)||Date.now()>=deadline)throw e;
      await new Promise(r=>setTimeout(r,75));continue;
    }
    try{return await action();}finally{release();}
  }
}
