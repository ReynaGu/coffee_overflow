# Coffee Overflow — Protected Admin HTTP Smoke Test (CSRF fix)

**Branch:** `feature/hudson-checkout-integration` (local isolated MySQL only).

Replaces exactly one file:

- `backend/src/integration/realAdminHttpSmoke.js`

## Why
`checkHttp(response, 200, ...)` returns parsed response **data**. The original smoke script then erroneously read `customerLogin.data.csrfToken`, although `customerLogin` already is the data object. That threw `Cannot read properties of undefined (reading 'csrfToken')`.

Correction:

```js
const customerCsrf=customerLogin.csrfToken;
```

No other code was changed. It does not touch `server.js`, `.env`, `main`, or other files.

## Install and test
1. Extract the ZIP and copy `backend/src/integration/realAdminHttpSmoke.js` into your `coffee_overflow` repository root, **allowing overwrite of this exact file only**.
2. From repository root run `node --check backend/src/integration/realAdminHttpSmoke.js`. Expected: no output.
3. Run `node backend/src/integration/realAdminHttpSmoke.js`, supply hidden restricted integration database password when prompted.
4. Verify clean fixture preflight, then protected admin processing/cancellation/fulfillment success and final cleanup. **If it reports MANUAL REVIEW REQUIRED, do not rerun.**
5. Keep changes on your feature branch. Do not commit until the test and database cleanup pass.

The previous run printed `CLEANUP: Synthetic test data recovered after interruption`. The rerun independently checks that stock is 10 and the test tables are empty before making any changes.
