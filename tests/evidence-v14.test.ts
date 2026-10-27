import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {init} from '../src/commands.js';
import {evidenceStatus,runChecks,tryEvidenceStatus,initEvidenceManifest} from '../src/evidence.js';
import {conflictRadar,stallStatus,verifiedResume} from '../src/guardrails.js';
import {pathFor,saveJson} from '../src/utils.js';

function cmd(root:string,...argv:string[]){const x=spawnSync(argv[0],argv.slice(1),{cwd:root,encoding:'utf8'});assert.equal(x.status,0,`${argv.join(' ')}\n${x.stderr}`);return x.stdout.trim();}
function setup(){
 const root=mkdtempSync(join(tmpdir(),'agentos-evidence-'));cmd(root,'git','init','-q');cmd(root,'git','config','user.email','unit@test.invalid');cmd(root,'git','config','user.name','Unit');
 mkdirSync(join(root,'src'));writeFileSync(join(root,'src','alpha.js'),'export const alpha = 1;\n');
 writeFileSync(join(root,'src','beta.js'),"import { alpha } from './alpha.js';\nexport const beta = alpha;\n");
 cmd(root,'git','add','src');cmd(root,'git','commit','-qm','init');init(root);return root;
}
const manifest=(root:string,checks:unknown[])=>writeFileSync(join(root,'.agentos-evidence.json'),JSON.stringify({version:1,checks}));
function cli(root:string,...args:string[]){const x=spawnSync(process.execPath,[resolve('dist/src/cli.js'),...args,'--cwd',root,'--json'],{encoding:'utf8'});return {...x,data:x.status===0?JSON.parse(x.stdout):null};}

