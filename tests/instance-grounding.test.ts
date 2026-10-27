import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {initializeTreeSitter} from '../src/treesitter.js';
import {parserRegistry} from '../src/smart.js';
import {init,pack} from '../src/commands.js';

async function verify(files:Record<string,string>,target:string,expectName:string|null,expectEvidence?:string){
 await initializeTreeSitter();
 const root=mkdtempSync(join(tmpdir(),'agentos-receiver-'));
 try{
  for(const [f,content]of Object.entries(files)){
   const full=join(root,f);mkdirSync(dirname(full),{recursive:true});writeFileSync(full,content);
  }
  execFileSync('git',['init','-q'],{cwd:root});
  execFileSync('git',['config','user.name','AgentOS QA'],{cwd:root});
  execFileSync('git',['config','user.email','qa@example.test'],{cwd:root});
  execFileSync('git',['add','.'],{cwd:root});
  execFileSync('git',['commit','-qm','fixture'],{cwd:root});
  init(root);
  writeFileSync(join(root,'.ai/AI_TASK.md'),`Fix calculateTotal in ${target}. Verify related imported service implementation.\n`);
  assert.equal(pack(root).status,'ready');
  const m=JSON.parse(readFileSync(join(root,'.ai/packs/current-task.manifest.json'),'utf8'));
  const cross=m.crossLanguageSymbolCoverage;
  if(expectName===null)assert.equal(cross.discovered,0,JSON.stringify(cross.items));
  else {
   assert.ok(cross.items.some((x:any)=>x.name===expectName),JSON.stringify(cross.items));
   assert.ok(cross.items.some((x:any)=>x.name===expectName&&x.mode==='full'),JSON.stringify(cross.items));
   if(expectEvidence)assert.ok(cross.items.some((x:any)=>x.name===expectName&&x.evidence.includes(expectEvidence)),JSON.stringify(cross.items));
  }
  return {m,text:readFileSync(join(root,'.ai/packs/current-task.md'),'utf8')};
 }finally{rmSync(root,{recursive:true,force:true});}
}

test('Java instance receiver binds to unique imported class, not same-name sibling',async()=>{
 const f=await verify({
 'src/main/java/lab/Checkout.java':'package lab;\nimport lab.Pricing;\npublic class Checkout { int calculateTotal(int x) { Pricing helper = new Pricing(); return helper.applyDiscount(x); } }\n',
 'src/main/java/lab/Pricing.java':`package lab;\npublic class Pricing { int applyDiscount(int x) { return x - 5; } String unrelated() { return \"${'Q'.repeat(15000)}\"; } }\n`,
 },'src/main/java/lab/Checkout.java','Pricing.applyDiscount','constructed-local');
 assert.match(f.text,/return x - 5/);assert.doesNotMatch(f.text,/QQQQQQQQQQ/);
});

test('C# var instance binds to imported service class',async()=>{
 await verify({
 'src/Checkout.cs':'using Lab.Pricing;\nnamespace Lab.Checkout;\npublic class Checkout { public int calculateTotal(int x) { var helper = new Pricing(); return helper.applyDiscount(x); } }\n',
 'src/Pricing.cs':'namespace Lab.Pricing;\npublic class Pricing { public int applyDiscount(int x) { return x - 7; } }\n',
 },'src/Checkout.cs','Pricing.applyDiscount','constructed-local');
});

test('Python constructor alias resolves instance method with AST evidence',async()=>{
 await verify({
 'src/checkout.py':'from .pricing import Pricing as P\ndef calculateTotal(x):\n    helper = P()\n    return helper.apply_discount(x)\n',
 'src/pricing.py':'class Pricing:\n    def apply_discount(self, x):\n        return x - 11\n',
 },'src/checkout.py','Pricing.apply_discount','constructed-local');
});

test('Python module alias resolves imported module function without guessing class',async()=>{
 await verify({
 'src/checkout.py':'import pricing as p\ndef calculateTotal(x):\n    return p.apply_discount(x)\n',
 'src/pricing.py':'def apply_discount(x):\n    return x - 13\n',
 },'src/checkout.py','apply_discount','namespace-import');
});

