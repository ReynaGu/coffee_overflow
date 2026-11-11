'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {transitions,transitionResult,toMoney}=require('./orderRules');
test('placed can be processed or cancelled',()=>{
 assert.deepEqual(transitions.placed,['processing','cancelled']);
 assert.deepEqual(transitionResult('placed','processing'),{allowed:true,changed:true,restoreInventory:false});
 assert.deepEqual(transitionResult('placed','cancelled'),{allowed:true,changed:true,restoreInventory:true});
});
test('cannot skip stages, reverse, or reopen terminal orders',()=>{
 for(const pair of [['placed','fulfilled'],['processing','placed'],['fulfilled','cancelled'],['cancelled','placed']])assert.equal(transitionResult(...pair).allowed,false);
});
test('retries do not restock or create events',()=>{
 assert.deepEqual(transitionResult('cancelled','cancelled'),{allowed:true,changed:false,restoreInventory:false});
});
test('rejects unknown statuses and formats money from cents',()=>{
 assert.equal(transitionResult('placed','out-for-delivery').allowed,false);
 assert.equal(toMoney(3897),'$38.97');
});
