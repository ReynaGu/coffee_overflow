'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {createLocalEditApi,validateEdit,matchesExpected}=require('./local-edit-api');
const {staticAllowed}=require('./preview-server');
const goodPassword='LocalOnly_Example#2026!';
function db(){
 const row={id:1,stock:7,price_cents:1800,sale_price_cents:null,active:1};
 return {row,getConnection:async()=>({
  beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release:()=>{},
  execute:async(sql,args)=>{
   if(sql.startsWith('SELECT'))return [[args[0]===1?{...row}:undefined].filter(Boolean)];
   if(sql.startsWith('UPDATE')){row.stock=args[0];row.price_cents=args[1];row.sale_price_cents=args[2];row.active=args[3];return [{affectedRows:1}];}
   throw Error('Unexpected SQL');
  }
 })};
}
const edit={stock:15,price_cents:1800,sale_price_cents:1500,active:1,
 expected:{stock:7,price_cents:1800,sale_price_cents:null,active:1}};
async function server(){
 const pool=db(),api=createLocalEditApi({password:goodPassword,pool,database:'coffee_overflow_dev'});
 const app=http.createServer((req,res)=>api.handle(req,res));await new Promise(ok=>app.listen(0,'127.0.0.1',ok));
 const url=`http://127.0.0.1:${app.address().port}`;
 const request=(path,method='GET',body,headers={})=>fetch(url+path,{method,headers:{'Content-Type':'application/json','Origin':url,'X-Coffee-Dev':'1',...headers},body:body?JSON.stringify(body):undefined});
 return {pool,request,stop:()=>new Promise(ok=>app.close(ok))};
}
test('only allows local development database and substantial password',()=>{
 assert.throws(()=>createLocalEditApi({password:goodPassword,pool:db(),database:'old_school'}),/restricted/);
 assert.throws(()=>createLocalEditApi({password:'short',pool:db(),database:'coffee_overflow_dev'}),/12 characters/);
});
test('validates product write fields strictly, excluding unexpected data',()=>{
 assert.deepEqual(validateEdit(edit),edit);
 assert.throws(()=>validateEdit({...edit,stock:-1}),/stock/);
 assert.throws(()=>validateEdit({...edit,sale_price_cents:2000}),/Sale price/);
 assert.equal(matchesExpected({stock:7,price_cents:1800,sale_price_cents:null,active:1},edit.expected),true);
});
test('authentication, session cookie, approved update, optimistic concurrency and logout',async()=>{
 const s=await server();try{
  let r=await s.request('/api/local-admin/products/1','PATCH',edit);assert.equal(r.status,401);
  r=await s.request('/api/local-admin/login','POST',{password:'wrong-password'});assert.equal(r.status,401);
  r=await s.request('/api/local-admin/login','POST',{password:goodPassword});assert.equal(r.status,200);
  const cookie=r.headers.get('set-cookie').split(';')[0];assert.match(r.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
  r=await s.request('/api/local-admin/session','GET',null,{Cookie:cookie});assert.equal(r.status,200);
  r=await s.request('/api/local-admin/products/1','PATCH',edit,{Cookie:cookie});assert.equal(r.status,200);assert.equal(s.pool.row.stock,15);assert.equal(s.pool.row.sale_price_cents,1500);
  r=await s.request('/api/local-admin/products/1','PATCH',edit,{Cookie:cookie});assert.equal(r.status,409);assert.equal(s.pool.row.stock,15);
  r=await s.request('/api/local-admin/logout','POST',null,{Cookie:cookie});assert.equal(r.status,200);
  r=await s.request('/api/local-admin/products/1','PATCH',{...edit,stock:18},{Cookie:cookie});assert.equal(r.status,401);
 }finally{await s.stop();}
});
test('cross-origin write request denied even with valid credentials',async()=>{
 const s=await server();try{
  let r=await s.request('/api/local-admin/login','POST',{password:goodPassword},{Origin:'http://evil.example'});
  assert.equal(r.status,403);
  r=await s.request('/api/local-admin/login','POST',{password:goodPassword});
  const cookie=r.headers.get('set-cookie').split(';')[0];
  r=await s.request('/api/local-admin/products/1','PATCH',edit,{Origin:'http://evil.example',Cookie:cookie});assert.equal(r.status,403);
  assert.equal(s.pool.row.stock,7);
 }finally{await s.stop();}
});
test('preview server never serves backend secrets or implementation files',()=>{
 assert.equal(staticAllowed('admin/index.html'),true);
 assert.equal(staticAllowed('admin/admin.js'),true);
 assert.equal(staticAllowed('assets/css/main.css'),true);
 assert.equal(staticAllowed('backend/.env'),false);
 assert.equal(staticAllowed('backend/src/config/db.js'),false);
 assert.equal(staticAllowed('.git/config'),false);
 assert.equal(staticAllowed('admin/local-edit-api.js'),false);
 assert.equal(staticAllowed('admin/preview-server.js'),false);
});
