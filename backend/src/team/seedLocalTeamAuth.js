'use strict';
/** One-time transactional seed; refuses if sandbox differs from original migrated baseline. */
const crypto=require('node:crypto');
const {hashPassword}=require('../auth/authService');
const {makePool,verifyBase,PRODUCT}=require('./teamAuthFixture');
async function seed(pool,password){
  // Hash before opening the transaction; no password is ever persisted in users.password.
  const encoded=await hashPassword(password);
  const adminEmail=`co-admin-${crypto.randomBytes(6).toString('hex')}@example.test`;
  const customerEmail=`co-browser-${crypto.randomBytes(6).toString('hex')}@example.test`;
  const conn=await pool.getConnection();
  try{
    await conn.beginTransaction();await verifyBase(conn);
    const [p]=await conn.execute('INSERT INTO products (product_id,name,price,stock_quantity,description) VALUES (?,?,?,?,?)',
      [PRODUCT.id,PRODUCT.name,'18.00',PRODUCT.stock,PRODUCT.description]);
    if(p.affectedRows!==1)throw Error('Could not create exact test product');
    const [u]=await conn.execute(`INSERT INTO users
      (first_name,last_name,password,email,street,city,state,zip_code) VALUES (?,?,?,?,?,?,?,?)`,
      ['Integration','Administrator','!auth_credentials_only!',adminEmail,'1 Example Road','Test City','TX',78253]);
    const id=Number(u.insertId);if(!Number.isSafeInteger(id)||id<=0)throw Error('Administrator ID missing');
    const [c]=await conn.execute(`INSERT INTO auth_credentials (user_id,password_hash,role,is_active)
      VALUES (?,?,'admin',1)`,[id,encoded]);
    if(c.affectedRows!==1)throw Error('Could not provision exact administrator');
    await conn.commit();return {adminEmail,customerEmail,adminId:id};
  }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
}
async function main(){
  const {hiddenPrompt}=require('../unified/catalogPhase2Db');
  console.log('PHASE 4B2 LOCAL SEED ONLY — migrated disposable sandbox; product #601; no payments.');
  console.log('Requires restricted writer SELECT/INSERT/UPDATE/DELETE on coffee_overflow_migration_review only.');
  const dbPassword=await hiddenPrompt('Restricted writer MySQL password (hidden): ');
  const adminPassword=await hiddenPrompt('Choose NEW synthetic admin password (12+ chars, hidden): ');
  const pool=makePool(dbPassword);
  try{const result=await seed(pool,adminPassword);
    console.log('SUCCESS: One synthetic admin and product #601 staged; original placeholder #0 preserved.');
    console.log('EXACT ADMIN EMAIL:',result.adminEmail);
    console.log('EXACT FUTURE CUSTOMER EMAIL:',result.customerEmail);
    console.log('Save BOTH emails for the startup script and cleanup. Never share passwords.');
    console.log('NEXT: Start the authenticated API only after running the fixture tests.');
  }finally{await pool.end();}
}
if(require.main===module)main().catch(e=>{console.error('TEAM AUTH SEED STOPPED:',e.message);process.exitCode=1;});
module.exports={seed};
