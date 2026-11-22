# Coffee Overflow — Jalen checkout transaction verification

**Branch:** `feature/hudson-checkout-integration` only.

These are automated tests for Jalen's checkout service. The suite uses a fake in-memory MySQL connection; it **does not connect to MySQL, create orders, modify inventory, change server files, or bypass shopper authentication**.

## Install

1. Confirm GitHub Desktop shows the branch `feature/hudson-checkout-integration` and no local changes.
2. Extract the ZIP, then copy the `backend` folder from the extracted ZIP into the root of the `coffee_overflow` repository. This adds **one new test file**: `backend/src/checkout/checkoutService.integration.test.js`. If Windows asks to overwrite a file, stop.
3. Open CMD in the repository root and run:

```cmd
node --test backend/src/checkout/checkoutService.integration.test.js
```

## What is tested

1. Successful checkout pricing, tax, order/items snapshots, stock decrement and commit.
2. Missing shopper identity is rejected before database access.
3. Invalid quantity is rejected before database access.
4. Insufficient stock causes rollback.
5. A later insufficient-stock line leaves no partial order or stock change.
6. Failure while inserting order items rolls back the full transaction.
7. Missing AUTO_INCREMENT causes a clear failure and rollback.
8. Discount code is rejected until team agrees on shared discount rules.

Expected: **8 tests, 8 passes, 0 failures** (the assertions may identify a bug; report the actual result). Do not commit until we review the results. Do not import any SQL or change the `.env` file for these tests.
