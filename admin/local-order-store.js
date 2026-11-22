'use strict';
/** Local-only MySQL TEST order store. No payments, no real identity or production checkout. */
const {transitionResult} = require('../backend/src/admin/orderRules');
function error(status,message){const e=new Error(message);e.status=status;return e;}
const SORT=Object.freeze({
 'date-desc':'created_at DESC','date-asc':'created_at ASC',
 'customer-asc':'customer_name ASC','customer-desc':'customer_name DESC',
 'total-desc':'total_cents DESC','total-asc':'total_cents ASC'
});
const STATUSES=new Set(['all','active','placed','processing','fulfilled','cancelled']);
function positiveId(v){
 const n=Number(v);
 if(!Number.isSafeInteger(n)||n<1)throw error(400,'Invalid ID');
 return n;
}
function validateCheckout(body){
 if(!body||typeof body!=='object'||Array.isArray(body))throw error(400,'Invalid checkout');
 const customer_name=typeof body.customer_name==='string'?body.customer_name.trim():'';
 const customer_email=typeof body.customer_email==='string'?body.customer_email.trim().toLowerCase():'';
 if(customer_name.length<2||customer_name.length>120)throw error(400,'Enter a test customer name (2–120 characters)');
 if(customer_email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer_email))throw error(400,'Enter a valid test email address');
 if(typeof body.client_token!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.client_token))throw error(400,'Invalid checkout request token');
 if(body.discount_code!=null&&body.discount_code!=='')throw error(409,'Discount codes are not connected to MySQL TEST checkout yet. Remove the code first.');
 if(!Array.isArray(body.items)||body.items.length<1||body.items.length>20)throw error(400,'Checkout requires 1–20 unique items');
 const seen=new Set();
 const items=body.items.map(v=>{
  if(!v||typeof v!=='object'||Array.isArray(v))throw error(400,'Invalid cart line');
  const product_id=positiveId(v.product_id),quantity=Number(v.quantity);
  if(!Number.isSafeInteger(quantity)||quantity<1||quantity>20)throw error(400,'Quantity must be 1–20');
  if(seen.has(product_id))throw error(400,'Duplicate product in cart');
  seen.add(product_id);return {product_id,quantity};
 });
 items.sort((a,b)=>a.product_id-b.product_id); // stable lock order helps prevent deadlocks
 return {customer_name,customer_email,client_token:body.client_token,items};
}
function createLocalOrderStore(pool){
 if(!pool||typeof pool.getConnection!=='function')throw Error('MySQL pool required');
 async function query(sql,args=[]){return (await pool.execute(sql,args))[0];}
 async function getOrder(id){
  const [order]=await query('SELECT id,customer_name,customer_email,status,subtotal_cents,discount_cents,tax_cents,total_cents,coupon_code,created_at FROM local_dev_orders WHERE id=?',[positiveId(id)]);
  if(!order)throw error(404,'Test order not found');
  order.items=await query('SELECT product_id,product_name,quantity,unit_price_cents,line_total_cents FROM local_dev_order_items WHERE order_id=? ORDER BY id',[id]);
  order.events=await query('SELECT from_status,to_status,actor_name,note,created_at FROM local_dev_order_events WHERE order_id=? ORDER BY id DESC',[id]);
  return order;
 }
 async function priorByToken(token){
  const [old]=await query('SELECT id FROM local_dev_orders WHERE client_token=?',[token]);
  return old?getOrder(old.id):null;
 }
 async function createOrder(raw){
  const payload=validateCheckout(raw);
  const prior=await priorByToken(payload.client_token);
  if(prior)return {order:prior,replayed:true};
  const conn=await pool.getConnection();let id;
  try{
   await conn.beginTransaction();
   let subtotal=0;
   const lines=[];
   for(const item of payload.items){
    const [rows]=await conn.execute('SELECT id,name,price_cents,sale_price_cents,stock,active FROM products WHERE id=? FOR UPDATE',[item.product_id]);
    const p=rows[0];
    if(!p||Number(p.active)!==1)throw error(409,`Product ${item.product_id} is unavailable`);
    if(!Number.isSafeInteger(Number(p.stock))||Number(p.stock)<item.quantity)throw error(409,`Insufficient stock for ${p.name}`);
    const regular=Number(p.price_cents),sale=p.sale_price_cents==null?null:Number(p.sale_price_cents);
    if(!Number.isSafeInteger(regular)||regular<1)throw error(409,'Product has an invalid price');
    const unit=(Number.isSafeInteger(sale)&&sale>0&&sale<regular)?sale:regular;
    const total=unit*item.quantity;
    subtotal+=total;
    if(!Number.isSafeInteger(subtotal)||subtotal>100000000)throw error(400,'Order amount exceeds local test limit');
    lines.push({product_id:item.product_id,product_name:String(p.name),quantity:item.quantity,unit_price_cents:unit,line_total_cents:total});
   }
   const tax=Math.round(subtotal*825/10000); // 8.25%, same as teammate's local cart config
   const [insert]=await conn.execute(
    'INSERT INTO local_dev_orders(client_token,customer_name,customer_email,status,subtotal_cents,discount_cents,tax_cents,total_cents,coupon_code) VALUES (?,?,?,\'placed\',?,0,?,?,NULL)',
    [payload.client_token,payload.customer_name,payload.customer_email,subtotal,tax,subtotal+tax]);
   id=insert.insertId;
   if(!Number.isSafeInteger(id)||id<1)throw error(500,'Test order insert failed');
   for(const line of lines){
    const [result]=await conn.execute('UPDATE products SET stock=stock-? WHERE id=? AND stock>=?',[line.quantity,line.product_id,line.quantity]);
    if(result.affectedRows!==1)throw error(409,`Stock changed while ordering ${line.product_name}`);
    await conn.execute('INSERT INTO local_dev_order_items(order_id,product_id,product_name,quantity,unit_price_cents,line_total_cents) VALUES (?,?,?,?,?,?)',
     [id,line.product_id,line.product_name,line.quantity,line.unit_price_cents,line.line_total_cents]);
   }
   await conn.execute('INSERT INTO local_dev_order_events(order_id,from_status,to_status,actor_name,note) VALUES (?,NULL,\'placed\',\'Local TEST checkout\',\'No payment processed\')',[id]);
   await conn.commit();
  }catch(e){
   try{await conn.rollback();}catch{}
   // If another identical request committed while this one waited for stock locks,
   // return that receipt instead of treating its lower remaining stock as a failed retry.
   if(e.code==='ER_DUP_ENTRY'||e.status===409){
    const existing=await priorByToken(payload.client_token);
    if(existing)return {order:existing,replayed:true};
   }
   throw e;
  }finally{conn.release();}
  return {order:await getOrder(id),replayed:false};
 }
 async function listOrders({sort='date-desc',status='all',search=''}={}){
  if(!Object.prototype.hasOwnProperty.call(SORT,sort)||!STATUSES.has(status))throw error(400,'Invalid order filter');
  if(typeof search!=='string'||search.length>100)throw error(400,'Search too long');
  const where=[],params=[];
  if(status==='active')where.push("status IN ('placed','processing')");
  else if(status!=='all'){where.push('status=?');params.push(status);}
  if(search.trim()){
   const q=`%${search.trim()}%`;
   where.push('(CAST(id AS CHAR) LIKE ? OR customer_name LIKE ? OR customer_email LIKE ?)');params.push(q,q,q);
  }
  const orders=await query('SELECT id,customer_name,customer_email,status,subtotal_cents,discount_cents,tax_cents,total_cents,coupon_code,created_at FROM local_dev_orders '+(where.length?'WHERE '+where.join(' AND '):'')+' ORDER BY '+SORT[sort]+', id DESC LIMIT 200',params);
  return {orders,count:orders.length};
 }
 async function stats(){
  const [row]=await query("SELECT COUNT(*) AS orders, COALESCE(SUM(CASE WHEN status IN ('placed','processing') THEN 1 ELSE 0 END),0) AS pending, COALESCE(SUM(CASE WHEN status='fulfilled' THEN 1 ELSE 0 END),0) AS fulfilled, COALESCE(SUM(CASE WHEN status<>'cancelled' THEN total_cents ELSE 0 END),0) AS revenue_cents FROM local_dev_orders");
  const [low]=await query('SELECT COUNT(*) AS low_stock FROM products WHERE active=1 AND stock<10');
  return {orders:Number(row.orders),pending:Number(row.pending),fulfilled:Number(row.fulfilled),revenue_cents:Number(row.revenue_cents),low_stock:Number(low.low_stock)};
 }
 async function updateStatus(orderId,body={}){
  const id=positiveId(orderId),next=String(body.status||''),note=String(body.note||'').trim();
  if(note.length>250)throw error(400,'Note must be 250 characters or fewer');
  const conn=await pool.getConnection();
  try{
   await conn.beginTransaction();
   const [orders]=await conn.execute('SELECT id,status FROM local_dev_orders WHERE id=? FOR UPDATE',[id]);
   if(!orders.length)throw error(404,'Test order not found');
   const previous=orders[0].status,check=transitionResult(previous,next);
   if(!check.allowed)throw error(409,'That order status transition is not allowed');
   if(!check.changed){await conn.commit();return {ok:true,changed:false,status:next};}
   if(check.restoreInventory){
    const [items]=await conn.execute('SELECT product_id,quantity FROM local_dev_order_items WHERE order_id=? ORDER BY product_id',[id]);
    for(const item of items){
     const [r]=await conn.execute('UPDATE products SET stock=stock+? WHERE id=?',[item.quantity,item.product_id]);
     if(r.affectedRows!==1)throw error(409,'Cannot restore a missing product');
    }
   }
   await conn.execute('UPDATE local_dev_orders SET status=? WHERE id=?',[next,id]);
   await conn.execute('INSERT INTO local_dev_order_events(order_id,from_status,to_status,actor_name,note) VALUES (?,?,?,\'Admin (local test)\',?)',[id,previous,next,note]);
   await conn.commit();return {ok:true,changed:true,status:next};
  }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
 }
 return {createOrder,getOrder,listOrders,stats,updateStatus};
}
module.exports={createLocalOrderStore,validateCheckout,SORT};
