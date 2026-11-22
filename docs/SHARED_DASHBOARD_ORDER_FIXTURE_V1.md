# Coffee Overflow — one shared checkout order for visual preview (local-only)

This test fixture creates exactly one order using **Jalen's actual checkout service**, then leaves it in the isolated `coffee_overflow_integration` database until you remove it with the cleanup command. No payment is involved. It does **not** turn on shopper login or admin write access in the website. It uses a synthetic checkout identity only when calling the service directly inside a local test script.

## Prerequisites

- Branch: `feature/hudson-checkout-integration` with no unrelated uncommitted changes.
- `coffee_overflow_integration` has Reyna's tables, `orders.status DEFAULT 'placed'`, and `order_events`.
- Restricted MySQL account: `coffee_overflow_integration_app`.
- Test product #1 is **Checkout Integration Test Coffee**, price **$18.00**, stock **10**.
- No orders/order items/order events; synthetic fixture user #900001 does not exist.
- The **read-only preview server** is running on `127.0.0.1:5176` and you are signed in to its local viewer.

## Install and run

Copy the package's `backend` and `docs` folders into your repository root. They add two files. Do not overwrite existing files or commit database passwords.

From Command Prompt in the repository root:

```cmd
node --check backend/src/admin/sharedPreviewOrderFixture.js
node backend/src/admin/sharedPreviewOrderFixture.js create
```

Enter the **integration database account password** when prompted (the terminal hides it). The script uses only that account and hardcodes the isolated schema, without reading `backend/.env`.

The script first checks the precise database/account, product, stock, absence of orders, and absence of a prior fixture user. It inserts a synthetic display-only user with an **unusable random password**, then calls `createCheckoutService(...).placeOrder(...)` as a test harness. **Do not treat this user as an authenticated shopper.**

Expected after success: **one** placed order for **Integration Preview**, total **$19.49**; stock **9**; dashboard **one active order** and **one low-stock product** (threshold below 10).

**Refresh** `http://127.0.0.1:5176/admin/shared-orders-preview.html` and inspect the Overview and Orders tabs and the order detail receipt.

## Clean up after inspection

```cmd
node backend/src/admin/sharedPreviewOrderFixture.js cleanup
```

Enter the same integration account password. The cleanup uses a MySQL transaction and refuses to delete anything unless the test user's name/email, order amounts, status, product ID, line quantity, stock, and absence of status events match exactly. It removes only that fixture's order and user and restores stock to **10**. If a preflight fails, it rolls back and leaves data for inspection; **do not manually delete arbitrary orders**.

After cleanup, refresh the dashboard and confirm all counts return to zero.

## Safety limits

- No access to `coffee_overflow_dev` or production databases; no use of `.env`.
- No HTTP admin or shopper authentication bypass. This is a backend test harness only.
- No use with real customer information. The preview customer uses `example.test`.
- Database changes are intentionally **not automatically cleaned up after `create`**, because the goal is to view them on the dashboard. A crashed or interrupted process may leave a partial fixture user; `cleanup` can remove it if no order was created.
- The expected AUTO_INCREMENT order ID may be greater than the previous highest ID due to earlier smoke tests.
- Do not run against any shared/production account or edit the fixed schema/account constants.
