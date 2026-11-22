# Coffee Overflow — Isolated MySQL Authentication Service V1

**Branch:** `feature/hudson-checkout-integration` — local development only, not production.

## Scope

New files only:

- `backend/src/auth/authService.js`: implements registration, password hashing/verification, login/session creation, session validation, logout/revocation; exports a `resolveVerifiedSession(req)` compatible with the existing `sessionGuards.js` contract. Uses Node's built-in `crypto.scrypt` (random per-user salt, scrypt N=16384/r=8/p=1) and opaque 256-bit session/CSRF secrets. Only SHA-256 hashes of session and CSRF tokens are stored in the DB. Account roles come only from `auth_credentials`, and public registration can only create `customer` accounts.
- `backend/src/auth/authService.test.js`: 11 unit tests using an in-memory fake SQL pool; no database writes.
- `backend/src/auth/realMysqlAuthSmoke.js`: controlled optional smoke test against **only** `coffee_overflow_integration` using a hidden password prompt and a random synthetic customer. Creates then deletes one fixture customer and session, preserving original row counts. If interrupted, manual cleanup might be required.
- `docs/LOCAL_AUTH_SERVICE_V1.md`: this document.

**No source files are replaced**, no live Express authentication routes enabled, no login UI enabled, no `.env` edited, no new npm dependencies, no SQL migration executed automatically, and no GitHub branches beyond the current feature branch touched.

## Required local database (already prepared)

- `coffee_overflow_integration.users`: `id INT AUTO_INCREMENT PRIMARY KEY`, unique `email`, existing required first/last/address fields, legacy `password VARCHAR(50)`.
- `coffee_overflow_integration.auth_credentials`: `user_id`, `password_hash VARCHAR(255)`, `role ENUM('customer','admin')`, `is_active`.
- `coffee_overflow_integration.auth_sessions`: `token_hash CHAR(64)`, `user_id`, `csrf_token_hash CHAR(64)`, `expires_at`, `revoked_at`.
- Foreign key `fk_auth_credentials_user` restored; `auth_sessions` references `auth_credentials` with delete cascade.

## Special handling of legacy users table

`users.password VARCHAR(50)` is required (`NOT NULL`) in Reyna's original dump. Registration deliberately writes the **non-secret sentinel** `!auth_credentials_only!` to that legacy column. The actual salted password hash is stored only in `auth_credentials.password_hash`. Do not authenticate against the legacy column or use this prototype to migrate real accounts yet.

All address fields are mandatory only because the original `users` schema requires them. `zip_code` is currently an integer, which cannot preserve leading-zero postal codes; the final shared schema should change that to `VARCHAR(10)` or similar. `email` is limited to 50 characters by the existing schema. Registration validation enforces these restrictions rather than modifying Reyna's table.

## How to install safely

1. GitHub Desktop → select `feature/hudson-checkout-integration`; verify no local changes.
2. Extract ZIP and copy the `backend` and `docs` folders into the repository root.
3. They add only new files. Stop if Windows reports overwrites.
4. In a CMD window opened at the repository root:

```cmd
node --check backend/src/auth/authService.js
node --check backend/src/auth/realMysqlAuthSmoke.js
node --test backend/src/auth/authService.test.js
```

Expected **11 passed, 0 failed** for the new service tests.

5. Run the combined existing regression suite plus the new test file. Then, only after the tests pass and the integration database constraints are verified, optionally run:

```cmd
node backend/src/auth/realMysqlAuthSmoke.js
```

Enter the separate integration database password. The smoke test **does** write a temporary account and session before cleaning them up. Never use a real password or email for its fixture. If it fails, check cleanup before rerunning.

## Security boundaries — not production-ready

- **Not mounted.** `backend/src/server.js`, `checkoutRoutes.js`, `adminRoutes.js` and the original front end have not changed. Checkout remains 401 until Isaac's verified login/session implementation is integrated.
- The service returns an internal `sessionToken` to trusted route code, which must set an `HttpOnly; SameSite=Lax; Secure` cookie on HTTPS. Never print/return raw session tokens in JSON to untrusted clients. A separate CSRF token may be returned to same-origin browser code for use in an `X-Coffee-CSRF` header.
- `resolveVerifiedSession` reads the opaque `co_session` cookie and checks the `X-Coffee-CSRF` header against a server-stored hash. It does not trust `req.user`, browser-supplied `user_id`, or browser-supplied role.
- **Rate limits and abuse protection are NOT implemented.** Real registration/login HTTP endpoints need per-IP and per-account throttling, structured error handling, session expiry cleanup, session renewal/rotation, secure transport, anti-enumeration policies, and an explicit CORS/cookie/CSRF configuration before deployment.
- No self-service admin registration. Admin provisioning and role elevation must have a separate approved privileged workflow with audit trail. Existing dummy id=0 row is **not** a real user.
- `sessionGuards.js` already tests the authorization boundary, but the actual live routers are not mounted with this service. The shared admin router also needs compatible products/users/discounts store methods before mounting all endpoints.
- DB schema and API contract changes require Reyna/Isaac/Jalen review. Do not merge to `main` yet.
