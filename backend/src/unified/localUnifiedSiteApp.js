'use strict';
/** LOCAL LOOPBACK PREVIEW ONLY. Serves the real team's static website plus the
 * previously verified restricted integration API. Never serve on a public host.
 * No production payments, no free-form registration/order testing. */
const fs=require('node:fs');
const path=require('node:path');
const express=require('express');
const {createLocalAdminVisualApp}=require('../integration/localAdminVisualApp');
const {injectConfig,previewProduct,isAllowedPage}=require('./unifiedSiteRules');
const ROOT=path.resolve(__dirname,'../../..');
const SITE_CSP="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; font-src 'self' data: https://cdn.jsdelivr.net; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'";
function createLocalUnifiedSiteApp({pool,origin}) {
  const url=new URL(origin);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!/^\d+$/.test(url.port)||url.pathname!=='/'||url.search||url.hash) {
    throw Error('An explicit 127.0.0.1 localhost HTTP origin is required');
  }
  // This app deliberately uses only the already-verified integration database pool.
  const preview=createLocalAdminVisualApp({pool,origin});
  const app=express();
  app.disable('x-powered-by');
  app.disable('etag');
  app.use((req,res,next)=>{
    if(req.headers.host!==url.host) return res.status(403).type('text').send('Unexpected preview host');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy',SITE_CSP);
    next();
  });
  const page=(filename)=>(_req,res)=>{
    const source=fs.readFileSync(path.join(ROOT,filename),'utf8');
    return res.type('html').send(injectConfig(source));
  };
  app.get('/',page('index.html'));
  app.get('/login.html',(_req,res)=>res.sendFile(path.join(ROOT,'unified/login.html')));
  app.get('/:page', (req,res,next)=>isAllowedPage(req.params.page)?page(req.params.page)(req,res):next());
  app.use('/assets',express.static(path.join(ROOT,'assets'),{dotfiles:'deny',index:false,fallthrough:false}));
  app.use('/unified',express.static(path.join(ROOT,'unified'),{dotfiles:'deny',index:false,fallthrough:false}));
  // The standard product cards and cart now read our existing safe fixture.
  // This endpoint cannot accidentally advertise products that the one-order
  // integration checkout does not permit purchasing.
  async function productRows(req,res) {
    try {
      const [rows]=await pool.execute('SELECT product_id,name,description,price,stock_quantity FROM products WHERE product_id=?',[1]);
      if(rows.length!==1) return res.status(503).json({error:'Test product is missing'});
      const product=previewProduct(rows[0]);
      if(req.params.id!==undefined){if(req.params.id!=='1') return res.status(404).json({error:'Product unavailable'});return res.json(product);}
      return res.json([product]);
    }catch(e){console.error('Unified preview product read failed:',e.message);return res.status(503).json({error:'Test catalog unavailable'});}
  }
  app.get('/api/products',productRows);
  app.get('/api/products/:id',productRows);
  // Auth / checkout / protected admin are delegated unchanged to the already
  // tested isolated integration app. Crucially this also retains the server's
  // fixed-fixture allowlist and CSRF/role protection.
  app.use(preview);
  return app;
}
module.exports={createLocalUnifiedSiteApp};
