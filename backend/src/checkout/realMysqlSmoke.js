'use strict';
/*
 * Coffee Overflow - REAL MySQL checkout smoke test, isolated developer database only.
 *
 * Run from the repository root:
 *   node backend/src/checkout/realMysqlSmoke.js
 *
 * It never uses backend/.env. It connects ONLY to coffee_overflow_integration as the
 * restricted coffee_overflow_integration_app user and prompts for a hidden password.
 * It invokes Jalen's checkout service directly with a synthetic test shopper; this
 * does NOT change or bypass the HTTP route's shopper authentication middleware.
 *
 * Writes during testing are automatically reversed at the end. The server's
 * AUTO_INCREMENT sequence may advance, even when the test cleans up its row.
 * If the process is killed after checkout succeeds, manual cleanup may be needed.
 */
const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');
const { createCheckoutService } = require('./checkoutService');

const DB_NAME = 'coffee_overflow_integration';
const DB_USER = 'coffee_overflow_integration_app';
const TEST_PRODUCT_ID = 1;
const TEST_PRODUCT_NAME = 'Checkout Integration Test Coffee';
const TEST_SHOPPER_ID = 1; // synthetic fixture, NOT an authenticated website account

function hiddenPassword(question) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    if (!input.isTTY || typeof input.setRawMode !== 'function') {
      reject(new Error('Run this script in an interactive Windows CMD or PowerShell window.'));
      return;
    }
    const previous = Boolean(input.isRaw);
    let password = '';
    process.stdout.write(question);
    input.setRawMode(true);
    input.resume();
    function cleanup() {
      input.off('data', onData);
      input.setRawMode(previous);
      process.stdout.write('\n');
    }
    function onData(chunk) {
      for (const char of chunk.toString('utf8')) {
        if (char === '\r' || char === '\n') {
          cleanup();
          resolve(password);
          return;
        }
        if (char === '\u0003') {
          cleanup();
          reject(new Error('Cancelled by user.'));
          return;
        }
        if (char === '\b' || char === '\u007f') {
          password = password.slice(0, -1);
        } else if (char >= ' ') {
          password += char;
        }
      }
    }
    input.on('data', onData);
  });
}

async function snapshot(pool) {
  const [[product]] = await pool.execute(
    'SELECT product_id, name, price, stock_quantity FROM products WHERE product_id = ?',
    [TEST_PRODUCT_ID]
  );
  const [[orders]] = await pool.execute('SELECT COUNT(*) AS n FROM orders');
  const [[items]] = await pool.execute('SELECT COUNT(*) AS n FROM order_items');
  return {
    product,
    orders: Number(orders.n),
    items: Number(items.n),
  };
}

