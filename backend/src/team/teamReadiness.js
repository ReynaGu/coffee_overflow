'use strict';
/** Strict read-only structural checks. Never makes a database schema change. */
const TARGET='coffee_overflow_migration_review';
const TABLES=Object.freeze(['auth_credentials','auth_sessions','cart_items','carts','checkout_requests','discounts','order_events','order_items','orders','products','sale_items','sales','users']);
const NEED_COLUMNS=Object.freeze({
  users:['id','email','password'],products:['product_id','name','price','stock_quantity','description'],
  orders:['order_id','user_id','subtotal','tax','total','status'],
  auth_credentials:['user_id','password_hash','role'],
  auth_sessions:['token_hash','csrf_token_hash','user_id'],
  checkout_requests:['client_token','request_hash','receipt_json','order_id'],
  order_events:['id','order_id','to_status','note']
});
const FK_TABLES=Object.freeze(['auth_credentials','auth_sessions','checkout_requests','order_events']);
function assertOrigin(origin){
  if(typeof origin!=='string'||!/^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(origin))throw Error('Must use an explicit 127.0.0.1 HTTP origin');
  const p=Number(new URL(origin).port);if(!Number.isSafeInteger(p)||p<1024||p>65535)throw Error('Invalid local preview port');
  return true;
}
function verifyTableNames(rows){
  const names=rows.map(r=>r.TABLE_NAME).sort();
  if(names.length!==TABLES.length||TABLES.some((x,i)=>x!==names[i]))throw Error('Unexpected sandbox table set; refuse to start');
  return true;
}
function verifyColumns(rows){
  const found=new Map();for(const row of rows){if(!found.has(row.TABLE_NAME))found.set(row.TABLE_NAME,new Set());found.get(row.TABLE_NAME).add(row.COLUMN_NAME);}
  for(const [table,cols] of Object.entries(NEED_COLUMNS))for(const col of cols)if(!found.get(table)?.has(col))throw Error(`Missing required database column ${table}.${col}`);
  return true;
}
function verifyForeignKeys(rows){
  const actual=new Set(rows.map(r=>r.TABLE_NAME));
  for(const table of FK_TABLES)if(!actual.has(table))throw Error('Missing expected foreign-key relationship on '+table);
  return true;
}
async function verifyReadOnlySandbox(pool){
  if(!pool||typeof pool.execute!=='function')throw Error('MySQL connection required');
  const [[db]]=await pool.execute('SELECT DATABASE() AS name');
  if(db?.name!==TARGET)throw Error('Wrong database; required '+TARGET);
  const [tables]=await pool.execute('SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=? AND TABLE_TYPE=? ORDER BY TABLE_NAME',[TARGET,'BASE TABLE']);
  verifyTableNames(tables);
  const [columns]=await pool.execute('SELECT TABLE_NAME,COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=?',[TARGET]);
  verifyColumns(columns);
  const [fks]=await pool.execute('SELECT TABLE_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=? AND REFERENCED_TABLE_NAME IS NOT NULL',[TARGET]);
  verifyForeignKeys(fks);
  const [[counts]]=await pool.execute('SELECT (SELECT COUNT(*) FROM orders) AS orders_count, (SELECT COUNT(*) FROM users WHERE id<>0) AS actual_users_count');
  if(Number(counts.orders_count)!==0||Number(counts.actual_users_count)!==0)throw Error('Sandbox contains customers or orders; refuse to expose it in this read-only test');
  return {database:TARGET,tables:tables.length,foreignKeys:fks.length,readOnly:true};
}
module.exports={TARGET,TABLES,NEED_COLUMNS,assertOrigin,verifyTableNames,verifyColumns,verifyForeignKeys,verifyReadOnlySandbox};
