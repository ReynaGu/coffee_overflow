'use strict';
/** One local-only server for the REAL team's pages and existing test-only APIs.
 * Requires the already-approved isolated integration fixture, not main DB. */
const crypto=require('node:crypto');
const mysql=require('mysql2/promise');
const {createAuthService}=require('../auth/authService');
const {verifyCleanFixture}=require('../integration/startLocalAdminVisual');
const {exactAdminEmail}=require('../integration/adminVisualRules');
const {createLocalUnifiedSiteApp}=require('./localUnifiedSiteApp');
const HOST='127.0.0.1',PORT=5180,DATABASE='coffee_overflow_integration',USER='coffee_overflow_integration_app';
function hiddenPrompt(label){
  return new Promise((resolve,reject)=>{
    const input=process.stdin;
    if(!input.isTTY||typeof input.setRawMode!=='function')return reject(Error('Use interactive Windows CMD'));
    const old=Boolean(input.isRaw);let value='',done=false;
    process.stdout.write(label);input.setRawMode(true);input.resume();
    function finish(error){if(done)return;done=true;input.off('data',read);input.setRawMode(old);process.stdout.write('\n');error?reject(error):resolve(value);}
    function read(buf){for(const ch of buf.toString('utf8')){if(ch==='\r'||ch==='\n')return finish();if(ch==='\x03')return finish(Error('Cancelled'));if(ch==='\b'||ch==='\x7f')value=value.slice(0,-1);else if(ch>=' ')value+=ch;}}
    input.on('data',read);
  });
}
async function main(){
  console.log('Coffee Overflow UNIFIED WEBSITE — local synthetic test only; no payments.');
  console.log('Hosts real website pages + protected integration API at 127.0.0.1:5180.');
  const dbPassword=await hiddenPrompt('Restricted integration MySQL password (hidden): ');
  if(!dbPassword)throw Error('Database password required');
  const pool=mysql.createPool({host:HOST,port:3306,user:USER,password:dbPassword,database:DATABASE,connectionLimit:5});
  let adminId=null,adminEmail=null,server=null;
  try{
    await verifyCleanFixture(pool);console.log('PASS: restricted MySQL integration fixture verified');
    const password=await hiddenPrompt('Choose NEW test administrator password (12+ characters, hidden): ');
    if(password.length<12||password.length>128||Buffer.byteLength(password)>256)throw Error('Test admin password must have 12–128 characters');
    const auth=createAuthService(pool);
    adminEmail=`co-admin-${crypto.randomBytes(6).toString('hex')}@example.test`;
    if(!exactAdminEmail(adminEmail))throw Error('Invalid synthetic email');
    const user=await auth.register({first_name:'Integration',last_name:'Unified Admin',email:adminEmail,password,street:'1 Example Road',city:'Test City',state:'TX',zip_code:'78253'});
    adminId=user.id;
    const [role]=await pool.execute("UPDATE auth_credentials SET role='admin' WHERE user_id=? AND role='customer' AND is_active=1",[adminId]);
    if(role.affectedRows!==1)throw Error('Admin provisioning failed');
    const origin=`http://${HOST}:${PORT}`;
    const app=createLocalUnifiedSiteApp({pool,origin});
    server=await new Promise((resolve,reject)=>{const s=app.listen(PORT,HOST,()=>resolve(s));s.once('error',reject);});
    console.log('SUCCESS: Unified local website running!');
    console.log('HOME: '+origin+'/');
    console.log('SIGN IN: '+origin+'/login.html');
    console.log('PRODUCTS: '+origin+'/products.html');
    console.log('CART: '+origin+'/cart.html');
    console.log('ADMIN: '+origin+'/integration/admin/');
    console.log('SYNTHETIC ADMIN EMAIL: '+adminEmail);
    console.log('Save this email and the synthetic customer email for cleanup; never share passwords.');
    const close=()=>server.close(()=>pool.end().then(()=>process.exit(0)));
    process.once('SIGINT',close);process.once('SIGTERM',close);
  }catch(e){
    if(server)await new Promise(resolve=>server.close(resolve));
    if(adminId!==null){
      try{const [del]=await pool.execute('DELETE FROM users WHERE id=? AND email=?',[adminId,adminEmail]);if(del.affectedRows===1)console.log('RECOVERY: admin account removed after launch failure');}
      catch(err){console.error('MANUAL REVIEW: cannot remove synthetic admin:',err.message);}
    }
    await pool.end();throw e;
  }
}
if(require.main===module)main().catch(e=>{console.error('UNIFIED SITE START FAILED:',e.message);process.exitCode=1;});
module.exports={main};
