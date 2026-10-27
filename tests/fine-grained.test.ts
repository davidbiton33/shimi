import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {analyzeSource,makeSmartSnippet} from '../src/smart.js';
import {init,pack} from '../src/commands.js';
import type {PackManifest} from '../src/pack.js';

const noise=(i:number)=>`const unrelatedVariable${i} = "${'z'.repeat(175)}";`;
const component=`import React, {useState,useMemo} from 'react';
export const Cart = () => {
  const [cartItems,setCartItems] = useState([{id:'a',quantity:1,price:5}]);
  const totalPrice = useMemo(()=>cartItems.reduce((sum,item)=>sum+item.quantity*item.price,0),[cartItems]);
  function updateQuantity(id:string,quantity:number){setCartItems(items=>items.map(item=>item.id===id?{...item,quantity}:item));}
  ${Array.from({length:250},(_,i)=>noise(i)).join('\n  ')}
  const handleCheckout = () => console.log(totalPrice);
  return <section><span>Total: {totalPrice}</span><button onClick={()=>updateQuantity('a',2)}>Increase quantity</button><button onClick={handleCheckout}>Checkout</button></section>;
};
`;

test('large TSX component splits into ranked callbacks, state and render fragments instead of a 50KB single AST unit',()=>{
 assert.ok(Buffer.byteLength(component)>40_000);
 const ast=analyzeSource('pages/store/Cart.tsx',component);
 assert.equal(ast.parser,'typescript-ast');
 assert.ok(ast.segments.some(s=>s.name==='Cart.updateQuantity'&&s.role==='callback'));
 assert.ok(ast.segments.some(s=>s.name.startsWith('Cart.jsx_button_')&&s.role==='jsx-action'));
 const snippet=makeSmartSnippet('pages/store/Cart.tsx',component,'Analyze shopping cart flow, quantity updates and total price calculations',{
  budgetBytes:12000,minScore:30,alwaysFull:false,changed:false,explicitPath:false});
 assert.equal(snippet.mode,'smart');
 assert.ok(snippet.includedBytes<12000);
 assert.ok(snippet.includedBytes<Buffer.byteLength(component)*0.3);
 assert.ok(snippet.segments.some(s=>s.name==='Cart.updateQuantity'&&s.mode==='full'));
 assert.ok(snippet.segments.some(s=>s.name==='Cart.totalPrice'&&s.mode==='full'));
 assert.ok(snippet.segments.some(s=>s.name==='Cart'&&s.mode==='outline'));
 assert.match(snippet.text,/updateQuantity\(id:string,quantity:number\)/);
 assert.match(snippet.text,/item\.quantity\*item\.price/);
 assert.match(snippet.text,/Total: \{totalPrice\}/);
 assert.doesNotMatch(snippet.text,/z{170}/);
});

test('large component keeps late handlers rather than truncating AST enumeration at first 180 statements',()=>{
 const s=makeSmartSnippet('Cart.tsx',component,'Fix updateQuantity and totalPrice calculation',{
  budgetBytes:14000,minScore:30,alwaysFull:false,changed:false,explicitPath:false});
 assert.equal(s.segments.find(x=>x.name==='Cart.updateQuantity')?.mode,'full');
 assert.equal(s.segments.find(x=>x.name==='Cart.totalPrice')?.mode,'full');
 assert.ok(s.segments.some(x=>x.name==='Cart.handleCheckout'));
});

test('broad router does not fan out to unrelated admin screens when cart is the task',()=>{
 const root=mkdtempSync(join(tmpdir(),'agentos-react-ranking-'));
 const put=(p:string,v:string)=>{mkdirSync(dirname(join(root,p)),{recursive:true});writeFileSync(join(root,p),v);};
 const git=(...args:string[])=>execFileSync('git',args,{cwd:root,stdio:'pipe'});
 try{
   git('init','-q');git('config','user.name','Test');git('config','user.email','test@example.com');
   put('pages/store/Cart.tsx',component.replace('import React, {useState,useMemo} from \'react\';',`import React, {useState,useMemo} from 'react';\nimport { checkout } from '../../src/lib/payment.js';`));
   put('src/lib/payment.ts','export function checkout(){return true;}');
   put('App.tsx',`import Cart from './pages/store/Cart';\n${Array.from({length:30},(_,i)=>`import Admin${i} from './pages/admin/Admin${i}';`).join('\n')}\nexport const App=()=>Cart;`);
   for(let i=0;i<30;i++)put(`pages/admin/Admin${i}.tsx`,`export const Admin${i}=()=>"${'x'.repeat(1000)}";`);
   git('add','.');git('commit','-qm','fixture');init(root);
   put('.ai/AI_TASK.md','# Task\nAnalyze shopping cart flow: update product quantities, totalPrice and checkout; no edits.');
   assert.equal(pack(root).status,'ready');
   const m=JSON.parse(readFileSync(join(root,'.ai/packs/current-task.manifest.json'),'utf8')) as PackManifest;
   const cart=m.entries.find(x=>x.path==='pages/store/Cart.tsx');
   assert.ok(cart,'Cart.tsx is required');
   assert.ok(cart.includedBytes!<22000,'Cart.tsx should be compressed within task budget');
   assert.ok(cart.segments?.find(s=>s.name==='Cart.updateQuantity'&&s.mode==='full'));
   assert.ok(m.entries.some(x=>x.path==='src/lib/payment.ts'));
   assert.equal(m.entries.some(x=>x.path.startsWith('pages/admin/')),false,'Admin screens must not follow App router');
   assert.ok(m.estimatedTokens<18000,'all context should remain below 18K estimated tokens for synthetic fixture');
 }finally{rmSync(root,{recursive:true,force:true});}
});


