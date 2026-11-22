# Coffee Overflow — Protected visual order management (local only)

This package adds ONLY new files to branch `feature/hudson-checkout-integration`. It reuses the existing `createLocalIntegratedApp`, `createAuthService`, `createSessionGuards`, and `createSharedOrderStore`. It never modifies the team's `backend/src/server.js`, `.env`, `main` or `coffee_overflow_dev`.

## New files

- `backend/src/integration/adminVisualRules.js` + `.test.js`
- `backend/src/integration/localAdminVisualApp.js`
- `backend/src/integration/startLocalAdminVisual.js`
- `backend/src/integration/cleanupLocalAdminVisual.js`
- `admin/integration-admin.html`, `.css`, `.js`
- `docs/LOCAL_PROTECTED_VISUAL_ADMIN_V1.md`

## Before running

- Stop the existing port 5177 integration preview with Ctrl+C. Port 5176 read-only preview may remain running.
- Ensure `coffee_overflow_integration` has fixture product #1 at stock 10 and $18.00, zero orders, order items, order events, checkout requests, auth credentials, and auth sessions. The launcher verifies these and refuses to start otherwise.
- Use only the restricted `coffee_overflow_integration_app` MySQL user. No `.env` change needed.
- Use test-only passwords (not a personal or production password).

## Test and start

From the repository root in Windows CMD:

```cmd
node --test backend/src/integration/adminVisualRules.test.js
node --check backend/src/integration/localAdminVisualApp.js
node --check backend/src/integration/startLocalAdminVisual.js
node --check backend/src/integration/cleanupLocalAdminVisual.js
node --check admin/integration-admin.js
node backend/src/integration/startLocalAdminVisual.js
```

The launcher prompts (hidden) for the existing restricted integration DB password and then a NEW 12+ character **test administrator password**. It creates one synthetic user, assigns the role in trusted server-side SQL (not through an HTTP endpoint), then starts a loopback-only server on `127.0.0.1:5178`.

**Save the synthetic admin email printed by CMD** (for example `co-admin-abcdef123456@example.test`), but do not share the test password.

## Browser workflow

1. In browser open `http://127.0.0.1:5178/integration/`. Register a `co-browser-...@example.test` synthetic customer, sign in, and place ONE test order for product #1. Save the synthetic customer email. Expected order $19.49, stock 10 → 9. **Don't click checkout twice.**
2. You can sign out as customer. Open `http://127.0.0.1:5178/integration/admin/` and sign in with the **synthetic admin email printed in the terminal** and the test password you entered. All cookies are HttpOnly; admin UI only gets a CSRF token after signing in. The server checks admin role from MySQL on every request.
3. The dashboard should show exactly 1 order, 1 active order, $19.49 and its receipt. Open order details. Choose `Mark Processing`, then choose **EITHER** `Mark Fulfilled` (stock stays 9) **OR** `Cancel order` (stock restores to 10). Both changes write real events. Do not do both status branches on the same order because status transitions are terminal.
4. Clicking sign out should revoke the admin session; further protected API calls return 401.

This is still a **local integration demonstration**. It does not authorize use of production customer data, real payments, public admin creation, or internet deployment. Session cookies are intentionally `Secure=false` only on loopback HTTP. The per-process rate limiter is not an internet-facing protection. The approved final schema, deployment origin, session handling and front-end merge still require team review.

## Clean up immediately after the demo

Stop the visual server with Ctrl+C. In another CMD at the repo root, run (replace both emails with the EXACT synthetic emails from this run):

```cmd
node backend/src/integration/cleanupLocalAdminVisual.js co-admin-XXXXXXXXXXXX@example.test co-browser-XXXXXXXXXX@example.test
```

If no customer was registered, use `-` as the second argument instead of an email. Enter the restricted DB password when prompted.

The cleanup uses a transaction with strict ownership and stock checks: cancelled orders already restored stock, while placed/processing/fulfilled orders have one unit restored. It deletes only the named test identities, their fixture order and associated sessions, request token and activity events. Expected final `SUCCESS: ... stock 10; 0 orders, events, requests or auth sessions.`

If cleanup fails, **stop** and inspect the database. Never delete data blindly or rerun another fixture without a clean baseline. Do NOT use `cleanupLocalShop.js` after updating order status; that older script expects status `placed` and zero order events.

## Testing/limitations

Pure rule checks and JS syntax can be verified without MySQL. The previous `realAdminHttpSmoke.js` already passed the real HTTP lifecycle with authenticated admin and inventory changes; this new UI must still be verified in your Windows browser against your local DB. No deployment-ready login/auth or shared-schema migration is implied by a local pass.
