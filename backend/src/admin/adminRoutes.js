'use strict';
/** Mount ONLY once a real auth middleware has been supplied. Routes fail closed without one.
 * Example in docs/TEAM_HANDOFF.md; do not paste an insecure stub such as (_,__,next)=>next().
 */
const express = require('express');
function createAdminRouter({store, requireAdmin}) {
  if (!store || typeof store !== 'object') throw new Error('Admin store is required');
  if (typeof requireAdmin !== 'function') throw new Error('A real server-side requireAdmin middleware is required');
  const router = express.Router();
  router.use(requireAdmin);
  const wrap = fn => async (req,res,next) => { try { await fn(req,res); } catch(e){ next(e); } };
  router.get('/stats', wrap(async (req,res) => res.json(await store.stats())));
  router.get('/orders', wrap(async (req,res) => res.json(await store.listOrders(req.query))));
  router.get('/orders/:id', wrap(async (req,res) => res.json({order:await store.getOrder(req.params.id)})));
  router.patch('/orders/:id/status', wrap(async (req,res) => res.json(await store.updateStatus(req.params.id,req.body,req.user))));
  router.get('/products', wrap(async (req,res) => res.json({products:await store.products()})));
  router.post('/products', wrap(async (req,res) => res.status(201).json(await store.saveProduct(null,req.body))));
  router.patch('/products/:id', wrap(async (req,res) => res.json(await store.saveProduct(req.params.id,req.body))));
  router.get('/users', wrap(async (req,res) => res.json({users:await store.users()})));
  router.patch('/users/:id', wrap(async (req,res) => res.json(await store.saveUser(req.params.id,req.body))));
  router.get('/coupons', wrap(async (req,res) => res.json({coupons:await store.coupons()})));
  router.post('/coupons', wrap(async (req,res) => res.status(201).json(await store.saveCoupon(null,req.body))));
  router.patch('/coupons/:id', wrap(async (req,res) => res.json(await store.saveCoupon(req.params.id,req.body))));
  router.use((err,req,res,next) => {
    const status=Number(err.status)||500;
    if(status>=500) console.error('Admin API error:',err);
    res.status(status).json({error:status>=500?'Admin service unavailable':err.message});
  });
  return router;
}
module.exports = {createAdminRouter};
