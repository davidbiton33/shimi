/** Task-specific source acceptance comparison. No precision claim for unlabelled extras. */
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
const [baseline,current,out]=process.argv.slice(2);if(!baseline||!current||!out)throw Error('Usage: node qa/compare-baseline.mjs <baseline-summary> <new-summary> <out>');
const before=JSON.parse(readFileSync(resolve(baseline),'utf8'));
const after=JSON.parse(readFileSync(resolve(current),'utf8'));
const cases=after.results.map(current=>{
 const old=before.results.find(x=>x.name===current.name);
 return {name:current.name,previousPassed:old?.passed??null,currentPassed:current.passed,previousTokens:old?.estimatedTokens??null,currentTokens:current.estimatedTokens,
  tokenDelta:current.estimatedTokens-(old?.estimatedTokens||0),previousFiles:old?.packedFiles??null,currentFiles:current.packedFiles,
  missingKnownPaths:current.missingPaths,missingKnownSpans:current.missingSpans,missingExpectedEvidence:current.missingEvidence,
  note:'Task-scoped recall/retention evidence only; unlabelled included files are not automatically false positives'};
});
const result={baseline:before.version,current:after.version,measuredTasks:cases.length,beforePass:before.passed,afterPass:after.passed,
 allKnownEvidenceRetained:cases.every(x=>x.currentPassed),tokenChangeTotal:cases.reduce((n,x)=>n+x.tokenDelta,0),cases,
 caveats:['These tests do not run target applications.','They do not provide a full precision/recall gold set, thus compiler-semantic parity cannot be calculated from these five tasks alone.']};
mkdirSync(dirname(resolve(out)),{recursive:true});writeFileSync(resolve(out),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({beforePass:result.beforePass,afterPass:result.afterPass,tokenChangeTotal:result.tokenChangeTotal},null,2));
if(!result.allKnownEvidenceRetained)process.exitCode=1;
