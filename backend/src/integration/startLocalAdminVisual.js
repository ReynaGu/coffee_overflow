'use strict';
/** Starts a local-only shared MySQL visual admin demo with ONE deliberately
 * provisioned synthetic admin. Never modifies server.js, .env, or other DBs.
 * Cleanup must be run explicitly; do not use for real accounts or public access.
 */
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');
const {createAuthService} = require('../auth/authService');
const {createLocalAdminVisualApp} = require('./localAdminVisualApp');
const {exactAdminEmail} = require('./adminVisualRules');
const HOST='127.0.0.1', PORT=5178, DATABASE='coffee_overflow_integration';
const USER='coffee_overflow_integration_app';
function hiddenPrompt(label) {
  return new Promise((resolve,reject)=>{
    const input=process.stdin;
    if(!input.isTTY||typeof input.setRawMode!=='function')return reject(Error('Use interactive Windows CMD or PowerShell'));
    const prev=Boolean(input.isRaw);let value='',finished=false;
    process.stdout.write(label);input.setRawMode(true);input.resume();
    function finish(err){if(finished)return;finished=true;input.off('data',onData);input.setRawMode(prev);process.stdout.write('\n');err?reject(err):resolve(value);}
    function onData(buf){for(const ch of buf.toString('utf8')){
      if(ch==='\r'||ch==='\n')return finish();if(ch==='\x03')return finish(Error('Cancelled'));
      if(ch==='\b'||ch==='\x7f')value=value.slice(0,-1);else if(ch>=' ')value+=ch;
    }}
    input.on('data',onData);
  });
}
async function verifyCleanFixture(pool) {
  const [[who]]=await pool.query('SELECT CURRENT_USER() AS account,DATABASE() AS db');
  if(who.db!==DATABASE||who.account.split('@')[0]!==USER)throw Error('Wrong schema or MySQL user');
  const [products]=await pool.execute('SELECT name,price,stock_quantity FROM products WHERE product_id=1');
  if(products.length!==1||products[0].name!=='Checkout Integration Test Coffee'||Number(products[0].price)!==18||Number(products[0].stock_quantity)!==10)throw Error('Fixture product differs from expected stock 10 / price $18.00');
  const [[s]]=await pool.query(`SELECT
    (SELECT COUNT(*) FROM orders) AS orders,
    (SELECT COUNT(*) FROM order_items) AS items,
    (SELECT COUNT(*) FROM order_events) AS events,
    (SELECT COUNT(*) FROM checkout_requests) AS requests,
    (SELECT COUNT(*) FROM auth_credentials) AS credentials,
    (SELECT COUNT(*) FROM auth_sessions) AS sessions`);
  for(const [key,v] of Object.entries(s))if(Number(v)!==0)throw Error(`Unexpected ${key} rows (${v}); clean previous fixtures before continuing`);
}
async function main(){
  console.log('Coffee Overflow — local PROTECTED visual order management (TEST ONLY)');
  console.log('Uses only coffee_overflow_integration on 127.0.0.1:5178; no payments or public deployment.');
  const dbPassword=await hiddenPrompt('Restricted integration MySQL password (hidden): ');
  if(!dbPassword)throw Error('Database password required');
  const pool=mysql.createPool({host:HOST,port:3306,user:USER,password:dbPassword,database:DATABASE,connectionLimit:5});
  let adminId=null, email=null, server=null;
  try{
    await verifyCleanFixture(pool);
    console.log('PASS: Restricted schema and clean test fixture (stock 10, no orders or sessions)');
    const testPassword=await hiddenPrompt('Choose TEST administrator password (12+ characters, hidden): ');
    if(testPassword.length<12||testPassword.length>128||Buffer.byteLength(testPassword)>256)throw Error('Test password must be 12–128 characters (at most 256 UTF-8 bytes)');
    const auth=createAuthService(pool);
    email=`co-admin-${crypto.randomBytes(6).toString('hex')}@example.test`;
    if(!exactAdminEmail(email))throw Error('Invalid synthetic admin email');
    const user=await auth.register({first_name:'Integration',last_name:'Visual Admin',email,password:testPassword,
      street:'1 Example Road',city:'Test City',state:'TX',zip_code:'78253'});
    adminId=user.id;
    const [changed]=await pool.execute("UPDATE auth_credentials SET role='admin' WHERE user_id=? AND role='customer' AND is_active=1",[adminId]);
    if(changed.affectedRows!==1)throw Error('Failed to provision synthetic administrator');
    const origin=`http://${HOST}:${PORT}`;
    const app=createLocalAdminVisualApp({pool,origin});
    server=await new Promise((resolve,reject)=>{const s=app.listen(PORT,HOST,()=>resolve(s));s.once('error',reject);});
    console.log('SUCCESS: Local admin visual demo running.');
    console.log(`ADMIN PAGE: ${origin}/integration/admin/`);
    console.log(`SHOPPER PAGE: ${origin}/integration/`);
    console.log(`SYNTHETIC ADMIN EMAIL: ${email}`);
    console.log('ADMIN PASSWORD: the test password you entered (not printed)');
    console.log('After testing, run cleanupLocalAdminVisual.js with this admin email and the synthetic customer email.');
    const close=()=>server.close(()=>pool.end().then(()=>process.exit(0)));
    process.once('SIGINT',close);process.once('SIGTERM',close);
  }catch(e){
    if(server)await new Promise(resolve=>server.close(()=>resolve()));
    if(adminId!==null&&email){
      try{
        const [del]=await pool.execute('DELETE FROM users WHERE id=? AND email=?',[adminId,email]);
        if(del.affectedRows===1)console.log('RECOVERY: Synthetic admin account removed after startup failure.');
        else console.error('MANUAL REVIEW: Synthetic admin was not removed:',email);
      }catch(err){console.error('MANUAL REVIEW: Failed to remove synthetic admin:',email,err.message);}
    }
    await pool.end();
    throw e;
  }
}
if(require.main===module)main().catch(e=>{console.error('ADMIN VISUAL START FAILED:',e.message);process.exitCode=1;});
module.exports={verifyCleanFixture};
