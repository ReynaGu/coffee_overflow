'use strict';
/* Synthetic-account-only local integration. Raw session cookie is HttpOnly.
 * A tab-scoped CSRF token is stored to allow navigation from login to cart. */
(()=>{
  const key='co_unified_csrf_v1';
  const $=sel=>document.querySelector(sel);
  const message=(txt,bad=false)=>{$('#message').textContent=txt;$('#message').classList.toggle('bad',bad);};
  const body=value=>({method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
  async function api(url,opts){const response=await fetch(url,{credentials:'same-origin',cache:'no-store',...opts});let data;try{data=await response.json();}catch{data={error:'Invalid server response'};}if(!response.ok)throw Error(data.error||'HTTP '+response.status);return data;}
  async function session(){const data=await api('/api/auth/session');$('#signed-in').hidden=!data.authenticated;$('#signed-in-status').textContent=data.authenticated?`Signed in as ${data.user.role} (User #${data.user.id}). If checkout says verification is missing, sign in again.`:'';return data;}
  const initialEmail='co-browser-'+crypto.randomUUID().replace(/-/g,'').slice(0,10)+'@example.test';
  $('#reg-email').value=initialEmail;$('#login-email').value=initialEmail;
  $('#register-form').addEventListener('submit',async event=>{
    event.preventDefault();const form=event.currentTarget;const fields=Object.fromEntries(new FormData(form));
    try{const r=await api('/api/auth/register',body(fields));$('#login-email').value=fields.email;message(`Registered test customer #${r.user.id}. Enter your test password in the Sign in form.`);}
    catch(e){message(e.message,true);}
  });
  $('#login-form').addEventListener('submit',async event=>{
    event.preventDefault();const form=event.currentTarget;const fields=Object.fromEntries(new FormData(form));
    try{const r=await api('/api/auth/login',body(fields));
      if(r.user?.role!=='customer'){sessionStorage.removeItem(key);message('Use a synthetic customer account here; administrator sign-in is separate.',true);return;}
      sessionStorage.setItem(key,r.csrfToken);form.reset();message('Customer signed in. You can now browse products and check out.');await session();
    }catch(e){sessionStorage.removeItem(key);message(e.message,true);}
  });
  $('#logout').addEventListener('click',async()=>{
    try{const csrf=sessionStorage.getItem(key);if(!csrf)throw Error('Please sign in again to obtain a CSRF token');
      await api('/api/auth/logout',{...body({}),headers:{'Content-Type':'application/json','X-Coffee-CSRF':csrf}});
      sessionStorage.removeItem(key);await session();message('Signed out; server session revoked.');
    }catch(e){message(e.message,true);}
  });
  session().catch(e=>message('Account API unavailable: '+e.message,true));
})();
