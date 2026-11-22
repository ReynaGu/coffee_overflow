# Phase 4B2 Grant-Scope Validation Fix

Target branch: `feature/hudson-unified-website`. Apply ONLY to your local project.

Your MySQL `SHOW GRANTS` screenshot now has a global USAGE entry plus one escaped-schema CRUD grant. The original `teamAuthFixture.js` parser falsely rejected MySQL's escaped underscores and its original test fixture used the unsafe unescaped form. This patch changes only `backend/src/team/teamAuthFixture.js` and `backend/src/team/teamAuthFixture.test.js`.

## Safe application

1. In GitHub Desktop confirm branch `feature/hudson-unified-website`, and verify that the two target files have no other local edits you need to preserve. Back up both target files before overwriting.
2. Extract this ZIP into the *root* of your local `coffee_overflow` repository, preserving directories. Confirm Windows reports **exactly two files** to overwrite, the paths shown below. Do not overwrite any other file.
3. Open CMD in repository root and run:

   node --check backend/src/team/teamAuthFixture.js
   node --check backend/src/team/teamAuthFixture.test.js
   node --test backend/src/team/teamAuthFixture.test.js

   Expect **26 passing tests**, zero failures (22 original + 4 new tests). Do not seed if any test fails.
4. Review `git diff -- backend/src/team/teamAuthFixture.js backend/src/team/teamAuthFixture.test.js` and confirm only this safety fix is present. Do not modify `main`, `backend/src/server.js`, Reyna's schema, or your grants.
5. Only if your restricted `SHOW GRANTS` still shows just USAGE and the single escaped, schema-specific CRUD grant, and the disposable migration-review database is still at the verified empty baseline, run:

   node backend/src/team/seedLocalTeamAuth.js

   Enter passwords locally, never in ChatGPT. If seed fails, **stop** and share the exact message; do not blindly rerun.
6. If seed succeeds, record exactly the synthetic admin email and future customer email printed by the script, for local startup and exact cleanup described in `docs/PHASE4B2_MIGRATED_AUTH_LIVE_SMOKE.md`.

## Files

- `backend/src/team/teamAuthFixture.js` — accept ONLY MySQL's escaped exact database grant, still reject wildcard/unrelated/global grants.
- `backend/src/team/teamAuthFixture.test.js` — use a correctly escaped grant in the baseline, add four regression tests.

This patch contains no passwords, database files, schema statements, or payment code, and does not itself connect to MySQL.
