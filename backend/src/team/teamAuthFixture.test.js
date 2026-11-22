'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {
  TARGET,PRODUCT,FKS,ALL_EMPTY,assertWriterGrants,assertAccounts,assertCountsExactly,assertOrdersForCleanup
}=require('./teamAuthFixture');
const {allowCheckoutClaim}=require('./teamBoundedAuthenticatedApp');
const ADMIN='co-admin-abcdef123456@example.test',SHOP='co-browser-abcdef123456@example.test';
function grants(extra=[]){return [
  {'Grants for ...':"GRANT USAGE ON *.* TO `coffee_overflow_review_writer`@`127.0.0.1`"},
  {'Grants for ...':`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${TARGET.replace(/_/g,'\\_')}\`.* TO \`coffee_overflow_review_writer\`@\`127.0.0.1\``},
  ...extra
];}
function empty(){return Object.fromEntries(ALL_EMPTY.map(n=>[n,0]));}
function scenario(status=null){
  const adminId=31,customerId=32,oid=91;
  const receipt={order_id:oid,total_cents:1949,subtotal_cents:1800,tax_cents:149,
    items:[{product_id:PRODUCT.id,quantity:1,unit_price_cents:1800}]};
  const event=(to_status)=>({order_id:oid,actor_user_id:adminId,to_status});
  const eventSequences={placed:[],processing:['processing'],fulfilled:['processing','fulfilled'],cancelled:['processing','cancelled']};
  return {adminEmail:ADMIN,customerEmail:SHOP,
    users:[{id:0,email:''},{id:adminId,email:ADMIN},{id:customerId,email:SHOP}],
    credentials:[{user_id:adminId,role:'admin',is_active:1},{user_id:customerId,role:'customer',is_active:1}],
    sessions:[{user_id:adminId},{user_id:customerId}],
    products:[{product_id:PRODUCT.id,name:PRODUCT.name,price:'18.00',stock_quantity:status==='cancelled'||status===null?1:0,description:PRODUCT.description}],
    orders:status===null?[]:[{order_id:oid,user_id:customerId,status,subtotal:'18.00',tax:'1.49',total:'19.49'}],
    items:status===null?[]:[{order_id:oid,product_id:PRODUCT.id,quantity:1,unit_price:'18.00'}],
    claims:status===null?[]:[{order_id:oid,user_id:customerId,client_token:'12345678-1234-4123-8123-123456789abc',receipt_json:receipt}],
    events:status===null?[]:eventSequences[status].map(event)};
}
test('fixture binds to a single synthetic product and migrated review database',()=>{
  assert.equal(PRODUCT.id,601);assert.equal(PRODUCT.priceCents,1800);assert.equal(PRODUCT.stock,1);assert.equal(TARGET,'coffee_overflow_migration_review');
});
test('requires all four exact foreign keys',()=>{assert.equal(FKS.length,4);assert.equal(new Set(FKS).size,4);});
test('permits only schema-scoped SELECT INSERT UPDATE DELETE grants',()=>assert.equal(assertWriterGrants(grants()),true));
test('refuses unescaped underscores in database grant (possible wildcard scope)',()=>{
  const broad=grants()[1]['Grants for ...'].replace(/\\_/g,'_');
  assert.throws(()=>assertWriterGrants([grants()[0],{'Grants for ...':broad}]),/grant applies outside disposable schema/);
});
test('refuses escaped and unescaped schema grants together',()=>{
  const broad=grants()[1]['Grants for ...'].replace(/\\_/g,'_');
  assert.throws(()=>assertWriterGrants(grants([{'Grants for ...':broad}])),/grant applies outside disposable schema/);
});
test('refuses duplicate grants even if each is correctly escaped',()=>{
  assert.throws(()=>assertWriterGrants(grants([grants()[1]])),/duplicate schema privilege grant/);
});
test('refuses unrelated database grants even when escaped',()=>{
  const unrelated=grants()[1]['Grants for ...'].replace('coffee\\_overflow\\_migration\\_review','some\\_other\\_schema');
  assert.throws(()=>assertWriterGrants(grants([{'Grants for ...':unrelated}])),/grant applies outside disposable schema/);
});
test('refuses global ALL and data-modification privileges',()=>{
  assert.throws(()=>assertWriterGrants([{'Grants for ...':'GRANT ALL PRIVILEGES ON *.* TO `x`@`127.0.0.1`'}]));
});
test('refuses GRANT OPTION',()=>assert.throws(()=>assertWriterGrants([...grants(),{'Grants for ...':`GRANT SELECT ON \`${TARGET}\`.* TO \`x\`@\`127.0.0.1\` WITH GRANT OPTION`}])));
test('refuses access to another database',()=>assert.throws(()=>assertWriterGrants([...grants(),{'Grants for ...':'GRANT SELECT ON `coffee_overflow_dev`.* TO `x`@`127.0.0.1`'}])));
test('refuses missing CRUD privileges',()=>assert.throws(()=>assertWriterGrants([grants()[0],{'Grants for ...':`GRANT SELECT, INSERT ON \`${TARGET}\`.* TO \`x\`@\`127.0.0.1\``}])));
test('accepts only original user zero in unseeded sandbox',()=>{
  assert.deepEqual([...assertAccounts([{id:0,email:''}]).entries()],[['',0]]);
});
test('rejects unexpected users before a seed',()=>assert.throws(()=>assertAccounts([{id:0,email:''},{id:2,email:ADMIN}])));
test('accepts only exact admin and customer identities',()=>{
  const ids=assertAccounts([{id:0,email:''},{id:31,email:ADMIN},{id:32,email:SHOP}],ADMIN,SHOP);
  assert.equal(ids.get(ADMIN),31);assert.equal(ids.get(SHOP),32);
});
test('rejects unexpected table rows',()=>{
  assert.doesNotThrow(()=>assertCountsExactly(empty()));
  assert.throws(()=>assertCountsExactly({...empty(),orders:1}));
});
test('rejects an unknown original product',()=>{
  const s=scenario();s.products[0].name='Different product';assert.throws(()=>assertOrdersForCleanup(s),/test product/);
});
test('accepts admin-only seed before any customer registered',()=>{
  const s=scenario();s.customerEmail=null;s.users=s.users.slice(0,2);s.credentials=s.credentials.slice(0,1);s.sessions=s.sessions.slice(0,1);
  const x=assertOrdersForCleanup(s);assert.equal(x.orderId,null);
});
test('validates placed order and deducted inventory',()=>assert.equal(assertOrdersForCleanup(scenario('placed')).status,'placed'));
test('validates processed order and the audit trail',()=>assert.equal(assertOrdersForCleanup(scenario('processing')).status,'processing'));
test('validates fulfilled order and the audit trail',()=>assert.equal(assertOrdersForCleanup(scenario('fulfilled')).status,'fulfilled'));
test('validates cancelled order with restored inventory',()=>assert.equal(assertOrdersForCleanup(scenario('cancelled')).status,'cancelled'));
test('refuses fulfilled stock restored without cancellation',()=>{
  const s=scenario('fulfilled');s.products[0].stock_quantity=1;
  assert.throws(()=>assertOrdersForCleanup(s),/inventory/);
});
test('refuses a second order',()=>{
  const s=scenario('placed');s.orders.push({...s.orders[0],order_id:92});
  assert.throws(()=>assertOrdersForCleanup(s),/too many orders/);
});
test('refuses unauthorized audit actor',()=>{
  const s=scenario('fulfilled');s.events[0].actor_user_id=32;
  assert.throws(()=>assertOrdersForCleanup(s),/actor/);
});
test('refuses forged saved checkout receipt',()=>{
  const s=scenario('fulfilled');s.claims[0].receipt_json.total_cents=1;
  assert.throws(()=>assertOrdersForCleanup(s),/receipt/);
});
test('only first checkout token and its exact retries are permitted',()=>{
  assert.equal(allowCheckoutClaim([],'abc'),true);
  assert.equal(allowCheckoutClaim([{client_token:'abc'}],'abc'),true);
  assert.equal(allowCheckoutClaim([{client_token:'abc'}],'different'),false);
  assert.throws(()=>allowCheckoutClaim([{client_token:'a'},{client_token:'b'}],'a'));
});
