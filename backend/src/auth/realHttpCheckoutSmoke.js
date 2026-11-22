'use strict';
/**
 * Coffee Overflow — authenticated HTTP checkout, real MySQL, local smoke test.
 * Only binds 127.0.0.1 on an OS-assigned port. Never changes server.js/.env.
 * Operates exclusively on coffee_overflow_integration with restricted DB user.
 * Requires the integration DB fixture to start at stock 10, zero orders/events/
 * requests, and zero auth credentials/sessions. A temporary customer is created.
 * NO payment. No production authentication or admin route enabled.
 * Run from repository root: node backend/src/auth/realHttpCheckoutSmoke.js
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const mysql = require('mysql2/promise');
const {createAuthService} = require('./authService');
const {createAuthRouter} = require('./authRoutes');
const {createSessionGuards} = require('./sessionGuards');
const {createCheckoutRouter} = require('../checkout/checkoutRoutes');
const {createCheckoutService} = require('../checkout/checkoutService');
const {createSharedOrderStore} = require('../admin/sharedOrderStore');

const DATABASE = 'coffee_overflow_integration';
const DB_USER = 'coffee_overflow_integration_app';
const PRODUCT_ID = 1;
const PRODUCT_NAME = 'Checkout Integration Test Coffee';
const EXPECTED_TOTAL = 1949;

function hiddenPrompt(question) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    if (!input.isTTY || typeof input.setRawMode !== 'function') return reject(Error('Use an interactive Windows CMD or PowerShell terminal'));
    let value = '';
    const originalRaw = Boolean(input.isRaw);
    process.stdout.write(question);
    input.setRawMode(true); input.resume();
    const stop = err => {
      input.off('data', onData);
      input.setRawMode(originalRaw);
      process.stdout.write('\n');
      err ? reject(err) : resolve(value);
    };
    function onData(buf) {
      for (const ch of buf.toString('utf8')) {
        if (ch === '\r' || ch === '\n') return stop();
        if (ch === '\u0003') return stop(Error('Cancelled'));
        if (ch === '\b' || ch === '\u007f') value = value.slice(0, -1);
        else if (ch >= ' ') value += ch;
      }
    }
    input.on('data', onData);
  });
}

async function snapshot(pool) {
  const [[row]] = await pool.query(`SELECT
    (SELECT stock_quantity FROM products WHERE product_id=1) AS stock,
    (SELECT COUNT(*) FROM orders) AS orders,
    (SELECT COUNT(*) FROM order_items) AS items,
    (SELECT COUNT(*) FROM order_events) AS events,
    (SELECT COUNT(*) FROM checkout_requests) AS requests,
    (SELECT COUNT(*) FROM auth_credentials) AS credentials,
    (SELECT COUNT(*) FROM auth_sessions) AS sessions,
    (SELECT COUNT(*) FROM users) AS users`);
  return Object.fromEntries(Object.entries(row).map(([key, val]) => [key, val === null ? null : Number(val)]));
}
function expectBaseline(s) {
  assert.equal(s.stock, 10, 'Product #1 stock must start at 10');
  for (const field of ['orders','items','events','requests','credentials','sessions']) {
    assert.equal(s[field], 0, `Integration table ${field} is not empty; inspect it before testing`);
  }
}

async function request(origin, method, path, {body, cookie, csrf, json = true} = {}) {
  const headers = {Origin:origin};
  if (json) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  if (csrf) headers['X-Coffee-CSRF'] = csrf;
  const response = await fetch(origin + path, {
    method,
    headers,
    body:body === undefined ? undefined : JSON.stringify(body),
    signal:AbortSignal.timeout(15000),
  });
  let data;
  try { data = await response.json(); } catch { throw Error(`Non-JSON HTTP response (${response.status}) at ${path}`); }
  return {status:response.status, data, cookie:response.headers.get('set-cookie')};
}

async function cleanup(pool, fixture) {
  if (!Number.isSafeInteger(fixture.userId) || fixture.userId < 1 || !fixture.email) return;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [users] = await conn.execute('SELECT id,email FROM users WHERE id=? FOR UPDATE',[fixture.userId]);
    assert.equal(users.length, 1, 'Refusing cleanup: synthetic user not found');
    assert.equal(users[0].email, fixture.email, 'Refusing cleanup: unexpected user email');

    // Resolve the order through the private token in case an HTTP response was lost.
    const [claims] = await conn.execute('SELECT user_id,order_id FROM checkout_requests WHERE client_token=? FOR UPDATE',[fixture.token]);
    if (claims.length) {
      assert.equal(Number(claims[0].user_id), fixture.userId, 'Refusing cleanup: checkout token has a different shopper');
    }
    let orderId = claims.length && claims[0].order_id != null ? Number(claims[0].order_id) : null;
    if (fixture.orderId !== null && fixture.orderId !== undefined) {
      assert.equal(orderId, fixture.orderId, 'Refusing cleanup: order ID mismatch');
    }
    if (orderId !== null) {
      const [orders] = await conn.execute('SELECT order_id,user_id,status,total FROM orders WHERE order_id=? FOR UPDATE',[orderId]);
      assert.equal(orders.length,1,'Refusing cleanup: created order missing');
      assert.equal(Number(orders[0].user_id),fixture.userId,'Refusing cleanup: order belongs to another shopper');
      assert.equal(orders[0].status,'placed','Refusing cleanup: order status changed');
      assert.equal(Number(orders[0].total),19.49,'Refusing cleanup: unexpected order total');
      const [lines] = await conn.execute('SELECT product_id,quantity FROM order_items WHERE order_id=?',[orderId]);
      assert.equal(lines.length,1,'Refusing cleanup: expected one test line');
      assert.equal(Number(lines[0].product_id),PRODUCT_ID);
      assert.equal(Number(lines[0].quantity),1);
      const [events] = await conn.execute('SELECT id FROM order_events WHERE order_id=?',[orderId]);
      assert.equal(events.length,0,'Refusing cleanup: order has admin events');
      const [stock] = await conn.execute('UPDATE products SET stock_quantity=stock_quantity+1 WHERE product_id=? AND stock_quantity=9',[PRODUCT_ID]);
      assert.equal(stock.affectedRows,1,'Refusing cleanup: unexpected product stock');
      const [deletedLines] = await conn.execute('DELETE FROM order_items WHERE order_id=?',[orderId]);
      assert.equal(deletedLines.affectedRows,1);
      const [deletedOrder] = await conn.execute('DELETE FROM orders WHERE order_id=? AND user_id=?',[orderId,fixture.userId]);
      assert.equal(deletedOrder.affectedRows,1);
    }
    if (claims.length) {
      // Foreign key ON DELETE CASCADE may already have removed the request above.
      const [remaining] = await conn.execute('SELECT client_token FROM checkout_requests WHERE client_token=?',[fixture.token]);
      assert.equal(remaining.length,0,'Refusing cleanup: request record unexpectedly remained');
    }
    const [removedUser] = await conn.execute('DELETE FROM users WHERE id=? AND email=?',[fixture.userId,fixture.email]);
    assert.equal(removedUser.affectedRows,1,'Could not clean up synthetic user');
    await conn.commit();
    fixture.userId = null;
    fixture.orderId = null;
  } catch (err) {
    try { await conn.rollback(); } catch {}
    throw err;
  } finally {conn.release();}
}

async function run() {
  console.log('Coffee Overflow — authenticated HTTP checkout → shared admin adapter (REAL MySQL)');
  console.log('Isolated database only; temporary localhost Express instance; no .env, server.js changes or payment.');
  const password = await hiddenPrompt('Integration database password (hidden): ');
  if (!password) throw Error('Database password is required');
  const pool = mysql.createPool({host:'127.0.0.1',port:3306,user:DB_USER,password,database:DATABASE,
    waitForConnections:true,connectionLimit:4,queueLimit:0});
  let server;
  const fixture = {userId:null,orderId:null,email:null,token:crypto.randomUUID()};
  try {
    const [[who]] = await pool.query('SELECT CURRENT_USER() AS account, DATABASE() AS schema_name');
    assert.equal(who.schema_name,DATABASE,'Wrong database selected');
    assert.equal(who.account.split('@')[0],DB_USER,'Wrong database account');
    const [[product]] = await pool.execute('SELECT name,price,stock_quantity FROM products WHERE product_id=?',[PRODUCT_ID]);
    assert.ok(product,'Test product missing');
    assert.equal(product.name,PRODUCT_NAME,'Unexpected product in integration fixture');
    assert.equal(Number(product.price),18,'Unexpected test product price');
    const before=await snapshot(pool);
    expectBaseline(before);
    console.log('PASS: Restricted MySQL connection and clean fixture confirmed (stock 10)');

    const auth = createAuthService(pool);
    const guards = createSessionGuards({resolveVerifiedSession:req=>auth.resolveVerifiedSession(req)});
    const app = express();
    app.disable('x-powered-by');
    app.use(express.json({limit:'16kb'}));
    server = await new Promise((resolve,reject) => {
      const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));
      listener.once('error',reject);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    app.use('/api/auth',createAuthRouter({service:auth,allowedOrigin:origin,secureCookies:false}));
    app.use('/api/orders',createCheckoutRouter({
      service:createCheckoutService(pool,{requireIdempotencyToken:true}),
      identifyShopper:guards.identifyShopper,
    }));
    // This test-only route proves a customer cannot call an administrator guard.
    // It is NEVER mounted on the team's app, and this server is loopback-only.
    app.get('/_smoke/admin-only',guards.requireAdmin,(_req,res)=>res.json({ok:true}));
    const admin = createSharedOrderStore(pool);

    fixture.email = `co-http-fixture-${crypto.randomBytes(5).toString('hex')}@example.test`;
    const syntheticPassword=`TestOnly!${crypto.randomBytes(22).toString('base64url')}`;
    const basket={items:[{product_id:PRODUCT_ID,quantity:1}],client_token:fixture.token};
    const anonymous=await request(origin,'POST','/api/orders',{body:basket});
    assert.equal(anonymous.status,401,'Anonymous checkout must be rejected');
    const register=await request(origin,'POST','/api/auth/register',{body:{
      first_name:'Integration',last_name:'HTTP Test',email:fixture.email,password:syntheticPassword,
      street:'1 Example Road',city:'Test City',state:'TX',zip_code:'78253'
    }});
    assert.equal(register.status,201,`Registration failed (HTTP ${register.status}): ${register.data.error||''}`);
    fixture.userId = Number(register.data.user.id);
    assert.ok(Number.isSafeInteger(fixture.userId) && fixture.userId>0);
    assert.equal(register.data.user.role,'customer');
    const wrong=await request(origin,'POST','/api/auth/login',{body:{email:fixture.email,password:'DefinitelyWrong123!'}});
    assert.equal(wrong.status,401,'Wrong password must be rejected');
    const login=await request(origin,'POST','/api/auth/login',{body:{email:fixture.email,password:syntheticPassword}});
    assert.equal(login.status,200,`Login failed (HTTP ${login.status}): ${login.data.error||''}`);
    assert.match(login.cookie,/HttpOnly/);
    const cookie=login.cookie.split(';')[0];
    const csrf=login.data.csrfToken;
    assert.match(csrf,/^[A-Za-z0-9_-]{43}$/);
    console.log('PASS: HTTP registration, wrong-password rejection, login and session cookie');

    const session=await request(origin,'GET','/api/auth/session',{cookie,json:false});
    assert.equal(session.status,200);
    assert.equal(session.data.authenticated,true);
    assert.equal(session.data.user.role,'customer');
    assert.equal(session.data.user.id,fixture.userId);
    const adminDenied=await request(origin,'GET','/_smoke/admin-only',{cookie,json:false});
    assert.equal(adminDenied.status,403,'Customer must not have administrator access');
    const missingCsrf=await request(origin,'POST','/api/orders',{cookie,body:basket});
    assert.equal(missingCsrf.status,403,'Checkout without CSRF token must fail');
    console.log('PASS: Verified customer session; admin access and missing-CSRF checkout denied');

    const placed=await request(origin,'POST','/api/orders',{cookie,csrf,body:basket});
    assert.equal(placed.status,201,`Checkout failed (HTTP ${placed.status}): ${placed.data.error||''}`);
    const receipt=placed.data.order;
    fixture.orderId=Number(receipt.order_id);
    assert.ok(Number.isSafeInteger(fixture.orderId) && fixture.orderId>0);
    assert.equal(receipt.total_cents,EXPECTED_TOTAL);
    assert.equal(receipt.replayed,false);
    const replay=await request(origin,'POST','/api/orders',{cookie,csrf,body:basket});
    assert.equal(replay.status,201,'Identical retry must succeed');
    assert.equal(replay.data.order.order_id,fixture.orderId);
    assert.equal(replay.data.order.replayed,true);
    const changed=await request(origin,'POST','/api/orders',{cookie,csrf,
      body:{items:[{product_id:PRODUCT_ID,quantity:2}],client_token:fixture.token}});
    assert.equal(changed.status,409,'Changed cart with reused token must fail');
    const state=await snapshot(pool);
    assert.equal(state.stock,9,'Stock must decrease exactly once');
    assert.equal(state.orders,1,'Only one order should be stored');
    assert.equal(state.items,1,'Only one order item should exist');
    assert.equal(state.requests,1,'Only one checkout request should exist');
    console.log('PASS: HTTP order placed ($19.49), retry replayed, changed cart rejected, stock 10 → 9 once');

    const result=await admin.getOrder(fixture.orderId);
    assert.equal(result.user_id,fixture.userId);
    assert.equal(result.customer_email,fixture.email);
    assert.equal(result.status,'placed');
    assert.equal(result.total_cents,EXPECTED_TOTAL);
    assert.equal(result.items.length,1);
    assert.equal(result.items[0].product_name,PRODUCT_NAME);
    const stats=await admin.stats();
    assert.equal(stats.orders,1);
    assert.equal(stats.pending,1);
    assert.equal(stats.revenue_cents,EXPECTED_TOTAL);
    console.log('PASS: Shared admin adapter retrieves authenticated checkout, receipt and dashboard statistics');

    const badLogout=await request(origin,'POST','/api/auth/logout',{cookie});
    assert.equal(badLogout.status,403,'Logout must require CSRF token');
    const logout=await request(origin,'POST','/api/auth/logout',{cookie,csrf});
    assert.equal(logout.status,200,'Authenticated logout should succeed');
    const signedOut=await request(origin,'GET','/api/auth/session',{cookie,json:false});
    assert.equal(signedOut.data.authenticated,false);
    const afterLogout=await request(origin,'POST','/api/orders',{cookie,csrf,body:basket});
    assert.equal(afterLogout.status,401,'Revoked session must not place orders');
    console.log('PASS: CSRF-protected logout revokes session and blocks further checkout');

    await cleanup(pool,fixture);
    const after=await snapshot(pool);
    assert.deepEqual(after,before,'Cleanup did not restore the exact initial database counts');
    console.log('SUCCESS: Authenticated HTTP checkout → admin adapter verified; fixture fully cleaned (stock 10, 0 orders/requests/sessions).');
  } finally {
    if (server) await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
    if (fixture.userId !== null) {
      try { await cleanup(pool,fixture);console.log('RECOVERED: Temporary fixture removed after test failure'); }
      catch (e) { console.error(`MANUAL REVIEW REQUIRED: cleanup of synthetic user ${fixture.userId} failed: ${e.message}`); }
    }
    await pool.end();
  }
}
if (require.main === module) {
  run().catch(e=>{console.error('HTTP AUTH CHECKOUT SMOKE FAILED:',e.message);process.exitCode=1;});
}
module.exports={run};
