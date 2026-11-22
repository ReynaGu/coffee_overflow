'use strict';
/** Phase 4B route composition for the *disposable migrated sandbox only*.
 * Not automatically mounted by server.js. DO NOT create a launcher or grant
 * write access without exact fixture-seeding and rollback/cleanup validation.
 * All checks are defensive in depth; deployment security is out of scope.
 */
const express=require('express');
const {createAuthService}=require('../auth/authService');
const {createAuthRouter}=require('../auth/authRoutes');
const {createSessionGuards}=require('../auth/sessionGuards');
const {createCheckoutService}=require('../checkout/checkoutService');
const {createCheckoutRouter}=require('../checkout/checkoutRoutes');
const {createSharedOrderStore}=require('../admin/sharedOrderStore');
const {createTeamCatalog}=require('./teamCatalog');
const {ORIGIN,validOrigin,validHost,validMutationOrigin,validTestCustomer,permittedTestCheckout}=require('./teamAuthBoundary');

function createTeamAuthenticatedApp({pool,origin=ORIGIN}={}){
  if(!validOrigin(origin))throw Error('Only the Phase 4B 127.0.0.1:5191 test origin is allowed');
  if(!pool||typeof pool.execute!=='function'||typeof pool.getConnection!=='function')throw Error('Verified local MySQL pool required');
  const auth=createAuthService(pool);
  const guards=createSessionGuards({resolveVerifiedSession:req=>auth.resolveVerifiedSession(req)});
  const catalog=createTeamCatalog(pool);
  const orders=createSharedOrderStore(pool);
  const checkout=createCheckoutService(pool,{requireIdempotencyToken:true});
  const app=express();app.disable('x-powered-by');app.disable('etag');
  app.use((req,res,next)=>{
    if(!validHost(req))return res.status(403).json({error:'Unexpected test host'});
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'");
    if(!validMutationOrigin(req))return res.status(403).json({error:'Unexpected request origin'});
    return next();
  });
  app.use(express.json({limit:'16kb'}));
  const handle=fn=>async(req,res)=>{
    try{await fn(req,res);}catch(e){const status=Number(e?.status);if(status>=400&&status<500)return res.status(status).json({error:e.message});console.error('Phase 4B API failure:',e?.message);return res.status(503).json({error:'Test API temporarily unavailable'});}
  };
  app.get('/api/health',(_req,res)=>res.json({status:'ok',mode:'local-migrated-schema-auth-contract',payments:false}));
  app.get('/api/products',handle(async(_req,res)=>res.json(await catalog.list())));
  app.get('/api/products/:id',handle(async(req,res)=>{
    const product=await catalog.get(req.params.id);
    return product?res.json(product):res.status(404).json({error:'Product not found'});
  }));
  app.use('/api/auth',(req,res,next)=>{
    if(req.method==='POST'&&req.path==='/register'&&!validTestCustomer(req.body?.email))return res.status(400).json({error:'Use a synthetic co-browser-...@example.test customer account only'});
    next();
  },createAuthRouter({service:auth,allowedOrigin:origin,secureCookies:false}));
  app.use('/api/orders',
    (req,res,next)=>req.method==='POST'?next():res.status(405).json({error:'Unsupported order method'}),
    (req,res,next)=>permittedTestCheckout(req.body)?next():res.status(400).json({error:'This local contract accepts exactly one unit of test product #601; no additional fields or discounts'}),
    guards.identifyShopper,
    createCheckoutRouter({service:checkout,identifyShopper:guards.identifyShopper})
  );
  const admin=express.Router();
  admin.use(guards.requireAdmin);
  admin.get('/stats',handle(async(_req,res)=>res.json(await orders.stats())));
  admin.get('/orders',handle(async(req,res)=>res.json(await orders.listOrders(req.query))));
  admin.get('/orders/:id',handle(async(req,res)=>res.json({order:await orders.getOrder(req.params.id)})));
  admin.patch('/orders/:id/status',handle(async(req,res)=>res.json(await orders.updateStatus(req.params.id,req.body,req.user))));
  app.use('/api/admin',admin);
  app.use((_req,res)=>res.status(404).json({error:'Not available in local contract'}));
  app.use((err,_req,res,_next)=>{
    if(err?.type==='entity.parse.failed')return res.status(400).json({error:'Invalid JSON'});
    if(err?.type==='entity.too.large')return res.status(413).json({error:'Request too large'});
    console.error('Phase 4B request error:',err?.message);
    return res.status(400).json({error:'Invalid request'});
  });
  return app;
}
module.exports={createTeamAuthenticatedApp};
