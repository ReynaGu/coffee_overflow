'use strict';
/** One-shot local HTTP integration smoke. No db access, no payments, no browser required.
 * Creates exactly one designated customer and one order; do not run twice.
 */
const crypto=require('node:crypto');
const {validTestAdmin,validTestCustomer,ORIGIN,FIXTURE_PRODUCT_ID}=require('./teamAuthBoundary');
const {ensure}=require('./teamAuthFixture');
const TOKEN=()=>crypto.randomUUID();
function request(path,{method='GET',body,auth}={}){
  const headers={'Accept':'application/json'};
  if(method!=='GET'&&method!=='HEAD')headers.Origin=ORIGIN;
  if(body!==undefined)headers['Content-Type']='application/json';
  if(auth){headers.Cookie=auth.cookie;headers['x-coffee-csrf']=auth.csrfToken;}
  return fetch(ORIGIN+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'})
    .then(async response=>{
      const json=await response.json().catch(()=>null);
      return {status:response.status,body:json,cookie:response.headers.get('set-cookie')};
    });
}
function expect(response,status,label){ensure(response.status===status,`${label}: expected HTTP ${status}, got ${response.status}`);return response.body;}
function authenticated(response){
  ensure(response.status===200&&response.cookie&&response.body?.csrfToken,'session cookie and CSRF missing');
  return {cookie:response.cookie.split(';')[0],csrfToken:response.body.csrfToken};
}
async function smoke(adminEmail,customerEmail,adminPassword){
  ensure(validTestAdmin(adminEmail)&&validTestCustomer(customerEmail),'exact synthetic emails required');
  console.log('Checking sandbox server and single test product...');
  const health=expect(await request('/api/health'),200,'health');
  ensure(health.mode==='local-migrated-schema-auth-contract'&&health.payments===false,'unexpected server mode');
  const catalog=expect(await request('/api/products'),200,'catalog');
  ensure(Array.isArray(catalog)&&catalog.length===1&&Number(catalog[0].product_id)===FIXTURE_PRODUCT_ID&&catalog[0].stock===1,'unexpected catalog baseline');
  const orderPayload={client_token:TOKEN(),items:[{product_id:FIXTURE_PRODUCT_ID,quantity:1}]};
  expect(await request('/api/orders',{method:'POST',body:orderPayload}),401,'anonymous order rejected');
  console.log('PASS: anonymous checkout rejected. Registering designated synthetic shopper...');
  const customerPassword=crypto.randomBytes(24).toString('base64url');
  expect(await request('/api/auth/register',{method:'POST',body:{
    first_name:'Integration',last_name:'Shopper',email:customerEmail,password:customerPassword,
    street:'1 Example Road',city:'Test City',state:'TX',zip_code:'78253'
  }}),201,'register');
  const shopper=authenticated(await request('/api/auth/login',{method:'POST',body:{email:customerEmail,password:customerPassword}}));
  expect(await request('/api/admin/orders',{auth:shopper}),403,'shopper forbidden from admin');
  console.log('PASS: registration/login, customer admin isolation. Placing one order...');
  const purchase=expect(await request('/api/orders',{method:'POST',body:orderPayload,auth:shopper}),201,'checkout');
  const receipt=purchase.order;
  ensure(receipt&&receipt.subtotal_cents===1800&&receipt.tax_cents===149&&receipt.total_cents===1949,'wrong checkout receipt');
  const orderId=Number(receipt.order_id);ensure(Number.isSafeInteger(orderId)&&orderId>0,'missing order ID');
  const replay=expect(await request('/api/orders',{method:'POST',body:orderPayload,auth:shopper}),201,'idempotent replay');
  ensure(replay.order.order_id===orderId&&replay.order.replayed===true,'retry not safely replayed');
  expect(await request('/api/orders',{method:'POST',body:{...orderPayload,client_token:TOKEN()},auth:shopper}),409,'second order rejected');
  const after=expect(await request('/api/products'),200,'inventory');
  ensure(after.length===1&&after[0].stock===0,'stock not decremented exactly once');
  console.log('PASS: one $19.49 order, one stock decrement, retry replayed, new order blocked.');
  const admin=authenticated(await request('/api/auth/login',{method:'POST',body:{email:adminEmail,password:adminPassword}}));
  const details=expect(await request(`/api/admin/orders/${orderId}`,{auth:admin}),200,'admin order');
  ensure(details.order?.items?.length===1&&details.order.items[0].unit_price_cents===1800,'incorrect Admin order items');
  expect(await request(`/api/admin/orders/${orderId}/status`,{method:'PATCH',auth:admin,body:{status:'processing',note:'Phase 4B2 migration API smoke'}}),200,'processing');
  expect(await request(`/api/admin/orders/${orderId}/status`,{method:'PATCH',auth:admin,body:{status:'fulfilled',note:'Phase 4B2 fulfilled'}}),200,'fulfilled');
  const final=expect(await request(`/api/admin/orders/${orderId}`,{auth:admin}),200,'final order');
  ensure(final.order.status==='fulfilled'&&final.order.events.some(x=>x.to_status==='processing')&&
    final.order.events.some(x=>x.to_status==='fulfilled'),'missing status audit history');
  const stats=expect(await request('/api/admin/stats',{auth:admin}),200,'admin stats');
  ensure(stats.orders===1&&stats.pending===0&&stats.fulfilled===1&&stats.revenue_cents===1949,'incorrect admin stats');
  expect(await request('/api/auth/logout',{method:'POST',auth:shopper,body:{}}),200,'customer logout');
  expect(await request('/api/auth/logout',{method:'POST',auth:admin,body:{}}),200,'admin logout');
  expect(await request('/api/admin/orders',{auth:admin}),401,'logged-out admin blocked');
  console.log('SUCCESS: Verified customer/admin HTTP auth, CSRF, checkout, idempotency, stock, processing, fulfillment, logout.');
  console.log('ORDER ID:',orderId,'TOTAL: $19.49; admin events verified; sessions revoked.');
  console.log('STOP port 5191 server and use cleanupLocalTeamAuth.js with the two exact emails.');
  return {orderId};
}
async function main(){
  const {hiddenPrompt}=require('../unified/catalogPhase2Db');
  const adminEmail=String(process.argv[2]||'').trim();
  const customerEmail=String(process.argv[3]||'').trim();
  ensure(validTestAdmin(adminEmail)&&validTestCustomer(customerEmail),'pass the exact two emails from the seed output');
  console.log('PHASE 4B2 ONE-SHOT HTTP TEST — creates one synthetic customer and order. Do not repeat.');
  const adminPassword=await hiddenPrompt('Synthetic test ADMIN password chosen during seed (hidden): ');
  await smoke(adminEmail,customerEmail,adminPassword);
}
if(require.main===module)main().catch(e=>{console.error('PHASE 4B HTTP SMOKE STOPPED:',e.message);process.exitCode=1;});
module.exports={request,expect,smoke};
