Coffee Overflow — Checkout Idempotency Installer, Windows line-ending fix

The original installer stopped before changing files with:
"expected exactly one matching section for token validation (found 0). No files changed."

Cause: source files on Windows may have CRLF endings, while the old installer matched only LF.
This corrected installer normalizes for matching and restores each original newline style.

Instructions:
1. Keep the NEW files from the first ZIP (including checkoutIdempotency.js and tests) in your repo. Do not remove them.
2. Stay on feature/hudson-checkout-integration.
3. Copy ONLY INSTALL_SHARED_CHECKOUT_IDEMPOTENCY_V1_WINDOWS_FIX.js to the root of coffee_overflow.
4. CMD in repo root:
   node INSTALL_SHARED_CHECKOUT_IDEMPOTENCY_V1_WINDOWS_FIX.js
5. Expected: PATCHED messages for 3 files, then SUCCESS.
6. Run:
   node --test backend/src/checkout/checkoutIdempotency.test.js
   node --check backend/src/checkout/checkoutService.js
   node --check assets/js/cart.js
   node --check backend/src/server.js

The installer checks source anchors and Git branch before writing. Backups stay outside the repo.
Do not commit yet; verify the complete test suite after success.
