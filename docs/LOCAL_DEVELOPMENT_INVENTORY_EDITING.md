# Coffee Overflow — Local Inventory Editing (Hudson, development only)

**Branch:** `feature/hudson-admin-order-management`. **Database:** exclusively `coffee_overflow_dev`.
This increment replaces **only files belonging to Hudson** (under `admin/`) and adds this handoff document. Do not merge to `main` without team review.

## What it does

- Keeps the existing **sample preview** at `http://localhost:5173/admin/` unchanged.
- Keeps **read-only product bridge** at `http://localhost:5173/admin/?products=live` unchanged.
- Adds **local development edit** at `http://localhost:5173/admin/?products=editable`.
- Product list/low-stock counts are still retrieved from Isaac's **existing** `GET http://localhost:3000/api/products` endpoint and the shared local MySQL product row.
- Click **Edit** on an existing product. A local development password authorizes changes to `stock`, `price_cents`, `sale_price_cents`, and `active` only. Click Save; the development-only service writes the same record in `coffee_overflow_dev.products`.
- Orders, discounts, customers and order-related metrics stay **sample data**. This is **not** login, checkout integration, production auth, or a multi-user admin system.

## Safe local configuration

1. `npm install` in `backend/` if not already done (you previously installed it).
2. Open `backend/.env` locally (the existing file that already contains your DB settings). Keep the five existing `DB_*` values and add the two lines below **using your own distinct local password**:

   ```dotenv
   ADMIN_LOCAL_EDIT=1
   ADMIN_LOCAL_EDIT_PASSWORD="REPLACE_WITH_A_NEW_12_PLUS_CHARACTER_DEV_PASSWORD"
   ```

   **Do not** reuse `DB_PASSWORD`. Passwords containing `#` must be enclosed in double quotes. **Never share or commit `.env`**.
3. Confirm `DB_NAME=coffee_overflow_dev` (not a team/shared production database), and MySQL account `coffee_overflow_app` has `SELECT` and `UPDATE` permissions **only** on that database.
4. **Restart the preview server**: stop the terminal running `START_ADMIN_PREVIEW_WINDOWS.bat` (Ctrl+C), then start it again. You should see `LOCAL DEV EDIT ENABLED` in its terminal message. If startup reports a password or database restriction error, fix the private config, not the source code.
5. In a separate terminal keep team Express running with `cd backend` then `npm start`. This reads your local DB through Isaac's original API.
6. Open **`http://localhost:5173/admin/?products=editable`**; click Inventory → Sunrise House Blend → Edit; enter your **distinct local development password** when asked.
7. Modify `stock` from 7 to **15** and save. Refresh `http://localhost:3000/api/products`: `stock` must be **15**. Then check Overview low-stock alert: 15 is no longer low stock. Optional: set sale price to $15.00 while regular price remains $18.00.

## Safety and security limits

- Server binds **only** `127.0.0.1`; validates Host and Origin for local admin mutations.
- A separate local password (minimum 12 characters), HTTP-only SameSite cookie, short-lived in-memory session, and simple login throttling protect edits. Cookie expires on server restart or within two hours. **This is not production administrator authentication**.
- No CORS allowance for write routes; a custom request header is required. Only configured `coffee_overflow_dev` accepted at startup, otherwise the server refuses local writes.
- SQL queries are parameterized; edits validate field types/ranges and use a MySQL transaction with `SELECT ... FOR UPDATE` and optimistic conflict detection. A stale page must refresh instead of overwriting a change.
- Public file serving explicitly allowlists frontend assets and excludes `.env`, backend implementation, `.git`, and other sensitive files. The local edit service never gives the MySQL password to the browser.
- Does not modify Isaac's `backend/src/server.js`, `productController.js`, or any other teammate files.
- Does not authorize write access for visitors to the actual website, and does not activate `backend/src/admin/adminRoutes.js`. Production needs Isaac's real server-side account/session/role middleware, CSRF controls, and agreed schema with Reyna before merging.
- Because this is a local-only development integration, **never deploy this preview server to the Internet**, and never use the dev password as a real production admin login.

## Automated tests

From the root of `coffee_overflow`:

```powershell
node --test admin/demo.test.js admin/product-bridge.test.js admin/local-edit-api.test.js backend/src/admin/orderRules.test.js
```

The tests do not touch real MySQL: they use a fake MySQL connection for validating API security and inventory transitions. The browser/live-MySQL result needs to be verified separately using the checklist above.

## Git review

Expected files:

- Modified: `admin/admin.js`, `admin/preview-server.js`
- Added: `admin/local-edit-api.js`, `admin/local-edit-api.test.js`, `docs/LOCAL_DEVELOPMENT_INVENTORY_EDITING.md`

Any change to `backend/.env`, an existing teammates' file, or a shared SQL schema is **not part of this patch** and should not be committed.
