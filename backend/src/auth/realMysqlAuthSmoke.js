'use strict';
/**
 * Isolated Coffee Overflow auth-service smoke test. Creates one synthetic
 * customer and session, then deletes only that customer (cascade cleanup).
 * Run from repository root: node backend/src/auth/realMysqlAuthSmoke.js
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');
const {createAuthService} = require('./authService');
const DATABASE = 'coffee_overflow_integration';
const USER = 'coffee_overflow_integration_app';
function hiddenPrompt(message) {
  return new Promise((resolve,reject)=>{
    const input=process.stdin;
    if (!input.isTTY || typeof input.setRawMode !== 'function') return reject(Error('Run in an interactive Windows CMD or PowerShell terminal'));
    let password=''; const wasRaw=Boolean(input.isRaw);
    process.stdout.write(message);
    input.setRawMode(true);input.resume();
    const finish=(err)=>{input.off('data',onData);input.setRawMode(wasRaw);process.stdout.write('\n');err?reject(err):resolve(password);};
    function onData(chunk){for(const ch of chunk.toString('utf8')){
      if(ch==='\r'||ch==='\n') return finish();
      if(ch==='\u0003') return finish(Error('Cancelled'));
      if(ch==='\b'||ch==='\u007f')password=password.slice(0,-1);
      else if(ch>=' ')password+=ch;
    }}
    input.on('data',onData);
  });
}
async function snapshot(pool) {
  const [[row]] = await pool.query(`SELECT
    (SELECT COUNT(*) FROM users) AS users,
    (SELECT COUNT(*) FROM auth_credentials) AS credentials,
    (SELECT COUNT(*) FROM auth_sessions) AS sessions`);
  return {users:Number(row.users),credentials:Number(row.credentials),sessions:Number(row.sessions)};
}
async function cleanup(pool,id,email) {
  if (!Number.isSafeInteger(id)||id<=0) return;
  const conn=await pool.getConnection();
  try{
    await conn.beginTransaction();
    const [found]=await conn.execute('SELECT id,email FROM users WHERE id=? FOR UPDATE',[id]);
    if(found.length!==1 || found[0].email!==email) throw Error('Refusing cleanup: synthetic user identity mismatch');
    const [result]=await conn.execute('DELETE FROM users WHERE id=? AND email=?',[id,email]);
    assert.equal(result.affectedRows,1,'Expected one synthetic user removed');
    await conn.commit();
  }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
}
async function main(){
  console.log('Coffee Overflow — REAL MySQL auth smoke test (isolated integration database only)');
  console.log('No website routes, .env changes, real shopper data, payments, or admin accounts.');
  const password=await hiddenPrompt('Integration database password (hidden): ');
  if(!password)throw Error('No database password entered');
  const pool=mysql.createPool({host:'127.0.0.1',port:3306,user:USER,password,database:DATABASE,
    connectionLimit:2,waitForConnections:true});
  let id=null, email=null;
  try{
    const [[who]]=await pool.query('SELECT CURRENT_USER() AS account, DATABASE() AS schema_name');
    assert.equal(who.schema_name,DATABASE,'Refusing wrong database');
    assert.equal(who.account.split('@')[0],USER,'Refusing wrong database account');
    const [[column]]=await pool.query(`SELECT EXTRA AS extra FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA='coffee_overflow_integration' AND TABLE_NAME='users' AND COLUMN_NAME='id'`);
    assert.ok(column && column.extra.includes('auto_increment'),'users.id AUTO_INCREMENT is missing');
    const [[unique]]=await pool.query(`SELECT COUNT(*) AS n FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA='coffee_overflow_integration' AND TABLE_NAME='users' AND COLUMN_NAME='email' AND NON_UNIQUE=0`);
    assert.ok(Number(unique.n)>=1,'users.email unique index is missing');
    const before=await snapshot(pool);
    console.log('PASS: Restricted account, isolated database, registration prerequisites');

    const auth=createAuthService(pool);
    const suffix=crypto.randomBytes(5).toString('hex');
    email=`co-auth-fixture-${suffix}@example.test`;
    const syntheticPassword=`TestPassword!${crypto.randomBytes(20).toString('base64url')}`;
    const user=await auth.register({first_name:'Integration',last_name:'Fixture',email,
      password:syntheticPassword,street:'1 Example Road',city:'Test City',state:'TX',zip_code:'78253'});
    id=user.id;
    assert.equal(user.role,'customer');
    const [[stored]]=await pool.execute(`SELECT u.password,c.password_hash,c.role FROM users u
      JOIN auth_credentials c ON c.user_id=u.id WHERE u.id=?`,[id]);
    assert.equal(stored.password,'!auth_credentials_only!');
    assert.notEqual(stored.password_hash,syntheticPassword);
    assert.equal(stored.role,'customer');
    console.log('PASS: Customer created, password hash stored separately, no self-assigned admin role');

    await assert.rejects(auth.login(email,'WrongPassword01234!'),e=>e.status===401);
    const login=await auth.login(email,syntheticPassword);
    assert.equal(login.user.id,id);
    const without=await auth.resolveVerifiedSession({headers:{cookie:`co_session=${login.sessionToken}`}});
    assert.equal(without.csrfVerified,false);
    const withHeader=await auth.resolveVerifiedSession({headers:{cookie:`co_session=${login.sessionToken}`,
      'x-coffee-csrf':login.csrfToken}});
    assert.equal(withHeader.csrfVerified,true);
    assert.equal(withHeader.role,'customer');
    console.log('PASS: Wrong password rejected; login, hashed session lookup and CSRF check succeeded');

    assert.equal(await auth.logout(login.sessionToken),true);
    assert.equal(await auth.resolveVerifiedSession({headers:{cookie:`co_session=${login.sessionToken}`}}),null);
    console.log('PASS: Logout revoked the database session');
    await cleanup(pool,id,email);
    id=null;
    const after=await snapshot(pool);
    assert.deepEqual(after,before,'Unexpected leftover auth fixture records');
    console.log('SUCCESS: Real MySQL authentication smoke test passed; fixture fully cleaned up.');
  }finally{
    if(id!==null){
      try{await cleanup(pool,id,email);console.log('Cleanup recovered synthetic user');}
      catch(e){console.error(`MANUAL CLEANUP NEEDED for synthetic user ID ${id}: ${e.message}`);}
    }
    await pool.end();
  }
}
main().catch(e=>{console.error('AUTH SMOKE FAILED:',e.message);process.exitCode=1;});
