# Coffee Overflow — Real MySQL authenticated HTTP checkout smoke test

**Target branch:** `feature/hudson-checkout-integration` only. **Not a production deployment.**

## What's added

- `backend/src/auth/realHttpCheckoutSmoke.js` — standalone CLI script. It imports the existing auth service and HTTP routes, server-side session guards, Jalen checkout router/service, and Hudson shared-order adapter. It starts a temporary Express instance bound to **127.0.0.1 only** on a dynamically assigned port, without touching `backend/src/server.js` or `.env`.

## Database prerequisites (already created on user's isolated machine)

- `coffee_overflow_integration`, restricted account `coffee_overflow_integration_app`.
- Reyna's 9 tables, with users, products, orders primary keys supporting AUTO_INCREMENT.
- Unique `users.email` index; `auth_credentials` and `auth_sessions` tables.
- Local-only `orders.status`, `order_events`, `checkout_requests` additions.
- Product #1 is `Checkout Integration Test Coffee`, price 18.00, stock **10**.
- `orders`, `order_items`, `order_events`, `checkout_requests`, `auth_credentials`, `auth_sessions` must be **empty**. The imported placeholder user `id=0` may remain; it is never used as an authenticated shopper.

Do **not** change `backend/.env`, grant new privileges, truncate any table, or rerun the schema SQL. The real MySQL fixtures have already been cleaned after earlier tests.

## Install and run

1. In GitHub Desktop select `feature/hudson-checkout-integration`; ensure clean working tree.
2. Extract this archive and copy its `backend` and `docs` folders to the repo root. It adds **only two files**, so stop if Windows asks to overwrite anything.
3. In Windows CMD from `coffee_overflow` repository root, run:

   ```cmd
   node --check backend/src/auth/realHttpCheckoutSmoke.js
   node backend/src/auth/realHttpCheckoutSmoke.js
   ```

4. Enter the **restricted integration DB password** in the hidden prompt (never send it or record it in Git).
5. Expect output describing successful restricted DB preflight; HTTP registration/login, denied customer admin access, denied checkout without CSRF; real order $19.49 + idempotent replay + stock 10→9; shared adapter receipt/stats; logout; and successful cleanup restoring stock 10 with zero test records.
6. Do **not commit/push** until real MySQL output is reviewed. Keep the team Express server and demo admin server unchanged.

## Safety and limitations

- This writes one **synthetic customer** and one checkout order to `coffee_overflow_integration`, then deletes only that fixture after verifying identity and stock under a transaction. It may advance `AUTO_INCREMENT` counters, which is normal.
- The script verifies the clean fixture **before** making writes. It refuses mismatched data. If the process is forcibly terminated, cleanup cannot be guaranteed; inspect MySQL before rerunning. If cleanup refuses to proceed, **do not** manually delete tables or rerun until the failed rows are reviewed.
- This is a real HTTP and database end-to-end smoke test, **not** proof of production readiness. `backend/src/server.js` still uses `shopperAuthNotConfigured` and returns 401. The live admin API is still unmounted.
- Cookies are intentionally `Secure=false` for **127.0.0.1 only** in this test; real deployment requires HTTPS and `Secure` cookies. The HTTP app is temporary and loopback-only, not internet-accessible. The route's simple in-process rate limit is **not** sufficient for production use.
- No real payments, refunds, discount handling, admin promotion, or deployed login forms are created. Reyna/Isaac/Jalen must review the team-wide schema and authentication design before production integration.
