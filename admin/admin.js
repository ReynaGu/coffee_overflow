'use strict';
/* Coffee Overflow — Hudson admin module. No edits to other people's pages.
 * Default: isolated SAMPLE preview. Add ?live=1 to use real /api/admin endpoints.
 */
(()=>{
 const qs=(s,root=document)=>root.querySelector(s);
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=v=>`$${(Number(v||0)/100).toFixed(2)}`;
 const date=v=>{const d=new Date(v);return Number.isNaN(+d)?'—':d.toLocaleString(undefined,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});};
 const state={tab:'overview',sort:'date-desc',status:'all',search:'',products:[],users:[],coupons:[],orders:[],stats:{},dialogId:null};
 const query=new URL(location.href).searchParams;
 const live=query.get('live')==='1';
 const editableProducts=query.get('products')==='editable' && !live;
 const liveProducts=['live','editable'].includes(query.get('products')) && !live;
 const endpoint=async(path,options={})=>{
  if(!live){
    if(liveProducts && path.split('?')[0]==='/api/admin/products' && (!options.method || options.method==='GET')){
      return window.CoffeeAdminProductBridge.listFromTeamApi(fetch, location.hostname);
    }
    const devProductPath=path.replace('/api/admin/products','/api/local-admin/products');
    const isProductCreate=path==='/api/admin/products'&&options.method==='POST';
    const isProductEdit=/^\/api\/admin\/products\/\d+$/.test(path)&&options.method==='PATCH';
    if(editableProducts && (isProductCreate||isProductEdit)){
      let r;try{r=await fetch(devProductPath,{
        method:options.method,credentials:'same-origin',headers:{'Content-Type':'application/json','X-Coffee-Dev':'1'},body:JSON.stringify(options.body)
      });}catch{throw Error('Local admin product service is unavailable. Restart your preview server.');}
      let result;try{result=await r.json();}catch{throw Error('Local admin product service returned an invalid response');}
      if(!r.ok)throw Error(result.error||`Local edit failed (${r.status})`);
      return result;
    }
    if(liveProducts&&(isProductCreate||isProductEdit))throw Error('This product operation is not allowed in read-only mode.');
    return window.CoffeeAdminDemo.request(path,options);
  }
  let response;
  try{response=await fetch(path,{method:options.method||'GET',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:options.body===undefined?undefined:JSON.stringify(options.body)});}
  catch{throw Error('Cannot reach the team API. Check that Express is running.');}
  let data;try{data=await response.json();}catch{throw Error('The server did not return JSON. Is the admin router mounted?');}
  if(!response.ok)throw Error(data.error||`Request failed (${response.status})`);
  return data;
 };
 const devRequest=async(method,path,body)=>{
  let r;
  try{r=await fetch('/api/local-admin/'+path,{method,credentials:'same-origin',
    headers:{'Content-Type':'application/json','X-Coffee-Dev':'1'},body:body?JSON.stringify(body):undefined});}
  catch{throw Error('Local admin edit service is not running. Restart preview after configuring .env.');}
  let result;try{result=await r.json();}catch{throw Error('Local admin edit service is not enabled. Check your .env settings.');}
  if(!r.ok)throw Error(result.error||'Local admin request failed');
  return result;
 };
 const tabs={overview:['Overview',"A clear view of your shop's operations."],orders:['Orders','Review, filter, and fulfill customer orders.'],products:['Inventory','Update your product catalog and available stock.'],coupons:['Discounts','Create and manage promotional codes.'],users:['Customers','Manage customer information from one place.']};
 const button=(title,action,extra='')=>`<button class="action" data-action="${action}" ${extra}>${title}</button>`;
 const pill=s=>`<span class="pill ${esc(s)}">${esc(s?.charAt(0).toUpperCase()+s?.slice(1))}</span>`;
 function showNotice(text){qs('#notice').textContent=text||'';}
 function panel(html){qs('#main-panel').innerHTML=html;}
 function renderShell(){
  qs('#page-title').textContent=tabs[state.tab][0];qs('#breadcrumb').textContent=tabs[state.tab][0];qs('#page-description').textContent=tabs[state.tab][1];
  document.querySelectorAll('[data-tab]').forEach(el=>el.classList.toggle('active',el.dataset.tab===state.tab));
  qs('#reset-demo').hidden=live;
  qs('#connection-indicator').textContent=live?'● Live API mode':editableProducts?'● Local MySQL · development edits':liveProducts?'● Local MySQL products · read-only':'● Preview / sample data';qs('#connection-indicator').classList.toggle('live',live||liveProducts);
 }
 function statsCard(label,value,detail,icon){return `<article class="stat"><div class="stat-head"><span class="stat-label">${label}</span><span class="stat-icon">${icon}</span></div><strong>${value}</strong><small>${detail}</small></article>`;}
 async function showOverview(){
  const [stats,orders,products]=await Promise.all([endpoint('/api/admin/stats'),endpoint('/api/admin/orders?sort=date-desc'),endpoint('/api/admin/products')]);
  state.stats=stats;state.orders=orders.orders;state.products=products.products;
  qs('#nav-pending').textContent=stats.pending;
  const low=state.products.filter(x=>x.active&&x.stock<10);
  panel(`<div class="${live?'notice-box':'notice-box preview-note'}">${live?'Live admin view: data is retrieved through the protected team API.':editableProducts?'LOCAL DEVELOPMENT EDIT — Inventory and low-stock alerts read Isaac\'s API / MySQL. New products and edits to names, descriptions, stock, prices, sales, and visibility use the protected LOCAL edit service. This is not production admin login. Orders, discounts and customers remain sample data.':liveProducts?'LOCAL PRODUCT TEST — Inventory and low-stock alerts read from Isaac\'s product API / MySQL. Products are READ-ONLY here. Orders, discounts, customer accounts and order metrics remain browser sample data.':'PREVIEW MODE — This dashboard uses editable sample data in your browser only. It is not connected to your teammates\' checkout or MySQL database. Switch to ?products=live to view local MySQL products in read-only mode.'}</div>
    <section class="stats">
     ${statsCard('Total orders',stats.orders,'Recorded orders','▤')}${statsCard('Active orders',stats.pending,'Awaiting fulfillment','◷')}
     ${statsCard('Order revenue',money(stats.revenue_cents),'Excluding cancelled orders','＄')}${statsCard('Low stock',liveProducts?low.length:stats.low_stock,liveProducts?'Local MySQL products under 10 units':'Products under 10 units','⚑')}
    </section>
    <div class="dashboard-grid">
     <article class="panel"><div class="panel-top"><div><h2>Recent orders</h2><small>Latest customer purchases</small></div><button class="text-button" data-tab="orders">View all →</button></div><div class="table-wrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Status</th><th>Total</th><th></th></tr></thead><tbody>${state.orders.slice(0,6).map(o=>`<tr><td class="id">#${esc(o.id)}</td><td><strong>${esc(o.customer_name)}</strong></td><td>${pill(o.status)}</td><td><strong>${money(o.total_cents)}</strong></td><td>${button('View →','open-order',`data-id="${o.id}"`)}</td></tr>`).join('')||'<tr><td colspan="5">No orders yet.</td></tr>'}</tbody></table></div></article>
     <article class="panel"><div class="panel-top"><div><h2>Inventory alerts</h2><small>Items needing attention</small></div><button class="text-button" data-tab="products">All products →</button></div><div class="alerts">${low.map(p=>`<div class="alert-row"><div><div class="alert-name">${esc(p.name)}</div><span class="muted">${esc(p.category)}</span></div><span class="alert-qty">${p.stock} left</span></div>`).join('')||'<p class="empty">Inventory levels look good.</p>'}</div></article>
    </div>`);
 }
 function orderQuery(){const p=new URLSearchParams({sort:state.sort,status:state.status,search:state.search});return '/api/admin/orders?'+p.toString();}
 async function showOrders(){
  const result=await endpoint(orderQuery());state.orders=result.orders;
  panel(`<div class="toolbar"><input id="order-search" class="field search" type="search" value="${esc(state.search)}" placeholder="Search by order #, name, email…" aria-label="Search orders">
      <select id="order-status" class="field" aria-label="Filter by status">${[['all','All statuses'],['active','Active orders'],['placed','Placed'],['processing','Processing'],['fulfilled','Fulfilled'],['cancelled','Cancelled']].map(([v,t])=>`<option value="${v}" ${state.status===v?'selected':''}>${t}</option>`).join('')}</select>
      <select id="order-sort" class="field" aria-label="Sort orders">${[['date-desc','Newest first'],['date-asc','Oldest first'],['customer-asc','Customer A–Z'],['customer-desc','Customer Z–A'],['total-desc','Highest total'],['total-asc','Lowest total']].map(([v,t])=>`<option value="${v}" ${state.sort===v?'selected':''}>${t}</option>`).join('')}</select></div>
    <section class="panel"><div class="panel-top"><div><h2>Order history</h2><small>${result.count} matching orders</small></div></div><div class="table-wrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Placed</th><th>Status</th><th>Total</th><th></th></tr></thead><tbody>${result.orders.map(o=>`<tr><td class="id">#${esc(o.id)}</td><td><strong>${esc(o.customer_name)}</strong><br><span class="muted">${esc(o.customer_email)}</span></td><td>${date(o.created_at)}</td><td>${pill(o.status)}</td><td><strong>${money(o.total_cents)}</strong></td><td>${button('View details →','open-order',`data-id="${o.id}"`)}</td></tr>`).join('')||'<tr><td colspan="6" class="empty">No orders match this filter.</td></tr>'}</tbody></table></div></section>`);
 }
 async function showProducts(){
  const d=await endpoint('/api/admin/products');state.products=d.products;
  const modeText=editableProducts?'LOCAL DEVELOPMENT — add and edit MySQL products with a separate local admin password.':liveProducts?'LOCAL MYSQL PRODUCTS — read-only. Changes in Workbench appear after Refresh.':'Edit stock, regular pricing, and sale prices.';
  panel(`<div class="toolbar"><span class="muted">${modeText}</span><span style="flex:1"></span>${editableProducts?'<button class="btn" data-action="new-product">+ New product</button><button class="btn subtle" data-action="dev-logout">Sign out (local)</button>':liveProducts?'':'<button class="btn" data-action="new-product">+ New product</button>'}</div><div class="panel"><div class="panel-top"><div><h2>Products & inventory</h2><small>${d.products.length} records</small></div></div><div class="table-wrap"><table><thead><tr><th>Product</th><th>Price</th><th>Sale</th><th>Stock</th><th>Visible</th><th></th></tr></thead><tbody>${d.products.map(p=>`<tr><td><div class="product-name"><span class="product-icon">☕</span><div><strong>${esc(p.name)}</strong><br><span class="muted">${esc(p.category)}</span></div></div></td><td>${money(p.price_cents)}</td><td>${p.sale_price_cents===null?'—':money(p.sale_price_cents)}</td><td>${p.stock<10?'<span class="alert-qty">':''}${p.stock}${p.stock<10?'</span>':''}</td><td>${p.active?'Yes':'Hidden'}</td><td>${liveProducts&&!editableProducts?'<span class="muted">Read only</span>':button('Edit →','edit-product',`data-id="${p.id}"`)}</td></tr>`).join('')}</tbody></table></div></div>`);
 }
 async function showCoupons(){const d=await endpoint('/api/admin/coupons');state.coupons=d.coupons;panel(`<div class="toolbar"><span class="muted">Discount codes used by the checkout system.</span><span style="flex:1"></span><button class="btn" data-action="new-coupon">+ Create discount</button></div><div class="panel"><div class="panel-top"><h2>Discount codes</h2></div><div class="table-wrap"><table><thead><tr><th>Code</th><th>Amount</th><th>Minimum</th><th>Used</th><th>Active</th><th></th></tr></thead><tbody>${d.coupons.map(c=>`<tr><td><strong>${esc(c.code)}</strong></td><td>${c.type==='percent'?`${c.amount}%`:money(c.amount)}</td><td>${money(c.min_subtotal_cents)}</td><td>${c.used_count||0}${c.usage_limit?` / ${c.usage_limit}`:''}</td><td>${c.active?'Yes':'No'}</td><td>${button('Edit →','edit-coupon',`data-id="${c.id}"`)}</td></tr>`).join('')}</tbody></table></div></div>`);}
 async function showUsers(){const d=await endpoint('/api/admin/users');state.users=d.users;panel(`<div class="panel"><div class="panel-top"><div><h2>Customer accounts</h2><small>Edit customer contact details. Passwords are never shown.</small></div></div><div class="table-wrap"><table><thead><tr><th>Customer</th><th>Email</th><th>Role</th><th>Joined</th><th></th></tr></thead><tbody>${d.users.map(u=>`<tr><td><strong>${esc(u.name)}</strong></td><td>${esc(u.email)}</td><td>${esc(u.role)}</td><td>${date(u.created_at)}</td><td>${button('Edit →','edit-user',`data-id="${u.id}"`)}</td></tr>`).join('')}</tbody></table></div></div>`);}
 async function reload(){renderShell();showNotice('');panel('<div class="loading">Loading…</div>');try{await ({overview:showOverview,orders:showOrders,products:showProducts,coupons:showCoupons,users:showUsers})[state.tab]();}catch(e){panel(`<div class="panel empty"><h2>Cannot load ${esc(state.tab)}</h2><p>${esc(e.message)}</p><p>${liveProducts?'Local products mode requires the existing Express backend on localhost:3000 and your MySQL database connection.':'Live mode requires the admin router, shared database tables, and a valid administrator session.'}</p></div>`);}}
 function dialog(content,title){qs('#modal').innerHTML=`<div class="overlay"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><header class="dialog-head"><h2 id="dialog-title">${title}</h2><button class="close" data-action="close-modal" aria-label="Close dialog">×</button></header><div class="dialog-body">${content}</div></div></div>`;qs('.dialog button')?.focus();}
 async function openOrder(id){
  const {order:o}=await endpoint(`/api/admin/orders/${id}`),allowed={placed:['processing','cancelled'],processing:['fulfilled','cancelled'],fulfilled:[],cancelled:[]}[o.status]||[];
  const lines=o.items.map(x=>`<tr><td>${esc(x.product_name)}</td><td>${x.quantity}</td><td>${money(x.unit_price_cents)}</td><td>${money(x.line_total_cents)}</td></tr>`).join('');
  const events=o.events.map(x=>`<li><strong>${esc(x.to_status)}</strong><small>${esc(x.actor_name||'System')} · ${date(x.created_at)}</small><span>${esc(x.note||'')}</span></li>`).join('');
  dialog(`<div class="detail-two"><div class="detail-box"><small>CUSTOMER</small><strong>${esc(o.customer_name)}</strong><span class="muted">${esc(o.customer_email)}</span></div><div class="detail-box"><small>ORDER STATUS</small>${pill(o.status)}<div class="muted" style="margin-top:9px">${date(o.created_at)}</div></div></div>
   <h3 class="section-label">Purchased items</h3><div class="table-wrap"><table><thead><tr><th>Product</th><th>Qty</th><th>Unit price</th><th>Total</th></tr></thead><tbody>${lines}</tbody></table></div>
   <div class="receipt-totals"><div><span>Subtotal</span><strong>${money(o.subtotal_cents)}</strong></div><div><span>Discount ${o.coupon_code?`(${esc(o.coupon_code)})`:''}</span><strong>−${money(o.discount_cents)}</strong></div><div><span>Texas tax (8.25%)</span><strong>${money(o.tax_cents)}</strong></div><div class="total"><span>Grand total</span><strong>${money(o.total_cents)}</strong></div></div>
   <div class="detail-bottom"><div><h3 class="section-label">Order activity</h3><ol class="timeline">${events||'<li>No history available</li>'}</ol></div><div><h3 class="section-label">Fulfillment actions</h3>${allowed.length?`<form class="stack" id="status-form" data-id="${o.id}"><label>Next status<select class="field" name="status">${allowed.map(s=>`<option value="${s}">${s}</option>`).join('')}</select></label><label>Internal note<textarea class="field" name="note" rows="3" maxlength="250" placeholder="Optional note…"></textarea></label><button class="btn" type="submit">Save status update</button></form>`:'<div class="notice-box">This order is final. No further changes are allowed.</div>'}</div></div>`,`Order #${esc(o.id)}`);
 }
 const formInput=(label,name,value='',type='text',extra='')=>`<label>${label}<input class="field" type="${type}" name="${name}" value="${esc(value)}" ${extra}></label>`;
 function showLocalLogin(productId){
  state.pendingProductId=productId;
  dialog(`<form class="stack" id="local-login-form"><p class="notice-box">This password protects only your local <strong>coffee_overflow_dev</strong> test database. It is not the team's production login.</p>
   <label>Local development admin password<input type="password" name="password" class="field" required autocomplete="off" minlength="12" autofocus></label>
   <div class="form-actions"><button class="btn" type="submit">Sign in for local edits</button></div></form>`, 'Local admin sign-in');
  qs('input[name="password"]',qs('#modal'))?.focus();
 }
 function formDialog(group,item){
  let html='';
  if(group==='product' && editableProducts){
    html=`<form class="stack" id="product-form" data-id="${item?.id||''}"><p class="notice-box">LOCAL TEST DATABASE only. Use an image file already in <strong>assets/images</strong>. No upload feature yet. The team storefront still needs a frontend connection to show newly added products.</p><div class="form-grid">
     ${formInput('Product name','name',item?.name||'','text','required minlength="2" maxlength="120"')}
     ${formInput('Category','category',item?.category||'Coffee','text','required maxlength="50"')}
     <label class="full">Description<textarea class="field" name="description" rows="3" maxlength="1200">${esc(item?.description||'')}</textarea></label>
     ${formInput('Existing image path','image',item?.image||'/assets/images/Pile_of_coffee_beans.jpeg','text','required maxlength="255"')}
     ${formInput('Stock quantity','stock',item?.stock??0,'number','min="0" step="1" max="1000000" required')}
     ${formInput('Regular price ($)','price',((item?.price_cents??1800)/100).toFixed(2),'number','min="0.01" step="0.01" required')}
     ${formInput('Sale price ($; optional)','sale',item?.sale_price_cents==null?'':(item.sale_price_cents/100).toFixed(2),'number','min="0.01" step="0.01"')}
     <label>Visible<select class="field" name="active"><option value="1" ${item?.active!==0?'selected':''}>Yes</option><option value="0" ${item?.active===0?'selected':''}>No</option></select></label>
     </div><div class="form-actions"><button class="btn" type="submit">${item?'Save local MySQL changes':'Create product in local MySQL'}</button></div></form>`;
  }
  else if(group==='product')html=`<form class="stack" id="product-form" data-id="${item?.id||''}"><div class="form-grid">${formInput('Product name','name',item?.name,'text','required minlength="2" maxlength="120"')}${formInput('Category','category',item?.category||'Coffee')}
   <label class="full">Description<textarea class="field" name="description" rows="3">${esc(item?.description||'')}</textarea></label>${formInput('Image path','image',item?.image||'/assets/images/Pile_of_coffee_beans.jpeg','text','required')}${formInput('Stock quantity','stock',item?.stock??0,'number','min="0" step="1" required')}${formInput('Regular price ($)','price',((item?.price_cents||1800)/100).toFixed(2),'number','min="0.01" step="0.01" required')}${formInput('Sale price ($; optional)','sale',item?.sale_price_cents==null?'':(item.sale_price_cents/100).toFixed(2),'number','min="0.01" step="0.01"')}
   <label>Visible<select class="field" name="active"><option value="1" ${item?.active!==0?'selected':''}>Yes</option><option value="0" ${item?.active===0?'selected':''}>No</option></select></label></div><div class="form-actions"><button class="btn" type="submit">Save product</button></div></form>`;
  if(group==='coupon')html=`<form class="stack" id="coupon-form" data-id="${item?.id||''}"><div class="form-grid">${formInput('Coupon code','code',item?.code||'','text','required')}
  <label>Type<select name="type" class="field"><option ${item?.type!=='fixed'?'selected':''} value="percent">Percentage</option><option ${item?.type==='fixed'?'selected':''} value="fixed">Fixed dollars</option></select></label>${formInput('Amount (% or $)','amount',item?item.type==='fixed'?(item.amount/100).toFixed(2):item.amount:10,'number','required min="0.01" step="0.01"')}${formInput('Minimum order ($)','minimum',((item?.min_subtotal_cents||0)/100).toFixed(2),'number','min="0" step="0.01"')}${formInput('Usage limit (optional)','limit',item?.usage_limit||'','number','min="1" step="1"')}<label>Active<select class="field" name="active"><option value="1" ${item?.active!==0?'selected':''}>Yes</option><option value="0" ${item?.active===0?'selected':''}>No</option></select></label></div><div class="form-actions"><button class="btn">Save discount</button></div></form>`;
  if(group==='user')html=`<form class="stack" id="user-form" data-id="${item.id}">${formInput('Customer name','name',item.name,'text','required minlength="2"')}${formInput('Email','email',item.email,'email','required')}<div class="notice-box">User roles and passwords cannot be changed here. That requires a separate security approval.</div><div class="form-actions"><button class="btn">Save customer</button></div></form>`;
  dialog(html,item?.id?`Edit ${group}`:`New ${group}`);
 }
 document.addEventListener('click',async e=>{
  const btn=e.target.closest('button');if(!btn)return;
  try{
   if(btn.dataset.tab){state.tab=btn.dataset.tab;qs('.sidebar').classList.remove('open');await reload();return;}
   if(btn.id==='mobile-menu'){qs('.sidebar').classList.toggle('open');return;}
   if(btn.id==='refresh'){await reload();return;}
   if(btn.id==='reset-demo'){if(!live&&confirm('Reset sample admin data to the original preview?')){CoffeeAdminDemo.reset();await reload();}return;}
   if(btn.dataset.action==='close-modal'){qs('#modal').innerHTML='';return;}
   if(btn.dataset.action==='open-order'){await openOrder(Number(btn.dataset.id));return;}
   if(btn.dataset.action==='dev-logout'){
     await devRequest('POST','logout');showNotice('Signed out of local development editing.');return;
   }
   if(btn.dataset.action==='new-product'||btn.dataset.action==='edit-product'){
     if(liveProducts&&!editableProducts)throw Error('Local MySQL products are read-only in this mode.');
     const isNew=btn.dataset.action==='new-product';
     const item=isNew?undefined:state.products.find(p=>p.id===Number(btn.dataset.id));
     if(!isNew&&!item)throw Error('Product not found; refresh Inventory.');
     if(editableProducts){
       let r;try{r=await fetch('/api/local-admin/session',{credentials:'same-origin'});}catch{throw Error('Local edit service unavailable; restart preview server.');}
       if(r.status===401){showLocalLogin(item?.id??null);return;}
       if(!r.ok)throw Error('Local edit service is not enabled; check backend/.env.');
     }
     formDialog('product',item);return;
   }
   if(btn.dataset.action==='new-coupon'||btn.dataset.action==='edit-coupon'){const item=state.coupons.find(c=>c.id===Number(btn.dataset.id));formDialog('coupon',item);return;}
   if(btn.dataset.action==='edit-user'){formDialog('user',state.users.find(u=>u.id===Number(btn.dataset.id)));return;}
  }catch(error){showNotice(error.message);}
 });
 document.addEventListener('change',e=>{if(e.target.id==='order-sort'){state.sort=e.target.value;reload();}else if(e.target.id==='order-status'){state.status=e.target.value;reload();}});
 let delay;document.addEventListener('input',e=>{if(e.target.id==='order-search'){state.search=e.target.value;clearTimeout(delay);delay=setTimeout(()=>reload(),400);}});
 document.addEventListener('submit',async e=>{
  if(!['local-login-form','status-form','product-form','coupon-form','user-form'].includes(e.target.id))return;
  e.preventDefault();const f=e.target,d=Object.fromEntries(new FormData(f));
  const id=Number(f.dataset.id);const close=()=>qs('#modal').innerHTML='';
  try{
   if(f.id==='local-login-form'){
     await devRequest('POST','login',{password:d.password});
     const product=state.pendingProductId===null?undefined:state.products.find(x=>x.id===state.pendingProductId);
     state.pendingProductId=null;
     formDialog('product',product);
     return;
   }
   if(f.id==='status-form'){
    if(d.status==='cancelled'&&!confirm('Cancel order? This will restore stock.'))return;
    await endpoint(`/api/admin/orders/${id}/status`,{method:'PATCH',body:{status:d.status,note:d.note}});
    close();await reload();await openOrder(id);
   }
   if(f.id==='product-form'){
    if(editableProducts){
      const prior=id?state.products.find(x=>x.id===id):null;
      if(id&&!prior)throw Error('Product changed; refresh the Inventory tab');
      const body={name:d.name,description:d.description,category:d.category,image:d.image,
        stock:Number(d.stock),price_cents:Math.round(Number(d.price)*100),
        sale_price_cents:d.sale?Math.round(Number(d.sale)*100):null,active:d.active==='1'?1:0};
      if(prior)body.expected={name:prior.name,description:prior.description,category:prior.category,image:prior.image,
        stock:prior.stock,price_cents:prior.price_cents,sale_price_cents:prior.sale_price_cents,active:prior.active?1:0};
      await endpoint(id?`/api/admin/products/${id}`:'/api/admin/products',{method:id?'PATCH':'POST',body});
      close();await reload();showNotice(`Local MySQL product ${id?'updated':'created'}. Refresh /api/products to verify.`);
    }else{
      const body={name:d.name,description:d.description,category:d.category,image:d.image,stock:Number(d.stock),price_cents:Math.round(Number(d.price)*100),sale_price_cents:d.sale?Math.round(Number(d.sale)*100):null,active:d.active==='1'};
      await endpoint(id?`/api/admin/products/${id}`:'/api/admin/products',{method:id?'PATCH':'POST',body});close();await reload();
    }
   }
   if(f.id==='coupon-form'){
    const body={code:d.code.toUpperCase(),type:d.type,amount:d.type==='fixed'?Math.round(Number(d.amount)*100):Number(d.amount),min_subtotal_cents:Math.round(Number(d.minimum)*100),usage_limit:d.limit?Number(d.limit):null,active:d.active==='1'};
    await endpoint(id?`/api/admin/coupons/${id}`:'/api/admin/coupons',{method:id?'PATCH':'POST',body});close();await reload();
   }
   if(f.id==='user-form'){
    await endpoint(`/api/admin/users/${id}`,{method:'PATCH',body:{name:d.name,email:d.email}});close();await reload();
   }
  }catch(error){showNotice(error.message);}
 });
 document.addEventListener('keydown',e=>{if(e.key==='Escape')qs('#modal').innerHTML='';});
 qs('#modal').addEventListener('click',e=>{if(e.target.classList.contains('overlay'))qs('#modal').innerHTML='';});
 reload();
})();
