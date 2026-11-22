'use strict';
/** Inserts temporary products ONLY into the preverified isolated integration DB.
 * It never changes product #1 and refuses an unexpected schema/data baseline.
 * All writes are in one transaction and are reversible by cleanupCatalogPhase2.js.
 */
const {ITEMS,SALE_ID,toDecimal,assert}=require('./catalogPhase2Data');
const {hiddenPrompt,makePool,verifyDb,verifyBaseProduct,verifyBaseWithCatalog,counts,expectNoActivity}=require('./catalogPhase2Db');
async function seed(pool){
  const conn=await pool.getConnection();
  try{
    await conn.beginTransaction();
    await verifyDb(conn);await verifyBaseProduct(conn);
    expectNoActivity(await counts(conn));
    for(const table of ['sales','sale_items']){const [[x]]=await conn.query(`SELECT COUNT(*) AS n FROM ${table}`);assert(Number(x.n)===0,`expected empty ${table}`);}
    for(const item of ITEMS){
      await conn.execute('INSERT INTO products (product_id,name,price,stock_quantity,description) VALUES (?,?,?,?,?)',[
        item.id,item.name,toDecimal(item.price),item.stock,''
      ]);
    }
    await conn.execute('INSERT INTO sales (sale_id,sale_name) VALUES (?,?)',[SALE_ID,SALE_ID]);
    await conn.execute('INSERT INTO sale_items (sale_id,product_id,sale_price) VALUES (?,?,?)',[SALE_ID,101,toDecimal(1400)]);
    await verifyBaseWithCatalog(conn);
    expectNoActivity(await counts(conn));
    await conn.commit();
    return ITEMS.length;
  }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
}
async function main(){
  console.log('Coffee Overflow — Phase 2 LOCAL CATALOG SEED (19 test products; no payments).');
  console.log('ONLY uses coffee_overflow_integration, requires exactly one original fixture product, zero orders/sessions, and no sales.');
  const pw=await hiddenPrompt('Restricted integration MySQL password (hidden): ');
  const pool=makePool(pw);
  try{const n=await seed(pool);console.log(`SUCCESS: Added ${n} temporary catalog products (IDs 101–119) plus one temporary sale. Original fixture product #1 is unchanged.`);
    console.log('Run startLocalCatalogPhase2.js, then cleanupCatalogPhase2.js after testing. Do not use the Phase 1 cleanup tool for a catalog order.');
  }finally{await pool.end();}
}
if(require.main===module)main().catch(e=>{console.error('CATALOG SEED STOPPED:',e.message);process.exitCode=1;});
module.exports={seed};