test('React.memo and function declarations receive the same nested AST segmentation',()=>{
 const body=`const [cartItems,setCartItems]=useState([]);\n`+
   `function updateQuantity(){return setCartItems([])}\n`+
   Array.from({length:95},(_,i)=>`const ignored${i}="${'y'.repeat(145)}";`).join('\n')+
   `\nreturn <button onClick={updateQuantity}>Quantity</button>`;
 const memo=`import React, {useState} from 'react';\nexport const Cart = React.memo(() => {${body}});`;
 const fn=`import React, {useState} from 'react';\nexport function Cart(){${body}}`;
 for(const source of [memo,fn]){
   const a=analyzeSource('Cart.tsx',source);
   assert.ok(a.segments.some(s=>s.name==='Cart.updateQuantity'), 'nested function should be visible');
   const snippet=makeSmartSnippet('Cart.tsx',source,'Fix updateQuantity', {budgetBytes:8500,minScore:30,alwaysFull:false,changed:false,explicitPath:false});
   assert.equal(snippet.segments.find(s=>s.name==='Cart.updateQuantity')?.mode,'full');
 }
});

test('repeated onClick actions on one line have unique node identities',()=>{
 const source=`import React from 'react'; export const Cart=()=>{\n`+
 Array.from({length:95},(_,i)=>`const ignore${i}="${'v'.repeat(150)}";`).join('\n')+
 `\nfunction updateQuantity(){return 1;} function checkout(){return 2;}\n`+
 `return <div><button onClick={updateQuantity}>Quantity</button><button onClick={checkout}>Checkout</button></div>;};`;
 const a=analyzeSource('Cart.tsx',source);
 const events=a.segments.filter(s=>s.role==='jsx-action');
 assert.equal(new Set(events.map(s=>s.name)).size,events.length);
 assert.ok(events.length>=2);
});

test('excess JSX matching the task is capped without losing core cart operations',()=>{
 const repeated=Array.from({length:95},(_,i)=>`<button onClick={()=>updateQuantity('item${i}',${i})}>Change quantity</button>`).join('\n');
 const code=`import React from 'react';\nexport const Cart=()=>{\n`+
 `const cartItems=[{id:'a',quantity:1,price:6}];\nconst totalPrice=cartItems.reduce((n,item)=>n+item.price*item.quantity,0);\n`+
 `function updateQuantity(id:string,quantity:number){return {id,quantity};}\n`+
 `${Array.from({length:85},(_,i)=>`const unrelated${i}='${'f'.repeat(145)}';`).join('\n')}\n`+
 `return <section><p>Total: {totalPrice}</p>${repeated}</section>\n};`;
 const s=makeSmartSnippet('pages/store/Cart.tsx',code,'Analyze shopping cart quantity updates and total price calculations',{
  budgetBytes:16000,minScore:30,alwaysFull:false,changed:false,explicitPath:false});
 assert.equal(s.segments.find(x=>x.name==='Cart.updateQuantity')?.mode,'full');
 assert.equal(s.segments.find(x=>x.name==='Cart.totalPrice')?.mode,'full');
 assert.ok(s.segments.filter(x=>x.kind==='jsx'&&x.mode==='full').length<=18,'only 18 selected JSX fragments');
 assert.ok(s.segments.some(x=>x.reason==='jsx-focus-cap'),'additional relevant JSX must be visibly reported');
 assert.ok(s.includedBytes<16000);
});

test('manifest exposes dropped task-scored symbols independently from whole-file skips',()=>{
 const root=mkdtempSync(join(tmpdir(),'agentos-relevant-omissions-'));
 const put=(path:string,data:string)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),data);};
 const git=(...args:string[])=>execFileSync('git',args,{cwd:root,stdio:'pipe'});
 try{
  git('init','-q');git('config','user.email','test@example.com');git('config','user.name','Test');
  const long='/* '+ 'x'.repeat(400)+' */';
  const body=Array.from({length:30},(_,i)=>`function updateQuantityHandler${i}(cartItems:any){${long}return cartItems;}`).join('\n');
  put('pages/store/Cart.tsx',`export const Cart = ()=>{\n${body}\nreturn <p>{updateQuantityHandler1([]).length}</p>;\n};`);
  git('add','.');git('commit','-qm','fixture');init(root);
  put('.ai/AI_TASK.md','# Task\nAnalyze shopping cart quantity updates and totals.');
  const cfg=readFileSync(join(root,'agentos.yml'),'utf8').replace('fileBudgetBytes: 65536','fileBudgetBytes: 1700');
  put('agentos.yml',cfg);
  assert.equal(pack(root).status,'ready');
  const m=JSON.parse(readFileSync(join(root,'.ai/packs/current-task.manifest.json'),'utf8')) as PackManifest;
  assert.ok((m.omittedRelevantSegments?.count||0)>0,'report symbol-level omissions');
  assert.ok(m.omittedRelevantSegments?.samples.every(s=>s.reason&&s.path&&s.name));
  assert.equal(m.truncated,true,'do not claim complete pack if relevant body was omitted');
 } finally {rmSync(root,{recursive:true,force:true});}
});

