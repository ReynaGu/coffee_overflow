'use strict';
/**
 * Coffee Overflow — one local shared-MySQL checkout preview fixture.
 * Uses Jalen's checkout service directly, not the HTTP route. This is NOT shopper login.
 * Reads and writes ONLY coffee_overflow_integration via its restricted MySQL account.
 * create: one synthetic test user, one checkout order; leaves them for UI inspection.
 * cleanup: removes ONLY the verified fixture and restores its single unit of stock.
 * No .env, browser auth, production tables, or persistent passwords.
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');
const {createCheckoutService} = require('../checkout/checkoutService');

const DB_NAME = 'coffee_overflow_integration';
const DB_USER = 'coffee_overflow_integration_app';
const PRODUCT_ID = 1;
const PRODUCT_NAME = 'Checkout Integration Test Coffee';
const USER_ID = 900001; // fixed, reserved for this local test fixture only
const FIRST = 'Integration';
const LAST = 'Preview';
const EMAIL = 'integration-preview-fixture@example.test';
const PRICE = '18.00';
const TOTAL = '19.49';
const BEFORE_STOCK = 10;
const AFTER_STOCK = 9;

function hiddenPassword(message) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    if (!input.isTTY || typeof input.setRawMode !== 'function') {
      return reject(Error('Run in an interactive Windows Command Prompt or PowerShell window.'));
    }
    let secret = '';
    const originalRaw = Boolean(input.isRaw);
    process.stdout.write(message);
    input.setRawMode(true); input.resume();
    function done(error) {
      input.off('data', onData);
      input.setRawMode(originalRaw);
      process.stdout.write('\n');
      if (error) reject(error); else resolve(secret);
    }
    function onData(chunk) {
      for (const char of chunk.toString('utf8')) {
        if (char === '\r' || char === '\n') return done();
        if (char === '\u0003') return done(Error('Cancelled by user'));
        if (char === '\b' || char === '\u007f') secret = secret.slice(0, -1);
        else if (char >= ' ') secret += char;
      }
    }
    input.on('data', onData);
  });
}
async function assertConnection(pool) {
  const [[who]] = await pool.query('SELECT CURRENT_USER() AS account, DATABASE() AS schema_name');
  assert.equal(who.schema_name, DB_NAME, 'Refusing unexpected MySQL database');
  assert.equal(who.account.split('@')[0], DB_USER, 'Refusing unexpected MySQL account');
  console.log('PASS: Restricted connection verified to ' + who.schema_name);
}
async function snapshot(pool) {
  const [[product]] = await pool.execute('SELECT product_id, name, price, stock_quantity FROM products WHERE product_id = ?', [PRODUCT_ID]);
  const [[orders]] = await pool.execute('SELECT COUNT(*) AS n FROM orders');
  const [[items]] = await pool.execute('SELECT COUNT(*) AS n FROM order_items');
  const [[events]] = await pool.execute('SELECT COUNT(*) AS n FROM order_events');
  const [[user]] = await pool.execute('SELECT COUNT(*) AS n FROM users WHERE id = ?', [USER_ID]);
  return {product, orders:Number(orders.n), items:Number(items.n), events:Number(events.n), user:Number(user.n)};
}
function assertProduct(product, stock) {
  assert.ok(product, 'Expected integration test product #1 is missing');
  assert.equal(product.name, PRODUCT_NAME, 'Refusing unexpected product');
  assert.equal(String(product.price), PRICE, 'Refusing unexpected product price');
  assert.equal(Number(product.stock_quantity), stock, 'Stock differs from expected; stop and inspect the database');
}
async function createFixture(pool) {
  const before = await snapshot(pool);
  assertProduct(before.product, BEFORE_STOCK);
  assert.equal(before.orders, 0, 'Expected zero orders before creating fixture');
  assert.equal(before.items, 0, 'Expected zero order items before creating fixture');
  assert.equal(before.events, 0, 'Expected zero events before creating fixture');
  assert.equal(before.user, 0, 'Fixture user already exists; run cleanup only after verifying it');
  // Unusable random value; this synthetic record is not an account with a known password.
  const unusableSecret = crypto.randomBytes(24).toString('hex');
  await pool.execute(`INSERT INTO users
      (id, first_name, last_name, password, email, street, city, state, zip_code)
      VALUES (?, ?, ?, ?, ?, 'N/A', 'N/A', 'TX', 0)`,
      [USER_ID, FIRST, LAST, unusableSecret, EMAIL]);
  console.log('PASS: Synthetic preview customer created (not an authenticated account)');
  // DO NOT mount this as a web endpoint; the actual POST /api/orders still requires shopper auth.
  let receipt;
  try {
    receipt = await createCheckoutService(pool).placeOrder({id:USER_ID}, {
      items:[{product_id:PRODUCT_ID, quantity:1}]
    });
  } catch (e) {
    console.error('Checkout failed; the synthetic user may remain. Use the cleanup command.');
    throw e;
  }
  assert.equal(receipt.subtotal_cents, 1800);
  assert.equal(receipt.total_cents, 1949);
  const after = await snapshot(pool);
  assertProduct(after.product, AFTER_STOCK);
  assert.equal(after.orders, 1);
  assert.equal(after.items, 1);
  console.log(`PASS: Jalen checkout created order #${receipt.order_id}, total $${TOTAL}`);
  console.log(`PASS: Real MySQL stock ${BEFORE_STOCK} -> ${AFTER_STOCK}`);
  console.log('READY: Refresh your read-only dashboard at http://127.0.0.1:5176/admin/shared-orders-preview.html');
  console.log(`EXPECTED: 1 order, 1 active order, $${TOTAL} order value, 1 low-stock product.`);
  console.log('IMPORTANT: After inspecting the dashboard, run: node backend/src/admin/sharedPreviewOrderFixture.js cleanup');
}
async function cleanupFixture(pool) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[user]] = await conn.execute('SELECT id, first_name, last_name, email FROM users WHERE id = ? FOR UPDATE', [USER_ID]);
    if (!user || user.first_name !== FIRST || user.last_name !== LAST || user.email !== EMAIL) {
      throw Error('Refusing cleanup: expected exact synthetic fixture customer');
    }
    const [orders] = await conn.execute('SELECT order_id, status, subtotal, tax, total FROM orders WHERE user_id = ? FOR UPDATE', [USER_ID]);
    if (orders.length > 1) throw Error('Refusing cleanup: more than one fixture customer order');
    if (orders.length === 1) {
      const o = orders[0];
      assert.equal(o.status, 'placed', 'Refusing cleanup: order status was modified');
      assert.equal(String(o.subtotal), PRICE);
      assert.equal(String(o.tax), '1.49');
      assert.equal(String(o.total), TOTAL);
      const [lines] = await conn.execute('SELECT product_id, quantity, unit_price FROM order_items WHERE order_id = ? FOR UPDATE', [o.order_id]);
      if (lines.length !== 1 || Number(lines[0].product_id) !== PRODUCT_ID || Number(lines[0].quantity) !== 1 || String(lines[0].unit_price) !== PRICE) {
        throw Error('Refusing cleanup: unexpected order items');
      }
      const [[eventCount]] = await conn.execute('SELECT COUNT(*) AS n FROM order_events WHERE order_id = ?', [o.order_id]);
      if (Number(eventCount.n) !== 0) throw Error('Refusing cleanup: order has recorded status events');
      const [[p]] = await conn.execute('SELECT product_id, name, price, stock_quantity FROM products WHERE product_id = ? FOR UPDATE', [PRODUCT_ID]);
      assertProduct(p, AFTER_STOCK);
      const [deletedItems] = await conn.execute('DELETE FROM order_items WHERE order_id = ?', [o.order_id]);
      assert.equal(deletedItems.affectedRows, 1);
      const [deletedOrder] = await conn.execute('DELETE FROM orders WHERE order_id = ? AND user_id = ?', [o.order_id, USER_ID]);
      assert.equal(deletedOrder.affectedRows, 1);
      const [restored] = await conn.execute('UPDATE products SET stock_quantity = stock_quantity + 1 WHERE product_id = ?', [PRODUCT_ID]);
      assert.equal(restored.affectedRows, 1);
      console.log(`PASS: Verified test order #${o.order_id} removed; stock restored`);
    } else {
      console.log('NOTICE: No order for synthetic customer; cleaning up orphan fixture user only');
    }
    const [deletedUser] = await conn.execute('DELETE FROM users WHERE id = ? AND email = ?', [USER_ID, EMAIL]);
    assert.equal(deletedUser.affectedRows, 1);
    await conn.commit();
  } catch(e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  const after=await snapshot(pool);
  assertProduct(after.product, BEFORE_STOCK);
  assert.equal(after.orders, 0);
  assert.equal(after.items, 0);
  assert.equal(after.events, 0);
  assert.equal(after.user, 0);
  console.log('SUCCESS: Fixture removed. Stock 10, zero orders/items/events; original data preserved.');
}
async function main() {
  const command = process.argv[2];
  if (command === '--help' || command === '-h') {
    console.log('Usage: node backend/src/admin/sharedPreviewOrderFixture.js create|cleanup');
    return;
  }
  if (command !== 'create' && command !== 'cleanup') {
    throw Error('Specify exactly one command: create or cleanup');
  }
  console.log('Coffee Overflow — isolated shared-order dashboard fixture ('+command+')');
  console.log('ONLY coffee_overflow_integration; no .env changes, no website endpoints, no payment.');
  const password = await hiddenPassword(`Enter password for ${DB_USER} (hidden): `);
  if (!password) throw Error('Empty password');
  const pool = mysql.createPool({host:'127.0.0.1',port:3306,user:DB_USER,password,
    database:DB_NAME,connectionLimit:2,waitForConnections:true});
  try {
    await assertConnection(pool);
    if (command === 'create') await createFixture(pool);
    else await cleanupFixture(pool);
  } finally {
    await pool.end();
  }
}
if (require.main === module) main().catch(e=>{console.error('FAILED:',e.message);process.exitCode=1;});
module.exports = {assertProduct};
