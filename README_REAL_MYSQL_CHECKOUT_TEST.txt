Coffee Overflow - Jalen checkout real MySQL smoke test
=======================================================

Purpose
-------
Test Jalen's unmodified backend/src/checkout/checkoutService.js against ACTUAL
MySQL without changing the website's shopper authentication or backend/.env.

The test is hardcoded to the separate coffee_overflow_integration database and
restricted coffee_overflow_integration_app account. It REFUSES to run if the
account, database, product, price, or starting stock does not match.

The script invokes the service directly with a synthetic shopper id=1.
This is a local service integration test, NOT a website authentication test.

Installation
------------
1. In GitHub Desktop, confirm feature/hudson-checkout-integration and No local changes.
2. Copy the ZIP's backend folder into the coffee_overflow repository root.
   This should ADD only backend/src/checkout/realMysqlSmoke.js.
   STOP if Windows asks to replace any existing file.
3. You already have the integration database, restricted account, and test product.
4. From a new CMD opened in the repository root, run:

   node backend/src/checkout/realMysqlSmoke.js

5. Type the restricted integration account password when prompted. Typing is
   hidden (no dots or asterisks); press Enter. Do NOT paste your password into
   a source file, GitHub, screenshots, or a chat message.

What it checks
--------------
- Access with only the restricted account to coffee_overflow_integration.
- Exact product ID=1, name=Checkout Integration Test Coffee, price=18.00,
  starting stock=10; aborts otherwise.
- Excess quantity -> real MySQL rollback, no order, no stock change.
- Injected order_items insert exception -> real MySQL transaction rollback.
- Successful checkout -> actual order and order_items written, 8.25% tax,
  stock decremented from 10 to 9.
- Cleanup -> deletes only the known test order and returns stock to 10.

The test is intentionally local, without real users, discounts, or payment.
The AUTO_INCREMENT counter may increase although records are cleaned up.
If the process is forcibly terminated after the test order commits but before
cleanup, its order may remain; check Workbench before rerunning. Normal exits
attempt cleanup even after validation errors.

DO NOT change backend/.env, import a new SQL dump, or turn off authentication.
DO NOT commit until results are reviewed.
