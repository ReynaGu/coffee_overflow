'use strict';
/** Installer for the user's reviewed integration branch ONLY.
 * Makes surgical exact-match edits, refusing changed/unexpected source files.
 * Backups go to the OS temporary folder OUTSIDE the Git repository.
 */
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {execFileSync}=require('node:child_process');
const root=process.cwd();
const targetFiles=[
 'backend/src/checkout/checkoutService.js',
 'backend/src/server.js',
 'assets/js/cart.js'
];
function replaceExactly(text,search,replacement,file,label){
 const pieces=text.split(search);
 if(pieces.length!==2)throw Error(`${file}: expected exactly one matching section for ${label} (found ${pieces.length-1}). No files changed.`);
 return pieces.join(replacement);
}
function main(){
 if(!fs.existsSync(path.join(root,'.git')))throw Error('Run from the coffee_overflow repository root. No files changed.');
 const branch=execFileSync('git',['branch','--show-current'],{cwd:root,encoding:'utf8'}).trim();
 if(branch!=='feature/hudson-checkout-integration')throw Error(`Wrong branch: ${branch}. No files changed.`);
 const data=new Map();
 for(const file of targetFiles)data.set(file,fs.readFileSync(path.join(root,file),'utf8'));
 for(const file of targetFiles){
   const status=execFileSync('git',['status','--porcelain','--',file],{cwd:root,encoding:'utf8'}).trim();
   if(status)throw Error(`Please commit or discard existing changes to ${file} before applying. No files changed.`);
 }
 let service=data.get(targetFiles[0]);
 const sv=targetFiles[0];
 service=replaceExactly(service,"const { toDecimal, unitPriceCents, orderTotals } = require('./pricing');", "const { toDecimal, unitPriceCents, orderTotals } = require('./pricing');\nconst { validateCheckoutToken, claimCheckoutRequest, storeCheckoutReceipt } = require('./checkoutIdempotency');",sv,'helper import');
 service=replaceExactly(service,"function createCheckoutService(pool, { now = () => new Date() } = {}) {", "function createCheckoutService(pool, { now = () => new Date(), requireIdempotencyToken = false } = {}) {",sv,'service option');
 service=replaceExactly(service,"    const { items } = validateOrderRequest(body);\n\n    const conn = await pool.getConnection();", "    const { items } = validateOrderRequest(body);\n    // The team Express route requires tokens. Existing isolated smoke scripts\n    // may omit them to preserve their original one-off test behavior.\n    const token = requireIdempotencyToken ? validateCheckoutToken(body.client_token) : null;\n\n    const conn = await pool.getConnection();",sv,'token validation');
 service=replaceExactly(service,"      await conn.beginTransaction();\n\n      // 1 + 2: lock and re-price every line from the database.", "      await conn.beginTransaction();\n      let claim = null;\n      if (token) {\n        claim = await claimCheckoutRequest(conn, { token, userId, items });\n        if (claim.replay) {\n          await conn.commit();\n          return { ...claim.replay, replayed: true };\n        }\n      }\n\n      // 1 + 2: lock and re-price every line from the database.",sv,'atomic token lock');
 service=replaceExactly(service,"      await conn.commit();\n\n      // 5: receipt for the confirmation page (cents, so the cart can format it).\n      return {", "      // 5: persist the receipt in the SAME transaction as the order and stock.\n      // This makes a retry return the original result even after a lost response.\n      const receipt = {",sv,'receipt before commit');
 service=replaceExactly(service,"        total_cents: totals.totalCents\n      };\n    } catch (error) {", "        total_cents: totals.totalCents\n      };\n      if (claim) await storeCheckoutReceipt(conn, claim, receipt);\n      await conn.commit();\n      return claim ? { ...receipt, replayed: false } : receipt;\n    } catch (error) {",sv,'receipt commit');
 let server=data.get(targetFiles[1]);
 server=replaceExactly(server,"service: createCheckoutService(pool),", "service: createCheckoutService(pool, { requireIdempotencyToken: true }),",targetFiles[1],'enforce token at team route');
 let cart=data.get(targetFiles[2]);
 const c=targetFiles[2];
 cart=replaceExactly(cart, '  const CODE_KEY = "co_cart_code";', '  const CODE_KEY = "co_cart_code";\n  const CHECKOUT_REQUEST_KEY = "co_checkout_request_v1";',c,'browser key');
 cart=replaceExactly(cart, '      const res = await fetch(CONFIG.API_BASE + "/api/orders", {', `      // Store one durable token per cart payload. A network retry reuses the\n      // token so the server cannot create the same purchase twice.\n      const checkoutBody = {\n        items: cart.map((l) => ({ product_id: Number(l.id), quantity: l.qty })),\n        discount_code: appliedDetails ? appliedDetails.code : null,\n      };\n      const fingerprint = JSON.stringify(checkoutBody);\n      let pending = read(CHECKOUT_REQUEST_KEY, null);\n      if (!pending || pending.fingerprint !== fingerprint || !pending.token) {\n        if (!window.crypto || typeof window.crypto.randomUUID !== "function") {\n          throw new Error("A secure browser checkout token is unavailable");\n        }\n        pending = { fingerprint, token: window.crypto.randomUUID() };\n        // Do not place an order if retry state cannot be persisted.\n        localStorage.setItem(CHECKOUT_REQUEST_KEY, JSON.stringify(pending));\n      }\n      const res = await fetch(CONFIG.API_BASE + "/api/orders", {`,c,'durable cart token');
 cart=replaceExactly(cart, `        body: JSON.stringify({\n          items: cart.map((l) => ({ product_id: Number(l.id), quantity: l.qty })),\n          discount_code: appliedDetails ? appliedDetails.code : null,\n        }),`, `        body: JSON.stringify({ ...checkoutBody, client_token: pending.token }),`,c,'include token in request');
 cart=replaceExactly(cart, `      saveCart();\n      window.scrollTo({ top: 0, behavior: "smooth" });`, `      saveCart();\n      // Successful receipt acknowledged: a NEW purchase needs a NEW token.\n      try { localStorage.removeItem(CHECKOUT_REQUEST_KEY); } catch (_) { /* local storage may be disabled later */ }\n      window.scrollTo({ top: 0, behavior: "smooth" });`,c,'reset token after success');
 const updated=[service,server,cart];
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'coffee_checkout_idempotency_'));
 // All source anchors validated before the first write.
 for(let i=0;i<targetFiles.length;i++){
   const file=targetFiles[i];
   const backup=path.join(directory,file.replaceAll('/','__'));
   fs.writeFileSync(backup,data.get(file));
 }
 for(let i=0;i<targetFiles.length;i++){
   fs.writeFileSync(path.join(root,targetFiles[i]),updated[i]);
   console.log('PATCHED:',targetFiles[i]);
 }
 console.log('SUCCESS: Strict checkout idempotency enabled for the Express route.');
 console.log('Backups (outside Git):',directory);
 console.log('NEXT: run node --check and the automated tests. Do not commit until all pass.');
}
try { main(); } catch(e){ console.error('INSTALL STOPPED:',e.message);process.exitCode=1; }
