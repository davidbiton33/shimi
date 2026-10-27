/**
 * Bounded incremental metadata cache. Raw source code is NEVER persisted.
 * SHA-256 is computed on the file's current contents, so same-size/same-mtime
 * edits invalidate entries. All cached values are advisory, not authoritative.
 */
import { lstatSync, readFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { sha, writeAtomic } from './utils.js';
import type { LanguageAnalysis } from './languages.js';

const SCHEMA=3, MAX_CACHE_BYTES=6*1024*1024, MAX_PATHS=6000;
type Entry={hash:string;analysis:LanguageAnalysis};
type Store={schema:number;files:Record<string,Entry>};
function safeLocation(file:string):boolean{
 // Reject replacing a file via symlink or writing through a linked cache directory.
 try { if(lstatSync(dirname(file)).isSymbolicLink())return false; }catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')return false;}
 try { if(lstatSync(file).isSymbolicLink())return false; }catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')return false;}
 return true;
}
function isValidAnalysis(a:unknown):a is LanguageAnalysis{
 if(!a||typeof a!=='object')return false;
 const x=a as LanguageAnalysis;
 return typeof x.language==='string'&&x.language.length<90 &&
 ['typescript-ast','static-scan','plain'].includes(x.parser)&&
 Array.isArray(x.links)&&x.links.length<10000&&x.links.every(l=>l&&typeof l.specifier==='string'&&l.specifier.length<500&&Array.isArray(l.symbols)&&l.symbols.length<200&&['ast','heuristic'].includes(l.certainty)&&['import','module'].includes(l.kind))&&
 Array.isArray(x.symbols)&&x.symbols.length<20000&&x.symbols.every(s=>typeof s==='string'&&s.length<500)&&
 (x.namespace===undefined||(typeof x.namespace==='string'&&x.namespace.length<500))&&
 (x.bindings===undefined||(Array.isArray(x.bindings)&&x.bindings.length<10000&&x.bindings.every(b=>typeof b.specifier==='string'&&b.specifier.length<500&&typeof b.local==='string'&&b.local.length<300&&typeof b.imported==='string'&&b.imported.length<300&&['named','default','namespace'].includes(b.kind)&&['ast','heuristic'].includes(b.certainty))))&&
 (x.exports===undefined||(Array.isArray(x.exports)&&x.exports.length<10000&&x.exports.every(e=>typeof e.name==='string'&&e.name.length<300&&['ast','heuristic'].includes(e.certainty)&&[e.from,e.local,e.imported].every(v=>v===undefined||(typeof v==='string'&&v.length<500))&&(e.star===undefined||typeof e.star==='boolean'))));
}
export function loadCache(file:string|undefined):Store{
 const empty:Store={schema:SCHEMA,files:Object.create(null)};
 if(!file||!safeLocation(file))return empty;
 try{
  if(statSync(file).size>MAX_CACHE_BYTES)return empty;
  const parsed:unknown=JSON.parse(readFileSync(file,'utf8'));
  if(!parsed||typeof parsed!=='object')return empty;
  const raw=parsed as Store;
  if(raw.schema!==SCHEMA||!raw.files||typeof raw.files!=='object'||Array.isArray(raw.files)||Object.keys(raw.files).length>MAX_PATHS)return empty;
  for(const [path,item] of Object.entries(raw.files)){
   if(path==='__proto__'||path==='constructor'||path==='prototype'||!item||typeof item.hash!=='string'||!/^[0-9a-f]{64}$/.test(item.hash)||!isValidAnalysis(item.analysis))continue;
   empty.files[path]=item;
  }
 }catch { /* cache missing or malformed -> reparse */ }
 return empty;
}
export function cacheLookup(store:Store,path:string,source:string):LanguageAnalysis|null{
 const item=store.files[path];return item && item.hash===sha(source)?item.analysis:null;
}
export function saveCache(file:string|undefined,entries:Map<string,{source:string;analysis:LanguageAnalysis}>):boolean{
 if(!file||!safeLocation(file)||entries.size>MAX_PATHS)return false;
 const files:Store['files']=Object.create(null);
 for(const [path,{source,analysis}] of entries){if(!isValidAnalysis(analysis))return false;files[path]={hash:sha(source),analysis};}
 const serialized=JSON.stringify({schema:SCHEMA,files});
 if(Buffer.byteLength(serialized)>MAX_CACHE_BYTES)return false;
 try{writeAtomic(file,serialized+'\n');return true;}catch{return false;}
}
