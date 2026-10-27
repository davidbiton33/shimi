import {test} from 'node:test';
import assert from 'node:assert/strict';
import {taskSpecificApiMember} from '../src/smart.js';
const task='Analyze shopping cart flow, find where products are added, cart state, quantity updates, total price calculations, trace relevant imports and bugs.';
test('generic product CRUD overlaps never promote unrelated admin UI',()=>{
 assert.equal(taskSpecificApiMember('db.products.update',task),false);
 assert.equal(taskSpecificApiMember('db.products.create',task),false);
 assert.equal(taskSpecificApiMember('db.categories.list',task),false);
 assert.equal(taskSpecificApiMember('db.products.update','Check db.products.updateQuantity and cart'),false);
});
test('deliberately requested imported member is a valid high-specificity anchor',()=>{
 assert.equal(taskSpecificApiMember('db.products.update','Review implementation of db.products.update for admin inventory'),true);
});
test('subject-specific inventory service qualifies without an exact member reference',()=>{
 assert.equal(taskSpecificApiMember('db.inventory.validateStock','Analyze inventory stock validation and overselling'),true);
});
test('analytics revenue member qualifies; generic layout loading does not',()=>{
 assert.equal(taskSpecificApiMember('db.analytics.revenueReport','Analyze analytics revenue reports dashboard'),true);
 assert.equal(taskSpecificApiMember('db.pages.list',task),false);
});
