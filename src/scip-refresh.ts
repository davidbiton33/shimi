/** Explicit local SCIP indexer execution and opt-in automatic TypeScript reindexing.
 * Never use a shell, interpret project text as a command, or fetch an indexer.
 * Indexers can execute project build logic: always require user opt-in.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { importScip, scipStatus } from './scip.js';
import { pathFor, readJson, saveJson } from './utils.js';
export type IndexerKind='typescript'|'java'|'dotnet'|'dart';
const names=['typescript','java','dotnet','dart'] as const;
const AUTOCONFIG='scip/auto.json';
type AutoConfig={format:'agentos-scip-auto-v1';indexer:'typescript';lastFingerprint?:string;lastStatus?:string};
const AUTO_WARNING='Auto indexing executes a locally installed third-party indexer against this project. Enable only for trusted projects.';
export function allowedIndexer(input:string):IndexerKind{
 if(!(names as readonly string[]).includes(input))throw Error('Use one of: '+names.join(', '));
 return input as IndexerKind;
}
type IndexerCommand={cmd:string;args:string[];generated:string};
/** Windows npm creates .cmd/.ps1 shims, not native executables.
 * Spawn the official JS entry point with the running Node executable instead of
 * invoking cmd.exe (which would interpret untrusted project paths as shell text).
 * Native indexers and POSIX execution retain their existing behavior.
 */
export function resolveIndexerCommand(indexer:IndexerKind, spec:IndexerCommand,
 envPath:string=process.env.PATH||'', platform:string=process.platform):IndexerCommand{
 if(platform!=='win32'||indexer!=='typescript')return spec;
 for(const raw of envPath.split(';')){
  const dir=raw.trim().replace(/^"|"$/g,'');
  if(!dir||!existsSync(join(dir,'scip-typescript.cmd')))continue;
  for(const candidate of [
   resolve(dir,'..','@sourcegraph','scip-typescript','dist','src','main.js'),
   resolve(dir,'node_modules','@sourcegraph','scip-typescript','dist','src','main.js')
  ]){
   try{if(statSync(candidate).isFile())return {...spec,cmd:process.execPath,args:[candidate,...spec.args]};}
   catch{ /* Candidate absent: keep searching PATH */ }
  }
 }
 return spec;
}
function executable(indexer:IndexerKind,output:string):IndexerCommand{
 switch(indexer){
 case 'typescript':return {cmd:'scip-typescript',args:['index','--output',output],generated:output};
 case 'java':return {cmd:'scip-java',args:['index','--output',output],generated:output};
 case 'dotnet':return {cmd:'scip-dotnet',args:['index'],generated:output};
 case 'dart':return {cmd:'dart',args:['pub','global','run','scip_dart','./'],generated:output};
 }
}
export function runScipIndexer(root:string,indexer:IndexerKind){
 // dotnet/dart write ./index.scip; TypeScript/Java support --output.
 const output=(indexer==='dotnet'||indexer==='dart')?join(root,'index.scip'):pathFor(root,'scip','generated.scip');
 mkdirSync(pathFor(root,'scip'),{recursive:true});
 const spec=resolveIndexerCommand(indexer,executable(indexer,output));
 const before=existsSync(output)?createHash('sha256').update(readFileSync(output)).digest('hex'):null;
 const result=spawnSync(spec.cmd,spec.args,{cwd:root,encoding:'utf8',shell:false,timeout:150000,maxBuffer:512000,
  env:{...process.env,CI:'1'}});
 if(result.error||result.status!==0)throw Error(`SCIP ${indexer} indexer failed: ${result.error?.message||result.stderr?.slice(-500)||`exit ${result.status}`}`);
 if(!existsSync(output))throw Error(`SCIP ${indexer} indexer returned success without writing an index`);
 const after=createHash('sha256').update(readFileSync(output)).digest('hex');
 if(before===after)throw Error('SCIP output unchanged; refusing to treat potentially stale index as newly generated');
 const imported=importScip(root,output);
 return {indexer,generated:output,imported,execution:'explicit-local-tool',warning:'Indexer may execute project build logic; no network or isolation is guaranteed by AgentOS'};
}
export function configureAutoScip(root:string,enabled:boolean){
 if(enabled){const config:AutoConfig={format:'agentos-scip-auto-v1',indexer:'typescript'};saveJson(pathFor(root,AUTOCONFIG),config);return {enabled:true,indexer:'typescript',warning:AUTO_WARNING};}
 saveJson(pathFor(root,AUTOCONFIG),{format:'agentos-scip-auto-v1',enabled:false});return {enabled:false};
}
export function autoScipStatus(root:string){const cfg=readJson<Record<string,unknown>|null>(pathFor(root,AUTOCONFIG),null);
 return {enabled:cfg?.format==='agentos-scip-auto-v1'&&cfg.indexer==='typescript',indexer:cfg?.indexer||null,lastStatus:cfg?.lastStatus||null};}
export function tryAutoScip(root:string){
 const cfg=readJson<AutoConfig|null>(pathFor(root,AUTOCONFIG),null);
 if(!cfg||cfg.format!=='agentos-scip-auto-v1'||cfg.indexer!=='typescript')return;
 const state=scipStatus(root);
 if(state.status==='ready')return;
 // Do not repeat a failing indexer command on each watcher tick if project input is unchanged.
 const fingerprint=createHash('sha256').update(JSON.stringify(state)).digest('hex');
 if(cfg.lastFingerprint===fingerprint)return;
 cfg.lastFingerprint=fingerprint;
 try{runScipIndexer(root,'typescript');cfg.lastStatus='ok';}
 catch(e){cfg.lastStatus=String(e instanceof Error?e.message:e).slice(0,500);}
 saveJson(pathFor(root,AUTOCONFIG),cfg);
}
