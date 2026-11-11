'use strict';
/*
  Adapter for an AGREED shared MySQL schema. It is intentionally not mounted by default.
  Requires users, products, coupons, orders, order_items, order_events fields described
  in docs/TEAM_HANDOFF.md. Review with Reyna + Isaac before enabling it.
*/
const { transitionResult } = require('./orderRules');
function httpError(status,message){ const e=new Error(message);e.status=status;return e; }
const VALID_SORT={
  'date-desc':'o.created_at DESC','date-asc':'o.created_at ASC',
  'customer-asc':'u.name ASC','customer-desc':'u.name DESC',
  'total-asc':'o.total_cents ASC','total-desc':'o.total_cents DESC'
};
const VALID_STATUS=new Set(['all','active','placed','processing','fulfilled','cancelled']);
const idNumber=v=>{const n=Number(v);if(!Number.isSafeInteger(n)||n<=0)throw httpError(400,'Invalid ID');return n;};
const cents=v=>Number.isSafeInteger(v)&&v>=0&&v<=100000000;
function validateProduct(body){
  const name=String(body.name||'').trim(),description=String(body.description||'').trim();
  if(name.length<2||name.length>120)throw httpError(400,'Product name must be 2–120 characters');
  if(description.length>1200)throw httpError(400,'Description is too long');
  if(!cents(body.price_cents)||body.price_cents===0)throw httpError(400,'Invalid product price');
  if(body.sale_price_cents!==null && body.sale_price_cents!==undefined && (!cents(body.sale_price_cents)||body.sale_price_cents>=body.price_cents))throw httpError(400,'Sale price must be below regular price');
  if(!Number.isSafeInteger(body.stock)||body.stock<0)throw httpError(400,'Invalid stock');
  const image=String(body.image||'').trim();
  if(image.length>255||(!image.startsWith('/assets/')&&!image.startsWith('https://')))throw httpError(400,'Use an approved image path');
  return {name,description,category:String(body.category||'Coffee').slice(0,32),image,price_cents:body.price_cents,sale_price_cents:body.sale_price_cents??null,stock:body.stock,active:body.active?1:0};
}
function createMysqlAdminStore(pool){
 if(!pool || typeof pool.getConnection!=='function')throw new Error('Shared mysql2 pool required');
 const query=async(sql,params=[]) => (await pool.execute(sql,params))[0];
 const store={
   async stats(){
     const [counts]=await query(`SELECT COUNT(*) AS orders, COALESCE(SUM(CASE WHEN status IN ('placed','processing') THEN 1 ELSE 0 END),0) AS pending, COALESCE(SUM(CASE WHEN status='fulfilled' THEN 1 ELSE 0 END),0) AS fulfilled, COALESCE(SUM(CASE WHEN status<>'cancelled' THEN total_cents ELSE 0 END),0) AS revenue_cents FROM orders`);
     const [stock]=await query('SELECT COUNT(*) AS low_stock FROM products WHERE active=1 AND stock<10');
     return {...counts,...stock};
   },
   async listOrders(options={}){
     const sort=String(options.sort||'date-desc'),status=String(options.status||'all'),search=String(options.search||'').trim().slice(0,100);
     if(!Object.hasOwn(VALID_SORT,sort)||!VALID_STATUS.has(status))throw httpError(400,'Invalid sort or status');
     const where=[],params=[];
     if(status==='active')where.push("o.status IN ('placed','processing')");
     else if(status!=='all'){where.push('o.status=?');params.push(status);}
     if(search){where.push('(CAST(o.id AS CHAR) LIKE ? OR u.name LIKE ? OR u.email LIKE ?)');params.push(...Array(3).fill(`%${search}%`));}
     const sql=`SELECT o.id,o.user_id,o.status,o.subtotal_cents,o.discount_cents,o.tax_cents,o.total_cents,o.coupon_code,o.created_at,u.name AS customer_name,u.email AS customer_email FROM orders o JOIN users u ON u.id=o.user_id ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY ${VALID_SORT[sort]},o.id DESC LIMIT 200`;
     const orders=await query(sql,params);
     return {orders,count:orders.length};
   },
   async getOrder(orderId){
     const id=idNumber(orderId);
     const [order]=await query('SELECT o.*,u.name AS customer_name,u.email AS customer_email FROM orders o JOIN users u ON u.id=o.user_id WHERE o.id=?',[id]);
     if(!order)throw httpError(404,'Order not found');
     order.items=await query('SELECT product_id,product_name,quantity,unit_price_cents,line_total_cents FROM order_items WHERE order_id=?',[id]);
     order.events=await query('SELECT e.from_status,e.to_status,e.note,e.created_at,COALESCE(u.name,\'System\') AS actor_name FROM order_events e LEFT JOIN users u ON u.id=e.actor_user_id WHERE e.order_id=? ORDER BY e.id DESC',[id]);
     return order;
   },
   async updateStatus(orderId,body={},actor={}){
     const id=idNumber(orderId),next=String(body.status||'');
     if(!['placed','processing','fulfilled','cancelled'].includes(next))throw httpError(400,'Invalid order status');
     const note=String(body.note||'').trim().slice(0,250);
     const conn=await pool.getConnection();
     try{
       await conn.beginTransaction();
       const [rows]=await conn.execute('SELECT id,status,coupon_code FROM orders WHERE id=? FOR UPDATE',[id]);
       const order=rows[0]; if(!order)throw httpError(404,'Order not found');
       const check=transitionResult(order.status,next);
       if(!check.allowed)throw httpError(409,'Status change is not allowed');
       if(!check.changed){await conn.commit();return {ok:true,changed:false};}
       if(check.restoreInventory){
         const [items]=await conn.execute('SELECT product_id,quantity FROM order_items WHERE order_id=?',[id]);
         for(const line of items){
           const [updated]=await conn.execute('UPDATE products SET stock=stock+? WHERE id=?',[line.quantity,line.product_id]);
           if(updated.affectedRows!==1)throw httpError(409,'Cannot restore a missing product');
         }
         if(order.coupon_code){await conn.execute('UPDATE coupons SET used_count=GREATEST(0,used_count-1) WHERE code=?',[order.coupon_code]);}
       }
       await conn.execute('UPDATE orders SET status=? WHERE id=?',[next,id]);
       await conn.execute('INSERT INTO order_events(order_id,actor_user_id,from_status,to_status,note,created_at) VALUES (?,?,?,?,?,NOW())',[id,idNumber(actor?.id),order.status,next,note]);
       await conn.commit();return {ok:true,changed:true,status:next};
     }catch(error){await conn.rollback();throw error;}finally{conn.release();}
   },
   async products(){return query('SELECT id,name,description,category,image,price_cents,sale_price_cents,stock,active FROM products ORDER BY id DESC');},
   async saveProduct(id,body={}){
     const p=validateProduct(body);
     if(id){const rid=idNumber(id);const result=await query('UPDATE products SET name=?,description=?,category=?,image=?,price_cents=?,sale_price_cents=?,stock=?,active=? WHERE id=?',[p.name,p.description,p.category,p.image,p.price_cents,p.sale_price_cents,p.stock,p.active,rid]);if(result.affectedRows!==1)throw httpError(404,'Product not found');return {ok:true,id:rid};}
     const result=await query('INSERT INTO products(name,description,category,image,price_cents,sale_price_cents,stock,active) VALUES (?,?,?,?,?,?,?,?)',[p.name,p.description,p.category,p.image,p.price_cents,p.sale_price_cents,p.stock,p.active]);return {ok:true,id:result.insertId};
   },
   async users(){return query('SELECT id,name,email,role,created_at FROM users ORDER BY id DESC LIMIT 200');},
   async saveUser(id,body={}){
     const rid=idNumber(id),name=String(body.name||'').trim(),email=String(body.email||'').trim().toLowerCase();
     if(name.length<2||name.length>120||!/^\S+@\S+\.\S+$/.test(email))throw httpError(400,'Invalid customer details');
     // Role changes deliberately excluded from UI to avoid unauthorized privilege escalation.
     const result=await query('UPDATE users SET name=?,email=? WHERE id=?',[name,email,rid]);
     if(result.affectedRows!==1)throw httpError(404,'Customer not found');return {ok:true,id:rid};
   },
   async coupons(){return query('SELECT id,code,type,amount,min_subtotal_cents,usage_limit,used_count,expires_at,active FROM coupons ORDER BY id DESC');},
   async saveCoupon(id,body={}){
     const code=String(body.code||'').trim().toUpperCase(),type=String(body.type||'');
     const amount=Number(body.amount),min=Number(body.min_subtotal_cents||0);
     if(!/^[A-Z0-9_-]{3,32}$/.test(code)||!['percent','fixed'].includes(type)||!Number.isSafeInteger(amount)||amount<=0||(type==='percent'&&amount>100)||!cents(min))throw httpError(400,'Invalid coupon fields');
     const limit=body.usage_limit==null||body.usage_limit===''?null:Number(body.usage_limit);
     if(limit!==null&&(!Number.isInteger(limit)||limit<=0))throw httpError(400,'Invalid coupon limit');
     const vals=[code,type,amount,min,limit,body.active?1:0];
     if(id){const rid=idNumber(id);const result=await query('UPDATE coupons SET code=?,type=?,amount=?,min_subtotal_cents=?,usage_limit=?,active=? WHERE id=?',[...vals,rid]);if(result.affectedRows!==1)throw httpError(404,'Coupon not found');return {ok:true,id:rid};}
     const result=await query('INSERT INTO coupons(code,type,amount,min_subtotal_cents,usage_limit,used_count,active) VALUES (?,?,?,?,?,0,?)',vals);return {ok:true,id:result.insertId};
   }
 };
 return store;
}
module.exports={createMysqlAdminStore,VALID_SORT};
