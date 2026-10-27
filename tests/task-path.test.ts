import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {discoverJsxTaskCallsites,makeSmartSnippet} from '../src/smart.js';
import {init,pack} from '../src/commands.js';
import type {PackManifest} from '../src/pack.js';

const TASK=`# Current Task
Analyze the shopping cart flow in the Naya jewelry store.

## Goals
- Find where products are added to the cart.
- Identify the components managing cart state.
- Locate quantity updates and total price calculations.
- Trace relevant imports and dependencies.
- Identify potential bugs or inconsistencies.

## Constraints
- Do not modify any source files.
- Focus on relevant code only.
- Report findings with file paths and function names.`;

function bigDetail(){
 const filler=Array.from({length:155},(_,i)=>`const unrelated${i} = '${'x'.repeat(148)}';`).join('\n');
 const jsxNoise=Array.from({length:36},(_,i)=>`<span key={${i}}>price {displayPrice + ${i}}</span>`).join('');
 return `import React, {useState} from 'react';
import {useCart} from '../../App';
export const ProductDetail=()=>{
 const {addToCart}=useCart();
 const [variation,setVariation]=useState('silver');
 const product={id:'ring',stock:8,price:49};
 const displayPrice=product.price;
 const handleAddToCart=()=>addToCart(product,1,[variation]);
 ${filler}
 return <main><button onClick={handleAddToCart}>Add this variation to cart</button><button onClick={()=>addToCart(product,2,[variation])}>Add two items</button>${jsxNoise}</main>
};`;
}
test('JSX callsite discovery resolves direct handlers and one local indirection without counting comments',()=>{
 const code=`const Component=()=>{
 const handleAdd=()=>addToCart(product);
 // onClick={() => addToCart(product)} is a comment
 const unused='onClick={() => addToCart(product)}';
 return <main><button onClick={handleAdd}>Add</button><button onClick={()=>addToCart(product)}>Add</button><button onClick={()=>unrelated()}>Other</button></main>;
 };`;
 const found=discoverJsxTaskCallsites('Component.tsx',code,new Set(['addToCart']));
 assert.equal(found.length,2);
 assert.ok(found.some(x=>x.handler==='handleAdd'));
 assert.ok(found.some(x=>x.handler===null));
 assert.deepEqual(discoverJsxTaskCallsites('Component.tsx','// <button onClick={()=>addToCart(x)}>fake</button>',new Set(['addToCart'])),[]);
});

