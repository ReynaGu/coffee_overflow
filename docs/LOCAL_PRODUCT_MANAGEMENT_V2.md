# Coffee Overflow — Hudson's Local Product Management v2

## Purpose

**Feature branch only:** `feature/hudson-admin-order-management`.
This patch adds local **product creation** and complete editing of **name, description, category, existing image path, stock, regular price, sale price, and active flag** to Hudson's admin dashboard. It builds on the already tested stock-edit functionality. **No original team files are replaced.**

This is a local development workflow. It is **NOT** secure production login, real checkout integration, or a shared published admin system.

## Install

Copy the ZIP's `admin/` and `docs/` folders into the cloned `coffee_overflow` root. Confirm GitHub Desktop is on the feature branch.

Only these four files should appear in Changes:

- **Modified:** `admin/admin.js`
- **Modified:** `admin/local-edit-api.js`
- **Modified:** `admin/local-edit-api.test.js`
- **Added:** `docs/LOCAL_PRODUCT_MANAGEMENT_V2.md`

All teammates' original files should remain untouched. Never commit `backend/.env`.

## Start up

1. Keep the existing `backend/.env` configuration. `DB_NAME=coffee_overflow_dev`, `DB_USER=coffee_overflow_app`, `DB_HOST=127.0.0.1` or `localhost`, `ADMIN_LOCAL_EDIT=1`, and a **separate** `ADMIN_LOCAL_EDIT_PASSWORD` of 12+ characters are still required. No new credentials are needed.
2. Make sure MySQL80 is running.
3. From `backend/`, run `npm start` to start the team's unchanged public product API on `localhost:3000`.
4. Restart the local admin preview by closing its old window and running `START_ADMIN_PREVIEW_WINDOWS.bat` from the repo root. Admin preview listens on `127.0.0.1:5173`.
5. Open `http://localhost:5173/admin/?products=editable`, click Inventory. Existing Sunrise House Blend should show the stock you last saved.
6. Click **+ New product**, sign in with the separate local admin password if prompted, and create a test product. Example:
   - Name: `Roaster Test Blend`
   - Description: `Fresh locally roasted test coffee`
   - Category: `Coffee`
   - Image path: `/assets/images/Pile_of_coffee_beans.jpeg`
   - Stock: `12`
   - Regular price: `$24.00`
   - Sale price: `$19.99`
   - Visible: `Yes`
7. Refresh `http://localhost:3000/api/products`. The new product should appear with its own `product_id` because the existing `test_products` compatibility view selects from the same `products` table.
8. Back in admin Inventory, edit the new product's name, prices or stock, and save. Refresh the team API to confirm the change. You can change Visible to No to set `active:0`.

**Important:** Isaac's current GET `/api/products` view still returns products with `active:0` because your local `test_products` compatibility view does not filter them. `active:0` is stored, but it does **not** yet remove those products from the customer-facing storefront. Christopher and Hannah will need to agree on filtering and connecting the static HTML page to the API. The public storefront's three hardcoded product cards remain unchanged.

There is **no image upload**. Image paths must refer to existing files under `/assets/images/` and use `.jpg`, `.jpeg`, `.png`, or `.webp`. Product deletion is not included; deactivation preserves product IDs and historical orders.

## Security boundaries

- Never run the local preview server on a public internet host or expose the port outside your computer.
- Editing remains gated by the existing local password and session cookie, origin checks, localhost-only server, parameterized SQL, validated fields, and `coffee_overflow_dev` database restriction.
- Existing-product edits check all prior values inside a transaction; if another edit changed the product, the API returns HTTP 409 and asks to refresh rather than overwriting it.
- The local development user's database permissions must remain limited to `coffee_overflow_dev`. Product creation now requires `INSERT` permission there, in addition to `SELECT` and `UPDATE`.
- Final integration still needs Isaac's real server-side administrator authorization, security testing, Reyna's actual schema, and team code review. Never merge this local preview server to production or treat its password as a deployed admin login.

## Test command

From the repository root:

```powershell
node --test admin/demo.test.js admin/product-bridge.test.js admin/local-edit-api.test.js backend/src/admin/orderRules.test.js
```

Automated tests use fake database connections, **not the actual MySQL server**. Test against your real `coffee_overflow_dev` instance as shown above before committing.
