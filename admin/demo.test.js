'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function demo(){
 const storage=new Map(),window={};
 vm.runInNewContext(fs.readFileSync(__dirname+'/demo-data.js','utf8'),{window,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},location:{origin:'http://localhost:5173'},URL,Date,Number,JSON,Math,Error,Set,String,Array});
 return window.CoffeeAdminDemo.request;
}
test('preview supports searching, sorting, protected-looking but SAMPLE orders and read-only metrics',async()=>{
 const api=demo();
 const stats=await api('/api/admin/stats');assert.equal(stats.orders,3);assert.equal(stats.pending,2);
 assert.equal((await api('/api/admin/orders?sort=total-desc')).orders[0].id,1043);
 assert.equal((await api('/api/admin/orders?status=placed')).orders.length,1);
 assert.equal((await api('/api/admin/orders?search=morgan')).orders[0].id,1042);
});
test('preview enforces order lifecycle and restores sample stock at most once',async()=>{
 const api=demo();
 const before=(await api('/api/admin/products')).products.find(p=>p.id===2).stock;
 assert.equal((await api('/api/admin/orders/1042/status',{method:'PATCH',body:{status:'processing',note:'Packing'}})).changed,true);
 assert.equal((await api('/api/admin/orders/1042/status',{method:'PATCH',body:{status:'cancelled'}})).changed,true);
 const after=(await api('/api/admin/products')).products.find(p=>p.id===2).stock;
 assert.equal(after,before+2);
 assert.equal((await api('/api/admin/orders/1042/status',{method:'PATCH',body:{status:'cancelled'}})).changed,false);
 assert.equal((await api('/api/admin/products')).products.find(p=>p.id===2).stock,after);
 assert.equal((await api('/api/admin/orders/1042')).order.events.length,3);
 await assert.rejects(()=>api('/api/admin/orders/1044/status',{method:'PATCH',body:{status:'cancelled'}}),/not allowed/);
});
test('preview allows sample inventory, discount and customer editing',async()=>{
 const api=demo();
 await api('/api/admin/products/1',{method:'PATCH',body:{stock:25}});
 assert.equal((await api('/api/admin/products')).products.find(p=>p.id===1).stock,25);
 await api('/api/admin/coupons',{method:'POST',body:{code:'TEST20',type:'percent',amount:20,active:true}});
 assert.ok((await api('/api/admin/coupons')).coupons.some(c=>c.code==='TEST20'));
 await api('/api/admin/users/7',{method:'PATCH',body:{name:'Morgan Example'}});
 assert.equal((await api('/api/admin/users')).users.find(u=>u.id===7).name,'Morgan Example');
});
