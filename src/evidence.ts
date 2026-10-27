/** Deterministic, opt-in test evidence. No AI and no hidden command execution. */
import {spawnSync} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {existsSync,readFileSync,readdirSync,statSync} from 'node:fs';
import {dirname,join,relative} from 'node:path';
import {gitPaths,gitSnapshot} from './git.js';
import {withProjectLockSync} from './lock.js';
import {now,pathFor,readJson,readText,safeProjectPath,saveJson,sha} from './utils.js';
import {event} from './journal.js';

const MAX_INPUTS=150;const MAX_BYTES=4*1024*1024;const MAX_CHECKS=40;
export type Check={id:string;description?:string;command?:string;args?:string[];inputs:string[];required:boolean;timeoutMs:number};
export type Manifest={version:1;checks:Check[];path:string};
export type Run={id:string;at:string;checkId:string;checkHash:string;command:string;args:string[];exitCode:number|null;error?:string;outputHash:string;inputs:Record<string,string|null>;head:string|null;branch:string;elapsedMs:number};
function object(x:unknown):Record<string,unknown>{if(!x||typeof x!=='object'||Array.isArray(x))throw Error('Expected an object');return x as Record<string,unknown>;}
function nonempty(x:unknown,max:number,label:string){if(typeof x!=='string'||!x.trim()||x.length>max||x.includes('\0'))throw Error('Invalid '+label);return x;}
function inputPath(root:string,name:string,allowed:Set<string>):string{
  const rel=nonempty(name,400,'input path').replace(/\\/g,'/');
  if(rel.startsWith('.ai/')||rel.startsWith('.git/')||/(^|\/)\.env(\.|$)|secret|credential|private.key/i.test(rel))throw Error('Disallowed evidence input path: '+rel);
  if(!allowed.has(rel))throw Error('Input must be a Git-visible project file: '+rel);
  return safeProjectPath(root,rel);
}
export function loadManifest(root:string,manifestFile='.agentos-evidence.json'):Manifest{
 const file=safeProjectPath(root,manifestFile);
 const stat=statSync(file);if(stat.size>128*1024)throw Error('Evidence manifest exceeds 128 KiB');
 const data=object(JSON.parse(readFileSync(file,'utf8')));
 if(data.version!==1||!Array.isArray(data.checks)||!data.checks.length||data.checks.length>MAX_CHECKS)throw Error('Evidence manifest requires version:1 and 1–40 checks');
 const git=new Set(gitPaths(root));const ids=new Set<string>();
 const checks=data.checks.map((item:unknown):Check=>{
  const x=object(item);const id=nonempty(x.id,64,'check id');if(!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(id)||ids.has(id))throw Error('Invalid or duplicate check id: '+id);ids.add(id);
  const isManual=x.manual===true;
  if(typeof x.command!=='string' && !isManual)throw Error('Check '+id+' requires command or manual:true');
  if(isManual&&x.command!==undefined)throw Error('Manual check cannot have a command');
  const cmd=isManual?undefined:nonempty(x.command,250,'command');
  if(cmd && (cmd.includes('/')||cmd.includes('\\')||cmd.startsWith('-')))throw Error('Use an executable on PATH, not a path or flag: '+cmd);
  const args=x.args===undefined?[]:x.args;if(!Array.isArray(args)||args.length>40||args.some(y=>typeof y!=='string'||y.length>1000||y.includes('\0')))throw Error('Invalid check arguments');
  const inputs=x.inputs===undefined?[]:x.inputs;if(!Array.isArray(inputs)||inputs.length>MAX_INPUTS||inputs.some(i=>typeof i!=='string'))throw Error('Invalid check inputs');
  for(const p of inputs)inputPath(root,p,git);
  const timeoutMs=x.timeoutMs===undefined?60000:x.timeoutMs;
  if(typeof timeoutMs!=='number')throw Error('Invalid timeoutMs');
  if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>300000)throw Error('Timeout must be 1000–300000ms');
  if(x.required!==undefined&&typeof x.required!=='boolean')throw Error('Invalid required flag');
  return {id,description:typeof x.description==='string'?x.description.slice(0,250):undefined,command:cmd,args:args as string[],inputs:[...new Set(inputs)] as string[],required:x.required!==false,timeoutMs};
 });
 return {version:1,checks,path:relative(root,file).replace(/\\/g,'/')};
}
export function checkDigest(c:Check){return sha(JSON.stringify(c));}
function hashInputs(root:string,inputs:string[]):Record<string,string|null>{
 const allowed=new Set(gitPaths(root));const out:Record<string,string|null>={};let size=0;
 for(const name of inputs){const p=inputPath(root,name,allowed);if(!existsSync(p)){out[name]=null;continue;}
  const s=statSync(p);if(!s.isFile())throw Error('Evidence input is not a regular file: '+name);
  size+=s.size;if(s.size>MAX_BYTES||size>16*MAX_BYTES)throw Error('Evidence input budget exceeded');
  out[name]=createHash('sha256').update(readFileSync(p)).digest('hex');
 }
 return out;
}
const RUN_RE=/^[a-f0-9]{24}\.json$/;
export function evidenceRuns(root:string):Run[]{
 let files:string[]=[];try{files=readdirSync(pathFor(root,'evidence','runs'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw e;}
 if(files.length>500)throw Error('Evidence history exceeds 500 records');
 return files.filter(f=>RUN_RE.test(f)).map(f=>readJson<Run|null>(pathFor(root,'evidence','runs',f),null)).filter((r):r is Run=>r!==null).sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));
}
export function runChecks(root:string,file:string,onlyId?:string){
 const manifest=loadManifest(root,file);
 const selected=onlyId?manifest.checks.filter(c=>c.id===onlyId):manifest.checks.filter(c=>!!c.command);
 if(onlyId&&!selected.length)throw Error('Unknown check id: '+onlyId);
 // Run outside the project lock (checks might be long running). Never execute checks implicitly on resume.
 const results:Run[]=[];
 for(const check of selected){if(!check.command)continue;
  const inputs=hashInputs(root,check.inputs);const snapshot=gitSnapshot(root);
  const started=Date.now();
  // Windows npm .cmd shims are not directly spawnable with shell:false. Use the
  // locally installed npm JS entrypoint through Node instead of invoking a shell.
  let executable=check.command;let argv=check.args??[];
  if(process.platform==='win32'&&check.command.toLowerCase()==='npm'){
    const npmCli=join(dirname(process.execPath),'node_modules','npm','bin','npm-cli.js');
    if(!existsSync(npmCli))throw Error('Windows npm CLI entrypoint was not found; configure an explicit node-based test runner');
    executable=process.execPath;argv=[npmCli,...argv];
  }
  const child=spawnSync(executable,argv,{cwd:root,encoding:'utf8',shell:false,windowsHide:true,timeout:check.timeoutMs,maxBuffer:1024*1024});
  const outputHash=sha((child.stdout||'')+'\n'+(child.stderr||''));
  const row:Run={id:randomBytes(12).toString('hex'),at:now(),checkId:check.id,checkHash:checkDigest(check),command:check.command,args:check.args??[],exitCode:child.status,outputHash,inputs,head:snapshot.head,branch:snapshot.branch,elapsedMs:Date.now()-started};
  if(child.error)row.error=child.error.message.slice(0,240);
  withProjectLockSync(root,()=>{if(evidenceRuns(root).length>=500)throw Error('Evidence history limit reached');saveJson(pathFor(root,'evidence','runs',row.id+'.json'),row);event(root,'evidence_run',{id:row.id,checkId:check.id,exitCode:row.exitCode});});
  results.push(row);
 }
 return {manifest:manifest.path,results,warning:'These checks executed project commands explicitly supplied by you. Passing tests do not prove business correctness.'};
}
export type Assessment={id:string;required:boolean;state:'missing'|'manual_review'|'failed'|'inputs_changed'|'scope_unknown'|'recorded_pass';lastRun?:string;reasons:string[]};
export function evidenceStatus(root:string,file='.agentos-evidence.json'){
 const manifest=loadManifest(root,file);const runs=evidenceRuns(root);const byId=new Map<string,Run>();for(const run of runs)byId.set(run.checkId,run);
 const assessments:Assessment[]=manifest.checks.map(c=>{
  const common={id:c.id,required:c.required};const reasons:string[]=[];
  if(!c.command)return {...common,state:'manual_review' as const,reasons:['Human or agent verification required; no trusted executable check']};
  const run=byId.get(c.id);if(!run||run.checkHash!==checkDigest(c))return {...common,state:'missing' as const,reasons:['No matching AgentOS-executed evidence for the current check contract']};
  const lastRun=run.at;if(run.exitCode!==0||run.error)return {...common,lastRun,state:'failed' as const,reasons:['Last recorded process did not exit successfully']};
  if(!c.inputs.length)return {...common,lastRun,state:'scope_unknown' as const,reasons:['No explicit input paths recorded; impact cannot be bounded']};
  let current:Record<string,string|null>;
  try{current=hashInputs(root,c.inputs);}catch{return {...common,lastRun,state:'inputs_changed' as const,reasons:['Input missing, inaccessible or outside safe scope']};}
  const changed=c.inputs.filter(p=>run.inputs[p]!==current[p]);
  if(changed.length)return {...common,lastRun,state:'inputs_changed' as const,reasons:['Recorded inputs differ from current files: '+changed.join(', ')]};
  return {...common,lastRun,state:'recorded_pass' as const,reasons:['Command previously exited 0 and explicitly declared inputs are unchanged; external dependencies remain unverified']};
 });
 const required=assessments.filter(c=>c.required);
 return {manifest:manifest.path,complete:required.length>0&&required.every(c=>c.state==='recorded_pass'),assessments,warning:'Complete only means declared executable checks passed for unchanged declared inputs, not that all requirements or external dependencies are correct.'};
}
export function tryEvidenceStatus(root:string,file='.agentos-evidence.json'){
 try{if(!existsSync(safeProjectPath(root,file)))return {state:'not_configured',warning:'Create an explicit evidence manifest; no tests are run automatically.'};return evidenceStatus(root,file);}
 catch(e){return {state:'unavailable',error:e instanceof Error?e.message:String(e)};}
}

