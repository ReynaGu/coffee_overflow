'use strict';
/** Phase 4B2: strict, disposable MySQL fixture for local authenticated HTTP smoke.
 * No schema DDL, global privileges, production accounts or payment activity.
 */
const {toCents} = require('../checkout/pricing');
const {TARGET,TABLES,NEED_COLUMNS,verifyTableNames,verifyColumns} = require('./teamReadiness');
const {validTestAdmin,validTestCustomer,FIXTURE_PRODUCT_ID} = require('./teamAuthBoundary');
const HOST='127.0.0.1', USER='coffee_overflow_review_writer';
const PRODUCT=Object.freeze({id:FIXTURE_PRODUCT_ID,name:'Phase 4B Authentication Test Coffee',priceCents:1800,stock:1,
  description:'Synthetic product for local authenticated checkout verification only'});
const ALL_EMPTY=Object.freeze(['auth_credentials','auth_sessions','cart_items','carts','checkout_requests',
  'discounts','order_events','order_items','orders','products','sale_items','sales']);
const FKS=Object.freeze([
  'auth_credentials.user_id>users.id',
  'auth_sessions.user_id>auth_credentials.user_id',
  'checkout_requests.order_id>orders.order_id',
  'order_events.order_id>orders.order_id',
].sort());
function ensure(ok,reason){if(!ok)throw Error('PHASE 4B REFUSED: '+reason);}
function makePool(password){const mysql=require('mysql2/promise');ensure(typeof password==='string'&&password.length>0,'writer password required');
  return mysql.createPool({host:HOST,port:3306,user:USER,password,database:TARGET,connectionLimit:3,waitForConnections:true});}
function assertAccounts(rows,adminEmail=null,customerEmail=null){
  ensure(Array.isArray(rows),'missing account rows');
  const allowed=[{id:0,email:''}];
  if(adminEmail)allowed.push({email:adminEmail});
  if(customerEmail)allowed.push({email:customerEmail});
  ensure(rows.length===allowed.length,'unexpected number of users');
  ensure(rows.some(r=>Number(r.id)===0&&r.email===''),'original placeholder user #0 missing');
  const ids=new Map();
  for(const r of rows){
    const match=allowed.find(e=>e.email===r.email);
    ensure(match && !ids.has(r.email),'unknown/duplicate customer or administrator');
    if(r.email)ensure(Number.isSafeInteger(Number(r.id))&&Number(r.id)>0,'invalid synthetic user ID');
    ids.set(r.email,Number(r.id));
  }
  return ids;
}
function assertWriterGrants(grants){
  ensure(Array.isArray(grants)&&grants.length>=1,'missing MySQL grants');
  let sawCrud=false;
  for(const row of grants){
    const value=String(Object.values(row)[0]||'');
    ensure(!/WITH GRANT OPTION|GRANT PROXY|GRANT `|GRANT '/i.test(value),'unapproved grant option or role');
    const match=/^GRANT (.+?) ON (.+?) TO /i.exec(value);
    ensure(Boolean(match),'unrecognized grant statement');
    const privileges=match[1].split(/\s*,\s*/).map(s=>s.trim().toUpperCase()).sort();
    const scope=match[2].trim();
    if(scope==='*.*'){ensure(privileges.length===1&&privileges[0]==='USAGE','unexpected global privilege');continue;}
    // In MySQL database grants, unescaped _ is a wildcard (unless partial_revokes is ON).
    // Only accept the explicit escaped schema printed by SHOW GRANTS; rejecting
    // the unescaped version prevents privileges from spilling into other schemas.
    const escapedSchema=TARGET.replace(/_/g,'\\_');
    ensure(scope===`\`${escapedSchema}\`.*`,'grant applies outside disposable schema');
    ensure(privileges.join(',')==='DELETE,INSERT,SELECT,UPDATE','writer must have only SELECT INSERT UPDATE DELETE');
    ensure(!sawCrud,'duplicate schema privilege grant');sawCrud=true;
  }
  ensure(sawCrud,'missing schema-scoped writer permissions');
  return true;
}
async function verifySchema(conn){
  const [[who]]=await conn.query('SELECT DATABASE() AS db, CURRENT_USER() AS account');
  ensure(who?.db===TARGET,'wrong MySQL schema');
  ensure(who?.account===`${USER}@${HOST}`,'wrong MySQL account');
  const [grantRows]=await conn.query('SHOW GRANTS');assertWriterGrants(grantRows);
  const [tables]=await conn.execute('SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=? AND TABLE_TYPE=? ORDER BY TABLE_NAME',[TARGET,'BASE TABLE']);
  verifyTableNames(tables);
  const [columns]=await conn.execute('SELECT TABLE_NAME,COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=?',[TARGET]);
  verifyColumns(columns);
  const [fkRows]=await conn.execute(`SELECT TABLE_NAME,COLUMN_NAME,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME
    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=? AND REFERENCED_TABLE_NAME IS NOT NULL`,[TARGET]);
  const fkKeys=fkRows.map(r=>`${r.TABLE_NAME}.${r.COLUMN_NAME}>${r.REFERENCED_TABLE_NAME}.${r.REFERENCED_COLUMN_NAME}`).sort();
  ensure(JSON.stringify(fkKeys)===JSON.stringify(FKS),'expected four exact foreign keys');
  const [auto]=await conn.execute(`SELECT TABLE_NAME,COLUMN_NAME,EXTRA FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=? AND ((TABLE_NAME='users' AND COLUMN_NAME='id') OR
     (TABLE_NAME='orders' AND COLUMN_NAME='order_id') OR
     (TABLE_NAME='products' AND COLUMN_NAME='product_id'))`,[TARGET]);
  ensure(auto.length===3&&auto.every(r=>String(r.EXTRA).includes('auto_increment')),'required primary IDs must auto-increment');
  const [emails]=await conn.execute(`SELECT INDEX_NAME,NON_UNIQUE FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA=? AND TABLE_NAME='users' AND COLUMN_NAME='email'`,[TARGET]);
  ensure(emails.some(r=>Number(r.NON_UNIQUE)===0),'unique users.email index missing');
  return true;
}
async function counts(conn){const query='SELECT '+ALL_EMPTY.map(t=>`(SELECT COUNT(*) FROM \`${t}\`) AS \`${t}\``).join(',');
  return (await conn.query(query))[0][0];}
