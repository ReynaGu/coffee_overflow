'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {createLocalEditApi,validateCreate,validateEdit,matchesExpected}=require('./local-edit-api');
const {staticAllowed}=require('./preview-server');
const goodPassword='LocalOnly_Example#2026!';
const original={id:1,name:'Sunrise House Blend',description:'Balanced everyday coffee',category:'Coffee',image:'/assets/images/Pile_of_coffee_beans.jpeg',stock:7,price_cents:1800,sale_price_cents:null,active:1};
const clone=v=>JSON.parse(JSON.stringify(v));
function db(){
 const rows=[clone(original)];let next=2;
 return {rows,getConnection:async()=>({
  beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release:()=>{},
  execute:async(sql,args)=>{
   if(sql.startsWith('SELECT')){const row=rows.find(r=>r.id===args[0]);return [[...(row?[clone(row)]:[])]];}
   if(sql.startsWith('INSERT')){
     const row={id:next++,name:args[0],description:args[1],category:args[2],image:args[3],stock:args[4],price_cents:args[5],sale_price_cents:args[6],active:args[7]};
     rows.push(row);return [{insertId:row.id,affectedRows:1}];
   }
   if(sql.startsWith('UPDATE')){
     const row=rows.find(r=>r.id===args[8]);if(!row)return [{affectedRows:0}];
     Object.assign(row,{name:args[0],description:args[1],category:args[2],image:args[3],stock:args[4],price_cents:args[5],sale_price_cents:args[6],active:args[7]});
     return [{affectedRows:1}];
   }
   throw Error('Unexpected SQL: '+sql);
  }
 })};
}
const fields={name:'Sunrise House Blend',description:'Balanced everyday coffee',category:'Coffee',image:'/assets/images/Pile_of_coffee_beans.jpeg',stock:15,price_cents:1800,sale_price_cents:1500,active:1};
const edit={...fields,expected:{name:original.name,description:original.description,category:original.category,image:original.image,stock:original.stock,price_cents:original.price_cents,sale_price_cents:original.sale_price_cents,active:original.active}};
async function server(){
 const pool=db(),api=createLocalEditApi({password:goodPassword,pool,database:'coffee_overflow_dev'});
 const app=http.createServer((req,res)=>api.handle(req,res));await new Promise(ok=>app.listen(0,'127.0.0.1',ok));
 const url=`http://127.0.0.1:${app.address().port}`;
 const request=(path,method='GET',body,headers={})=>fetch(url+path,{method,
  headers:{'Content-Type':'application/json','Origin':url,'X-Coffee-Dev':'1',...headers},
  body:body?JSON.stringify(body):undefined});
 return {pool,request,stop:()=>new Promise(ok=>app.close(ok))};
}
async function login(s){
 const r=await s.request('/api/local-admin/login','POST',{password:goodPassword});
 assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];
}
test('restricted to local development database with strong distinct password',()=>{
 assert.throws(()=>createLocalEditApi({password:goodPassword,pool:db(),database:'old_school'}),/restricted/);
 assert.throws(()=>createLocalEditApi({password:'short',pool:db(),database:'coffee_overflow_dev'}),/12 characters/);
});
test('strictly validates product fields and image paths',()=>{
 assert.deepEqual(validateCreate(fields),fields);
 assert.deepEqual(validateEdit(edit),edit);
 assert.throws(()=>validateCreate({...fields,name:'a'}),/Name/);
 assert.throws(()=>validateCreate({...fields,image:'javascript:alert(1)'}),/Image/);
 assert.throws(()=>validateCreate({...fields,image:'/assets/images/../private.png'}),/Image/);
 assert.throws(()=>validateCreate({...fields,sale_price_cents:2000}),/Sale price/);
 assert.throws(()=>validateCreate({...fields,stock:-1}),/stock/);
 assert.throws(()=>validateCreate({...fields,active:true}),/Active/);
 assert.throws(()=>validateEdit({...fields}),/Expected/);
 assert.equal(matchesExpected(original,edit.expected),true);
});
test('requires login to create and edit, allows full edits with optimistic conflict checking',async()=>{
 const s=await server();try{
  let r=await s.request('/api/local-admin/products','POST',fields);assert.equal(r.status,401);
  r=await s.request('/api/local-admin/products/1','PATCH',edit);assert.equal(r.status,401);
  r=await s.request('/api/local-admin/login','POST',{password:'wrong-password'});assert.equal(r.status,401);
  const cookie=await login(s);
  r=await s.request('/api/local-admin/session','GET',null,{Cookie:cookie});assert.equal(r.status,200);
  const edited={...edit,name:'Sunrise House Blend Special',description:'Now in a larger bag',category:'Coffee Beans',image:'/assets/images/espresso_machine.jpeg',stock:15,price_cents:2100,sale_price_cents:1900,active:0};
  r=await s.request('/api/local-admin/products/1','PATCH',edited,{Cookie:cookie});assert.equal(r.status,200);
  assert.deepEqual({...s.pool.rows[0]}, {id:1,name:edited.name,description:edited.description,category:edited.category,image:edited.image,stock:15,price_cents:2100,sale_price_cents:1900,active:0});
  r=await s.request('/api/local-admin/products/1','PATCH',edited,{Cookie:cookie});assert.equal(r.status,409);
  r=await s.request('/api/local-admin/logout','POST',null,{Cookie:cookie});assert.equal(r.status,200);
  r=await s.request('/api/local-admin/products','POST',fields,{Cookie:cookie});assert.equal(r.status,401);
 }finally{await s.stop();}
});
test('creates a new product in the same table with a new id and no second product store',async()=>{
 const s=await server();try{
  const cookie=await login(s);
  const newProduct={name:'Roaster Test Blend',description:'A new local test product',category:'Coffee',image:'/assets/images/Pile_of_coffee_beans.jpeg',stock:12,price_cents:2400,sale_price_cents:1999,active:1};
  let r=await s.request('/api/local-admin/products','POST',newProduct,{Cookie:cookie});assert.equal(r.status,201);
  const data=await r.json();assert.equal(data.id,2);assert.equal(data.created,true);
  assert.deepEqual(s.pool.rows.find(r=>r.id===2),{id:2,...newProduct});
  r=await s.request('/api/local-admin/products','POST',{...newProduct,image:'https://bad.example/fake.jpg'},{Cookie:cookie});assert.equal(r.status,400);
  assert.equal(s.pool.rows.length,2);
 }finally{await s.stop();}
});
test('cross-origin requests cannot create, edit or log in',async()=>{
 const s=await server();try{
  let r=await s.request('/api/local-admin/login','POST',{password:goodPassword},{Origin:'http://evil.example'});
  assert.equal(r.status,403);
  const cookie=await login(s);
  r=await s.request('/api/local-admin/products','POST',fields,{Origin:'http://evil.example',Cookie:cookie});assert.equal(r.status,403);
  r=await s.request('/api/local-admin/products/1','PATCH',edit,{Origin:'http://evil.example',Cookie:cookie});assert.equal(r.status,403);
  r=await s.request('/api/local-admin/products','POST',fields,{Cookie:cookie,'X-Coffee-Dev':'0'});assert.equal(r.status,403);
  assert.equal(s.pool.rows.length,1);
  assert.equal(s.pool.rows[0].stock,7);
 }finally{await s.stop();}
});
test('local preview never serves server-side source or private files',()=>{
 assert.equal(staticAllowed('admin/index.html'),true);
 assert.equal(staticAllowed('admin/admin.js'),true);
 assert.equal(staticAllowed('assets/css/main.css'),true);
 assert.equal(staticAllowed('backend/.env'),false);
 assert.equal(staticAllowed('backend/src/config/db.js'),false);
 assert.equal(staticAllowed('.git/config'),false);
 assert.equal(staticAllowed('admin/local-edit-api.js'),false);
 assert.equal(staticAllowed('admin/preview-server.js'),false);
});
