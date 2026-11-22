'use strict';
/** Fail-closed local test fixture boundaries; never used in public deployment. */
const ADMIN_RE = /^co-admin-[a-f0-9]{12}@example\.test$/;
const CUSTOMER_RE = /^co-browser-[a-z0-9]{6,24}@example\.test$/;
const TERMINAL = new Set(['fulfilled', 'cancelled']);
const STATUSES = new Set(['placed', 'processing', 'fulfilled', 'cancelled']);
function exactAdminEmail(value) {
  return typeof value === 'string' && ADMIN_RE.test(value);
}
function exactCustomerEmail(value) {
  return typeof value === 'string' && CUSTOMER_RE.test(value);
}
function expectedStockForOrder(status) {
  if (status === null) return 10;
  if (!STATUSES.has(status)) throw Error('Unrecognized order status');
  return status === 'cancelled' ? 10 : 9;
}
function allowedNextStatus(status) {
  if (status === 'placed') return ['processing', 'cancelled'];
  if (status === 'processing') return ['fulfilled', 'cancelled'];
  if (TERMINAL.has(status)) return [];
  throw Error('Unrecognized order status');
}
module.exports = {exactAdminEmail,exactCustomerEmail,expectedStockForOrder,allowedNextStatus};
