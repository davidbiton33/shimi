/** Strict real WASM suite. An actual parser and actual vendored WASM files are
 * mandatory when AGENTOS_REQUIRE_WASM=1. Never accept structural fallback. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeTreeSitter, treeSitterStatus } from '../src/treesitter.js';
import { parserRegistry, makeSmartSnippet } from '../src/smart.js';
import { buildGraph } from '../src/graph.js';

const strict=process.env.AGENTOS_REQUIRE_WASM==='1';
const cases:[string,string,string,string,string][]=[
 ['python','demo.py','class Auth:\n    def verify(self, token):\n        return token != ""\n','Auth.verify','return token'],
 ['go','demo.go','package main\nfunc Verify(token string) bool { return token != "" }\n','Verify','return token'],
 ['java','Demo.java','class Auth { boolean verify(String token) { return token != null; } }','Auth.verify','return token'],
 ['c_sharp','Demo.cs','public class Auth { public bool Verify(string token) { return token != null; } }','Auth.Verify','return token'],
 ['rust','demo.rs','fn verify(token: &str) -> bool { !token.is_empty() }','verify','is_empty'],
 ['kotlin','Demo.kt','class Auth {\n fun verify(token: String): Boolean {\n  return token.isNotEmpty()\n }\n}\n','Auth.verify','return token'],
 ['dart','demo.dart','class Auth { bool verify(String token) { return token.isNotEmpty; } }','Auth.verify','return token'],
 ['php','demo.php','<?php class Auth { public function verify($token) { return strlen($token)>0; } }','Auth.verify','return strlen'],
 ['ruby','demo.rb','class Auth\n def verify(token)\n  !token.empty?\n end\nend\n','Auth.verify','token.empty?'],
 ['c','demo.c','int verify(const char *token) { return token != 0; }','verify','return token'],
 ['cpp','demo.cpp','class Auth { public: bool verify(const char* token) { return token != nullptr; } };','Auth.verify','return token']
];
test('real bundled Tree-sitter WASM loads, verifies checksum and extracts symbols in all 11 grammars',async t=>{
 if(!strict)return t.skip('strict real-WASM suite requires AGENTOS_REQUIRE_WASM=1');
 const status=await initializeTreeSitter();
 assert.equal(status.runtime,'ready',JSON.stringify(status.failed));
 assert.equal(status.enabled,true);
 assert.deepEqual(status.failed,{});
 assert.equal(status.grammars.length,11);
 assert.deepEqual(status,treeSitterStatus());
 for(const [lang,path,source,name,body] of cases){
  await t.test(lang,()=>{
   assert.ok(status.grammars.includes(lang),`missing WASM grammar: ${lang}`);
   const a=parserRegistry.analyze(path,source);
   assert.equal(a.parser,'tree-sitter-wasm',`${lang} fell back to structural-lexer`);
   assert.equal(a.diagnostics,0,`${lang} returned syntax errors`);
   const symbol=a.segments.find(s=>s.name===name);
   assert.ok(symbol,`${lang} did not extract ${name}: ${a.segments.map(s=>s.name).join(', ')}`);
   assert.ok(symbol.body.includes(body),`${lang} did not preserve function body`);
   assert.equal(source.slice(symbol.start,symbol.end),symbol.body,`${lang}: wrong source offsets`);
  });
 }
});
test('vendored runtime and 11 grammars are byte-for-byte identical to the pinned bootstrap manifest',t=>{
 if(!strict)return t.skip('strict real-WASM suite requires AGENTOS_REQUIRE_WASM=1');
 const base=join(dirname(fileURLToPath(import.meta.url)),'..','vendor','tree-sitter');
 const manifest=JSON.parse(readFileSync(join(base,'asset-manifest.json'),'utf8')) as {assets:{path:string;bytes:number;sha256:string}[]};
 const assets=new Set(manifest.assets.map(a=>a.path));
 for(const language of cases.map(x=>x[0]))assert.ok(assets.has(`tree-sitter-${language}.wasm`));
 for(const asset of manifest.assets){
  const b=readFileSync(join(base,asset.path));
  assert.equal(b.length,asset.bytes,`incorrect byte count: ${asset.path}`);
  assert.equal(createHash('sha256').update(b).digest('hex'),asset.sha256,`bad SHA-256: ${asset.path}`);
 }
});
test('actual Python AST is used for Smart Context compression and the incremental JS symbol graph remains consistent in the same process',async t=>{
 if(!strict)return t.skip('strict real-WASM suite requires AGENTOS_REQUIRE_WASM=1');
 await initializeTreeSitter();
 const source='class Auth:\n    def verify(self, token):\n        return token != ""\n'+Array.from({length:70},(_,i)=>`\ndef unrelated_${i}(value):\n    return value * ${i+1}\n`).join('');
 const packed=makeSmartSnippet('demo.py',source,'Fix Auth.verify',{
  budgetBytes:1300,minScore:16,alwaysFull:false,changed:false,explicitPath:false
 });
 assert.equal(packed.parser,'tree-sitter-wasm');
 assert.equal(packed.mode,'smart');
 assert.ok(packed.segments.some(s=>s.name==='Auth.verify'&&s.mode==='full'));
 assert.ok(packed.includedBytes<packed.originalBytes);
 const files:Record<string,string>={
  'app.ts':'import {verify} from "./auth"; verify();',
  'auth.ts':'export function verify() { return true; }',
  'demo.py':source,
  'demo.go':'package main\nfunc Verify() bool { return true }\n'
 };
 // Use in-memory graph + on-disk caches exactly as the product would.
 const {mkdtempSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');
 const work=mkdtempSync(join(tmpdir(),'agentos-v081-wasm-graph-'));
 t.after(()=>rmSync(work,{recursive:true,force:true}));
 const graph=()=>buildGraph(Object.keys(files),p=>files[p],undefined,join(work,'dependency-graph-index.json'));
 const cold=graph(),warm=graph();
 assert.equal(cold.symbols?.resolved,1);
 assert.equal(warm.incrementalSymbols?.recomputedFiles,0);
 assert.deepEqual(cold.symbols,warm.symbols);
 files['demo.py']=source.replace('return token != ""','return bool(token)');
 const edited=graph();
 assert.equal(edited.symbols?.resolved,1);
 assert.equal(edited.incrementalSymbols?.recomputedFiles,0);
 assert.ok((edited.cache?.misses??0)>=1);
 assert.equal(parserRegistry.analyze('demo.py',files['demo.py']).parser,'tree-sitter-wasm');
});
