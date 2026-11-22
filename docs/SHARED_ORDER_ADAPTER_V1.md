# Coffee Overflow — shared order adapter V1 (Reyna + Jalen + Hudson)

**Branch only:** `feature/hudson-checkout-integration`

## What this adds

- `backend/src/admin/sharedOrderStore.js` — standalone adapter for Reyna's shared `orders`, `order_items`, `products`, `users`, and the provisional `order_events` table. Converts DECIMAL dollars to integer cents for the existing Hudson admin dashboard; exposes `listOrders`, `getOrder`, `stats`, and transactional `updateStatus`.
- `backend/src/admin/sharedOrderStore.test.js` — 11 isolated tests using a fake mysql2 pool; no MySQL connection or database writes.

These **do not modify or replace** `backend/src/admin/mysqlAdminStore.js`, `admin/local-order-store.js`, `backend/src/checkout/checkoutService.js`, `backend/src/server.js`, or any teammate UI files. No `.env`, migrations, secrets, or authentication changes.

## Prerequisites

Your **isolated** `coffee_overflow_integration` already has:
- Reyna's original nine tables, including `products.product_id`, `orders.order_id`, `order_items`, `users`.
- `orders.order_id` and `products.product_id` configured as `AUTO_INCREMENT`.
- A provisional `orders.status` enum (`placed`, `processing`, `fulfilled`, `cancelled`) with default `placed`.
- An `order_events` table with `id`, `order_id`, `actor_user_id`, `from_status`, `to_status`, `note`, `created_at`.

No SQL changes are required for the V1 adapter tests.

## Install safely

1. Open GitHub Desktop; confirm current branch is `feature/hudson-checkout-integration` and **0 changed files**.
2. Extract the ZIP. Copy its contents into your `coffee_overflow` repository root (the same folder containing `backend/`, `admin/`, and `coffee_overflow.sql`).
3. Only three **new** files should be added: this README and the two JavaScript files above. If Windows asks to overwrite anything, **stop**.
4. Open CMD in repo root and run:

   ```cmd
   node --test backend/src/admin/sharedOrderStore.test.js
   ```

   Expected: **11 passed, 0 failed**. These tests use a simulated DB.
5. Then run the combined suite:

   ```cmd
   node --test admin/local-order-store.test.js admin/local-order-routes.test.js admin/local-edit-api.test.js admin/demo.test.js admin/product-bridge.test.js backend/src/admin/orderRules.test.js assets/js/storefront-products.test.js backend/src/checkout/checkoutService.integration.test.js backend/src/admin/sharedOrderStore.test.js
   ```

   Expected: **48 tests, 0 failures** (37 prior + 11 new).

Do not commit or push until both pass and the file changes are reviewed in GitHub Desktop.

## Adapter contract

The adapter returns the object shapes your existing admin UI already expects:

- `listOrders({sort,status,search})` → `{orders,count}` with `{id,customer_name,customer_email,status,subtotal_cents,discount_cents,tax_cents,total_cents,coupon_code,created_at}`.
- `getOrder(id)` → one order plus `items[]` with cents-priced line totals and `events[]`.
- `stats()` → `{orders,pending,fulfilled,revenue_cents,low_stock}`.
- `updateStatus(id,{status,note},actor)` → guarded `placed→processing→fulfilled` or cancellation. Requires **verified** `{id,role:'admin'}` in the server context; the eventual server route must separately enforce real admin authentication.

In Reyna's current dump, `users` uses `first_name` / `last_name`, not `name`, and products use `stock_quantity` / DECIMAL `price`, not `stock` / `price_cents`. The adapter translates these differences without rewriting any tables.

A shared checkout order has **no persisted 'placed' event** yet. The adapter shows a clearly labeled *display-only* entry based on the order date. Later we should update the checkout transaction to write an actual placed event once the team approves the final schema.

## Integration still pending — do not mount prematurely

- **No live admin HTTP route is enabled.** `server.js` remains unchanged. Do NOT use a fake `requireAdmin` middleware. A matching real login, role system and server sessions are required first. All role checks must be based on verified server-side identity; never trust browser-submitted `role` or `user_id`.
- The adapter handles **orders only**. Full shared `products`, `users`, and `coupons` API still requires a schema-aware team adapter and confirmed authorization.
- Shared checkout does not yet have a **deduplicated checkout request token**; its original local test checkout does, but they are different endpoints.
- Reyna's order items preserve the **unit price**, not a snapshot of product name; the UI currently displays the latest product name. Name snapshots should be agreed before launch.
- The current integration database contains an imported dummy/placeholder user and is **not** a production identity provider. Do not use the dummy user as authentication proof.
- Sales/discounts, payments/refunds, frontend shipping and tax policy, and product visibility remain team decisions.
- This code is intentionally **not** connected to the existing `?orders=local` preview, which stays on `coffee_overflow_dev` and continues to show your original three test orders.

## After tests

Next step is a separate **controlled real MySQL adapter smoke test** on `coffee_overflow_integration`, using the restricted account and a test identity inside the harness. Then coordinate real admin auth with Isaac, checkout events/idempotency with Jalen, and schema changes with Reyna before exposing a shared `/api/admin` API.
