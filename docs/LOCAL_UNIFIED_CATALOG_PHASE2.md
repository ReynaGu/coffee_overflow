# Coffee Overflow — Local Unified Catalog Phase 2

**LOCAL SYNTHETIC TEST ONLY. No payments, production deployment, real customer accounts, or writes to the team database.**

Branch: `feature/hudson-unified-website`. Builds on Phase 1, which was verified with 118 passing regression tests. These Phase 2 files are additive: they do not overwrite `server.js`, `cart.js`, Reyna's `coffee_overflow.sql`, the original Phase 1 launcher, or any teammates' branches.

## Catalog source and scope

Phase 1 intentionally exposes only `Checkout Integration Test Coffee` (product #1) in the restricted MySQL database `coffee_overflow_integration`. Phase 2 uses the **19 visible product cards in the team's `products.html` on the unified branch (Nov. 22, 2026)** as a temporary catalog seed: 11 coffees, 2 mugs, and 6 clothing/hat products. The names, listed prices, quantities and existing image filenames are preserved. The Morning Blend product has its listed sale ($18.00 -> $14.00) modeled through temporary `sale_items` and `sales` rows.

This is **not** a new canonical Reyna schema, a production product import, or an authoritative store inventory. Some original images are placeholders (for example the ceramic mug shows the espresso-machine photo). Do not create real products or inventory from this seed without team review.

The seed inserts only reserved `products.product_id` values `101..119` and local `sales.sale_id=901`, and preserves original product #1 at stock 10. The script *refuses* to start if products, orders, authentication, sessions, or sale records differ from its exact baseline. All writes run in a MySQL transaction and roll back on error. No ALTER, DROP, or table creation is used.

## Install and rule tests

1. Ensure the previous Phase 1 test run was **fully cleaned** (original product #1, stock 10, zero test orders/credentials/sessions). Close the old unified server on port 5180. Do not run any other Coffee Overflow server against the integration schema during this test.
2. Switch GitHub Desktop to `feature/hudson-unified-website`. Extract this ZIP **into the repository root**; it adds new files under `backend/src/unified` and one new documentation file under `docs`.
3. From the repository root in Windows CMD, run:

   ```cmd
   node --test backend/src/unified/catalogPhase2Data.test.js
   node --check backend/src/unified/catalogPhase2Data.js
   node --check backend/src/unified/catalogPhase2Db.js
   node --check backend/src/unified/seedLocalCatalogPhase2.js
   node --check backend/src/unified/catalogUnifiedSiteApp.js
   node --check backend/src/unified/startLocalCatalogPhase2.js
   node --check backend/src/unified/cleanupLocalCatalogPhase2.js
   ```

   Expected: **14 new pure-rule tests passing**, zero syntax errors. These do **not** touch MySQL. An actual MySQL/browser smoke test is still required.

## Stage only the synthetic catalog in the restricted database

From the repository root, run:

```cmd
node backend/src/unified/seedLocalCatalogPhase2.js
```

Enter the existing restricted `coffee_overflow_integration_app` MySQL password when prompted (hidden). The script refuses to run if any unexpected products, sales, auth credentials, sessions, orders or checkout events exist. On success it prints `SUCCESS: Added 19 temporary catalog products ...`.

**If the seed script stops, do not re-run blindly or insert/delete records by hand.** Share the error first. If the seed succeeded but the server was never started, the cleanup script can be run with `- -` to remove the catalog alone.

## Launch the Phase 2 test site

```cmd
node backend/src/unified/startLocalCatalogPhase2.js
```

Enter the restricted MySQL password and choose a **NEW test-only admin password** of 12+ characters (never share passwords). The launcher validates the 20 product rows, sale record, stock, zero accounts, zero orders/sessions; creates ONE synthetic admin; starts a loopback-only server at `http://127.0.0.1:5181`.

- Home: `http://127.0.0.1:5181/`
- Products: `http://127.0.0.1:5181/products.html`
- Customer account: `http://127.0.0.1:5181/login.html`
- Cart: `http://127.0.0.1:5181/cart.html`
- Protected Admin: `http://127.0.0.1:5181/integration/admin/`

Write down the **exact** `co-admin-...@example.test` email printed in CMD. Use only new synthetic `co-browser-...@example.test` customer data.

This test deliberately permits **one checkout order** containing up to **three different catalog products, with quantity 1–3 per product**. Do not attempt extra orders. For a useful integration test, add **1 Morning Blend Coffee ($14 sale)** and **2 Blue Coffee Overflow Hats ($12.99 each)**: expected subtotal $39.98, tax $3.30, total **$43.28**. The server recalculates all prices and uses the original transactional stock decrement and idempotency protections.

Log out of the customer session; sign in as the synthetic admin. Verify the order, choose Processing, then Fulfilled or Cancelled. Check the event history. Do not use real payment information.

## Exact cleanup (MANDATORY after browser testing)

Stop the port 5181 server first. Then run from the repository root:

```cmd
node backend/src/unified/cleanupLocalCatalogPhase2.js EXACT_ADMIN_EMAIL EXACT_CUSTOMER_EMAIL
```

Use the exact synthetic emails. If no customer was registered, replace customer with `-`. If seed succeeded but the server never started (and there are **no** accounts/orders), run:

```cmd
node backend/src/unified/cleanupLocalCatalogPhase2.js - -
```

The cleanup transaction verifies the exact account identities, roles, sessions, one order, recorded prices/tax, inventory by product, events, the 19 catalog records, and temporary sale. It restores purchased product stock if needed, removes only the named synthetic accounts/order plus temporary products/sale, and returns to **exactly product #1 stock 10**, with no orders, events, credentials, or sessions. If ANY check fails, it rolls back and leaves the database unchanged for inspection.

**Never run the older `cleanupLocalAdminVisual.js` after a Phase 2 catalog order**. It is only for the one-product Phase 1 fixture.

## Limitations / final product integration

- This remains a safe local demonstration of the original website and MySQL backend, **not** the shared team server on port 3000 or a production migration.
- Login and catalog are synthesized for test-only `@example.test` users. Passwords/session cookies are not deployed; security settings are loopback-specific.
- Coupon codes, payment handling, business-wide product images, user-facing order history, and production-ready account admin are not implemented in Phase 2.
- Inventory values came from the existing static HTML and must be approved by Reyna before any real deployment. The team still needs to align the canonical product schema, sales, order status, and credentials tables.
- Existing team HTML still includes a prototype "Add an item" selector in the cart. Remove that in a reviewed UI pass after catalog checkout is stable.
- Before committing Phase 2, run the original 118-test suite plus `catalogPhase2Data.test.js`. Verify cleanup success first. Keep all changes on `feature/hudson-unified-website`.
