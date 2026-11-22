'use strict';
/** Browser-only integration tester. Session cookie is HttpOnly; CSRF stays in memory. */
(()=>{
  const $=s=>document.querySelector(s);
  const status=$('#status'), product=$('#product'), place=$('#place'), receipt=$('#receipt');
  const tokenKey='co_integration_browser_order_token_v1';
  let csrf=null, authenticated=false, finished=false;
  const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function message(s,bad=false){status.textContent=s;status.classList.toggle('error',bad);}
  function signedIn(v,user){authenticated=v;$('#logout').disabled=!v;place.disabled=!v||!csrf||finished;
    $('#session').textContent=v?`Verified session: User #${user.id} (${user.role})${csrf?' — ready to checkout':' — sign in again to enable protected checkout'}`:'Not signed in';}
  async function api(url,options={}){
    const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});
    let data;try{data=await r.json();}catch{data={error:'Unexpected response from server'};}
    if(!r.ok)throw Error(data.error||`HTTP ${r.status}`);
    return data;
  }
  function body(b){return {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)};}
  const email=`co-browser-${crypto.randomUUID().replace(/-/g,'').slice(0,10)}@example.test`;
  $('#reg-email').value=email;$('#login-email').value=email;
  $('#register').addEventListener('submit',async event=>{
    event.preventDefault(); const values=Object.fromEntries(new FormData(event.currentTarget));
    try{const data=await api('/api/auth/register',body(values));$('#login-email').value=values.email;
      message(`Registered test Customer #${data.user.id}. Use your test password to sign in.`);
    }catch(err){message(err.message,true);}
  });
  $('#login').addEventListener('submit',async event=>{
    event.preventDefault();const values=Object.fromEntries(new FormData(event.currentTarget));
    try{const data=await api('/api/auth/login',body(values));csrf=data.csrfToken;signedIn(true,data.user);message('Signed in successfully. The browser has an HttpOnly session cookie.');}
    catch(err){csrf=null;signedIn(false);message(err.message,true);}
  });
  $('#logout').addEventListener('click',async()=>{
    try{await api('/api/auth/logout',{...body({}),headers:{'Content-Type':'application/json','X-Coffee-CSRF':csrf}});csrf=null;signedIn(false);message('Signed out; database session revoked.');}
    catch(err){message(err.message,true);}
  });
  async function loadProduct(){
    const data=await api('/api/integration/product');const p=data.product;
    if(data.order_exists && !localStorage.getItem(tokenKey)){finished=true;place.disabled=true;message('A fixture order already exists. Run the cleanup command before creating another.');}
    product.innerHTML=`<div class="preview-product"><div><strong>${escape(p.name)}</strong><small>Product #1 • ${p.stock} in stock • ${escape(p.description)}</small></div><div class="preview-price">$${(p.price_cents/100).toFixed(2)}</div></div>`;
  }
  place.addEventListener('click',async()=>{
    if(!authenticated||!csrf||finished)return;
    place.disabled=true;
    try{
      let token=localStorage.getItem(tokenKey);
      if(!token){token=crypto.randomUUID();localStorage.setItem(tokenKey,token);}
      const data=await api('/api/orders',{...body({items:[{product_id:1,quantity:1}],client_token:token}),headers:{'Content-Type':'application/json','X-Coffee-CSRF':csrf}});
      const o=data.order;finished=true;
      receipt.textContent=`Order #${o.order_id} saved to real MySQL. Total $${(o.total_cents/100).toFixed(2)}. ${o.replayed?'Prior order receipt replayed — no additional stock deducted.':'One item purchased — inventory deducted once.'} Leave this order for verification and then run the fixture cleanup command.`;
      message('Checkout successful. No payment was collected.');
      localStorage.removeItem(tokenKey);await loadProduct();
    }catch(err){message(err.message,true);place.disabled=false;}
  });
  (async()=>{
    try{await loadProduct();const s=await api('/api/auth/session');signedIn(s.authenticated,s.user);message('Local integration is online. Register your synthetic test account first.');}
    catch(err){message('The local integration server is unavailable: '+err.message,true);}
  })();
})();
