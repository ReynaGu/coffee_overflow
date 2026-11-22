'use strict';
/**
 * Coffee Overflow — controlled REAL MySQL shared-order adapter smoke test.
 * ONLY isolated coffee_overflow_integration, never backend/.env or coffee_overflow_dev.
 * The admin actor and shopper identities below are test fixtures passed DIRECTLY to
 * backend services; this script does not mount HTTP routes or bypass website login.
 * Requires the isolated test fixture product #1, $18.00, 10 in stock, zero orders.
 * Creates one order, tests admin transitions/stock/history, then deletes only that
 * generated order and restores the original fixture state. AUTO_INCREMENT advances.
 * Run: node backend/src/admin/sharedOrderRealMysqlSmoke.js
 */
const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');
const { createCheckoutService } = require('../checkout/checkoutService');
const { createSharedOrderStore } = require('./sharedOrderStore');

const DATABASE = 'coffee_overflow_integration';
const USER = 'coffee_overflow_integration_app';
const PRODUCT_ID = 1;
const PRODUCT_NAME = 'Checkout Integration Test Coffee';
const TEST_SHOPPER = { id: 1 };
// This is NOT a verified real administrator — direct test-harness fixture only.
const TEST_ADMIN = { id: 1, role: 'admin' };

function askHiddenPassword(prompt) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    if (!input.isTTY || typeof input.setRawMode !== 'function') {
      return reject(new Error('Run in an interactive Windows CMD/PowerShell window.'));
    }
    const wasRaw = Boolean(input.isRaw);
    let password = '';
    process.stdout.write(prompt);
    input.setRawMode(true);
    input.resume();
    function finish() {
      input.off('data', handle);
      input.setRawMode(wasRaw);
      process.stdout.write('\n');
    }
    function handle(chunk) {
      for (const c of chunk.toString('utf8')) {
        if (c === '\r' || c === '\n') { finish(); resolve(password); return; }
        if (c === '\u0003') { finish(); reject(new Error('Cancelled')); return; }
        if (c === '\b' || c === '\u007f') password = password.slice(0, -1);
        else if (c >= ' ') password += c;
      }
    }
    input.on('data', handle);
  });
}

async function snapshot(pool) {
  const [[product]] = await pool.execute(
    'SELECT product_id, name, price, stock_quantity FROM products WHERE product_id=?',
    [PRODUCT_ID]
  );
  const [[orders]] = await pool.execute('SELECT COUNT(*) AS n FROM orders');
  const [[items]] = await pool.execute('SELECT COUNT(*) AS n FROM order_items');
  const [[events]] = await pool.execute('SELECT COUNT(*) AS n FROM order_events');
  return {
    product,
    orders: Number(orders.n),
    items: Number(items.n),
    events: Number(events.n),
  };
}

async function cleanupOwnOrder(pool, id) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[order]] = await conn.execute(
      'SELECT order_id, user_id, status, total FROM orders WHERE order_id=? FOR UPDATE',
      [id]
    );
    if (!order || Number(order.user_id) !== TEST_SHOPPER.id || String(order.total) !== '19.49') {
      throw new Error(`Refusing to clean up order #${id}: unexpected order identity or total`);
    }
    if (!['placed', 'processing', 'cancelled'].includes(order.status)) {
      throw new Error(`Refusing to clean up order #${id}: unexpected status ${order.status}`);
    }
    const [lines] = await conn.execute(
      'SELECT product_id, quantity, unit_price FROM order_items WHERE order_id=?', [id]
    );
    if (lines.length !== 1 || Number(lines[0].product_id) !== PRODUCT_ID ||
        Number(lines[0].quantity) !== 1 || String(lines[0].unit_price) !== '18.00') {
      throw new Error(`Refusing to clean up order #${id}: unexpected items`);
    }
    // Cancelled orders have already been restocked by the admin adapter.
    // Non-cancelled orders still have one unit deducted, so restore it ONCE.
    if (order.status !== 'cancelled') {
      const [r] = await conn.execute(
        'UPDATE products SET stock_quantity=stock_quantity+1 WHERE product_id=?',
        [PRODUCT_ID]
      );
      if (r.affectedRows !== 1) throw new Error('Cannot restore test product during cleanup');
    }
    await conn.execute('DELETE FROM order_events WHERE order_id=?', [id]);
    const [removedLines] = await conn.execute('DELETE FROM order_items WHERE order_id=?', [id]);
    if (removedLines.affectedRows !== 1) throw new Error('Expected one test order item');
    const [removedOrder] = await conn.execute(
      'DELETE FROM orders WHERE order_id=? AND user_id=?', [id, TEST_SHOPPER.id]
    );
    if (removedOrder.affectedRows !== 1) throw new Error('Expected one test order');
    await conn.commit();
  } catch (e) {
    try { await conn.rollback(); } catch { /* report original error */ }
    throw e;
  } finally {
    conn.release();
  }
}

