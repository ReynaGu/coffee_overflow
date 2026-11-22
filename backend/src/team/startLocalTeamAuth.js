'use strict';
/** Bounded, authenticated migrated-schema HTTP test on loopback port 5191. */
const {validTestAdmin,validTestCustomer,ORIGIN,HOST,PORT}=require('./teamAuthBoundary');
const {ensure,makePool,verifySeeded}=require('./teamAuthFixture');
const {createTeamBoundedAuthenticatedApp}=require('./teamBoundedAuthenticatedApp');
async function main(){
  const {hiddenPrompt}=require('../unified/catalogPhase2Db');
  const adminEmail=String(process.argv[2]||'').trim();
  const customerEmail=String(process.argv[3]||'').trim();
  ensure(validTestAdmin(adminEmail)&&validTestCustomer(customerEmail),'pass the two EXACT synthetic emails printed by seed');
  console.log('PHASE 4B2 LOCAL AUTHENTICATED API TEST — no payment, no live customer information.');
  console.log('MySQL schema: coffee_overflow_migration_review; API:',ORIGIN);
  const dbPassword=await hiddenPrompt('Restricted writer MySQL password (hidden): ');
  const pool=makePool(dbPassword);
  let server;
  try{
    const conn=await pool.getConnection();
    try{await verifySeeded(conn,adminEmail,customerEmail);}finally{conn.release();}
    const app=createTeamBoundedAuthenticatedApp({pool,customerEmail});
    server=await new Promise((resolve,reject)=>{
      const s=app.listen(PORT,HOST,()=>resolve(s));s.once('error',reject);
    });
    console.log('SUCCESS: Phase 4B2 localhost authenticated API running at '+ORIGIN);
    console.log('HEALTH:',ORIGIN+'/api/health');
    console.log('PRODUCTS:',ORIGIN+'/api/products');
    console.log('Only the designated test customer may register; at most one product #601 checkout.');
    console.log('Stop with Ctrl+C BEFORE running exact cleanup. Keep both synthetic emails.');
    const close=()=>server.close(()=>pool.end().then(()=>process.exit(0)));
    process.once('SIGINT',close);process.once('SIGTERM',close);
  }catch(e){if(server)await new Promise(r=>server.close(r));await pool.end();throw e;}
}
if(require.main===module)main().catch(e=>{console.error('PHASE 4B AUTH API START STOPPED:',e.message);process.exitCode=1;});
module.exports={main};
