# Coffee Overflow Group 6 — Admin Demo Call Notes

## What to show (3–5 minutes)
1. Run `START_ADMIN_PREVIEW_WINDOWS.bat`. Point out **Preview / sample data** so nobody mistakes the demo for shared database integration.
2. Open Overview: order count, active orders, revenue, low-stock products.
3. Open Orders: search customer or order ID, sort by amount/customer/date, inspect a complete receipt.
4. Change a `placed` order to `processing`, add a note, and point out the activity timeline.
5. Create or process a *different* sample order; cancel while active and show product stock replenishment. Repeating cancellation is not allowed to restock twice.
6. Open Inventory, Discounts and Customers; demonstrate that these admin features are separate from the storefront.
7. Show `backend/src/admin/orderRules.js` and explain why the server checks status transitions even if the UI already restricts them.

## Explain the architecture in your own words
> I developed a standalone admin module so I wouldn't overwrite anybody's frontend or backend. The interface shows products, discounts, customers, and orders. On the live site, each action will call protected Express endpoints that read and update the same MySQL records as checkout. I used sample data for this preview because our official repo doesn't have those order and login APIs yet. Once we agree on the shared database fields and admin authorization, we can connect it without replacing the team's pages.

## Decisions to ask on the call
- Will Group 6 use MySQL throughout, or does the team agree to a documented SQLite switch? Both are valid for the assignment, but the final deployed application needs **one** authoritative database.
- What are the actual schema names/fields for orders, order items, products, coupons and users? Who owns the migration?
- How does Isaac authenticate a user and establish the admin role? We should not expose admin writes without this.
- How will Jalen insert checkout orders so they immediately appear in the admin dashboard?
- Can Christopher and Reyna confirm the stock column, product IDs and sales-price rules?
- Who will test the full end-to-end workflow and who will demonstrate which screens?

## Top improvements for the group
- Connect the existing static products page to the product API rather than hardcoded example data.
- Finish customer accounts, shopping cart, discounts, 8.25% tax and order placement.
- Confirm quantity is visible on the *main product listing* (not only product detail).
- Agree on shared database schema, authorization, endpoint contracts and error handling early.
- Add setup instructions, seed data, smoke tests and a 15-minute demo path before the deadline.

## Your own part in the report
Mention modular admin UI, the order status state machine, role checking, protected APIs, transaction-based cancellation, audit trail, search/sorting, testing, and the fact that a standalone sample preview was used **before** connecting to the team database. Document AI assistance honestly under the professor's allowed development methodology.
