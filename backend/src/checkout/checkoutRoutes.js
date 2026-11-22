'use strict';
/*
 * POST /api/orders - shopper checkout (Jalen, cart).
 *
 * Same pattern as Hudson's admin router: the router REQUIRES a real server-side
 * `identifyShopper` middleware that sets req.user = { id } for a logged-in shopper.
 * The user id is never read from the request body.
 *
 * Until whoever owns login supplies that middleware, server.js mounts the router with
 * `shopperAuthNotConfigured`, which fails closed (401). Do NOT replace it with a stub
 * like (req, res, next) => next() or one that trusts a user id sent by the browser.
 */
const express = require('express');

function shopperAuthNotConfigured(req, res) {
  res.status(401).json({ error: 'Shopper login is not connected yet, so orders cannot be placed.' });
}

function createCheckoutRouter({ service, identifyShopper }) {
  if (!service || typeof service.placeOrder !== 'function') throw new Error('Checkout service is required');
  if (typeof identifyShopper !== 'function') throw new Error('A real server-side identifyShopper middleware is required');

  const router = express.Router();

  router.post('/', identifyShopper, async (req, res, next) => {
    try {
      const receipt = await service.placeOrder(req.user, req.body);
      res.status(201).json({ order: receipt });
    } catch (error) {
      next(error);
    }
  });

  router.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    // express.json() reports malformed JSON as a 400 with err.type 'entity.parse.failed'.
    const status = Number(err.status) || 500;
    if (status >= 500) console.error('Checkout error:', err);
    res.status(status).json({ error: status >= 500 ? 'Checkout is unavailable right now. Please try again.' : err.message });
  });

  return router;
}

module.exports = { createCheckoutRouter, shopperAuthNotConfigured };
