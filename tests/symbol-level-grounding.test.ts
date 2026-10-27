import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {analyzeSource,discoverImportedMemberCalls,makeSmartSnippet} from '../src/smart.js';
import {init,pack} from '../src/commands.js';
import type {PackManifest} from '../src/pack.js';

const filler='X'.repeat(5000);
const largeDb=`export const db = {
  products: {
    getByIds: async (ids: string[]) => ids.map(mapProductToApp),
    list: async () => ['unrelated-product-list']
  },
  orders: {createWithValidation: async (order: any) => ({...order, ok:true})},
  reviews: {list: async () => {const unrelated = '${filler}';return unrelated;}},
};
const mapProductToApp=(id:string)=>({id});
const mapReviewToApp=(review:any)=>review;
`;
const task='Analyze shopping cart flow. Find add to cart, cart state, quantity updates, total price calculations and relevant dependencies.';

const opts={budgetBytes:16000,minScore:30,alwaysFull:false,changed:false,explicitPath:false,
 semanticGrounding:'direct-dependency' as const,
 importedMembers:[{qualifiedName:'db.products.getByIds',caller:'pages/store/Cart.tsx:11:processOrder'}]};

test('splits a large exported nested object into independent AST method segments',()=>{
 const names=analyzeSource('src/lib/db.ts',largeDb,{forceApiSplit:true}).segments.map(s=>s.name);
 assert.ok(names.includes('db.products.getByIds'));
 assert.ok(names.includes('db.orders.createWithValidation'));
 assert.ok(names.includes('db.reviews.list'));
 const snippet=makeSmartSnippet('src/lib/db.ts',largeDb,task,opts);
 assert.equal(snippet.segments.find(s=>s.name==='db.products.getByIds')?.mode,'full');
 assert.equal(snippet.segments.find(s=>s.name==='mapProductToApp')?.mode,'full');
 assert.notEqual(snippet.segments.find(s=>s.name==='db.reviews.list')?.mode,'full');
 assert.notEqual(snippet.segments.find(s=>s.name==='db.orders.createWithValidation')?.mode,'full');
 assert.doesNotMatch(snippet.text,/unrelated-product-list/);
 assert.doesNotMatch(snippet.text,/X{500}/);
 const evidence=snippet.semanticDependencies?.find(s=>s.name==='db.products.getByIds');
 assert.equal(evidence?.reason,'imported-member-call');
 assert.equal(evidence?.seed,'pages/store/Cart.tsx:11:processOrder');
});

test('AST member-call discovery respects imported aliases, comments, strings and dynamic properties',()=>{
 const code=`import {db as storeDb} from '../lib/db';
 const label='storeDb.reviews.list()'; // storeDb.reviews.list()
 function processOrder(){storeDb.products.getByIds(['1']);storeDb.orders.createWithValidation({});storeDb[window.name].list();}
 `;
 assert.deepEqual(discoverImportedMemberCalls('pages/store/Cart.tsx',code,'../lib/db').map(x=>x.qualifiedName),
 ['db.orders.createWithValidation','db.products.getByIds']);
 assert.equal(discoverImportedMemberCalls('pages/store/Cart.tsx',code,'./irrelevant').length,0);
 const namespace=`import * as service from '../lib/db';service.db.products.getByIds([]);`;
 assert.equal(discoverImportedMemberCalls('pages/store/Cart.tsx',namespace,'../lib/db')[0]?.qualifiedName,'db.products.getByIds');
 const shadowed=`import {db} from '../lib/db'; function unrelated(db:any){db.reviews.list();} const real=()=>db.products.getByIds([]);`;
 assert.deepEqual(discoverImportedMemberCalls('pages/store/Cart.tsx',shadowed,'../lib/db').map(x=>x.qualifiedName),['db.products.getByIds']);
});

test('repository pack selects imported API methods, not unrelated sibling methods; reports unresolved',()=>{
 const root=mkdtempSync(join(tmpdir(),'agentos-symbol-grounding-'));
 const put=(p:string,v:string)=>{mkdirSync(dirname(join(root,p)),{recursive:true});writeFileSync(join(root,p),v);};
 const git=(...args:string[])=>execFileSync('git',args,{cwd:root,stdio:'pipe'});
 try{
  git('init','-q');git('config','user.email','test@example.com');git('config','user.name','Test');
  put('src/lib/db.ts',largeDb);
  put('pages/store/Cart.tsx',`import {db} from '../../src/lib/db';
export function Cart(){const subtotal=100;const total=subtotal;
const processOrder=()=>db.products.getByIds(['1']);
return <button onClick={processOrder}>Cart total {total}</button>;
}`);
  put('components/ProductCard.tsx',`export function ProductCard(){const addToCart=()=>{};return <button onClick={addToCart}>Add to cart</button>}`);
  put('pages/admin/AdminProducts.tsx',`import {db} from '../../src/lib/db';export function AdminProducts(){return <button onClick={()=>db.reviews.list()}>Reviews admin</button>}`);
  git('add','.');git('commit','-qm','stable');init(root);put('.ai/AI_TASK.md',task);
  assert.equal(pack(root).status,'ready');
  const m=JSON.parse(readFileSync(join(root,'.ai/packs/current-task.manifest.json'),'utf8')) as PackManifest;
  const body=readFileSync(join(root,'.ai/packs/current-task.md'),'utf8');
  const tracked=m.importedMemberCoverage!;
  assert.ok(tracked.discovered>=1,JSON.stringify(tracked));
  assert.ok(tracked.items.some(x=>x.qualifiedName==='db.products.getByIds'&&x.mode==='full'),JSON.stringify(tracked.items));
  assert.ok(!tracked.items.some(x=>x.qualifiedName==='db.reviews.list'),'indirect admin call must not seed API');
  assert.match(body,/FULL db.products.getByIds/);
  assert.doesNotMatch(body,/FULL db.reviews.list/);
  assert.ok(m.semanticDependencyCoverage?.items.some(i=>i.reason==='imported-member-call'&&i.trace[0]!.includes('Cart.tsx')));
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('a call to an absent named API member is explicitly unresolved, not falsely preserved',()=>{
 const root=mkdtempSync(join(tmpdir(),'agentos-member-missing-'));
 const put=(p:string,v:string)=>{mkdirSync(dirname(join(root,p)),{recursive:true});writeFileSync(join(root,p),v);};
 const git=(...args:string[])=>execFileSync('git',args,{cwd:root,stdio:'pipe'});
 try{
  git('init','-q');git('config','user.email','test@example.com');git('config','user.name','Test');
  put('src/lib/db.ts',largeDb);
  put('pages/store/Cart.tsx',`import {db} from '../../src/lib/db';export function Cart(){const total=100;const addToCart=()=>db.products.missingMethod();return <button onClick={addToCart}>{total}</button>}`);
  git('add','.');git('commit','-qm','stable');init(root);put('.ai/AI_TASK.md',task);
  assert.equal(pack(root).status,'ready');
  const m=JSON.parse(readFileSync(join(root,'.ai/packs/current-task.manifest.json'),'utf8')) as PackManifest;
  assert.ok(m.importedMemberCoverage?.items.some(i=>i.qualifiedName==='db.products.missingMethod'&&i.mode==='unresolved'&&i.reason==='member-definition-not-resolved'));
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('a small full-source API is verified by its actual AST declaration',()=>{
 const source=`export const db={orders:{create: async ()=>({ok:true}),cancel: async()=>({ok:false})}};`;
 assert.ok(analyzeSource('db.ts',source,{forceApiSplit:true}).segments.some(s=>s.name==='db.orders.create'));
});
