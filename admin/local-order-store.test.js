'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createLocalOrderStore,validateCheckout}=require('./local-order-store');
const TOKEN='3b310fc6-1d57-4e01-a36c-3e18c8ebca12';
const form=(x={})=>({customer_name:'Test Customer',customer_email:'test@example.test',client_token:TOKEN,items:[{product_id:1,quantity:2}],...x});
const clone=o=>structuredClone(o);
function fakePool(){
 let db={products:[{id:1,name:'Sunrise House Blend',price_cents:1800,sale_price_cents:1500,stock:8,active:1},
   {id:2,name:'Hidden Coffee',price_cents:2300,sale_price_cents:null,stock:5,active:0}],
  orders:[],items:[],events:[],nextId:1,nextItemId:1,nextEventId:1};
 let commits=0,rollbacks=0;
 function sqlRun(state,sql,params=[]){
  const tab=(data)=>[data];
  if(sql.startsWith('SELECT id FROM local_dev_orders WHERE client_token='))return tab(state.orders.filter(o=>o.client_token===params[0]).map(o=>({id:o.id})));
  if(sql.startsWith('SELECT id,customer_name,customer_email,status') && sql.includes('WHERE id=?'))return tab(state.orders.filter(o=>o.id===params[0]).map(clone));
  if(sql.startsWith('SELECT product_id,product_name,quantity'))return tab(state.items.filter(i=>i.order_id===params[0]).map(clone));
  if(sql.startsWith('SELECT from_status,to_status,actor_name'))return tab(state.events.filter(e=>e.order_id===params[0]).sort((a,b)=>b.id-a.id).map(clone));
  if(sql.startsWith('SELECT id,name,price_cents,sale_price_cents,stock,active FROM products'))return tab(state.products.filter(p=>p.id===params[0]).map(clone));
  if(sql.startsWith('INSERT INTO local_dev_orders(')){
   if(state.orders.some(o=>o.client_token===params[0])){const e=new Error('duplicate');e.code='ER_DUP_ENTRY';throw e;}
   const id=state.nextId++;
   state.orders.push({id,client_token:params[0],customer_name:params[1],customer_email:params[2],status:'placed',subtotal_cents:params[3],discount_cents:0,tax_cents:params[4],total_cents:params[5],coupon_code:null,created_at:new Date('2026-11-11T10:00:00Z')});
   return tab({insertId:id,affectedRows:1});
  }
  if(sql.startsWith('UPDATE products SET stock=stock-?')){
   const p=state.products.find(p=>p.id===params[1]&&p.stock>=params[2]);if(p)p.stock-=params[0];return tab({affectedRows:p?1:0});
  }
  if(sql.startsWith('INSERT INTO local_dev_order_items(')){
   state.items.push({id:state.nextItemId++,order_id:params[0],product_id:params[1],product_name:params[2],quantity:params[3],unit_price_cents:params[4],line_total_cents:params[5]});
   return tab({affectedRows:1});
  }
  if(sql.startsWith('INSERT INTO local_dev_order_events(')){
   if(params.length===1)state.events.push({id:state.nextEventId++,order_id:params[0],from_status:null,to_status:'placed',actor_name:'Local TEST checkout',note:'No payment processed',created_at:new Date('2026-11-11T10:00:00Z')});
   else state.events.push({id:state.nextEventId++,order_id:params[0],from_status:params[1],to_status:params[2],actor_name:'Admin (local test)',note:params[3],created_at:new Date('2026-11-11T10:00:00Z')});
   return tab({affectedRows:1});
  }
  if(sql.startsWith('SELECT id,status FROM local_dev_orders'))return tab(state.orders.filter(o=>o.id===params[0]).map(o=>({id:o.id,status:o.status})));
  if(sql.startsWith('SELECT product_id,quantity FROM local_dev_order_items'))return tab(state.items.filter(i=>i.order_id===params[0]).map(i=>({product_id:i.product_id,quantity:i.quantity})));
  if(sql.startsWith('UPDATE products SET stock=stock+?')){
   const p=state.products.find(p=>p.id===params[1]);if(p)p.stock+=params[0];return tab({affectedRows:p?1:0});
  }
  if(sql.startsWith('UPDATE local_dev_orders SET status=')){
   const o=state.orders.find(o=>o.id===params[1]);if(o)o.status=params[0];return tab({affectedRows:o?1:0});
  }
  if(sql.startsWith('SELECT id,customer_name,customer_email,status') && sql.includes('ORDER BY')){
   let a=state.orders.map(clone);
   if(sql.includes("status IN ('placed','processing')"))a=a.filter(x=>['placed','processing'].includes(x.status));
   else if(sql.includes('status=?'))a=a.filter(x=>x.status===params[0]);
   if(sql.includes('LIKE ?')){const term=String(params.at(-1)).replace(/%/g,'').toLowerCase();a=a.filter(x=>[x.id,x.customer_name,x.customer_email].some(v=>String(v).toLowerCase().includes(term)));}
   if(sql.includes('total_cents DESC'))a.sort((x,y)=>y.total_cents-x.total_cents);
   else if(sql.includes('total_cents ASC'))a.sort((x,y)=>x.total_cents-y.total_cents);
   else a.sort((x,y)=>y.id-x.id);
   return tab(a);
  }
  if(sql.startsWith('SELECT COUNT(*) AS orders')){
   return tab([{orders:state.orders.length,pending:state.orders.filter(o=>['placed','processing'].includes(o.status)).length,
     fulfilled:state.orders.filter(o=>o.status==='fulfilled').length,
     revenue_cents:state.orders.filter(o=>o.status!=='cancelled').reduce((sum,o)=>sum+o.total_cents,0)}]);
  }
  if(sql.startsWith('SELECT COUNT(*) AS low_stock'))return tab([{low_stock:state.products.filter(p=>p.active&&p.stock<10).length}]);
  throw new Error('Unexpected SQL in test: '+sql);
 }
 const pool={
  execute:async(sql,params)=>sqlRun(db,sql,params),
  getConnection:async()=>{
   let pending=null;
   return {
    beginTransaction:async()=>{pending=clone(db);},
    execute:async(sql,params)=>sqlRun(pending,sql,params),
    commit:async()=>{db=pending;pending=null;commits++;},
    rollback:async()=>{pending=null;rollbacks++;},release:()=>{}
   };
  }
 };
 return {pool,state:()=>db,stats:()=>({commits,rollbacks})};
}
test('checkout input validation enforces test customer, line limits, and promo rejection',()=>{
 assert.equal(validateCheckout(form()).items[0].quantity,2);
 for(const bad of [form({customer_name:'A'}),form({customer_email:'bad'}),form({items:[]}),form({discount_code:'COFFEE10'}),form({items:[{product_id:1,quantity:2},{product_id:1,quantity:1}]}),form({client_token:'abc'})]){
  assert.throws(()=>validateCheckout(bad));
 }
});
test('MySQL test checkout snapshots server prices, computes 8.25% tax, writes event, and reduces stock',async()=>{
 const f=fakePool(),s=createLocalOrderStore(f.pool);
 const {order,replayed}=await s.createOrder(form({items:[{product_id:1,quantity:2,unit_price_cents:1}]}));
 assert.equal(replayed,false);assert.equal(order.subtotal_cents,3000);assert.equal(order.tax_cents,248);assert.equal(order.total_cents,3248);
 assert.equal(order.status,'placed');assert.equal(order.items.length,1);assert.equal(order.items[0].unit_price_cents,1500);
 assert.equal(order.events[0].to_status,'placed');assert.equal(f.state().products[0].stock,6);
 assert.equal(f.stats().commits,1);
});
test('same checkout token never deducts stock twice',async()=>{
 const f=fakePool(),s=createLocalOrderStore(f.pool);
 const first=await s.createOrder(form());const again=await s.createOrder(form());
 assert.equal(first.order.id,again.order.id);assert.equal(again.replayed,true);assert.equal(f.state().products[0].stock,6);
 assert.equal(f.state().orders.length,1);
});
test('stock checks and hidden products cause rollback with no new order',async()=>{
 const f=fakePool(),s=createLocalOrderStore(f.pool);
 await assert.rejects(s.createOrder(form({items:[{product_id:1,quantity:20}]})),/Insufficient stock/);
 await assert.rejects(s.createOrder(form({items:[{product_id:2,quantity:1}]})),/unavailable/);
 assert.equal(f.state().orders.length,0);assert.equal(f.state().products[0].stock,8);assert.equal(f.stats().rollbacks,2);
});
test('admin processes then cancels and restores inventory exactly once',async()=>{
 const f=fakePool(),s=createLocalOrderStore(f.pool);
 const {order}=await s.createOrder(form());
 await assert.rejects(s.updateStatus(order.id,{status:'fulfilled'}),/not allowed/);
 assert.deepEqual(await s.updateStatus(order.id,{status:'processing',note:'Packing'}),{ok:true,changed:true,status:'processing'});
 assert.deepEqual(await s.updateStatus(order.id,{status:'cancelled',note:'Customer asked'}),{ok:true,changed:true,status:'cancelled'});
 assert.equal(f.state().products[0].stock,8);
 assert.deepEqual(await s.updateStatus(order.id,{status:'cancelled'}),{ok:true,changed:false,status:'cancelled'});
 assert.equal(f.state().products[0].stock,8);
 assert.equal((await s.getOrder(order.id)).events.length,3);
 await assert.rejects(s.updateStatus(order.id,{status:'processing'}),/not allowed/);
});
test('admin lists, filters, sorts, and summarizes local test orders',async()=>{
 const f=fakePool(),s=createLocalOrderStore(f.pool);
 await s.createOrder(form());
 await s.createOrder(form({client_token:'2b310fc6-1d57-4e01-a36c-3e18c8ebca12',customer_name:'Second Guest',items:[{product_id:1,quantity:1}]}));
 const all=await s.listOrders({sort:'total-desc'});
 assert.equal(all.count,2);assert.equal(all.orders[0].subtotal_cents,3000);
 assert.equal((await s.listOrders({status:'placed',search:'Second'})).count,1);
 assert.equal((await s.stats()).pending,2);
 await s.updateStatus(all.orders[0].id,{status:'cancelled'});
 assert.equal((await s.stats()).orders,2);assert.equal((await s.stats()).pending,1);
 await assert.rejects(s.listOrders({sort:'DROP TABLE'}),/Invalid order filter/);
});
