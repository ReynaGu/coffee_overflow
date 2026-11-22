'use strict';
/**
 * Coffee Overflow — protected admin order-lifecycle HTTP smoke test.
 * LOCAL INTEGRATION DB ONLY; creates synthetic customer + test-only administrator,
 * drives two checkout orders through a loopback Express instance, then cleans up.
 * No server.js/.env modifications, no public admin-creation endpoint, no payments.
 * From repo root: node backend/src/integration/realAdminHttpSmoke.js
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const mysql = require('mysql2/promise');
const {createLocalIntegratedApp} = require('./localIntegratedApp');
const {createAuthService} = require('../auth/authService');

const HOST = '127.0.0.1';
const DATABASE = 'coffee_overflow_integration';
const USER = 'coffee_overflow_integration_app';
const PRODUCT_ID = 1;
const PRODUCT_NAME = 'Checkout Integration Test Coffee';
const TOTAL = 19.49;

function hiddenPrompt(label) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    if (!input.isTTY || typeof input.setRawMode !== 'function') return reject(Error('Use interactive Windows CMD or PowerShell'));
    let value = '';
    const prior = Boolean(input.isRaw);
    let done = false;
    process.stdout.write(label);
    input.setRawMode(true); input.resume();
    function finish(err) {
      if (done) return;
      done = true;
      input.off('data', receive);
      input.setRawMode(prior);
      process.stdout.write('\n');
      err ? reject(err) : resolve(value);
    }
    function receive(chunk) {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\r' || ch === '\n') return finish();
        if (ch === '\u0003') return finish(Error('Cancelled'));
        if (ch === '\b' || ch === '\u007f') value = value.slice(0, -1);
        else if (ch >= ' ') value += ch;
      }
    }
    input.on('data', receive);
  });
}
async function totals(pool) {
  const [[r]] = await pool.query(`SELECT
    (SELECT stock_quantity FROM products WHERE product_id=1) AS stock,
    (SELECT COUNT(*) FROM orders) AS orders,
    (SELECT COUNT(*) FROM order_items) AS items,
    (SELECT COUNT(*) FROM order_events) AS events,
    (SELECT COUNT(*) FROM checkout_requests) AS requests,
    (SELECT COUNT(*) FROM auth_credentials) AS credentials,
    (SELECT COUNT(*) FROM auth_sessions) AS sessions`);
  return Object.fromEntries(Object.entries(r).map(([k,v]) => [k, Number(v)]));
}
function expectClean(s, context) {
  assert.equal(s.stock, 10, `${context}: stock must be 10`);
  for (const k of ['orders','items','events','requests','credentials','sessions']) {
    assert.equal(s[k], 0, `${context}: ${k} must be empty`);
  }
}
async function request(origin, method, route, {body, cookie, csrf, forgedOrigin} = {}) {
  const headers = {Origin:forgedOrigin || origin};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  if (csrf) headers['X-Coffee-CSRF'] = csrf;
  const response = await fetch(origin + route, {
    method,
    headers,
    body:body === undefined ? undefined : JSON.stringify(body),
    signal:AbortSignal.timeout(15000),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); }
  catch { throw Error(`Non-JSON response from ${method} ${route}: ${response.status}`); }
  return {status:response.status, data, setCookie:response.headers.get('set-cookie')};
}
function checkHttp(result, status, label) {
  assert.equal(result.status, status, `${label}: expected HTTP ${status}, got ${result.status}: ${result.data?.error ?? ''}`);
  return result.data;
}
function registrationFields(account) {
  const {created, id, ...body} = account;
  return body;
}
function testUser(email, firstName, lastName) {
  return {first_name:firstName, last_name:lastName, email,
    password:`TestOnly!${crypto.randomBytes(24).toString('base64url')}`,
    street:'1 Example Road',city:'Test City',state:'TX',zip_code:'78253'};
}
async function assertAllowedDatabase(pool) {
  const [[r]] = await pool.query('SELECT CURRENT_USER() AS account, DATABASE() AS db');
  assert.equal(r.db,DATABASE,'Unexpected database; no writes allowed');
  assert.equal(r.account.split('@')[0],USER,'Unexpected MySQL account; no writes allowed');
  const [rows] = await pool.execute('SELECT name,price,stock_quantity FROM products WHERE product_id=?',[PRODUCT_ID]);
  assert.equal(rows.length,1,'Fixture product missing');
  assert.equal(rows[0].name,PRODUCT_NAME,'Unexpected product; refusing to run');
  assert.equal(Number(rows[0].price),18,'Unexpected price; refusing to run');
  expectClean(await totals(pool),'Initial database');
}
/**
 * Remove only the two generated user accounts and up to one remaining fixture
 * order. Used between phases and again on completion/failure. Check every
 * global table first: never delete unrelated users, orders or history.
 */
