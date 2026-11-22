'use strict';
/**
 * Removes exactly one synthetic co-browser-...@example.test account and at most
 * one matching fixture order from coffee_overflow_integration. Nothing else.
 * All mutations happen in a transaction with strict ownership, totals and
 * stock checks. Never use against a non-test database.
 */
const mysql=require('mysql2/promise');
const {permittedTestEmail}=require('./integrationRules');
const DATABASE='coffee_overflow_integration', USER='coffee_overflow_integration_app';
function hiddenPrompt(message){return new Promise((resolve,reject)=>{
  if(!process.stdin.isTTY||typeof process.stdin.setRawMode!=='function')return reject(Error('Use an interactive Windows CMD terminal'));
  let value='';const prior=Boolean(process.stdin.isRaw);process.stdout.write(message);process.stdin.setRawMode(true);process.stdin.resume();
  const finish=e=>{process.stdin.off('data',accept);process.stdin.setRawMode(prior);process.stdout.write('\n');e?reject(e):resolve(value);};
  function accept(buf){for(const ch of buf.toString('utf8')){if(ch==='\r'||ch==='\n')return finish();if(ch==='\x03')return finish(Error('Cancelled'));if(ch==='\b'||ch==='\x7f')value=value.slice(0,-1);else if(ch>=' ')value+=ch;}}
  process.stdin.on('data',accept);
});}
async function cleanup(pool,email){
  const conn=await pool.getConnection();
  try{
    await conn.beginTransaction();
    const [[who]]=await conn.query('SELECT CURRENT_USER() AS account,DATABASE() AS db');
    if(who.db!==DATABASE||who.account.split('@')[0]!==USER)throw Error('Incorrect database/account');
    const [u]=await conn.execute('SELECT id,email FROM users WHERE email=? FOR UPDATE',[email]);
    if(u.length!==1||u[0].email!==email)throw Error('Synthetic test account not found; nothing deleted');
    const userId=Number(u[0].id);
    const [creds]=await conn.execute('SELECT role FROM auth_credentials WHERE user_id=?',[userId]);
    if(creds.length!==1||creds[0].role!=='customer')throw Error('Expected synthetic customer credentials only');
    const [allOrders]=await conn.query('SELECT order_id,user_id,status,total FROM orders ORDER BY order_id FOR UPDATE');
    if(allOrders.length>1||allOrders.some(o=>Number(o.user_id)!==userId))throw Error('Unrecognized orders exist; refusing cleanup');
    const [allEvents]=await conn.query('SELECT id FROM order_events LIMIT 1');
    if(allEvents.length)throw Error('Unexpected order history exists; refusing cleanup');
    const [allClaims]=await conn.query('SELECT user_id,order_id FROM checkout_requests FOR UPDATE');
    if(allClaims.length!==allOrders.length||allClaims.some(c=>Number(c.user_id)!==userId))throw Error('Unexpected checkout requests; refusing cleanup');
    const [stockRows]=await conn.execute('SELECT stock_quantity FROM products WHERE product_id=? FOR UPDATE',[1]);
    if(stockRows.length!==1)throw Error('Test product missing');
    const currentStock=Number(stockRows[0].stock_quantity);
    if(allOrders.length===1){
      const order=allOrders[0], orderId=Number(order.order_id);
      if(order.status!=='placed'||Math.abs(Number(order.total)-19.49)>0.001||currentStock!==9)throw Error('Order or stock differs from expected test purchase; refusing cleanup');
      if(Number(allClaims[0].order_id)!==orderId)throw Error('Checkout request does not match test order');
      const [lines]=await conn.execute('SELECT product_id,quantity FROM order_items WHERE order_id=?',[orderId]);
      if(lines.length!==1||Number(lines[0].product_id)!==1||Number(lines[0].quantity)!==1)throw Error('Order has unexpected items; refusing cleanup');
      const [stockUpdate]=await conn.execute('UPDATE products SET stock_quantity=10 WHERE product_id=1 AND stock_quantity=9');
      if(stockUpdate.affectedRows!==1)throw Error('Stock restoration failed');
      const [delItems]=await conn.execute('DELETE FROM order_items WHERE order_id=?',[orderId]);
      if(delItems.affectedRows!==1)throw Error('Order item cleanup failed');
      const [delOrder]=await conn.execute('DELETE FROM orders WHERE order_id=? AND user_id=?',[orderId,userId]);
      if(delOrder.affectedRows!==1)throw Error('Order cleanup failed');
    }else{
      if(currentStock!==10)throw Error('Stock differs from expected no-order baseline');
    }
    const [delUser]=await conn.execute('DELETE FROM users WHERE id=? AND email=?',[userId,email]);
    if(delUser.affectedRows!==1)throw Error('Customer cleanup failed');
    const [[remaining]]=await conn.query(`SELECT (SELECT stock_quantity FROM products WHERE product_id=1) AS stock,
      (SELECT COUNT(*) FROM orders) AS orders,
      (SELECT COUNT(*) FROM checkout_requests) AS requests,
      (SELECT COUNT(*) FROM auth_credentials) AS credentials,
      (SELECT COUNT(*) FROM auth_sessions) AS sessions`);
    if(Number(remaining.stock)!==10||['orders','requests','credentials','sessions'].some(k=>Number(remaining[k])!==0))throw Error('Cleanup verification failed; rolling back');
    await conn.commit();
    return {userId,hadOrder:allOrders.length===1};
  }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
}
async function main(){
  const email=String(process.argv[2]||'').trim().toLowerCase();
  if(!permittedTestEmail(email))throw Error('Usage: node backend/src/integration/cleanupLocalShop.js co-browser-XXXXXXXXXX@example.test');
  console.log(`Only synthetic local test account ${email} will be considered for deletion.`);
  console.log('Isolated integration DB ONLY, no payments, no original coffee_overflow_dev access.');
  const password=await hiddenPrompt('Restricted integration database password (hidden): ');
  if(!password)throw Error('Password required');
  const pool=mysql.createPool({host:'127.0.0.1',port:3306,user:USER,password,database:DATABASE,connectionLimit:2});
  try{const result=await cleanup(pool,email);console.log(`SUCCESS: Removed synthetic user #${result.userId}${result.hadOrder?' and its one test order':''}. Stock 10; no checkout requests, credentials or sessions.`);}
  finally{await pool.end();}
}
if(require.main===module)main().catch(e=>{console.error('CLEANUP STOPPED:',e.message);process.exitCode=1;});
module.exports={cleanup};
