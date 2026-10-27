import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {initializeTreeSitter} from '../src/treesitter.js';
import {parserRegistry,makeSmartSnippet} from '../src/smart.js';
import {init,pack} from '../src/commands.js';

async function fixture(files:Record<string,string>,task:string){
  await initializeTreeSitter();
  const root=mkdtempSync(join(tmpdir(),'agentos-cross-'));
  const put=(name:string,content:string)=>{const dest=join(root,name);mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,content);};
  for(const [name,body]of Object.entries(files))put(name,body);
  execFileSync('git',['init','-q'],{cwd:root});
  execFileSync('git',['config','user.name','AgentOS QA'],{cwd:root});
  execFileSync('git',['config','user.email','qa@example.test'],{cwd:root});
  execFileSync('git',['add','.'],{cwd:root});
  execFileSync('git',['commit','-qm','fixture'],{cwd:root});
  init(root);put('.ai/AI_TASK.md',`# Task\n${task}\n`);
  const result=pack(root);assert.equal(result.status,'ready');
  const m=JSON.parse(readFileSync(join(root,'.ai/packs/current-task.manifest.json'),'utf8'));
  const context=readFileSync(join(root,'.ai/packs/current-task.md'),'utf8');
  return {m,context,dispose:()=>rmSync(root,{recursive:true,force:true})};
}

test('Python named alias and local AST call chain select exact imported body, not unrelated gigantic helper',async()=>{
 const distractor='NOISE_CROSS_LANGUAGE_'+ 'V'.repeat(11000);
 const f=await fixture({
 'src/checkout.py':'from .pricing import apply_discount as discounted\ndef calculateTotal(x):\n    return validate(x)\ndef validate(x):\n    return discounted(x)\n# discounted(x) is just a comment\n',
 'src/pricing.py':`def apply_discount(x):\n    return x - 7\ndef publish_banner():\n    return '${distractor}'\n`,
 },'Fix calculateTotal in src/checkout.py, including the imported pricing helper.');
 try{
  const c=f.m.crossLanguageSymbolCoverage;
  assert.equal(c.discovered,1,JSON.stringify(c.items));
  assert.equal(c.preserved,1);assert.equal(c.implementationBodies,1);
  assert.equal(c.items[0].name,'apply_discount');
  assert.match(c.items[0].caller,/calculateTotal => validate/);
  assert.match(c.items[0].evidence,/named-import/);
  assert.match(f.context,/return x - 7/);
  assert.doesNotMatch(f.context,/NOISE_CROSS_LANGUAGE_/);
 }finally{f.dispose();}
});

test('AST does not mistake Python comments or string literals for imported calls',async()=>{
 const f=await fixture({'src/checkout.py':'from .pricing import apply_discount\ndef calculateTotal(x):\n    # apply_discount(x)\n    return "apply_discount(x)"\n','src/pricing.py':'def apply_discount(x):\n    return x - 10\n'},'Fix calculateTotal in src/checkout.py.');
 try{assert.equal(f.m.crossLanguageSymbolCoverage.discovered,0);}finally{f.dispose();}
});

test('Java wrong method receiver cannot ground imported Pricing method',async()=>{
 const f=await fixture({'src/main/java/lab/Checkout.java':'package lab;\nimport lab.Pricing;\npublic class Checkout {int calculateTotal(int x) { return Other.applyDiscount(x); }}\n',
 'src/main/java/lab/Pricing.java':'package lab;\npublic class Pricing {static int applyDiscount(int x){return x-10;}}\n'},'Fix Checkout.calculateTotal in src/main/java/lab/Checkout.java.');
 try{assert.equal(f.m.crossLanguageSymbolCoverage.discovered,0);}finally{f.dispose();}
});

test('Ambiguous duplicate implementations are not given false full-coverage evidence',async()=>{
 const f=await fixture({'src/checkout.py':'from .pricing import apply_discount\ndef calculateTotal(x):\n    return apply_discount(x)\n',
 'src/pricing.py':'def apply_discount(x):\n    return x - 1\ndef apply_discount(x):\n    return x - 2\n'},'Fix calculateTotal in src/checkout.py.');
 try{assert.equal(f.m.crossLanguageSymbolCoverage.discovered,0);}finally{f.dispose();}
});

test('C header-only definition is explicitly declaration-only, not implementation body',async()=>{
 const f=await fixture({'src/checkout.c':'#include "pricing.h"\nint calculateTotal(int x){return applyDiscount(x);}\n',
 'src/pricing.h':'int applyDiscount(int x);\n'},'Fix calculateTotal in src/checkout.c.');
 try{assert.equal(f.m.crossLanguageSymbolCoverage.preserved,1);assert.equal(f.m.crossLanguageSymbolCoverage.implementationBodies,0);assert.equal(f.m.crossLanguageSymbolCoverage.items[0].definitionKind,'declaration-only');}finally{f.dispose();}
});

test('Dart top-level function and adjacent-body invocation are real AST evidence',async()=>{
 await initializeTreeSitter();
 const source='class Checkout { int calculateTotal(int x){return applyDiscount(x);} }';
 const a=parserRegistry.analyze('lib/checkout.dart',source);
 assert.equal(a.parser,'tree-sitter-wasm');assert.deepEqual(a.segments.find(s=>s.name==='Checkout.calculateTotal')?.calls,['applyDiscount']);
 const b=parserRegistry.analyze('lib/pricing.dart','int applyDiscount(int x){return x - 2;}');
 assert.equal(b.parser,'tree-sitter-wasm');assert.equal(b.segments.find(s=>s.name==='applyDiscount')?.kind,'function');
});

test('bounded two-hop Python AST call chain preserves transitively imported definition',async()=>{
 const f=await fixture({
  'src/checkout.py':'from .pricing import apply_discount\ndef calculateTotal(x):\n    return apply_discount(x)\n',
  'src/pricing.py':'from .currency import normalize\ndef apply_discount(x):\n    return normalize(x) - 10\n',
  'src/currency.py':'def normalize(x):\n    return round(x, 2)\n',
 },'Fix calculateTotal in src/checkout.py.');
 try{
  const c=f.m.crossLanguageSymbolCoverage;
  assert.equal(c.discovered,2,JSON.stringify(c.items));
  assert.equal(c.preserved,2,JSON.stringify(c.items));
  assert.deepEqual(new Set(c.items.map((x:any)=>x.name)),new Set(['apply_discount','normalize']));
  assert.match(f.context,/return round\(x, 2\)/);
 }finally{f.dispose();}
});