test('Dart selector AST detects a receiver call and resolves constructed instance',async()=>{
 await initializeTreeSitter();
 const caller='import "./pricing.dart";\nclass Checkout {\n  int calculateTotal(int x) { final helper = Pricing(); return helper.applyDiscount(x); }\n}\n';
 const call=parserRegistry.analyze('lib/checkout.dart',caller).segments.find(x=>x.name==='Checkout.calculateTotal');
 assert.deepEqual(call?.calls,['helper.applyDiscount']);
 await verify({
 'lib/checkout.dart':caller,
 'lib/pricing.dart':'class Pricing { int applyDiscount(int x) { return x - 3; } }\n',
 },'lib/checkout.dart','Pricing.applyDiscount','constructed-local');
});

test('Kotlin constructed service call resolves (multiline AST)',async()=>{
 await verify({
 'src/main/kotlin/lab/Checkout.kt':'package lab\nimport lab.Pricing\nclass Checkout {\n fun calculateTotal(x: Int): Int {\n   val helper = Pricing()\n   return helper.applyDiscount(x)\n }\n}\n',
 'src/main/kotlin/lab/Pricing.kt':'package lab\nclass Pricing {\n fun applyDiscount(x: Int): Int { return x - 9 }\n}\n',
 },'src/main/kotlin/lab/Checkout.kt','Pricing.applyDiscount','constructed-local');
});

test('No forged instance binding from comment or duplicate reassignment',async()=>{
 const base='package lab;\nimport lab.Pricing;\npublic class Checkout { int calculateTotal(int x) { Pricing helper = new Pricing(); helper = new Other(); return helper.applyDiscount(x); } }\n';
 await verify({
 'src/main/java/lab/Checkout.java':base,
 'src/main/java/lab/Pricing.java':'package lab; public class Pricing { int applyDiscount(int x) { return x - 4; } }\n',
 },'src/main/java/lab/Checkout.java',null);
});

test('Dart comments do not provide fabricated constructor identity',async()=>{
 await verify({
 'lib/checkout.dart':'import "./pricing.dart";\nclass Checkout {\n int calculateTotal(int x) { final helper = Other(); /* helper = Pricing(); */ return helper.applyDiscount(x); }\n}\n',
 'lib/pricing.dart':'class Pricing { int applyDiscount(int x) { return x - 3; } }\n',
 },'lib/checkout.dart',null);
});

test('Rust impl receiver through local struct value resolves unique method',async()=>{
 await verify({
 'src/checkout.rs':'use crate::pricing::Pricing;\nfn calculateTotal(x: i32)->i32{ let helper = Pricing{}; helper.apply_discount(x) }\n',
 'src/pricing.rs':'pub struct Pricing {}\nimpl Pricing{ pub fn apply_discount(&self, x:i32)->i32{x-3} }\n',
 },'src/checkout.rs','Pricing.apply_discount','constructed-local');
});

test('Go struct receiver type grounds package method via local constructor',async()=>{
 await verify({
 'go.mod':'module lab\ngo 1.22\n',
 'checkout/checkout.go':'package checkout\nimport "lab/pricing"\nfunc calculateTotal(x int) int { helper := pricing.Pricing{}; return helper.ApplyDiscount(x) }\n',
 'pricing/pricing.go':'package pricing\ntype Pricing struct{}\nfunc (p Pricing) ApplyDiscount(x int) int {return x - 5}\n',
 },'checkout/checkout.go','ApplyDiscount','constructed-local');
});

test('Constructor after the call cannot justify a previous receiver invocation',async()=>{
 await verify({
 'src/main/java/lab/Checkout.java':'package lab;\nimport lab.Pricing;\npublic class Checkout { int calculateTotal(int x) { int y = helper.applyDiscount(x); Pricing helper = new Pricing(); return y; } }\n',
 'src/main/java/lab/Pricing.java':'package lab;\npublic class Pricing { int applyDiscount(int x) { return x - 2; } }\n',
 },'src/main/java/lab/Checkout.java',null);
});
