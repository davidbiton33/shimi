import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {makeSmartSnippet} from '../src/smart.js';
import {init,pack} from '../src/commands.js';
import type {PackManifest} from '../src/pack.js';

const task='Analyze the shopping cart flow in the Naya jewelry store. Find where products are added to the cart, identify components managing cart state, locate quantity updates and total price calculations, trace relevant imports and dependencies, and identify potential bugs. Do not modify source files.';
const pad=Array.from({length:80},(_,i)=>`const filler${i} = '${'p'.repeat(120)}';`).join('\n');
const options={budgetBytes:16000,minScore:30,alwaysFull:false,changed:false,explicitPath:false};

test('unverified indirect/reverse neighbor cannot recursively promote generic state',()=>{
 const source=`export function AdminProducts(){
  const [sortField,setSortField]=useState('price');
  const [productFilter,setProductFilter]=useState('all');
  const [selectedProducts,setSelectedProducts]=useState([]);
  function filterProducts(){return selectedProducts.filter(p=>p.name.includes(productFilter)).sort((a,b)=>a[sortField]-b[sortField]);}
  ${pad}
  return <main><button onClick={()=>setSortField('id')}>Sort products</button>{filterProducts().map(p=><p key={p.id}>{p.name}</p>)}</main>
 }`;
 const loose=makeSmartSnippet('AdminProducts.tsx',source,task,{...options,semanticGrounding:'task-anchor'});
 const gated=makeSmartSnippet('AdminProducts.tsx',source,task,{...options,semanticGrounding:'unverified'});
 assert.ok(loose.semanticDependencies?.length, 'fixture must exercise formerly broad closure');
 assert.equal(gated.semanticDependencies?.length??0,0);
 assert.ok(gated.includedBytes<loose.includedBytes,`gating should save bytes: ${gated.includedBytes} vs ${loose.includedBytes}`);
});

test('direct dependency requires task-bearing declarations, not generic product matching',()=>{
 const source=`export const ProductService=()=>{
 const [categories,setCategories]=useState([]);
 const [sortField,setSortField]=useState('price');
 const sortProducts=()=>categories.sort((a,b)=>a[sortField]-b[sortField]);
 ${pad}
 return <button onClick={()=>setSortField('name')}>{sortProducts().length} products</button>;
 };`;
 const result=makeSmartSnippet('ProductService.tsx',source,task,{...options,semanticGrounding:'direct-dependency'});
 assert.equal(result.semanticDependencies?.length??0,0);
});

test('grounded total follows an AST reference chain and exposes seed-to-helper provenance',()=>{
 const source=`export function Cart(){
 const subtotal=300;
 const calcShipping=(s)=>s>=250?0:30;
 const shippingCost=calcShipping(subtotal);
 const total=subtotal+shippingCost;
 ${pad}
 return <main>{total}</main>;
 }`;
 const result=makeSmartSnippet('Cart.tsx',source,task,{...options,semanticGrounding:'task-anchor'});
 const ship=result.semanticDependencies?.find(x=>x.name==='Cart.calcShipping');
 assert.equal(ship?.mode,'full');
 assert.equal(ship?.grounding,'task-anchor');
 assert.equal(ship?.trace.at(-1),'Cart.calcShipping');
 assert.ok(ship!.trace.length>=2,`expected AST chain, got ${ship?.trace}`);
 assert.equal(ship?.seed,ship?.trace[0]);
});

test('action-linked variation writer records auditable path to state and JSX',()=>{
 const source=`export function ProductDetail(){
 const [selectedVariations,setSelectedVariations]=useState('small');
 const addToCart=useCart().addToCart;
 const item={id:'1'};
 ${pad}
 return <main><button onClick={()=>setSelectedVariations('large')}>L</button><button onClick={()=>addToCart(item,1,selectedVariations)}>Add to cart</button></main>;
 }`;
 const result=makeSmartSnippet('ProductDetail.tsx',source,task,{...options,semanticGrounding:'task-path',semanticTargets:['addToCart'],callsiteTargets:['addToCart']});
 const writer=result.semanticDependencies?.find(x=>x.reason==='state-update-ui');
 assert.equal(writer?.mode,'full');
 assert.equal(writer?.grounding,'task-path');
 assert.ok(writer?.trace.some(x=>x.includes('selectedVariations')),JSON.stringify(writer));
 assert.ok(writer?.trace[0]?.includes('jsx_button'),JSON.stringify(writer));
});

