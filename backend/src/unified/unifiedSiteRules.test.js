'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const {injectConfig,previewProduct,isAllowedPage}=require('./unifiedSiteRules');
test('injects runtime config before existing scripts',()=>{
  const result=injectConfig('<!doctype html><html><head><script defer src="assets/js/main.js"></script></head><body></body></html>');
  assert.ok(result.indexOf('/unified/config.js') < result.indexOf('assets/js/main.js'));
  assert.ok(result.includes('/unified/site-ui.js'));
});
test('supports head attributes',()=>assert.ok(injectConfig('<head lang="en"></head>').includes('/unified/config.js')));
test('refuses malformed html',()=>assert.throws(()=>injectConfig('<div>no head</div>')));
test('refuses repeat injection',()=>assert.throws(()=>injectConfig('<head><script src="/unified/config.js"></script></head>')));
test('restricts static pages',()=>{assert.equal(isAllowedPage('index.html'),true);assert.equal(isAllowedPage('cart.html'),true);assert.equal(isAllowedPage('../.env'),false);assert.equal(isAllowedPage('backend/package.json'),false);});
test('maps test product to storefront cents',()=>assert.deepEqual(previewProduct({product_id:1,name:'Checkout Integration Test Coffee',description:'fixture',price:'18.00',stock_quantity:10}),{
  product_id:1,name:'Checkout Integration Test Coffee',description:'fixture',price_cents:1800,sale_price_cents:null,stock:10,active:1,category:'Coffee',image:'/assets/images/Pile_of_coffee_beans.jpeg'
}));
test('rejects products outside fixture',()=>assert.throws(()=>previewProduct({product_id:2,price:'18.00',stock_quantity:10})));
test('rejects invalid stock',()=>assert.throws(()=>previewProduct({product_id:1,price:18,stock_quantity:-1})));
test('rejects invalid price',()=>assert.throws(()=>previewProduct({product_id:1,price:'oops',stock_quantity:10})));
