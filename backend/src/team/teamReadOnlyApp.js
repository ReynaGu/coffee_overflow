'use strict';
/** Directly reusable Express product API, independent of team server.js.
 * GET/HEAD ONLY. No customer auth, orders, admin, or static storefront yet.
 */
const express=require('express');
const {createTeamCatalog}=require('./teamCatalog');
const {assertOrigin}=require('./teamReadiness');
function createTeamReadOnlyApp({pool,origin}){
  assertOrigin(origin);
  const catalog=createTeamCatalog(pool);
  const host=new URL(origin).host;
  const app=express();app.disable('x-powered-by');app.disable('etag');
  app.use((req,res,next)=>{
    if(req.headers.host!==host)return res.status(403).json({error:'Unexpected local host'});
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    if(req.method!=='GET'&&req.method!=='HEAD')return res.status(405).json({error:'Read-only preview; write routes are not enabled'});
    return next();
  });
  app.get('/api/health',(_req,res)=>res.json({status:'ok',mode:'local-migrated-schema-readonly',payments:false}));
  app.get('/api/products',async(_req,res)=>{
    try{return res.json(await catalog.list());}
    catch(e){console.error('Read-only catalog failed:',e.message);return res.status(503).json({error:'Catalog unavailable'});}
  });
  app.get('/api/products/:id',async(req,res)=>{
    try{
      const row=await catalog.get(req.params.id);
      return row?res.json(row):res.status(404).json({error:'Product not found'});
    }catch(e){console.error('Read-only product lookup failed:',e.message);return res.status(503).json({error:'Catalog unavailable'});}
  });
  app.use((_req,res)=>res.status(404).json({error:'Not available in read-only preview'}));
  return app;
}
module.exports={createTeamReadOnlyApp};
