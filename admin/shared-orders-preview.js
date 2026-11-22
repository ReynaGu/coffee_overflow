'use strict';
/* Coffee Overflow — shared-order local READ-ONLY dashboard view. No writes. */
(() => {
  const $=(s,r=document)=>r.querySelector(s);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=c=>'$'+(Number(c||0)/100).toFixed(2);
  const stamp=v=>{const d=new Date(v);return Number.isNaN(+d)?'—':d.toLocaleString(undefined,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});};
  const state={tab:'overview',sort:'date-desc',status:'all',search:'',loggedIn:false};
  const notice=message=>$('#notice').textContent=message||'';
  const pill=status=>`<span class="pill ${esc(status)}">${esc(status)}</span>`;
  const stat=(name,val,detail,icon)=>`<article class="stat"><div class="stat-head"><span class="stat-label">${esc(name)}</span><span class="stat-icon">${icon}</span></div><strong>${esc(val)}</strong><small>${esc(detail)}</small></article>`;
  async function api(path, opts){
    const res=await fetch('/api/preview/'+path,{credentials:'same-origin',cache:'no-store',...opts});
    const data=await res.json();
    if(!res.ok)throw Error(data.error||'Request failed');
    return data;
  }
  const setLogin=s=>{$('#signin').hidden=s;$('#main-panel').hidden=!s;state.loggedIn=s;};
  async function refresh(){
    if(!state.loggedIn)return;
    notice('');$('#main-panel').textContent='Loading shared orders…';
    try {
      if(state.tab==='orders')await ordersView();else await overviewView();
    }catch(e){notice(e.message);$('#main-panel').innerHTML='<div class="panel empty">Unable to load shared order data.</div>';
      if(/access code/i.test(e.message))setLogin(false);
    }
  }
  async function overviewView(){
    const [s,data]=await Promise.all([api('stats'),api('orders?sort=date-desc')]);
    $('#nav-pending').textContent=s.pending;
    $('#main-panel').innerHTML=`<section class="stats">${stat('Total orders',s.orders,'Records in shared orders','▤')}${stat('Active orders',s.pending,'Placed or processing','◷')}${stat('Order value',money(s.revenue_cents),'Excludes cancelled; no payments','＄')}${stat('Low stock',s.low_stock,'Products with < 10 units','⚑')}</section>
    <section class="panel"><div class="panel-top"><div><h2>Recent shared orders</h2><small>Read-only data from integration schema</small></div><button class="text-button" data-tab="orders">View all →</button></div>
    ${table(data.orders.slice(0,10))}</section>`;
  }
  function table(rows){return `<div class="table-wrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Placed</th><th>Status</th><th>Total</th><th></th></tr></thead><tbody>${rows.map(o=>`<tr><td class="id">#${esc(o.id)}</td><td><strong>${esc(o.customer_name)}</strong><div class="muted">${esc(o.customer_email)}</div></td><td>${stamp(o.created_at)}</td><td>${pill(o.status)}</td><td>${money(o.total_cents)}</td><td><button class="action" data-open-order="${esc(o.id)}">View details →</button></td></tr>`).join('')||'<tr><td colspan="6" class="empty">No shared orders in this integration database yet.</td></tr>'}</tbody></table></div>`;}
  async function ordersView(){
    const q=new URLSearchParams({sort:state.sort,status:state.status,search:state.search});
    const data=await api('orders?'+q);
    $('#main-panel').innerHTML=`<div class="toolbar"><input class="field search" id="order-search" type="search" placeholder="Search order, customer, email…" value="${esc(state.search)}" aria-label="Search shared orders"><select class="field" id="order-status" aria-label="Filter orders">${[['all','All statuses'],['active','Active orders'],['placed','Placed'],['processing','Processing'],['fulfilled','Fulfilled'],['cancelled','Cancelled']].map(([v,t])=>`<option value="${v}" ${state.status===v?'selected':''}>${t}</option>`).join('')}</select><select class="field" id="order-sort" aria-label="Sort orders">${[['date-desc','Newest first'],['date-asc','Oldest first'],['customer-asc','Customer A–Z'],['customer-desc','Customer Z–A'],['total-desc','Highest total'],['total-asc','Lowest total']].map(([v,t])=>`<option value="${v}" ${state.sort===v?'selected':''}>${t}</option>`).join('')}</select></div><section class="panel"><div class="panel-top"><div><h2>Shared order history</h2><small>${data.count} matching records · Read only</small></div></div>${table(data.orders)}</section>`;
    $('#order-search').addEventListener('change',e=>{state.search=e.target.value;refresh();});
    $('#order-status').addEventListener('change',e=>{state.status=e.target.value;refresh();});
    $('#order-sort').addEventListener('change',e=>{state.sort=e.target.value;refresh();});
  }
  async function openOrder(id){
    try{
      const {order:o}=await api('orders/'+encodeURIComponent(id));
      const lines=o.items.map(x=>`<tr><td>${esc(x.product_name)}</td><td>${x.quantity}</td><td>${money(x.unit_price_cents)}</td><td>${money(x.line_total_cents)}</td></tr>`).join('');
      const events=o.events.map(x=>`<li><strong>${esc(x.to_status)}</strong><small>${esc(x.actor_name)} · ${stamp(x.created_at)}</small><span>${esc(x.note||'')}</span></li>`).join('');
      $('#modal').innerHTML=`<div class="overlay"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><header class="dialog-head"><h2 id="dialog-title">Order #${esc(o.id)}</h2><button class="close" id="close-modal" aria-label="Close">×</button></header><div class="dialog-body"><div class="detail-two"><div class="detail-box"><small>CUSTOMER</small><strong>${esc(o.customer_name)}</strong><span class="muted">${esc(o.customer_email)}</span></div><div class="detail-box"><small>ORDER STATUS</small>${pill(o.status)}<div class="muted">${stamp(o.created_at)}</div></div></div><h3 class="section-label">Purchased items</h3><div class="table-wrap"><table><thead><tr><th>Product</th><th>Qty</th><th>Unit price</th><th>Total</th></tr></thead><tbody>${lines}</tbody></table></div><div class="receipt-totals"><div><span>Subtotal</span><strong>${money(o.subtotal_cents)}</strong></div><div><span>Discount (not connected)</span><strong>—</strong></div><div><span>Tax</span><strong>${money(o.tax_cents)}</strong></div><div class="total"><span>Order total</span><strong>${money(o.total_cents)}</strong></div></div><div class="detail-bottom"><div><h3 class="section-label">Order activity</h3><ol class="timeline">${events||'<li>No events yet</li>'}</ol></div><div><h3 class="section-label">Read-only integration preview</h3><p class="muted">Order status updates are disabled in this viewer. Production admin authentication has not been connected.</p></div></div></div></div></div>`;
      $('#close-modal').focus();
    }catch(e){notice(e.message);}
  }
  $('#signin-form').addEventListener('submit',async e=>{e.preventDefault();notice('');const input=e.target.elements.code;try{await api('login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:input.value})});input.value='';setLogin(true);await refresh();}catch(err){notice(err.message);}});
  $('#refresh').addEventListener('click',refresh);
  $('#logout').addEventListener('click',async()=>{try{await api('logout',{method:'POST'});}finally{setLogin(false);$('#modal').textContent='';}});
  document.addEventListener('click',e=>{
    const tab=e.target.closest('[data-tab]');if(tab){state.tab=tab.dataset.tab;document.querySelectorAll('[data-tab]').forEach(n=>n.classList.toggle('active',n.dataset.tab===state.tab));$('#page-title').textContent=state.tab==='overview'?'Overview':'Orders';$('#breadcrumb').textContent=$('#page-title').textContent;refresh();return;}
    const btn=e.target.closest('[data-open-order]');if(btn){openOrder(btn.dataset.openOrder);return;}
    if(e.target.id==='close-modal'||e.target.classList.contains('overlay'))$('#modal').textContent='';
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape')$('#modal').textContent='';});
  api('session').then(s=>{setLogin(s.authenticated);if(s.authenticated)refresh();}).catch(()=>notice('Local preview server is unavailable.'));
})();