test('critical ProductDetail caller and handler are preserved before unrelated JSX under tight budget',()=>{
 const source=bigDetail();
 assert.ok(Buffer.byteLength(source)>25_000);
 const result=makeSmartSnippet('pages/store/ProductDetail.tsx',source,TASK,{budgetBytes:6500,minScore:30,alwaysFull:false,changed:false,explicitPath:false,callsiteTargets:['addToCart']});
 assert.equal(result.mode,'smart');
 assert.ok(result.segments.some(s=>s.name==='ProductDetail.handleAddToCart'&&s.mode==='full'&&s.critical),'local callback body is critical');
 assert.ok(result.segments.some(s=>s.kind==='jsx'&&s.critical&&s.mode==='full'),'actual JSX caller survives');
 assert.match(result.text,/const handleAddToCart=\(\)=>addToCart/);
 assert.match(result.text,/onClick=\{handleAddToCart\}/);
 assert.match(result.text,/onClick=\{\(\)=>addToCart/);
 assert.ok(result.includedBytes<6500);
});

test('task-path pack promotes ProductDetail caller ahead of unrelated Admin while retaining cart state and calculations',()=>{
 const root=mkdtempSync(join(tmpdir(),'agentos-task-path-'));
 const put=(p:string,s:string)=>{mkdirSync(dirname(join(root,p)),{recursive:true});writeFileSync(join(root,p),s);};
 const git=(...args:string[])=>execFileSync('git',args,{cwd:root,stdio:'pipe'});
 try{
  git('init','-q');git('config','user.email','test@example.com');git('config','user.name','Test');
  put('pages/store/Cart.tsx',`import {useCart} from '../../App';
export const Cart=()=>{
const {cartItems,updateQuantity,removeFromCart}=useCart();
const total=cartItems.reduce((n:any,item:any)=>n+item.price*item.quantity,0);
function getItemPrice(item:any){return item.price;}
return <section><span>{total}</span><button onClick={()=>updateQuantity('ring',2)}>+</button><button onClick={()=>removeFromCart('ring')}>-</button></section>;
};`);
  put('pages/store/ProductDetail.tsx',bigDetail());
  put('components/ProductCard.tsx',`import {useCart} from '../App';
export function ProductCard(){ const {addToCart}=useCart(); return <button onClick={()=>addToCart({id:'ring',price:49})}>Add product to cart</button>; }`);
  put('App.tsx',`import React from 'react';
import Cart from './pages/store/Cart';
${Array.from({length:30},(_,i)=>`import Admin${i} from './pages/admin/Admin${i}';`).join('\n')}
export const CartContext=React.createContext<any>(null);
export function useCart(){return React.useContext(CartContext)}
export const App=()=>{
 const [cartItems,setCartItems]=React.useState<any[]>([]);
 function addToCart(product:any,quantity=1,variations:any[]=[]){setCartItems(p=>[...p,{...product,quantity,variations}]);}
 function updateQuantity(id:string,quantity:number){setCartItems(p=>p.map(x=>x.id===id?{...x,quantity}:x));}
 function removeFromCart(id:string){setCartItems(p=>p.filter(x=>x.id!==id));}
 ${Array.from({length:72},(_,i)=>`const appUnrelated${i} = '${'g'.repeat(140)}';`).join('\n')}
 return <CartContext.Provider value={{cartItems,addToCart,updateQuantity,removeFromCart}}><Cart/></CartContext.Provider>;
};`);
  for(let i=0;i<30;i++)put(`pages/admin/Admin${i}.tsx`,`export const Admin${i}=()=>${JSON.stringify('irrelevant analytics '+ 'k'.repeat(1300))};`);
  put('components/ReviewsSection.tsx',`export const ReviewsSection=()=>${JSON.stringify('unrelated '+ 'j'.repeat(8000))};`);
  git('add','.');git('commit','-qm','baseline');init(root);
  put('.ai/AI_TASK.md',TASK);
  assert.equal(pack(root).status,'ready');
  const m=JSON.parse(readFileSync(join(root,'.ai/packs/current-task.manifest.json'),'utf8')) as PackManifest;
  const path=m.entries.find(x=>x.path==='pages/store/ProductDetail.tsx');
  assert.ok(path,'ProductDetail must be included even when unrelated to direct import graph');
  assert.ok(path?.segments?.some(s=>s.name==='ProductDetail.handleAddToCart'&&s.critical&&s.mode==='full'));
  assert.equal(m.entries.find(x=>x.path==='pages/store/Cart.tsx')?.graph?.relation,'anchor');
  assert.ok(m.entries.some(x=>x.path==='App.tsx'&&x.segments?.some(s=>s.name==='App.updateQuantity'&&s.mode==='full')));
  assert.ok(m.entries.some(x=>x.path==='App.tsx'&&x.segments?.some(s=>s.name==='App.removeFromCart'&&s.mode==='full')));
  const md=readFileSync(join(root,'.ai/packs/current-task.md'),'utf8');
  assert.match(md,/onClick=\{handleAddToCart\}/);
  assert.match(md,/function updateQuantity\(/);
  assert.ok(m.taskPathCoverage,'task-path coverage must be explained');
  assert.ok(m.taskPathCoverage!.actionTargets.includes('addToCart'));
  assert.ok(m.taskPathCoverage!.callsites.some(c=>c.path==='pages/store/ProductDetail.tsx'&&c.target==='addToCart'&&c.included));
  assert.equal(m.taskPathCoverage!.omitted,0,'all real task callers must be preserved for synthetic fixture');
  assert.equal(m.taskPathCoverage!.threeStageEvidence,m.taskPathCoverage!.callsiteCount,
    'all synthetic action definitions must be present, not merely the JSX callsites');
  assert.equal(m.taskPathCoverage!.unverifiedDefinitions,0);
  assert.ok(m.taskPathCoverage!.callsites.every(c=>c.eventPreserved&&c.handlerPreserved&&
    c.actionDefinitionPreserved===true&&c.definitionStatus==='preserved'&&c.threeStageEvidence));
  assert.ok(m.taskPathCoverage!.distinctEventCount<=m.taskPathCoverage!.callsiteCount);

  assert.equal(m.entries.some(e=>e.path.startsWith('pages/admin/')),false,'do not spend context on Admin routes');
  assert.equal(m.entries.some(e=>e.path==='components/ReviewsSection.tsx'),false);
  assert.ok(m.estimatedTokens<40000);
 } finally {rmSync(root,{recursive:true,force:true});}
});

test('task caller detection covers React.useCallback indirection and preserves callback implementation',()=>{
 const src=`import React, {useCallback} from 'react';
export const ProductDetail=()=>{
const handleAdd=React.useCallback(()=>addToCart(product,1),[]);
${Array.from({length:85},(_,i)=>`const filler${i} = '${'t'.repeat(140)}';`).join('\n')}
return <button onClick={handleAdd}>Add</button>;
};`;
 const hits=discoverJsxTaskCallsites('ProductDetail.tsx',src,new Set(['addToCart']));
 assert.equal(hits.length,1);
 assert.equal(hits[0]?.handler,'handleAdd');
 const pack=makeSmartSnippet('ProductDetail.tsx',src,TASK,{budgetBytes:6000,minScore:30,alwaysFull:false,changed:false,explicitPath:false,callsiteTargets:['addToCart']});
 assert.ok(pack.segments.some(x=>x.name==='ProductDetail.handleAdd'&&x.mode==='full'&&x.critical));
});

test('adaptive budget promotes protected JSX handler implementation using unused global budget',()=>{
 const root=mkdtempSync(join(tmpdir(),'agentos-task-adaptive-'));
 const put=(p:string,s:string)=>{mkdirSync(dirname(join(root,p)),{recursive:true});writeFileSync(join(root,p),s);};
 const git=(...args:string[])=>execFileSync('git',args,{cwd:root,stdio:'pipe'});
 try{
  git('init','-q');git('config','user.email','test@example.com');git('config','user.name','Test');
  put('pages/store/Cart.tsx',`import {useCart} from '../../App'; export const Cart=()=>{const {cartItems}=useCart();const total=cartItems.length;return <p>{total}</p>};`);
  const longBody=Array.from({length:100},(_,i)=>`const extra${i}='${'Z'.repeat(195)}';`).join('\n');
  put('pages/store/ProductDetail.tsx',`import {useCart} from '../../App';
export const ProductDetail=()=>{
const {addToCart}=useCart();
const handleAddToCart=()=>{${longBody}\nreturn addToCart({id:'ring',price:10});};
return <button onClick={handleAddToCart}>Add variation to cart</button>;
};`);
  put('App.tsx',`import Cart from './pages/store/Cart';
export const App=()=>{function addToCart(p:any){return p;} ${Array.from({length:85},(_,i)=>`const ignore${i}='${'s'.repeat(145)}';`).join('\n')} return <Cart/>;};`);
  git('add','.');git('commit','-qm','fixture');init(root);
  put('.ai/AI_TASK.md',TASK);
  const status=pack(root);assert.equal(status.status,'ready');
  const m=JSON.parse(readFileSync(join(root,'.ai/packs/current-task.manifest.json'),'utf8')) as PackManifest;
  const detail=m.entries.find(x=>x.path==='pages/store/ProductDetail.tsx');
  assert.ok(detail,'dynamic caller selected');
  assert.ok(detail.includedBytes!>18000,'file budget should expand when critical callback exceeds ordinary 18KB task-path slice');
  assert.ok(detail.segments?.some(x=>x.name==='ProductDetail.handleAddToCart'&&x.mode==='full'&&x.critical));
  assert.equal(m.taskPathCoverage?.callsites.find(c=>c.path==='pages/store/ProductDetail.tsx')?.included,true);
  assert.ok(m.estimatedTokens<m.limits.maxEstimatedTokens);
 } finally {rmSync(root,{recursive:true,force:true});}
});

test('inferred local handler as action target must still retain its implementation',()=>{
 const src=`export const Detail=()=>{function handleAddToCart(){return addToCart(123);}return <button onClick={handleAddToCart}>Add</button>;}`;
 const hits=discoverJsxTaskCallsites('Detail.tsx',src,new Set(['handleAddToCart']));
 assert.equal(hits[0]?.handler,'handleAddToCart');
});

test('same-line JSX events are distinguished by column; unrelated button is not a protected task callsite',()=>{
 const code=`export const ProductDetail=()=>{\n${Array.from({length:90},(_,i)=>`const extra${i}='${'u'.repeat(145)}';`).join('\n')}\nreturn <main><button onClick={()=>addToCart({id:'a'})}>Add</button><button onClick={()=>deleteProduct('a')}>Delete</button></main>;};`;
 const calls=discoverJsxTaskCallsites('ProductDetail.tsx',code,new Set(['addToCart']));
 assert.equal(calls.length,1);
 const snippet=makeSmartSnippet('ProductDetail.tsx',code,TASK,{budgetBytes:4800,minScore:30,alwaysFull:false,changed:false,explicitPath:false,callsiteTargets:['addToCart']});
 const criticalJsx=snippet.segments.filter(s=>s.kind==='jsx'&&s.critical);
 assert.equal(criticalJsx.length,1);
 assert.match(criticalJsx[0]!.name,/jsx_button_onClick/);
 assert.equal(criticalJsx[0]!.mode,'full');
});


test('v0.8.6 discovers and preserves UI action JSX created inside useMemo, outside component return',()=>{
 const src=`import React,{useMemo} from 'react';
export const ProductCard=()=>{
const product={id:'ring'};
const handleAddToCart=()=>addToCart(product);
const action=useMemo(()=> <button onClick={handleAddToCart}>Add now</button>,[]);
${Array.from({length:102},(_,i)=>`const unrelated${i}='${'z'.repeat(140)}';`).join('\n')}
return <section>{action}</section>;
};`;
 const hits=discoverJsxTaskCallsites('ProductCard.tsx',src,new Set(['addToCart']));
 assert.equal(hits.length,1);
 assert.equal(hits[0]!.handler,'handleAddToCart');
 const snippet=makeSmartSnippet('ProductCard.tsx',src,TASK,{budgetBytes:6500,minScore:30,alwaysFull:false,changed:false,explicitPath:false,callsiteTargets:['addToCart']});
 const event=snippet.segments.find(x=>x.kind==='jsx'&&x.critical&&x.mode==='full'&&x.startOffset<=hits[0]!.attributeStart&&x.endOffset>=hits[0]!.attributeEnd);
 assert.ok(event,'JSX event inside useMemo must be preserved via AST attribute span');
 assert.ok(snippet.segments.some(x=>x.name==='ProductCard.handleAddToCart'&&x.mode==='full'&&x.critical));
 assert.match(snippet.text,/onClick=\{handleAddToCart\}/);
});

test('v0.8.6 preserves nested parent + child click events independently, including same-line JSX',()=>{
 const code=`export const ProductCard=()=>{
const product={id:'ring'};
${Array.from({length:105},(_,i)=>`const extra${i}='${'n'.repeat(140)}';`).join('\n')}
return <div onClick={()=>addToCart(product)}><button onClick={()=>addToCart(product)}>Add</button></div>;
};`;
 const hits=discoverJsxTaskCallsites('ProductCard.tsx',code,new Set(['addToCart']));
 assert.equal(hits.length,2,'parent and child are two different UI interactions');
 assert.notEqual(hits[0]!.attributeStart,hits[1]!.attributeStart);
 const snippet=makeSmartSnippet('ProductCard.tsx',code,TASK,{budgetBytes:6500,minScore:30,alwaysFull:false,changed:false,explicitPath:false,callsiteTargets:['addToCart']});
 assert.equal(hits.filter(c=>snippet.segments.some(seg=>seg.kind==='jsx'&&seg.mode==='full'&&seg.startOffset<=c.attributeStart&&seg.endOffset>=c.attributeEnd)).length,2);
 assert.ok(snippet.segments.filter(x=>x.kind==='jsx'&&x.critical&&x.mode==='full').length>=2);
});

test('v0.8.6 reports individual event and handler evidence instead of a misleading generic reason',()=>{
 const root=mkdtempSync(join(tmpdir(),'agentos-task-verify-'));
 const put=(p:string,s:string)=>{mkdirSync(dirname(join(root,p)),{recursive:true});writeFileSync(join(root,p),s);};
 const git=(...args:string[])=>execFileSync('git',args,{cwd:root,stdio:'pipe'});
 try{
   git('init','-q');git('config','user.email','test@example.com');git('config','user.name','Test');
   put('pages/store/Cart.tsx',`export const Cart=()=>{function addToCart(p:any){return p;}return <button onClick={()=>addToCart('ring')}>Add</button>};`);
   put('components/ProductCard.tsx',`import React,{useMemo} from 'react';
   export const ProductCard=()=>{
     const handleAddToCart=()=>addToCart('ring');
     const memo=useMemo(()=><button onClick={handleAddToCart}>Add</button>,[]);
     ${Array.from({length:80},(_,i)=>`const other${i}='${'a'.repeat(180)}';`).join('\n')}
     return <section>{memo}</section>;
   };`);
   git('add','.');git('commit','-qm','seed');init(root);put('.ai/AI_TASK.md',TASK);
   assert.equal(pack(root).status,'ready');
   const m=JSON.parse(readFileSync(join(root,'.ai/packs/current-task.manifest.json'),'utf8')) as PackManifest;
   const candidate=m.taskPathCoverage!.callsites.find(c=>c.path==='components/ProductCard.tsx'&&c.target==='addToCart');
   assert.ok(candidate,'callsite should be discovered even inside useMemo');
   assert.equal(candidate.eventPreserved,true);
   assert.equal(candidate.handlerPreserved,true);
   assert.equal(candidate.included,true);
   assert.equal(candidate.reason,undefined);
   assert.equal(candidate.actionDefinitionPreserved,true);
   assert.equal(candidate.threeStageEvidence,true);
 } finally {rmSync(root,{recursive:true,force:true});}
});

test('v0.8.6 separately attributes skipped event JSX while an inline handler needs no separate declaration',()=>{
 const root=mkdtempSync(join(tmpdir(),'agentos-many-events-'));
 const put=(p:string,s:string)=>{mkdirSync(dirname(join(root,p)),{recursive:true});writeFileSync(join(root,p),s);};
 const git=(...args:string[])=>execFileSync('git',args,{cwd:root,stdio:'pipe'});
 try{
   git('init','-q');git('config','user.email','test@example.com');git('config','user.name','Test');
   put('pages/store/Cart.tsx',`export const Cart=()=>{function addToCart(p:any){return p}return <button onClick={()=>addToCart('x')}>cart</button>}`);
   const buttons=Array.from({length:32},(_,i)=>`<button onClick={()=>addToCart('${i}')}>Add${i}</button>`).join('\n');
   const filler=Array.from({length:105},(_,i)=>`const irrelevant${i}='${'z'.repeat(135)}';`).join('\n');
   put('components/ProductCard.tsx',`export const ProductCard=()=>{\n${filler}\nreturn <section>${buttons}</section>;}`);
   git('add','.');git('commit','-qm','baseline');init(root);put('.ai/AI_TASK.md',TASK);
   assert.equal(pack(root).status,'ready');
   const m=JSON.parse(readFileSync(join(root,'.ai/packs/current-task.manifest.json'),'utf8')) as PackManifest;
   const productCalls=m.taskPathCoverage!.callsites.filter(x=>x.path==='components/ProductCard.tsx');
   assert.ok(productCalls.length>=24,'fixture must exercise the JSX cap');
   assert.ok(productCalls.some(c=>c.included),'some protected events should survive');
   assert.ok(productCalls.some(c=>!c.included&&!c.eventPreserved&&c.handlerPreserved&&c.reason==='task-path-event-not-preserved'),
     'an omitted event must not be mislabeled as an omitted handler');
   assert.equal(m.taskPathCoverage!.callsiteCount,m.taskPathCoverage!.included+m.taskPathCoverage!.omitted);
 } finally {rmSync(root,{recursive:true,force:true});}
});

test('v0.8.6 distinguishes preserved JSX event from oversized omitted named callback',()=>{
 const root=mkdtempSync(join(tmpdir(),'agentos-oversize-handler-'));
 const put=(p:string,s:string)=>{mkdirSync(dirname(join(root,p)),{recursive:true});writeFileSync(join(root,p),s);};
 const git=(...args:string[])=>execFileSync('git',args,{cwd:root,stdio:'pipe'});
 try{
   git('init','-q');git('config','user.email','test@example.com');git('config','user.name','Test');
   put('pages/store/Cart.tsx',`export const Cart=()=>{function addToCart(p:any){return p}return <button onClick={()=>addToCart('x')}>cart</button>}`);
   const giant=Array.from({length:460},(_,i)=>`const ignored${i}='${'g'.repeat(182)}';`).join('\n');
   put('components/ProductCard.tsx',`export const ProductCard=()=>{\nconst handleAddToCart=()=>{\n${giant}\nreturn addToCart('ring');};\nreturn <button onClick={handleAddToCart}>Add</button>;}`);
   git('add','.');git('commit','-qm','baseline');init(root);put('.ai/AI_TASK.md',TASK);
   assert.equal(pack(root).status,'ready');
   const m=JSON.parse(readFileSync(join(root,'.ai/packs/current-task.manifest.json'),'utf8')) as PackManifest;
   const call=m.taskPathCoverage!.callsites.find(c=>c.path==='components/ProductCard.tsx');
   assert.ok(call);
   assert.equal(call.eventPreserved,true);
   assert.equal(call.handlerPreserved,false);
   assert.equal(call.reason,'task-path-handler-not-preserved');
   assert.equal(call.included,false);
 } finally {rmSync(root,{recursive:true,force:true});}
});
