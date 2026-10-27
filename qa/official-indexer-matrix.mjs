import {releaseVersion} from './release-version.mjs';
/** Report official SCIP indexer toolchain readiness for five real repo fixtures.
 * Default is PROBE ONLY. Actual execution requires both --execute and the
 * AGENTOS_ALLOW_PROJECT_BUILD_EXEC=1 environment variable because Java/.NET
 * indexers invoke project build tooling and may run arbitrary repo code.
 * Never confuse an internal TypeChecker fixture with an official indexer.
 */
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve,delimiter} from 'node:path';
import {spawnSync} from 'node:child_process';
const [rootArg,cliArg,outArg,...rest]=process.argv.slice(2);
if(!rootArg||!cliArg||!outArg)throw Error('Usage: node qa/official-indexer-matrix.mjs <fixtures> <cli.js> <result.json> [--execute]');
const root=resolve(rootArg),cli=resolve(cliArg),outfile=resolve(outArg);
const execute=rest.includes('--execute');
if(execute&&process.env.AGENTOS_ALLOW_PROJECT_BUILD_EXEC!=='1')throw Error('Execution requires AGENTOS_ALLOW_PROJECT_BUILD_EXEC=1; indexers may invoke untrusted project build steps');
const ext=process.platform==='win32'?['.exe','.cmd','.bat','']:[''];
function pathOf(cmd){for(const path of (process.env.PATH||'').split(delimiter))for(const suffix of ext){const p=join(path,cmd+suffix);if(existsSync(p))return p;}return null;}
const definitions=[
 {name:'flutter',indexer:'scip_dart',command:'dart',args:['pub','global','run','scip_dart','./'],language:'Dart',buildTool:'dart'},
 {name:'compose',indexer:'scip-java',command:'scip-java',args:['index'],language:'Kotlin',buildTool:'Gradle; Android Gradle Plugin support needs independent verification'},
 {name:'spring',indexer:'scip-java',command:'scip-java',args:['index'],language:'Java',buildTool:'Maven'},
 {name:'aspnet',indexer:'scip-dotnet',command:'scip-dotnet',args:['index'],language:'C#',buildTool:'.NET SDK'},
 {name:'react',indexer:'scip-typescript',command:'scip-typescript',args:['index'],language:'TypeScript',buildTool:'Node.js + project dependencies'}
];
const results=[];
for(const v of definitions){
 const cwd=join(root,v.name),indexerExe=pathOf(v.command);
 const item={...v,indexerExecutable:indexerExe,attempted:false,status:'not-run',reason:'',indexedDocuments:null,staticCallsites:null,qaPass:null};
 if(!indexerExe){item.reason=`Official indexer executable not on PATH: ${v.command}`;results.push(item);continue;}
 if(!execute){item.reason='Dry probe: add --execute and explicit build-execution opt-in to actually run indexer';results.push(item);continue;}
 if(!existsSync(cwd)){item.reason='Fixture directory is missing';results.push(item);continue;}
 item.attempted=true;
 const env={...process.env,CI:'1'};
 const r=spawnSync(v.command,v.args,{cwd,env,encoding:'utf8',shell:false,timeout:180000,maxBuffer:1000000});
 const output=join(cwd,'index.scip');
 if(r.error||r.status!==0||!existsSync(output)){item.status='failed';item.reason=(r.error?.message||r.stderr||`index output missing/exit ${r.status}`).slice(-500);results.push(item);continue;}
 const imp=spawnSync(process.execPath,[cli,'scip','import','--index',output,'--cwd',cwd,'--json'],{encoding:'utf8',timeout:30000});
 if(imp.status!==0){item.status='failed';item.reason='AgentOS SCIP import failed: '+imp.stderr.slice(-500);results.push(item);continue;}
 const pack=spawnSync(process.execPath,[cli,'pack','--cwd',cwd,'--json'],{encoding:'utf8',timeout:110000});
 if(pack.status!==0){item.status='failed';item.reason='AgentOS pack failed: '+pack.stderr.slice(-500);results.push(item);continue;}
 const fs=await import('node:fs');
 const manifest=JSON.parse(fs.readFileSync(join(cwd,'.ai','packs','current-task.manifest.json'),'utf8'));
 item.status='passed';item.reason='Official indexer ran, SCIP imported and pack completed';item.indexedDocuments=JSON.parse(imp.stdout).documents;item.staticCallsites=manifest.scip?.staticCallsites??0;
 results.push(item);
}
const summary={version:releaseVersion,kind:'official-indexer-matrix',mode:execute?'execute-opt-in':'readiness-probe',platform:process.platform,
 officialPassed:results.filter(x=>x.status==='passed').length,officialAttempted:results.filter(x=>x.attempted).length,total:results.length,
 results,limitations:['Running official indexer + pack alone is not enough to prove compiler-semantic parity. Source truth labels and independent execution checks are also required.','An indexer can invoke project build steps; do not run --execute on untrusted repositories.']};
mkdirSync(resolve(outfile,'..'),{recursive:true});writeFileSync(outfile,JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
if(execute&&summary.officialPassed!==summary.total)process.exitCode=1;
