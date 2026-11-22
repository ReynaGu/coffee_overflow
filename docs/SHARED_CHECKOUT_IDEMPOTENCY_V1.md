# Coffee Overflow — Shared Checkout Idempotency V1

**Branch:** `feature/hudson-checkout-integration` — integration testing ONLY. **Do not merge to main yet.**

## Prerequisites / database

Before this patch, `coffee_overflow_integration` already has the `checkout_requests` table with the DDL in `docs/sql/SHARED_CHECKOUT_IDEMPOTENCY_V1.sql`, **and zero rows**. You ran the SQL manually as the database administrator. Do not execute this script against `coffee_overflow_dev` or the shared production database.

## What changes

1. New helper `backend/src/checkout/checkoutIdempotency.js` claims and locks a checkout token inside the **same** MySQL transaction as Jalen's order insert, stock decrement and item records. An identical repeated request returns the saved original receipt. A different cart or user reusing the token gets `409`.
2. `backend/src/checkout/checkoutService.js`: opt-in `requireIdempotencyToken` option; existing isolated test scripts continue to use default `false`, and retain their behavior.
3. `backend/src/server.js`: Express checkout always uses `{ requireIdempotencyToken: true }`. **The shopper auth middleware still returns 401** until properly implemented by the team.
4. `assets/js/cart.js`: generates a browser UUID and stores it with a cart fingerprint before submitting. On retries of the same cart, the token is reused. After a successful receipt, the token is cleared. Browser session authentication still awaits Isaac's implementation.
5. New unit tests and a real MySQL smoke test. **No payment processing.**

## Install

1. Download and extract package into the `coffee_overflow` root. Confirm `feature/hudson-checkout-integration`, clean Git status before installation.
2. New files: installer, checkout helper, unit tests, MySQL smoke test, docs. If Windows asks to overwrite, stop.
3. From repo root, run:

   ```cmd
   node INSTALL_SHARED_CHECKOUT_IDEMPOTENCY_V1.js
   ```

   The installer checks the exact expected existing source, refuses a wrong branch or modified target files, and writes backups in the Windows temp directory outside Git. It modifies only three tracked files listed above. Do not run it twice.
4. Run:

   ```cmd
   node --check backend/src/checkout/checkoutService.js
   node --check backend/src/checkout/checkoutIdempotency.js
   node --check backend/src/server.js
   node --check assets/js/cart.js
   node --test backend/src/checkout/checkoutIdempotency.test.js
   ```

   Expected: **7 idempotency helper tests passed, 0 failed**.
5. Run existing 49-test suite (48 previous + 1 preview test):

   ```cmd
   node --test admin/local-order-store.test.js admin/local-order-routes.test.js admin/local-edit-api.test.js admin/demo.test.js admin/product-bridge.test.js backend/src/admin/orderRules.test.js assets/js/storefront-products.test.js backend/src/checkout/checkoutService.integration.test.js backend/src/admin/sharedOrderStore.test.js backend/src/admin/sharedOrderReadOnlyPreview.test.js
   ```

   These tests are isolated and should still pass. They do not write to MySQL.
6. Optional **real MySQL transaction test** after unit tests:

   ```cmd
   node backend/src/checkout/realMysqlIdempotencySmoke.js
   ```

   Requires restricted `coffee_overflow_integration_app` password, no `.env` change. Start with the fixture product #1 stocked at 10, **zero** orders, order items, order events and checkout requests. The smoke test inserts one order, replays the same token, checks changed-cart and changed-user rejection, and removes its rows/restocks. This may advance AUTO_INCREMENT sequences. If interrupted after commit, inspect MySQL before re-running.

## Additional team decisions needed

- Reyna: approve the checkout_requests table in the team's final migration and add the necessary keys, constraints and operational retention policy.
- Isaac: shopper login and authenticated sessions; real login must set `req.user` server-side. Add matching CSRF/cookie/CORS configuration (never trust a `user_id` from the browser).
- Jalen: review changes in `checkoutService.js` and `cart.js`, retry token requirements and receipt behavior.
- Hudson: keep the admin shared-order API authenticated; test status and inventory interactions with idempotent checkout.

**Caution:** `checkout_requests` exists only in isolated integration DB. If you enable a real shopper login on the team Express server, also make sure its DB_NAME points to an approved schema with the checkout_requests table and correct product fields. Do not point the existing local dev admin backend at the integration DB without a separate plan.
