'use strict';
/**
 * Real MySQL duplicate-checkout smoke test. ISOLATED integration DB only.
 * No .env changes, no HTTP authentication bypass, no payments.
 * Creates a temporary checkout request/order, verifies a concurrent replay,
 * then deletes those test records and restores stock in one transaction.
 */
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const mysql=require('mysql2/promise');
const {createCheckoutService}=require('./checkoutService');
const DB='coffee_overflow_integration';
const USER='coffee_overflow_integration_app';
const PRODUCT_ID=1;
const PRODUCT_NAME='Checkout Integration Test Coffee';
const SHOPPER_ID=1; // synthetic direct-service test identity, NOT a website login
function hiddenPrompt(question){return new Promise((resolve,reject)=>{
 const input=process.stdin;if(!input.isTTY||!input.setRawMode)return reject(Error('Use an interactive Windows Command Prompt'));
 const prior=Boolean(input.isRaw);let pass='';process.stdout.write(question);input.setRawMode(true);input.resume();
 function done(error){input.off('data',onData);input.setRawMode(prior);process.stdout.write('\n');if(error)reject(error);else resolve(pass);}
 function onData(buffer){for(const char of buffer.toString('utf8')){
  if(char==='\r'||char==='\n')return done();
  if(char==='\u0003')return done(Error('Cancelled'));
  if(char==='\b'||char==='\u007f')pass=pass.slice(0,-1);
  else if(char>=' ')pass+=char;
 }}input.on('data',onData);
});}
async function snapshot(pool){
 const [[p]]=await pool.execute('SELECT name,price,stock_quantity FROM products WHERE product_id=?',[PRODUCT_ID]);
 const [[o]]=await pool.execute('SELECT COUNT(*) AS count FROM orders');
 const [[oi]]=await pool.execute('SELECT COUNT(*) AS count FROM order_items');
 const [[e]]=await pool.execute('SELECT COUNT(*) AS count FROM order_events');
 const [[r]]=await pool.execute('SELECT COUNT(*) AS count FROM checkout_requests');
 return {p,orders:Number(o.count),items:Number(oi.count),events:Number(e.count),requests:Number(r.count)};
}
async function cleanup(pool,token,id){
 const conn=await pool.getConnection();
 try{
  await conn.beginTransaction();
  const [[row]]=await conn.execute('SELECT order_id,user_id FROM orders WHERE order_id=? FOR UPDATE',[id]);
  if(!row || Number(row.user_id)!==SHOPPER_ID)throw Error('Cleanup blocked: unexpected order');
  const [lines]=await conn.execute('SELECT product_id,quantity FROM order_items WHERE order_id=?',[id]);
  if(lines.length!==1||Number(lines[0].product_id)!==PRODUCT_ID||Number(lines[0].quantity)!==1)throw Error('Cleanup blocked: unexpected order lines');
  const [requestRows]=await conn.execute('SELECT client_token,order_id,user_id FROM checkout_requests WHERE client_token=? FOR UPDATE',[token]);
  if(requestRows.length!==1||Number(requestRows[0].order_id)!==id||Number(requestRows[0].user_id)!==SHOPPER_ID)throw Error('Cleanup blocked: unexpected checkout request');
  const [dr]=await conn.execute('DELETE FROM checkout_requests WHERE client_token=? AND order_id=?',[token,id]);
  if(dr.affectedRows!==1)throw Error('Cleanup failed to remove request');
  const [di]=await conn.execute('DELETE FROM order_items WHERE order_id=?',[id]);
  if(di.affectedRows!==1)throw Error('Cleanup failed to remove order item');
  const [doo]=await conn.execute('DELETE FROM orders WHERE order_id=? AND user_id=?',[id,SHOPPER_ID]);
  if(doo.affectedRows!==1)throw Error('Cleanup failed to remove order');
  const [up]=await conn.execute('UPDATE products SET stock_quantity=stock_quantity+1 WHERE product_id=?',[PRODUCT_ID]);
  if(up.affectedRows!==1)throw Error('Cleanup failed to restore stock');
  await conn.commit();
 }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
}
async function main(){
 console.log('Coffee Overflow — REAL MySQL checkout retry protection test (integration database only)');
 const password=await hiddenPrompt('Integration database password (hidden): ');
 if(!password)throw Error('No password entered');
 const pool=mysql.createPool({host:'127.0.0.1',port:3306,user:USER,password,database:DB,connectionLimit:4});
 let createdId=null,token=null;
 try{
  const [[who]]=await pool.execute('SELECT CURRENT_USER() AS account,DATABASE() AS db');
  assert.equal(who.db,DB);assert.equal(who.account.split('@')[0],USER);
  const before=await snapshot(pool);
  assert.ok(before.p && before.p.name===PRODUCT_NAME);
  assert.equal(String(before.p.price),'18.00');
  assert.deepEqual({stock:Number(before.p.stock_quantity),orders:before.orders,items:before.items,events:before.events,requests:before.requests},{stock:10,orders:0,items:0,events:0,requests:0},'Fixture database must be empty and product stocked at 10');
  console.log('PASS: Restricted DB and clean fixture checked (10 stock, 0 orders/requests)');
  const service=createCheckoutService(pool,{requireIdempotencyToken:true});
  token=crypto.randomUUID();
  const payload={items:[{product_id:PRODUCT_ID,quantity:1}],client_token:token};
  // Run two identical requests at nearly the same time to test transaction
  // serialization through the unique checkout token.
  const [a,b]=await Promise.all([service.placeOrder({id:SHOPPER_ID},payload),service.placeOrder({id:SHOPPER_ID},payload)]);
  createdId=a.order_id;
  assert.equal(a.order_id,b.order_id);
  assert.equal(a.total_cents,1949);assert.equal(b.total_cents,1949);
  assert.deepEqual([a.replayed,b.replayed].sort(),[false,true]);
  let state=await snapshot(pool);
  assert.deepEqual({stock:Number(state.p.stock_quantity),orders:state.orders,items:state.items,requests:state.requests},{stock:9,orders:1,items:1,requests:1});
  console.log(`PASS: Concurrent identical checkouts saved one order #${createdId}, stock 10 -> 9, second replayed`);
  await assert.rejects(service.placeOrder({id:SHOPPER_ID},{items:[{product_id:PRODUCT_ID,quantity:2}],client_token:token}),e=>e.status===409);
  await assert.rejects(service.placeOrder({id:2},payload),e=>e.status===409);
  state=await snapshot(pool);
  assert.equal(state.orders,1);assert.equal(state.requests,1);assert.equal(Number(state.p.stock_quantity),9);
  console.log('PASS: Changed cart and different user token reuse rejected (409), no extra stock deduction');
  await cleanup(pool,token,createdId);createdId=null;
  state=await snapshot(pool);
  assert.deepEqual({stock:Number(state.p.stock_quantity),orders:state.orders,items:state.items,events:state.events,requests:state.requests},{stock:10,orders:0,items:0,events:0,requests:0});
  console.log('SUCCESS: Retry protection verified on real MySQL; fixture fully cleaned up (stock 10, 0 records).');
 }finally{
  if(createdId!==null){
    try{await cleanup(pool,token,createdId);console.log('Final cleanup completed.');}
    catch(e){console.error(`MANUAL CLEANUP MAY BE REQUIRED: Order #${createdId}. ${e.message}`);}
  }
  await pool.end();
 }
}
main().catch(e=>{console.error('TEST FAILED:',e.message);process.exitCode=1;});
