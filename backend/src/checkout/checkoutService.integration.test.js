'use strict';
/*
 * Coffee Overflow — Jalen checkout service isolated transaction tests.
 * No real database connection, data changes, user accounts or payment processing.
 * Run from repository root:
 *   node --test backend/src/checkout/checkoutService.integration.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCheckoutService } = require('./checkoutService');

const TEST_DATE = new Date('2026-11-20T12:00:00.000Z');
const request = (items = [{ product_id: 1, quantity: 1 }]) => ({ items });
const shopper = { id: 7 };

function fakeMySql(options = {}) {
  let state = {
    products: [
      { id: 1, name: 'Sunrise House Blend', price: '18.00', stock: 5 },
      { id: 2, name: 'Reserve Blend', price: '24.00', stock: 2 },
    ],
    salePrices: { 1: options.noSale ? null : '14.00', 2: null },
    orders: [],
    orderItems: [],
    nextId: 1,
  };
  const metrics = { begun: 0, committed: 0, rolledBack: 0, queries: [] };

  function run(db, sql, params) {
    metrics.queries.push({ sql, params: structuredClone(params || []) });
    // Jalen's SQL is built by checkoutSchema.js. Match by query shape rather than
    // hard-coding the exact identifier formatting or aliases.
    if (sql.startsWith('SELECT ') && sql.includes(' FOR UPDATE')) {
      const p = db.products.find(p => p.id === params[0]);
      return [p ? [{ id: p.id, name: p.name, price: p.price, stock: p.stock }] : []];
    }
    if (sql.startsWith('SELECT MIN(')) {
      return [[{ sale_price: db.salePrices[params[0]] ?? null }]];
    }
    if (sql.startsWith('INSERT INTO ') && sql.includes('`orders`')) {
      if (options.missingAutoIncrement) return [{ insertId: 0, affectedRows: 1 }];
      const id = db.nextId++;
      db.orders.push({ id, userId: params[0], date: params[1], subtotal: params[2], tax: params[3], total: params[4] });
      return [{ insertId: id, affectedRows: 1 }];
    }
    if (sql.startsWith('UPDATE ') && sql.includes('SET ') && sql.includes(' - ?')) {
      const p = db.products.find(p => p.id === params[1] && p.stock >= params[2]);
      if (!p) return [{ affectedRows: 0 }];
      p.stock -= params[0];
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('INSERT INTO ') && sql.includes('`order_items`')) {
      if (options.failItemInsert) throw Error('Simulated order_items insert failure');
      db.orderItems.push({ orderId: params[0], productId: params[1], quantity: params[2], unitPrice: params[3] });
      return [{ affectedRows: 1 }];
    }
    throw Error('Unexpected checkout SQL in mock: ' + sql);
  }

  const pool = {
    async getConnection() {
      let transaction = null;
      return {
        async beginTransaction() { transaction = structuredClone(state); metrics.begun += 1; },
        async execute(sql, params = []) {
          if (!transaction) throw Error('SQL executed outside of transaction');
          return run(transaction, sql, params);
        },
        async commit() { state = transaction; transaction = null; metrics.committed += 1; },
        async rollback() { transaction = null; metrics.rolledBack += 1; },
        release() {},
      };
    },
  };
  return { pool, state: () => state, metrics };
}

function service(fake) {
  return createCheckoutService(fake.pool, { now: () => TEST_DATE });
}

test('successful checkout: server prices, sale price, tax, receipt and inventory', async () => {
  const f = fakeMySql();
  const result = await service(f).placeOrder(shopper, {
    ...request([{ product_id: 1, quantity: 2 }]),
    subtotal_cents: 1, total_cents: 1, user_id: 999, // must not be trusted
  });
  assert.equal(result.order_id, 1);
  assert.equal(result.order_date, TEST_DATE.toISOString());
  assert.equal(result.subtotal_cents, 2800);
  assert.equal(result.tax_cents, 231);
  assert.equal(result.total_cents, 3031);
  assert.equal(result.items[0].unit_price_cents, 1400);
  assert.equal(result.items[0].regular_price_cents, 1800);
  assert.equal(result.items[0].on_sale, true);
  assert.equal(f.state().orders[0].userId, shopper.id);
  assert.equal(f.state().orders[0].total, '30.31');
  assert.equal(f.state().orderItems[0].unitPrice, '14.00');
  assert.equal(f.state().products[0].stock, 3);
  assert.equal(f.metrics.begun, 1);
  assert.equal(f.metrics.committed, 1);
  assert.equal(f.metrics.rolledBack, 0);
});

test('no shopper identity: 401 and no database transaction', async () => {
  const f = fakeMySql();
  await assert.rejects(service(f).placeOrder(null, request()), e => e.status === 401);
  assert.equal(f.metrics.begun, 0);
  assert.equal(f.state().orders.length, 0);
});

test('excessive quantity: 400 before any database transaction', async () => {
  const f = fakeMySql();
  await assert.rejects(service(f).placeOrder(shopper, request([{ product_id: 1, quantity: 21 }])), e => e.status === 400);
  assert.equal(f.metrics.begun, 0);
});

test('insufficient stock: rollback and no order or stock change', async () => {
  const f = fakeMySql();
  await assert.rejects(service(f).placeOrder(shopper, request([{ product_id: 1, quantity: 6 }])), e => e.status === 409);
  assert.equal(f.state().products[0].stock, 5);
  assert.equal(f.state().orders.length, 0);
  assert.equal(f.metrics.committed, 0);
  assert.equal(f.metrics.rolledBack, 1);
});

test('second product out of stock: no partial order and no stock deduction', async () => {
  const f = fakeMySql();
  await assert.rejects(service(f).placeOrder(shopper, request([
    { product_id: 1, quantity: 1 }, { product_id: 2, quantity: 3 },
  ])), e => e.status === 409);
  assert.deepEqual(f.state().products.map(x => x.stock), [5, 2]);
  assert.equal(f.state().orders.length, 0);
  assert.equal(f.metrics.rolledBack, 1);
});

test('order_items insert failure: rollback even after stock was decremented inside transaction', async () => {
  const f = fakeMySql({ failItemInsert: true });
  await assert.rejects(service(f).placeOrder(shopper, request()), /Simulated order_items insert failure/);
  assert.equal(f.state().products[0].stock, 5);
  assert.equal(f.state().orders.length, 0);
  assert.equal(f.state().orderItems.length, 0);
  assert.equal(f.metrics.committed, 0);
  assert.equal(f.metrics.rolledBack, 1);
});

test('shared orders table without AUTO_INCREMENT: rollback with explanatory error', async () => {
  const f = fakeMySql({ missingAutoIncrement: true });
  await assert.rejects(service(f).placeOrder(shopper, request()), /AUTO_INCREMENT/);
  assert.equal(f.state().orders.length, 0);
  assert.equal(f.state().products[0].stock, 5);
  assert.equal(f.metrics.rolledBack, 1);
});

test('discount code is rejected until shared discount rules are implemented', async () => {
  const f = fakeMySql();
  await assert.rejects(service(f).placeOrder(shopper, { ...request(), discount_code: 'COFFEE10' }), e => e.status === 409);
  assert.equal(f.metrics.begun, 0);
});
