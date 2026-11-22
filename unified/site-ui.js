'use strict';
/* Adds a visible test-environment warning and account link to original pages. */
(()=>{
  const csrfKey='co_unified_csrf_v1';
  function tag(name,attrs,text){const e=document.createElement(name);for(const [key,value] of Object.entries(attrs||{}))e.setAttribute(key,value);if(text!==undefined)e.textContent=text;return e;}
  async function getSession(){const r=await fetch('/api/auth/session',{credentials:'same-origin',cache:'no-store'});if(!r.ok)throw Error('Session API unavailable');return r.json();}
  document.addEventListener('DOMContentLoaded',async()=>{
    const banner=tag('div',{role:'status',style:'background:#fff2cf;color:#45320c;padding:8px 16px;text-align:center;font:14px/1.4 sans-serif'},'LOCAL INTEGRATION TEST — synthetic accounts, one fixture coffee product, no payments');
    document.body.prepend(banner);
    const nav=document.querySelector('nav');
    if(!nav)return;
    const container=nav.querySelector('.d-flex.align-items-center.gap-4')||nav;
    const slot=tag('span',{style:'display:inline-flex;gap:12px;align-items:center;font-size:14px;'});
    const link=tag('a',{href:'/login.html'},'Account / Sign in');slot.appendChild(link);container.appendChild(slot);
    try{
      const session=await getSession();
      if(!session.authenticated){sessionStorage.removeItem(csrfKey);return;}
      link.textContent=`Signed in (${session.user.role})`;
      link.href='/login.html';
      if(session.user.role==='admin')slot.appendChild(tag('a',{href:'/integration/admin/'},'Admin'));
      const out=tag('button',{type:'button',style:'border:1px solid #444;padding:3px 8px;border-radius:4px;cursor:pointer'},'Sign out');
      out.addEventListener('click',async()=>{
        const csrf=sessionStorage.getItem(csrfKey);
        if(!csrf){window.location.assign('/login.html');return;}
        try{
          const res=await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Coffee-CSRF':csrf},body:'{}'});
          if(!res.ok)throw Error('Sign out failed');sessionStorage.removeItem(csrfKey);window.location.assign('/login.html');
        }catch{window.alert('Sign out failed. Please use the login page to sign in again.');}
      });
      slot.appendChild(out);
    }catch{link.textContent='Account (server unavailable)';}
  });
})();
