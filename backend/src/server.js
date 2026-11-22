require('dotenv').config();

const express = require('express');
const cors = require('cors');

const productRoutes = require('./routes/productRoutes');

// Shared MySQL connection pool (from config/db.js) that the checkout service uses to run its order transaction.
const pool = require('./config/db');
const { createCheckoutService } = require('./checkout/checkoutService');
const { createCheckoutRouter, shopperAuthNotConfigured } = require('./checkout/checkoutRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'Coffee Shop API is running'
  });
});

// Product routes
app.use('/api/products', productRoutes);

// Checkout route: POST /api/orders re-prices the cart on the server and saves orders/order_items while reducing stock.
// Returns 401 for every request until shopperAuthNotConfigured is replaced with the real shopper login middleware.
app.use('/api/orders', createCheckoutRouter({
  service: createCheckoutService(pool, { requireIdempotencyToken: true }),
  identifyShopper: shopperAuthNotConfigured // swap in the real shopper login check
}));

// Start server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});