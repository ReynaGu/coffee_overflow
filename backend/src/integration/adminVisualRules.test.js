'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {exactAdminEmail,exactCustomerEmail,expectedStockForOrder,allowedNextStatus} = require('./adminVisualRules');
test('test-only admin fixture addresses are accepted',()=>assert.equal(exactAdminEmail('co-admin-abcdef123456@example.test'),true));
test('non-test or malformed admin addresses are rejected',()=>{
  for (const email of ['admin@example.com','co-admin-ABCDEF123456@example.test','co-admin-abcdef123456@example.test.evil','co-admin-abc@example.test']) assert.equal(exactAdminEmail(email),false);
});
test('test-only shopper fixture addresses accepted',()=>assert.equal(exactCustomerEmail('co-browser-ab12cd34ef@example.test'),true));
test('other shopper addresses rejected',()=>{
  for (const email of ['real@shop.com','co-admin-abcdef123456@example.test','co-browser-ABCDEF@example.test'])assert.equal(exactCustomerEmail(email),false);
});
test('empty fixture leaves stock at 10',()=>assert.equal(expectedStockForOrder(null),10));
test('fulfilled and processing orders consume one item',()=>{
  assert.equal(expectedStockForOrder('fulfilled'),9);assert.equal(expectedStockForOrder('processing'),9);assert.equal(expectedStockForOrder('placed'),9);
});
test('cancellation already restores stock',()=>assert.equal(expectedStockForOrder('cancelled'),10));
test('unrecognized status is rejected',()=>assert.throws(()=>expectedStockForOrder('refunded'),/Unrecognized/));
test('admin buttons allow only legal transitions',()=>{
  assert.deepEqual(allowedNextStatus('placed'),['processing','cancelled']);
  assert.deepEqual(allowedNextStatus('processing'),['fulfilled','cancelled']);
  assert.deepEqual(allowedNextStatus('fulfilled'),[]);
  assert.deepEqual(allowedNextStatus('cancelled'),[]);
  assert.throws(()=>allowedNextStatus('unknown'),/Unrecognized/);
});
