# Coffee Overflow — Local MySQL Product Bridge (Read-Only)

This incremental update applies **only to Hudson's existing `admin/` files** on the
`feature/hudson-admin-order-management` branch. No original teammates' files change.

## What this does

- The normal preview `http://localhost:5173/admin/` remains unchanged.
- **New local product view:** `http://localhost:5173/admin/?products=live`
- In that view, **Inventory** reads the existing `GET http://localhost:3000/api/products`
  endpoint. Its records are backed by the same `coffee_overflow_dev.products` table used
  by the `test_products` compatibility view you already created.
- The **Overview low-stock alert** also reads those real products.
- **All product editing is disabled** in this mode. Admin permissions and secure
  database writes have not yet been integrated.
- Orders, order metrics, discounts, and customers are explicitly labeled as **sample**.
- The `?live=1` fully authenticated admin mode is **not** enabled by this update.

## How to use it on Windows

1. Keep the current backend running in a Command Prompt in `coffee_overflow/backend`:
   `npm start` (uses your private `backend/.env` — never commit it).
2. Double-click `START_ADMIN_PREVIEW_WINDOWS.bat` in a separate window, unless it
   is already running on port 5173.
3. Open `http://localhost:5173/admin/?products=live`
4. Click **Inventory**. You should see **Sunrise House Blend: stock 7**.
5. From MySQL Workbench, in the **coffee_overflow_dev** database only, run:
   `UPDATE coffee_overflow_dev.products SET stock=6 WHERE id=1;`
6. Click **Refresh** on your dashboard. It should now say **6** and appear under
   Overview → Inventory alerts. Refresh `http://localhost:3000/api/products` to
   verify the same number appears there.

No changes to `backend/src/server.js` or `backend/src/controllers/productController.js`.
The local product bridge is intentionally **read-only**; the team needs to provide
real auth/session handling and agree on the final schema before enabling writes.

## If it fails

- If you see `Cannot reach team product API at port 3000`, start `npm start`.
- If you see `HTTP 500`, check MySQL connection settings and the terminal.
- If you still see demo records, check that the URL has `?products=live` and the
  label at the top says `Local MySQL products · read-only`.

## Automated tests

From the repository root, after copying the files:

```
node --test admin/demo.test.js admin/product-bridge.test.js backend/src/admin/orderRules.test.js
```

This is a **development-only bridge** from a public product API, not a mechanism for
administrative authorization or safe stock edits in production.
