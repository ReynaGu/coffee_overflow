'use strict';
/* Database-free tests for the Reyna-schema order adapter. No network, no MySQL writes. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSharedOrderStore } = require('./sharedOrderStore');
const ADMIN = { id: 12, role: 'admin' };
const DATE = '2026-11-21T09:00:00.000Z';
const orderRow = (status = 'placed') => ({
  id: 2, user_id: 1, created_at: DATE, status,
  subtotal: '18.00', tax: '1.49', total: '19.49',
  customer_name: 'Test Shopper', customer_email: 'shopper@example.test',
});
function fakePool(opts = {}) {
  let data = {
    orders: [{ ...orderRow(opts.status || 'placed') }],
    product: { id: 1, stock: 9 },
    items: [{ product_id: 1, quantity: 1, unit_price: '18.00', product_name: 'Checkout Integration Test Coffee' }],
    events: [],
  };
  const metrics = { sql: [], begun: 0, committed: 0, rolledBack: 0 };
  function run(db, sql, args) {
    metrics.sql.push({ sql, args });
    if (sql.startsWith('SELECT COUNT(*) AS orders')) {
      return [[{ orders: db.orders.length, pending: db.orders.filter(o => ['placed','processing'].includes(o.status)).length,
        fulfilled: db.orders.filter(o => o.status === 'fulfilled').length,
        revenue: db.orders.filter(o => o.status !== 'cancelled').reduce((s,o)=>s+Number(o.total),0).toFixed(2) }]];
    }
    if (sql.startsWith('SELECT COUNT(*) AS low_stock')) return [[{ low_stock: db.product.stock < 10 ? 1 : 0 }]];
    if (sql.startsWith('SELECT o.order_id AS id')) {
      if (sql.includes('WHERE o.order_id = ?')) return [[db.orders.find(o => o.id === args[0])].filter(Boolean)];
      let list = db.orders;
      if (sql.includes('o.status = ?')) list = list.filter(o => o.status === args[0]);
      return [list];
    }
    if (sql.startsWith('SELECT oi.product_id')) return [db.items];
    if (sql.startsWith('SELECT e.from_status')) return [db.events.map(e => ({...e, actor_name:'Admin'})).reverse()];
    if (sql.startsWith('SELECT order_id, status FROM orders')) return [db.orders.filter(o => o.id === args[0]).map(o => ({ order_id:o.id,status:o.status }))];
    if (sql.startsWith('SELECT product_id, quantity FROM order_items')) return [db.items.map(({ product_id, quantity }) => ({ product_id, quantity }))];
    if (sql.startsWith('UPDATE products SET stock_quantity')) {
      if (opts.missingProduct) return [{ affectedRows:0 }];
      db.product.stock += args[0];
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('UPDATE orders SET status')) {
      const row = db.orders.find(o => o.id === args[1]);
      if (!row) return [{ affectedRows:0 }];
      row.status = args[0];
      return [{ affectedRows:1 }];
    }
    if (sql.startsWith('INSERT INTO order_events')) {
      if (opts.failEvent) throw new Error('Injected audit write failure');
      db.events.push({ from_status:args[2],to_status:args[3],note:args[4],created_at:DATE });
      return [{ affectedRows:1 }];
    }
    throw new Error('Unrecognized test SQL: ' + sql);
  }
  const pool = {
    async execute(sql, args = []) { return run(data, sql, args); },
    async getConnection() {
      let txn = null;
      return {
        async beginTransaction() { metrics.begun += 1; txn = structuredClone(data); },
        async execute(sql, args = []) { if (!txn) throw Error('Missing transaction');return run(txn, sql, args); },
        async commit() { data = txn; txn = null; metrics.committed += 1; },
        async rollback() { txn = null; metrics.rolledBack += 1; },
        release() {},
      };
    },
  };
  return { pool, metrics, state: () => data };
}

test('reads shared Reyna order columns as existing admin dashboard fields', async () => {
  const f = fakePool();const store = createSharedOrderStore(f.pool);
  const result = await store.listOrders({ sort:'date-desc' });
  assert.equal(result.count,1);
  assert.deepEqual(result.orders.map(({id,total_cents,subtotal_cents,tax_cents,discount_cents,status})=>({id,total_cents,subtotal_cents,tax_cents,discount_cents,status})),
    [{id:2,total_cents:1949,subtotal_cents:1800,tax_cents:149,discount_cents:0,status:'placed'}]);
  assert.ok(f.metrics.sql[0].sql.includes('LEFT JOIN users'));
});

test('lists by status and uses bound search query parameters', async () => {
  const f=fakePool();const store=createSharedOrderStore(f.pool);
  assert.equal((await store.listOrders({status:'placed',search:'Test'})).count,1);
  assert.deepEqual(f.metrics.sql[0].args,['placed','%Test%','%Test%','%Test%']);
  assert.ok(f.metrics.sql[0].sql.includes('o.status = ?'));
  await store.listOrders({status:'active',sort:'customer-desc'});
  assert.ok(f.metrics.sql.at(-1).sql.includes("o.status IN ('placed','processing')"));
});

test('invalid filters and IDs are rejected before database access', async () => {
  const f=fakePool();const store=createSharedOrderStore(f.pool);
  await assert.rejects(store.listOrders({sort:'drop table'}),e=>e.status===400);
  await assert.rejects(store.listOrders({status:'unknown'}),e=>e.status===400);
  await assert.rejects(store.listOrders({search:'x'.repeat(101)}),e=>e.status===400);
  await assert.rejects(store.getOrder(-2),e=>e.status===400);
  await assert.rejects(store.getOrder(100),e=>e.status===404);
  assert.equal(f.metrics.sql.length,1); // only the valid 404 lookup reached SQL
});

test('receipt preserves stored unit-price snapshot and adds labelled display-only placed event', async () => {
  const f=fakePool();const result=await createSharedOrderStore(f.pool).getOrder(2);
  assert.equal(result.total_cents,1949);
  assert.deepEqual(result.items.map(x=>({name:x.product_name,price:x.unit_price_cents,total:x.line_total_cents})),
    [{name:'Checkout Integration Test Coffee',price:1800,total:1800}]);
  assert.equal(result.events.length,1);
  assert.equal(result.events[0].to_status,'placed');
  assert.match(result.events[0].note,/display-only/);
  assert.equal(f.state().events.length,0); // synthetic is not a DB insert
});

test('stats show pending, non-cancelled revenue in cents and low-stock products', async () => {
  const f=fakePool();const result=await createSharedOrderStore(f.pool).stats();
  assert.deepEqual(result,{orders:1,pending:1,fulfilled:0,revenue_cents:1949,low_stock:1});
});

test('requires verified admin role for write operations before transaction', async () => {
  const f=fakePool();const store=createSharedOrderStore(f.pool);
  await assert.rejects(store.updateStatus(2,{status:'cancelled'},null),e=>e.status===403);
  await assert.rejects(store.updateStatus(2,{status:'cancelled'},{id:12,role:'shopper'}),e=>e.status===403);
  assert.equal(f.metrics.begun,0);
});

test('process then cancel restores stock once and records two audit events', async () => {
  const f=fakePool();const store=createSharedOrderStore(f.pool);
  assert.deepEqual(await store.updateStatus(2,{status:'processing',note:'Packaging'},ADMIN),{ok:true,changed:true,status:'processing'});
  assert.equal(f.state().product.stock,9);
  assert.deepEqual(await store.updateStatus(2,{status:'cancelled',note:'Cancelled test order'},ADMIN),{ok:true,changed:true,status:'cancelled'});
  assert.equal(f.state().product.stock,10);
  assert.deepEqual(f.state().events.map(x=>x.to_status),['processing','cancelled']);
  await assert.rejects(store.updateStatus(2,{status:'processing'},ADMIN),e=>e.status===409);
  assert.equal(f.state().product.stock,10);
});

test('retries of same status do not create events or restore inventory', async () => {
  const f=fakePool();const store=createSharedOrderStore(f.pool);
  assert.deepEqual(await store.updateStatus(2,{status:'placed'},ADMIN),{ok:true,changed:false,status:'placed'});
  assert.equal(f.state().product.stock,9);
  assert.equal(f.state().events.length,0);
});

test('failed inventory restore rolls back order status update', async () => {
  const f=fakePool({missingProduct:true});const store=createSharedOrderStore(f.pool);
  await assert.rejects(store.updateStatus(2,{status:'cancelled'},ADMIN),e=>e.status===409);
  assert.equal(f.state().orders[0].status,'placed');
  assert.equal(f.state().product.stock,9);
  assert.equal(f.metrics.rolledBack,1);
});

test('failed event insert rolls back order status and inventory restore', async () => {
  const f=fakePool({failEvent:true});const store=createSharedOrderStore(f.pool);
  await assert.rejects(store.updateStatus(2,{status:'cancelled'},ADMIN),/Injected audit write failure/);
  assert.equal(f.state().orders[0].status,'placed');
  assert.equal(f.state().product.stock,9);
  assert.equal(f.state().events.length,0);
  assert.equal(f.metrics.rolledBack,1);
});

test('fulfilled orders cannot be cancelled', async () => {
  const f=fakePool({status:'fulfilled'});const store=createSharedOrderStore(f.pool);
  await assert.rejects(store.updateStatus(2,{status:'cancelled'},ADMIN),e=>e.status===409);
  assert.equal(f.state().product.stock,9);
});
