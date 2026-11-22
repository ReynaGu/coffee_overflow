'use strict';
/** Pure, fail-closed constraints for the opt-in *local* Phase 4B API contract.
 * This is NOT a production authentication or checkout policy.
 */
const {validateCheckoutToken} = require('../checkout/checkoutIdempotency');
const HOST='127.0.0.1', PORT=5191;
const ORIGIN=`http://${HOST}:${PORT}`;
const FIXTURE_PRODUCT_ID=601;
const ADMIN_RE=/^co-admin-[0-9a-f]{12}@example\.test$/;
const CUSTOMER_RE=/^co-browser-[a-z0-9]{6,24}@example\.test$/;
const UNSAFE=new Set(['POST','PUT','PATCH','DELETE']);
function validOrigin(origin){return origin===ORIGIN;}
function validTestAdmin(email){return typeof email==='string'&&ADMIN_RE.test(email);}
function validTestCustomer(email){return typeof email==='string'&&CUSTOMER_RE.test(email);}
function validHost(req){return req?.headers?.host===`${HOST}:${PORT}`;}
function validMutationOrigin(req){return !UNSAFE.has(String(req?.method||'').toUpperCase())||req?.headers?.origin===ORIGIN;}
function permittedTestCheckout(body){
  if(!body||typeof body!=='object'||Array.isArray(body))return false;
  const keys=Object.keys(body).sort();
  // The shared service accepts additional browser fields by design, but the
  // narrow Phase 4B fixture must reject all client prices, roles and user ids.
  if(keys.length!==2||keys[0]!=='client_token'||keys[1]!=='items')return false;
  try{validateCheckoutToken(body.client_token);}catch{return false;}
  if(!Array.isArray(body.items)||body.items.length!==1)return false;
  const line=body.items[0];
  if(!line||typeof line!=='object'||Array.isArray(line))return false;
  const lineKeys=Object.keys(line).sort();
  if(lineKeys.length!==2||lineKeys[0]!=='product_id'||lineKeys[1]!=='quantity')return false;
  return (line.product_id===FIXTURE_PRODUCT_ID||line.product_id===String(FIXTURE_PRODUCT_ID))&&line.quantity===1;
}
module.exports={HOST,PORT,ORIGIN,FIXTURE_PRODUCT_ID,validOrigin,validHost,validMutationOrigin,validTestAdmin,validTestCustomer,permittedTestCheckout};
