'use strict';
/**
 * Coffee Overflow — integration-only order adapter for Reyna's shared schema.
 * 
 * This module is NOT mounted in server.js and MUST NOT be exposed without real
 * server-side admin authentication and authorization. It does not change the
 * original local_dev_* system or Reyna's committed SQL dump.
 *
 * Requires coffee_overflow_integration tables with:
 * orders(order_id, user_id, order_date, subtotal, tax, total, status),
 * order_items(order_id, product_id, quantity, unit_price),
 * products(product_id, name, stock_quantity),
 * users(id, first_name, last_name, email),
 * order_events(id, order_id, actor_user_id, from_status, to_status, note, created_at).
 * Status and events are provisional additions to the integration database.
 */
const { transitionResult } = require('./orderRules');
const { toCents } = require('../checkout/pricing');

const SORT = Object.freeze({
  'date-desc': 'o.order_date DESC',
  'date-asc': 'o.order_date ASC',
  'customer-asc': 'customer_name ASC',
  'customer-desc': 'customer_name DESC',
  'total-desc': 'o.total DESC',
  'total-asc': 'o.total ASC',
});
const STATUSES = new Set(['all', 'active', 'placed', 'processing', 'fulfilled', 'cancelled']);
const ORDER_FIELDS = `o.order_id AS id, o.user_id, o.order_date AS created_at, o.status,
  o.subtotal, o.tax, o.total,
  COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), CONCAT('User #', o.user_id)) AS customer_name,
  COALESCE(u.email, '') AS customer_email`;

