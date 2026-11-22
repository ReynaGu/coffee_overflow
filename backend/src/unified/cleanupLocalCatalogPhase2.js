'use strict';
/** Strict Phase 2 teardown: only exact synthetic accounts, one catalog order and
 * the 19 temporary catalog rows. All changes are transactional. Any unexpected
 * order, price, product, stock, user/session, or sale causes rollback.
 */
const {exactAdminEmail,exactCustomerEmail}=require('../integration/adminVisualRules');
const {ITEMS,BY_ID,SALE_ID,SELECT_CATALOG,validateCatalog,expectedOrderAmounts,assert}=require('./catalogPhase2Data');
const {hiddenPrompt,makePool,verifyDb,verifyBaseWithCatalog,counts,expectNoActivity}=require('./catalogPhase2Db');
const {toCents}=require('../checkout/pricing');
function emailsFromArg(adminArg,shopArg){
  const admin=String(adminArg||'-').trim().toLowerCase();const customer=String(shopArg||'-').trim().toLowerCase();
  assert(admin==='-'||exactAdminEmail(admin),'invalid synthetic administrator email');
  assert(customer==='-'||exactCustomerEmail(customer),'invalid synthetic customer email');
  assert(admin!=='-'||customer==='-','cannot delete a customer without its test administrator');
  return {admin:admin==='-'?null:admin,customer:customer==='-'?null:customer};
}
async function cleanup(pool,adminEmail,customerEmail){
  const {admin,customer}=emailsFromArg(adminEmail,customerEmail);
  const conn=await pool.getConnection();
  try{
    await conn.beginTransaction();await verifyDb(conn);
    await verifyBaseWithCatalog(conn,{allowSold:true});
    const expectedEmails=[admin,customer].filter(Boolean);
    const [users]=expectedEmails.length?
      await conn.execute(`SELECT id,email FROM users WHERE email IN (${expectedEmails.map(()=>'?').join(',')}) FOR UPDATE`,expectedEmails):[[]];
    assert(users.length===expectedEmails.length,'one of the exact synthetic users is missing');
    const userIds=new Map(users.map(u=>[u.email,Number(u.id)]));
    for(const email of expectedEmails)assert(userIds.has(email),'synthetic user mismatch');
    const adminId=userIds.get(admin),customerId=userIds.get(customer);
    const [credentials]=await conn.query('SELECT user_id,role FROM auth_credentials FOR UPDATE');
    assert(credentials.length===expectedEmails.length,'unexpected authentication credentials');
    for(const cred of credentials){
      const id=Number(cred.user_id);
      if(id===adminId)assert(cred.role==='admin','administrator role mismatch');
      else if(id===customerId)assert(cred.role==='customer','customer role mismatch');
      else assert(false,'unrecognized authentication credential');
    }
    const [sessions]=await conn.query('SELECT user_id FROM auth_sessions FOR UPDATE');
    assert(sessions.every(s=>[adminId,customerId].includes(Number(s.user_id))),'unrecognized authentication session');
    const [orders]=await conn.query('SELECT order_id,user_id,status,subtotal,tax,total FROM orders FOR UPDATE');
    assert(orders.length<=1,'more than one order exists');
    const [claims]=await conn.query('SELECT order_id,user_id FROM checkout_requests FOR UPDATE');
    const [lines]=await conn.query('SELECT order_id,product_id,quantity,unit_price FROM order_items FOR UPDATE');
    const [events]=await conn.query('SELECT order_id,actor_user_id,from_status,to_status FROM order_events ORDER BY id ASC FOR UPDATE');
    const [products]=await conn.query(SELECT_CATALOG+' FOR UPDATE');
    validateCatalog(products,{allowSold:true});
    const purchased=new Map();
    let orderId=null,status=null;
    if(orders.length===1){
      const order=orders[0];orderId=Number(order.order_id);status=order.status;
      assert(Number.isSafeInteger(orderId)&&orderId>0,'invalid order id');
      assert(customerId!==undefined&&Number(order.user_id)===customerId,'order belongs to a different user');
      assert(['placed','processing','fulfilled','cancelled'].includes(status),'unrecognized order status');
      assert(claims.length===1&&Number(claims[0].order_id)===orderId&&Number(claims[0].user_id)===customerId,'checkout token record mismatch');
      assert(lines.length>=1&&lines.length<=3,'expected one to three order items');
      for(const item of lines){
        const id=Number(item.product_id),quantity=Number(item.quantity);
        assert(Number(item.order_id)===orderId&&BY_ID.has(id)&&!purchased.has(id),'unexpected order item');
        assert(Number.isSafeInteger(quantity)&&quantity>=1&&quantity<=3,'unexpected quantity');
        purchased.set(id,quantity);
      }
      const amounts=expectedOrderAmounts(lines);
      assert(toCents(order.subtotal)===amounts.subtotalCents&&toCents(order.tax)===amounts.taxCents&&toCents(order.total)===amounts.totalCents,'order receipt totals changed');
      assert(events.every(e=>Number(e.order_id)===orderId&&Number(e.actor_user_id)===adminId&&['processing','fulfilled','cancelled'].includes(e.to_status)),'unrecognized order events');
      const sequence=events.map(e=>e.to_status);
      if(status==='placed')assert(sequence.length===0,'unexpected activity for placed order');
      if(status==='processing')assert(sequence.length===1&&sequence[0]==='processing','unexpected activity for processing order');
      if(status==='fulfilled')assert(sequence.length===2&&sequence[0]==='processing'&&sequence[1]==='fulfilled','unexpected activity for fulfilled order');
      if(status==='cancelled')assert((sequence.length===1&&sequence[0]==='cancelled')||(sequence.length===2&&sequence[0]==='processing'&&sequence[1]==='cancelled'),'unexpected cancellation activity');
    }else assert(claims.length===0&&lines.length===0&&events.length===0,'orphan order records exist');
    const inventoryRestored=status!=='cancelled';
    for(const row of products){
      const id=Number(row.product_id),item=BY_ID.get(id);
      const expected=item.stock-(inventoryRestored?(purchased.get(id)||0):0);
      assert(Number(row.stock_quantity)===expected,'stock mismatch for product #'+id);
    }
    if(orderId!==null){
      if(inventoryRestored){
        for(const [id,quantity] of purchased){const item=BY_ID.get(id);
          const [changed]=await conn.execute('UPDATE products SET stock_quantity=? WHERE product_id=? AND stock_quantity=?',[item.stock,id,item.stock-quantity]);
          assert(changed.affectedRows===1,'inventory restoration failed for #'+id);
        }
      }
      await conn.execute('DELETE FROM order_events WHERE order_id=?',[orderId]);
      const [dl]=await conn.execute('DELETE FROM order_items WHERE order_id=?',[orderId]);assert(dl.affectedRows===lines.length,'order lines changed');
      const [dc]=await conn.execute('DELETE FROM checkout_requests WHERE order_id=?',[orderId]);assert(dc.affectedRows===1,'checkout claim changed');
      const [d]=await conn.execute('DELETE FROM orders WHERE order_id=? AND user_id=?',[orderId,customerId]);assert(d.affectedRows===1,'order changed during cleanup');
    }
    for(const email of expectedEmails){const id=userIds.get(email);
      await conn.execute('DELETE FROM auth_sessions WHERE user_id=?',[id]);
      const [cr]=await conn.execute('DELETE FROM auth_credentials WHERE user_id=?',[id]);assert(cr.affectedRows===1,'credentials changed');
      const [ur]=await conn.execute('DELETE FROM users WHERE id=? AND email=?',[id,email]);assert(ur.affectedRows===1,'account changed');
    }
    const [ds]=await conn.execute('DELETE FROM sale_items WHERE sale_id=? AND product_id=?',[SALE_ID,101]);assert(ds.affectedRows===1,'sale item changed');
    const [sale]=await conn.execute('DELETE FROM sales WHERE sale_id=?',[SALE_ID]);assert(sale.affectedRows===1,'sale changed');
    for(const item of ITEMS){const [d]=await conn.execute('DELETE FROM products WHERE product_id=? AND name=? AND price=? AND stock_quantity=?',[
      item.id,item.name,(item.price/100).toFixed(2),item.stock
    ]);assert(d.affectedRows===1,'catalog product changed during cleanup: #'+item.id);}
    const [remaining]=await conn.query('SELECT product_id,name,price,stock_quantity FROM products ORDER BY product_id');
    assert(remaining.length===1&&Number(remaining[0].product_id)===1&&Number(remaining[0].stock_quantity)===10,'not restored to original single-product fixture');
    const [[s]]=await conn.query('SELECT (SELECT COUNT(*) FROM sales) AS sales,(SELECT COUNT(*) FROM sale_items) AS sale_items');
    assert(Number(s.sales)===0&&Number(s.sale_items)===0,'sale records remain');
    expectNoActivity(await counts(conn));
    await conn.commit();return {removedOrder:orderId!==null,status};
  }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
}
async function main(){
  const {admin,customer}=emailsFromArg(process.argv[2],process.argv[3]);
  console.log('Phase 2 STRICT LOCAL CLEANUP — catalog IDs 101–119, one order, exact synthetic users.');
  console.log('Admin:',admin||'(none)');console.log('Customer:',customer||'(none)');
  const password=await hiddenPrompt('Restricted integration MySQL password (hidden): ');
  const pool=makePool(password);
  try{const result=await cleanup(pool,admin||'-',customer||'-');
    console.log(`SUCCESS: Removed 19 temporary products, their sale, ${result.removedOrder?'one '+result.status+' order':'no order'}, and specified synthetic users. Original fixture #1 stock 10, zero test activity.`);
  }finally{await pool.end();}
}
if(require.main===module)main().catch(e=>{console.error('CATALOG CLEANUP STOPPED:',e.message);process.exitCode=1;});
module.exports={cleanup,emailsFromArg};
