# Coffee Overflow — Unified Site Phase 1 (local only)

Branch: `feature/hudson-unified-website` (based on `feature/hudson-checkout-integration` commit `48570f30`). This demonstration *reuses* the existing real team's HTML pages and checkout/auth/admin modules, rather than creating a second cart/backend. It retains the one-item fixture restrictions deliberately. **Do not merge this as a production site, and do not connect it to Reyna's shared DB.**

## Install

1. Verify you're on `feature/hudson-unified-website`, have committed/stashed unrelated edits, and `coffee_overflow_integration` was cleaned back to stock 10 and zero orders/accounts.
2. Extract package into your repository root, keeping folders. New files are `backend/src/unified/*`, `unified/*`, `docs/LOCAL_UNIFIED_WEBSITE_PHASE1.md`, and `INSTALL_UNIFIED_WEBSITE_PHASE1.js`. Do not extract into `backend` alone.
3. Run from project root: `node INSTALL_UNIFIED_WEBSITE_PHASE1.js`. This checks branch name, exact source anchors, and patches **only two existing JS files** (`assets/js/cart.js`, `assets/js/storefront-products.js`). Before modifying them it copies both originals to a dated folder in your Windows temp directory. It does not edit `backend/src/server.js`, other teammates' branches, MySQL schema, `.env`, or `main`.
4. Run `node --test backend/src/unified/unifiedSiteRules.test.js`, and `node --check backend/src/unified/localUnifiedSiteApp.js` and `node --check backend/src/unified/startLocalUnifiedSite.js`.
5. Run `node backend/src/unified/startLocalUnifiedSite.js`. Enter the restricted MySQL test DB password and a NEW 12+ char synthetic administrator password. **Keep CMD running.** Open `http://127.0.0.1:5180/` (the real Coffee Overflow home page). Browse `products.html`, which should show one `Checkout Integration Test Coffee` product at $18.00 with 10 in stock. A local warning banner should show.
6. Visit `http://127.0.0.1:5180/login.html`, register synthetic test customer, sign in. Browse products, Add to Cart (only one unit), go to cart and Place Order. **No payment is collected**. Verify the $19.49 receipt. The normal cart now sends same-origin session cookie and X-Coffee-CSRF. Note: the CSRF token is tab-scoped in sessionStorage specifically for this localhost preview; raw session cookie stays HttpOnly.
7. Open `http://127.0.0.1:5180/integration/admin/`, sign in using the synthetic admin email printed in CMD and test admin password, and verify the resulting order. You may choose processing + fulfilled or cancellation. Do not run two orders.

## Cleanup

Stop the test server with Ctrl+C. From repo root, run:

`node backend/src/integration/cleanupLocalAdminVisual.js <exact-synthetic-admin-email> <exact-synthetic-customer-email>`

This script verifies the fixture and restores stock, removing synthetic accounts and events. Never use `cleanupLocalShop.js` after editing order status. Never rerun cleanup blindly after an error. Nothing in this preview grants authorization to use real accounts or production data.

## Boundaries / next steps

- Phase 1 is **one real web origin with the actual pages**, but product/order API is *deliberately limited* to fixture product #1 and one order. The normal team server at port 3000 and its `test_products` API remain untouched.
- Full product catalog, discounts, schema migration, and production-grade authentication/deployment still require approval. For now, avoid real payment/discount claims.
- `backend/src/server.js` remains unchanged: the preview runs on its own port (`5180`), unlike the final production server.
- Local account sign-in requires a fresh login after restarting the server. The session cookie is HttpOnly and anti-CSRF token is stored only in tab-scoped sessionStorage for cross-page navigation; use a single browser tab for checkout testing.
