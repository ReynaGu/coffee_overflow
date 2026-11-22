'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {ITEMS,BY_ID,validateCatalog,toPublicProduct,permittedCatalogOrder,expectedOrderAmounts}=require('./catalogPhase2Data');
const {toDecimal}=require('../checkout/pricing');
function makeRows(){return ITEMS.map(x=>({product_id:x.id,name:x.name,description:'',price:toDecimal(x.price),stock_quantity:x.stock,sale_price:x.sale==null?null:toDecimal(x.sale)}));}
function order(items){return {items,client_token:'example-test-token',discount_code:null};}
test('all 19 products have unique reserved IDs',()=>{
  assert.equal(ITEMS.length,19);assert.equal(BY_ID.size,19);
  assert.deepEqual(ITEMS.map(x=>x.id),Array.from({length:19},(_,i)=>i+101));
});
test('all products have prices, stocks and safe local image paths',()=>{
  for(const item of ITEMS){assert.ok(item.price>0&&Number.isInteger(item.price));assert.ok(item.stock>0&&Number.isInteger(item.stock));assert.match(item.image,/^[A-Za-z0-9_]+\.(?:jpeg|png)$/);assert.ok(item.name.length<=50);}
});
test('valid catalog rows can be verified against full expected prices and stock',()=>assert.equal(validateCatalog(makeRows()),true));
test('missing product fails closed',()=>assert.throws(()=>validateCatalog(makeRows().slice(1)),/exactly 19/));
test('unexpected price fails closed',()=>{const r=makeRows();r[2].price='0.10';assert.throws(()=>validateCatalog(r),/price mismatch/);});
test('unexpected sale fails closed',()=>{const r=makeRows();r[1].sale_price='1.00';assert.throws(()=>validateCatalog(r),/sale price mismatch/);});
test('stock reduction allowed for live product responses, not for clean startup',()=>{const r=makeRows();r[0].stock_quantity--;assert.throws(()=>validateCatalog(r),/stock mismatch/);assert.equal(validateCatalog(r,{allowSold:true}),true);});
test('maps a catalog item into storefront cents and image metadata',()=>assert.deepEqual(toPublicProduct(makeRows()[0]),{
  product_id:101,name:'Morning Blend Coffee Beans (12 oz)',description:'',price_cents:1800,sale_price_cents:1400,stock:12,category:'Coffee Blend',image:'/assets/images/Pile_of_coffee_beans.jpeg',active:1
}));
test('allows one to three catalog product lines',()=>assert.equal(permittedCatalogOrder(order([{product_id:101,quantity:1},{product_id:114,quantity:2}])),true));
test('rejects original product #1 and unknown products',()=>assert.equal(permittedCatalogOrder(order([{product_id:1,quantity:1}])),false));
test('rejects duplicate lines or quantities above three',()=>{
  assert.equal(permittedCatalogOrder(order([{product_id:101,quantity:1},{product_id:101,quantity:1}])),false);
  assert.equal(permittedCatalogOrder(order([{product_id:101,quantity:4}])),false);
});
test('rejects demo discount codes during Phase 2 checkout',()=>assert.equal(permittedCatalogOrder({...order([{product_id:101,quantity:1}]),discount_code:'COFFEE10'}),false));
test('calculates expected discounted subtotal and correct rounded tax from order items',()=>{
  assert.deepEqual(expectedOrderAmounts([{product_id:101,quantity:1,unit_price:'14.00'},{product_id:114,quantity:2,unit_price:'12.99'}]),{subtotalCents:3998,taxCents:330,totalCents:4328});
});
test('refuses an incorrect stored unit price',()=>assert.throws(()=>expectedOrderAmounts([{product_id:101,quantity:1,unit_price:'18.00'}]),/item price/));
