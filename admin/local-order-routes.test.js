'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {createLocalEditApi}=require('./local-edit-api');
const secret='LocalOnly_Example#2026!';
async function service(){
 const pool={
  getConnection:async()=>({}),
  execute:async(sql)=>{
   if(sql.startsWith('SELECT COUNT(*) AS orders'))return [[{orders:0,pending:0,fulfilled:0,revenue_cents:0}]];
   if(sql.startsWith('SELECT COUNT(*) AS low_stock'))return [[{low_stock:0}]];
   if(sql.startsWith('SELECT id,customer_name,customer_email,status'))return [[]];
   return [[]];
  }
 };
 const api=createLocalEditApi({password:secret,pool,database:'coffee_overflow_dev'});
 const server=http.createServer((req,res)=>api.handle(req,res));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const request=(url,method='GET',body,headers={})=>fetch(origin+url,{method,
  headers:{'Content-Type':'application/json',Origin:origin,'X-Coffee-Dev':'1',...headers},
  body:body===undefined?undefined:JSON.stringify(body)});
 return {request,stop:()=>new Promise(resolve=>server.close(resolve))};
}
test('order list and stats require local admin login and use existing session',async()=>{
 const svc=await service();try{
  assert.equal((await svc.request('/api/local-admin/orders')).status,401);
  assert.equal((await svc.request('/api/local-admin/stats')).status,401);
  const login=await svc.request('/api/local-admin/login','POST',{password:secret});
  assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const orders=await svc.request('/api/local-admin/orders','GET',undefined,{Cookie:cookie});
  assert.equal(orders.status,200);assert.deepEqual(await orders.json(),{orders:[],count:0});
  const stats=await svc.request('/api/local-admin/stats','GET',undefined,{Cookie:cookie});
  assert.equal(stats.status,200);assert.equal((await stats.json()).orders,0);
 }finally{await svc.stop();}
});
test('test checkout requires correct localhost origin and validates body',async()=>{
 const svc=await service();try{
  const input={customer_name:'A',customer_email:'bad',client_token:'invalid',items:[]};
  assert.equal((await svc.request('/api/local-checkout/orders','POST',input,{Origin:'http://evil.example'})).status,403);
  const invalid=await svc.request('/api/local-checkout/orders','POST',input);
  assert.equal(invalid.status,400);
  assert.match((await invalid.json()).error,/customer name/);
  assert.equal((await svc.request('/api/local-admin/orders/1/status','PATCH',{status:'cancelled'})).status,401);
 }finally{await svc.stop();}
});
