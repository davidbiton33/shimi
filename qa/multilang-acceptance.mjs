import {releaseVersion} from './release-version.mjs';
/** Offline, self-contained multilingual acceptance laboratory. Creates fresh git repos.
 * No network, project installs or execution of fixture source code. */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { init, pack } from '../dist/src/commands.js';
import { initializeTreeSitter, treeSitterStatus } from '../dist/src/treesitter.js';
import { parserRegistry, makeSmartSnippet } from '../dist/src/smart.js';
import { buildGraph } from '../dist/src/graph.js';

const noise='Q'.repeat(2300);
const c=(id, entry, dep, source, helper, member='calculateTotal')=>({id,entry,dep,source,helper,member});
const cases=[
 c('typescript','src/checkout.ts','src/pricing.ts',`import { applyDiscount } from './pricing.js';\nexport function calculateTotal(price: number) { return applyDiscount(price); }\nexport function publishBanner(){return '${noise}'}\n`,`export function applyDiscount(price: number) { return price - 5; }\n`),
 c('javascript','src/checkout.js','src/pricing.js',`import { applyDiscount } from './pricing.js';\nexport function calculateTotal(price) { return applyDiscount(price); }\nexport function publishBanner(){return '${noise}'}\n`,`export function applyDiscount(price) { return price - 5; }\n`),
 c('python','src/checkout.py','src/pricing.py',`from .pricing import apply_discount\ndef calculateTotal(price):\n    return apply_discount(price)\ndef publishBanner():\n    return '${noise}'\n`,`def apply_discount(price):\n    return price - 5\n`),
 c('go','checkout/checkout.go','pricing/pricing.go',`package checkout\nimport "lab/pricing"\nfunc calculateTotal(price int) int { return pricing.ApplyDiscount(price) }\nfunc publishBanner() string {return "${noise}"}\n`,`package pricing\nfunc ApplyDiscount(price int) int { return price - 5 }\n`),
 c('java','src/main/java/lab/Checkout.java','src/main/java/lab/Pricing.java',`package lab;\nimport lab.Pricing;\npublic class Checkout {\n public int calculateTotal(int price) { return Pricing.applyDiscount(price); }\n public String publishBanner(){return "${noise}";}\n}\n`,`package lab;\npublic class Pricing { public static int applyDiscount(int price) { return price - 5; } }\n`,'Checkout.calculateTotal'),
 c('csharp','src/Checkout.cs','src/Pricing.cs',`using Lab.Pricing;\nnamespace Lab.Checkout;\npublic class Checkout {\n public int calculateTotal(int price) { return Pricing.applyDiscount(price); }\n public string publishBanner(){return "${noise}";}\n}\n`,`namespace Lab.Pricing;\npublic static class Pricing { public static int applyDiscount(int price) { return price - 5; } }\n`,'Checkout.calculateTotal'),
 c('rust','src/checkout.rs','src/pricing.rs',`use crate::pricing::apply_discount;\npub fn calculateTotal(price: i32) -> i32 { apply_discount(price) }\npub fn publishBanner() -> &'static str { "${noise}" }\n`,`pub fn apply_discount(price: i32) -> i32 { price - 5 }\n`),
 c('kotlin','src/main/kotlin/lab/Checkout.kt','src/main/kotlin/lab/Pricing.kt',`package lab\nimport lab.applyDiscount\nclass Checkout {\n fun calculateTotal(price: Int): Int { return applyDiscount(price) }\n fun publishBanner(): String { return "${noise}" }\n}\n`,`package lab\nfun applyDiscount(price: Int): Int {return price - 5}\n`,'Checkout.calculateTotal'),
 c('dart','lib/checkout.dart','lib/pricing.dart',`import './pricing.dart';\nclass Checkout {\n int calculateTotal(int price) { return applyDiscount(price); }\n String publishBanner() { return '${noise}'; }\n}\n`,`int applyDiscount(int price) { return price - 5; }\n`,'Checkout.calculateTotal'),
 c('php','src/checkout.php','src/pricing.php',`<?php\nrequire './pricing.php';\nfunction calculateTotal($price) { return applyDiscount($price); }\nfunction publishBanner(){return '${noise}';}\n`,`<?php\nfunction applyDiscount($price){return $price - 5;}\n`),
 c('ruby','lib/checkout.rb','lib/pricing.rb',`require_relative './pricing'\ndef calculateTotal(price)\n  applyDiscount(price)\nend\ndef publishBanner()\n  '${noise}'\nend\n`,`def applyDiscount(price)\n  price - 5\nend\n`),
 c('c','src/checkout.c','src/pricing.h',`#include "pricing.h"\nint calculateTotal(int price) { return applyDiscount(price); }\nconst char* publishBanner() {return "${noise}";}\n`,`int applyDiscount(int price);\n`),
 c('cpp','src/checkout.cpp','src/pricing.hpp',`#include "pricing.hpp"\nint calculateTotal(int price) { return applyDiscount(price); }\nconst char* publishBanner() {return "${noise}";}\n`,`inline int applyDiscount(int price) { return price - 5; }\n`),
];
const work=process.argv.includes('--keep')?join(process.cwd(),'qa','generated-multilang-lab'):mkdtempSync(join(tmpdir(),'agentos-multilang-'));
const reportPath=process.argv.find(x=>x.startsWith('--report='))?.slice(9);
const results=[];
const initGit=(root)=>{
 execFileSync('git',['init','-q'],{cwd:root});execFileSync('git',['config','user.name','AgentOS Lab'],{cwd:root});execFileSync('git',['config','user.email','lab@example.test'],{cwd:root});
 execFileSync('git',['add','.'],{cwd:root});execFileSync('git',['commit','-qm','fixture'],{cwd:root});
};
const put=(root,path,body)=>{const absolute=join(root,path);mkdirSync(dirname(absolute),{recursive:true});writeFileSync(absolute,body);};
const check=(value,msg,errors)=>{if(!value)errors.push(msg);};
try{
 const status=await initializeTreeSitter();
 for(const fixture of cases){
  const root=join(work,fixture.id);if(existsSync(root))rmSync(root,{recursive:true,force:true});mkdirSync(root,{recursive:true});
  put(root,fixture.entry,fixture.source);put(root,fixture.dep,fixture.helper);
  // Included decoy file must not become a task anchor purely through its generic symbols.
  const decoy=join(dirname(fixture.entry),'marketing'+fixture.entry.slice(fixture.entry.lastIndexOf('.')));
  put(root,decoy,fixture.id==='python'?'def publish_banner():\n    return 0\n':fixture.id==='go'?'package checkout\n':fixture.id==='java'?'package lab;\n':fixture.id==='kotlin'?'package lab\n':'// unrelated marketing module\n');
  if(fixture.id==='go')put(root,'go.mod','module lab\ngo 1.22\n');
  initGit(root);init(root);
  put(root,'.ai/AI_TASK.md',`# Task\nFix ${fixture.member} in ${fixture.entry}: incorrect discount total. Preserve helper pricing dependency and omit publishBanner noise.\n`);
  const errors=[];
  const analysis=parserRegistry.analyze(fixture.entry,fixture.source);
  check(fixture.id==='typescript'||fixture.id==='javascript'?analysis.parser==='typescript-ast':analysis.parser==='tree-sitter-wasm',`wrong parser: ${analysis.parser}`,errors);
  check(!analysis.diagnostics,`diagnostics: ${analysis.diagnostics}`,errors);
  const target=analysis.segments.find(s=>s.name===fixture.member);
  check(!!target,`AST target ${fixture.member} missing: ${analysis.segments.map(s=>s.name).join(', ')}`,errors);
  check(!!target&&fixture.source.slice(target.start,target.end)===target.body,`AST body offsets mismatch`,errors);
  const smart=makeSmartSnippet(fixture.entry,fixture.source,`Fix ${fixture.member} discount`,{budgetBytes:5200,minScore:18,alwaysFull:false,changed:false,explicitPath:true});
  check(smart.mode==='smart',`smart mode was ${smart.mode}`,errors);
  check(smart.segments.some(s=>s.name===fixture.member&&s.mode==='full'),`focused method not full`,errors);
  check(!smart.text.includes(noise),`noise leaked into smart context`,errors);
  const paths=[fixture.entry,fixture.dep,decoy];
  const graph=buildGraph(paths,p=>p==='go.mod'?'module lab\ngo 1.22\n':p===fixture.entry?fixture.source:p===fixture.dep?fixture.helper:readFileSync(join(root,p),'utf8'));
  const link=graph.edges.some(e=>e.from===fixture.entry&&e.to===fixture.dep);
  check(link,`missing graph link ${fixture.entry} -> ${fixture.dep}; unresolved: ${JSON.stringify(graph.unresolved)}`,errors);
  const packaged=pack(root);
  check(packaged.status==='ready',`pack failed: ${packaged.error||''}`,errors);
  const manifest=JSON.parse(readFileSync(join(root,'.ai/packs/current-task.manifest.json'),'utf8'));
  const context=readFileSync(join(root,'.ai/packs/current-task.md'),'utf8');
  // Cross-language declaration coverage must not silently say 0/0 success.
  if(!['typescript','javascript'].includes(fixture.id)){
   const semantic=manifest.crossLanguageSymbolCoverage;
   check(semantic?.discovered>=1,`no cross-file AST call grounded`,errors);
   check(semantic?.preserved>=1,`cross-language definition not preserved: ${JSON.stringify(semantic?.items)}`,errors);
   check(semantic?.unresolved===0,`unresolved cross-language definition`,errors);
   if(fixture.id==='c'){
     check(semantic?.implementationBodies===0&&semantic.items[0]?.definitionKind==='declaration-only','C header declaration falsely identified as a function body',errors);
   }else check(semantic?.implementationBodies>=1,'no imported implementation body verified',errors);
  }
  const entry=manifest.entries.find(e=>e.path===fixture.entry);
  check(!!entry,`entry not packed`,errors);
  check(entry?.parser===(fixture.id==='javascript'||fixture.id==='typescript'?'typescript-ast':'tree-sitter-wasm'),`packed parser fallback: ${entry?.parser}`,errors);
  check(context.includes('calculateTotal'),`target symbol missing from pack`,errors);
  check(context.includes('applyDiscount')||context.includes('apply_discount')||context.includes('ApplyDiscount'),`helper symbol missing from pack`,errors);
  check(!!target&&context.includes(target.body),`target function body not in pack`,errors);
  const depAnalysis=parserRegistry.analyze(fixture.dep,fixture.helper);
  const helperMethod=depAnalysis.segments.find(s=>/^(?:.*\.)?(?:applyDiscount|apply_discount|ApplyDiscount)$/.test(s.name));
  // Header-only C declarations are legitimate source evidence, not fake bodies.
  check(context.includes(fixture.helper.trim()),`full helper source not present in pack`,errors);
  // A second pack must be byte-for-byte reproducible for the same Git/task state.
  const replay=pack(root);
  const replayPack=readFileSync(join(root,'.ai/packs/current-task.md'),'utf8');
  const replayManifest=JSON.parse(readFileSync(join(root,'.ai/packs/current-task.manifest.json'),'utf8'));
  check(replay.status==='ready',`repeat pack failed`,errors);
  check(replayPack===context,`pack text changed without a source/task change`,errors);
  check(replayManifest.estimatedTokens===manifest.estimatedTokens,`token estimate changed without source/task change`,errors);
  const decoyInPack=manifest.entries.some(e=>e.path===decoy);
  check(!decoyInPack,`unrelated marketing file entered pack`,errors);

  results.push({language:fixture.id,success:errors.length===0,errors,parser:analysis.parser,astTarget:!!target,graphLinked:link,crossLanguage:{discovered:manifest.crossLanguageSymbolCoverage?.discovered||0,preserved:manifest.crossLanguageSymbolCoverage?.preserved||0,bodies:manifest.crossLanguageSymbolCoverage?.implementationBodies||0,unresolved:manifest.crossLanguageSymbolCoverage?.unresolved||0},packEntry:!!entry,helperSourceInPack:context.includes(fixture.helper.trim()),tokens:manifest.estimatedTokens,packFiles:manifest.entries.length,decoyInPack});
  process.stdout.write(`${errors.length?'FAIL':'PASS'} ${fixture.id.padEnd(11)} AST=${analysis.parser.padEnd(17)} graph=${link?'YES':'NO'} tokens=${manifest.estimatedTokens} ${errors.join('; ')}\n`);
 }
 // Mixed React/TypeScript + Python service: HTTP boundaries are not
 // statically resolved; require both explicitly named files to be present.
 const root=join(work,'mixed-react-python');if(existsSync(root))rmSync(root,{recursive:true,force:true});mkdirSync(root,{recursive:true});
 const tsUI=`export function CartTotal({quantity}:{quantity:number}) { return <strong>{quantity}</strong>; }\n`;
 const pyAPI=`def validate_cart_total(amount):\n    return amount >= 0\n`;
 put(root,'web/CartTotal.tsx',tsUI);put(root,'server/api.py',pyAPI);initGit(root);init(root);
 put(root,'.ai/AI_TASK.md','# Task\nAnalyze web/CartTotal.tsx and server/api.py: trace CartTotal UI and validate_cart_total server checks. Do not infer static HTTP call edges.\n');
 const errors=[];
 const packaged=pack(root);check(packaged.status==='ready',`pack failed: ${packaged.error||''}`,errors);
 const manifest=JSON.parse(readFileSync(join(root,'.ai/packs/current-task.manifest.json'),'utf8'));
 const textPack=readFileSync(join(root,'.ai/packs/current-task.md'),'utf8');
 check(manifest.entries.some(x=>x.path==='web/CartTotal.tsx'),`React file absent`,errors);
 check(manifest.entries.some(x=>x.path==='server/api.py'),`Python file absent`,errors);
 check(textPack.includes('validate_cart_total')&&textPack.includes('CartTotal'),`mixed symbols absent from pack`,errors);
 const client=parserRegistry.analyze('web/CartTotal.tsx',tsUI),server=parserRegistry.analyze('server/api.py',pyAPI);
 check(client.parser==='typescript-ast'&&server.parser==='tree-sitter-wasm',`incorrect mixed parsers`,errors);
 results.push({language:'mixed-react-python',success:errors.length===0,errors,parser:client.parser+' + '+server.parser,graphLinked:null,tokens:manifest.estimatedTokens,packFiles:manifest.entries.length});
 console.log(`${errors.length?'FAIL':'PASS'} mixed-react-python tokens=${manifest.estimatedTokens} ${errors.join('; ')}`);
 const summary={version:releaseVersion,wasm:status,passed:results.filter(x=>x.success).length,total:results.length,results};
 if(reportPath){mkdirSync(dirname(reportPath),{recursive:true});writeFileSync(reportPath,JSON.stringify(summary,null,2)+'\n');}
 console.log(`TOTAL ${summary.passed}/${summary.total} passed`);
 if(summary.passed!==summary.total)process.exitCode=1;
}finally{if(!process.argv.includes('--keep'))rmSync(work,{recursive:true,force:true});}
