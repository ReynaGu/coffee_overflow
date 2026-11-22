# Coffee Overflow — isolated Admin / Order Management contribution

This is an **additive patch** for `ReynaGu/coffee_overflow`, intended only for branch `feature/hudson-admin-order-management`.

No original group code is included or overwritten. To use it, copy these folders and files into the root of a clean checkout of that branch. See `docs/HUDSON_ADMIN_HANDOFF.md` for setup, contracts, safety and integration details.

## Try the new dashboard immediately

With Node.js installed, from the repository root:

```powershell
node admin/preview-server.js
```

Visit `http://localhost:5173/admin/`. The preview uses **sample data in your browser**. Order changes, inventory edits, customer edits, and coupon changes in this mode are **not** written to the team's database.

The separate existing Node/SQLite prototype you tested earlier also remains available. The patch here is the isolated team-integration version, not a replacement for that whole standalone store.

## Important

- The team's current `main` branch lacks user authentication and shared checkout/order tables. Live admin integration therefore needs team coordination.
- Never mount admin routes without actual server-side `requireAdmin` middleware.
- Do not merge until the shared database and live end-to-end tests are confirmed.
- Run `node --test backend/src/admin/orderRules.test.js` for the included order rule tests.
