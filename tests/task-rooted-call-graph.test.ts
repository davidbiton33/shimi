import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {classifyTaskRootedMembers,discoverImportedMemberCalls} from '../src/smart.js';
import {init,pack} from '../src/commands.js';
import type {PackManifest} from '../src/pack.js';

const cartTask='Analyze shopping cart flow: where products are added, cart state, quantity updates, total price calculations, relevant imports and possible inconsistencies.';
const checkoutTask='Analyze the checkout flow and coupon validation, payment transaction errors, order creation and billing integrations.';
const cartSource=`import { db } from '../../src/lib/db';
export function Cart(){
  const [quantity,setQuantity]=useState(1);
  const updateQuantity=()=>db.products.getByIds(['123']);
  const processOrder=()=>db.coupons.validateCoupon('HELLO');
  useEffect(()=>{db.settings.getAll()},[]);
  return <main><button onClick={updateQuantity}>Update cart quantity</button>
    <button onClick={processOrder}>Pay securely</button></main>;
}`;
const layoutSource=`import {db} from '../src/lib/db';
export function StoreLayout(){
 const loadLayoutData=()=>{ db.categories.list();db.collections.list();db.pages.list();db.promotions.getActive();db.settings.getAll() };
 const toggleCart=()=>{};
 return <><button onClick={toggleCart}>Toggle cart</button><button onClick={loadLayoutData}>Refresh layout</button></>;
}`;
const dbSource=`export const db={
 products:{getByIds:async (ids:string[])=> ids.map(mapProductToApp)},
 coupons:{validateCoupon:async (code:string)=>'${'x'.repeat(4800)}'+code},
 settings:{getAll:async()=>({settings:'${'y'.repeat(3000)}'})},
 categories:{list:async()=> ['${'z'.repeat(4000)}']},
 collections:{list:async()=>['A']},
 pages:{list:async()=>['B']},
 promotions:{getActive:async()=>[]}
};
const mapProductToApp=(id:string)=>({id});
`;

test('only real task roots promote imported methods, not all methods in an anchor component',()=>{
 const c=discoverImportedMemberCalls('pages/store/Cart.tsx',cartSource,'../../src/lib/db');
 const selected=classifyTaskRootedMembers('pages/store/Cart.tsx',cartSource,cartTask,['updateQuantity'],c);
 assert.equal(selected.length,3);
 assert.deepEqual(selected.filter(x=>x.rooted).map(x=>x.call.qualifiedName),['db.products.getByIds']);
 assert.deepEqual(selected.filter(x=>!x.rooted).map(x=>x.call.qualifiedName),['db.coupons.validateCoupon','db.settings.getAll']);
 assert.equal(selected.find(x=>x.rooted)?.reason,'task-symbol');
 const layout=discoverImportedMemberCalls('components/StoreLayout.tsx',layoutSource,'../src/lib/db');
 const l=classifyTaskRootedMembers('components/StoreLayout.tsx',layoutSource,cartTask,['toggleCart'],layout);
 assert.equal(l.filter(x=>x.rooted).length,0,'imported members called by layout loader are not cart actions');
});

test('a task-related visible UI label can ground its local handler without hardcoded method names',()=>{
 const s=`import {db} from './db';
  function Panel(){const special=()=>db.coupons.validateCoupon('x');return <button onClick={special}>Validate checkout coupon</button>}`;
 const c=discoverImportedMemberCalls('Panel.tsx',s,'./db');
 const rooted=classifyTaskRootedMembers('Panel.tsx',s,checkoutTask,[],c);
 assert.equal(rooted[0]?.rooted,true);
 assert.equal(rooted[0]?.reason,'task-labeled-event');
});

test('protected direct JSX imported-member call is rooted independently of component name',()=>{
 const s=`import {db} from './db';const ProductCard=()=> <button onClick={()=>db.products.getByIds([])}>Update quantity</button>`;
 const c=discoverImportedMemberCalls('ProductCard.tsx',s,'./db');
 const start=s.indexOf('onClick');const end=s.indexOf('}>',start)+1;
 assert.equal(classifyTaskRootedMembers('ProductCard.tsx',s,cartTask,[],c,[{attributeStart:start,attributeEnd:end,handler:null}])[0]?.rooted,true);
});


test('a checkout handler is not an API root just because its JSX references a task pricing function',()=>{
 const s=`import {db} from './db';
 function Cart(){ const getItemPrice=()=>3;
 const processOrder=()=>{getItemPrice();db.coupons.validateCoupon('x');};
 return <button onClick={processOrder}>Pay now</button>}`;
 const c=discoverImportedMemberCalls('Cart.tsx',s,'./db');
 const start=s.indexOf('onClick');const end=s.indexOf('}>',start)+1;
 const got=classifyTaskRootedMembers('Cart.tsx',s,cartTask,['getItemPrice'],c,[{attributeStart:start,attributeEnd:end,handler:'processOrder'}]);
 assert.equal(got.length,1);
 assert.equal(got[0]?.rooted,false);
});

test('repository pack makes explicit excluded-call accounting; avoids large unrelated methods',()=>{
 const root=mkdtempSync(join(tmpdir(),'agentos-rooted-'));
 const put=(p:string,v:string)=>{mkdirSync(dirname(join(root,p)),{recursive:true});writeFileSync(join(root,p),v);};
 const git=(...args:string[])=>execFileSync('git',args,{cwd:root,stdio:'pipe'});
 try{
  git('init','-q');git('config','user.email','test@example.com');git('config','user.name','Test');
  put('src/lib/db.ts',dbSource);put('pages/store/Cart.tsx',cartSource);put('components/StoreLayout.tsx',layoutSource);
  git('add','.');git('commit','-qm','fixture');init(root);
  put('.ai/AI_TASK.md',cartTask);
  assert.equal(pack(root).status,'ready');
  const manifest=JSON.parse(readFileSync(join(root,'.ai/packs/current-task.manifest.json'),'utf8')) as PackManifest;
  const packText=readFileSync(join(root,'.ai/packs/current-task.md'),'utf8');
  const stats=manifest.taskRootedCallCoverage!;
  assert.ok(stats.scanned>=3,JSON.stringify(stats));
  assert.ok(stats.rooted>=1,JSON.stringify(stats));
  assert.ok(stats.excluded>=2,JSON.stringify(stats));
  assert.ok(stats.excludedSamples.some(x=>x.qualifiedName==='db.coupons.validateCoupon'));
  assert.ok(stats.excludedSamples.some(x=>x.qualifiedName==='db.settings.getAll'));
  assert.ok(manifest.importedMemberCoverage?.items.some(x=>x.qualifiedName==='db.products.getByIds'&&x.mode==='full'));
  assert.ok(!manifest.importedMemberCoverage?.items.some(x=>x.qualifiedName==='db.coupons.validateCoupon'));
  assert.match(packText,/FULL db.products.getByIds/);
  assert.doesNotMatch(packText,/FULL db.coupons.validateCoupon/);
  assert.doesNotMatch(packText,/x{150}/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
