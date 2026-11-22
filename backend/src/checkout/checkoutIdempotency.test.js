'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {validateCheckoutToken,cartHash,claimCheckoutRequest,storeCheckoutReceipt}=require('./checkoutIdempotency');
const token='7e5490db-f326-4f13-901b-49f6bd23f32a';
const items=[{productId:1,quantity:1}];
function fakeDb(initial=null){
 let row=initial?structuredClone(initial):null;
 const commands=[];
 const conn={
   async execute(sql,args){
     commands.push(sql);
     if(sql.startsWith('INSERT INTO checkout_requests')){
       if(!row)row={user_id:args[1],request_hash:args[2],order_id:null,receipt_json:null};
       return [{affectedRows:1}];
     }
     if(sql.includes('FROM checkout_requests WHERE client_token'))return [[row?structuredClone(row):undefined].filter(Boolean)];
     if(sql.startsWith('UPDATE checkout_requests')){
       if(!row || row.order_id!==null)return [{affectedRows:0}];
       row.order_id=args[0];row.receipt_json=JSON.parse(args[1]);return [{affectedRows:1}];
     }
     throw new Error('Unexpected SQL: '+sql);
   },
 };
 return {conn,row:()=>row,commands};
}
test('checkout token requires a valid UUID',()=>{
 assert.equal(validateCheckoutToken(token.toUpperCase()),token);
 for(const bad of [null,'','testing','AAAA-1234',123,{},'00000000-0000-0000-0000-000000000000']){
   assert.throws(()=>validateCheckoutToken(bad),e=>e.status===400);
 }
});
test('cart hash is stable across product order but not quantities or user identity',()=>{
 const p=[{productId:1,quantity:1},{productId:2,quantity:3}];
 assert.equal(cartHash(7,p),cartHash(7,[...p].reverse()));
 assert.notEqual(cartHash(7,p),cartHash(7,[{productId:1,quantity:2},{productId:2,quantity:3}]));
 assert.notEqual(cartHash(7,p),cartHash(8,p));
});
test('first request claims token and receipt is recorded on the same SQL connection',async()=>{
 const f=fakeDb();const first=await claimCheckoutRequest(f.conn,{token,userId:7,items});
 assert.equal(first.replay,null);
 const receipt={order_id:13,total_cents:1949,items:[{product_id:1,quantity:1}]};
 await storeCheckoutReceipt(f.conn,first,receipt);
 assert.equal(f.row().order_id,13);
 assert.deepEqual(f.row().receipt_json,receipt);
 assert.ok(f.commands.some(q=>q.includes('ON DUPLICATE KEY')));
 assert.ok(f.commands.some(q=>q.includes('FOR UPDATE')));
});
test('same token + same shopper/cart replays the original receipt',async()=>{
 const f=fakeDb();const first=await claimCheckoutRequest(f.conn,{token,userId:7,items});
 const receipt={order_id:13,total_cents:1949};
 await storeCheckoutReceipt(f.conn,first,receipt);
 const replay=await claimCheckoutRequest(f.conn,{token,userId:7,items});
 assert.deepEqual(replay.replay,receipt);
});
test('same token cannot be reused for changed quantity or different user',async()=>{
 const f=fakeDb();const first=await claimCheckoutRequest(f.conn,{token,userId:7,items});
 await storeCheckoutReceipt(f.conn,first,{order_id:13});
 await assert.rejects(claimCheckoutRequest(f.conn,{token,userId:7,items:[{productId:1,quantity:2}]}),e=>e.status===409);
 await assert.rejects(claimCheckoutRequest(f.conn,{token,userId:8,items}),e=>e.status===409);
});
test('malformed saved receipt fails closed instead of creating a new order',async()=>{
 const f=fakeDb({user_id:7,request_hash:cartHash(7,items),order_id:13,receipt_json:'broken json'});
 await assert.rejects(claimCheckoutRequest(f.conn,{token,userId:7,items}),e=>e.status===500);
});
test('unexpected receipt id fails closed',async()=>{
 const f=fakeDb({user_id:7,request_hash:cartHash(7,items),order_id:13,receipt_json:JSON.stringify({order_id:99})});
 await assert.rejects(claimCheckoutRequest(f.conn,{token,userId:7,items}),e=>e.status===500);
});
