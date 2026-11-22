'use strict';
/** Interactive, fail-closed startup for the local integrated Express preview. */
const mysql = require('mysql2/promise');
const {createLocalIntegratedApp}=require('./localIntegratedApp');
const HOST='127.0.0.1', PORT=5177;
const USER='coffee_overflow_integration_app', DATABASE='coffee_overflow_integration';
function hiddenPrompt(message) {
  return new Promise((resolve,reject)=>{
    if(!process.stdin.isTTY || typeof process.stdin.setRawMode!=='function')return reject(Error('Use Windows CMD or PowerShell interactively'));
    let s='';const before=Boolean(process.stdin.isRaw);
    process.stdout.write(message);process.stdin.setRawMode(true);process.stdin.resume();
    const done=err=>{process.stdin.off('data',take);process.stdin.setRawMode(before);process.stdout.write('\n');err?reject(err):resolve(s);};
    function take(chunk){for(const ch of chunk.toString('utf8')){if(ch==='\r'||ch==='\n')return done();if(ch==='\x03')return done(Error('Cancelled'));if(ch==='\b'||ch==='\x7f')s=s.slice(0,-1);else if(ch>=' ')s+=ch;}}
    process.stdin.on('data',take);
  });
}
async function verify(pool) {
  const [[identity]]=await pool.query('SELECT CURRENT_USER() AS account, DATABASE() AS db');
  if(identity.db!==DATABASE || identity.account.split('@')[0]!==USER)throw Error('Incorrect MySQL account/schema. Refusing to start.');
  const [[product]]=await pool.execute('SELECT name,price FROM products WHERE product_id=?',[1]);
  if(!product||product.name!=='Checkout Integration Test Coffee'||Math.abs(Number(product.price)-18)>0.001)throw Error('Unexpected fixture product; refusing to start');
  const [[row]]=await pool.query(`SELECT
    (SELECT stock_quantity FROM products WHERE product_id=1) AS stock,
    (SELECT COUNT(*) FROM orders) AS orders,
    (SELECT COUNT(*) FROM checkout_requests) AS requests,
    (SELECT COUNT(*) FROM auth_credentials) AS credentials,
    (SELECT COUNT(*) FROM auth_sessions) AS sessions`);
  if(Number(row.stock)!==10 || ['orders','requests','credentials','sessions'].some(x=>Number(row[x])!==0)){
    throw Error('Expected clean integration fixture (stock 10, no orders, requests, credentials or sessions). Inspect test data; do not delete unrelated data.');
  }
}
async function main(){
  console.log('Coffee Overflow - LOCAL authenticated storefront integration (TEST ONLY)');
  console.log('Isolated MySQL database; one test product; no payment; existing server.js/.env untouched.');
  const password=await hiddenPrompt('Password for restricted integration account (hidden): ');
  if(!password)throw Error('Password required');
  const pool=mysql.createPool({host:HOST,port:3306,user:USER,password,database:DATABASE,waitForConnections:true,connectionLimit:5});
  try {
    await verify(pool);
    const app=createLocalIntegratedApp({pool,origin:`http://${HOST}:${PORT}`});
    const server=await new Promise((resolve,reject)=>{
      const s=app.listen(PORT,HOST,()=>resolve(s));s.once('error',reject);
    });
    console.log(`SUCCESS: Integration shop http://${HOST}:${PORT}/integration/`);
    console.log('Only use an @example.test fixture address. A successful order is intentionally left in the test database for review.');
    const shutdown=()=>{server.close(()=>pool.end().then(()=>process.exit(0)));};
    process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
  }catch(e){await pool.end();throw e;}
}
main().catch(e=>{console.error('LOCAL INTEGRATION START FAILED:',e.message);process.exitCode=1;});
