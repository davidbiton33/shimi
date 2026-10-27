import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {makeSmartSnippet} from '../src/smart.js';
import {init, pack} from '../src/commands.js';
import type {PackManifest} from '../src/pack.js';

const TASK=`Analyze the shopping cart flow. Locate cart state, addToCart, quantity updates, total price calculations, and imports. Do not change files.`;
const pad=Array.from({length:110},(_,i)=>`const pad${i} = '${'x'.repeat(135)}';`).join('\n');
const settings={budgetBytes:7000,minScore:30,alwaysFull:false,changed:false,explicitPath:false};

test('provider wiring is retained as a focused AST JSX opening, but unrelated providers are not promoted',()=>{
 const app=`import React from 'react'; export const App=()=>{
 const [cartItems,setCartItems]=React.useState([]);
 const [user,setUser]=React.useState(null);
 const addToCart=(p)=>setCartItems(old=>[...old,p]);
 ${pad}
 return <AuthContext.Provider value={{user,setUser}}><CartContext.Provider value={{items:cartItems,addToCart}}><div>Hi</div></CartContext.Provider></AuthContext.Provider>;
 };`;
 const result=makeSmartSnippet('App.tsx',app,TASK,{...settings,semanticTargets:['addToCart']});
 assert.equal(result.mode,'smart');
 assert.ok(result.semanticDependencies?.some(x=>x.reason==='provider-wiring'&&x.name.includes('CartContext.Provider')&&x.mode==='full'));
 assert.ok(!result.semanticDependencies?.some(x=>x.name.includes('AuthContext.Provider')));
 assert.match(result.text,/CartContext\.Provider value=\{\{items:cartItems,addToCart\}\}/);
});

test('multi-hop local symbol closure retains shipping helper referenced through total and shippingCost',()=>{
 const source=`export const Cart=()=>{
 const [items,setItems]=useState([]);
 const getItemPrice=(item)=>item.price;
 const subtotal=items.reduce((sum,item)=>sum+getItemPrice(item)*item.quantity,0);
 const calcShipping=(amount)=>amount>200?0:25;
 const shippingCost=calcShipping(subtotal);
 const discountAmount=10;
 const total=subtotal+shippingCost-discountAmount;
 ${pad}
 return <main><span>{total}</span></main>;
 };`;
 const result=makeSmartSnippet('Cart.tsx',source,TASK,settings);
 assert.ok(result.semanticDependencies?.some(x=>x.name==='Cart.calcShipping'&&x.reason==='local-reference'&&x.mode==='full'));
 assert.ok(result.semanticDependencies?.some(x=>x.name==='Cart.shippingCost'&&x.mode==='full'));
 assert.match(result.text,/const calcShipping=/);
});

