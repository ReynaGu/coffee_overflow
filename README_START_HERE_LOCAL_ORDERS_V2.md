# Coffee Overflow — Hudson Admin: Local MySQL Test Orders (V2 after Reyna merge)

**Use ONLY on branch** `feature/hudson-admin-order-management`. This V2 package is built for the branch **after** Reyna's `coffee_overflow.sql` and `db_connection.php` were merged, verified at `f0d661ab` on Nov 19, 2026.

**IMPORTANT:** This patch does **not** adapt or overwrite Reyna's shared database tables. They currently differ from your existing local products schema and lack order status/history. This patch exercises the end-to-end **local test** checkout using *three clearly named `local_dev_*` tables* **only in** `coffee_overflow_dev`. It is a staging demonstration. It is not team production checkout, user authentication, or payment processing. The final group integration still requires agreement with Reyna/Isaac/Jalen (see `docs/TEAM_ORDER_SCHEMA_ALIGNMENT.md`).

## 1. Install on the correct branch

1. In GitHub Desktop, verify `feature/hudson-admin-order-management` and **No local changes**. The latest commit should include `f0d661ab` or a later one.
2. Extract this ZIP; **copy the files and folders inside it** to your `coffee_overflow` clone root (the folder with `products.html`, `cart.html`, `coffee_overflow.sql`, and `admin`). Every file in this ZIP is new. **If prompted to overwrite any existing file, stop.**
3. Open that repo root in File Explorer, click the address bar, type `cmd` and Enter. Run:

   ```cmd
   node INSTALL_LOCAL_ORDERS_V2.js
   ```

4. Expect: `SUCCESS: Local MySQL TEST checkout (V2) and admin Orders integration installed on the feature branch.` The installer checks the branch, Reyna's schema files, and exact code anchors before applying any edits; backs up the original four files in your OS temporary directory outside Git; and changes only:
   - `admin/local-edit-api.js`
   - `admin/preview-server.js`
   - `admin/admin.js`
   - `cart.html` (adds one script; Jalen's `cart.js` is not modified)

**Do not run the earlier V1 ZIP.** Do not commit yet.

## 2. Create isolated LOCAL test order tables

In **MySQL Workbench**, connect with the local MySQL administrator account you previously used to create `coffee_overflow_dev`, not the app's restricted account. Open **`docs/sql/LOCAL_DEV_ORDERS_V2.sql`**, check that it begins `USE coffee_overflow_dev;` after comments, and execute it. The file creates exactly three `local_dev_*` tables with `CREATE TABLE IF NOT EXISTS` and does not alter products, users, Reyna's SQL, or any other database.

Verify using:

```sql
USE coffee_overflow_dev;
SHOW TABLES LIKE 'local_dev_%';
```

Expected: `local_dev_orders`, `local_dev_order_items`, `local_dev_order_events`. Leave Reyna's new `coffee_overflow.sql` alone: **DO NOT import it into `coffee_overflow_dev`**, as its products schema would conflict with your live product records.

## 3. Restart both local servers (two separate CMDs)

- Isaac's Express backend at port **3000** (`npm start` inside `backend`).
- Admin preview at **5174** from the **repository root**:

```cmd
set ADMIN_PREVIEW_PORT=5174
node admin\preview-server.js
```

Your existing ignored `backend/.env` should still set `DB_NAME=coffee_overflow_dev` and `ADMIN_LOCAL_EDIT=1`. Never share or commit `.env`, database credentials, or the separate local admin password.

## 4. Test the complete local no-payment workflow

1. Go to `http://localhost:5174/products.html`. Add **one Sunrise House Blend** (a product you created earlier in local MySQL).
2. Open **`http://localhost:5174/cart.html?orders=local`**. The `?orders=local` suffix is essential. The page shows an explicit **Local MySQL test checkout** section and hides the normal browser-only Place Order button.
3. Use the prefilled **Test Customer** and `test@example.test`. Do not apply promo codes. Click **Place MySQL test order (no payment)**.
4. Note the generated order ID. Refresh `http://localhost:3000/api/products` and confirm the ordered product stock is **one lower** than before.
5. Open **`http://localhost:5174/admin/?products=editable&orders=local`**. Click **Orders**. If prompted, sign in using your **existing separate local admin password**.
6. Open the new order, change `placed` → `processing` → `cancelled`. Verify the status events and check that stock returns **exactly once**.

The normal `cart.html` checkout continues to be browser-only demo behavior. No customer pays anything; the local test customer does not represent a real account.

## 5. Run tests before committing

In CMD at the repo root:

```cmd
node --test admin/local-order-store.test.js admin/local-order-routes.test.js admin/local-edit-api.test.js admin/demo.test.js admin/product-bridge.test.js backend/src/admin/orderRules.test.js assets/js/storefront-products.test.js
```

The 21 existing tests plus 8 new tests should total **29 tests**, 0 failures. They do not replace the live MySQL browser test. Inspect the modified files in GitHub Desktop before committing, especially `cart.html` (a teammate-owned file). Never commit `.env`.

**Suggested commit after successful manual and automated checks:** `feat(admin): verify local MySQL order workflow against merged team schema`.

## 6. Team integration: not complete yet

Read `docs/TEAM_ORDER_SCHEMA_ALIGNMENT.md` before migrating to Reyna's shared `orders` table. Reyna's new schema uses `orders.order_id`, `order_date`, DECIMAL prices, and `products.product_id`/`stock_quantity`, while our existing dev products use `id`, `price_cents`, and `stock`. We must agree on status fields, snapshots, authorization, and a unified backend before enabling shared writes. This V2 local proof intentionally keeps those databases separate.
