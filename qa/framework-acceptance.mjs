import {releaseVersion} from './release-version.mjs';
/** Reproducible offline framework acceptance (real git repositories and bundled parsers).
 * Use npm run qa:frameworks; output is a small JSON report with no project source.
 */
import {spawnSync} from 'node:child_process';
import {writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
const result=spawnSync(process.execPath,['--test','--test-reporter=tap','dist/tests/framework-flow.test.js'],{
 encoding:'utf8',timeout:120000,maxBuffer:6_000_000,env:{...process.env,AGENTOS_REQUIRE_WASM:'1'}
});
if(result.error)throw result.error;
const output=(result.stdout||'')+(result.stderr||'');
const tally=(name)=>Number(output.match(new RegExp('^# '+name+' (\\d+)','m'))?.[1]||0);
const count={total:tally('tests'),passed:tally('pass'),failed:tally('fail'),skipped:tally('skipped')};
const summary={version:releaseVersion,suite:'framework-aware-static-flow',frameworks:['flutter','jetpack-compose','spring-mvc','aspnet-core'],
 ...count,success:result.status===0&&count.total>=29&&count.passed===count.total&&count.failed===0&&count.skipped===0,
 coverage:'AST callbacks/routes, explicit unique DI interface bindings, Compose ViewModel, Riverpod and BLoC/Cubit state dispatch, bounded paired read/write evidence, and ambiguity controls. Not compiler-verified runtime flow'};
console.log(output.trim());console.log(JSON.stringify(summary,null,2));
const dest=process.argv.find(x=>x.startsWith('--report='))?.slice('--report='.length);
if(dest){const path=resolve(dest);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,JSON.stringify(summary,null,2)+'\n');}
if(!summary.success)process.exitCode=1;
