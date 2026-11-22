'use strict';
/** Additional fixture rules around the Phase 4B1 authenticated API app.
 * The B1 router still enforces all actual session/CSRF/role checks.
 * Stock=1 means two concurrent distinct-token purchases cannot both commit.
 */
const {ORIGIN,validTestCustomer,permittedTestCheckout}=require('./teamAuthBoundary');
const {ensure}=require('./teamAuthFixture');
function allowCheckoutClaim(rows,token){
  ensure(Array.isArray(rows)&&rows.length<=1,'more than one checkout request');
  return rows.length===0||rows[0].client_token===token;
}
function createTeamBoundedAuthenticatedApp({pool,customerEmail,origin=ORIGIN}){
  const express=require('express');
  const {createTeamAuthenticatedApp}=require('./teamAuthenticatedApp');
  ensure(origin===ORIGIN&&validTestCustomer(customerEmail),'wrong local API origin or customer');
  ensure(pool&&typeof pool.execute==='function','verified MySQL pool required');
  const app=express();app.disable('x-powered-by');
  app.use(express.json({limit:'16kb'}));
  app.post('/api/auth/register',(req,res,next)=>{
    if(req.body?.email!==customerEmail)return res.status(400).json({error:'Only the one designated test customer can register'});
    next();
  });
  app.post('/api/orders',async(req,res,next)=>{
    if(!permittedTestCheckout(req.body))return res.status(400).json({error:'Only product #601, quantity 1, is permitted'});
    try{
      const [existing]=await pool.execute('SELECT client_token FROM checkout_requests LIMIT 2');
      if(!allowCheckoutClaim(existing,req.body.client_token))return res.status(409).json({error:'The single test order already exists'});
      next();
    }catch(e){console.error('Local checkout boundary unavailable:',e.message);res.status(503).json({error:'Cannot verify single-order test boundary'});}
  });
  // Delegation preserves the complete B1 origin validation and verified auth.
  app.use(createTeamAuthenticatedApp({pool,origin}));
  return app;
}
module.exports={allowCheckoutClaim,createTeamBoundedAuthenticatedApp};
