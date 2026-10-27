import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Config, GitSnapshot, Session, Checkpoint } from './types.js';
import { event } from './journal.js';
import { now, pathFor, readText, saveJson, sha, uid } from './utils.js';

export function createCheckpoint(root:string,config:Config,session:Session,git:GitSnapshot,reason:string) {
  const stamp=now(); const id=`${stamp.replace(/[:.]/g,'-')}-${uid()}`;
  const snapshot:Checkpoint={id,createdAt:stamp,reason,sessionId:session.id,branch:git.branch,head:git.head,changed:git.changed,staged:git.staged,untracked:git.untracked,fingerprint:git.fingerprint,taskHash:sha(readText(pathFor(root,'AI_TASK.md'))),packStatus:session.packStatus};
  const dir=pathFor(root,'checkpoints');
  saveJson(join(dir,id+'.json'),snapshot);
  const files=readdirSync(dir).filter(s=>s.endsWith('.json')).sort();
  for(const file of files.slice(0,Math.max(0,files.length-config.checkpoints.keep)))rmSync(join(dir,file));
  event(root,'checkpoint',{checkpoint:id,reason,session:session.id});
  return id;
}
export function latestCheckpoint(root:string):Checkpoint|null {
  const dir=pathFor(root,'checkpoints');let files:string[]=[];
  try {files=readdirSync(dir).filter(s=>s.endsWith('.json')).sort();}catch{return null;}
  if(!files.length)return null;
  try{return JSON.parse(readText(join(dir,files[files.length-1]))) as Checkpoint;}catch{return null;}
}