test('manifest skips semantic fan-out on incidental dependency/dependent while retaining cart math and Provider',()=>{
 const root=mkdtempSync(join(tmpdir(),'agentos-grounding-'));
 const put=(p:string,v:string)=>{mkdirSync(dirname(join(root,p)),{recursive:true});writeFileSync(join(root,p),v);};
 const git=(...args:string[])=>execFileSync('git',args,{cwd:root,stdio:'pipe'});
 try{
  git('init','-q');git('config','user.email','test@example.com');git('config','user.name','Test');
  put('components/ProductCard.tsx',`import {useCart} from '../App';export function ProductCard(){const {addToCart}=useCart();${pad}return <button onClick={()=>addToCart({id:1},1)}>Add to cart</button>}`);
  put('pages/store/Cart.tsx',`import {useCart} from '../../App';export function Cart(){const {cartItems,updateQuantity}=useCart();const subtotal=cartItems.length*40;const calcShipping=(s)=>s>100?0:20;const shippingCost=calcShipping(subtotal);const total=subtotal+shippingCost;${pad}return <button onClick={()=>updateQuantity('a',2)}>{total}</button>}`);
  put('pages/store/ProductDetail.tsx',`import {useCart} from '../../App';export function ProductDetail(){const [selectedVariations,setSelectedVariations]=useState('small');const {addToCart}=useCart();${pad}return <main><button onClick={()=>setSelectedVariations('large')}>L</button><button onClick={()=>addToCart({id:1},1,selectedVariations)}>Add</button></main>}`);
  put('pages/store/Catalog.tsx',`import {ProductCard} from '../../components/ProductCard';export function Catalog(){const [selectedCategories,setSelectedCategories]=useState([]);const [sortOption,setSortOption]=useState('price');const [searchQuery,setSearchQuery]=useState('');const products=selectedCategories.filter(x=>x.includes(searchQuery));${pad}return <main><ProductCard/>{products.map(p=><p>{p}</p>)}<button onClick={()=>setSortOption('asc')}>Sort</button></main>}`);
  put('pages/admin/AdminProducts.tsx',`export function AdminProducts(){const [selectedProducts,setSelectedProducts]=useState([]);const [sortField,setSortField]=useState('price');const [searchQuery,setSearchQuery]=useState('');const products=selectedProducts.filter(x=>x.includes(searchQuery));${pad}return <main><button onClick={()=>setSortField('name')}>Sort products</button>{products.map(p=><p>{p}</p>)}</main>}`);
  put('App.tsx',`import React from 'react';import {Cart} from './pages/store/Cart';import {ProductDetail} from './pages/store/ProductDetail';import {AdminProducts} from './pages/admin/AdminProducts';export const CartContext=React.createContext<any>(null);export const useCart=()=>React.useContext(CartContext);export function App(){const [cartItems,setCartItems]=React.useState([]);const addToCart=(p,q)=>setCartItems(xs=>[...xs,p]);const updateQuantity=(id,q)=>setCartItems(xs=>xs);${pad}return <CartContext.Provider value={{cartItems,addToCart,updateQuantity}}><Cart/><ProductDetail/></CartContext.Provider>}`);
  git('add','.');git('commit','-qm','stable');init(root);put('.ai/AI_TASK.md',task);
  assert.equal(pack(root).status,'ready');
  const manifest=JSON.parse(readFileSync(join(root,'.ai/packs/current-task.manifest.json'),'utf8')) as PackManifest;
  const items=manifest.semanticDependencyCoverage?.items||[];
  assert.ok(items.some(i=>i.name.includes('calcShipping')&&i.mode==='full'), 'cart math dependency retained');
  assert.ok(items.some(i=>i.reason==='provider-wiring'&&i.mode==='full'), 'Provider retained');
  assert.ok(items.some(i=>i.reason==='state-update-ui'&&i.mode==='full'&&i.path.includes('ProductDetail')), 'variation state writer retained');
  assert.equal(items.filter(i=>i.path.includes('AdminProducts')||i.path.includes('Catalog')).length,0,'incidental files cannot create semantic closure');
  assert.ok(items.every(i=>i.trace.length&&i.seed===i.trace[0]),'all semantic evidence carries root and trace');
  assert.equal(manifest.taskPathCoverage?.omitted,0,'task actions are still fully retained');
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('a task action name in a distant file string does not bypass two-hop budget cap',()=>{
 const root=mkdtempSync(join(tmpdir(),'agentos-string-bypass-'));
 const put=(p:string,v:string)=>{mkdirSync(dirname(join(root,p)),{recursive:true});writeFileSync(join(root,p),v);};
 const git=(...args:string[])=>execFileSync('git',args,{cwd:root,stdio:'pipe'});
 try{
  git('init','-q');git('config','user.email','test@example.com');git('config','user.name','Test');
  put('components/ProductCard.tsx',`import {Routes} from './Routes';export function ProductCard(){const addToCart=()=>{};${pad}return <main><button onClick={addToCart}>Add to cart</button><Routes/></main>}`);
  put('components/Routes.tsx',`import {AdminProducts} from '../pages/admin/AdminProducts';export const Routes=()=>AdminProducts;`);
  put('pages/admin/AdminProducts.tsx',`export const AdminProducts=()=>{const actionLabel='addToCart';const [products,setProducts]=useState([]);const [productFilter,setProductFilter]=useState('');const visibleProducts=products.filter(p=>p.name.includes(productFilter));${pad}return <div>{visibleProducts.length}<button onClick={()=>setProductFilter('x')}>Filter products</button></div>};`);
  git('add','.');git('commit','-qm','stable');init(root);put('.ai/AI_TASK.md',task);
  assert.equal(pack(root).status,'ready');
  const m=JSON.parse(readFileSync(join(root,'.ai/packs/current-task.manifest.json'),'utf8')) as PackManifest;
  const admin=m.entries.find(e=>e.path==='pages/admin/AdminProducts.tsx');
  assert.ok(admin,'distant file must actually reach the pack for this regression');
  assert.equal(admin.graph?.distance,2);
  assert.ok((admin.includedBytes??Infinity)<=2300,`action-name string must not unlock a large context budget: ${admin.includedBytes}`);
  assert.equal(m.semanticDependencyCoverage?.items.filter(i=>i.path===admin.path).length,0);
 }finally{rmSync(root,{recursive:true,force:true});}
});
