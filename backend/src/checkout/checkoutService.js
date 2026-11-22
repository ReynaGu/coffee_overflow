'use strict';
/*
 * Coffee Overflow - server-side checkout (Jalen, cart).
 *
 * What this does, in ONE database transaction:
 *   1. Locks each ordered product row (SELECT ... FOR UPDATE) so two shoppers can't buy the last unit.
 *   2. Re-prices every line from the database (regular price or lowest sale_items price).
 *      Prices, totals or tax sent by the browser are IGNORED - only product ids + quantities are read.
 *   3. Calculates subtotal and 8.25% tax on the server.
 *   4. Inserts the orders row, then for each line decrements stock (guarded by stock >= qty)
 *      and inserts an order_items row with the unit price snapshot.
 *   5. Commits. Any failure rolls everything back, so stock is never decremented without an order.
 *
 * NOT handled here (owned by other team members): shopper login/authentication, discount codes,
 * order status, payment. No payment is collected or processed.
 */
const { SCHEMA } = require('./checkoutSchema');
const { toDecimal, unitPriceCents, orderTotals } = require('./pricing');

const MAX_LINES = 20;
const MAX_QTY_PER_LINE = 20;

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function positiveInt(value) {
  const n = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/*
 * Accepts: { items: [{ product_id, quantity }], discount_code? }
 * Any other fields (price, total, user_id, ...) are ignored on purpose.
 */
function validateOrderRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw httpError(400, 'Invalid order request');
  if (body.discount_code !== undefined && body.discount_code !== null && String(body.discount_code).trim() !== '') {
    // TODO(DISCOUNTS): shared schema has no agreed discount type or an orders.discount column yet.
    throw httpError(409, 'Discount codes are not available at checkout yet. Remove the code and try again.');
  }
  if (!Array.isArray(body.items) || body.items.length < 1) throw httpError(400, 'Your cart is empty');
  if (body.items.length > MAX_LINES) throw httpError(400, `An order can contain at most ${MAX_LINES} different products`);

  const seen = new Set();
  const items = body.items.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw httpError(400, 'Invalid cart line');
    const productId = positiveInt(raw.product_id);
    const quantity = positiveInt(raw.quantity);
    if (!productId) throw httpError(400, 'Invalid product id');
    if (!quantity || quantity > MAX_QTY_PER_LINE) throw httpError(400, `Quantity must be between 1 and ${MAX_QTY_PER_LINE}`);
    if (seen.has(productId)) throw httpError(400, 'Each product may appear only once in an order');
    seen.add(productId);
    return { productId, quantity };
  });
  // Always lock rows in the same order to avoid deadlocks between concurrent checkouts.
  items.sort((a, b) => a.productId - b.productId);
  return { items };
}

function buildSql(s = SCHEMA) {
  const p = s.products, si = s.saleItems, o = s.orders, oi = s.orderItems;
  return {
    lockProduct:
      `SELECT \`${p.id}\` AS id, \`${p.name}\` AS name, \`${p.price}\` AS price, \`${p.stock}\` AS stock ` +
      `FROM \`${p.table}\` WHERE \`${p.id}\` = ? FOR UPDATE`,
    salePrice:
      `SELECT MIN(\`${si.salePrice}\`) AS sale_price FROM \`${si.table}\` ` +
      `WHERE \`${si.productId}\` = ? AND \`${si.salePrice}\` > 0`,
    insertOrder:
      `INSERT INTO \`${o.table}\` (\`${o.userId}\`, \`${o.date}\`, \`${o.subtotal}\`, \`${o.tax}\`, \`${o.total}\`) ` +
      `VALUES (?, ?, ?, ?, ?)`,
    decrementStock:
      `UPDATE \`${p.table}\` SET \`${p.stock}\` = \`${p.stock}\` - ? ` +
      `WHERE \`${p.id}\` = ? AND \`${p.stock}\` >= ?`,
    insertItem:
      `INSERT INTO \`${oi.table}\` (\`${oi.orderId}\`, \`${oi.productId}\`, \`${oi.quantity}\`, \`${oi.unitPrice}\`) ` +
      `VALUES (?, ?, ?, ?)`
  };
}

function createCheckoutService(pool, { now = () => new Date() } = {}) {
  if (!pool || typeof pool.getConnection !== 'function') throw new Error('Shared mysql2 pool required');
  const SQL = buildSql();

  async function placeOrder(shopper, body) {
    const userId = positiveInt(shopper && shopper.id);
    if (!userId) throw httpError(401, 'Please log in to place an order');
    const { items } = validateOrderRequest(body);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // 1 + 2: lock and re-price every line from the database.
      const lines = [];
      for (const item of items) {
        const [rows] = await conn.execute(SQL.lockProduct, [item.productId]);
        const product = rows[0];
        if (!product) throw httpError(409, `Product ${item.productId} is no longer available`);
        const stock = Number(product.stock);
        if (!Number.isSafeInteger(stock) || stock < item.quantity) {
          throw httpError(409, `Only ${Math.max(0, stock || 0)} of "${product.name}" left in stock`);
        }
        const [saleRows] = await conn.execute(SQL.salePrice, [item.productId]);
        const price = unitPriceCents(product.price, saleRows[0] ? saleRows[0].sale_price : null);
        lines.push({
          productId: item.productId,
          name: String(product.name),
          quantity: item.quantity,
          unitCents: price.unitCents,
          regularCents: price.regularCents,
          onSale: price.onSale
        });
      }

      // 3: server-side totals.
      const totals = orderTotals(lines);
      const orderDate = now();

      // 4: write order, then lines + stock.
      const [orderResult] = await conn.execute(SQL.insertOrder, [
        userId, orderDate, toDecimal(totals.subtotalCents), toDecimal(totals.taxCents), toDecimal(totals.totalCents)
      ]);
      const orderId = orderResult && orderResult.insertId;
      if (!Number.isSafeInteger(orderId) || orderId < 1) {
        // Happens while orders.order_id has no AUTO_INCREMENT (see checkoutSchema.js).
        throw new Error('orders insert did not return an order id - is orders.order_id AUTO_INCREMENT?');
      }

      for (const line of lines) {
        const [stockResult] = await conn.execute(SQL.decrementStock, [line.quantity, line.productId, line.quantity]);
        if (!stockResult || stockResult.affectedRows !== 1) {
          throw httpError(409, `"${line.name}" sold out while you were checking out`);
        }
        await conn.execute(SQL.insertItem, [orderId, line.productId, line.quantity, toDecimal(line.unitCents)]);
      }

      await conn.commit();

      // 5: receipt for the confirmation page (cents, so the cart can format it).
      return {
        order_id: orderId,
        order_date: orderDate.toISOString(),
        items: lines.map((l) => ({
          product_id: l.productId,
          name: l.name,
          quantity: l.quantity,
          unit_price_cents: l.unitCents,
          regular_price_cents: l.regularCents,
          on_sale: l.onSale,
          line_total_cents: l.unitCents * l.quantity
        })),
        subtotal_cents: totals.subtotalCents,
        tax_cents: totals.taxCents,
        total_cents: totals.totalCents
      };
    } catch (error) {
      try { await conn.rollback(); } catch { /* keep original error */ }
      throw error;
    } finally {
      conn.release();
    }
  }

  return { placeOrder };
}

module.exports = { createCheckoutService, validateOrderRequest, buildSql, MAX_LINES, MAX_QTY_PER_LINE };
