'use strict';
/**
 * Shared checkout retry protection. Used only when the checkout service enables
 * requireIdempotencyToken. All SQL executes on the SAME transaction connection as
 * the order, stock updates and order_items writes.
 * Schema: docs/sql/SHARED_CHECKOUT_IDEMPOTENCY_V1.sql
 */
const crypto = require('node:crypto');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function fail(status, message) { const error = new Error(message); error.status = status; return error; }
function validateCheckoutToken(value) {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw fail(400, 'A valid checkout request token is required');
  }
  return value.toLowerCase();
}
function cartHash(userId, items) {
  // Only normalized product IDs and quantities are included. Never trust browser prices.
  const normalized = items.map(x => ({product_id:Number(x.productId),quantity:Number(x.quantity)}))
    .sort((a,b) => a.product_id-b.product_id);
  return crypto.createHash('sha256').update(JSON.stringify({user_id:Number(userId),items:normalized})).digest('hex');
}
function decodeReceipt(raw, storedId) {
  let value = raw;
  if (Buffer.isBuffer(value)) value = value.toString('utf8');
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { throw fail(500, 'Saved checkout receipt is invalid'); }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !Number.isSafeInteger(Number(storedId)) || Number(value.order_id) !== Number(storedId)) {
    throw fail(500, 'Saved checkout receipt does not match its order');
  }
  return value;
}
async function claimCheckoutRequest(conn, {token, userId, items}) {
  const requestHash = cartHash(userId, items);
  // Atomically serialize concurrent requests with the same token. A competing
  // INSERT waits for the first transaction to commit or roll back.
  await conn.execute(`INSERT INTO checkout_requests
    (client_token, user_id, request_hash, order_id, receipt_json)
    VALUES (?, ?, ?, NULL, NULL)
    ON DUPLICATE KEY UPDATE client_token = client_token`, [token, userId, requestHash]);
  const [rows] = await conn.execute(`SELECT user_id, request_hash, order_id, receipt_json
    FROM checkout_requests WHERE client_token = ? FOR UPDATE`, [token]);
  const row = rows[0];
  if (!row) throw fail(500, 'Checkout request record missing');
  if (Number(row.user_id) !== userId || row.request_hash !== requestHash) {
    throw fail(409, 'Checkout token was already used for a different purchase');
  }
  if (row.order_id !== null && row.order_id !== undefined) {
    return {token, userId, requestHash, replay:decodeReceipt(row.receipt_json, row.order_id)};
  }
  return {token, userId, requestHash, replay:null};
}
async function storeCheckoutReceipt(conn, claim, receipt) {
  const [result] = await conn.execute(`UPDATE checkout_requests
    SET order_id = ?, receipt_json = ?
    WHERE client_token = ? AND user_id = ? AND request_hash = ? AND order_id IS NULL`,
    [receipt.order_id, JSON.stringify(receipt), claim.token, claim.userId, claim.requestHash]);
  if (!result || result.affectedRows !== 1) {
    throw fail(500, 'Could not attach checkout receipt to request token');
  }
}
module.exports = { validateCheckoutToken, cartHash, claimCheckoutRequest, storeCheckoutReceipt };
