'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normalize,eligible,filterProducts,fmt,esc}=require('./storefront-products');
const row=(id,name,price,stock,extra={})=>({product_id:id,name,price_cents:price,stock,active:1,category:'Coffee',image:'/assets/images/Pile_of_coffee_beans.jpeg',...extra});
test('normalize MySQL cents and image paths with no double conversion',()=>{
 const p=normalize(row(1,'Sunrise',1800,15,{sale_price_cents:1500}));
 assert.equal(p.price,1800);assert.equal(p.salePrice,1500);assert.equal(p.stock,15);
 assert.equal(p.image,'./assets/images/Pile_of_coffee_beans.jpeg');
 assert.equal(fmt(p.salePrice),'$15.00');
});
test('hide inactive rows and reject invalid prices',()=>{
 const p=eligible([row(1,'Visible',1800,2),row(2,'Hidden',2500,2,{active:0}),row(3,'Bad',-12,3)]);
 assert.deepEqual(p.map(x=>x.id),['1']);
});
test('search, category, sale and price filters',()=>{
 const ps=eligible([row(1,'Sunrise',1800,15,{sale_price_cents:1400}),row(2,'Mug',2600,4,{category:'Gear'}),row(3,'Decaf',3500,0)]);
 assert.deepEqual(filterProducts(ps,{search:'sun',sort:''}).map(x=>x.id),['1']);
 assert.deepEqual(filterProducts(ps,{category:'Gear',sort:''}).map(x=>x.id),['2']);
 assert.deepEqual(filterProducts(ps,{sale:true,priceRanges:['under15'],sort:''}).map(x=>x.id),['1']);
 assert.deepEqual(filterProducts(ps,{inStock:true,sort:''}).map(x=>x.id),['1','2']);
});
test('sort by price, name and available stock',()=>{
 const ps=eligible([row(1,'Zoo',1800,15),row(2,'Apple',2600,4),row(3,'Midnight',3500,0)]);
 assert.deepEqual(filterProducts(ps,{sort:'price-desc'}).map(x=>x.id),['3','2','1']);
 assert.deepEqual(filterProducts(ps,{sort:'name-asc'}).map(x=>x.id),['2','3','1']);
 assert.deepEqual(filterProducts(ps,{sort:'stock-asc'}).map(x=>x.id),['3','2','1']);
});
test('HTML escapes product fields',()=>{
 assert.equal(esc('<img onerror="x">'),'&lt;img onerror=&quot;x&quot;&gt;');
});
