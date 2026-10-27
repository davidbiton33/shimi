/**
 * Offline SCIP (Sourcegraph Code Intelligence Protocol) reader.
 * Supports Index/Metadata/Document/Occurrence from official protobuf wire format,
 * both legacy packed ranges and typed ranges. It does not launch indexers.
 * Imported indexes are navigation evidence; never proof of runtime dispatch.
 */
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitPaths } from './git.js';
import { isIgnored, safelyResolveFile, isBinary } from './pack.js';
import { safeIgnores } from './ignore.js';
import { loadConfig } from './config.js';
import { pathFor, readJson, readText, safeProjectPath, saveJson } from './utils.js';

const MAX_INDEX = 64 * 1024 * 1024;
const MAX_DOCUMENTS=10000, MAX_OCCURRENCES=500000;
const digest=(data:Buffer)=>createHash('sha256').update(data).digest('hex');
const MAX_STR=1024 * 1024;

// A deliberately small, bounded protobuf wire reader. No code execution or network calls.
class Wire {
  p=0;
  constructor(readonly bytes:Buffer){}
  num(){let v=0,m=1;for(let i=0;i<10;i++){if(this.p>=this.bytes.length)throw Error('Truncated SCIP varint');const b=this.bytes[this.p++];if(i>7||v+(b&127)*m>Number.MAX_SAFE_INTEGER)throw Error('Oversized SCIP varint');v+=(b&127)*m;if((b&128)===0)return v;m*=128;}throw Error('Malformed SCIP varint');}
  bytesField(){const n=this.num();if(n>this.bytes.length-this.p)throw Error('Truncated SCIP message');const x=this.bytes.subarray(this.p,this.p+n);this.p+=n;return x;}
  str(){const data=this.bytesField();if(data.length>MAX_STR)throw Error('SCIP string exceeds limit');return data.toString('utf8');}
  skip(type:number){if(type===0){this.num();return;}if(type===1){if(this.p+8>this.bytes.length)throw Error('Truncated SCIP fixed64');this.p+=8;return;}if(type===2){this.bytesField();return;}if(type===5){if(this.p+4>this.bytes.length)throw Error('Truncated SCIP fixed32');this.p+=4;return;}throw Error(`Unsupported SCIP protobuf wire type: ${type}`);}
  walk(cb:(field:number,type:number,w:Wire)=>void){while(this.p<this.bytes.length){const key=this.num(), field=Math.floor(key/8),type=key%8;if(field<1)throw Error('Invalid SCIP field number');cb(field,type,this);}}
}
const sub=(b:Buffer,cb:(field:number,type:number,w:Wire)=>void)=>new Wire(b).walk(cb);
const expect=(type:number,want:number)=>{if(type!==want)throw Error('Malformed SCIP wire field type');};
function nums(b:Buffer){const w=new Wire(b),out:number[]=[];while(w.p<b.length){if(out.length>8)throw Error('Oversized SCIP range');out.push(w.num());}return out;}
function readRange(a:number[], typed?:number[]):ScipRange|undefined {
  const v=(typed||a).map(x=>x??0);
  if(v.length!==3&&v.length!==4 || v.some(x=>!Number.isSafeInteger(x)||x<0))return undefined;
  const [s,col,third,last]=Array.from({length:v.length},(_,i)=>v[i]??0); const e=v.length===3?s:third,ec=v.length===3?third:last;
  if(e<s || (s===e&&ec<col))return undefined;
  return {startLine:s,startChar:col,endLine:e,endChar:ec};
}
export type ScipRange={startLine:number;startChar:number;endLine:number;endChar:number};
export type ScipPosition={path:string;line:number;column:number};
export type ScipDefinition={symbolId:string;name:string;path:string;startLine:number;startChar:number;endLine:number;endChar:number;snapshotHash:string;kind:'scip-definition'};
export type ScipReference=ScipPosition&{symbolId:string};
export type ScipSnapshot={format:'agentos-scip-v1';freshness?:ScipFreshness;importedAt:string;indexer:string;indexHash:string;documentCount:number;scannedOccurrences:number;definitions:ScipDefinition[];references:ScipReference[];documentHashes:Record<string,string>;documentEncodings?:Record<string,number>;relationships:{from:string;to:string;kind:string}[];warnings:string[]};
// Freshness covers both indexed document bytes AND the project configuration and
// source-file inventory. A changed lockfile or newly added source makes all SCIP
// links untrusted until a new index is generated (not merely re-imported).
export type ScipFreshness={inventoryHash:string;buildHashes:Record<string,string>};
const SOURCE_RE=/\.(?:[cm]?[jt]sx?|dart|java|kt|kts|cs)$/i;
const BUILD_RE=/(?:^|\/)(?:tsconfig(?:\.[^/]*)?\.json|jsconfig\.json|package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|pom\.xml|build\.gradle(?:\.kts)?|settings\.gradle(?:\.kts)?|gradle\.properties|pubspec\.(?:yaml|lock)|global\.json|Directory\.(?:Build|Packages)\.props|[^/]+\.(?:csproj|sln|slnx))$/i;
function captureFreshness(root:string):ScipFreshness {
  const files=gitPaths(root);
  const inventory=files.filter(p=>SOURCE_RE.test(p));
  const buildHashes:Record<string,string>=Object.create(null);
  for(const path of files.filter(p=>BUILD_RE.test(p)).slice(0,500)){
    const real=safelyResolveFile(root,path);
    if(!real){buildHashes[path]='unreadable';continue;}
    try{const stat=statSync(real);buildHashes[path]=stat.size<=1024*1024?digest(readFileSync(real)):'oversized:'+stat.size;}catch{buildHashes[path]='unreadable';}
  }
  return {inventoryHash:digest(Buffer.from(inventory.join('\n'))),buildHashes};
}
export function scipFreshness(root:string,s:ScipSnapshot){
  const fresh=captureFreshness(root);
  const legacy=!s.freshness;
  const inventoryChanged=legacy||fresh.inventoryHash!==s.freshness?.inventoryHash;
  const prior=s.freshness?.buildHashes||{};
  const changedConfigs=[...new Set([...Object.keys(prior),...Object.keys(fresh.buildHashes)])]
    .filter(p=>prior[p]!==fresh.buildHashes[p]).slice(0,50);
  const staleFiles:string[]=[];
  for(const [p,h] of Object.entries(s.documentHashes)){
    const real=safelyResolveFile(root,p);
    try{if(!real||digest(readFileSync(real))!==h)staleFiles.push(p);}catch{staleFiles.push(p);}
  }
  return {fresh:!legacy&&!inventoryChanged&&!changedConfigs.length&&!staleFiles.length,
    legacy,inventoryChanged,changedConfigs,staleFiles,staleDocuments:staleFiles.length,
    hint:'Regenerate the SCIP index with the language indexer and import it again; importing the old index cannot repair stale semantic data'};
}
function parseOccurrence(data:Buffer){let symbol='',roles=0,old:number[]=[],typed:number[]|undefined;
  sub(data,(f,t,w)=>{
    if(f===1){if(t===2)old=nums(w.bytesField());else if(t===0)old.push(w.num());else w.skip(t);}
    else if(f===2){expect(t,2);symbol=w.str();}
    else if(f===3){expect(t,0);roles=w.num();}
    else if(f===8||f===9){expect(t,2);const vals:number[]=[];sub(w.bytesField(),(ff,tt,ww)=>{if(ff>=1&&ff<=(f===8?3:4)){expect(tt,0);vals[ff-1]=ww.num();}else ww.skip(tt);});typed=vals;}
    else w.skip(t);
  });
  return {symbol,roles,range:readRange(old,typed)};
}
function parseMetadata(data:Buffer){let indexer='',projectRoot='';
  sub(data,(f,t,w)=>{if(f===3){expect(t,2);projectRoot=w.str();}else if(f===2){expect(t,2);sub(w.bytesField(),(ff,tt,ww)=>{if(ff===1){expect(tt,2);indexer=ww.str();}else ww.skip(tt);});}else w.skip(t);});
  return {indexer,projectRoot};
}
function parseDocument(data:Buffer){let path='',encoding=0;const occurrences:ReturnType<typeof parseOccurrence>[]=[],relations:{from:string;to:string;kind:string}[]=[];
  sub(data,(f,t,w)=>{
    if(f===1){expect(t,2);path=w.str();}
    else if(f===2){expect(t,2);if(occurrences.length>=100000)throw Error('SCIP document occurrence limit exceeded');occurrences.push(parseOccurrence(w.bytesField()));}
    else if(f===3){expect(t,2);let parent='';const child:{to:string;kind:string}[]=[];
      sub(w.bytesField(),(sf,st,sw)=>{
        if(sf===1){expect(st,2);parent=sw.str();}
        else if(sf===4){expect(st,2);let to='',kind='';sub(sw.bytesField(),(rf,rt,rw)=>{
          if(rf===1){expect(rt,2);to=rw.str();}
          else if(rf>=2&&rf<=5){expect(rt,0);if(rw.num())kind+=({2:'reference',3:'implementation',4:'type-definition',5:'definition'} as Record<number,string>)[rf]+',';}
          else rw.skip(rt);
        });if(to&&kind)child.push({to,kind:kind.replace(/,$/,'')});}
        else sw.skip(st);
      });
      if(parent)for(const c of child)relations.push({from:parent,...c});
    }
    else if(f===6){expect(t,0);encoding=w.num();}
    else w.skip(t);
  });return {path,encoding,occurrences,relations};
}
function normalizedPath(path:string){
  // Official scip-typescript emits Windows-style relative paths on Windows.
  // SCIP document names are logical project-relative paths, not filesystem paths.
  // Normalize separators only after rejecting absolute/drive/UNC/traversal forms.
  if(!path||path.includes('\0')||path.startsWith('\\\\')||path.startsWith('//')||/^[a-zA-Z]:/.test(path))return null;
  const posix=path.replace(/\\/g,'/');
  if(posix.startsWith('/')||posix.split('/').some(p=>!p||p==='.'||p==='..'))return null;
  return posix;
}
function sourceName(data:Buffer, encoding:number,range:ScipRange):string{
  const line=data.toString('utf8').split(/\r?\n/)[range.startLine];if(line===undefined)return '';
  const before=(n:number)=>{if(encoding===1)return Buffer.from(line).subarray(0,n).toString('utf8');if(encoding===3)return [...line].slice(0,n).join('');return line.slice(0,n);};
  const end=range.startLine===range.endLine?range.endChar:range.startChar+160;
  const raw=before(end).slice(before(range.startChar).length);
  return raw.trim().slice(0,160);
}
function verifyRoot(root:string,fromIndex:string){
  if(!fromIndex)throw Error('SCIP metadata.project_root is missing: cannot trust path mapping');
  const path=fromIndex.startsWith('file://')?fileURLToPath(fromIndex):fromIndex;
  if(!isAbsolute(path)||resolve(root)!==resolve(path))throw Error(`SCIP project root mismatch; expected ${resolve(root)}`);
}
export function importScip(root:string,inputPath:string){
  const path=resolve(inputPath);const st=statSync(path);if(!st.isFile()||st.size>MAX_INDEX)throw Error('SCIP index is not a regular file or exceeds 64 MiB');
  const raw=readFileSync(path);const cfg=loadConfig(root);
  const ignores=[...safeIgnores,...cfg.customIgnore,...cfg.packer.ignore,...readText(safeProjectPath(root,'.agentosignore')).split(/\r?\n/).map(s=>s.trim()).filter(s=>s&&!s.startsWith('#'))];
  const allowed=new Set(gitPaths(root).filter(p=>!isIgnored(p,ignores)));
  const definitions:ScipDefinition[]=[], references:ScipReference[]=[],relationships:ScipSnapshot['relationships']=[], warnings:string[]=[],documentHashes:Record<string,string>=Object.create(null),documentEncodings:Record<string,number>=Object.create(null);
  let metadata:ReturnType<typeof parseMetadata>|undefined, docCount=0,total=0,skipped=0;
  const seen=new Set<string>();
  // Index producers must emit metadata first (SCIP specification).
  new Wire(raw).walk((field,t,w)=>{
    if(field===1){expect(t,2);if(metadata||docCount)throw Error('Duplicate or misplaced SCIP metadata');metadata=parseMetadata(w.bytesField());verifyRoot(root,metadata.projectRoot);}
    else if(field===2){expect(t,2);if(!metadata)throw Error('SCIP metadata must precede documents');if(++docCount>MAX_DOCUMENTS)throw Error('SCIP document limit exceeded');
      const doc=parseDocument(w.bytesField());const normalized=normalizedPath(doc.path);if(!normalized||seen.has(normalized)){skipped++;return;}
      doc.path=normalized;seen.add(normalized);
      if(!allowed.has(doc.path)){skipped++;return;}
      const fsPath=safelyResolveFile(root,doc.path);if(!fsPath){skipped++;return;}
      const content=readFileSync(fsPath);if(content.length>Math.min(cfg.packer.maxFileBytes,256*1024)||isBinary(content)){skipped++;return;}
      if(doc.encoding!==0&&doc.encoding!==1&&doc.encoding!==2&&doc.encoding!==3){skipped++;return;}
      const hash=digest(content);documentHashes[doc.path]=hash;documentEncodings[doc.path]=doc.encoding;total+=doc.occurrences.length;if(total>MAX_OCCURRENCES)throw Error('SCIP occurrence limit exceeded');
      for(const occ of doc.occurrences){if(!occ.symbol||occ.symbol.length>1024||!occ.range)continue;
        const r=occ.range;if(r.startLine>=content.toString('utf8').split(/\r?\n/).length)continue;
        if(occ.roles&1){
          const name=sourceName(content,doc.encoding,r);
          if(!name||name.length>160)continue;
          definitions.push({symbolId:occ.symbol,name,path:doc.path,startLine:r.startLine,startChar:r.startChar,endLine:r.endLine,endChar:r.endChar,snapshotHash:hash,kind:'scip-definition'});
        }else if(references.length<MAX_OCCURRENCES)references.push({symbolId:occ.symbol,path:doc.path,line:r.startLine,column:r.startChar});
      }
      for(const rel of doc.relations){if(relationships.length<MAX_OCCURRENCES)relationships.push(rel);}
    }
    else w.skip(t);
  });
  if(!metadata)throw Error('Missing SCIP metadata');
  if(skipped)warnings.push(`${skipped} excluded, duplicate, or unreadable SCIP documents were skipped`);
  warnings.push('SCIP symbol identity is indexer evidence, not proof of runtime call dispatch');
  warnings.push('SCIP does not embed a trusted source hash: index staleness at import time cannot be ruled out');
  const snapshot:ScipSnapshot={format:'agentos-scip-v1',importedAt:new Date().toISOString(),indexer:metadata.indexer||'unknown',indexHash:digest(raw),documentCount:docCount,scannedOccurrences:total,definitions,references,documentHashes,documentEncodings,relationships,warnings,freshness:captureFreshness(root)};
  saveJson(pathFor(root,'scip','index.json'),snapshot);
  return {status:'imported',indexer:snapshot.indexer,documents:docCount,definitions:definitions.length,references:references.length,relationships:relationships.length,skipped,warnings};
}
export function loadScip(root:string):ScipSnapshot|null{
  const obj=readJson<ScipSnapshot|null>(pathFor(root,'scip','index.json'),null);
  if(!obj)return null;
  if(obj.format!=='agentos-scip-v1'||!Array.isArray(obj.definitions)||!Array.isArray(obj.references))throw Error('Invalid AgentOS SCIP cache');
  return obj;
}
export function scipStatus(root:string){const s=loadScip(root);if(!s)return {status:'not_imported',hint:'Generate a SCIP index with a language indexer and import it using agentos scip import --index index.scip'};
  const freshness=scipFreshness(root,s);
  return {status:freshness.fresh?'ready':'stale',indexer:s.indexer,importedAt:s.importedAt,documents:s.documentCount,definitions:s.definitions.length,references:s.references.length,freshness,warnings:s.warnings};
}
export function scipCandidates(root:string,args:{name?:string;symbolId?:string;path?:string},allowed:Set<string>){
  const s=loadScip(root);if(!s)return null;
  const globallyFresh=scipFreshness(root,s).fresh;
  const found=s.definitions.filter(d=>allowed.has(d.path)&&(!args.path||args.path===d.path)&&(!args.symbolId||d.symbolId===args.symbolId)&&(!args.name||d.name===args.name||d.name.endsWith('.'+args.name)));
  const fresh:ScipDefinition[]=[],stale:ScipDefinition[]=[];
  for(const d of found){if(!globallyFresh){stale.push(d);continue;}const real=safelyResolveFile(root,d.path);if(!real){stale.push(d);continue;}try{const bytes=readFileSync(real);(digest(bytes)===d.snapshotHash?fresh:stale).push(d);}catch{stale.push(d);}}
  return {snapshot:s,definitions:fresh,stale:stale.length,refs:(symbolId:string)=>{const freshCache=new Map<string,boolean>();return s.references.filter(r=>{if(r.symbolId!==symbolId||!allowed.has(r.path))return false;let ok=freshCache.get(r.path);if(ok===undefined){const real=safelyResolveFile(root,r.path);try{ok=Boolean(real&&digest(readFileSync(real))===s.documentHashes[r.path]);}catch{ok=false;}freshCache.set(r.path,ok);}return ok;}).slice(0,50);},relationships:(symbolId:string)=>s.relationships.filter(x=>x.from===symbolId||x.to===symbolId).slice(0,25)};
}
