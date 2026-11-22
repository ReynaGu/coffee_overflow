'use strict';
/** Local-only Phase 2 synthetic catalog. Product wording, listed prices, stock,
 * categories and image filenames are transcribed from the current products.html.
 * IDs 101-119 and sale ID 901 are reserved solely for this isolated fixture.
 */
const {toCents, toDecimal} = require('../checkout/pricing');
const ITEMS = Object.freeze([
  {id:101,name:'Morning Blend Coffee Beans (12 oz)',price:1800,sale:1400,stock:12,category:'Coffee Blend',image:'Pile_of_coffee_beans.jpeg'},
  {id:102,name:'Classic White Ceramic Mug',price:1200,stock:30,category:'Mug',image:'espresso_machine.jpeg'},
  {id:103,name:'Latte Mug Set (Set of 2)',price:2800,stock:8,category:'Mug',image:'three_people_enjoying_coffee.jpeg'},
  {id:104,name:'French Vanilla Coffee',price:1599,stock:30,category:'Coffee Blend',image:'Pile_of_coffee_beans.jpeg'},
  {id:105,name:'Caramel Macchiato Blend',price:1799,stock:25,category:'Coffee Blend',image:'Pile_of_coffee_beans.jpeg'},
  {id:106,name:'Hazelnut Delight Coffee',price:1649,stock:20,category:'Coffee Blend',image:'Pile_of_coffee_beans.jpeg'},
  {id:107,name:'Dark Roast Espresso',price:1899,stock:35,category:'Coffee Blend',image:'Pile_of_coffee_beans.jpeg'},
  {id:108,name:'Colombian Supremo Coffee',price:1999,stock:40,category:'Coffee Blend',image:'Pile_of_coffee_beans.jpeg'},
  {id:109,name:'Mocha Chocolate Blend',price:1749,stock:25,category:'Coffee Blend',image:'Pile_of_coffee_beans.jpeg'},
  {id:110,name:'Sunshine Blend Coffee',price:1499,stock:50,category:'Coffee Blend',image:'Pile_of_coffee_beans.jpeg'},
  {id:111,name:'Pumpkin Spice Coffee',price:1699,stock:20,category:'Coffee Blend',image:'Pile_of_coffee_beans.jpeg'},
  {id:112,name:'Cinnamon Swirl Coffee',price:1549,stock:30,category:'Coffee Blend',image:'Pile_of_coffee_beans.jpeg'},
  {id:113,name:'Midnight Decaf Coffee',price:1699,stock:25,category:'Coffee Blend',image:'Pile_of_coffee_beans.jpeg'},
  {id:114,name:'Blue Coffee Overflow Hat',price:1299,stock:20,category:'Merchandise - Hat',image:'blue_hat.png'},
  {id:115,name:'Pink Coffee Overflow Hat',price:1299,stock:20,category:'Merchandise - Hat',image:'pink_hat.png'},
  {id:116,name:'Yellow Coffee Overflow Hat',price:1299,stock:20,category:'Merchandise - Hat',image:'yellow_hat.png'},
  {id:117,name:'Blue Coffee Overflow T-Shirt',price:1999,stock:25,category:'Merchandise - T-Shirt',image:'blue_shirt.png'},
  {id:118,name:'Pink Coffee Overflow T-Shirt',price:1999,stock:25,category:'Merchandise - T-Shirt',image:'pink_shirt.png'},
  {id:119,name:'Yellow Coffee Overflow T-Shirt',price:1999,stock:25,category:'Merchandise - T-Shirt',image:'yellow_shirt.png'}
].map(o=>Object.freeze(o)));
const BY_ID = new Map(ITEMS.map(x=>[x.id,x]));
const SALE_ID=901;
const SELECT_CATALOG = `SELECT p.product_id,p.name,p.description,p.price,p.stock_quantity,
  (SELECT MIN(si.sale_price) FROM sale_items si WHERE si.product_id=p.product_id AND si.sale_price > 0) AS sale_price
  FROM products p WHERE p.product_id BETWEEN 101 AND 119 ORDER BY p.product_id`;
function assert(condition,message){if(!condition)throw Error('Phase 2 fixture refused: '+message);}
function verifyRow(row, {allowSold=false}={}){
  const id=Number(row?.product_id), item=BY_ID.get(id);
  assert(Boolean(item),'unknown product ID');
  assert(row.name===item.name,'product name mismatch for #'+id);
  assert(toCents(row.price)===item.price,'product price mismatch for #'+id);
  const stock=Number(row.stock_quantity);
  assert(Number.isSafeInteger(stock) && stock>=0 && (allowSold ? stock<=item.stock : stock===item.stock), 'product stock mismatch for #'+id);
  assert(toCents(row.sale_price) === (item.sale??null),'sale price mismatch for #'+id);
  return item;
}
function validateCatalog(rows, options={}){
  assert(Array.isArray(rows)&&rows.length===ITEMS.length,'expected exactly 19 local catalog products');
  for(let i=0;i<ITEMS.length;i++){
    assert(Number(rows[i].product_id)===ITEMS[i].id,'catalog product order or identity mismatch');
    verifyRow(rows[i],options);
  }
  return true;
}
function toPublicProduct(row){
  const meta=verifyRow(row,{allowSold:true});
  return {product_id:meta.id,name:row.name,description:String(row.description||''),price_cents:meta.price,
    sale_price_cents:meta.sale??null,stock:Number(row.stock_quantity),category:meta.category,
    image:'/assets/images/'+meta.image,active:1};
}
const MAX_LINES=3,MAX_QTY=3;
function permittedCatalogOrder(body){
  if(!body||typeof body!=='object'||Array.isArray(body))return false;
  if(body.discount_code!=null && body.discount_code!=='')return false;
  if(!Array.isArray(body.items)||body.items.length<1||body.items.length>MAX_LINES)return false;
  if(typeof body.client_token!=='string'||body.client_token.length<8||body.client_token.length>128)return false;
  const used=new Set();
  return body.items.every(x=>{
    if(!x||typeof x!=='object'||Array.isArray(x))return false;
    const id=Number(x.product_id),qty=Number(x.quantity);
    if(!Number.isSafeInteger(id)||!BY_ID.has(id)||!Number.isSafeInteger(qty)||qty<1||qty>MAX_QTY||used.has(id))return false;
    used.add(id);return true;
  });
}
function expectedOrderAmounts(items){
  let subtotalCents=0;
  for(const row of items){const item=BY_ID.get(Number(row.product_id));assert(Boolean(item),'unexpected order product');
    const qty=Number(row.quantity);assert(Number.isSafeInteger(qty)&&qty>=1&&qty<=MAX_QTY,'invalid order quantity');
    const unit=item.sale??item.price;
    assert(toCents(row.unit_price)===unit,'incorrect recorded order item price');
    subtotalCents+=unit*qty;
  }
  const {taxFor}=require('../checkout/pricing');
  const taxCents=taxFor(subtotalCents);
  return {subtotalCents,taxCents,totalCents:subtotalCents+taxCents};
}
module.exports={ITEMS,BY_ID,SALE_ID,SELECT_CATALOG,assert,validateCatalog,verifyRow,toPublicProduct,permittedCatalogOrder,expectedOrderAmounts,MAX_LINES,MAX_QTY,toDecimal};