async function cleanFixture(pool, fixture, {removeUsers=false} = {}) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[who]] = await conn.query('SELECT CURRENT_USER() AS account,DATABASE() AS db');
    assert.equal(who.db,DATABASE,'Cleanup refused wrong database');
    assert.equal(who.account.split('@')[0],USER,'Cleanup refused wrong database user');
    const [accounts] = await conn.execute(`SELECT u.id,u.email,c.role
      FROM users u JOIN auth_credentials c ON c.user_id=u.id
      WHERE u.email IN (?,?) FOR UPDATE`,[fixture.customer.email,fixture.admin.email]);
    const byEmail = new Map(accounts.map(r => [r.email,r]));
    for (const [kind,role] of [['customer','customer'],['admin','admin']]) {
      const actual = byEmail.get(fixture[kind].email);
      if (fixture[kind].created) {
        assert.ok(actual,`Cleanup refused: synthetic ${kind} account missing`);
        assert.equal(actual.id,fixture[kind].id,`Cleanup refused: synthetic ${kind} ID mismatch`);
        assert.equal(actual.role,role,`Cleanup refused: unexpected ${kind} role`);
      } else assert.equal(actual,undefined,`Cleanup refused: unexpected ${kind} record`);
    }
    const [orders] = await conn.query('SELECT order_id,user_id,status,total FROM orders FOR UPDATE');
    assert.ok(orders.length<=1,'Cleanup refused: unexpected number of orders');
    const [claims] = await conn.query('SELECT client_token,user_id,order_id FROM checkout_requests FOR UPDATE');
    assert.equal(claims.length,orders.length,'Cleanup refused: unmatched checkout requests');
    const [lines] = await conn.query('SELECT order_id,product_id,quantity FROM order_items');
    assert.equal(lines.length,orders.length,'Cleanup refused: unmatched line items');
    const [events] = await conn.query('SELECT order_id,actor_user_id,from_status,to_status FROM order_events');
    const [product] = await conn.execute('SELECT stock_quantity FROM products WHERE product_id=? FOR UPDATE',[PRODUCT_ID]);
    assert.equal(product.length,1,'Cleanup refused: fixture product missing');
    let restore = 0;
    if (orders.length) {
      const order = orders[0];
      assert.ok(fixture.customer.created,'Cleanup refused: no fixture customer');
      assert.equal(Number(order.user_id),fixture.customer.id,'Cleanup refused: foreign shopper order');
      assert.ok(Math.abs(Number(order.total)-TOTAL)<0.001,'Cleanup refused: unexpected order total');
      assert.ok(['placed','processing','fulfilled','cancelled'].includes(order.status),'Cleanup refused: unexpected status');
      assert.equal(Number(claims[0].order_id),Number(order.order_id),'Cleanup refused: checkout token mismatch');
      assert.equal(Number(claims[0].user_id),fixture.customer.id,'Cleanup refused: foreign checkout owner');
      assert.equal(Number(lines[0].order_id),Number(order.order_id),'Cleanup refused: other order line');
      assert.equal(Number(lines[0].product_id),PRODUCT_ID,'Cleanup refused: other product');
      assert.equal(Number(lines[0].quantity),1,'Cleanup refused: other quantity');
      for (const e of events) {
        assert.equal(Number(e.order_id),Number(order.order_id),'Cleanup refused: foreign order history');
        assert.ok(fixture.admin.created && Number(e.actor_user_id)===fixture.admin.id,'Cleanup refused: foreign history actor');
        assert.ok(['processing','fulfilled','cancelled'].includes(e.to_status),'Cleanup refused: unknown history event');
      }
      restore=order.status==='cancelled'?0:1;
    } else assert.equal(events.length,0,'Cleanup refused: stray order events');
    assert.equal(Number(product[0].stock_quantity),10-restore,'Cleanup refused: stock has unexpected value');
    if (orders.length) {
      const id=Number(orders[0].order_id);
      if (restore) {
        const [u]=await conn.execute('UPDATE products SET stock_quantity=stock_quantity+1 WHERE product_id=? AND stock_quantity=9',[PRODUCT_ID]);
        assert.equal(u.affectedRows,1,'Cleanup refused: stock restoration failed');
      }
      await conn.execute('DELETE FROM order_events WHERE order_id=?',[id]);
      const [di]=await conn.execute('DELETE FROM order_items WHERE order_id=?',[id]);
      assert.equal(di.affectedRows,1,'Cleanup refused: order line deletion failed');
      const [d]=await conn.execute('DELETE FROM orders WHERE order_id=? AND user_id=?',[id,fixture.customer.id]);
      assert.equal(d.affectedRows,1,'Cleanup refused: order deletion failed');
    }
    const [afterClaims]=await conn.query('SELECT client_token FROM checkout_requests LIMIT 1');
    assert.equal(afterClaims.length,0,'Cleanup refused: checkout request not cascaded');
    const [afterEvents]=await conn.query('SELECT id FROM order_events LIMIT 1');
    assert.equal(afterEvents.length,0,'Cleanup refused: order events remain');
    if (removeUsers) {
      for (const kind of ['customer','admin']) {
        const account=fixture[kind];
        if (!account.created) continue;
        const [del]=await conn.execute('DELETE FROM users WHERE id=? AND email=?',[account.id,account.email]);
        assert.equal(del.affectedRows,1,`Cleanup refused: ${kind} deletion failed`);
      }
      const [[status]]=await conn.query(`SELECT
        (SELECT COUNT(*) FROM auth_credentials) AS credentials,
        (SELECT COUNT(*) FROM auth_sessions) AS sessions`);
      assert.equal(Number(status.credentials),0,'Cleanup refused: auth credentials remain');
      assert.equal(Number(status.sessions),0,'Cleanup refused: auth sessions remain');
    }
    await conn.commit();
    if (removeUsers) {
      fixture.customer.created=false;
      fixture.admin.created=false;
    }
    return {removedOrder:orders.length===1,restored:restore};
  } catch (err) {
    try{await conn.rollback();}catch{}
    throw err;
  } finally {conn.release();}
}
async function run() {
  console.log('Coffee Overflow — protected admin HTTP order lifecycle (REAL MySQL; ISOLATED TEST ONLY)');
  console.log('Creates only synthetic accounts; never modifies server.js/.env or public routes; no payment.');
  const password=await hiddenPrompt('Restricted integration MySQL password (hidden): ');
  if(!password) throw Error('Password is required');
  const pool=mysql.createPool({host:HOST,port:3306,user:USER,password,database:DATABASE,waitForConnections:true,connectionLimit:5});
  let server=null;
  const fixture={
    customer:{...testUser(`co-browser-${crypto.randomBytes(6).toString('hex')}@example.test`,'Integration','Shopper'),created:false,id:null},
    admin:{...testUser(`co-admin-${crypto.randomBytes(6).toString('hex')}@example.test`,'Integration','Admin'),created:false,id:null},
  };
  try {
    await assertAllowedDatabase(pool);
    console.log('PASS: Restricted schema and empty test baseline verified (stock 10)');
    const auth=createAuthService(pool);
    const app=createLocalIntegratedApp({pool,origin:'http://127.0.0.1:5178'});
    server=await new Promise((resolve,reject)=>{
      const s=app.listen(5178,HOST,()=>resolve(s));s.once('error',reject);
    });
    const origin='http://127.0.0.1:5178';
    checkHttp(await request(origin,'GET','/api/admin/orders'),401,'Anonymous admin list');
    const registered=checkHttp(await request(origin,'POST','/api/auth/register',{body:registrationFields(fixture.customer)}),201,'Customer registration');
    assert.equal(registered.user.role,'customer');
    fixture.customer.id=Number(registered.user.id); fixture.customer.created=true;
    const customerLoginResponse=await request(origin,'POST','/api/auth/login',{
      body:{email:fixture.customer.email,password:fixture.customer.password}});
    const customerLogin=checkHttp(customerLoginResponse,200,'Customer login');
    // The cookie is sent on localhost only; never printed to terminal.
    assert.ok(customerLoginResponse.setCookie,'Customer login must set a session cookie');
    const customerCookie=customerLoginResponse.setCookie.split(';')[0];
    const customerCsrf=customerLogin.csrfToken;
    checkHttp(await request(origin,'GET','/api/admin/orders',{cookie:customerCookie}),403,'Customer admin list');
    checkHttp(await request(origin,'PATCH','/api/admin/orders/1/status',{
      cookie:customerCookie,csrf:customerCsrf,body:{status:'processing'}}),403,'Customer admin update');
    console.log('PASS: Anonymous and customer requests cannot access admin routes');

    // Admins are NEVER self-registered through HTTP. Only this local smoke
    // script provisions its OWN freshly generated, synthetic test user.
    const adminUser=await auth.register(registrationFields(fixture.admin));
    assert.equal(adminUser.role,'customer');
    fixture.admin.id=Number(adminUser.id);fixture.admin.created=true;
    const [promote]=await pool.execute(`UPDATE auth_credentials SET role='admin'
      WHERE user_id=? AND role='customer' AND is_active=1`,[fixture.admin.id]);
    assert.equal(promote.affectedRows,1,'Could not provision synthetic test administrator');
    const adminLoginResponse=await request(origin,'POST','/api/auth/login',{
      body:{email:fixture.admin.email,password:fixture.admin.password}});
    const adminLogin=checkHttp(adminLoginResponse,200,'Admin login');
    assert.equal(adminLogin.user.role,'admin','Admin role must come from verified server credentials');
    assert.ok(adminLoginResponse.setCookie,'Admin login must set a session cookie');
    const adminCookie=adminLoginResponse.setCookie.split(';')[0];
    const adminCsrf=adminLogin.csrfToken;
    checkHttp(await request(origin,'GET','/api/admin/orders',{cookie:adminCookie}),200,'Verified admin order list');
    console.log('PASS: Test-only administrator provisioned server-side and signed in');

    async function checkout() {
      const placed=await request(origin,'POST','/api/orders',{
        cookie:customerCookie,csrf:customerCsrf,
        body:{items:[{product_id:PRODUCT_ID,quantity:1}],client_token:crypto.randomUUID()},
      });
      const data=checkHttp(placed,201,'Authenticated checkout');
      assert.equal(data.order.total_cents,1949);
      assert.equal(data.order.replayed,false);
      assert.ok(Number.isSafeInteger(Number(data.order.order_id)));
      return Number(data.order.order_id);
    }
    async function status(orderId,next,{csrf=adminCsrf,forgedOrigin}={}) {
      return request(origin,'PATCH',`/api/admin/orders/${orderId}/status`,{
        body:{status:next,note:'Isolated admin HTTP smoke test'},cookie:adminCookie,csrf,forgedOrigin,
      });
    }
    // Phase A: cancellation must restore stock exactly once.
    const firstId=await checkout();
    checkHttp(await status(firstId,'processing',{csrf:null}),403,'Admin PATCH without CSRF');
    checkHttp(await status(firstId,'processing',{forgedOrigin:'http://untrusted.example'}),403,'Admin PATCH foreign origin');
    checkHttp(await status(firstId,'processing'),200,'Placed -> Processing');
    checkHttp(await status(firstId,'cancelled'),200,'Processing -> Cancelled');
    const repeat=checkHttp(await status(firstId,'cancelled'),200,'Repeated cancel');
    assert.equal(repeat.changed,false,'Repeated cancel must be a no-op');
    checkHttp(await status(firstId,'fulfilled'),409,'Cancelled cannot be fulfilled');
    const cancelled=checkHttp(await request(origin,'GET',`/api/admin/orders/${firstId}`,{cookie:adminCookie}),200,'Cancelled order receipt');
    assert.equal(cancelled.order.status,'cancelled');
    assert.equal(cancelled.order.events.filter(e=>e.to_status==='cancelled').length,1,'Cancellation event must be saved once');
    assert.equal((await totals(pool)).stock,10,'Cancellation must restore stock to 10');
    console.log('PASS: Protected Placed -> Processing -> Cancelled; history persisted; stock restored once');

    // The existing local preview correctly permits only ONE fixture order.
    // Remove only this verified cancelled test order before phase B.
    const middle=await cleanFixture(pool,fixture,{removeUsers:false});
    assert.equal(middle.restored,0,'Cancelled stock must not be restored twice');
    assert.equal((await totals(pool)).orders,0);

    // Phase B: fulfillment persists while inventory remains deducted.
    const secondId=await checkout();
    checkHttp(await status(secondId,'processing'),200,'Second order processing');
    checkHttp(await status(secondId,'fulfilled'),200,'Second order fulfillment');
    checkHttp(await status(secondId,'cancelled'),409,'Fulfilled cannot be cancelled');
    const fulfilled=checkHttp(await request(origin,'GET',`/api/admin/orders/${secondId}`,{cookie:adminCookie}),200,'Fulfilled order receipt');
    assert.equal(fulfilled.order.status,'fulfilled');
    assert.equal(fulfilled.order.events.filter(e=>e.to_status==='fulfilled').length,1);
    const stats=checkHttp(await request(origin,'GET','/api/admin/stats',{cookie:adminCookie}),200,'Admin dashboard statistics');
    assert.equal(stats.orders,1);assert.equal(stats.fulfilled,1);
    assert.equal((await totals(pool)).stock,9,'Fulfilled order must not restore inventory');
    console.log('PASS: Protected Placed -> Processing -> Fulfilled; stats and stock 9 verified');

    checkHttp(await request(origin,'POST','/api/auth/logout',{
      cookie:adminCookie,csrf:adminCsrf,body:{}}),200,'Admin logout');
    checkHttp(await request(origin,'GET','/api/admin/orders',{cookie:adminCookie}),401,'Revoked admin session');
    console.log('PASS: Admin logout revokes session; protected API returns 401');
    await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));server=null;
    await cleanFixture(pool,fixture,{removeUsers:true});
    expectClean(await totals(pool),'Final database');
    console.log('SUCCESS: Protected admin HTTP processing, cancellation, fulfillment and permissions verified; all synthetic records removed (stock 10).');
  } catch (e) {
    console.error('ADMIN HTTP TEST FAILED:',e.message);
    throw e;
  } finally {
    if (server) await new Promise(resolve=>server.close(()=>resolve()));
    if (fixture.customer.created || fixture.admin.created) {
      try {
        await cleanFixture(pool,fixture,{removeUsers:true});
        console.log('CLEANUP: Synthetic test data recovered after interruption.');
      } catch (e) {
        console.error('MANUAL REVIEW REQUIRED: Could not automatically verify/clean synthetic test data.');
        console.error('Database:',DATABASE,'Synthetic account emails:',fixture.customer.email,fixture.admin.email);
        console.error('Reason:',e.message,'Do not rerun or delete data blindly.');
        process.exitCode=1;
      }
    }
    await pool.end();
  }
}
run().catch(()=>{process.exitCode=1;});
