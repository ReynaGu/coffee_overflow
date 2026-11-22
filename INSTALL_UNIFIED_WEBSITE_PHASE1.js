'use strict';
/* Installs the two minimum in-place browser integration patches. No DB changes. */
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const cp=require('node:child_process');
const root=__dirname;
function fail(message){console.error('STOP: '+message);process.exitCode=1;}
function cmd(command){return cp.execFileSync('git',command,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}
function replaceOne(source,before,after,label){
  // Windows Git checkouts may use CRLF even though the repository stores LF.
  // Match only the expected original text, preserving each file's line endings.
  const crlf = source.includes('\r\n');
  if (crlf && source.replace(/\r\n/g, '').includes('\n')) {
    throw Error(`${label} contains mixed line endings; refusing to overwrite`);
  }
  const expected = crlf ? before.replace(/\n/g, '\r\n') : before;
  const replacement = crlf ? after.replace(/\n/g, '\r\n') : after;
  const segments=source.split(expected);
  if(segments.length!==2)throw Error(`${label} differs from the expected source or was already installed; refusing to overwrite`);
  return segments.join(replacement);
}
try{
  const branch=cmd(['branch','--show-current']);
  if(branch!=='feature/hudson-unified-website')throw Error(`Wrong branch (${branch}). Switch to feature/hudson-unified-website first.`);
  // Avoid overwriting a teammate's uncommitted work in these two tracked files.
  cp.execFileSync('git',['diff','--quiet','--','assets/js/cart.js','assets/js/storefront-products.js'],{cwd:root});
  cp.execFileSync('git',['diff','--cached','--quiet','--','assets/js/cart.js','assets/js/storefront-products.js'],{cwd:root});
  const required=['backend/src/unified/localUnifiedSiteApp.js','backend/src/unified/startLocalUnifiedSite.js','backend/src/unified/unifiedSiteRules.js','unified/login.html','unified/login.js','unified/site-ui.js','unified/config.js'];
  for(const p of required)if(!fs.existsSync(path.join(root,p)))throw Error(`Missing new package file: ${p}. Extract ZIP into repository root first.`);
  const cartFile=path.join(root,'assets/js/cart.js');
  const catalogFile=path.join(root,'assets/js/storefront-products.js');
  const cartOriginal=fs.readFileSync(cartFile,'utf8');
  const catalogOriginal=fs.readFileSync(catalogFile,'utf8');
  const checkoutBefore=`      const res = await fetch(CONFIG.API_BASE + "/api/orders", {\n        method: "POST",\n        headers: { "Content-Type": "application/json", Accept: "application/json" },\n        body: JSON.stringify({ ...checkoutBody, client_token: pending.token }),\n      });`;
  const checkoutAfter=`      // Unified local website: keep the HttpOnly session cookie and verify\n      // same-origin authenticated session + tab-scoped CSRF before checkout.\n      // The normal team checkout remains unchanged when the preview flag is off.\n      const requestHeaders = { "Content-Type": "application/json", Accept: "application/json" };\n      if (window.COFFEE_UNIFIED_PREVIEW === true) {\n        const csrf = sessionStorage.getItem('co_unified_csrf_v1');\n        if (!csrf) { flash('Sign in on the Account page before checkout.', 'warning'); return; }\n        const sessionResponse = await fetch(CONFIG.API_BASE + '/api/auth/session', {credentials:'same-origin',cache:'no-store'});\n        if (!sessionResponse.ok) throw new Error('Could not verify customer login');\n        const session = await sessionResponse.json();\n        if (!session.authenticated || session.user?.role !== 'customer') {\n          sessionStorage.removeItem('co_unified_csrf_v1');\n          flash('Your customer session has expired. Sign in again.', 'warning'); return;\n        }\n        requestHeaders['X-Coffee-CSRF'] = csrf;\n      }\n      const res = await fetch(CONFIG.API_BASE + "/api/orders", {\n        method: "POST", credentials: "same-origin",\n        headers: requestHeaders,\n        body: JSON.stringify({ ...checkoutBody, client_token: pending.token }),\n      });`;
  const discountBefore=`      const fingerprint = JSON.stringify(checkoutBody);`;
  const discountAfter=`      if (window.COFFEE_UNIFIED_PREVIEW === true && appliedDetails) {\n        flash('Discount codes are not supported in the local integration test. Remove the code before checking out.', 'warning');\n        return;\n      }\n      const fingerprint = JSON.stringify(checkoutBody);`;
  const catalogBefore=`  const API_URL = 'http://localhost:3000/api/products';`;
  const catalogAfter=`  const API_URL = (typeof window !== 'undefined' && window.COFFEE_UNIFIED_PREVIEW === true)\n    ? window.location.origin + '/api/products' : 'http://localhost:3000/api/products';`;
  const cartAfter=replaceOne(replaceOne(cartOriginal,checkoutBefore,checkoutAfter,'cart.js checkout request'),discountBefore,discountAfter,'cart.js discount guard');
  const catalogAfterText=replaceOne(catalogOriginal,catalogBefore,catalogAfter,'storefront-products.js API address');
  const backup=fs.mkdtempSync(path.join(os.tmpdir(),'coffee-overflow-unified-phase1-'));
  fs.copyFileSync(cartFile,path.join(backup,'cart.js'));
  fs.copyFileSync(catalogFile,path.join(backup,'storefront-products.js'));
  try{
    fs.writeFileSync(cartFile,cartAfter,'utf8');fs.writeFileSync(catalogFile,catalogAfterText,'utf8');
  }catch(e){fs.writeFileSync(cartFile,cartOriginal);fs.writeFileSync(catalogFile,catalogOriginal);throw e;}
  console.log('SUCCESS: Installed Phase 1 minimal browser integration changes.');
  console.log('Modified only assets/js/cart.js and assets/js/storefront-products.js');
  console.log('Original files backed up at: '+backup);
  console.log('Next: node --test backend/src/unified/unifiedSiteRules.test.js');
  console.log('Then: node backend/src/unified/startLocalUnifiedSite.js');
}catch(e){fail(e.message||String(e));}
