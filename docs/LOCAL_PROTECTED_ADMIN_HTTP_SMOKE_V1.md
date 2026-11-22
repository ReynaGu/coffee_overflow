# Coffee Overflow — Protected Admin HTTP Order Lifecycle Smoke Test (V1)

**Scope:** `feature/hudson-checkout-integration`, isolated `coffee_overflow_integration` MySQL database, loopback only. This is a test script, not production administration or a permanent admin login UI.

This package **only adds**:
- `backend/src/integration/realAdminHttpSmoke.js`
- this instruction file

It does not alter `backend/src/server.js`, existing routes, the `.env`, `coffee_overflow_dev`, `main`, or teammates' branches.

## Before running

- Ensure the prior browser fixture **was cleaned up**. The script refuses to start unless product #1 (`Checkout Integration Test Coffee`, $18.00) has stock **10**, and orders, order_items, order_events, checkout_requests, auth_credentials, and auth_sessions are empty.
- Stop any currently-running **5177** integrated browser preview to avoid concurrent local checkouts while testing. The independent **5176** read-only preview is not needed.
- Make sure port **5178** is unused. The script starts an HTTP server bound to `127.0.0.1:5178` only; it is closed at the end.
- Node dependencies in `backend` (`mysql2`, `express`) must already be installed.
- Use only the previously configured, limited MySQL account `coffee_overflow_integration_app`. **Never enter root or other database passwords**.

## Install and test

Unzip into the root `coffee_overflow` folder, merging `backend` and `docs`. The only two files are new. **Stop if prompted to overwrite a file.** Confirm the correct branch, `feature/hudson-checkout-integration`.

From CMD opened in the `coffee_overflow` root:

```cmd
node --check backend/src/integration/realAdminHttpSmoke.js
node backend/src/integration/realAdminHttpSmoke.js
```

Enter the **restricted integration database password** at the prompt (input hidden). **Do not send passwords, generated cookies, or CSRF tokens in screenshots.**

## Actions verified

1. Checks the exact restricted account, schema, synthetic product, and empty baseline.
2. Runs its own independent Express app via the already-tested `localIntegratedApp` on a loopback port.
3. Registers a synthetic `co-browser-...@example.test` shopper through HTTP and verifies customer role.
4. Proves anonymous and customer sessions cannot access protected order management (`401`/`403`).
5. Creates a **different synthetic** `co-admin-...@example.test` account through the trusted server-side auth service, then promotes only that newly-created account to admin in this disposable local integration database. **No public admin registration or role-assignment route is added.**
6. Signs in the temporary admin through HTTP and verifies protected admin GET routes.
7. Places a test checkout via customer HTTP login, then uses admin HTTP PATCH to perform `Placed -> Processing -> Cancelled`. Tests missing CSRF and forged Origin, duplicate cancellation, invalid transitions, order history, and restored stock (10).
8. Removes only the verified cancelled order, keeping the synthetic accounts. This obeys the preexisting local shop's one-order-at-a-time restriction.
9. Places a second customer HTTP checkout and performs `Placed -> Processing -> Fulfilled`. Tests status history, statistics, invalid cancellation, and correctly retained stock (9).
10. Logs out the admin and confirms the saved session can no longer access the API.
11. Closes the temporary server, restores the one remaining stock unit, deletes only the verified synthetic orders and accounts, and checks stock 10 with **zero** order/checkout/auth records.

**No payment is made.** The script uses internally generated test-only passwords; it does not echo them.

Expected final success line:

```
SUCCESS: Protected admin HTTP processing, cancellation, fulfillment and permissions verified; all synthetic records removed (stock 10).
```

## If something fails

- The script tries to clean up only the known synthetic records and otherwise **refuses destructive changes**.
- If you see `MANUAL REVIEW REQUIRED`, **do not rerun it or manually delete data**. Preserve the complete error (without secrets) so we can investigate.
- An interrupted process may require database inspection before retrying; do not infer zero data from a nonzero exit code.
- If the script stops due to unexpected stock or existing records, stop and inspect the integration DB rather than changing those records to force the test.

## Limitations

- This is a test-only admin account and test-only Express server, **not a permanent website administrator**.
- `server.js` still intentionally refuses real checkout without approved integration.
- The original read-only dashboard is separate; the next milestone is a reviewed browser admin interface using these same verified sessions and order-only API.
- Final production authorization, deployment, database migrations, and review with Isaac/Reyna are outstanding.
