'use strict';
/*
 * Coffee Overflow - checkout table/column names (Jalen, cart).
 *
 * Matches Reyna's shared schema in coffee_overflow.sql exactly as it exists today.
 * If the database owner renames anything, change ONLY the right-hand strings here;
 * the checkout SQL is built from this map. Values are SQL identifiers, never user input.
 *
 * Schema requirements this checkout depends on (owned by the database team, NOT changed here):
 *   - orders.order_id must be AUTO_INCREMENT. The current dump has a PRIMARY KEY but no
 *     AUTO_INCREMENT, so inserts will fail with a clear error until that is added.
 *   - products/orders/order_items must be InnoDB (they are) so the transaction and
 *     SELECT ... FOR UPDATE row locks work.
 */
const SCHEMA = Object.freeze({
  products: Object.freeze({
    table: 'products',
    id: 'product_id',
    name: 'name',
    price: 'price',               // DECIMAL(10,2) dollars
    stock: 'stock_quantity'
  }),
  saleItems: Object.freeze({
    table: 'sale_items',
    productId: 'product_id',
    salePrice: 'sale_price'       // DECIMAL(10,2) dollars
  }),
  orders: Object.freeze({
    table: 'orders',
    id: 'order_id',
    userId: 'user_id',
    date: 'order_date',
    subtotal: 'subtotal',         // DECIMAL(10,2) dollars
    tax: 'tax',                   // DECIMAL(10,2) dollars
    total: 'total'                // DECIMAL(10,2) dollars
  }),
  orderItems: Object.freeze({
    table: 'order_items',
    orderId: 'order_id',
    productId: 'product_id',
    quantity: 'quantity',
    unitPrice: 'unit_price'       // DECIMAL(10,2) dollars - price snapshot at time of order
  })
});

module.exports = { SCHEMA };