async function main() {
  console.log('Coffee Overflow — shared-order adapter REAL MySQL test');
  console.log('Isolated integration database ONLY; no website admin/login route changes.');
  const password = await askHiddenPassword(`Password for ${USER} (hidden): `);
  if (!password) throw new Error('No password entered');
  const pool = mysql.createPool({
    host: '127.0.0.1', port: 3306, user: USER, password,
    database: DATABASE, connectionLimit: 2, waitForConnections: true,
  });
  let createdOrderId = null;
  try {
    const [[identity]] = await pool.execute('SELECT CURRENT_USER() AS account, DATABASE() AS db');
    assert.equal(identity.db, DATABASE, 'Wrong schema — refusing to run');
    assert.equal(identity.account.split('@')[0], USER, 'Wrong MySQL account — refusing to run');
    const before = await snapshot(pool);
    assert.ok(before.product, 'Fixture product #1 not found');
    assert.equal(before.product.name, PRODUCT_NAME, 'Unexpected product #1 — refusing to run');
    assert.equal(String(before.product.price), '18.00', 'Product price should be $18');
    assert.equal(Number(before.product.stock_quantity), 10, 'Expected 10 stock before testing');
    assert.deepEqual([before.orders, before.items, before.events], [0, 0, 0],
      'Expected empty integration orders/items/events; investigate before rerunning');
    console.log('PASS: Restricted connection and fixture preflight (10 stock, empty orders)');

    const admin = createSharedOrderStore(pool);
    const empty = await admin.listOrders();
    assert.equal(empty.count, 0);
    const emptyStats = await admin.stats();
    assert.equal(emptyStats.orders, 0);
    assert.equal(emptyStats.revenue_cents, 0);
    console.log('PASS: Shared adapter lists empty database and computes zero order revenue');

    // Direct service call with a synthetic shopper. The real HTTP route remains 401.
    const receipt = await createCheckoutService(pool).placeOrder(TEST_SHOPPER,
      { items: [{ product_id: PRODUCT_ID, quantity: 1 }] });
    createdOrderId = receipt.order_id;
    assert.ok(Number.isSafeInteger(createdOrderId) && createdOrderId > 0);
    assert.equal(receipt.total_cents, 1949);
    let snap = await snapshot(pool);
    assert.deepEqual([snap.orders, snap.items, snap.events], [1, 1, 0]);
    assert.equal(Number(snap.product.stock_quantity), 9);
    console.log(`PASS: Jalen checkout saved order #${createdOrderId}, 10 → 9 stock`);

    const listed = await admin.listOrders({ status: 'placed' });
    assert.equal(listed.count, 1);
    assert.equal(listed.orders[0].id, createdOrderId);
    assert.equal(listed.orders[0].total_cents, 1949);
    const details = await admin.getOrder(createdOrderId);
    assert.equal(details.status, 'placed');
    assert.equal(details.items.length, 1);
    assert.equal(details.items[0].product_name, PRODUCT_NAME);
    assert.equal(details.items[0].unit_price_cents, 1800);
    assert.equal(details.items[0].line_total_cents, 1800);
    assert.ok(details.events.some(e => e.to_status === 'placed'));
    let stats = await admin.stats();
    assert.equal(stats.orders, 1);
    assert.equal(stats.pending, 1);
    assert.equal(stats.revenue_cents, 1949);
    console.log('PASS: Hudson adapter reads Jalen order, receipt, initial history and overview stats');

    const processed = await admin.updateStatus(createdOrderId,
      { status: 'processing', note: 'Real MySQL integration smoke test' }, TEST_ADMIN);
    assert.equal(processed.status, 'processing');
    assert.equal((await admin.getOrder(createdOrderId)).status, 'processing');
    snap = await snapshot(pool);
    assert.equal(snap.events, 1);
    assert.equal(Number(snap.product.stock_quantity), 9);
    console.log('PASS: Processing status persisted and event recorded, no inventory change');

    const cancelled = await admin.updateStatus(createdOrderId,
      { status: 'cancelled', note: 'Integration test — restore inventory' }, TEST_ADMIN);
    assert.equal(cancelled.status, 'cancelled');
    const after = await admin.getOrder(createdOrderId);
    assert.equal(after.status, 'cancelled');
    assert.ok(after.events.some(e => e.to_status === 'cancelled'));
    snap = await snapshot(pool);
    assert.equal(snap.events, 2);
    assert.equal(Number(snap.product.stock_quantity), 10);
    stats = await admin.stats();
    assert.equal(stats.pending, 0);
    assert.equal(stats.revenue_cents, 0);
    await assert.rejects(admin.updateStatus(createdOrderId,
      { status: 'fulfilled' }, TEST_ADMIN), e => e.status === 409);
    assert.equal(Number((await snapshot(pool)).product.stock_quantity), 10);
    console.log('PASS: Cancellation persisted, history recorded, stock restored exactly once');

    await cleanupOwnOrder(pool, createdOrderId);
    createdOrderId = null;
    snap = await snapshot(pool);
    assert.equal(Number(snap.product.stock_quantity), 10);
    assert.deepEqual([snap.orders, snap.items, snap.events], [0, 0, 0]);
    console.log('PASS: Test records removed, stock restored to 10');
    console.log('SUCCESS: REAL MySQL shared checkout → admin order lifecycle verified.');
  } finally {
    if (createdOrderId !== null) {
      try {
        await cleanupOwnOrder(pool, createdOrderId);
        console.log('Emergency cleanup completed for test order #' + createdOrderId);
      } catch (e) {
        console.error('MANUAL CLEANUP MAY BE REQUIRED for order #' + createdOrderId + ': ' + e.message);
      }
    }
    await pool.end();
  }
}

main().catch(e => { console.error('TEST FAILED:', e.message); process.exitCode = 1; });
