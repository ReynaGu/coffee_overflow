/*
 * Coffee Overflow - shopping cart prototype
 * ==========================================================================
 * Works on its own right now (data lives in the browser's localStorage).
 * Everything that must change once the backend/database is connected is
 * marked with a comment tag so it can be found with a search:
 *
 *     search for:  TODO(BACKEND
 *
 * Tags used (each marks one spot to change):
 *   TODO(BACKEND:api-url)       address of the Express server
 *   TODO(BACKEND:product-data)  product table column names + loading products
 *   TODO(BACKEND:cart-storage)  where the cart is saved (per logged-in user)
 *   TODO(BACKEND:tax)           tax rate source
 *   TODO(BACKEND:discount-codes) validating a code + its amount/type
 *   TODO(BACKEND:place-order)   saving the order to the database
 *   TODO(BACKEND:stock)         stock re-check / stock reduction on order
 *   TODO(BACKEND:auth)          who is placing the order
 *   TODO(BACKEND:add-to-cart)   hooking up the "Add to Cart" buttons on products.html
 *   TODO(PROTOTYPE)             demo-only code to delete once the real data exists
 *
 * All money is handled in whole CENTS internally (1800 = $18.00) so totals never
 * pick up floating-point errors. Convert at the edges only (see toCents/fmt).
 *
 * Public API for other pages (products.html, navbar):
 *   CoffeeCart.add(item, qty = 1)   item = { id, name, image, price, salePrice, stock }
 *   CoffeeCart.count()              total units in the cart
 *   CoffeeCart.updateBadge()        refresh the navbar cart count
 */