test('recorded passing check is scoped and becomes stale after source edit',()=>{
 const root=setup();try{
  manifest(root,[{id:'alpha',command:'node',args:['-e','process.exit(0)'],inputs:['src/alpha.js']}]);
  const run=runChecks(root,'.agentos-evidence.json');assert.equal(run.results[0].exitCode,0);
  assert.equal(evidenceStatus(root).assessments[0].state,'recorded_pass');assert.equal(evidenceStatus(root).complete,true);
  writeFileSync(join(root,'src','alpha.js'),'export const alpha = 2;\n');
  assert.equal(evidenceStatus(root).assessments[0].state,'inputs_changed');assert.equal(evidenceStatus(root).complete,false);
  const resumed=verifiedResume(root);assert.ok(resumed.git.changed.includes('src/alpha.js'));
  assert.equal((resumed.evidence as ReturnType<typeof evidenceStatus>).complete,false);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('failure remains failure; unbounded scope and manual checks never count as verified',()=>{
 const root=setup();try{
  manifest(root,[{id:'fail',command:'node',args:['-e','process.exit(4)'],inputs:['src/alpha.js']},{id:'unknown',command:'node',args:['-e','process.exit(0)']},{id:'approval',manual:true}]);
  runChecks(root,'.agentos-evidence.json');const status=evidenceStatus(root);
  assert.deepEqual(status.assessments.map(x=>x.state),['failed','scope_unknown','manual_review']);assert.equal(status.complete,false);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('contract edits invalidate matching past evidence instead of silently retaining pass',()=>{
 const root=setup();try{
  manifest(root,[{id:'check',command:'node',args:['-e','process.exit(0)'],inputs:['src/alpha.js']}]);runChecks(root,'.agentos-evidence.json');
  manifest(root,[{id:'check',command:'node',args:['-e','process.exit(0)'],inputs:['src/beta.js']}]);
  assert.equal(evidenceStatus(root).assessments[0].state,'missing');
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('invalid, outside, symlink and secret scope are rejected before running',()=>{
 const root=setup(),outside=mkdtempSync(join(tmpdir(),'agentos-evidence-out-'));try{
  manifest(root,[{id:'unsafe',command:'node',args:['-e','process.exit(0)'],inputs:['../outside.js']}]);assert.throws(()=>loadStatus(root));
  writeFileSync(join(root,'.env'),'TOP_SECRET');manifest(root,[{id:'unsafe',command:'node',args:['-e','process.exit(0)'],inputs:['.env']}]);assert.throws(()=>loadStatus(root));
  symlinkSync(join(outside,'x.js'),join(root,'src','external.js'));
  manifest(root,[{id:'unsafe',command:'node',args:['-e','process.exit(0)'],inputs:['src/external.js']}]);assert.throws(()=>loadStatus(root));
 }finally{rmSync(root,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
});
function loadStatus(root:string){return evidenceStatus(root);}

test('run is explicit and status/resume never executes a command',()=>{
 const root=setup();try{
  manifest(root,[{id:'marker',command:'node',args:['-e',"require('fs').writeFileSync('MARKER','ran')"],inputs:['src/alpha.js']}]);
  assert.equal('complete' in tryEvidenceStatus(root),true);assert.equal(existsSync(join(root,'MARKER')),false);
  verifiedResume(root);assert.equal(existsSync(join(root,'MARKER')),false);
  runChecks(root,'.agentos-evidence.json');assert.equal(existsSync(join(root,'MARKER')),true);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('stalled warning requires repeated identical failures and cannot infer agent progress',()=>{
 const root=setup();try{
  assert.equal(stallStatus(root).status,'insufficient_observations');
  manifest(root,[{id:'fail',command:'node',args:['-e','process.exit(1)'],inputs:['src/alpha.js']}]);
  runChecks(root,'.agentos-evidence.json');runChecks(root,'.agentos-evidence.json');
  assert.equal(stallStatus(root).status,'no_repeated_failure_detected');
  runChecks(root,'.agentos-evidence.json');
  assert.equal(stallStatus(root).status,'possible_stall');assert.equal(stallStatus(root).signals[0].attempts,3);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('radar detects overlapping files between independent branches without claiming logical correctness',()=>{
 const root=setup();try{
  const base=cmd(root,'git','rev-parse','HEAD');
  cmd(root,'git','checkout','-qb','left');writeFileSync(join(root,'src','alpha.js'),'export const alpha = 2;\n');cmd(root,'git','add','src');cmd(root,'git','commit','-qm','left');
  cmd(root,'git','checkout','-qb','right',base);writeFileSync(join(root,'src','alpha.js'),'export const alpha = 3;\n');cmd(root,'git','add','src');cmd(root,'git','commit','-qm','right');
  const report=conflictRadar(root,base,'left','right');assert.deepEqual(report.overlappingFiles,['src/alpha.js']);assert.equal(report.signal,'overlap');
  assert.throws(()=>conflictRadar(root,'--bad','left','right'));
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('radar exposes dependency edges from cached graph as possibly stale hints',()=>{
 const root=setup();try{
  const base=cmd(root,'git','rev-parse','HEAD');
  cmd(root,'git','checkout','-qb','left');writeFileSync(join(root,'src','alpha.js'),'export const alpha = 2;\n');cmd(root,'git','add','src');cmd(root,'git','commit','-qm','left');
  cmd(root,'git','checkout','-qb','right',base);writeFileSync(join(root,'src','beta.js'),'export const beta = 1;\n');cmd(root,'git','add','src');cmd(root,'git','commit','-qm','right');
  saveJson(pathFor(root,'packs','dependency-graph.json'),{version:1,nodes:[],edges:[{from:'src/beta.js',to:'src/alpha.js',certainty:'ast',specifier:'./alpha.js',symbols:['alpha']}]});
  const result=conflictRadar(root,base,'left','right');assert.equal(result.overlappingFiles.length,0);assert.equal(result.signal,'dependency_risk');assert.equal(result.dependencyHints.length,1);
  assert.ok(result.warnings.join(' ').includes('stale'));
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('CLI status/guard/radar/stall expose JSON and reject malformed flags',()=>{
 const root=setup();try{
  manifest(root,[{id:'pass',command:'node',args:['-e','process.exit(0)'],inputs:['src/alpha.js']}]);
  assert.equal(cli(root,'evidence','run').status,0);
  assert.equal(cli(root,'guard','status').data.complete,true);
  assert.equal(cli(root,'evidence','status').data.assessments[0].state,'recorded_pass');
  assert.equal(cli(root,'stall','status').status,0);
  assert.equal(cli(root,'start','--no-watch').status,0);
  assert.equal(cli(root,'resume','--verify').status,0);
  assert.ok(cli(root,'resume','--verify').data.verification);
  assert.equal(cli(root,'guard','status','--client','cursor').status,1);
  assert.equal(cli(root,'evidence','run','--check','missing').status,1);
  assert.equal(cli(root,'evidence','run','--dry-run').status,1);
  assert.equal(cli(root,'evidence','status','--check','pass').status,1);
  assert.equal(cli(root,'radar','compare','--left','HEAD').status,1);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('MCP now advertises conservative evidence tools that match CLI statuses',()=>{
 const root=setup();try{
  const input=[{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}},{jsonrpc:'2.0',id:2,method:'tools/list'},{jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'agentos_guard_status',arguments:{}}}].map(x=>JSON.stringify(x)).join('\n')+'\n';
  const p=spawnSync(process.execPath,[resolve('dist/src/cli.js'),'mcp','serve','--cwd',root],{input,encoding:'utf8'});
  assert.equal(p.status,0,p.stderr);const lines=p.stdout.trim().split('\n').map(x=>JSON.parse(x));
  assert.equal(lines[1].result.tools.length,14);
  assert.match(lines[2].result.content[0].text,/not_configured/);
 }finally{rmSync(root,{recursive:true,force:true});}
});


test('scaffold creates a non-destructive manifest without running project scripts',()=>{
 const root=setup();try{
  writeFileSync(join(root,'package.json'),JSON.stringify({scripts:{test:'node --test',build:'node build.js'}}));
  const preview=initEvidenceManifest(root,'.agentos-evidence.json',true);
  assert.equal(preview.created,false);assert.equal(existsSync(join(root,'.agentos-evidence.json')),false);
  const result=initEvidenceManifest(root);assert.equal(result.created,true);
  const doc=JSON.parse(readFileSync(join(root,'.agentos-evidence.json'),'utf8'));
  assert.deepEqual(doc.checks.map((x:{id:string})=>x.id),['test','build']);
  assert.ok(doc.checks[0].inputs.includes('src/alpha.js'));
  assert.throws(()=>initEvidenceManifest(root),/already exists/);
 }finally{rmSync(root,{recursive:true,force:true});}
});


test('evidence run cannot be redirected through a linked evidence directory',()=>{
 const root=setup(),outside=mkdtempSync(join(tmpdir(),'agentos-evidence-external-'));try{
  mkdirSync(join(root,'.ai'),{recursive:true});
  symlinkSync(outside,join(root,'.ai','evidence'),'dir');
  manifest(root,[{id:'pass',command:'node',args:['-e','process.exit(0)'],inputs:['src/alpha.js']}]);
  assert.throws(()=>runChecks(root,'.agentos-evidence.json'),/Unsafe symlink/);
  assert.equal(existsSync(join(outside,'runs')),false);
 }finally{rmSync(root,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
});
