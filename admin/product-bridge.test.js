'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {normalizeProduct,listFromTeamApi} = require('./product-bridge');

test('team API product ids map to admin inventory records',()=>{
  const p=normalizeProduct({product_id:1,name:'Sunrise House Blend',description:'Balanced coffee',category:'Coffee',image:'/assets/images/Pile_of_coffee_beans.jpeg',price_cents:1800,sale_price_cents:null,stock:7,active:1});
  assert.equal(p.id,1);assert.equal(p.name,'Sunrise House Blend');assert.equal(p.stock,7);assert.equal(p.active,1);
});

test('local product bridge uses GET without credentials and normalizes data',async()=>{
  let url,opts;
  const fetcher=async(u,o)=>{url=u;opts=o;return {ok:true,status:200,json:async()=>[{product_id:1,name:'Sunrise House Blend',price_cents:1800,stock:7,active:1}]};};
  const result=await listFromTeamApi(fetcher,'localhost');
  assert.equal(url,'http://localhost:3000/api/products');assert.equal(opts.method,'GET');assert.equal(opts.credentials,'omit');
  assert.equal(result.products[0].stock,7);
});

test('bridge rejects errors and incomplete product records',async()=>{
  assert.throws(()=>normalizeProduct({product_id:1,price_cents:1800}),/missing required/);
  await assert.rejects(()=>listFromTeamApi(async()=>({ok:false,status:500}),'localhost'),/HTTP 500/);
  await assert.rejects(()=>listFromTeamApi(async()=>({ok:true,json:async()=>({error:'x'})}),'localhost'),/product list/);
  await assert.rejects(()=>listFromTeamApi(async()=>({ok:true,json:async()=>[]}), 'example.com'),/localhost/);
});
