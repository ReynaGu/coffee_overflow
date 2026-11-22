'use strict';
/* Local, loopback-only admin UI. No raw session cookie access: HttpOnly.
 * CSRF stays in memory and is required for every status update or logout.
 * All permissions and transitions are checked again by the Express API.
 */
(()=>{
  const $=(s)=>document.querySelector(s);
  const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const money=n=>'$'+(Number(n||0)/100).toFixed(2);
  const stamp=v=>{const d=new Date(v);return Number.isNaN(d.getTime())?'—':d.toLocaleString();};
  const state={csrf:null,user:null,orderId:null};
  function notice(message,bad=false){const el=$('#message');el.textContent=message;el.classList.toggle('error',bad);}
  async function api(path,opts={}){
    const headers={Accept:'application/json',...(opts.headers||{})};
    const response=await fetch(path,{credentials:'same-origin',cache:'no-store',...opts,headers});
    let data;try{data=await response.json();}catch{data={error:'Unexpected HTTP response'};}
    if(!response.ok){const err=new Error(data.error||`HTTP ${response.status}`);err.status=response.status;throw err;}
    return data;
  }
  function visible(signedIn){$('#login-area').hidden=signedIn;$('#workspace').hidden=!signedIn;}
  const allowed=status=>status==='placed'?['processing','cancelled']:status==='processing'?['fulfilled','cancelled']:[];
  function stat(label,value){return `<div class="stat"><p>${esc(label)}</p><strong>${esc(value)}</strong></div>`;}
  function renderStats(s){
    $('#stats').innerHTML=stat('Total orders',s.orders)+stat('Active orders',s.pending)+stat('Fulfilled orders',s.fulfilled)+stat('Order value',money(s.revenue_cents));
  }
  function renderOrders(data){
    const lines=data.orders.map(o=>`<tr><td>#${esc(o.id)}</td><td>${esc(o.customer_name)}<div class="muted">${esc(o.customer_email)}</div></td><td>${esc(stamp(o.created_at))}</td><td><span class="pill ${esc(o.status)}">${esc(o.status)}</span></td><td>${esc(money(o.total_cents))}</td><td><button class="small-button" data-open-order="${esc(o.id)}" type="button">View details</button></td></tr>`).join('');
    $('#orders').innerHTML=`<table><thead><tr><th>Order</th><th>Customer</th><th>Placed</th><th>Status</th><th>Total</th><th></th></tr></thead><tbody>${lines||'<tr><td colspan="6" class="muted">No matching orders yet. Create one from the customer test shop.</td></tr>'}</tbody></table>`;
  }
  async function refresh(){
    try{
      const filter=$('#filter').value;
      const [stats,orders]=await Promise.all([api('/api/admin/stats'),api('/api/admin/orders?'+new URLSearchParams({status:filter,sort:'date-desc'}))]);
      renderStats(stats);renderOrders(orders);
      if(state.orderId)await openOrder(state.orderId);
      else notice('Connected to the protected shared-order API.');
    }catch(err){notice(err.message,true);if(err.status===401||err.status===403)visible(false);}
  }
  function renderDetails(o){
    const options=allowed(o.status);
    const items=(o.items||[]).map(x=>`<tr><td>${esc(x.product_name)}</td><td>${esc(x.quantity)}</td><td>${esc(money(x.unit_price_cents))}</td><td>${esc(money(x.line_total_cents))}</td></tr>`).join('');
    const events=(o.events||[]).map(x=>`<li><b>${esc(x.to_status)}</b> · ${esc(stamp(x.created_at))}<div class="muted">${esc(x.actor_name||'')} — ${esc(x.note||'')}</div></li>`).join('');
    $('#detail-content').innerHTML=`<div class="receipt-grid"><div class="receipt-card"><h3>Customer · Order #${esc(o.id)}</h3><p><strong>${esc(o.customer_name)}</strong></p><p>${esc(o.customer_email)}</p></div><div class="receipt-card"><h3>Current status</h3><p><span class="pill ${esc(o.status)}">${esc(o.status)}</span></p><p>${esc(stamp(o.created_at))}</p></div></div>
      <h3>Purchased items</h3><table class="line-items"><thead><tr><th>Product</th><th>Qty</th><th>Unit price</th><th>Total</th></tr></thead><tbody>${items}</tbody></table>
      <div class="money-row"><span>Subtotal</span><strong>${esc(money(o.subtotal_cents))}</strong></div>
      <div class="money-row"><span>Tax</span><strong>${esc(money(o.tax_cents))}</strong></div>
      <div class="money-row total-row"><span>Grand total</span><strong>${esc(money(o.total_cents))}</strong></div>
      <h3>Order activity</h3><ol class="timeline">${events}</ol>
      <div class="actions" id="status-actions">${options.length?`<label>Internal note (optional)<textarea id="admin-note" maxlength="250" placeholder="Reason or fulfillment note"></textarea></label>${options.map(next=>`<button type="button" data-next-status="${next}" class="${next==='cancelled'?'danger':'primary'}">${next==='processing'?'Mark Processing':next==='fulfilled'?'Mark Fulfilled':'Cancel order'}</button>`).join('')}`:'<p class="muted">This is a terminal order status. No further status changes are allowed.</p>'}</div>`;
    $('#details').hidden=false;
  }
  async function openOrder(id){
    try{
      const {order}=await api('/api/admin/orders/'+encodeURIComponent(id));
      state.orderId=Number(order.id);renderDetails(order);
    }catch(err){notice('Could not read order: '+err.message,true);}
  }
  async function changeStatus(next){
    if(!state.orderId||!state.csrf)return notice('Sign in as administrator again to restore request verification.',true);
    if(next==='cancelled'&&!window.confirm('Cancel this test order? MySQL will restore its stock exactly once.'))return;
    const note=$('#admin-note')?.value.trim()||'';
    try{
      const r=await api(`/api/admin/orders/${encodeURIComponent(state.orderId)}/status`,{
        method:'PATCH',headers:{'Content-Type':'application/json','X-Coffee-CSRF':state.csrf},
        body:JSON.stringify({status:next,note})
      });
      await refresh();
      notice(r.changed?`Order updated to ${next}. MySQL saved the activity event.`:`Order was already ${next}; no duplicate change recorded.`);
    }catch(err){notice('Status update blocked: '+err.message,true);}
  }
  $('#login-form').addEventListener('submit',async event=>{
    event.preventDefault();const loginForm=event.currentTarget;const form=new FormData(loginForm);
    try{
      const data=await api('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({email:form.get('email'),password:form.get('password')})});
      if(data.user?.role!=='admin'){
        // A customer login sets a cookie, but MUST NOT grant any admin UI access.
        state.user=null;state.csrf=null;visible(false);notice('That is a customer account; administrator access is required.',true);
        return;
      }
      state.user=data.user;state.csrf=data.csrfToken;state.orderId=null;
      $('#identity').textContent=`Administrator #${data.user.id} · verified server session`;
      loginForm.reset();visible(true);await refresh();
      notice('Administrator authenticated. Order changes are protected by CSRF verification.');
    }catch(err){notice('Sign-in failed: '+err.message,true);}
  });
  $('#logout').addEventListener('click',async()=>{
    try{await api('/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json','X-Coffee-CSRF':state.csrf},body:'{}'});
      state.csrf=null;state.user=null;state.orderId=null;visible(false);notice('Signed out. Database session revoked.');
    }catch(err){notice('Sign-out failed: '+err.message,true);}
  });
  $('#refresh').addEventListener('click',refresh);
  $('#filter').addEventListener('change',()=>{state.orderId=null;$('#details').hidden=true;refresh();});
  $('#orders').addEventListener('click',event=>{const btn=event.target.closest('[data-open-order]');if(btn)openOrder(btn.dataset.openOrder);});
  $('#detail-content').addEventListener('click',event=>{const btn=event.target.closest('[data-next-status]');if(btn)changeStatus(btn.dataset.nextStatus);});
  $('#close-details').addEventListener('click',()=>{state.orderId=null;$('#details').hidden=true;});
  visible(false);
  api('/api/auth/session').then(s=>{
    if(s.authenticated){notice(s.user.role==='admin'?'Existing administrator session found. Sign in again to obtain a fresh CSRF token.':'A customer session is active. Sign in using the synthetic administrator account.');}
  }).catch(()=>{});
})();
