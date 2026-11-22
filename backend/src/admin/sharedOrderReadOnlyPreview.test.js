'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createPreviewServer}=require('./sharedOrderReadOnlyPreview');

function setup(){
 const calls={stats:0,list:0,detail:0,writes:0};
 const store={
   stats:async()=>{calls.stats++;return {orders:1,pending:1,fulfilled:0,revenue_cents:1949,low_stock:0};},
   listOrders:async options=>{calls.list++;return {count:1,orders:[{id:1,status:'placed',customer_name:'Test Customer',customer_email:'test@example.test',total_cents:1949,created_at:'2026-11-20T10:00:00.000Z'}],sort:options.sort};},
   getOrder:async id=>{calls.detail++;return {id:Number(id),items:[],events:[],status:'placed'};},
   updateStatus:async()=>{calls.writes++;throw Error('must never be exposed');}
 };
 return {calls,server:createPreviewServer({store,accessCode:'0123456789abcdef'})};
}
async function request(base,path,opts={}){return fetch(base+path,{redirect:'manual',...opts});}

test('shared-order preview requires a session, rejects all writes, and serves read-only data after login', async t=>{
 const {calls,server}=setup();
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 t.after(async()=>new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve())));
 const base=`http://127.0.0.1:${server.address().port}`;
 let res=await request(base,'/api/preview/orders');assert.equal(res.status,401);assert.equal(calls.list,0);
 res=await request(base,'/api/preview/stats');assert.equal(res.status,401);assert.equal(calls.stats,0);
 res=await request(base,'/api/preview/orders/1',{method:'PATCH'});assert.equal(res.status,405);assert.equal(calls.writes,0);
 res=await request(base,'/api/preview/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://127.0.0.1:5176'},body:JSON.stringify({code:'wrong-code'})});assert.equal(res.status,401);
 res=await request(base,'/api/preview/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://127.0.0.1:5176'},body:JSON.stringify({code:'0123456789abcdef'})});assert.equal(res.status,200);
 const cookie=res.headers.get('set-cookie').split(';')[0];assert.match(cookie,/co_integration_session=/);
 res=await request(base,'/api/preview/orders?sort=date-desc',{headers:{Cookie:cookie}});assert.equal(res.status,200);assert.equal((await res.json()).count,1);
 res=await request(base,'/api/preview/stats',{headers:{Cookie:cookie}});assert.equal(res.status,200);assert.equal((await res.json()).revenue_cents,1949);
 res=await request(base,'/api/preview/orders/1',{headers:{Cookie:cookie}});assert.equal(res.status,200);assert.equal((await res.json()).order.id,1);
 res=await request(base,'/api/preview/orders/1',{method:'PATCH',headers:{Cookie:cookie}});assert.equal(res.status,405);assert.equal(calls.writes,0);
 assert.equal(calls.list,1);assert.equal(calls.stats,1);assert.equal(calls.detail,1);
 res=await request(base,'/api/preview/logout',{method:'POST',headers:{Cookie:cookie,Origin:'http://127.0.0.1:5176'}});assert.equal(res.status,200);
 res=await request(base,'/api/preview/orders',{headers:{Cookie:cookie}});assert.equal(res.status,401);
});