(function () {
  "use strict";

  /* =====================================================================
   * 1. CONFIG
   * ===================================================================== */
  const CONFIG = {
    // TODO(BACKEND:tax): 8.25% is the rate given in the project requirements.
    // If the team wants it editable by an admin, load it from the server instead.
    TAX_RATE: 0.0825,

    // TODO(BACKEND:api-url): the Express server from /backend (server.js uses
    // PORT 3000 by default). Change this when the server is hosted.
    API_BASE: "http://localhost:3000",

    // TODO(BACKEND:product-data): set to true once the products API works.
    // false = use the built-in demo products below.
    // true  = load products from GET {API_BASE}/api/products
    USE_API: false,

    // TODO(PROTOTYPE): start a first-time visitor with 2 sample items in the cart.
    // Set to false (or delete the seeding code) when real "Add to Cart" works.
    SEED_DEMO_CART: true,
  };
  // Lets a test page override settings without editing this file.
  Object.assign(CONFIG, window.COFFEE_CART_CONFIG || {});

  /* TODO(BACKEND:product-data): the MySQL table the backend reads is
   * `test_products` (see backend/src/controllers/productController.js).
   * Only `product_id` is confirmed by the backend code. Every other column name
   * below is a GUESS - the schema is not in the repo. Change the right-hand side
   * to match the real column names, nothing else needs editing. */
  const FIELD_MAP = {
    id: "product_id",     // confirmed in productController.js
    name: "name",         // GUESS
    price: "price",       // GUESS - regular price
    salePrice: "sale_price", // GUESS - empty/NULL when the item is NOT on sale
    stock: "stock",       // GUESS - quantity available
    image: "image_url",   // GUESS - path or URL of the product photo
  };

  /* =====================================================================
   * 2. DEMO DATA  (TODO(PROTOTYPE): delete once products come from the API)
   * ===================================================================== */
  // Same sample items as products.html. Prices are in cents.
  const DEMO_CATALOG = [
    { id: "1", name: "Morning Blend Coffee Beans (12 oz)", image: "assets/images/Pile_of_coffee_beans.jpeg", price: 1800, salePrice: 1400, stock: 12 },
    { id: "2", name: "Classic White Ceramic Mug", image: "assets/images/espresso_machine.jpeg", price: 1200, salePrice: null, stock: 30 },
    { id: "3", name: "Latte Mug Set (Set of 2)", image: "assets/images/three_people_enjoying_coffee.jpeg", price: 2800, salePrice: null, stock: 8 },
    { id: "4", name: "Dark Roast Coffee Beans (12 oz)", image: "assets/images/Pile_of_coffee_beans.jpeg", price: 1600, salePrice: null, stock: 2 },
  ];

  /* TODO(BACKEND:discount-codes): these codes are fake. The admin page will create
   * real ones, so replace lookupDiscountCode() (further down) with a request to the
   * server, e.g.  GET {API_BASE}/api/discount-codes/:code
   *   -> { code: "COFFEE10", type: "percent", value: 10, description: "10% off" }
   * type "percent": value is a percentage.  type "fixed": value is DOLLARS off. */
  const DEMO_DISCOUNT_CODES = {
    COFFEE10: { type: "percent", value: 10, description: "10% off your order" },
    WELCOME5: { type: "fixed", value: 5, description: "$5.00 off your order" },
  };

  /* =====================================================================
   * 3. SMALL HELPERS
   * ===================================================================== */
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  const fmt = (cents) => money.format(cents / 100);

  // MySQL DECIMAL columns usually arrive as strings like "18.00" -> cents.
  const toCents = (v) => Math.round(Number(v) * 100);

  // Neutral picture used when a product has no image.
  const NO_IMAGE = "data:image/svg+xml;utf8," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#eee"/>' +
    '<text x="48" y="54" font-size="12" text-anchor="middle" fill="#999" font-family="sans-serif">No image</text></svg>');

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = String(s);
    return d.innerHTML;
  }

  const CART_KEY = "co_cart";
  const CODE_KEY = "co_cart_code";
  const ORDERS_KEY = "co_orders";
  const SEEDED_KEY = "co_cart_seeded";

  function read(key, fallback) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch (e) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage blocked: cart just won't persist */ }
  }

  /* =====================================================================
   * 4. PRODUCT DATA
   * ===================================================================== */
  let catalog = DEMO_CATALOG.map((p) => ({ ...p }));

  // Turns one database row into the shape the cart uses.
  function fromApiRow(row) {
    const f = FIELD_MAP;
    const sale = row[f.salePrice];
    return {
      id: String(row[f.id]),
      name: row[f.name] || "Unnamed product",
      image: row[f.image] || NO_IMAGE,
      price: toCents(row[f.price]),
      salePrice: sale === null || sale === undefined || sale === "" ? null : toCents(sale),
      stock: Number(row[f.stock]) || 0,
    };
  }

  async function loadCatalog() {
    if (!CONFIG.USE_API) return;
    try {
      // TODO(BACKEND:product-data): endpoint exists in backend/src/routes/productRoutes.js
      const res = await fetch(CONFIG.API_BASE + "/api/products");
      if (!res.ok) throw new Error("HTTP " + res.status);
      catalog = (await res.json()).map(fromApiRow);
      refreshCartFromCatalog();
    } catch (e) {
      console.error("Could not load products from the API, using demo products.", e);
      flash("Could not reach the product server. Showing sample products.", "warning");
    }
  }

  // Re-price every cart line from the latest product data (price, sale, stock can
  // change after the item was added). Items that no longer exist are dropped.
  function refreshCartFromCatalog() {
    cart = cart.map((line) => {
      const p = catalog.find((c) => c.id === line.id);
      if (!p) return null;
      return { ...p, qty: Math.min(line.qty, Math.max(p.stock, 0)) };
    }).filter((l) => l && l.qty > 0);
    saveCart();
    render();
  }

  /* =====================================================================
   * 5. CART STATE
   * ===================================================================== */
  /* TODO(BACKEND:cart-storage): the cart is kept in this browser (localStorage).
   * That is fine for a prototype, and a reasonable final design too (keep it in the
   * browser until the order is placed). If the team wants carts saved per user, load
   * and save it through the API here instead, keyed by the logged-in user. */
  let cart = read(CART_KEY, []);          // [{ id, name, image, price, salePrice, stock, qty }]
  let appliedCode = read(CODE_KEY, null); // e.g. "COFFEE10"
  let justOrdered = null;                 // last placed order, for the confirmation view
  let placing = false;                    // blocks double-clicking Place Order

  const saveCart = () => { write(CART_KEY, cart); write(CODE_KEY, appliedCode); updateBadge(); };
  const unitPrice = (l) => (l.salePrice != null ? l.salePrice : l.price);
  const isOnSale = (l) => l.salePrice != null && l.salePrice < l.price;
  const count = () => cart.reduce((n, l) => n + l.qty, 0);

  // Adds an item (or more of it). Never goes above the stock available.
  // Returns { ok, capped } so callers can tell the shopper what happened.
  function add(item, qty) {
    qty = Math.max(1, Math.floor(Number(qty) || 1));
    if (!item || item.stock <= 0) return { ok: false, capped: false };
    const existing = cart.find((l) => l.id === String(item.id));
    let capped = false;
    if (existing) {
      const want = existing.qty + qty;
      existing.qty = Math.min(want, existing.stock);
      capped = want > existing.stock;
    } else {
      const start = Math.min(qty, item.stock);
      capped = qty > item.stock;
      cart.push({ ...item, id: String(item.id), qty: start });
    }
    saveCart();
    return { ok: true, capped };
  }

  function updateBadge() {
    document.querySelectorAll("[data-cart-count]").forEach((el) => {
      const n = count();
      el.textContent = n > 0 ? String(n) : "";
      el.classList.toggle("d-none", n === 0);
    });
  }

  /* =====================================================================
   * 6. DISCOUNT CODES + TOTALS
   * ===================================================================== */
  // Returns the code's details, or null if it is not valid.
  async function lookupDiscountCode(code) {
    /* TODO(BACKEND:discount-codes): replace the demo lookup with a server request.
     * The server should also check expiry date, usage limits, and any minimum spend.
     *
     *   const res = await fetch(CONFIG.API_BASE + "/api/discount-codes/" + encodeURIComponent(code));
     *   if (!res.ok) return null;
     *   return await res.json();   // { code, type: "percent"|"fixed", value, description }
     */
    const d = DEMO_DISCOUNT_CODES[code];
    return d ? { code, ...d } : null;
  }

  // The applied code's details are kept here after it has been validated.
  let appliedDetails = null;

  function totals() {
    const subtotal = cart.reduce((sum, l) => sum + unitPrice(l) * l.qty, 0);
    // How much shoppers are saving from sale prices (shown for information only;
    // subtotal already uses the sale prices).
    const saleSavings = cart.reduce((sum, l) => sum + (isOnSale(l) ? (l.price - l.salePrice) * l.qty : 0), 0);

    let discount = 0;
    if (appliedDetails) {
      discount = appliedDetails.type === "percent"
        ? Math.round((subtotal * appliedDetails.value) / 100)
        : Math.min(toCents(appliedDetails.value), subtotal);   // never more than the subtotal
    }
    const taxable = subtotal - discount;                // tax is charged AFTER discounts
    const tax = Math.round(taxable * CONFIG.TAX_RATE);
    return { subtotal, saleSavings, discount, tax, total: taxable + tax };
  }

  /* =====================================================================
   * 7. RENDERING (cart page only)
   * ===================================================================== */
  const root = document.getElementById("cart-root");
  const statusEl = document.getElementById("cart-status");
  let flashTimer = null;

  // Short message shown at the top of the page (polite screen-reader announcement).
  function flash(msg, kind) {
    if (!statusEl) return;
    statusEl.innerHTML = msg
      ? `<div class="alert alert-${kind || "info"} mb-4 py-2" role="status">${esc(msg)}</div>` : "";
    clearTimeout(flashTimer);
    if (msg) flashTimer = setTimeout(() => { statusEl.innerHTML = ""; }, 5000);
  }

  function priceHtml(l) {
    // Requirement: clearly say whether the price is a sale price or not.
    return isOnSale(l)
      ? `<span class="badge badge-sale me-1">SALE</span>
         <span class="text-decoration-line-through text-muted me-1">${fmt(l.price)}</span>
         <span class="fw-semibold">${fmt(l.salePrice)}</span>
         <span class="text-muted small">each</span>`
      : `<span class="fw-semibold">${fmt(l.price)}</span>
         <span class="text-muted small">each &middot; regular price</span>`;
  }

  function stockHtml(l) {
    if (l.qty >= l.stock) return `<span class="text-xs text-danger">Maximum available (${l.stock}) is in your cart</span>`;
    if (l.stock <= 5) return `<span class="text-xs text-danger">Only ${l.stock} in stock</span>`;
    return `<span class="text-xs text-muted">${l.stock} in stock</span>`;
  }

  function lineHtml(l) {
    return `
      <div class="cart-item py-4" data-id="${esc(l.id)}">
        <div class="row g-3 align-items-center">
          <div class="col-auto">
            <img class="cart-item-img" src="${esc(l.image)}" alt="${esc(l.name)}" loading="lazy">
          </div>
          <div class="col">
            <h3 class="h6 mb-1">${esc(l.name)}</h3>
            <div class="mb-1">${priceHtml(l)}</div>
            <div class="mb-2">${stockHtml(l)}</div>
            <div class="d-flex flex-wrap align-items-center gap-3">
              <div class="cart-qty" role="group" aria-label="Quantity for ${esc(l.name)}">
                <button type="button" data-act="dec" aria-label="Decrease quantity" ${l.qty <= 1 ? "disabled" : ""}>&minus;</button>
                <input type="number" min="1" max="${l.stock}" value="${l.qty}" data-act="qty" aria-label="Quantity">
                <button type="button" data-act="inc" aria-label="Increase quantity" ${l.qty >= l.stock ? "disabled" : ""}>+</button>
              </div>
              <button type="button" class="cart-link-btn" data-act="remove">Remove</button>
            </div>
          </div>
          <div class="col-12 col-sm-auto text-sm-end">
            <div class="text-xs text-uppercase text-muted">Item total</div>
            <div class="fw-semibold">${fmt(unitPrice(l) * l.qty)}</div>
          </div>
        </div>
      </div>`;
  }

  // TODO(PROTOTYPE): this "Add an item" box exists only so you can test adding items
  // before the products page is wired up. DELETE this function and its call in
  // render() once the "Add to Cart" buttons on products.html call CoffeeCart.add().
  function addBoxHtml() {
    const opts = catalog.map((p) =>
      `<option value="${esc(p.id)}" ${p.stock <= 0 ? "disabled" : ""}>${esc(p.name)} - ${fmt(unitPrice(p))}${p.stock <= 0 ? " (out of stock)" : ""}</option>`).join("");
    return `
      <form id="add-form" class="border bg-light bg-opacity-50 p-3 mt-4" novalidate>
        <label for="add-select" class="form-label text-xs text-uppercase fw-semibold mb-2">Add an item (prototype)</label>
        <div class="d-flex flex-column flex-sm-row gap-2">
          <select id="add-select" class="form-select">${opts}</select>
          <button class="btn btn-outline-dark flex-shrink-0" type="submit">Add to cart</button>
        </div>
      </form>`;
  }

  function summaryHtml(t) {
    const d = appliedDetails;
    // Requirement: show the discount code and how much it takes off the total.
    const discountRow = d ? `
      <div class="d-flex justify-content-between text-success mb-2">
        <span>Discount: <strong>${esc(d.code)}</strong>
          <button type="button" class="cart-link-btn ms-1" data-act="remove-code">remove</button>
          <span class="d-block text-xs text-muted">${esc(d.description || "")}</span></span>
        <span>&minus;${fmt(t.discount)}</span>
      </div>` : "";
    const savingsRow = t.saleSavings > 0 ? `
      <div class="d-flex justify-content-between text-danger small mb-2">
        <span>Sale savings (already included)</span><span>${fmt(t.saleSavings)}</span>
      </div>` : "";
    const overStock = cart.some((l) => l.qty > l.stock);
    return `
      <div class="summary-card bg-light border bg-opacity-50 p-4">
        <h2 class="h5 mb-4">Order Summary</h2>

        <form id="code-form" class="mb-4" novalidate>
          <label for="code-input" class="form-label text-xs text-uppercase fw-semibold">Discount code</label>
          <div class="input-group">
            <input id="code-input" class="form-control" placeholder="Enter code" autocomplete="off"
                   autocapitalize="characters" ${d ? "disabled" : ""}>
            <button class="btn btn-outline-dark" type="submit" ${d ? "disabled" : ""}>Apply</button>
          </div>
          <div id="code-msg" class="small mt-2" role="status" aria-live="polite"></div>
        </form>

        <div class="d-flex justify-content-between mb-2">
          <span>Subtotal (${count()} item${count() === 1 ? "" : "s"})</span><span>${fmt(t.subtotal)}</span>
        </div>
        ${savingsRow}
        ${discountRow}
        <div class="d-flex justify-content-between mb-2">
          <span>Tax (${(CONFIG.TAX_RATE * 100).toFixed(2)}%)</span><span>${fmt(t.tax)}</span>
        </div>
        <hr>
        <div class="d-flex justify-content-between fw-bold summary-total mb-4">
          <span>Total</span><span>${fmt(t.total)}</span>
        </div>
        <div class="d-grid">
          <button type="button" class="btn btn-primary btn-lg" data-act="place-order" ${overStock || placing ? "disabled" : ""}>
            ${placing ? "Placing order..." : "Place Order"}</button>
        </div>
        <p class="text-xs text-muted mt-3 mb-0">Tax is calculated after any discount.</p>
      </div>`;
  }

  function emptyHtml() {
    // The "Browse products" button links to the products page (products.html).
    return `
      <div class="text-center py-5">
        <h2 class="h4">Your cart is empty</h2>
        <p class="text-muted">You haven't added anything yet.</p>
        <a href="products.html" class="btn btn-primary">Browse products</a>
        <div class="text-start mx-auto mt-5" style="max-width: 480px">${addBoxHtml()}</div>
      </div>`;
  }

  function confirmationHtml(o) {
    const lines = o.items.map((i) => `
      <div class="d-flex justify-content-between small mb-1">
        <span>${esc(i.name)} &times; ${i.qty}${i.onSale ? ' <span class="badge badge-sale">SALE</span>' : ""}</span>
        <span>${fmt(i.unit * i.qty)}</span></div>`).join("");
    return `
      <div class="row justify-content-center">
        <div class="col-lg-6">
          <div class="text-center mb-4">
            <h2 class="h3">Thank you, your order has been placed!</h2>
            <p class="text-muted mb-0">Order <strong>${esc(o.id)}</strong> &middot; ${esc(new Date(o.date).toLocaleString())}</p>
          </div>
          <div class="bg-light border bg-opacity-50 p-4">
            ${lines}
            <hr>
            <div class="d-flex justify-content-between small mb-1"><span>Subtotal</span><span>${fmt(o.subtotal)}</span></div>
            ${o.discount ? `<div class="d-flex justify-content-between small mb-1 text-success"><span>Discount (${esc(o.code)})</span><span>&minus;${fmt(o.discount)}</span></div>` : ""}
            <div class="d-flex justify-content-between small mb-1"><span>Tax (${(CONFIG.TAX_RATE * 100).toFixed(2)}%)</span><span>${fmt(o.tax)}</span></div>
            <div class="d-flex justify-content-between fw-bold mt-2"><span>Total</span><span>${fmt(o.total)}</span></div>
          </div>
          <div class="text-center mt-4"><a href="products.html" class="btn btn-primary">Continue shopping</a></div>
        </div>
      </div>`;
  }

  function render() {
    if (!root) return;
    // Keep keyboard focus on the same control after the page redraws.
    const a = document.activeElement;
    const keep = a && root.contains(a) && a.dataset && a.dataset.act
      ? { act: a.dataset.act, id: a.closest("[data-id]") ? a.closest("[data-id]").dataset.id : null } : null;

    if (justOrdered) root.innerHTML = confirmationHtml(justOrdered);
    else if (cart.length === 0) root.innerHTML = emptyHtml();
    else {
      root.innerHTML = `
        <div class="row g-5">
          <div class="col-lg-8">
            <div class="d-flex justify-content-between align-items-center pb-3 border-bottom">
              <h2 class="h5 mb-0">Items in your cart</h2>
              <button type="button" class="cart-link-btn" data-act="clear">Clear cart</button>
            </div>
            ${cart.map(lineHtml).join("")}
            ${addBoxHtml()}
            <a href="products.html" class="btn btn-link px-0 mt-3">&larr; Continue shopping</a>
          </div>
          <div class="col-lg-4">${summaryHtml(totals())}</div>
        </div>`;
    }

    if (keep) {
      const row = keep.id ? root.querySelector(`[data-id="${CSS.escape(keep.id)}"]`) : root;
      const el = row && row.querySelector(`[data-act="${keep.act}"]:not(:disabled)`);
      if (el) el.focus();
    }
  }

  /* =====================================================================
   * 8. ACTIONS
   * ===================================================================== */
  function setQty(id, qty) {
    const line = cart.find((l) => l.id === id);
    if (!line) return;
    qty = Math.floor(Number(qty));
    if (!Number.isFinite(qty) || qty < 1) qty = 1;
    if (qty > line.stock) flash(`Only ${line.stock} of "${line.name}" available.`, "warning");
    line.qty = Math.min(qty, line.stock);
    saveCart();
    render();
  }

  async function applyCode(raw) {
    const code = raw.trim().toUpperCase();
    const msg = (text, cls) => {
      const m = document.getElementById("code-msg");
      if (m) { m.className = "small mt-2 text-" + cls; m.textContent = text; }
    };
    if (!code) return msg("Please enter a code.", "danger");
    const details = await lookupDiscountCode(code);
    if (!details) return msg("Sorry, that code isn't valid.", "danger");
    appliedCode = code;
    appliedDetails = details;
    saveCart();
    render();
    const m = document.getElementById("code-msg");
    if (m) { m.className = "small mt-2 text-success"; m.textContent = `Code ${code} applied.`; }
  }

  async function restoreAppliedCode() {
    // A code saved from an earlier visit has to be re-checked, not trusted.
    if (!appliedCode) return;
    appliedDetails = await lookupDiscountCode(appliedCode);
    if (!appliedDetails) { appliedCode = null; saveCart(); }
  }

  async function placeOrder() {
    if (placing || cart.length === 0) return;

    /* TODO(BACKEND:stock): re-check stock on the SERVER right before saving.
     * Two shoppers could both have the last mug in their cart. The server must
     * check quantity again, reduce the stock, and save the order in one
     * transaction, and reply with an error if something is no longer available. */
    const over = cart.find((l) => l.qty > l.stock);
    if (over) return flash(`Only ${over.stock} of "${over.name}" are available.`, "danger");

    const t = totals();
    const order = {
      id: "CO-" + Date.now().toString(36).toUpperCase(),   // TODO(BACKEND:place-order): the database assigns the real order id
      date: new Date().toISOString(),
      items: cart.map((l) => ({ id: l.id, name: l.name, qty: l.qty, unit: unitPrice(l), onSale: isOnSale(l) })),
      code: appliedDetails ? appliedDetails.code : null,
      subtotal: t.subtotal, discount: t.discount, tax: t.tax, total: t.total,
    };

    placing = true;
    render();
    try {
      /* TODO(BACKEND:place-order): save the order in the database. Replace the
       * localStorage lines below with a request like this (endpoint does not exist yet):
       *
       *   const res = await fetch(CONFIG.API_BASE + "/api/orders", {
       *     method: "POST",
       *     headers: { "Content-Type": "application/json" },
       *     body: JSON.stringify({
       *       items: cart.map((l) => ({ product_id: l.id, quantity: l.qty })),
       *       discount_code: appliedDetails ? appliedDetails.code : null,
       *       // TODO(BACKEND:auth): also send who is ordering (logged-in user id or token)
       *     }),
       *   });
       *   if (!res.ok) throw new Error((await res.json()).error || "Order failed");
       *   const saved = await res.json();   // use saved.order_id etc. for the confirmation
       *
       * IMPORTANT: send only product ids, quantities and the code. The SERVER must
       * recalculate prices, sale prices, discount and the 8.25% tax itself - never
       * trust totals sent from the browser. The admin "current orders / order
       * history" pages will read what is saved here. */
      const orders = read(ORDERS_KEY, []);   // TODO(PROTOTYPE): remove with the real POST above
      orders.push(order);
      write(ORDERS_KEY, orders);

      justOrdered = order;
      cart = [];
      appliedCode = null;
      appliedDetails = null;
      saveCart();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      console.error(e);
      flash("Sorry, we couldn't place your order. Please try again.", "danger");
    } finally {
      placing = false;
      render();
    }
  }

  /* =====================================================================
   * 9. START-UP
   * ===================================================================== */
  async function init() {
    // TODO(PROTOTYPE): sample cart for first-time visitors (see CONFIG.SEED_DEMO_CART).
    if (root && CONFIG.SEED_DEMO_CART && cart.length === 0 && !read(SEEDED_KEY, false)) {
      cart = [{ ...DEMO_CATALOG[0], qty: 2 }, { ...DEMO_CATALOG[1], qty: 1 }];
      write(SEEDED_KEY, true);
      saveCart();
    }
    updateBadge();
    if (!root) return;   // other pages only need the badge + CoffeeCart.add

    root.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      const row = btn.closest("[data-id]");
      const id = row ? row.dataset.id : null;
      const line = id ? cart.find((l) => l.id === id) : null;
      switch (btn.dataset.act) {
        case "inc": if (line) setQty(id, line.qty + 1); break;
        case "dec": if (line) setQty(id, line.qty - 1); break;
        case "remove": cart = cart.filter((l) => l.id !== id); saveCart(); render(); break;
        case "clear": cart = []; appliedCode = null; appliedDetails = null; saveCart(); render(); break;
        case "remove-code": appliedCode = null; appliedDetails = null; saveCart(); render(); break;
        case "place-order": placeOrder(); break;
      }
    });
    root.addEventListener("change", (e) => {
      if (e.target.dataset.act === "qty") setQty(e.target.closest("[data-id]").dataset.id, e.target.value);
    });
    root.addEventListener("submit", (e) => {
      e.preventDefault();
      if (e.target.id === "code-form") applyCode(document.getElementById("code-input").value);
      if (e.target.id === "add-form") {
        const item = catalog.find((p) => p.id === document.getElementById("add-select").value);
        const r = add(item, 1);
        if (!r.ok) flash("Sorry, that item is out of stock.", "warning");
        else if (r.capped) flash(`Only ${item.stock} of "${item.name}" available.`, "warning");
        render();
      }
    });

    await restoreAppliedCode();
    render();
    await loadCatalog();   // no-op unless CONFIG.USE_API
    render();
  }

  /* TODO(BACKEND:add-to-cart): to make the "Add to Cart" buttons on products.html work:
   *  1) in the page, add   <script src="./assets/js/cart.js"></script>   before </body>
   *  2) put the product's data on each button, for example (price in CENTS):
   *       <a href="#" class="btn btn-primary btn-sm js-add-to-cart"
   *          data-id="1" data-name="Morning Blend Coffee Beans (12 oz)"
   *          data-image="assets/images/Pile_of_coffee_beans.jpeg"
   *          data-price="1800" data-sale-price="1400" data-stock="12">Add to Cart</a>
   *     (omit data-sale-price when the item is not on sale). When the cards are
   *     generated from the database, fill these attributes from the product row.
   *  3) the click handler below does the rest. */
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".js-add-to-cart");
    if (!btn) return;
    e.preventDefault();
    const d = btn.dataset;
    add({
      id: d.id, name: d.name, image: d.image || NO_IMAGE,
      price: Number(d.price), salePrice: d.salePrice ? Number(d.salePrice) : null, stock: Number(d.stock),
    }, 1);
  });

  window.CoffeeCart = { add, count, updateBadge };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
