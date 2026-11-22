# Coffee Overflow Phase 4B2 — controlled authenticated MySQL/API smoke

**Branch:** `feature/hudson-unified-website`. This package **adds files only**; it does not change Isaac's `backend/src/server.js`, Reyna's `coffee_overflow.sql`, checkout/auth libraries, existing test previews, or GitHub `main` / PR #4.

## Purpose and isolation

This is a **one-time, single-order, disposable local test** on `coffee_overflow_migration_review` (the verified 13-table migrated sandbox). It is **not** a production site, payment processor, or final product catalog. It uses a separate MySQL account `coffee_overflow_review_writer` at host `127.0.0.1`, with **only** SELECT/INSERT/UPDATE/DELETE on `coffee_overflow_migration_review`.* and no permissions elsewhere. The existing read-only account `coffee_overflow_review_reader` must remain read-only and is never used for this test.

The test seeds exactly one synthetic product **#601, $18, stock 1** plus one synthetic admin with a scrypt hash. It allows registration of only one designated synthetic customer, one unique checkout with product #601 quantity 1, idempotent retries, and role/CSRF-verified status updates. The one-stock-unit transaction and checkout-token allowlist jointly prevent two committed unique orders, including after cancellation. We test fulfillment here. No other data is imported, modified or deleted. The placeholder `users.id=0` is preserved.

## Step A — Install and run pure tests before any DB writes

1. Check `git status -sb`: clean `feature/hudson-unified-website` branch.
2. Extract ZIP into repository root; **new files only**, do not overwrite existing files.
3. From root:

   ```cmd
   node --test backend/src/team/teamAuthFixture.test.js
   node --check backend/src/team/teamAuthFixture.js
   node --check backend/src/team/teamBoundedAuthenticatedApp.js
   node --check backend/src/team/seedLocalTeamAuth.js
   node --check backend/src/team/startLocalTeamAuth.js
   node --check backend/src/team/runLocalTeamAuthSmoke.js
   node --check backend/src/team/cleanupLocalTeamAuth.js
   ```

Expected **22 pass, 0 fail**. These rule tests don't connect to MySQL or modify data.

## Step B — Create and verify a schema-limited writer (only after tests)

In MySQL Workbench, under local admin connection, use **Users and Privileges** to create:

- Login name: `coffee_overflow_review_writer`
- Host: **`127.0.0.1`** (do not use `%`)
- Unique strong password; never put in chat, files or Git
- **Schema privileges** on **selected schema `coffee_overflow_migration_review` only**: `SELECT`, `INSERT`, `UPDATE`, `DELETE`
- NO `GRANT OPTION`, `ALL PRIVILEGES`, `CREATE`, `ALTER`, `DROP`, `CREATE USER`, `FILE`, roles, or global privileges.

Verify using local administrator:

```sql
SHOW GRANTS FOR 'coffee_overflow_review_writer'@'127.0.0.1';
```

Expected global `USAGE` and the four DML privileges on **only** `coffee_overflow_migration_review`.*. Our scripts **refuse** unexpected grants, wrong database, malformed schema, extra accounts/orders/sale rows, missing placeholder, and unexpected stock. Do not widen grants to work around a refusal.

**If the sandbox is not back at the original migrated baseline** (one `users.id=0` placeholder, all other tables empty) stop and investigate; never delete existing data to force a seed.

## Step C — Seed one exact synthetic fixture (one time)

```cmd
node backend/src/team/seedLocalTeamAuth.js
```

Enter the **new schema-limited writer password** and choose a NEW synthetic ADMIN password (12+ characters). Keep both private. The transactional seed verifies the schema/grants, exact baseline, creates product #601 and its admin, and prints two exact synthetic `@example.test` emails: `EXACT ADMIN EMAIL` and `EXACT FUTURE CUSTOMER EMAIL`. **Record both precisely** for startup, HTTP smoke and cleanup.

If the seed fails, do not rerun it without investigating why. A successful seed must be cleaned exactly once before seeding again.

## Step D — Start local authenticated API (separate CMD window)

```cmd
node backend/src/team/startLocalTeamAuth.js EXACT_ADMIN_EMAIL EXACT_FUTURE_CUSTOMER_EMAIL
```

Enter the same writer MySQL password. The startup validates the exact seeded state and binds only `127.0.0.1:5191`. Keep the window running. Health: `http://127.0.0.1:5191/api/health`. Products: `/api/products` (one test product #601, stock 1).

## Step E — One-shot end-to-end HTTP smoke (second CMD window)

```cmd
node backend/src/team/runLocalTeamAuthSmoke.js EXACT_ADMIN_EMAIL EXACT_FUTURE_CUSTOMER_EMAIL
```

Enter the synthetic **ADMIN login password** from seed. The smoke creates the exact customer account with a random generated test password, signs in, verifies that customers cannot access Admin, places one $19.49 order ($18 + $1.49 tax), checks stock 0, replays the exact checkout token without creating a new order, rejects a second token, logs in as Admin, transitions placed → processing → fulfilled, verifies audit events and stats, signs out, and verifies the admin session is revoked.

**Never run the smoke twice**. If interrupted or failed, the exact cleanup supports zero or one order in `placed`, `processing`, `fulfilled` or `cancelled`. It checks the data and rolls back if an invariant fails.

## Step F — Stop and clean safely (mandatory after any successful seed)

Stop the port 5191 server with **Ctrl+C**; if the original CMD window is closed, verify port 5191 is no longer listening with `netstat -ano -p tcp | findstr ":5191"`. The cleanup script itself refuses a listening port 5191.

If customer registration succeeded (regardless of whether order was placed):

```cmd
node backend/src/team/cleanupLocalTeamAuth.js EXACT_ADMIN_EMAIL EXACT_FUTURE_CUSTOMER_EMAIL
```

If customer never registered, pass `-` for the second argument:

```cmd
node backend/src/team/cleanupLocalTeamAuth.js EXACT_ADMIN_EMAIL -
```

The script verifies the correct writer/grants, all exact data, prices, receipts, status/event history, stock and sessions before deleting. All deletes are in **one InnoDB transaction**. Any mismatch triggers rollback. On success all test rows are removed, `users.id=0` remains, and no products/orders/sessions exist. Do not use the earlier Phase 1/2 cleanup scripts here.

## Scope / limitations

- No main `server.js` changes or production deployment.
- Product metadata images/categories and permanent catalog data need team approval.
- The public API is localhost-only and synthetic-only; this is not production hardening. No payments or refunds.
- The 22 tests are **pure rule tests**, not proof of live MySQL operation. The live smoke remains unverified until run and inspected on the user's own sandbox.
- After a successful cleanup, run the existing 152 tests plus B1's 15 tests and B2's 22 tests (**189 total**, assuming no other changes), then review files before committing and pushing to the feature branch.
