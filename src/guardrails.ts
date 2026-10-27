/** Conservative evidence-driven handoff, conflicts and stalling diagnostics. */
import {existsSync} from 'node:fs';
import {gitSnapshot} from './git.js';
import {command,pathFor,readJson} from './utils.js';
import {evidenceRuns,tryEvidenceStatus,type Run} from './evidence.js';
import type {GraphReport} from './graph.js';

export function verifiedResume(root:string){
 const git=gitSnapshot(root);
 const evidence=tryEvidenceStatus(root);
 const changes=[...new Set([...git.changed,...git.untracked])].sort();
 return {git:{head:git.head,branch:git.branch,changed:changes,staged:git.staged},evidence,
  nextActions:[
   'Inspect the current Git diff and saved Handoff before changing code',
   'Rerun checks whose recorded inputs changed or whose scope is unknown',
   'Verify business requirements separately; past check results are not proof of correctness'
  ],warning:'No check is executed by resume --verify. This is evidence freshness, not a security or correctness certificate.'};
}
function rev(root:string,value:string):string{
 if(!value||value.length>120||!/^[A-Za-z0-9_./-]+$/.test(value)||value.startsWith('-')||value.includes('..'))throw Error('Invalid Git revision');
 const r=command('git',['rev-parse','--verify','--end-of-options',value+'^{commit}'],root);
 const hash=r.stdout.trim();if(!r.ok||!/^[a-f0-9]{40,64}$/.test(hash))throw Error('Unknown Git revision: '+value);return hash;
}
function changed(root:string,base:string,target:string):string[]{
 const r=command('git',['diff','--name-only','--diff-filter=ACDMRT',base,target,'--'],root,30000);
 if(!r.ok)throw Error('Git comparison failed');
 return r.stdout.split(/\r?\n/).map(s=>s.trim()).filter(Boolean).slice(0,10000);
}
export function conflictRadar(root:string,baseInput:string,leftInput:string,rightInput:string){
 const base=rev(root,baseInput),left=rev(root,leftInput),right=rev(root,rightInput);
 const l=changed(root,base,left),r=changed(root,base,right);
 const leftSet=new Set(l),rightSet=new Set(r);
 const overlap=l.filter(f=>rightSet.has(f));
 let graph:GraphReport|null=null;
 try{graph=readJson<GraphReport|null>(pathFor(root,'packs','dependency-graph.json'),null);}catch{}
 const hints:{from:string;to:string;relation:string;reason:string}[]=[];
 for(const e of graph?.edges||[]){
  if((leftSet.has(e.from)&&rightSet.has(e.to))||(rightSet.has(e.from)&&leftSet.has(e.to)))
    hints.push({from:e.from,to:e.to,relation:e.certainty,reason:'Both sides changed files connected by a static dependency edge'});
  if(hints.length>=200)break;
 }
 const warnings=['Passing Git merge alone cannot prove behavioral compatibility.',
  'Dependency hints were computed in a saved graph which may be stale; do not treat them as proven runtime call relationships.'];
 if(!graph)warnings.push('No dependency graph available; run agentos pack to obtain heuristic dependency hints.');
 return {base,left,right,leftChanged:l,rightChanged:r,overlappingFiles:overlap,dependencyHints:hints,
   signal:overlap.length?'overlap':hints.length?'dependency_risk':'no_detected_overlap',
   warnings,unknown:'Logical or business conflicts can occur without a shared file or known dependency.'};
}
export function stallStatus(root:string,requiredAttempts=3){
 const rows=evidenceRuns(root).filter(x=>x.command).slice(-120);
 const groups=new Map<string,Run[]>();for(const item of rows){const arr=groups.get(item.checkId)||[];arr.push(item);groups.set(item.checkId,arr);}
 const signals:{checkId:string;attempts:number;status:string;latestAt:string;outputHash:string}[]=[];
 for(const [checkId,runs] of groups){
  const recent=runs.slice(-requiredAttempts);
  if(recent.length<requiredAttempts)continue;
  if(recent.every(x=>x.exitCode!==0&&x.checkHash===recent[0].checkHash&&x.outputHash===recent[0].outputHash))
   signals.push({checkId,attempts:recent.length,status:'repeated_identical_failure',latestAt:recent[recent.length-1].at,outputHash:recent[0].outputHash});
 }
 return {status:signals.length?'possible_stall':rows.length?'no_repeated_failure_detected':'insufficient_observations',signals,
  observations:rows.length,warning:'Only AgentOS-executed checks are observed. Repeated failure is a hint, not proof of stalled work; no agent is automatically stopped.'};
}
