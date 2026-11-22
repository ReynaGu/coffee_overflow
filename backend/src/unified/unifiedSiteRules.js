'use strict';
/** Pure rules for the localhost-only unified storefront preview. */
const ALLOWED_PAGES = new Set(['index.html','products.html','cart.html','about.html','contact.html']);
const CONFIG_SNIPPET = '<script src="/unified/config.js"></script>\n<script defer src="/unified/site-ui.js"></script>';
function injectConfig(html) {
  if (typeof html !== 'string') throw new TypeError('HTML expected');
  const openHead = /<head(?:\s[^>]*)?>/i;
  const matches = html.match(openHead);
  if (!matches || html.includes('/unified/config.js')) throw new Error('Unexpected storefront HTML; refuse to modify page');
  return html.replace(openHead, `${matches[0]}\n${CONFIG_SNIPPET}`);
}
function previewProduct(row) {
  if (!row || Number(row.product_id)!==1) throw new Error('Missing fixture product #1');
  const price = Number(row.price), stock = Number(row.stock_quantity);
  if (!Number.isFinite(price) || price <= 0 || !Number.isSafeInteger(stock) || stock < 0 ||
      !Number.isSafeInteger(Math.round(price*100))) throw new Error('Fixture has invalid price/stock');
  return Object.freeze({
    product_id:1, name:String(row.name), description:String(row.description||''),
    price_cents:Math.round(price*100), sale_price_cents:null, stock,
    active:1, category:'Coffee', image:'/assets/images/Pile_of_coffee_beans.jpeg'
  });
}
function isAllowedPage(name) { return ALLOWED_PAGES.has(name); }
module.exports = {injectConfig, previewProduct, isAllowedPage};
