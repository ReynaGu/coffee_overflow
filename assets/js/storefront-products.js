'use strict';
/* Coffee Overflow — local shared-product storefront integration (Hudson + team).
 * Reads from Isaac's existing GET /api/products. No database writes.
 * Never treats a client-side active filter as authorization: production API must enforce visibility.
 */
(function (root) {
  const API_URL = 'http://localhost:3000/api/products';
  const normalize = (row) => {
    if (!row || typeof row !== 'object') return null;
    const id = Number(row.product_id ?? row.id);
    const cents = Number(row.price_cents);
    const sale = row.sale_price_cents == null ? null : Number(row.sale_price_cents);
    const stock = Number(row.stock);
    if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(cents) || cents <= 0 || !Number.isSafeInteger(stock) || stock < 0) return null;
    const image = String(row.image || '');
    const safeImage = image.startsWith('/assets/') ? '.' + image : (image.startsWith('https://') ? image : '');
    return {
      id: String(id),
      name: String(row.name || 'Unnamed product'),
      description: String(row.description || ''),
      category: String(row.category || 'Coffee'),
      image: safeImage,
      price: cents,
      salePrice: Number.isSafeInteger(sale) && sale > 0 && sale < cents ? sale : null,
      stock,
      active: row.active === true || row.active === 1 || row.active === '1' || row.active == null
    };
  };
  const fmt = cents => '$' + (cents / 100).toFixed(2);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
  const eligible = data => (Array.isArray(data) ? data : []).map(normalize).filter(x => x && x.active);
  const filterProducts = (products, state) => {
    const q = String(state.search || '').trim().toLowerCase();
    const p = products.filter(product => {
      const price = product.salePrice ?? product.price;
      if (q && ![product.name, product.description, product.category].join(' ').toLowerCase().includes(q)) return false;
      if (state.category && product.category !== state.category) return false;
      if (state.priceRanges?.length) {
        const dollars = price / 100;
        if (!state.priceRanges.some(range => (range === 'under15' && dollars < 15) || (range === '15to30' && dollars >= 15 && dollars <= 30) || (range === 'over30' && dollars > 30))) return false;
      }
      if (state.sale && product.salePrice == null) return false;
      if (state.inStock && product.stock < 1) return false;
      return true;
    });
    const collator = new Intl.Collator(undefined, {sensitivity:'base'});
    const modes = {
      'price-asc': (a,b) => (a.salePrice ?? a.price) - (b.salePrice ?? b.price),
      'price-desc': (a,b) => (b.salePrice ?? b.price) - (a.salePrice ?? a.price),
      'stock-desc': (a,b) => b.stock - a.stock,
      'stock-asc': (a,b) => a.stock - b.stock,
      'name-asc': (a,b) => collator.compare(a.name,b.name),
      'name-desc': (a,b) => collator.compare(b.name,a.name)
    };
    if (modes[state.sort]) p.sort(modes[state.sort]);
    return p;
  };
  // Pure helpers are also usable from Node's built-in test runner.
  if (typeof module !== 'undefined' && module.exports) module.exports = { normalize, eligible, filterProducts, fmt, esc };
  if (typeof document === 'undefined') return;

  const grid = document.querySelector('.col-lg-9 > .row.g-4');
  if (!grid) return;
  const state = {search:'', category:'', priceRanges:[], sale:false, inStock:false, sort:''};
  let products = [];
  const originalCards = [...grid.children].filter(x => x.matches('.col-sm-6.col-md-4'));
  const status = document.createElement('div');
  status.setAttribute('role','status'); status.setAttribute('aria-live','polite');
  status.className = 'col-12 small text-muted';
  const results = document.createElement('div');
  results.className = 'col-12'; results.id = 'live-storefront-results';
  results.innerHTML = '<p class="text-muted">Loading real product inventory…</p>';
  grid.appendChild(status);
  grid.appendChild(results);
  // Remove demo cards as soon as the dynamic catalog is initialized, even on failure.
  originalCards.forEach(x => x.remove());

  const categoryPanel = [...document.querySelectorAll('aside h6')].find(x => x.textContent.trim() === 'Category')?.parentElement?.querySelector('ul');
  const categoryOptions = () => {
    if (!categoryPanel) return;
    const categories = [...new Set(products.map(x => x.category))].sort();
    categoryPanel.innerHTML = [
      ['','All Products'], ...categories.map(x=>[x,x])
    ].map(([value,label])=>`<li><a href="#" data-store-category="${esc(value)}" class="${state.category===value?'fw-bold ':''}text-dark">${esc(label)}</a></li>`).join('');
  };
  const row = product => {
    const out = product.stock <= 0;
    const sale = product.salePrice != null;
    const image = product.image || './assets/images/Pile_of_coffee_beans.jpeg';
    return `<div class="col-sm-6 col-md-4">
      <div class="card product-card h-100">
        <img src="${esc(image)}" class="card-img-top" alt="${esc(product.name)}" loading="lazy">
        <div class="card-body d-flex flex-column">
          <p class="text-muted mb-2 text-uppercase text-xs">${esc(product.category)}</p>
          <h3 class="h5 mb-2">${esc(product.name)}</h3>
          <p class="small text-muted">${esc(product.description)}</p>
          <div class="mb-2">${sale?`<span class="badge bg-danger me-1">SALE</span> <span class="fw-semibold text-decoration-line-through text-muted">${fmt(product.price)}</span> <span class="fw-semibold">${fmt(product.salePrice)}</span>`:`<span class="fw-semibold">${fmt(product.price)}</span>`}</div>
          <div class="small text-muted mb-3">${out?'Out of stock':`${product.stock} in stock`}</div>
          <button type="button" class="btn btn-primary btn-sm js-add-to-cart mt-auto"
            data-id="${esc(product.id)}" data-name="${esc(product.name)}" data-image="${esc(image)}"
            data-price="${product.price}" ${sale?`data-sale-price="${product.salePrice}"`:''} data-stock="${product.stock}" ${out?'disabled':''}>
            ${out?'Unavailable':'Add to Cart'}
          </button>
        </div>
      </div>
    </div>`;
  };
  function render() {
    const visible = filterProducts(products,state);
    status.textContent = `${visible.length} product${visible.length===1?'':'s'} found`;
    results.innerHTML = visible.length
      ? `<div class="row g-4">${visible.map(row).join('')}</div>`
      : '<div class="border bg-light p-4">No products match those filters.</div>';
  }
  // On this page Jalen's existing cart.js handles clicks on .js-add-to-cart.
  // The product UI deliberately does not duplicate that cart implementation.
  const search = document.getElementById('product-search');
  search?.addEventListener('input',e=>{state.search=e.target.value;render();});
  const sort = document.getElementById('product-sort');
  sort?.addEventListener('change',e=>{state.sort=e.target.value;render();});
  categoryPanel?.addEventListener('click',e=>{
    const a = e.target.closest('[data-store-category]');
    if (!a) return;
    e.preventDefault();state.category = a.dataset.storeCategory;categoryOptions();render();
  });
  document.querySelector('aside .btn.btn-primary')?.addEventListener('click',()=>{
    state.priceRanges = [['price1','under15'],['price2','15to30'],['price3','over30']]
      .filter(([id])=>document.getElementById(id)?.checked).map(([,value])=>value);
    state.sale = Boolean(document.getElementById('show1')?.checked);
    state.inStock = Boolean(document.getElementById('show2')?.checked);
    render();
  });
  (async()=>{
    try {
      const response = await fetch(API_URL, {headers:{'Accept':'application/json'},cache:'no-store'});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      products = eligible(await response.json());
      categoryOptions();render();
    } catch(error) {
      status.textContent = 'Product API unavailable';
      results.innerHTML = '<div class="alert alert-warning">Could not load live products. Start the Express backend on port 3000 and refresh. No sample products are being sold.</div>';
      console.error('Coffee Overflow product catalog:',error);
    }
  })();
})(typeof globalThis==='undefined'?this:globalThis);
