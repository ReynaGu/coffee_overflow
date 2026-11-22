'use strict';
/**
 * LOCAL LOOPBACK-ONLY Express app for integrating trusted registration, sessions,
 * checkout and shared-order permissions without changing Isaac's server.js.
 * Uses an injected, separately verified pool restricted to coffee_overflow_integration.
 * This is a staging demonstration, NOT an Internet-facing server.
 */
const express = require('express');
const path = require('node:path');
const {createAuthService} = require('../auth/authService');
const {createAuthRouter} = require('../auth/authRoutes');
const {createSessionGuards} = require('../auth/sessionGuards');
const {createCheckoutService} = require('../checkout/checkoutService');
const {createCheckoutRouter} = require('../checkout/checkoutRoutes');
const {createSharedOrderStore} = require('../admin/sharedOrderStore');
const {permittedTestEmail,permittedTestOrder,normalizeFixtureProduct} = require('./integrationRules');

const ROOT = path.resolve(__dirname,'../../..');
function createLocalIntegratedApp({pool,origin}) {
  if (!pool || typeof pool.execute !== 'function' || typeof pool.getConnection !== 'function') throw Error('Verified MySQL pool required');
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw Error('Local loopback origin required');
  const auth = createAuthService(pool);
  const guards = createSessionGuards({resolveVerifiedSession:req=>auth.resolveVerifiedSession(req)});
  const orders = createSharedOrderStore(pool);
  const app = express();
  app.disable('x-powered-by');
  app.disable('etag');
  app.use((req,res,next)=>{
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    next();
  });
  app.use(express.json({limit:'16kb'}));
  app.use((req,res,next)=>{
    if (['POST','PUT','PATCH','DELETE'].includes(req.method) && req.headers.origin !== origin) {
      return res.status(403).json({error:'Unrecognized request origin'});
    }
    next();
  });
  app.get('/',(_req,res)=>res.redirect('/integration/'));
  app.get('/integration/',(_req,res)=>res.sendFile(path.join(ROOT,'admin/integration-shop.html')));
  app.get('/integration/shop.js',(_req,res)=>res.type('js').sendFile(path.join(ROOT,'admin/integration-shop.js')));
  app.get('/integration/shop.css',(_req,res)=>res.type('css').sendFile(path.join(ROOT,'admin/integration-shop.css')));
  app.get('/integration/admin.css',(_req,res)=>res.type('css').sendFile(path.join(ROOT,'admin/admin.css')));
  // Do not permit non-fixture registrations in this local test application.
  app.use('/api/auth', (req,res,next)=>{
    if(req.method==='POST' && req.path==='/register' && !permittedTestEmail(req.body?.email)) {
      return res.status(400).json({error:'Use only a co-browser-...@example.test address in this isolated preview'});
    }
    next();
  }, createAuthRouter({service:auth,allowedOrigin:origin,secureCookies:false}));
  app.get('/api/integration/product',async(_req,res)=>{
    try {
      const [rows] = await pool.execute('SELECT product_id,name,description,price,stock_quantity FROM products WHERE product_id = ?',[1]);
      const [[state]] = await pool.execute('SELECT COUNT(*) AS order_count FROM orders');
      res.json({product:normalizeFixtureProduct(rows[0]),order_exists:Number(state.order_count)>0});
    } catch(e) {console.error('Integration product read failed:',e.message);res.status(503).json({error:'Local product data unavailable'});}
  });
  // This preview deliberately permits only ONE test product and quantity=1.
  // All real inventory and price validation still occurs inside Jalen's service.
  app.use('/api/orders', guards.identifyShopper, async (req,res,next)=>{
    if (!permittedTestOrder(req.body)) return res.status(400).json({error:'This local preview permits only one unit of fixture product #1'});
    try {
      // After the first order, allow only a retry of that same persisted token.
      // Do not let a browser refresh create a second unrelated fixture order.
      const [existing] = await pool.execute('SELECT client_token FROM checkout_requests LIMIT 2');
      if(existing.length>1 || (existing.length===1 && existing[0].client_token!==req.body.client_token)) {
        return res.status(409).json({error:'One test order already exists. Clean it up before creating another.'});
      }
      next();
    } catch(e) {console.error('Fixture checkout preflight failed:',e.message);res.status(503).json({error:'Cannot check integration fixture state'});}
  }, createCheckoutRouter({service:createCheckoutService(pool,{requireIdempotencyToken:true}),identifyShopper:guards.identifyShopper}));
  // Server-side origin and role/CSRF verification protect every admin route.
  // No admin user is created by this preview: admins require approved provisioning.
  const admin = express.Router();
  admin.use(guards.requireAdmin);
  const safe = f=>async(req,res)=>{try{await f(req,res);}catch(e){const code=Number(e.status);if(code>=400&&code<500)res.status(code).json({error:e.message});else{console.error('Local admin integration failed:',e.message);res.status(503).json({error:'Admin order API unavailable'});}}};
  admin.get('/stats',safe(async(_req,res)=>res.json(await orders.stats())));
  admin.get('/orders',safe(async(req,res)=>res.json(await orders.listOrders(req.query))));
  admin.get('/orders/:id',safe(async(req,res)=>res.json({order:await orders.getOrder(req.params.id)})));
  admin.patch('/orders/:id/status',safe(async(req,res)=>res.json(await orders.updateStatus(req.params.id,req.body,req.user))));
  app.use('/api/admin',admin);
  app.use((err,req,res,next)=>{ // eslint-disable-line no-unused-vars
    if(err) console.error('Local app request error:',err.message);
    res.status(err?.status===413?413:400).json({error:'Invalid request'});
  });
  return app;
}
module.exports={createLocalIntegratedApp};
