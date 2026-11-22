'use strict';
/** Opt-in localhost-only MySQL TEST checkout. Jalen's normal cart stays unchanged. */
(() => {
  const params=new URLSearchParams(location.search);
  if(params.get('orders')!=='local'||!['localhost','127.0.0.1'].includes(location.hostname))return;
  const cartRoot=document.getElementById('cart-root');
  if(!cartRoot)return;
  const style=document.createElement('style');
  style.textContent='button[data-act="place-order"]{display:none!important;}';
  document.head.appendChild(style);
  const host=document.createElement('section');
  host.className='border rounded bg-light p-4 mt-4 mb-5';
  host.setAttribute('aria-label','Local MySQL test checkout');
  cartRoot.insertAdjacentElement('afterend',host);
  function read(key,def){try{return JSON.parse(localStorage.getItem(key))??def;}catch{return def;}}
  const cart=read('co_cart',[]);
  const last=readSession('coffee_local_checkout_last');
  function readSession(key){try{return JSON.parse(sessionStorage.getItem(key));}catch{return null;}}
  const qty=Array.isArray(cart)?cart.reduce((n,i)=>n+Number(i.qty||0),0):0;
  host.innerHTML=`<h2 class="h4 mb-2">Local MySQL test checkout</h2>
    <p class="text-muted">This creates a <strong>test order</strong> in coffee_overflow_dev. No payment is collected or processed. The normal cart checkout remains a browser-only demo.</p>
    <div id="local-checkout-message" role="status" aria-live="polite"></div>
    ${qty>0?`<p><strong>${qty} item(s)</strong> in your cart. Final prices, tax, and inventory are verified by MySQL.</p>
      <form id="local-checkout-form" class="row g-3" novalidate>
        <div class="col-md-6"><label class="form-label" for="local-name">Test customer name</label><input id="local-name" name="name" class="form-control" required minlength="2" maxlength="120" value="Test Customer"></div>
        <div class="col-md-6"><label class="form-label" for="local-email">Test customer email</label><input id="local-email" name="email" class="form-control" type="email" required maxlength="254" value="test@example.test"></div>
        <div class="col-12"><button class="btn btn-primary" type="submit">Place MySQL test order (no payment)</button></div>
      </form>`: `<p>Your cart is empty. Add a product from <a href="products.html">the Products page</a> to make a new test order.</p>`}`;
  const msg=host.querySelector('#local-checkout-message');
  if(last){
    const id=Number(last.id);
    if(Number.isSafeInteger(id)&&id>0){
      const note=document.createElement('div');note.className='alert alert-success';
      note.textContent=`Test order #${id} saved to MySQL. Total: $${(Number(last.total_cents)/100).toFixed(2)}. Open your admin Orders tab to review it.`;
      msg.appendChild(note);
    }
    sessionStorage.removeItem('coffee_local_checkout_last');
  }
  const form=host.querySelector('#local-checkout-form');
  if(!form)return;
  form.addEventListener('submit',async e=>{
    e.preventDefault();
    const button=form.querySelector('button[type=submit]');
    if(button.disabled)return;
    const name=String(form.elements.name.value||'').trim();
    const email=String(form.elements.email.value||'').trim();
    msg.textContent='';
    if(name.length<2||!/^\S+@\S+\.\S+$/.test(email)){
      msg.textContent='Enter a test customer name and a valid test email.';return;
    }
    const code=localStorage.getItem('co_cart_code');
    if(code&&code!=='null'&&code!=='""'){
      msg.textContent='Remove your discount code in the cart before MySQL test checkout. Promo codes are not yet connected to the local order API.';return;
    }
    const lines=read('co_cart',[]);
    if(!Array.isArray(lines)||!lines.length){msg.textContent='Your cart is empty. Refresh and add a product.';return;}
    const items=lines.map(line=>({product_id:Number(line.id),quantity:Number(line.qty)}));
    if(items.some(i=>!Number.isSafeInteger(i.product_id)||!Number.isSafeInteger(i.quantity))){msg.textContent='Cart data is invalid. Remove the item and re-add it.';return;}
    const fingerprint=JSON.stringify({name,email,items});
    let retry=read('coffee_local_checkout_retry',null);
    if(!retry||retry.fingerprint!==fingerprint){
      retry={fingerprint,token:crypto.randomUUID()};
      localStorage.setItem('coffee_local_checkout_retry',JSON.stringify(retry));
    }
    button.disabled=true;
    try{
      const response=await fetch('/api/local-checkout/orders',{
        method:'POST',credentials:'same-origin',
        headers:{'Content-Type':'application/json','X-Coffee-Dev':'1'},
        body:JSON.stringify({customer_name:name,customer_email:email,client_token:retry.token,items})
      });
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||`Test order failed (${response.status})`);
      const order=result.order;
      if(!order||!Number.isSafeInteger(Number(order.id)))throw Error('Server returned an invalid test order receipt');
      localStorage.setItem('co_cart','[]');
      localStorage.removeItem('co_cart_code');
      localStorage.removeItem('coffee_local_checkout_retry');
      sessionStorage.setItem('coffee_local_checkout_last',JSON.stringify({id:order.id,total_cents:order.total_cents}));
      location.reload();
    }catch(err){
      msg.textContent=err.message||'MySQL test checkout failed. Your cart was not cleared.';
      button.disabled=false;
    }
  });
})();