async function cleanupTestOrder(pool, id) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[row]] = await conn.execute(
      'SELECT order_id, user_id FROM orders WHERE order_id = ? FOR UPDATE', [id]
    );
    if (!row || Number(row.user_id) !== TEST_SHOPPER_ID) {
      throw new Error('Refusing cleanup: test order is missing or its shopper does not match.');
    }
    const [lines] = await conn.execute(
      'SELECT product_id, quantity FROM order_items WHERE order_id = ?', [id]
    );
    if (lines.length !== 1 || Number(lines[0].product_id) !== TEST_PRODUCT_ID || Number(lines[0].quantity) !== 1) {
      throw new Error('Refusing cleanup: test order items do not match expected product and quantity.');
    }
    await conn.execute('DELETE FROM order_items WHERE order_id = ?', [id]);
    const [deleted] = await conn.execute('DELETE FROM orders WHERE order_id = ? AND user_id = ?', [id, TEST_SHOPPER_ID]);
    if (deleted.affectedRows !== 1) throw new Error('Expected exactly one test order to be deleted.');
    const [restocked] = await conn.execute(
      'UPDATE products SET stock_quantity = stock_quantity + 1 WHERE product_id = ?', [TEST_PRODUCT_ID]
    );
    if (restocked.affectedRows !== 1) throw new Error('Expected one product to be restocked.');
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function main() {
  console.log('Coffee Overflow - REAL MySQL checkout test (isolated integration database)');
  console.log('This does not modify backend/.env, coffee_overflow_dev, or the website login route.');
  const password = await hiddenPassword(`Enter password for ${DB_USER} (hidden): `);
  if (!password) throw new Error('No password entered.');
  const pool = mysql.createPool({
    host: '127.0.0.1', port: 3306, user: DB_USER, password,
    database: DB_NAME, connectionLimit: 2, waitForConnections: true
  });
  let createdOrderId = null;
  try {
    const [[who]] = await pool.query('SELECT CURRENT_USER() AS account, DATABASE() AS schema_name');
    assert.equal(who.schema_name, DB_NAME, 'Refusing to use unexpected database');
    assert.equal(who.account.split('@')[0], DB_USER, 'Refusing to use unexpected account');
    console.log(`PASS: Restricted MySQL connection: ${who.account}, ${who.schema_name}`);

    const [[column]] = await pool.execute(
      "SELECT EXTRA AS extra FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME='orders' AND COLUMN_NAME='order_id'",
      [DB_NAME]
    );
    assert.ok(column && String(column.extra).includes('auto_increment'), 'orders.order_id requires AUTO_INCREMENT');

    const before = await snapshot(pool);
    assert.ok(before.product, 'Test product #1 was not found');
    assert.equal(before.product.name, TEST_PRODUCT_NAME, 'Refusing to modify an unexpected product');
    assert.equal(String(before.product.price), '18.00', 'Expected $18.00 test product');
    assert.equal(Number(before.product.stock_quantity), 10, 'Expected 10 units; stop to inspect data');
    console.log(`PASS: Safe test product found, stock=${before.product.stock_quantity}, orders=${before.orders}`);

    const service = createCheckoutService(pool);
    const shopper = { id: TEST_SHOPPER_ID };
    const request = { items: [{ product_id: TEST_PRODUCT_ID, quantity: 1 }] };

    await assert.rejects(
      service.placeOrder(shopper, { items: [{ product_id: TEST_PRODUCT_ID, quantity: 20 }] }),
      e => e.status === 409
    );
    let check = await snapshot(pool);
    assert.equal(Number(check.product.stock_quantity), 10);
    assert.equal(check.orders, before.orders);
    assert.equal(check.items, before.items);
    console.log('PASS: Insufficient stock -> 409; real MySQL stock and orders unchanged');

    let injected = false;
    const faultPool = {
      getConnection: async () => {
        const conn = await pool.getConnection();
        return {
          beginTransaction: () => conn.beginTransaction(),
          execute: (sql, params) => {
            if (sql.startsWith('INSERT INTO `order_items`')) {
              injected = true;
              throw new Error('EXPECTED_TEST_FAULT: simulated order_items insert failure');
            }
            return conn.execute(sql, params);
          },
          commit: () => conn.commit(),
          rollback: () => conn.rollback(),
          release: () => conn.release()
        };
      }
    };
    await assert.rejects(
      createCheckoutService(faultPool).placeOrder(shopper, request),
      /EXPECTED_TEST_FAULT/
    );
    assert.ok(injected, 'Fault was not injected');
    check = await snapshot(pool);
    assert.equal(Number(check.product.stock_quantity), 10, 'Fault rollback did not restore stock');
    assert.equal(check.orders, before.orders, 'Fault rollback left an order');
    assert.equal(check.items, before.items, 'Fault rollback left an order item');
    console.log('PASS: Injected order_items failure -> real MySQL transaction rolled back');

    const receipt = await service.placeOrder(shopper, request);
    createdOrderId = receipt.order_id;
    assert.ok(Number.isSafeInteger(createdOrderId) && createdOrderId >= 1);
    assert.equal(receipt.subtotal_cents, 1800);
    assert.equal(receipt.tax_cents, 149);
    assert.equal(receipt.total_cents, 1949);
    check = await snapshot(pool);
    assert.equal(check.orders, before.orders + 1);
    assert.equal(check.items, before.items + 1);
    assert.equal(Number(check.product.stock_quantity), 9);
    const [[saved]] = await pool.execute(
      'SELECT user_id, subtotal, tax, total FROM orders WHERE order_id = ?', [createdOrderId]
    );
    assert.equal(Number(saved.user_id), TEST_SHOPPER_ID);
    assert.equal(String(saved.subtotal), '18.00');
    assert.equal(String(saved.tax), '1.49');
    assert.equal(String(saved.total), '19.49');
    console.log(`PASS: Real committed order #${createdOrderId}, total $19.49, stock 10 -> 9`);

    await cleanupTestOrder(pool, createdOrderId);
    createdOrderId = null;
    check = await snapshot(pool);
    assert.equal(check.orders, before.orders);
    assert.equal(check.items, before.items);
    assert.equal(Number(check.product.stock_quantity), 10);
    console.log('PASS: Test order removed, stock restored to 10; original data preserved');
    console.log('SUCCESS: Real MySQL checkout transaction and rollback checks passed.');
  } finally {
    if (createdOrderId !== null) {
      try {
        await cleanupTestOrder(pool, createdOrderId);
        console.log(`Cleanup completed for test order #${createdOrderId}.`);
      } catch (e) {
        console.error(`MANUAL CLEANUP MAY BE REQUIRED: Test order #${createdOrderId}. ${e.message}`);
      }
    }
    await pool.end();
  }
}

main().catch(e => {
  console.error('TEST FAILED:', e.message);
  process.exitCode = 1;
});
