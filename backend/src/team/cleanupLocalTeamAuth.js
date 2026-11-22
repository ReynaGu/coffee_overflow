'use strict';
/** Strict single-transaction teardown for exact Phase 4B2 synthetic identities. */
const net=require('node:net');
const {validTestAdmin,validTestCustomer,HOST,PORT}=require('./teamAuthBoundary');
const {ensure,makePool,verifySchema,counts,assertCountsExactly,assertOrdersForCleanup,PRODUCT}=require('./teamAuthFixture');
function parseEmails(admin,customer){
  const a=String(admin||'').trim().toLowerCase(),c=String(customer||'').trim().toLowerCase();
  ensure(validTestAdmin(a),'invalid exact admin email');
  ensure(c==='-'||validTestCustomer(c),'customer must be exact email or -');
  return {adminEmail:a,customerEmail:c==='-'?null:c};
}
async function checkPortStopped(){
  return new Promise((resolve,reject)=>{
    const sock=net.connect({host:HOST,port:PORT});
    sock.setTimeout(600);
    sock.once('connect',()=>{sock.destroy();reject(Error('Port 5191 is still listening; stop the authenticated server before cleanup'));});
    sock.once('error',e=>{sock.destroy();e.code==='ECONNREFUSED'?resolve():reject(e);});
    sock.once('timeout',()=>{sock.destroy();reject(Error('Cannot verify port 5191 is stopped'));});
  });
}
async function cleanup(pool,adminEmail,customerEmail){
  ensure(validTestAdmin(adminEmail)&&(!customerEmail||validTestCustomer(customerEmail)),'exact synthetic identities required');
  const conn=await pool.getConnection();
  try{
    await conn.beginTransaction();await verifySchema(conn);
    // Lock the exact fixture tables before validating the whole test session.
    const [users]=await conn.query('SELECT id,email FROM users ORDER BY id FOR UPDATE');
    const [credentials]=await conn.query('SELECT user_id,role,is_active FROM auth_credentials FOR UPDATE');
    const [sessions]=await conn.query('SELECT user_id FROM auth_sessions FOR UPDATE');
    const [products]=await conn.query('SELECT product_id,name,price,stock_quantity,description FROM products FOR UPDATE');
    const [orders]=await conn.query('SELECT order_id,user_id,status,subtotal,tax,total FROM orders FOR UPDATE');
    const [items]=await conn.query('SELECT order_id,product_id,quantity,unit_price FROM order_items FOR UPDATE');
    const [claims]=await conn.query('SELECT client_token,order_id,user_id,receipt_json FROM checkout_requests FOR UPDATE');
    const [events]=await conn.query('SELECT order_id,actor_user_id,from_status,to_status,note FROM order_events ORDER BY id FOR UPDATE');
    const extra=await counts(conn);
    for(const t of ['carts','cart_items','discounts','sales','sale_items'])ensure(Number(extra[t])===0,`unexpected ${t} data`);
    const state=assertOrdersForCleanup({users,credentials,sessions,products,orders,items,claims,events,adminEmail,customerEmail});
    const expected={auth_credentials:customerEmail?2:1,auth_sessions:sessions.length,products:1,
      orders:orders.length,order_items:items.length,order_events:events.length,checkout_requests:claims.length};
    assertCountsExactly(extra,expected);
    if(state.orderId!==null){
      await conn.execute('DELETE FROM order_events WHERE order_id=?',[state.orderId]);
      const [a]=await conn.execute('DELETE FROM order_items WHERE order_id=?',[state.orderId]);
      ensure(a.affectedRows===1,'order items removed unexpectedly');
      const [b]=await conn.execute('DELETE FROM checkout_requests WHERE order_id=?',[state.orderId]);
      ensure(b.affectedRows===1,'checkout request removed unexpectedly');
      const [c]=await conn.execute('DELETE FROM orders WHERE order_id=? AND user_id=?',[state.orderId,state.ids.get(customerEmail)]);
      ensure(c.affectedRows===1,'order removed unexpectedly');
    }
    for(const email of [customerEmail,adminEmail].filter(Boolean)){
      const id=state.ids.get(email);
      await conn.execute('DELETE FROM auth_sessions WHERE user_id=?',[id]);
      const [a]=await conn.execute('DELETE FROM auth_credentials WHERE user_id=?',[id]);ensure(a.affectedRows===1,'credentials changed');
      const [b]=await conn.execute('DELETE FROM users WHERE id=? AND email=?',[id,email]);ensure(b.affectedRows===1,'synthetic user changed');
    }
    const [p]=await conn.execute('DELETE FROM products WHERE product_id=? AND name=? AND stock_quantity=?',
      [PRODUCT.id,PRODUCT.name,state.status===null||state.status==='cancelled'?1:0]);
    ensure(p.affectedRows===1,'fixture product changed');
    const [remaining]=await conn.query('SELECT id,email FROM users');
    ensure(remaining.length===1&&Number(remaining[0].id)===0&&remaining[0].email==='','original placeholder not preserved');
    assertCountsExactly(await counts(conn));
    await conn.commit();return {order:state.orderId,status:state.status};
  }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
}
async function main(){
  const {hiddenPrompt}=require('../unified/catalogPhase2Db');
  const {adminEmail,customerEmail}=parseEmails(process.argv[2],process.argv[3]);
  console.log('PHASE 4B2 STRICT CLEANUP — exact synthetic identities and product #601 only.');
  console.log('Admin:',adminEmail,'Customer:',customerEmail||'(none)');
  await checkPortStopped();
  const dbPassword=await hiddenPrompt('Restricted writer MySQL password (hidden): ');
  const pool=makePool(dbPassword);
  try{const result=await cleanup(pool,adminEmail,customerEmail);
    console.log(`SUCCESS: Deleted exact synthetic fixture, ${result.order?'one '+result.status+' order':'no order'}, sessions and accounts. Placeholder user #0 preserved; no extra rows.`);
  }finally{await pool.end();}
}
if(require.main===module)main().catch(e=>{console.error('PHASE 4B CLEANUP STOPPED:',e.message);process.exitCode=1;});
module.exports={parseEmails,checkPortStopped,cleanup};