function assertCountsExactly(c,overrides={}){
  for(const name of ALL_EMPTY)ensure(Number(c[name])===(overrides[name]??0),`unexpected ${name} count`);
}
async function verifyBase(conn){
  await verifySchema(conn);
  const [accounts]=await conn.query('SELECT id,email FROM users ORDER BY id FOR UPDATE');
  assertAccounts(accounts);
  assertCountsExactly(await counts(conn));
  return true;
}
async function verifySeeded(conn,adminEmail,customerEmail){
  ensure(validTestAdmin(adminEmail)&&validTestCustomer(customerEmail),'incorrect synthetic account names');
  await verifySchema(conn);
  const [users]=await conn.query('SELECT id,email FROM users ORDER BY id');
  const ids=assertAccounts(users,adminEmail);
  const [cred]=await conn.query('SELECT user_id,role,is_active FROM auth_credentials');
  ensure(cred.length===1&&Number(cred[0].user_id)===ids.get(adminEmail)&&cred[0].role==='admin'&&Number(cred[0].is_active)===1,'missing exact administrator credentials');
  const [products]=await conn.query('SELECT product_id,name,price,stock_quantity,description FROM products');
  ensure(products.length===1&&Number(products[0].product_id)===PRODUCT.id&&products[0].name===PRODUCT.name&&
    toCents(products[0].price)===PRODUCT.priceCents&&Number(products[0].stock_quantity)===PRODUCT.stock&&
    products[0].description===PRODUCT.description,'unexpected synthetic test product');
  assertCountsExactly(await counts(conn),{auth_credentials:1,products:1});
  return {adminId:ids.get(adminEmail)};
}
function assertOrdersForCleanup({users,credentials,sessions,products,orders,items,claims,events,adminEmail,customerEmail}){
  ensure(validTestAdmin(adminEmail),'invalid administrator email');
  ensure(customerEmail===null||validTestCustomer(customerEmail),'invalid customer email');
  const ids=assertAccounts(users,adminEmail,customerEmail);
  const aid=ids.get(adminEmail),cid=ids.get(customerEmail);
  const expectedCreds=customerEmail?2:1;
  ensure(credentials.length===expectedCreds,'unexpected credential count');
  for(const c of credentials){
    const id=Number(c.user_id);
    ensure(Number(c.is_active)===1,'inactive or unexpected credentials');
    if(id===aid)ensure(c.role==='admin','admin role changed');
    else if(id===cid)ensure(c.role==='customer','customer role changed');
    else ensure(false,'unknown credential owner');
  }
  ensure(sessions.every(s=>[aid,cid].includes(Number(s.user_id))),'unknown session owner');
  ensure(products.length===1,'unexpected number of products');
  const p=products[0];
  ensure(Number(p.product_id)===PRODUCT.id&&p.name===PRODUCT.name&&
    toCents(p.price)===PRODUCT.priceCents&&p.description===PRODUCT.description,'test product differs from seed');
  ensure(orders.length<=1,'too many orders');
  if(orders.length===0){
    ensure(items.length===0&&claims.length===0&&events.length===0,'orphan checkout records');
    ensure(Number(p.stock_quantity)===PRODUCT.stock,'test product stock mismatch');
    return {ids,orderId:null,status:null};
  }
  ensure(customerEmail!==null,'order exists but no customer was supplied');
  const o=orders[0],oid=Number(o.order_id),status=o.status;
  ensure(Number.isSafeInteger(oid)&&oid>0&&Number(o.user_id)===cid,'wrong order owner');
  ensure(['placed','processing','fulfilled','cancelled'].includes(status),'unrecognized order status');
  ensure(toCents(o.subtotal)===1800&&toCents(o.tax)===149&&toCents(o.total)===1949,'wrong order totals');
  ensure(items.length===1&&Number(items[0].order_id)===oid&&Number(items[0].product_id)===PRODUCT.id&&
    Number(items[0].quantity)===1&&toCents(items[0].unit_price)===1800,'wrong order item');
  ensure(claims.length===1&&Number(claims[0].order_id)===oid&&Number(claims[0].user_id)===cid,'wrong checkout request owner');
  let receipt=claims[0].receipt_json;
  if(typeof receipt==='string'){try{receipt=JSON.parse(receipt);}catch{ensure(false,'invalid saved checkout receipt');}}
  ensure(receipt&&Number(receipt.order_id)===oid&&receipt.total_cents===1949&&receipt.subtotal_cents===1800&&
    receipt.tax_cents===149&&Array.isArray(receipt.items)&&receipt.items.length===1&&
    Number(receipt.items[0].product_id)===PRODUCT.id&&Number(receipt.items[0].quantity)===1&&
    receipt.items[0].unit_price_cents===1800,'checkout receipt mismatch');
  const seq=events.map(e=>e.to_status);
  const valid=status==='placed'&&seq.length===0 || status==='processing'&&seq.join(',')==='processing' ||
    status==='fulfilled'&&seq.join(',')==='processing,fulfilled' ||
    status==='cancelled'&&(seq.join(',')==='cancelled'||seq.join(',')==='processing,cancelled');
  ensure(valid,'incorrect order event sequence');
  ensure(events.every(e=>Number(e.order_id)===oid&&Number(e.actor_user_id)===aid),'unexpected event actor');
  ensure(Number(p.stock_quantity)===(status==='cancelled'?1:0),'inventory does not match order status');
  return {ids,orderId:oid,status};
}
module.exports={HOST,USER,TARGET,PRODUCT,ALL_EMPTY,FKS,makePool,ensure,assertAccounts,assertCountsExactly,
  assertWriterGrants,verifySchema,verifyBase,verifySeeded,counts,assertOrdersForCleanup};
