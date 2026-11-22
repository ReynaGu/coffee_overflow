# Unified Website Phase 3 — Local UI polish (part A)

This package is for the `feature/hudson-unified-website` branch only. It changes the *local preview* presentation while retaining its bounded synthetic catalog, authentication, checkout, role verification and cleanup flow.

## Install

1. Keep the Phase 2 database clean (original product #1 stock 10, no test orders). Use GitHub Desktop and verify `feature/hudson-unified-website` is selected; commit/stash unrelated edits.
2. Extract this ZIP into the **root** of `coffee_overflow` (merge the `unified/`, `backend/` and `docs/` folders). No existing file should be overwritten by extraction; the installer handles targeted edits.
3. Run `node --test backend/src/unified/phase3UiPatches.test.js` and `node INSTALL_UNIFIED_WEBSITE_PHASE3_UI.js` from the repository root. The installer checks the branch and original source anchors, preserves CRLF/LF, checks the 4 target files have no uncommitted changes, and backs them up to a fresh Windows temp folder.
4. Re-run `node --test backend/src/unified/phase3UiPatches.test.js` and `node --check assets/js/cart.js`.
5. For visual tests, Phase 2 still requires the exact 19-product seed and uses `node backend/src/unified/startLocalCatalogPhase2.js` on port 5181. **Do not seed again until Phase 2 cleanup has been completed.** As before, launch with only synthetic accounts and no payments, then use `cleanupLocalCatalogPhase2.js` for cleanup if a test session is created. Avoid starting the catalog server merely to inspect CSS if not necessary.

## Changes

- Test banner no longer inaccurately says the expanded catalog contains only one product.
- Local cart stops showing the `Add an item (prototype)` form; the Products page is now the source of cart additions.
- Local checkout hides unsupported demo discount codes and ignores any old demo discount selection. Actual backend remains strict and rejects discount codes.
- Customer account page receives responsive, storefront-matched styling as an additional CSS layer; authentication logic stays unchanged.

Only the isolated server loads the new stylesheet. Outside local preview mode, the team's ordinary cart retains its original behavior.

## Limitations

This is **not** a production checkout. The current 19-product database catalog is temporary, account registration is synthetic-only, and no real payment is collected. Final database schema and server integration still require team review. Original pages and Phase 2 backend modules are not modified by the installer.
