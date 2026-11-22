# Coffee Overflow — Phase 4B1 authenticated API contract (local only)

**Branch:** `feature/hudson-unified-website`. Additive files only, before any database writes. **Do not merge into `main` or deploy this test API.** This package is designed to be read and approved alongside Isaac's server integration, not to silently replace it.

## Included files

- `backend/src/team/teamAuthBoundary.js` — pure fail-closed synthetic-account, origin/Host and checkout request boundaries.
- `backend/src/team/teamAuthBoundary.test.js` — 15 isolated policy tests (no MySQL writes or network requests).
- `backend/src/team/teamAuthenticatedApp.js` — opt-in Express **app factory**, not a launcher. Composes the existing `authService`, `authRoutes`, `sessionGuards`, `checkoutService`, `checkoutRoutes`, `teamCatalog`, and `sharedOrderStore` without duplicating their implementations.

## First stage — install and verify code only

1. GitHub Desktop must show `feature/hudson-unified-website` and a clean working tree. Extract the package into the repo root; preserve directories. Only new files are included.
2. From root run:

   ```cmd
   node --test backend/src/team/teamAuthBoundary.test.js
   node --check backend/src/team/teamAuthenticatedApp.js
   ```

3. Expect **15 passing tests** and no syntax errors. **Do not create additional database accounts, insert a fixture product, or start the new API yet.** The app factory has no entrypoint and cannot serve requests by itself.

## Future Phase 4B2 startup test (requires separate bounded package)

- New localhost-only **writer** MySQL account with SELECT/INSERT/UPDATE/DELETE only on **`coffee_overflow_migration_review`**. Keep the existing `coffee_overflow_review_reader` SELECT-only; never reuse the admin/root account for the app. Do not grant CREATE, ALTER, DROP, GRANT OPTION, or access to any other schema.
- Strict startup readiness verifies exact table structure, zero real customers/orders/sessions/fixtures, and a single imported placeholder `users.id=0`. Test-only product #601 will be seeded only after passing the validation.
- Synthetic admin provisioned using `authService`; synthetic customer may register using `co-browser-...@example.test`. Only a verified customer session and CSRF token may create a checkout; only a verified admin session and CSRF token may change order status. No public admin registration.
- An **exact transactional teardown** must be provided and tested before any real DB write. It must recognize only the synthetic identities, fixture product, one order and its events/receipts, and preserve user #0. It must refuse unexpected data and roll back on mismatch.
- Never use a production customer or payment. No public network binding; no live storefront yet. Future integration into Isaac's `server.js` remains a separately reviewed change.

## Local API contract implemented by the app factory

- `GET /api/health`, `GET /api/products`, `GET /api/products/:id`: canonical Reyna product data, 200/404/503 responses, no invented metadata.
- `/api/auth/register|login|session|logout`: reuses hashed passwords, HttpOnly cookie, server-side session and CSRF implementation; register restricted to synthetic `co-browser-...@example.test` addresses.
- `POST /api/orders`: accepts one unit of synthetic product #601, client UUID token, no discounts/extra fields. `identifyShopper` verifies a real server-side customer session **and** CSRF. Existing transactional checkout does server-side pricing, stock decrement and idempotency handling.
- `GET /api/admin/stats`, `GET /api/admin/orders`, `GET /api/admin/orders/:id`, `PATCH /api/admin/orders/:id/status`: protected by `requireAdmin`; status patch requires verified CSRF and the existing audited transaction.

## Outstanding work before live execution

The app factory is not yet a runnable server. The Phase 4B2 follow-up must add a strictly verified restricted writer connection, fixture seeding, one-order capacity enforcement under concurrency, transactional cleanup, negative permission tests and real MySQL/HTTP integration tests. Do not treat the pure-rule tests as evidence that the HTTP or database write path has passed.

**No SQL migration, schema change, read-only user permission change, customer registration, checkout, or order write is part of this package.**
