/** Durable project facts and decisions. Explicitly authored; no model-generated inference. */
import { randomBytes } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { withProjectLockSync } from './lock.js';
import { now, pathFor, readJson, saveJson } from './utils.js';
import { sanitize } from './pack.js';

export type MemoryKind='fact'|'decision';
export type MemoryEntry={id:string;kind:MemoryKind;text:string;tags:string[];source:string;createdAt:string};
const ID=/^[a-f0-9]{16}$/;
export function memoryPath(root:string,id:string){if(!ID.test(id))throw Error('Invalid memory id');return pathFor(root,'memory',id+'.json');}
function checkedText(text:string){if(typeof text!=='string'||!text.trim()||text.length>4000)throw Error('Memory text must be 1–4000 characters');if(text.includes('\0'))throw Error('NUL not allowed');return sanitize(text.trim()).value;}
function checkedTags(tags:string[]){if(!Array.isArray(tags)||tags.length>10||tags.some(t=>typeof t!=='string'||! /^[\p{L}\p{N}_-]{1,40}$/u.test(t)))throw Error('Invalid memory tags');return [...new Set(tags.map(s=>s.toLowerCase()))];}
export function addMemory(root:string,input:{kind:string;text:string;tags?:string[];source?:string}){
 if(input.kind!=='fact'&&input.kind!=='decision')throw Error('Memory kind must be fact or decision');
 const text=checkedText(input.text),tags=checkedTags(input.tags||[]),source=input.source||'agent-assertion';
 if(typeof source!=='string'||!source.trim()||source.length>120)throw Error('Invalid memory source');
 return withProjectLockSync(root,()=>{
   const existing=listMemories(root);if(existing.length>=1000)throw Error('Project memory limit reached (1000)');
   const item:MemoryEntry={id:randomBytes(8).toString('hex'),kind:input.kind as MemoryKind,text,tags,source,createdAt:now()};
   saveJson(memoryPath(root,item.id),item);return item;
 });
}
export function getMemory(root:string,id:string){const doc=readJson<MemoryEntry|null>(memoryPath(root,id),null);if(!doc||doc.id!==id)throw Error('Memory not found');return doc;}
export function listMemories(root:string,kind?:string):MemoryEntry[]{
 if(kind && kind!=='fact'&&kind!=='decision')throw Error('Memory kind must be fact or decision');
 let names:string[]=[];try{names=readdirSync(pathFor(root,'memory'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw e;}
 return names.filter(n=>ID.test(n.replace(/\.json$/,''))&&n.endsWith('.json')).map(n=>getMemory(root,n.slice(0,-5)))
 .filter(x=>!kind||x.kind===kind).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id));
}
export function searchMemories(root:string,query:string,kind?:string,limit=20){
 if(typeof query!=='string'||!query.trim()||query.length>250)throw Error('Memory query must be 1–250 characters');
 const terms=query.toLowerCase().split(/\s+/u).filter(Boolean);return listMemories(root,kind).map(item=>({item,score:terms.reduce((s,t)=>s+(item.text.toLowerCase().includes(t)?2:0)+(item.tags.some(x=>x.includes(t))?3:0),0)}))
 .filter(x=>x.score>0).sort((a,b)=>b.score-a.score||b.item.createdAt.localeCompare(a.item.createdAt)).slice(0,Math.min(50,Math.max(1,limit))).map(x=>x.item);
}
export function memoryHandoff(root:string,limit=10){return listMemories(root).slice(0,limit).map(m=>`- [${m.kind}; ${m.id}; ${m.source}] ${m.text.replace(/\n/g,' ')}`).join('\n')||'(no project memories recorded)';}