test('end-to-end original Naya task anchors Cart and preserves removal/quantity operations despite incidental changed UI',()=>{
 const root=mkdtempSync(join(tmpdir(),'agentos-naya-task-first-'));
 const put=(path:string,data:string)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),data);};
 const git=(...args:string[])=>execFileSync('git',args,{cwd:root,stdio:'pipe'});
 try{
  git('init','-q');git('config','user.email','test@example.com');git('config','user.name','Test');
  const padding=Array.from({length:95},(_,i)=>`const unrelated${i} = "${'q'.repeat(150)}";`).join('\n');
  const cartSource=`import React from 'react';\nimport {useCart} from '../../App';\nexport const Cart=()=>{\n`+
   `const {cartItems,updateQuantity,removeFromCart}=useCart();\n`+
   `const totalPrice=cartItems.reduce((sum,item)=>sum+item.price*item.quantity,0);\n${padding}\n`+
   `return <section><p>Total: {totalPrice}</p><button onClick={()=>updateQuantity('a',2)}>Quantity</button><button onClick={()=>removeFromCart('a')}>Remove item</button></section>\n};`;
  const appSource=`import React from 'react';\nexport const CartContext=React.createContext<any>(null);\nexport const useCart=()=>React.useContext(CartContext);\nexport const App=()=>{\n`+
   `const [cartItems,setCartItems]=React.useState([{id:'a',price:4,quantity:1}]);\n`+
   `const addToCart=(product:any)=>setCartItems([...cartItems,product]);\n`+
   `const updateQuantity=(id:string,quantity:number)=>setCartItems(cartItems.map(x=>x.id===id?{...x,quantity}:x));\n`+
   `const removeFromCart=(id:string)=>setCartItems(cartItems.filter(x=>x.id!==id));\n`+
   `${padding}\nreturn <CartContext.Provider value={{cartItems,addToCart,updateQuantity,removeFromCart}}><main>{cartItems.length}</main></CartContext.Provider>\n};`;
  put('pages/store/Cart.tsx',cartSource);
  put('App.tsx',appSource);
  put('components/ProductCard.tsx','export const ProductCard=({addToCart}:any)=><button onClick={addToCart}>Add to cart</button>;');
  put('components/ProductCarousel.tsx','export const ProductCarousel=()=>null;');
  put('components/StoreLayout.tsx','export const StoreLayout=()=>null;');
  put('pages/store/NotFoundPage.tsx','export const NotFoundPage=()=>null;');
  for(let i=0;i<22;i++)put(`pages/admin/Admin${i}.tsx`,`export const Admin${i}=()=>null;`);
  put('pages/admin/AdminProducts.tsx','export const AdminProducts=()=>null;');
  git('add','.');git('commit','-qm','baseline');init(root);
  put('.ai/AI_TASK.md',`# Current Task\n\nAnalyze the shopping cart flow in the Naya jewelry store.\n\n## Goals\n- Find where products are added to the cart.\n- Identify the components managing cart state.\n- Locate quantity updates and total price calculations.\n- Trace relevant imports and dependencies.\n- Identify potential bugs or inconsistencies.\n\n## Constraints\n- Do not modify any source files.\n- Focus on relevant code only.\n- Report findings with file paths and function names.`);
  // The dirty files are intentionally unrelated to the core Cart implementation.
  put('components/ProductCarousel.tsx','export const ProductCarousel=()=>42;');
  put('components/StoreLayout.tsx','export const StoreLayout=()=>42;');
  put('pages/store/NotFoundPage.tsx','export const NotFoundPage=()=>42;');
  put('pages/admin/AdminProducts.tsx','export const AdminProducts=()=>42;');
  assert.equal(pack(root).status,'ready');
  const m=JSON.parse(readFileSync(join(root,'.ai/packs/current-task.manifest.json'),'utf8')) as PackManifest;
  assert.equal(m.entries.find(x=>x.path==='pages/store/Cart.tsx')?.graph?.relation,'anchor');
  const app=m.entries.find(x=>x.path==='App.tsx');
  assert.ok(app?.segments?.some(s=>s.name==='App.updateQuantity'&&s.mode==='full'));
  assert.ok(app?.segments?.some(s=>s.name==='App.removeFromCart'&&s.mode==='full'));
  assert.equal(m.entries.some(x=>x.path.startsWith('pages/admin/')),false);
 } finally {rmSync(root,{recursive:true,force:true});}
});
