# Group 6: Hudson — Admin / Order Management Handoff

**Project:** Coffee Overflow, CS 3773, Fall 2026  
**Branch:** `feature/hudson-admin-order-management`  
**Backup:** `backup/pre-admin-integration-2026-11-11` at commit `fad9679c30bdb668e60929ce34aa79207a774114`

## What is delivered

| Path | Purpose | Shared files modified? |
| --- | --- | --- |
| `admin/index.html` | Isolated dashboard HTML | No |
| `admin/admin.css` | Responsive coffee-colored dashboard styling | No |
| `admin/admin.js` | Customer/order/product/coupon UI, API client, receipts and status actions | No |
| `admin/demo-data.js` | **Clearly labeled sample-data preview**, stored only in browser localStorage | No |
| `admin/preview-server.js` | Local static preview, no backend dependency | No |
| `backend/src/admin/orderRules.js` | Order transition rules | No |
| `backend/src/admin/mysqlAdminStore.js` | Optional MySQL adapter for an agreed shared schema | No |
| `backend/src/admin/adminRoutes.js` | Express admin routes, **requires actual server-side authorization** | No |
| `backend/src/admin/orderRules.test.js` | Node automated tests for status rules | No |
| `START_ADMIN_PREVIEW_WINDOWS.bat` | Starts the preview on Windows | New root file only |

**The entire patch is additive**: it contains no replacement for the existing `index.html`, `products.html`, `backend/src/server.js`, `backend/src/config/db.js`, existing routes, controllers or CSS.

## Preview for tomorrow's call

From the **repository root**, double-click `START_ADMIN_PREVIEW_WINDOWS.bat` or run:

```powershell
node admin/preview-server.js
```

Open `http://localhost:5173/admin/`. **Orange 'Preview / sample data' label means the browser-local demo.** It can edit demo orders, coupons, products and customers; changes remain in that browser only. Press **Reset preview** to restore fixtures.

To switch to actual shared API mode, open `http://localhost:3000/admin/?live=1` **only after** the team has mounted the admin router, implemented session authorization, and established the shared database tables. If those are missing, the page explicitly displays a connection error; it never silently substitutes demo orders.

## Required shared system agreements

1. **Reyna (database)** — confirm exact table/column names for `users`, `products`, `coupons`, `orders`, `order_items` and `order_events`. The adapter currently assumes the names documented below. The existing team product endpoint reads `test_products`, so **that table is not automatically compatible with the adapter**.
2. **Isaac (backend)** — supply real `requireAdmin` Express middleware, which must reject unauthenticated (`401`) and non-admin (`403`) requests. It must set `req.user.id` from a trusted session, not an HTTP client claim. Confirm the Express server can serve the static `/admin/` files. Add router mount only after authentication exists.
3. **Jalen (checkout)** — insert orders and immutable `order_items` receipt lines into the shared database. Checkout must decrease stock in the *same transaction* as order creation. Use 8.25% tax, with the prices and discounts snapshotted at checkout.
4. **Christopher (products)** — agree on `products.id`, stock, price, sale, active fields and ensure the storefront and admin use the **same** inventory. Existing `test_products.product_id` will need mapping or migration.
5. **Hannah (frontend)** — optionally add an admin navigation link **after** login/role enforcement; no frontend page replacement required. Keep the admin dashboard on `/admin/`.
6. **Hudson (admin)** — own admin UI, order search and sorting, receipts and audit history, status transitions, inventory-aware cancellation, testing, demonstration and docs.

## Proposed MySQL record contract — MUST be confirmed with Reyna

```
users:       id, name, email, role, created_at
products:    id, name, description, category, image, price_cents, sale_price_cents, stock, active
coupons:     id, code, type, amount, min_subtotal_cents, usage_limit, used_count, active
orders:      id, user_id, status, subtotal_cents, discount_cents, tax_cents, total_cents,
             coupon_code, created_at
order_items: order_id, product_id, product_name, quantity, unit_price_cents, line_total_cents
order_events: id, order_id, actor_user_id, from_status, to_status, note, created_at
```

Do **not** create duplicate `orders` or `products` tables if the team has already designed them. Adapt `mysqlAdminStore.js` to the agreed names and schema. Monetary fields should be integer cents.

## API contract, once wired

| Method | Endpoint | Responsibility |
| --- | --- | --- |
| GET | `/api/admin/stats` | Revenue, pending, fulfilled, low stock |
| GET | `/api/admin/orders?sort=date-desc&status=all&search=` | Search and sort history |
| GET | `/api/admin/orders/:id` | Receipt with lines and audit trail |
| PATCH | `/api/admin/orders/:id/status` | Server-validated status change |
| GET/POST | `/api/admin/products` | Inventory listing / create product |
| PATCH | `/api/admin/products/:id` | Edit products and sales |
| GET/POST | `/api/admin/coupons` | List / create discounts |
| PATCH | `/api/admin/coupons/:id` | Edit discounts |
| GET | `/api/admin/users` | Customer list (no password hashes) |
| PATCH | `/api/admin/users/:id` | Edit name and email, not privilege levels |

**Order status lifecycle:** `placed → processing → fulfilled`. Active orders (`placed` or `processing`) may be cancelled. `cancelled` and `fulfilled` are terminal; reapplying the same status changes nothing. On cancellation stock is restored once, within a transaction; the coupon usage is adjusted only if team checkout counts it at order placement.

## Mounting code (DO NOT ADD TO server.js UNTIL TEAM APPROVES AUTH + SCHEMA)

```js
const {createAdminRouter} = require('./admin/adminRoutes');
const {createMysqlAdminStore} = require('./admin/mysqlAdminStore');
const pool = require('./config/db');
const requireAdmin = require('./middleware/requireAdmin'); // real implementation by Isaac

app.use('/api/admin', createAdminRouter({
  store: createMysqlAdminStore(pool),
  requireAdmin
}));
```

The middleware above is a **proposal**; `./middleware/requireAdmin` does not yet exist in the team repository. Do not replace it with an always-allow stub. If using cookie sessions, implement CSRF protection / same-origin request checks before turning on admin writes. Only authorized administrators should use the live endpoints, and the backend must reject unauthorized API calls even if someone visits the static HTML page.

## Testing / graduation criteria

Quick syntax and rule tests:

```powershell
node --test backend/src/admin/orderRules.test.js
node --check backend/src/admin/mysqlAdminStore.js
node --check backend/src/admin/adminRoutes.js
node --check admin/admin.js
```

**These do not prove MySQL integration.** Before merging, separately test registration → checkout → admin receipt → processing → fulfilled, and cancellation restoring inventory once; check permissions; and verify sorting by date, customer and amount. Review concurrent cancellation attempts and checkout-stock coordination against an actual MySQL instance.

## GitHub safety

Work in `feature/hudson-admin-order-management`. Do not commit directly to `main`. Review the changed-file list: only the paths in the table above and files under `docs/` should be added. Open a pull request for group review, not an immediate merge. Keep the backup branch untouched.
