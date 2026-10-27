import {releaseVersion} from './release-version.mjs';
/** Reproducible single-command offline release gate, no user code execution. */
import {spawnSync} from 'node:child_process';
import {readdirSync,writeFileSync} from 'node:fs';
const testFiles=readdirSync('dist/tests').filter(x=>x.endsWith('.test.js')).sort().map(x=>'dist/tests/'+x);
const suites=[
 {name:'build',cmd:'npm',args:['run','build']},
 {name:'core',cmd:process.execPath,args:['--test','--test-concurrency=1',...testFiles]},
 {name:'strict-wasm',cmd:process.execPath,args:['scripts/run-wasm-test.mjs']},
 {name:'multi-language',cmd:process.execPath,args:['qa/multilang-acceptance.mjs']},
 {name:'framework-di-state',cmd:process.execPath,args:['qa/framework-acceptance.mjs']}
];
const summary={version:releaseVersion,kind:'offline-source-release-gate',suites:[]};
for(const {name,cmd,args} of suites){
 const run=spawnSync(cmd,args,{encoding:'utf8',timeout:120000,maxBuffer:12_000_000,shell:process.platform==='win32'&&cmd==='npm'});
 const output=(run.stdout||'')+'\n'+(run.stderr||'');
 const passed=run.status===0&&!run.error;
 const detail={name,passed,exitCode:run.status,error:run.error?.message||null,summary:output.split('\n').filter(x=>/^# (?:tests|pass|fail|skipped)\b|^TOTAL \d+\/\d+|^\s*"success"\s*:/.test(x)).slice(-9)};
 summary.suites.push(detail);console.log((passed?'PASS ':'FAIL ')+name+' '+JSON.stringify(detail.summary));
 if(!passed){console.error(output.slice(-6000));break;}
}
summary.passed=summary.suites.length===suites.length&&summary.suites.every(x=>x.passed);
const outfile=process.argv.find(x=>x.startsWith('--report='))?.slice('--report='.length);
if(outfile)writeFileSync(outfile,JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
if(!summary.passed)process.exitCode=1;
