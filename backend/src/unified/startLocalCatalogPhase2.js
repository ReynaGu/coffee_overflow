'use strict';
/** Phase 2 synthetic 19-product website; binds ONLY 127.0.0.1:5181. */
const crypto=require('node:crypto');
const {createAuthService}=require('../auth/authService');
const {exactAdminEmail}=require('../integration/adminVisualRules');
const {createCatalogUnifiedSiteApp}=require('./catalogUnifiedSiteApp');
const {HOST,PORT,hiddenPrompt,makePool,verifyDb,verifyBaseWithCatalog,counts,expectNoActivity}=require('./catalogPhase2Db');
async function main(){
  console.log('Coffee Overflow — Phase 2 multi-product LOCAL TEST website. No payments.');
  console.log('Uses ONLY coffee_overflow_integration and 127.0.0.1:5181. Seed first, clean up afterwards.');
  const password=await hiddenPrompt('Restricted integration MySQL password (hidden): ');
  const pool=makePool(password);let adminId=null,email=null,server=null;
  try{
    await verifyDb(pool);await verifyBaseWithCatalog(pool);expectNoActivity(await counts(pool));
    console.log('PASS: Exactly 19 staged products + fixture #1, no orders or sessions.');
    const testPassword=await hiddenPrompt('Choose NEW test admin password (12+ characters, hidden): ');
    if(testPassword.length<12||testPassword.length>128||Buffer.byteLength(testPassword,'utf8')>256)throw Error('Test password must be 12–128 characters');
    const auth=createAuthService(pool);
    email=`co-admin-${crypto.randomBytes(6).toString('hex')}@example.test`;
    if(!exactAdminEmail(email))throw Error('Synthetic admin email invalid');
    const admin=await auth.register({first_name:'Integration',last_name:'Catalog Admin',email,password:testPassword,street:'1 Example Road',city:'Test City',state:'TX',zip_code:'78253'});
    adminId=admin.id;
    const [changed]=await pool.execute("UPDATE auth_credentials SET role='admin' WHERE user_id=? AND role='customer' AND is_active=1",[adminId]);
    if(changed.affectedRows!==1)throw Error('Could not provision local administrator');
    const origin=`http://${HOST}:${PORT}`;
    const app=createCatalogUnifiedSiteApp({pool,origin});
    server=await new Promise((resolve,reject)=>{const s=app.listen(PORT,HOST,()=>resolve(s));s.once('error',reject);});
    console.log('SUCCESS: Phase 2 local multi-product website running!');
    console.log('HOME: '+origin+'/');
    console.log('PRODUCTS: '+origin+'/products.html');
    console.log('LOGIN: '+origin+'/login.html');
    console.log('CART: '+origin+'/cart.html');
    console.log('ADMIN: '+origin+'/integration/admin/');
    console.log('SYNTHETIC ADMIN EMAIL: '+email);
    console.log('One order only: up to three catalog products and quantity 1–3 each. Preserve both synthetic emails for exact cleanup.');
    const close=()=>server.close(()=>pool.end().then(()=>process.exit(0)));
    process.once('SIGINT',close);process.once('SIGTERM',close);
  }catch(e){
    if(server)await new Promise(resolve=>server.close(resolve));
    if(adminId!==null){
      try{const [del]=await pool.execute('DELETE FROM users WHERE id=? AND email=?',[adminId,email]);
        if(del.affectedRows===1)console.log('RECOVERY: Synthetic administrator removed after startup failure.');
        else console.error('MANUAL REVIEW: Synthetic admin cleanup mismatch',email);
      }catch(err){console.error('MANUAL REVIEW: Cannot remove synthetic admin',err.message);}
    }
    await pool.end();throw e;
  }
}
if(require.main===module)main().catch(e=>{console.error('CATALOG WEBSITE START FAILED:',e.message);process.exitCode=1;});
module.exports={main};
