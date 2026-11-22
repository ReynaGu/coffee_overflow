# Coffee Overflow — Team order-schema alignment (Nov 19, 2026)

Based on `coffee_overflow.sql` merged from Reyna on `main` at `4ebbeaf8`, reviewed on Hudson's feature branch after merge `f0d661ab`. This is **an analysis and proposed group handoff**, not an executable migration. **Do not run ALTER/DROP/CREATE on Reyna's shared schema yet.**

## What exists in the shared SQL

| Entity | Reyna's schema | Current Hudson local/API assumptions | Required agreement |
|---|---|---|---|
| Products | `products(product_id, name, price DECIMAL(10,2), stock_quantity, description)` | local `products(id, name, price_cents INT, sale_price_cents INT, stock, active, category, image)`; `test_products` compatibility view | Canonical products model, image/category/visibility, sales; unit conversion |
| Orders | `orders(order_id, user_id, order_date, subtotal DECIMAL, tax DECIMAL, total DECIMAL)` | local order status, cents amounts, coupon, events, customer name/email | Add agreed status/discount and checkout rules |
| Order lines | `order_items(order_id, product_id, quantity, unit_price DECIMAL)` | immutable receipt lines with name snapshot, cents, line total | Decide how product names and prices are snapshotted |
| Users | `users(id, first_name, last_name, password VARCHAR(50), email, address fields)` | admin adapter expects `users(id, name, email, role, created_at)` | Define role and secure server-side authentication, password hashing (never plain text) |
| Discounts | `discounts(discount_id, discount_value DECIMAL, code)` | admin coupons with limits, type, expiration, used count | Decide percentage vs amount, one-code rule, redemption accounting |
| Sales | `sales(sale_id, sale_name INT)` + `sale_items(sale_id, product_id, sale_price DECIMAL)` | item sale price on product row | Sales relationship and type of `sale_name` |
| Cart items | `cart_items(cart_item_id, cart_id, product_id, qauntity)` | Jalen's cart currently browser-local | Typo: `qauntity` likely meant `quantity`; coordinate migration |

Additional observations from the SQL dump: it defines primary keys on `carts`, `orders`, `products`, and `users` but no `AUTO_INCREMENT`, foreign keys, or order status history. `order_items` has no primary key; the populated users row is a placeholder. These are design issues to resolve with the database owner, **not reasons to overwrite the dump without agreement**.

## Architecture decision for the team

- **Reyna (database):** confirm final table/column naming, `AUTO_INCREMENT` and keys, admin roles and secure user credentials, stock and order-events design, plus how `sales` are computed.
- **Isaac (backend):** confirm **Express + mysql2** remains the shared API, or propose a documented PHP migration. `backend/src/server.js` currently serves Express `GET /api/products` from `test_products`. Reyna's `db_connection.php` is a separate PHP PDO connection with root/blank default credentials; do not deploy or use that for admin authorization.
- **Jalen (cart):** shared checkout must authorize or identify the shopper, recalculate prices/tax on the server, and write `orders` + `order_items` while atomically decrementing stock. No real payment workflow has been verified. Never treat browser-submitted prices as authoritative.
- **Hudson (admin):** once those contracts are approved, adapt `backend/src/admin/mysqlAdminStore.js` to the actual schema; expose authenticated `GET /api/admin/orders`, `GET /api/admin/orders/:id`, `PATCH /api/admin/orders/:id/status`, stats, audit trail, cancellation inventory restore; connect dashboard to the shared routes. Do not bypass real `requireAdmin` middleware.
- **Hannah/Christopher:** review storefront/cart and agree on shared product visibility and sales fields.

## Proposed minimum order rules

`placed → processing → fulfilled`, or `placed/processing → cancelled`; `fulfilled/cancelled` terminal. The database should record `status`, a status-events/audit table, an order and line-item price snapshot, and a transactional stock update. Cancellation should restore stock once only and should not refund money automatically. Use an idempotency token for create-order requests so retries do not double-charge or double-deduct stock.

## Current verification state

**Verified locally by user:** MySQL product create/edit, storefront reads those products, cart displays them, 21 automated tests. **Not verified:** shared-schema checkout, MySQL order creation, shopper/admin auth, real coupons, payments, production deployment. The attached V2 test bridge creates separate `local_dev_*` tables to validate the order workflow safely before the team resolves the above design decisions.
