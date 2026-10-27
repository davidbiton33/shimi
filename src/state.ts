import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Config, GitSnapshot, PackStatus, Session, WatcherInfo } from './types.js';
import { createCheckpoint, latestCheckpoint } from './checkpoint.js';
import { event } from './journal.js';
import { gitSnapshot } from './git.js';
import { buildPack } from './pack.js';
import { tryAutoScip } from './scip-refresh.js';
import { updateProject } from './profile.js';
import { now, pathFor, readJson, readText, saveJson, sha, writeAtomic } from './utils.js';
import { memoryHandoff } from './memory.js';
import { noteHandoff } from './session-notes.js';

export function getSession(root:string):Session|null {return readJson<Session|null>(pathFor(root,'runtime','session.json'),null);}
export function saveSession(root:string,session:Session) {saveJson(pathFor(root,'runtime','session.json'),session);}
export function getWatcher(root:string):WatcherInfo|null{return readJson<WatcherInfo|null>(pathFor(root,'runtime','watcher.json'),null);}
export function writeChanged(root:string,git:GitSnapshot){
 const lines=['# Changed Files','',`Branch: ${git.branch}`,`HEAD: ${git.head||'(no commit)'}`,`Updated: ${git.timestamp}`,'','## Modified / deleted',...git.changed.map(x=>`- ${x}`),'','## Staged',...git.staged.map(x=>`- ${x}`),'','## Untracked',...git.untracked.map(x=>`- ${x}`),''];
 writeAtomic(pathFor(root,'CHANGED_FILES.md'),lines.join('\n'));
}
export function writeSessionDoc(root:string,session:Session,git:GitSnapshot){
  const lines=['# AgentOS Session','',`ID: ${session.id}`,`State: ${session.state}`,`Started: ${session.startedAt}`,`Updated: ${session.updatedAt}`,`Branch: ${git.branch}`,`HEAD: ${git.head||'(no commit)'}`,`Pack: ${session.packStatus}`,`Last checkpoint: ${session.lastCheckpoint||'(none)'}`,`Task: ${session.task||'(not set)'}`,'',`Changed: ${git.changed.length}; staged: ${git.staged.length}; untracked: ${git.untracked.length}`,''];
  if(session.endedAt)lines.push(`Ended: ${session.endedAt}`);
  if(session.lastError)lines.push(`Warning: ${session.lastError}`);
  writeAtomic(pathFor(root,'SESSION.md'),lines.join('\n')+'\n');
}
export function refresh(root:string,config:Config,session:Session,git:GitSnapshot,makePack=true){
  const profile=updateProject(root);
  writeChanged(root,git);
  if(makePack){tryAutoScip(root);const pack=buildPack(root,config,profile,git);session.packStatus=pack.status;session.lastError=pack.status==='error'?pack.message:undefined;}
  session.updatedAt=now();
  session.branch=git.branch;session.head=git.head;
  session.task=readText(pathFor(root,'AI_TASK.md')).trim().replace(/^#.*\n?/, '').trim().slice(0,300);
  writeSessionDoc(root,session,git);saveSession(root,session);
  return session;
}
export function writeHandoff(root:string,session:Session,git:GitSnapshot){
  const checkpoint=latestCheckpoint(root);
  const lines=['# AgentOS Handoff','',`Session: ${session.id}`,`State: ${session.state}`,`Branch: ${git.branch}`,`HEAD: ${git.head||'(no commit)'}`,`Checkpoint: ${checkpoint?.id||'(none)'}`,`Pack: ${session.packStatus}`,'','## Current task',readText(pathFor(root,'AI_TASK.md')),'','## Recent changes',...([...git.changed,...git.untracked].map(x=>`- ${x}`)),'','## Explicit session decisions and intent',noteHandoff(root,session.id),'','## Recorded project facts and decisions (user/agent assertions, verify against source)',memoryHandoff(root),'','## Resume protocol','1. Read .ai/AI_RULES.md and .ai/AI_CONTEXT.md.','2. Read .ai/AI_TASK.md and .ai/SESSION.md.','3. Inspect .ai/packs/current-task.md and .ai/CHANGED_FILES.md.','4. Verify Git HEAD, branch and uncommitted changes before coding.','5. Record next steps in .ai/AI_TASK.md.',''];
  writeAtomic(pathFor(root,'AI_HANDOFF.md'),lines.join('\n'));
}
export function exportHandoff(root:string){
  const files=['AI_RULES.md','AI_CONTEXT.md','AI_TASK.md','SESSION.md','AI_HANDOFF.md','PROJECT_MAP.md','CHANGED_FILES.md','PROJECT_PROFILE.json','packs/current-task.md'];
  const content=['# AgentOS Portable Handoff','',...files.flatMap(f=>[`\n---\n\n## .ai/${f}\n\n`,readText(pathFor(root,f))||'(missing)'])].join('\n');
  const path=pathFor(root,'exports','handoff.md');
  writeAtomic(path,content);return path;
}
export function initialTask(root:string) {
  const file=pathFor(root,'AI_TASK.md');if(!existsSync(file))writeAtomic(file,'# Current task\n\nDescribe the active task, constraints and next steps here.\n');
}
