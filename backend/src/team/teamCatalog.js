'use strict';
/** Read-only shared product adapter for the canonical Reyna products/sale_items tables.
 * This is additive groundwork for server.js integration, not a catalog migration.
 */
const {toCents,unitPriceCents}=require('../checkout/pricing');
// Reyna's canonical schema has no image/category/visibility fields yet.
// Keep them explicit rather than importing the temporary Phase 2 fixture.
const SELECT_PRODUCTS=`SELECT p.product_id, p.name, p.description, p.price, p.stock_quantity,
  (SELECT MIN(si.sale_price) FROM sale_items si
   WHERE si.product_id=p.product_id AND si.sale_price>0) AS sale_price
  FROM products p ORDER BY p.product_id`;
function asPublicProduct(row){
  if(!row||typeof row!=='object')throw Error('Product row required');
  const id=Number(row.product_id),stock=Number(row.stock_quantity);
  if(!Number.isSafeInteger(id)||id<1)throw Error('Invalid database product id');
  if(!Number.isSafeInteger(stock)||stock<0)throw Error('Invalid database product inventory');
  const name=String(row.name||'').trim();
  if(!name||name.length>50)throw Error('Invalid database product name');
  const {regularCents,unitCents,onSale}=unitPriceCents(row.price,row.sale_price);
  if(toCents(row.price)!==regularCents)throw Error('Invalid regular price');
  return Object.freeze({product_id:id,name,description:String(row.description||''),
    price_cents:regularCents,sale_price_cents:onSale?unitCents:null,
    stock,category:'Uncategorized',image:'',active:1});
}
function createTeamCatalog(pool){
  if(!pool||typeof pool.execute!=='function')throw Error('MySQL query pool is required');
  async function list(){const [rows]=await pool.execute(SELECT_PRODUCTS);if(!Array.isArray(rows))throw Error('Invalid product query response');return rows.map(asPublicProduct);}
  async function get(id){const num=Number(id);if(!Number.isSafeInteger(num)||num<1)return null;return (await list()).find(item=>item.product_id===num)||null;}
  return Object.freeze({list,get});
}
module.exports={SELECT_PRODUCTS,asPublicProduct,createTeamCatalog};
