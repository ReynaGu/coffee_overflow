'use strict';
/** Phase 4A: canonical schema read-only test, exclusively 127.0.0.1:5190. */
const mysql=require('mysql2/promise');
const {hiddenPrompt}=require('../unified/catalogPhase2Db');
const {verifyReadOnlySandbox,TARGET}=require('./teamReadiness');
const {createTeamReadOnlyApp}=require('./teamReadOnlyApp');
const HOST='127.0.0.1',PORT=5190,USER='coffee_overflow_review_reader';
async function main(){
  console.log('Coffee Overflow — migrated-schema READ-ONLY API smoke test. No payments or writes.');
  console.log(`Database: ${TARGET}; server: http://${HOST}:${PORT}; MySQL account: ${USER}@127.0.0.1`);
  const password=await hiddenPrompt('Read-only sandbox MySQL password (hidden): ');
  const pool=mysql.createPool({host:HOST,port:3306,user:USER,password,database:TARGET,waitForConnections:true,connectionLimit:3,queueLimit:0});
  let server=null;
  try{
    const checked=await verifyReadOnlySandbox(pool);
    console.log(`PASS: ${checked.tables} expected tables, ${checked.foreignKeys} foreign keys, no real users or orders.`);
    const app=createTeamReadOnlyApp({pool,origin:`http://${HOST}:${PORT}`});
    server=await new Promise((resolve,reject)=>{const s=app.listen(PORT,HOST,()=>resolve(s));s.once('error',reject);});
    console.log(`SUCCESS: Migrated-schema read-only API running on http://${HOST}:${PORT}`);
    console.log(`HEALTH: http://${HOST}:${PORT}/api/health`);
    console.log(`PRODUCTS: http://${HOST}:${PORT}/api/products`);
    console.log('An empty [] products result is expected until the team agrees on final catalog data.');
    const close=()=>server.close(()=>pool.end().then(()=>process.exit(0)));
    process.once('SIGINT',close);process.once('SIGTERM',close);
  }catch(e){if(server)await new Promise(resolve=>server.close(resolve));await pool.end();throw e;}
}
if(require.main===module)main().catch(e=>{console.error('TEAM READ-ONLY START STOPPED:',e.message);process.exitCode=1;});
module.exports={main};
