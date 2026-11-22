# Coffee Overflow — Authentication contract for checkout and admin

Target branch: `feature/hudson-checkout-integration`. **Not a live login system.**

## Why this is needed
- `backend/src/server.js` mounts Jalen's `POST /api/orders` with `shopperAuthNotConfigured`, which correctly returns 401 until login exists.
- `backend/src/admin/adminRoutes.js` already requires a real `requireAdmin` middleware and is not mounted.
- Reyna's current SQL `users` table has `password VARCHAR(50)` and no role field or session storage. The imported row with id=0 is only a placeholder.

## What is included
- `backend/src/auth/sessionGuards.js`: two Express-compatible middleware functions (`identifyShopper`, `requireAdmin`) with a required *server-owned* session lookup callback; reject unauthenticated / unauthorized requests and require a verified anti-CSRF decision for writes.
- `backend/src/auth/sessionGuards.test.js`: 11 tests of the role / trust boundary. No database, login UI, credentials, or changes to existing source.

## Integration contract for Isaac / Reyna
1. Agree how customer accounts are created and stored, including password hashes (Argon2id or bcrypt/scrypt with suitable parameters), unique email, roles, and a verified way to assign administrators. Do **not** store plaintext passwords or read a browser-supplied role. `VARCHAR(50)` cannot hold a full encoded modern password hash reliably; use sufficient length, e.g. `VARCHAR(255)` for a new hash column.
2. Implement session persistence (opaque random session IDs in secure HttpOnly cookies, expiration, revocation on logout, session rotation on login). Load `userId` and `role` from the server-controlled database/session store, not from request body, query string, localStorage, headers, or an unverified token.
3. Implement an anti-CSRF check for cookie-authenticated write methods. Return a boolean `csrfVerified` from the trusted resolver. For read-only GET routes the guards do not require it.
4. Replace `shopperAuthNotConfigured` with the verified `identifyShopper` on `/api/orders`, **only after** authentication works. Jalen's checkout service already requires a validated `req.user.id` and a client token.
5. Mount `createAdminRouter({store, requireAdmin})` only after the admin session and schema-aware store are ready. The existing sharedOrderStore provides orders/stats only; the full router also includes products, users, coupons, so a complete compatible store is needed before mounting all routes.
6. Replace `app.use(cors())` wildcard behavior with an explicit agreed same-origin/cross-origin cookie + CSRF policy. Do not use wildcard credentialed origins. Use HTTPS and secure cookies in deployment.
7. Reyna must approve final shared schema migrations. Do not directly modify `main`, original shared SQL, or the original `coffee_overflow_dev` database as part of this package.

## Quick test
From repo root:

```cmd
node --test backend/src/auth/sessionGuards.test.js
```

**Expected: 11 passing tests.** All existing checkout/admin tests should remain unchanged.

## Security limitations
These middleware guards depend on their injected resolver. They do not create or verify passwords, cookies, signed tokens, sessions, or CSRF tokens by themselves. A resolver that trusts user-provided identity fields is insecure. **Do not mount these guards until a real server-side resolver is implemented, reviewed, and tested.**
