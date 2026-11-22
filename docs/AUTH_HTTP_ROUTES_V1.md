# Coffee Overflow — Express authentication HTTP routes (integration V1)

**Scope:** Only `feature/hudson-checkout-integration`; do not merge or deploy without team approval.

## Files

- `backend/src/auth/authRoutes.js` — exports `createAuthRouter`, `createAuthHandlers`, `limitForIp`. Does **not** mount routes automatically or change `server.js`.
- `backend/src/auth/authRoutes.test.js` — isolated HTTP-handler tests; no MySQL connection. Requires the previously installed `authService.js` module.

## Intended API contract

When mounted under `/api/auth` by a reviewed Express server:
- `POST /api/auth/register`: validates an exact Origin, accepts `first_name`, `last_name`, `email`, `password`, `street`, `city`, `state`, `zip_code`; creates customer ONLY; returns `201 {user}` (does not auto-login).
- `POST /api/auth/login`: validates Origin and credentials; returns `{user, csrfToken, expiresAt}` and sets `co_session` HttpOnly SameSite=Lax cookie.
- `GET /api/auth/session`: returns `{authenticated:false}` or a verified `{authenticated:true,user:{id,role}}`.
- `POST /api/auth/logout`: validates Origin, trusted session, verified CSRF header, revokes session and clears cookie.

**Important:** The auth service stores the session-token hash in MySQL; it does not store the raw session cookie. The CSRF token is a separate secret returned at login; it must be sent as `X-Coffee-CSRF` on subsequent writes. A tab refresh currently requires a new login to recover the in-memory CSRF token; a production-approved renewal flow is future work.

## Prerequisites before mounting

1. Isaac confirms actual backend owner, deployment origin, HTTPS, session-cookie approach and API design.
2. Reyna approves `auth_credentials`, `auth_sessions`, unique users email/index, and users AUTO_INCREMENT migrations.
3. The server must use `express.json({limit:'16kb'})` before auth routes, configure a strict allowed origin, and provide a reviewed rate limit at the reverse proxy or shared persistent store. Built-in per-process limiter is only a developer safeguard.
4. Outside localhost, use `secureCookies:true` and HTTPS. `secureCookies:false` is rejected unless `allowedOrigin` is loopback HTTP.
5. Do not expose arbitrary `user_id` or `role` request parameters. Login must use the trusted MySQL auth service and a cookie. A customer registering cannot choose admin.
6. `createSessionGuards({resolveVerifiedSession: auth.resolveVerifiedSession})` can later be attached to Jalen's checkout router and your order-only admin router once their data stores and access control are approved. Do not mount entire `adminRoutes` with a shared-order store that lacks product/users/coupon methods.

Example wiring (for review, **do not run as production**):

```js
const {createAuthService} = require('./auth/authService');
const {createAuthRouter} = require('./auth/authRoutes');
const {createSessionGuards} = require('./auth/sessionGuards');
const auth = createAuthService(pool);
const guards = createSessionGuards({resolveVerifiedSession:req=>auth.resolveVerifiedSession(req)});
// Only after schema, deployment origin, and auth have been verified:
app.use('/api/auth', createAuthRouter({service:auth, allowedOrigin:'https://your-reviewed-origin.example',secureCookies:true}));
// Checkout: replace shopperAuthNotConfigured with guards.identifyShopper only after proper setup.
```

The existing Express `server.js` still returns 401 for the checkout endpoint because real shopper login has not been connected. This is intentional. No auth/admin routes are live yet.

## Run isolated tests

From repo root:

```cmd
node --check backend/src/auth/authRoutes.js
node --test backend/src/auth/authRoutes.test.js
```

Expected: 14 passing tests, zero failures. Tests use a fake service and no database calls.
