'use strict';
/**
 * Local development bridge for Isaac's existing PUBLIC product API.
 * Read-only: never performs INSERT, UPDATE, DELETE, POST, PATCH, or auth changes.
 * Do not use it as an authenticated admin integration.
 */
(function (scope, factory) {
  const api=factory();
  if (typeof module === 'object' && module.exports) module.exports=api;
  if (scope) scope.CoffeeAdminProductBridge=api;
})(typeof window !== 'undefined' ? window : null, function () {
  function normalizeProduct(row) {
    if (!row || typeof row !== 'object') throw Error('Invalid product record from team API');
    const id=Number(row.product_id ?? row.id);
    const stock=Number(row.stock);
    const price=Number(row.price_cents);
    const sale=row.sale_price_cents == null ? null : Number(row.sale_price_cents);
    if(!Number.isSafeInteger(id)||id<=0||!Number.isSafeInteger(stock)||stock<0||
       !Number.isSafeInteger(price)||price<0||
       (sale!==null&&(!Number.isSafeInteger(sale)||sale<0))) {
      throw Error('Team API product data is missing required numeric fields');
    }
    return {
      id,
      name:String(row.name ?? ''),
      description:String(row.description ?? ''),
      category:String(row.category ?? 'Coffee'),
      image:String(row.image ?? ''),
      price_cents:price,
      sale_price_cents:sale,
      stock,
      active:row.active === false || row.active === 0 || row.active === '0' ? 0 : 1
    };
  }
  async function listFromTeamApi(fetcher, hostname) {
    const host=hostname||'localhost';
    if(!['localhost','127.0.0.1'].includes(host)) throw Error('Local inventory bridge is limited to localhost');
    const runFetch=fetcher || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
    if(!runFetch) throw Error('Browser fetch is unavailable');
    let res;
    try { res=await runFetch(`http://${host}:3000/api/products`, {method:'GET',credentials:'omit'}); }
    catch { throw Error('Cannot reach team product API at port 3000. Start backend with npm start.'); }
    if(!res.ok) throw Error(`Team product API returned HTTP ${res.status}. Check backend and MySQL.`);
    let data;
    try { data=await res.json(); } catch { throw Error('Team API returned invalid JSON'); }
    if(!Array.isArray(data)) throw Error('Team API did not return a product list');
    return {products:data.map(normalizeProduct)};
  }
  return {normalizeProduct, listFromTeamApi};
});
