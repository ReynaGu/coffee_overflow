# Coffee Overflow — Authenticated browser checkout: isolated local Express preview

**Branch:** `feature/hudson-checkout-integration`. **Local testing only; NOT public or production deployment.** No existing file is replaced. Do not merge to main before Isaac and Reyna review auth, schema, CSRF, and checkout.

## Prerequisites

- Local MySQL database `coffee_overflow_integration`, restricted account `coffee_overflow_integration_app` with the existing password. The database must be at fixture product #1 stock 10 and zero orders, requests, credentials and sessions. Other product data is untouched.
- Node dependencies from `backend` installed as in the previous 92 tests.
- Browser localhost origin `http://127.0.0.1:5177` unused (existing preview 5176 can remain running).
- **Do not change `backend/.env`**, `backend/src/server.js`, any teammate branch or `coffee_overflow_dev`.

## Install

Unzip from repo root, adding only:

- `backend/src/integration/integrationRules.js` and `.test.js`
- `backend/src/integration/localIntegratedApp.js`
- `backend/src/integration/startLocalIntegrated.js`
- `backend/src/integration/cleanupLocalShop.js`
- `admin/integration-shop.html`, `.css`, `.js`
- `docs/LOCAL_INTEGRATED_AUTH_CHECKOUT_BROWSER_V1.md`

Stop if Windows prompts to overwrite files. Do not commit before tests and cleanup.

## Test and launch

From CMD in repository root:

```
node --test backend/src/integration/integrationRules.test.js
node --check backend/src/integration/localIntegratedApp.js
node --check backend/src/integration/startLocalIntegrated.js
node --check backend/src/integration/cleanupLocalShop.js
```

Then:

```
node backend/src/integration/startLocalIntegrated.js
```

Type the restricted integration database password when prompted; it is hidden. The server binds only to `127.0.0.1:5177`, uses the existing `authService`, `authRoutes`, `sessionGuards`, `checkoutService` and `sharedOrderStore`, and refuses to start on another schema or unexpected test data.

Open `http://127.0.0.1:5177/integration/`.

1. The register form generates a synthetic `co-browser-XXXXXXXXXX@example.test` email. Keep that email for cleanup. Enter a new 12+ character **test-only password**. Register.
2. Sign in with the same synthetic address and password. The cookie is HttpOnly/SameSite Lax. The CSRF token stays in memory and is supplied on checkout. If you reload the page, sign in again for a CSRF token.
3. Click **Place local MySQL test order** once. This writes exactly 1 unit of product #1, server-calculates the total ($19.49), and reduces its stock from 10 to 9. There is **no payment**. It intentionally leaves this one order so you can inspect it.
4. For visual order inspection, use the separate previously-tested read-only admin preview (port 5176), if it is running. Click Refresh. Do NOT try to fulfill/cancel the test order before cleanup.

## Cleanup after visual inspection

In a **second CMD** at repository root (the local server can remain running):

```
node backend/src/integration/cleanupLocalShop.js co-browser-XXXXXXXXXX@example.test
```

Replace the argument with **the exact synthetic address you registered** (never pass a password on the command line). The script verifies the known fixture order, owner, order items, status, total and stock; restores the one unit; deletes the test order and synthetic account; cascades session and checkout token records; and checks the final database state before commit.

If it refuses cleanup, **stop** and inspect the database. Do not manually delete rows or rerun blindly. MySQL AUTO_INCREMENT values can advance during testing.

## Security boundaries / unresolved work

- This local app is NOT production authentication. HTTP cookies without the Secure attribute are permitted only for loopback. No HTTPS, public rate-limiting cluster, verified deployment origins or remote hosting are configured.
- Registration in this preview is limited to synthetic `@example.test` addresses. Admin sign-up is not provided and must never be public.
- Existing server.js remains unchanged; its checkout still fails closed until Isaac approves integration.
- The separate /api/admin order routes in this staging app use the trusted administrator guard and are **not accessible to customers**; a real admin account must be deliberately provisioned via reviewed team process. The full existing admin dashboard requires further data mapping and wiring.
- The shared products table is missing the current local inventory schema fields (image/active/category) and should be agreed with Reyna before final storefront integration.
- This project has no payment processing. An order is a local test record, not a paid purchase.
