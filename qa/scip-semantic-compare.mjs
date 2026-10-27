/** Reproducible held-out ambiguity test. Real TypeScript checker emits SCIP. */
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
const [oldCli,newCli,indexer]=process.argv.slice(2);
if(!oldCli||!newCli||!indexer)throw new Error('Usage: node qa/scip-semantic-compare.mjs <old CLI> <new CLI> <indexer script>');
const root=mkdtempSync(join(tmpdir(),'agentos-semantic-heldout-'));
const cmd=(bin,args,cwd=root)=>JSON.parse(execFileSync(process.execPath,[resolve(bin),...args,'--cwd',cwd,'--json'],{encoding:'utf8',timeout:45000}));
try{
 mkdirSync(join(root,'src'));
 writeFileSync(join(root,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'esnext',module:'esnext',moduleResolution:'node',baseUrl:'.',paths:{'@pricing':['src/discount-right.ts']},strict:true},include:['src']},null,2));
 writeFileSync(join(root,'src','ui.ts'),"import { calculateDiscount } from '@pricing';\nexport function checkout(total: number) { return calculateDiscount(total); }\n");
 writeFileSync(join(root,'src','discount-right.ts'),"export function calculateDiscount(value: number) { return value - 17; }\n");
 writeFileSync(join(root,'src','discount-wrong.ts'),"export function calculateDiscount(value: number) { return value - 99; }\n");
 writeFileSync(join(root,'src','unrelated.ts'),"export function login(password: string) { return password; }\n");
 execFileSync('git',['init','-q'],{cwd:root});
 execFileSync('git',['config','user.email','qa@example.org'],{cwd:root});
 execFileSync('git',['config','user.name','QA'],{cwd:root});
 execFileSync('git',['add','.'],{cwd:root});
 execFileSync('git',['commit','-qm','source'],{cwd:root});
 cmd(newCli,['init']);
 writeFileSync(join(root,'.ai','AI_TASK.md'),'# Task\nTrace calculateDiscount from src/ui.ts checkout and preserve its actual target definition through the path alias.\n');
 const old=cmd(oldCli,['pack']);
 const oldManifest=JSON.parse(readFileSync(join(root,'.ai','packs','current-task.manifest.json')));
 const oldPaths=oldManifest.entries.map(e=>e.path);
 const idx=join(root,'index.scip');execFileSync(process.execPath,[resolve(indexer),root,idx],{encoding:'utf8'});
 const imported=cmd(newCli,['scip','import','--index',idx]);
 const newer=cmd(newCli,['pack']);
 const manifest=JSON.parse(readFileSync(join(root,'.ai','packs','current-task.manifest.json')));
 const graph=JSON.parse(readFileSync(join(root,'.ai','packs','dependency-graph.json')));
 const paths=manifest.entries.map(e=>e.path);
 const evidence=graph.semanticReferences.filter(e=>e.from==='src/ui.ts'&&e.symbolName==='calculateDiscount').map(e=>e.to);
 const result={scenario:'TypeScript path alias with two identically-named functions',indexer:'real TypeScript TypeChecker via QA-only SCIP emitter',
 old:{status:old.status,estimatedTokens:oldManifest.estimatedTokens,files:oldPaths},
 new:{status:newer.status,estimatedTokens:manifest.estimatedTokens,files:paths,scip:manifest.scip},
 evidence,checks:{typecheckerUniqueTarget:evidence.length===1&&evidence[0]==='src/discount-right.ts',
  staticCallsiteVerified:graph.scipCallsites.some(e=>e.from==='src/ui.ts'&&e.to==='src/discount-right.ts'&&e.symbolName==='calculateDiscount'&&e.evidence==='scip-symbol-and-typescript-call-ast'),
  correctIncluded:paths.includes('src/discount-right.ts'),wrongExcluded:!paths.includes('src/discount-wrong.ts'),
  improvedWrongSelection:oldPaths.includes('src/discount-wrong.ts')&&!paths.includes('src/discount-wrong.ts')},
 };
 console.log(JSON.stringify(result,null,2));
 if(Object.values(result.checks).some(x=>!x))process.exitCode=1;
}finally{if(process.env.AGENTOS_QA_KEEP)console.error('FIXTURE='+root);else rmSync(root,{force:true,recursive:true});}