/** Non-destructive starter contract based on package.json scripts; never runs commands. */
export function initEvidenceManifest(root:string,file='.agentos-evidence.json',dryRun=false){
 const target=safeProjectPath(root,file);
 if(existsSync(target))throw Error('Evidence manifest already exists; refusing to overwrite: '+file);
 const source=gitPaths(root).filter(p=>/\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|java|cs|rs|kt|dart)$/.test(p) && !/(^|\/)(?:dist|build|node_modules|coverage|vendor)\//.test(p)).slice(0,MAX_INPUTS+1);
 // A partial file set must never be presented as complete coverage.
 const inputs=source.length<=MAX_INPUTS?source:[];
 const pkg=readJson<{scripts?:Record<string,unknown>}|null>(safeProjectPath(root,'package.json'),null);
 const names=['test','typecheck','build'].filter(n=>typeof pkg?.scripts?.[n]==='string');
 const checks=names.length?names.map(name=>({id:name,description:`Run the project ${name} script. Declared input set is not necessarily a complete dependency closure.`,command:'npm',args:['run',name],inputs,required:true})):[{id:'manual-acceptance',description:'Define explicit acceptance requirements and executable checks before claiming completion.',manual:true,required:true,inputs:[]}];
 const result={version:1,checks};
 if(!dryRun)saveJson(target,result);
 return {path:relative(root,target).replace(/\\/g,'/'),created:!dryRun,checks,warning:!inputs.length?'Input scope is incomplete or empty; passing checks cannot be treated as fresh evidence until inputs are explicitly configured.':'Input paths are heuristically selected project files, NOT a guaranteed dependency closure. Review this contract with a human or coding agent.'};
}
