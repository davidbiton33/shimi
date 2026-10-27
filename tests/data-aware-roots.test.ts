import assert from 'node:assert/strict';
import {test} from 'node:test';
import {classifyTaskRootedMembers,discoverImportedMemberCalls} from '../src/smart.js';

const nayaTask=`Analyze the shopping cart flow in the jewelry store. Find where products are added to the cart. Identify components managing cart state. Locate quantity updates and total price calculations. Trace relevant imports. Identify bugs.`;

test('Naya-shaped validateStock retains product lookup despite neutral function name',()=>{
 const source=`import {db} from './db';
 function Cart(){
   const items=[{productId:'x',quantity:2}];
   const validateStock=async()=>{const products=await db.products.getByIds(items.map(item=>item.productId));return products.every(p=>p.stock>=items.length)};
   const processOrder=async()=>{await db.coupons.validateCoupon('SAVE10');await db.orders.createWithValidation(items)};
   return <section><p>Quantity: {items.length}</p><button onClick={processOrder}>Pay now</button></section>
 }`;
 const calls=discoverImportedMemberCalls('Cart.tsx',source,'./db');
 const got=classifyTaskRootedMembers('Cart.tsx',source,nayaTask,['addToCart','updateQuantity'],calls);
 const product=got.find(x=>x.call.qualifiedName==='db.products.getByIds');
 assert.ok(product,JSON.stringify(got));
 assert.equal(product.rooted,true);
 assert.equal(product.reason,'task-semantic-fallback');
 assert.ok(product.root?.includes('validateStock'));
 assert.ok(got.filter(x=>x.call.qualifiedName.startsWith('db.coupons')||x.call.qualifiedName.startsWith('db.orders')).every(x=>!x.rooted));
});

test('weak imported API fallbacks have a strict two-method cap per file',()=>{
 const source=`import {db} from './db';
 function Cart(){
 const selectedProduct=3,quantity=2;
 const fetchProducts=async()=>{const products=await Promise.all([db.products.getByIds([]),db.products.getById('a'),db.products.list(),db.products.getByCategory('x')]);return products.length+selectedProduct+quantity};
 return <p>{selectedProduct}</p>;
 }`;
 const calls=discoverImportedMemberCalls('Cart.tsx',source,'./db');
 const got=classifyTaskRootedMembers('Cart.tsx',source,nayaTask,[],calls);
 assert.equal(got.length,4);
 assert.ok(got.filter(x=>x.reason==='task-semantic-fallback').length<=2);
});

test('a generic layout loader without task subject never promotes unrelated API fan-out',()=>{
 const source=`import {db} from './db';
 function StoreLayout(){
 const loadLayoutData=async()=>{const banners=await db.banners.list();const reviews=await db.reviews.list();return banners.concat(reviews)};
 return <button onClick={loadLayoutData}>Refresh layout</button>
 }`;
 const calls=discoverImportedMemberCalls('StoreLayout.tsx',source,'./db');
 assert.equal(calls.length,2);
 assert.ok(classifyTaskRootedMembers('StoreLayout.tsx',source,nayaTask,[],calls).every(x=>!x.rooted));
});