test('state writer UI is preserved for a variation selected by task-relevant add-to-cart event',()=>{
 const source=`export const ProductDetail=()=>{
 const [selectedVariations,setSelectedVariations]=useState('small');
 const {addToCart}=useCart();
 const product={id:'1'};
 const quantity=1;
 ${pad}
 return <main><button onClick={()=>setSelectedVariations('large')}>L</button><button onClick={()=>addToCart(product,quantity,selectedVariations)}>Add to cart</button></main>;
 };`;
 const result=makeSmartSnippet('ProductDetail.tsx',source,TASK,{...settings,callsiteTargets:['addToCart'],semanticTargets:['addToCart']});
 assert.ok(result.semanticDependencies?.some(x=>x.reason==='state-update-ui'&&x.mode==='full'));
 assert.match(result.text,/onClick=\{\(\)=>setSelectedVariations\('large'\)\}/);
 assert.match(result.text,/onClick=\{\(\)=>addToCart/);
});

test('bounded semantic evidence reports missing helpers rather than claiming completeness under tiny budget',()=>{
 const costly='const hugeCalc=(price)=>{'+Array.from({length:60},(_,i)=>` const v${i}=${i};`).join('')+'return price;};';
 const source=`export const Cart=()=>{const subtotal=3;${costly}const total=subtotal+hugeCalc(subtotal);${pad}return <p>{total}</p>};`;
 const result=makeSmartSnippet('Cart.tsx',source,TASK,{...settings,budgetBytes:700});
 assert.ok(result.semanticDependencies?.some(x=>x.name==='Cart.hugeCalc'&&x.mode!=='full'));
});

test('manifest exports semanticDependencyCoverage distinct from threeStageEvidence and preserves both provider and helper in a repository',()=>{
 const root=mkdtempSync(join(tmpdir(),'agentos-semantic-'));
 const put=(p:string,s:string)=>{mkdirSync(dirname(join(root,p)),{recursive:true});writeFileSync(join(root,p),s);};
 const git=(...args:string[])=>execFileSync('git',args,{cwd:root,stdio:'pipe'});
 try{
  git('init','-q');git('config','user.email','test@example.com');git('config','user.name','Test');
  put('Cart.tsx',`import {CartContext} from './App';export const Cart=()=>{const {items,updateQuantity}=useContext(CartContext);const subtotal=items.length*40;const calcShipping=(s)=>s>100?0:20;const shippingCost=calcShipping(subtotal);const total=subtotal+shippingCost;${pad}return <button onClick={()=>updateQuantity('a',2)}>{total}</button>};`);
  put('App.tsx',`import React from 'react';import {Cart} from './Cart';export const CartContext=React.createContext(null);export const App=()=>{const [items,setItems]=React.useState([]);function updateQuantity(id,q){setItems(xs=>xs.map(x=>x.id===id?{...x,quantity:q}:x))};${pad}return <CartContext.Provider value={{items,updateQuantity}}><Cart/></CartContext.Provider>};`);
  git('add','.');git('commit','-qm','test');init(root);
  put('.ai/AI_TASK.md',TASK);
  assert.equal(pack(root).status,'ready');
  const manifest=JSON.parse(readFileSync(join(root,'.ai/packs/current-task.manifest.json'),'utf8')) as PackManifest;
  const sem=manifest.semanticDependencyCoverage!;
  assert.ok(sem.discovered>0);
  assert.ok(sem.items.some(x=>x.path==='App.tsx'&&x.reason==='provider-wiring'&&x.mode==='full'));
  assert.ok(sem.items.some(x=>x.path==='Cart.tsx'&&x.name==='Cart.calcShipping'&&x.mode==='full'));
  const md=readFileSync(join(root,'.ai/packs/current-task.md'),'utf8');
  assert.match(md,/CartContext\.Provider value=/);
  assert.match(md,/const calcShipping=/);
  assert.equal(sem.discovered,sem.preserved+sem.outlined+sem.omitted);
  assert.ok(sem.limitedTo.includes('not complete'));
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('state-writer closure also works when selected state is consumed inside a named callback',()=>{
 const source=`export const ProductDetail=()=>{
 const [selectedVariations,setSelectedVariations]=useState('small');
 const {addToCart}=useCart();const product={id:'1'};
 const handleAddToCart=()=>addToCart(product,1,selectedVariations);
 ${pad}
 return <main><button onClick={()=>setSelectedVariations('large')}>Size</button><button onClick={handleAddToCart}>Buy</button></main>;
 };`;
 const result=makeSmartSnippet('ProductDetail.tsx',source,TASK,{...settings,callsiteTargets:['addToCart'],semanticTargets:['addToCart']});
 assert.ok(result.semanticDependencies?.some(x=>x.reason==='state-update-ui'&&x.mode==='full'));
 assert.match(result.text,/onClick=\{\(\)=>setSelectedVariations/);
});

test('imports are complete declarations, sorted by task relevance, and never cut in the middle',()=>{
 const imports=Array.from({length:65},(_,i)=>`import Admin${i} from './pages/admin/Admin${i}';`).join('\n');
 const source=`import Cart from './pages/store/Cart';\n${imports}\nexport const App=()=>{\n const addToCart=()=>{};\n ${pad}\n return <main><button onClick={addToCart}>Cart</button></main>;\n};`;
 const result=makeSmartSnippet('App.tsx',source,TASK,{...settings,callsiteTargets:['addToCart']});
 const header=result.text.split('\n// App.tsx:')[0]!;
 assert.match(header,/import Cart from '.\/pages\/store\/Cart';/);
 assert.match(header,/Selected complete imports from original file \([1-9]/);
 for(const imp of header.split('\n').filter(x=>x.trim().startsWith('import ')))assert.ok(imp.endsWith(';'),`complete import expected: ${imp}`);
 assert.ok(header.length<2000);
});

test('state-writer JSX with an intermediate local callback protects both event and callback',()=>{
 const source=`export const ProductDetail=()=>{
 const [selectedVariations,setSelectedVariations]=useState('small');
 const {addToCart}=useCart();const product={id:'1'};
 const handleAddToCart=()=>addToCart(product,1,selectedVariations);
 const changeSize=()=>setSelectedVariations('large');
 ${pad}
 return <main><button onClick={changeSize}>L</button><button onClick={handleAddToCart}>Buy</button></main>;
 };`;
 const result=makeSmartSnippet('ProductDetail.tsx',source,TASK,{...settings,callsiteTargets:['addToCart'],semanticTargets:['addToCart']});
 assert.ok(result.semanticDependencies?.some(x=>x.reason==='state-update-ui'&&x.mode==='full'));
 assert.ok(result.semanticDependencies?.some(x=>x.reason==='state-update-handler'&&x.mode==='full'));
 assert.match(result.text,/onClick=\{changeSize\}/);
 assert.match(result.text,/const changeSize=/);
});
