# Coffee Overflow — Shared MySQL Orders Read-Only Dashboard Preview (Local only)

**For `feature/hudson-checkout-integration` only.** Do not merge to `main` as a production admin feature.

This is a separate LOCALHOST-ONLY browser page that uses Hudson's `backend/src/admin/sharedOrderStore.js` adapter to show orders from Reyna's `coffee_overflow_integration` schema. It uses your existing `admin/admin.css` design. Nothing in Isaac's Express `server.js`, Jalen's checkout, `admin/admin.js`, or `admin/preview-server.js` is modified.

## Files (all new)

- `backend/src/admin/sharedOrderReadOnlyPreview.js` — separate HTTP server, binds only `127.0.0.1:5176`, requires a temporary code, and exposes GET-only shared order APIs.
- `backend/src/admin/sharedOrderReadOnlyPreview.test.js` — simulated store tests that check unauthenticated GET = 401, PATCH = 405 even when authenticated, valid login, details, stats, logout. No MySQL access.
- `admin/shared-orders-preview.html` — read-only Admin visual layout.
- `admin/shared-orders-preview.js` — interactive read-only Overview, Orders, filters, search, sorting and receipt modal.
- `docs/SHARED_ORDER_READONLY_PREVIEW_V1.md` — this file.

## Install and test safely

1. GitHub Desktop: on `feature/hudson-checkout-integration`, confirm **No local changes** before copying.
2. Extract the ZIP to a temporary folder and copy its `backend`, `admin` and `docs` directories into the root of `coffee_overflow`. This adds **five files**; **stop if prompted to overwrite**.
3. Open CMD in the repo root and run:

   ```cmd
   node --check backend/src/admin/sharedOrderReadOnlyPreview.js
   node --check admin/shared-orders-preview.js
   node --test backend/src/admin/sharedOrderReadOnlyPreview.test.js
   ```

   Expected: 1 comprehensive test passing, 0 failures.

4. Then run the existing suite with new tests:

   ```cmd
   node --test admin/local-order-store.test.js admin/local-order-routes.test.js admin/local-edit-api.test.js admin/demo.test.js admin/product-bridge.test.js backend/src/admin/orderRules.test.js assets/js/storefront-products.test.js backend/src/checkout/checkoutService.integration.test.js backend/src/admin/sharedOrderStore.test.js backend/src/admin/sharedOrderReadOnlyPreview.test.js
   ```

   Expected: 49 tests, 0 failures.

## Run the read-only integration preview

From repo root:

```cmd
node backend/src/admin/sharedOrderReadOnlyPreview.js
```

The process prompts for the password to your **restricted integration MySQL account** `coffee_overflow_integration_app`. It is hidden when you type. **Do not paste any password here or into chat.** It does NOT read `backend/.env` or modify its contents.

On successful startup, the terminal prints a random temporary access code and the local URL:

```
http://127.0.0.1:5176/admin/shared-orders-preview.html
```

Copy the random code shown in YOUR terminal (not the example in this document) into the browser sign-in form. Keep the CMD process open while using the preview; use Ctrl+C to shut it down. Each restart generates a new access code; sessions expire after 1 hour.

Initially, if the integration database is empty after smoke-test cleanup, the dashboard will correctly show **0 orders**. To populate it with a persistent test order for display, we need a follow-up fixture specifically designed for the integration environment; do NOT reuse realMysqlSmoke.js for that because it automatically deletes its order.

## Safety boundaries

- The preview is not Isaac's Express `/api/admin`, and does **not** change checkout/shopper authentication. It does NOT enable order editing, inventory changes, customer or discount CRUD.
- HTTP only on `127.0.0.1` and should NEVER be deployed. The randomly generated preview access code gates order data; session cookies are HTTP-only/SameSite strict, and no CORS headers are sent.
- Only GET read APIs are implemented: `/api/preview/stats`, `/api/preview/orders`, `/api/preview/orders/:id`; all other methods, including PATCH, return 405.
- The database account is schema-scoped but has write privileges for other tests. This preview code exclusively invokes the adapter's read methods: `stats`, `listOrders`, and `getOrder`.
- The current schema contains a dummy user row and lacks real auth/roles. This preview is only for **development inspection**, not true production administration.
- Your original `coffee_overflow_dev` three orders and stock will remain untouched.
- Don't push passwords, cookies, screenshots of the generated access code, or `.env` files.
