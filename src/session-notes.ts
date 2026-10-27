/** Agent/API supplied observations. Automatic Git evidence remains in journal/checkpoints. */
import {randomBytes} from 'node:crypto';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {withProjectLockSync} from './lock.js';
import {getSession} from './state.js';
import {now,pathFor,readJson,readText,saveJson,safeProjectPath} from './utils.js';
import {sanitize} from './pack.js';
export const NOTE_KINDS=['intent','decision','progress','blocker','next','verification'] as const;
export type NoteKind=typeof NOTE_KINDS[number];
export type SessionNote={id:string;sessionId:string;kind:NoteKind;text:string;source:string;createdAt:string};
const ID=/^[a-f0-9]{16}$/;
export function notePath(root:string,id:string){if(!ID.test(id))throw Error('Invalid session note id');return pathFor(root,'session-notes',id+'.json');}
function validate(root:string,input:{kind:string;text:string;source?:string}){
 if(!NOTE_KINDS.includes(input.kind as NoteKind))throw Error('Unsupported session note kind');
 if(typeof input.text!=='string'||!input.text.trim()||input.text.length>4000||input.text.includes('\0'))throw Error('Session note text must be 1–4000 characters');
 const session=getSession(root);if(!session||session.state!=='active')throw Error('An active session is required for capture');
 const source=input.source??'agent-explicit';if(typeof source!=='string'||!source||source.length>100)throw Error('Invalid note source');
 return {sessionId:session.id,kind:input.kind as NoteKind,text:sanitize(input.text.trim()).value,source};
}
function append(root:string,n:ReturnType<typeof validate>):SessionNote{
 const item:SessionNote={id:randomBytes(8).toString('hex'),...n,createdAt:now()};saveJson(notePath(root,item.id),item);return item;
}
export function captureNote(root:string,input:{kind:string;text:string;source?:string}){
 return withProjectLockSync(root,()=>{
  if(listNotes(root).length>=1000)throw Error('Session note limit reached (1000)');
  return append(root,validate(root,input));
 });
}
export function listNotes(root:string,sessionId?:string):SessionNote[]{
 let files:string[]=[];try{files=readdirSync(pathFor(root,'session-notes'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw e;}
 return files.filter(x=>x.endsWith('.json')&&ID.test(x.slice(0,-5))).map(x=>readJson<SessionNote|null>(notePath(root,x.slice(0,-5)),null)).filter((x):x is SessionNote=>x!==null)
 .filter(x=>!sessionId||x.sessionId===sessionId).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
}
export function captureStructuredTranscript(root:string,file:string){
 // Explicit opt-in only. JSONL has {kind,text} lines. Free-form transcripts are NOT silently processed.
 if(!file||file.length>400||file.includes('\0'))throw Error('Invalid transcript path');
 const full=safeProjectPath(root,file);if(statSync(full).size>1048576)throw Error('Transcript exceeds 1 MiB limit');
 const data=readFileSync(full,'utf8');if(data.length>1048576)throw Error('Transcript exceeds 1 MiB limit');
 const lines=data.split(/\r?\n/).filter(x=>x.trim());if(lines.length>150)throw Error('Too many transcript events');
 const parsed=lines.map((line,i)=>{let o:unknown;try{o=JSON.parse(line);}catch{throw Error('Invalid JSON on line '+(i+1));}
   if(!o||typeof o!=='object')throw Error('Invalid event at line '+(i+1));return o as {kind:string;text:string;source?:string};});
 return withProjectLockSync(root,()=>{
  if(listNotes(root).length+parsed.length>1000)throw Error('Session note limit reached');
  const validated=parsed.map(x=>validate(root,{...x,source:x.source||'structured-transcript'}));
  return validated.map(x=>append(root,x));
 });
}
export function noteHandoff(root:string,sessionId:string){
 const items=listNotes(root,sessionId).slice(-30);
 return items.length?items.map(x=>`- [${x.kind}; ${x.source}] ${x.text.replace(/\n/g,' ')}`).join('\n'):'(no explicitly captured decisions or intent)';
}

/** Local timeline from verified CLI/Watcher event records plus explicit agent notes.
 * Automatic events are factual metadata, not inferred developer intent.
 */
export function sessionTimeline(root:string,limit=100){
 if(!Number.isInteger(limit)||limit<1||limit>200)throw Error('Invalid timeline limit');
 const notes=listNotes(root).map(n=>({at:n.createdAt,type:'agent-note',kind:n.kind,sessionId:n.sessionId,text:n.text,source:n.source}));
 const log=readText(pathFor(root,'journal','events.jsonl'));
 const events=log.split('\n').filter(Boolean).slice(-500).flatMap(line=>{
  try{const obj=JSON.parse(line) as Record<string,unknown>;if(typeof obj.at!=='string'||typeof obj.event!=='string')return [];
   return [{at:obj.at,type:'cli-event',event:obj.event,detail:Object.fromEntries(Object.entries(obj).filter(([k])=>k!=='at'&&k!=='event'))}];
  }catch{return [];}
 });
 return [...events,...notes].sort((a,b)=>a.at.localeCompare(b.at)).slice(-limit);
}
