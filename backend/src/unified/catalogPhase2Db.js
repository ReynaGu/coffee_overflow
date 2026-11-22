'use strict';
/** The ONLY database accepted by the optional local Phase 2 catalog tools. */
const mysql=require('mysql2/promise');
const {ITEMS,SALE_ID,SELECT_CATALOG,validateCatalog,assert}=require('./catalogPhase2Data');
const HOST='127.0.0.1',PORT=5181,DATABASE='coffee_overflow_integration',USER='coffee_overflow_integration_app';
function hiddenPrompt(label){
  return new Promise((resolve,reject)=>{
    const input=process.stdin;
    if(!input.isTTY||typeof input.setRawMode!=='function')return reject(Error('Use interactive Windows CMD'));
    const old=Boolean(input.isRaw);let value='',done=false;
    process.stdout.write(label);input.setRawMode(true);input.resume();
    function finish(e){if(done)return;done=true;input.off('data',read);input.setRawMode(old);process.stdout.write('\n');e?reject(e):resolve(value);}
    function read(buf){for(const ch of buf.toString('utf8')){if(ch==='\r'||ch==='\n')return finish();if(ch==='\x03')return finish(Error('Cancelled'));if(ch==='\b'||ch==='\x7f')value=value.slice(0,-1);else if(ch>=' ')value+=ch;}}
    input.on('data',read);
  });
}
function makePool(password){assert(typeof password==='string' && password.length>0,'integration MySQL password required');
  return mysql.createPool({host:HOST,port:3306,user:USER,password,database:DATABASE,connectionLimit:4});
}
async function verifyDb(conn){
  const [[who]]=await conn.query('SELECT CURRENT_USER() AS account,DATABASE() AS db');
  assert(who.db===DATABASE && who.account.split('@')[0]===USER,'incorrect MySQL database or user');
}
async function verifyBaseProduct(conn){
  const [rows]=await conn.query('SELECT product_id,name,price,stock_quantity FROM products ORDER BY product_id FOR UPDATE');
  assert(rows.length===1 && Number(rows[0].product_id)===1 && rows[0].name==='Checkout Integration Test Coffee' && Number(rows[0].price)===18 && Number(rows[0].stock_quantity)===10,'expected only the original product #1 at stock 10');
}
async function verifyBaseWithCatalog(conn,options={}){
  const [original]=await conn.execute('SELECT product_id,name,price,stock_quantity FROM products WHERE product_id=?',[1]);
  assert(original.length===1 && original[0].name==='Checkout Integration Test Coffee' && Number(original[0].price)===18 && Number(original[0].stock_quantity)===10,'original test product was modified');
  const [[num]]=await conn.query('SELECT COUNT(*) AS n FROM products');
  assert(Number(num.n)===ITEMS.length+1,'unexpected extra or missing products');
  const [rows]=await conn.query(SELECT_CATALOG);
  validateCatalog(rows,options);
  const [s]=await conn.query('SELECT sale_id,sale_name FROM sales');
  assert(s.length===1 && Number(s[0].sale_id)===SALE_ID && Number(s[0].sale_name)===SALE_ID,'unexpected sales rows');
  const [saleLines]=await conn.query('SELECT sale_id,product_id,sale_price FROM sale_items');
  assert(saleLines.length===1 && Number(saleLines[0].sale_id)===SALE_ID && Number(saleLines[0].product_id)===101 && Number(saleLines[0].sale_price)===14,'unexpected sale_items rows');
  return rows;
}
async function counts(conn){
  const [[c]]=await conn.query(`SELECT
  (SELECT COUNT(*) FROM orders) AS orders,
  (SELECT COUNT(*) FROM order_items) AS items,
  (SELECT COUNT(*) FROM order_events) AS events,
  (SELECT COUNT(*) FROM checkout_requests) AS requests,
  (SELECT COUNT(*) FROM auth_credentials) AS credentials,
  (SELECT COUNT(*) FROM auth_sessions) AS sessions`);
  return c;
}
function expectNoActivity(c){for(const [key,value] of Object.entries(c))assert(Number(value)===0,`expected zero ${key}, found ${value}`);}
module.exports={HOST,PORT,DATABASE,USER,hiddenPrompt,makePool,verifyDb,verifyBaseProduct,verifyBaseWithCatalog,counts,expectNoActivity};
