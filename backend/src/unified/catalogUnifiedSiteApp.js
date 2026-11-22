'use strict';
/** Phase 2: LOCALHOST ONLY unified site over the bounded 19-product catalog.
 * It serves the team's original pages and uses EXISTING verified auth/admin.
 * One single synthetic order (up to three distinct products / three of each)
 * is allowed to keep teardown auditable; no payments or real customer data.
 */
const fs=require('node:fs'),path=require('node:path'),express=require('express');
const {createLocalAdminVisualApp}=require('../integration/localAdminVisualApp');
const {createAuthService}=require('../auth/authService');
const {createSessionGuards}=require('../auth/sessionGuards');
const {createCheckoutService}=require('../checkout/checkoutService');
const {createCheckoutRouter}=require('../checkout/checkoutRoutes');
const {injectConfig,isAllowedPage}=require('./unifiedSiteRules');
const {SELECT_CATALOG,validateCatalog,toPublicProduct,permittedCatalogOrder}=require('./catalogPhase2Data');
const ROOT=path.resolve(__dirname,'../../..');
const CSP="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; font-src 'self' data: https://cdn.jsdelivr.net; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'";
function createCatalogUnifiedSiteApp({pool,origin}){
  const url=new URL(origin);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!/^\d+$/.test(url.port)||url.pathname!=='/'||url.search||url.hash)throw Error('Only explicit loopback HTTP origin is permitted');
  if(!pool||typeof pool.getConnection!=='function'||typeof pool.execute!=='function')throw Error('Verified MySQL pool required');
  const preview=createLocalAdminVisualApp({pool,origin});
  const auth=createAuthService(pool);
  const guards=createSessionGuards({resolveVerifiedSession:req=>auth.resolveVerifiedSession(req)});
  const app=express();app.disable('x-powered-by');app.disable('etag');
  app.use((req,res,next)=>{
    if(req.headers.host!==url.host)return res.status(403).type('text').send('Unexpected preview host');
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy',CSP);next();
  });
  const page=name=>(_req,res)=>res.type('html').send(injectConfig(fs.readFileSync(path.join(ROOT,name),'utf8')));
  app.get('/',page('index.html'));
  app.get('/login.html',(_req,res)=>res.sendFile(path.join(ROOT,'unified/login.html')));
  app.get('/:page',(req,res,next)=>isAllowedPage(req.params.page)?page(req.params.page)(req,res):next());
  app.use('/assets',express.static(path.join(ROOT,'assets'),{dotfiles:'deny',index:false,fallthrough:false}));
  app.use('/unified',express.static(path.join(ROOT,'unified'),{dotfiles:'deny',index:false,fallthrough:false}));
  async function catalog(req,res){
    try{
      const [rows]=await pool.query(SELECT_CATALOG);
      validateCatalog(rows,{allowSold:true});
      const products=rows.map(toPublicProduct);
      if(req.params.id!==undefined){
        const p=products.find(x=>String(x.product_id)===req.params.id);
        return p?res.json(p):res.status(404).json({error:'Product unavailable'});
      }
      return res.json(products);
    }catch(e){console.error('Local Phase 2 catalog rejected:',e.message);return res.status(503).json({error:'Local catalog unavailable'});}
  }
  app.get('/api/products',catalog);app.get('/api/products/:id',catalog);
  // Only registered synthetic customers can place one bounded test order.
  app.use('/api/orders',express.json({limit:'16kb'}),
    (req,res,next)=>req.method!=='POST'||req.headers.origin===origin?next():res.status(403).json({error:'Unexpected origin'}),
    guards.identifyShopper,
    (req,res,next)=>req.user.role==='customer'?next():res.status(403).json({error:'Test checkout requires a customer account'}),
    async(req,res,next)=>{
      if(!permittedCatalogOrder(req.body))return res.status(400).json({error:'This local test accepts up to 3 distinct catalog products with quantity 1–3, without discounts'});
      try{
        const [claims]=await pool.execute('SELECT client_token FROM checkout_requests LIMIT 2');
        if(claims.length>1 || (claims.length===1&&claims[0].client_token!==req.body.client_token))
          return res.status(409).json({error:'The single test order already exists. Clean the fixture before trying another order.'});
        next();
      }catch(e){console.error('Local catalog checkout preflight failed:',e.message);res.status(503).json({error:'Local checkout temporarily unavailable'});}
    },
    createCheckoutRouter({service:createCheckoutService(pool,{requireIdempotencyToken:true}),identifyShopper:guards.identifyShopper})
  );
  // Delegate auth and protected admin APIs to the same tested loopback app.
  app.use(preview);
  return app;
}
module.exports={createCatalogUnifiedSiteApp};
