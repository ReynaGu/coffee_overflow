# Coffee Overflow Phase 4A — migrated-schema read-only team API bridge

Branch: `feature/hudson-unified-website`. **Additive files only**. This is a preliminary handoff module for Isaac, *not* a production app or deployment. No existing team files (especially `backend/src/server.js`), permissions, tables, accounts or checkout logic are changed.

## What is new

- `teamCatalog.js`: reads canonical `products` and `sale_items` and converts DECIMAL prices to storefront integer cents. Does not import the temporary Phase 2 catalog: because the original schema has no image/category/visibility fields, records are explicitly marked `Uncategorized` with no image. This is **not** the final product-visibility/category/image model.
- `teamReadiness.js`: validates the 13-table migrated review schema and four foreign-key relationships, and refuses the wrong database or a sandbox with real accounts/orders. Read-only SELECT queries only.
- `teamReadOnlyApp.js`: an Express app with GET `/api/health`, `/api/products`, `/api/products/:id`. Every POST/PATCH/DELETE fails closed with 405. Binds only explicit `127.0.0.1` origin, verifies Host, and sends restrictive headers.
- `startLocalTeamReadOnly.js`: opt-in localhost launcher for **only** `coffee_overflow_migration_review` using a separately provisioned SELECT-only MySQL user; port 5190. It does **not** mount authentication, admin writes or checkout yet.

## Installation / safe first test

1. GitHub Desktop: choose `feature/hudson-unified-website`, ensure clean state. Extract ZIP into the repository **root** with folder structure. No existing files should be overwritten by extraction.
2. From repository root run `node --test backend/src/team/teamReadOnlyRules.test.js` (expect 12 passing) and `node --check backend/src/team/startLocalTeamReadOnly.js`.
3. Before starting an actual database connection, use the MySQL Workbench **administrator account** to create a new local-only MySQL user named **`coffee_overflow_review_reader`** and set a new strong unique password. Host must be **`127.0.0.1`**. Give this user **SELECT only** on `coffee_overflow_migration_review`.*. Do not grant global or other-schema permissions; do not paste passwords into this chat. Review Workbench's *Users and Privileges* GUI to avoid saving a password in a project SQL file.
4. Run `node backend/src/team/startLocalTeamReadOnly.js`; enter the newly chosen read-only database password when prompted. On success check `http://127.0.0.1:5190/api/health` and `/api/products`. The migrated sandbox has zero catalog rows, so `[]` is an expected and correct API result.
5. Stop with Ctrl+C. No cleanup required; this preview performs no database writes. Do not copy this user/password to `.env`, Git or a teammate's database.

## Deliberate limitations

This is a bounded team API contract test, not the final server. The production entrypoint `backend/src/server.js` still uses `test_products` and has authentication fail-closed; do not modify it without Isaac's review. Authentication and checkout stay disabled here until we have a separate bounded test fixture and cleanup workflow for the migrated sandbox. There is no payment processing or real customer data. The final database/product ownership decision belongs to the team. After this bridge is verified, review routes and dependencies with Isaac, then introduce a separate opt-in authenticated integration and test it before considering a `server.js` change.
