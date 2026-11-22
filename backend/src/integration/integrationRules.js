'use strict';
/** Fixed synthetic fixture contract for the isolated browser preview. */
const FIXTURE_EMAIL = /^co-browser-[a-z0-9]{6,24}@example\.test$/;
function permittedTestEmail(email) {
  return typeof email === 'string' && FIXTURE_EMAIL.test(email.trim().toLowerCase());
}
function permittedTestOrder(body) {
  return Boolean(body && !Array.isArray(body) && typeof body === 'object' &&
    Array.isArray(body.items) && body.items.length === 1 &&
    Number(body.items[0]?.product_id) === 1 && Number(body.items[0]?.quantity) === 1 &&
    typeof body.client_token === 'string' &&
    (body.discount_code === null || body.discount_code === undefined || body.discount_code === ''));
}
function normalizeFixtureProduct(row) {
  if (!row || Number(row.product_id) !== 1) throw Error('Integration test product #1 is missing');
  const price = Number(row.price);
  const stock = Number(row.stock_quantity);
  if (!Number.isFinite(price) || price <= 0 || !Number.isSafeInteger(stock) || stock < 0) throw Error('Invalid integration product data');
  return {product_id:1,name:String(row.name),description:String(row.description || ''),price_cents:Math.round(price*100),stock};
}
module.exports={permittedTestEmail,permittedTestOrder,normalizeFixtureProduct};
