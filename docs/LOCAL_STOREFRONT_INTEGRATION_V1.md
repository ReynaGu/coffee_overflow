# Coffee Overflow — local storefront/MySQL bridge

**Target branch:** `feature/hudson-admin-order-management`, after merging team main at `c9f7207e`.

**Goal:** Show a MySQL product created/edited through Hudson's admin module on the existing customer-facing Products page, and let Jalen's `CoffeeCart.add()` use that same product's ID, price (integer cents), sale, and stock.

## What the installer changes

- `products.html`: Adds **one** `<script src="./assets/js/storefront-products.js"></script>` tag after the existing cart script. The page's original Bootstrap layout and static markup are kept, but the new script replaces the placeholder product cards at runtime when the page loads.
- `assets/js/cart.js`: Enables product API loading, disables demo cart seeding, translates `price_cents` and `sale_price_cents` correctly (they are already cents!), uses `image` paths, and filters inactive products client-side. Jalen's cart UI, localStorage, tax calculations, and demo checkout remain in place.
- `assets/js/storefront-products.js`: New page script. Renders live cards, enables search/category/price/availability/sale filtering and sorting, and adds `js-add-to-cart` attributes used by Jalen's existing click handler.
- `assets/js/storefront-products.test.js`: Five automated tests for mapping, active filtering, searching/filtering/sorting and HTML-escaping.

Nothing in `backend/`, `admin/`, `.env`, MySQL, or `main` is changed by the installer. The **two existing teammate files above WILL be modified in your FEATURE BRANCH**; review those diffs with Hannah and Jalen before merging into `main`.

## How to install (Windows)

1. In GitHub Desktop confirm **Current Branch** is `feature/hudson-admin-order-management`; no local changes.
2. Extract the ZIP, copy its **contents** to the **root of the cloned repo**, merging new `assets/js` and `docs` files. If asked to overwrite existing files, STOP. None of the copied files should already exist.
3. From the cloned repo root (File Explorer address bar > `cmd`), run:

   ```cmd
   powershell -NoProfile -ExecutionPolicy Bypass -File ".\INSTALL_STOREFRONT_PREVIEW.ps1"
   ```

4. If the script reports a mismatch, it deliberately did not alter existing files. Review before retrying; do not force replacement.
5. Run Isaac's backend (`cd backend && npm start`) and start the admin preview (`START_ADMIN_PREVIEW_WINDOWS.bat`, which may use port 5174 in your setup).
6. Open `http://localhost:5174/products.html` (use 5173 instead if that's your running preview port). **Do not use file://**. Confirm the products match `http://localhost:3000/api/products` except inactive items.
7. Add a visible, in-stock product to cart. Open `/cart.html`, confirm quantity and sale/regular price. You may need to clear preexisting demo items from an earlier prototype.
8. On the admin page set that product inactive; refresh products.html. It should disappear from the storefront, while the existing `/api/products` API will still list it (backend privacy filtering is not implemented yet).
9. Run tests from repo root:

   ```cmd
   node --test assets/js/storefront-products.test.js
   node --test admin/demo.test.js admin/product-bridge.test.js admin/local-edit-api.test.js backend/src/admin/orderRules.test.js
   ```

**Do not commit/push until both the Products and Cart pages pass a browser check** and the GitHub Desktop changes match the files above.

## Boundaries / not yet production ready

- Jalen's `cart.js` currently stores carts, discount codes and orders in browser `localStorage`. **Clicking Place Order does NOT create a real MySQL order or reserve stock**. We leave this untouched until checkout/auth integration is planned with the team.
- The public `/api/products` endpoint presently returns inactive items. Client-side filtering hides them visually, but this is NOT a security boundary; Isaac should filter active items server-side before deployment.
- This bridge assumes the **local** MySQL `test_products` view exposes `product_id`, `name`, `description`, `category`, `image`, `price_cents`, `sale_price_cents`, `stock`, `active`. Reyna's final schema must be reviewed before production deployment.
- `API_URL` is `http://localhost:3000/api/products`, so this is a local development preview, not a deployed site.
- If the API is down, the storefront displays an error instead of selling fake sample products.
- One development-only `PowerShell` installer is added at the repo root. It backs up the original `cart.js` and `products.html` under your Windows **TEMP** folder, outside the Git repository.

## Review and ownership

Hannah reviews the layout change in `products.html`. Jalen reviews changes to his `cart.js`. Hudson owns the new storefront bridge and its tests. Isaac and Reyna coordinate the final schema/API contract and server-side visibility/auth/checkout rules.
