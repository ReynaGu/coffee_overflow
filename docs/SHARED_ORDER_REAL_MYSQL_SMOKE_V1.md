# Coffee Overflow — shared checkout → admin real MySQL smoke test (isolated)

**For local integration testing only.** This smoke test calls Jalen's checkout service and Hudson's shared order adapter directly. It does **not** enable website checkout or mount `/api/admin` endpoints, and it does **not** demonstrate real login or authorization.

## Files

- `backend/src/admin/sharedOrderRealMysqlSmoke.js` — new test harness; does not overwrite source code.
- This README.

## Prerequisites

- GitHub Desktop on `feature/hudson-checkout-integration`, no unrelated local changes.
- The previously added `backend/src/admin/sharedOrderStore.js` and Jalen's `backend/src/checkout/checkoutService.js` exist.
- Isolated `coffee_overflow_integration` database using Reyna's SQL, with `orders.status` default `placed` and the new `order_events` table.
- Restricted `coffee_overflow_integration_app` account has SELECT/INSERT/UPDATE/DELETE rights to **only** `coffee_overflow_integration`.
- Test fixture `products.product_id=1`, name `Checkout Integration Test Coffee`, price `18.00`, stock `10`.
- **No orders, order_items or order_events** in the integration database. The script refuses to proceed if any already exist.

## Install and run

Extract the archive into your repository root (`coffee_overflow`); it should add **two new files**, with no overwrite prompts. Do not save or commit credentials.

Open Windows CMD in the repository root:

```cmd
node backend/src/admin/sharedOrderRealMysqlSmoke.js
```

Enter the integration account password when prompted. The password is hidden. Never paste or screenshot the password itself.

The script checks account/schema, creates one $19.49 test order and reduces stock 10→9, reads it through the shared-order adapter, changes placed→processing→cancelled, verifies status event history and stock restoration to 10, rejects a transition out of cancelled, then deletes **only the newly generated test order and its events/items**. All this happens in `coffee_overflow_integration`, not `coffee_overflow_dev`.

### Cautions

- This smoke test **performs writes and commits**; automatic cleanup is attempted and guarded. Interruptions or failures can leave a test order. If it reports manual cleanup, **stop and inspect before retrying**.
- MySQL AUTO_INCREMENT sequences may advance even if test orders are cleaned up.
- The synthetic `{id:1,role:'admin'}` actor passed directly to the adapter is **not a real authenticated admin**. Live `/api/admin` must still require server-verified administrator identity, and live checkout must still require real shopper login.
- No payment, discount or refunds are handled.
- No changes to `backend/.env`, schema, team code, admin preview port, or git branches.
- After the test succeeds, independently check the integration database: product #1 stock = 10; COUNT(*) from orders/order_items/order_events = 0.

## After this test

If it passes, run all 48 existing unit tests again if any source changes occur. Review new files in GitHub Desktop, commit only them to `feature/hudson-checkout-integration`, then work with Isaac on authenticated API mounting and Reyna on confirming the database schema. The adapter presently handles shared **orders only**; the rest of `/api/admin` is not integrated.
