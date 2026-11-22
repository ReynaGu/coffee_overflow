'use strict';
/** Clean ONLY the two named local synthetic fixtures (or admin alone).
 * Works for placed / processing / fulfilled / cancelled test orders.
 * Fails closed if unexpected users, orders, history, or inventory exist.
 */
const mysql=require('mysql2/promise');
const {exactAdminEmail,exactCustomerEmail,expectedStockForOrder}=require('./adminVisualRules');
const DATABASE='coffee_overflow_integration',USER='coffee_overflow_integration_app';
function hiddenPrompt(message){return new Promise((resolve,reject)=>{
  const input=process.stdin;if(!input.isTTY||typeof input.setRawMode!=='function')return reject(Error('Use interactive Windows CMD'));
  let value='';const old=Boolean(input.isRaw);let finished=false;
  process.stdout.write(message);input.setRawMode(true);input.resume();
  function end(err){if(finished)return;finished=true;input.off('data',onData);input.setRawMode(old);process.stdout.write('\n');err?reject(err):resolve(value);}
  function onData(buf){for(const ch of buf.toString('utf8')){
    if(ch==='\r'||ch==='\n')return end();if(ch==='\x03')return end(Error('Cancelled'));
    if(ch==='\b'||ch==='\x7f')value=value.slice(0,-1);else if(ch>=' ')value+=ch;
  }}input.on('data',onData);
});}
function assert(cond,msg){if(!cond)throw Error('Cleanup refused: '+msg);}
async function cleanup(pool,adminEmail,customerEmail=null){
  assert(exactAdminEmail(adminEmail),'invalid synthetic admin email');
  assert(customerEmail===null||exactCustomerEmail(customerEmail),'invalid synthetic customer email');
  const conn=await pool.getConnection();
  try{
    await conn.beginTransaction();
    const [[who]]=await conn.query('SELECT CURRENT_USER() AS account,DATABASE() AS db');
    assert(who.db===DATABASE&&who.account.split('@')[0]===USER,'incorrect database or account');
    const emails=customerEmail?[adminEmail,customerEmail]:[adminEmail];
    const marks=emails.map(()=>'?').join(',');
    const [users]=await conn.execute(`SELECT id,email FROM users WHERE email IN (${marks}) FOR UPDATE`,emails);
    assert(users.length===emails.length,'one of the exact synthetic accounts is missing');
    const accountByEmail=new Map(users.map(x=>[x.email,Number(x.id)]));
    for(const e of emails)assert(accountByEmail.has(e),'synthetic account mismatch');
    const adminId=accountByEmail.get(adminEmail),customerId=customerEmail?accountByEmail.get(customerEmail):null;
    const [creds]=await conn.query('SELECT user_id,role FROM auth_credentials FOR UPDATE');
    assert(creds.length===emails.length,'unrelated authentication credentials exist');
    for(const c of creds){
      const id=Number(c.user_id);
      if(id===adminId)assert(c.role==='admin','admin role changed');
      else if(id===customerId)assert(c.role==='customer','customer role changed');
      else assert(false,'foreign credentials exist');
    }
    const [sessions]=await conn.query('SELECT user_id FROM auth_sessions FOR UPDATE');
    assert(sessions.every(s=>[adminId,customerId].includes(Number(s.user_id))),'unrelated session exists');
    const [orders]=await conn.query('SELECT order_id,user_id,status,total FROM orders FOR UPDATE');
    assert(orders.length<=1,'multiple orders exist');
    const [claims]=await conn.query('SELECT client_token,user_id,order_id FROM checkout_requests FOR UPDATE');
    const [lines]=await conn.query('SELECT order_id,product_id,quantity,unit_price FROM order_items FOR UPDATE');
    const [events]=await conn.query('SELECT order_id,actor_user_id,from_status,to_status FROM order_events FOR UPDATE');
    assert(claims.length===orders.length&&lines.length===orders.length,'unexpected checkout records or order items');
    const [p]=await conn.execute('SELECT name,price,stock_quantity FROM products WHERE product_id=? FOR UPDATE',[1]);
    assert(p.length===1&&p[0].name==='Checkout Integration Test Coffee'&&Number(p[0].price)===18,'fixture product changed');
    const status=orders.length?orders[0].status:null;
    assert(Number(p[0].stock_quantity)===expectedStockForOrder(status),'product stock does not match order state');
    if(orders.length){
      const o=orders[0], id=Number(o.order_id);
      assert(customerId!==null&&Number(o.user_id)===customerId,'order belongs to another customer');
      assert(Math.abs(Number(o.total)-19.49)<0.001,'unexpected order total');
      assert(Number(claims[0].order_id)===id&&Number(claims[0].user_id)===customerId,'checkout request belongs to another order/customer');
      assert(Number(lines[0].order_id)===id&&Number(lines[0].product_id)===1&&Number(lines[0].quantity)===1&&Number(lines[0].unit_price)===18,'order items differ from test purchase');
      assert(events.every(e=>Number(e.order_id)===id&&Number(e.actor_user_id)===adminId&&['processing','fulfilled','cancelled'].includes(e.to_status)),'unrecognized order activity');
      if(status!=='cancelled'){
        const [recovered]=await conn.execute('UPDATE products SET stock_quantity=10 WHERE product_id=1 AND stock_quantity=9');
        assert(recovered.affectedRows===1,'could not restore stock');
      }
      await conn.execute('DELETE FROM order_events WHERE order_id=?',[id]);
      const [di]=await conn.execute('DELETE FROM order_items WHERE order_id=?',[id]);
      assert(di.affectedRows===1,'could not delete test line');
      const [removed]=await conn.execute('DELETE FROM orders WHERE order_id=? AND user_id=?',[id,customerId]);
      assert(removed.affectedRows===1,'could not delete test order');
    } else assert(events.length===0,'stray order activity exists');
    for(const e of emails){
      const [d]=await conn.execute('DELETE FROM users WHERE id=? AND email=?',[accountByEmail.get(e),e]);
      assert(d.affectedRows===1,'could not delete exact synthetic account');
    }
    const [[end]]=await conn.query(`SELECT
      (SELECT stock_quantity FROM products WHERE product_id=1) AS stock,
      (SELECT COUNT(*) FROM orders) AS orders,
      (SELECT COUNT(*) FROM order_items) AS items,
      (SELECT COUNT(*) FROM order_events) AS events,
      (SELECT COUNT(*) FROM checkout_requests) AS requests,
      (SELECT COUNT(*) FROM auth_credentials) AS credentials,
      (SELECT COUNT(*) FROM auth_sessions) AS sessions`);
    assert(Number(end.stock)===10,'stock was not restored');
    for(const key of ['orders','items','events','requests','credentials','sessions'])assert(Number(end[key])===0,`leftover ${key}`);
    await conn.commit();return {removedOrder:orders.length===1,previousStatus:status};
  }catch(err){try{await conn.rollback();}catch{}throw err;}finally{conn.release();}
}
async function main(){
  const admin=String(process.argv[2]||'').trim().toLowerCase();
  const shopperArg=String(process.argv[3]||'-').trim().toLowerCase();
  const shopper=shopperArg==='-'?null:shopperArg;
  if(!exactAdminEmail(admin)||!(shopper===null||exactCustomerEmail(shopper)))throw Error('Usage: node backend/src/integration/cleanupLocalAdminVisual.js co-admin-XXXXXXXXXXXX@example.test co-browser-XXXXXXXXXX@example.test   (use - instead of customer email only if none was registered)');
  console.log('LOCAL TEST CLEANUP ONLY. Checks exact synthetic identities, status, history and stock before changes.');
  console.log(`Synthetic administrator: ${admin}`);if(shopper)console.log(`Synthetic customer: ${shopper}`);
  const pass=await hiddenPrompt('Restricted integration MySQL password (hidden): ');
  if(!pass)throw Error('Password required');
  const pool=mysql.createPool({host:'127.0.0.1',port:3306,user:USER,password:pass,database:DATABASE,connectionLimit:2});
  try{const result=await cleanup(pool,admin,shopper);
    console.log(`SUCCESS: Only named synthetic accounts and ${result.removedOrder?'the one '+result.previousStatus+' order':'no orders'} removed. Stock 10; 0 orders, events, requests or auth sessions.`);
  }finally{await pool.end();}
}
if(require.main===module)main().catch(e=>{console.error('ADMIN CLEANUP STOPPED:',e.message);process.exitCode=1;});
module.exports={cleanup};
