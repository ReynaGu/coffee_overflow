'use strict';
/* SAMPLE DATA ONLY. Browser-localStorage demo for the team walkthrough.
   This NEVER reads or writes the Coffee Overflow team database. */
window.CoffeeAdminDemo = (() => {
 const STORAGE='coffee_overflow_hudson_admin_preview_v1';
 const now='2026-11-11T10:00:00.000Z';
 const seed=()=>({
   products:[
    {id:1,name:'Sunrise House Blend',description:'Balanced, smooth everyday coffee.',category:'Coffee',image:'/assets/images/Pile_of_coffee_beans.jpeg',price_cents:1800,sale_price_cents:null,stock:32,active:1},
    {id:2,name:'Midnight Espresso',description:'Bold roasted espresso with cocoa notes.',category:'Coffee',image:'/assets/images/espresso_machine.jpeg',price_cents:2200,sale_price_cents:1899,stock:6,active:1},
    {id:3,name:'Colombia Single Origin',description:'A bright coffee with caramel sweetness.',category:'Coffee',image:'/assets/images/Pile_of_coffee_beans.jpeg',price_cents:2400,sale_price_cents:null,stock:15,active:1},
    {id:4,name:'Cold Brew Kit',description:'Simple at-home cold brew equipment.',category:'Gear',image:'/assets/images/espresso_machine.jpeg',price_cents:3200,sale_price_cents:null,stock:3,active:1}
   ],
   users:[{id:7,name:'Morgan Lee',email:'morgan@example.test',role:'customer',created_at:now},{id:8,name:'Avery Brooks',email:'avery@example.test',role:'customer',created_at:now},{id:9,name:'Taylor Chen',email:'taylor@example.test',role:'customer',created_at:now}],
   coupons:[{id:1,code:'WELCOME10',type:'percent',amount:10,min_subtotal_cents:0,usage_limit:100,used_count:2,active:1},{id:2,code:'COFFEE5',type:'fixed',amount:500,min_subtotal_cents:2000,usage_limit:30,used_count:1,active:1}],
   orders:[
     {id:1042,user_id:7,customer_name:'Morgan Lee',customer_email:'morgan@example.test',status:'placed',subtotal_cents:4400,discount_cents:440,tax_cents:327,total_cents:4287,coupon_code:'WELCOME10',created_at:'2026-11-10T15:20:00Z',items:[{product_id:2,product_name:'Midnight Espresso',quantity:2,unit_price_cents:2200,line_total_cents:4400}],events:[{from_status:null,to_status:'placed',actor_name:'Checkout',note:'Order placed',created_at:'2026-11-10T15:20:00Z'}]},
     {id:1043,user_id:8,customer_name:'Avery Brooks',customer_email:'avery@example.test',status:'processing',subtotal_cents:4200,discount_cents:0,tax_cents:347,total_cents:4547,coupon_code:null,created_at:'2026-11-09T11:10:00Z',items:[{product_id:1,product_name:'Sunrise House Blend',quantity:1,unit_price_cents:1800,line_total_cents:1800},{product_id:3,product_name:'Colombia Single Origin',quantity:1,unit_price_cents:2400,line_total_cents:2400}],events:[{from_status:'placed',to_status:'processing',actor_name:'Admin Preview',note:'Packed for shipment',created_at:'2026-11-09T13:10:00Z'},{from_status:null,to_status:'placed',actor_name:'Checkout',note:'Order placed',created_at:'2026-11-09T11:10:00Z'}]},
     {id:1044,user_id:9,customer_name:'Taylor Chen',customer_email:'taylor@example.test',status:'fulfilled',subtotal_cents:3200,discount_cents:0,tax_cents:264,total_cents:3464,coupon_code:null,created_at:'2026-11-08T09:00:00Z',items:[{product_id:4,product_name:'Cold Brew Kit',quantity:1,unit_price_cents:3200,line_total_cents:3200}],events:[{from_status:'processing',to_status:'fulfilled',actor_name:'Admin Preview',note:'Completed',created_at:'2026-11-08T17:00:00Z'},{from_status:'placed',to_status:'processing',actor_name:'Admin Preview',note:'Packed',created_at:'2026-11-08T10:00:00Z'},{from_status:null,to_status:'placed',actor_name:'Checkout',note:'Order placed',created_at:'2026-11-08T09:00:00Z'}]}
   ]
 });
 const clone=v=>JSON.parse(JSON.stringify(v));
 function load(){try{const d=JSON.parse(localStorage.getItem(STORAGE));if(d&&Array.isArray(d.orders)&&Array.isArray(d.products))return d;}catch{}return seed();}
 function save(d){localStorage.setItem(STORAGE,JSON.stringify(d));}
 const invalid=(m)=>{throw Error(m);};
 function listOrders(d,p){const allowed={'date-desc':(a,b)=>new Date(b.created_at)-new Date(a.created_at),'date-asc':(a,b)=>new Date(a.created_at)-new Date(b.created_at),'customer-asc':(a,b)=>a.customer_name.localeCompare(b.customer_name),'customer-desc':(a,b)=>b.customer_name.localeCompare(a.customer_name),'total-asc':(a,b)=>a.total_cents-b.total_cents,'total-desc':(a,b)=>b.total_cents-a.total_cents};let orders=[...d.orders];if(p.status==='active')orders=orders.filter(o=>['placed','processing'].includes(o.status));else if(p.status&&p.status!=='all')orders=orders.filter(o=>o.status===p.status);if(p.search){const q=p.search.toLowerCase();orders=orders.filter(o=>[o.id,o.customer_name,o.customer_email].some(v=>String(v).toLowerCase().includes(q)));}orders.sort(allowed[p.sort]||allowed['date-desc']);return {orders,count:orders.length};}
 async function request(route,{method='GET',body}={}){
   const d=load(),url=new URL(route,location.origin),p=url.searchParams;
   if(method==='GET'&&url.pathname==='/api/admin/stats')return {orders:d.orders.length,pending:d.orders.filter(o=>['placed','processing'].includes(o.status)).length,fulfilled:d.orders.filter(o=>o.status==='fulfilled').length,revenue_cents:d.orders.filter(o=>o.status!=='cancelled').reduce((s,o)=>s+o.total_cents,0),low_stock:d.products.filter(x=>x.active&&x.stock<10).length};
   if(method==='GET'&&url.pathname==='/api/admin/orders')return listOrders(d,{sort:p.get('sort'),status:p.get('status'),search:p.get('search')});
   if(method==='GET'&&/^\/api\/admin\/orders\/\d+$/.test(url.pathname)){const o=d.orders.find(x=>x.id===Number(url.pathname.split('/')[4]));if(!o)invalid('Order not found');return {order:clone(o)};}
   if(method==='PATCH'&&/^\/api\/admin\/orders\/\d+\/status$/.test(url.pathname)){
      const o=d.orders.find(x=>x.id===Number(url.pathname.split('/')[4]));if(!o)invalid('Order not found');
      const allowed={placed:['processing','cancelled'],processing:['fulfilled','cancelled'],fulfilled:[],cancelled:[]};const next=body?.status;
      if(o.status===next)return {ok:true,changed:false};
      if(!allowed[o.status]?.includes(next))invalid('This order status change is not allowed');
      if(next==='cancelled'){for(const item of o.items){const pr=d.products.find(x=>x.id===item.product_id);if(pr)pr.stock+=item.quantity;}if(o.coupon_code){const c=d.coupons.find(c=>c.code===o.coupon_code);if(c)c.used_count=Math.max(0,c.used_count-1);}}
      const prev=o.status;o.status=next;o.events.unshift({from_status:prev,to_status:next,note:String(body?.note||'').slice(0,250),actor_name:'Admin Preview',created_at:new Date().toISOString()});save(d);return {ok:true,changed:true,status:next};
   }
   for(const [segment,key] of [['products','products'],['users','users'],['coupons','coupons']]){
     if(url.pathname===`/api/admin/${segment}` && method==='GET')return {[key]:clone(d[key])};
     if(url.pathname===`/api/admin/${segment}` && method==='POST'){
       const next={...body,id:Math.max(0,...d[key].map(x=>x.id))+1,active:body.active?1:0};if(segment==='coupons')next.used_count=0;d[key].unshift(next);save(d);return {ok:true,id:next.id};
     }
     if(url.pathname.startsWith(`/api/admin/${segment}/`) && method==='PATCH'){
       const id=Number(url.pathname.split('/')[4]);const row=d[key].find(x=>x.id===id);if(!row)invalid('Record not found');Object.assign(row,body);save(d);return {ok:true,id};
     }
   }
   invalid(`Demo endpoint not available: ${method} ${url.pathname}`);
 }
 return {request,reset(){localStorage.removeItem(STORAGE);},seed};
})();
