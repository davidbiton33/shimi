import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildGraph} from '../src/graph.js';

const graph=(files:Record<string,string>,goMod?:string)=>buildGraph(Object.keys(files),p=>p==='go.mod'?(goMod||null):files[p]||null);
const edge=(g:ReturnType<typeof graph>,from:string,to:string)=>g.edges.some(e=>e.from===from&&e.to===to);

test('Rust: crate::module::imported_symbol resolves existing module file, not symbol-as-file',()=>{
 const files={'src/checkout.rs':'use crate::pricing::apply_discount;\npub fn calc(v:i32)->i32 { apply_discount(v) }',
  'src/pricing.rs':'pub fn apply_discount(v:i32)->i32 { v - 1 }',
  'src/admin.rs':'pub fn apply_discount(v:i32)->i32 { v + 1 }'};
 const g=graph(files);
 assert.ok(edge(g,'src/checkout.rs','src/pricing.rs'),JSON.stringify(g.unresolved));
 assert.ok(!edge(g,'src/checkout.rs','src/admin.rs'));
});

test('Rust: module imports support mod.rs and self/super, while external crates stay unresolved',()=>{
 const files={'src/checkout/mod.rs':'use super::pricing::apply_discount;\nuse thirdparty::unknown;',
  'src/pricing.rs':'pub fn apply_discount(v:i32)->i32 {v}',
  'src/tools/mod.rs':'use crate::pricing::apply_discount;'};
 const g=graph(files);
 assert.ok(edge(g,'src/checkout/mod.rs','src/pricing.rs'));
 assert.ok(edge(g,'src/tools/mod.rs','src/pricing.rs'));
 assert.ok(g.unresolved.some(x=>x.specifier==='thirdparty::unknown'));
});

test('Kotlin: top-level function import resolves unique package symbol, not same-named directory',()=>{
 const files={'src/main/kotlin/demo/Checkout.kt':'package demo\nimport demo.applyDiscount\nclass Checkout {}',
  'src/main/kotlin/demo/Pricing.kt':'package demo\nfun applyDiscount(v: Int): Int = v - 1',
  'src/main/kotlin/other/Pricing.kt':'package other\nfun applyDiscount(v: Int): Int = v + 1'};
 const g=graph(files);
 assert.ok(edge(g,'src/main/kotlin/demo/Checkout.kt','src/main/kotlin/demo/Pricing.kt'));
 assert.ok(!edge(g,'src/main/kotlin/demo/Checkout.kt','src/main/kotlin/other/Pricing.kt'));
});

test('Kotlin: an ambiguous same-package symbol cannot pick an arbitrary source file',()=>{
 const files={'src/main/kotlin/demo/Checkout.kt':'package demo\nimport demo.applyDiscount\nclass Checkout {}',
  'src/main/kotlin/demo/A.kt':'package demo\nfun applyDiscount(v:Int): Int = v',
  'src/main/kotlin/demo/B.kt':'package demo\nfun applyDiscount(v:Int): Int = v'};
 const g=graph(files);
 assert.ok(!g.edges.some(x=>x.from==='src/main/kotlin/demo/Checkout.kt'));
 assert.ok(g.unresolved.some(x=>x.specifier==='demo.applyDiscount'));
});

test('Go: module import resolves all package source files under module-root folder',()=>{
 const files={'checkout/checkout.go':'package checkout\nimport "example.com/shop/pricing"\nfunc Calc() {}',
  'pricing/discount.go':'package pricing\nfunc Discount() {}',
  'pricing/tax.go':'package pricing\nfunc Tax() {}'};
 const g=graph(files,'module example.com/shop\ngo 1.22');
 assert.ok(edge(g,'checkout/checkout.go','pricing/discount.go'));
 assert.ok(edge(g,'checkout/checkout.go','pricing/tax.go'));
});

test('JS/TS relative import resolves .js specifier to TypeScript .ts implementation',()=>{
 const files={'src/cart.ts':'import {adjust} from "./pricing.js";\nexport const use = adjust;',
  'src/pricing.ts':'export const adjust = (v: number) => v - 1;'};
 const g=graph(files);
 assert.ok(edge(g,'src/cart.ts','src/pricing.ts'));
});
