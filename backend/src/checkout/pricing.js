'use strict';
/*
 * Pure pricing helpers for server-side checkout. No database access, so they are unit tested directly.
 * All math is done in whole integer CENTS. The database stores DECIMAL dollars, so convert only
 * at the edges (toCents when reading, toDecimal when writing).
 */

// 8.25% from the project requirements, in basis points (825 / 10000) so tax math stays in integers.
const TAX_RATE_BPS = 825;
const MAX_DECIMAL_CENTS = 9999999999;

function priceError(message) {
  const e = new Error(message);
  e.status = 409;
  return e;
}

// "18.00", "18.5", 18 -> 1800 / 1850 / 1800. Returns null for anything that is not a valid amount.
function toCents(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, frac = ''] = text.split('.');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

// 1850 -> "18.50" (string, so mysql2 sends an exact DECIMAL and never a float).
function toDecimal(cents) {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error('Invalid cents amount');
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

// Tax on a cents amount, rounded half-up to the nearest cent.
function taxFor(cents) {
  return Math.floor((cents * TAX_RATE_BPS + 5000) / 10000);
}

/*
 * Decide what the shopper pays for ONE unit, from database values only.
 * regularPrice / salePrice are raw DECIMAL values from the DB (salePrice may be null).
 * A sale price is used only if it is positive and below the regular price.
 */
function unitPriceCents(regularPrice, salePrice) {
  const regular = toCents(regularPrice);
  if (regular === null || regular <= 0) throw priceError('Product has an invalid price');
  const sale = toCents(salePrice);
  const onSale = sale !== null && sale > 0 && sale < regular;
  return { unitCents: onSale ? sale : regular, regularCents: regular, onSale };
}

/*
 * lines: [{ quantity, unitCents }] -> { subtotalCents, taxCents, totalCents }
 * No discount yet: the shared orders table has no discount column (left to the DB/admin owners).
 */
function orderTotals(lines) {
  let subtotalCents = 0;
  for (const line of lines) {
    subtotalCents += line.unitCents * line.quantity;
  }
  const taxCents = taxFor(subtotalCents);
  const totalCents = subtotalCents + taxCents;
  // DECIMAL(10,2) holds at most 99,999,999.99.
  if (!Number.isSafeInteger(totalCents) || totalCents > MAX_DECIMAL_CENTS) throw priceError('Order total is too large');
  return { subtotalCents, taxCents, totalCents };
}

module.exports = { TAX_RATE_BPS, toCents, toDecimal, taxFor, unitPriceCents, orderTotals };