function error(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
function orderId(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw error(400, 'Invalid order ID');
  return n;
}
function decimalCents(value, label) {
  const n = toCents(value);
  if (n === null || n < 0) throw new Error(`Invalid ${label} stored in shared database`);
  return n;
}
function normalizeOrder(row) {
  return {
    id: Number(row.id), user_id: Number(row.user_id),
    customer_name: row.customer_name, customer_email: row.customer_email,
    created_at: row.created_at, status: row.status,
    subtotal_cents: decimalCents(row.subtotal, 'subtotal'),
    discount_cents: 0, // not modeled in Reyna's shared orders table yet
    tax_cents: decimalCents(row.tax, 'tax'),
    total_cents: decimalCents(row.total, 'total'),
    coupon_code: null,
  };
}
function createSharedOrderStore(pool) {
  if (!pool || typeof pool.getConnection !== 'function' || typeof pool.execute !== 'function') {
    throw new Error('A mysql2 connection pool is required');
  }
  const query = async (sql, params = []) => (await pool.execute(sql, params))[0];

  async function listOrders({ sort = 'date-desc', status = 'all', search = '' } = {}) {
    if (!Object.hasOwn(SORT, sort) || !STATUSES.has(status)) throw error(400, 'Invalid order filter');
    if (typeof search !== 'string' || search.length > 100) throw error(400, 'Search must be 100 characters or fewer');
    const where = [], params = [];
    if (status === 'active') where.push("o.status IN ('placed','processing')");
    else if (status !== 'all') { where.push('o.status = ?'); params.push(status); }
    if (search.trim()) {
      const term = `%${search.trim()}%`;
      where.push(`(CAST(o.order_id AS CHAR) LIKE ? OR
        CONCAT_WS(' ', u.first_name, u.last_name) LIKE ? OR u.email LIKE ?)`);
      params.push(term, term, term);
    }
    const sql = `SELECT ${ORDER_FIELDS} FROM orders o LEFT JOIN users u ON u.id = o.user_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY ${SORT[sort]}, o.order_id DESC LIMIT 200`;
    const rows = await query(sql, params);
    const orders = rows.map(normalizeOrder);
    return { orders, count: orders.length };
  }

  async function getOrder(id) {
    const validId = orderId(id);
    const [row] = await query(`SELECT ${ORDER_FIELDS} FROM orders o
      LEFT JOIN users u ON u.id = o.user_id WHERE o.order_id = ?`, [validId]);
    if (!row) throw error(404, 'Order not found');
    const order = normalizeOrder(row);
    const items = await query(`SELECT oi.product_id, oi.quantity, oi.unit_price,
      COALESCE(p.name, CONCAT('Product #', oi.product_id)) AS product_name
      FROM order_items oi LEFT JOIN products p ON p.product_id = oi.product_id
      WHERE oi.order_id = ? ORDER BY oi.product_id`, [validId]);
    order.items = items.map(line => {
      const unit = decimalCents(line.unit_price, 'unit price');
      const qty = Number(line.quantity);
      if (!Number.isSafeInteger(qty) || qty < 1 || !Number.isSafeInteger(qty * unit)) {
        throw new Error('Invalid order line stored in shared database');
      }
      return {
        product_id: Number(line.product_id), product_name: line.product_name,
        quantity: qty, unit_price_cents: unit, line_total_cents: unit * qty,
      };
    });
    const events = await query(`SELECT e.from_status, e.to_status, e.note, e.created_at,
      COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), 'Admin') AS actor_name
      FROM order_events e LEFT JOIN users u ON u.id = e.actor_user_id
      WHERE e.order_id = ? ORDER BY e.id DESC`, [validId]);
    // Jalen's checkout currently creates the order row but no placed event.
    // Show a clearly synthetic entry until event creation is agreed with the team.
    if (!events.some(e => e.to_status === 'placed')) {
      events.push({ from_status: null, to_status: 'placed', actor_name: 'Checkout',
        note: 'Order created (display-only initial event)', created_at: order.created_at });
    }
    order.events = events;
    return order;
  }

  async function stats() {
    const [row] = await query(`SELECT COUNT(*) AS orders,
      COALESCE(SUM(CASE WHEN status IN ('placed','processing') THEN 1 ELSE 0 END),0) AS pending,
      COALESCE(SUM(CASE WHEN status='fulfilled' THEN 1 ELSE 0 END),0) AS fulfilled,
      COALESCE(SUM(CASE WHEN status<>'cancelled' THEN total ELSE 0 END),0) AS revenue
      FROM orders`);
    const [stock] = await query('SELECT COUNT(*) AS low_stock FROM products WHERE stock_quantity < 10');
    return {
      orders: Number(row.orders), pending: Number(row.pending), fulfilled: Number(row.fulfilled),
      revenue_cents: decimalCents(row.revenue, 'order revenue'), low_stock: Number(stock.low_stock),
    };
  }

  async function updateStatus(id, body = {}, actor) {
    // Defense in depth. The HTTP admin router must ALSO use real requireAdmin middleware.
    if (!actor || actor.role !== 'admin' || !Number.isSafeInteger(Number(actor.id)) || Number(actor.id) < 1) {
      throw error(403, 'A verified administrator account is required');
    }
    const validId = orderId(id);
    const next = String(body.status || '');
    const note = String(body.note || '').trim();
    if (note.length > 250) throw error(400, 'Note must be 250 characters or fewer');
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.execute('SELECT order_id, status FROM orders WHERE order_id = ? FOR UPDATE', [validId]);
      if (!rows.length) throw error(404, 'Order not found');
      const previous = rows[0].status;
      const transition = transitionResult(previous, next);
      if (!transition.allowed) throw error(409, 'That order status transition is not allowed');
      if (!transition.changed) {
        await conn.commit();
        return { ok: true, changed: false, status: previous };
      }
      if (transition.restoreInventory) {
        const [lines] = await conn.execute(
          'SELECT product_id, quantity FROM order_items WHERE order_id = ? ORDER BY product_id', [validId]);
        for (const line of lines) {
          const [result] = await conn.execute(
            'UPDATE products SET stock_quantity = stock_quantity + ? WHERE product_id = ?',
            [line.quantity, line.product_id]);
          if (result.affectedRows !== 1) throw error(409, 'Cannot restore a missing product');
        }
      }
      const [updated] = await conn.execute('UPDATE orders SET status = ? WHERE order_id = ?', [next, validId]);
      if (updated.affectedRows !== 1) throw error(409, 'Order changed during update');
      await conn.execute(`INSERT INTO order_events
        (order_id, actor_user_id, from_status, to_status, note)
        VALUES (?, ?, ?, ?, ?)`, [validId, Number(actor.id), previous, next, note]);
      await conn.commit();
      return { ok: true, changed: true, status: next };
    } catch (e) {
      try { await conn.rollback(); } catch { /* preserve original failure */ }
      throw e;
    } finally { conn.release(); }
  }

  return { listOrders, getOrder, stats, updateStatus };
}
module.exports = { createSharedOrderStore, SORT, STATUSES, normalizeOrder };
