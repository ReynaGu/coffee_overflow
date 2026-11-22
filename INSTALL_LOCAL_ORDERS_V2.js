'use strict';
/* Coffee Overflow local TEST orders v1 installer. Must run from repository root.
   Only patches admin JS/server and cart.html on Hudson's feature branch.
   Backups live in OS temp, outside Git; no team main branch, database or .env touched. */
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=__dirname;
const allowedBranch='ref: refs/heads/feature/hudson-admin-order-management';
function fail(s){throw Error(s);}
function ensure(test,s){if(!test)fail(s);}
function once(source,needle,replacement,file){
 const first=source.indexOf(needle);
 ensure(first>=0,`${file}: expected original code not found: ${needle.slice(0,75)}`);
 ensure(source.indexOf(needle,first+needle.length)===-1,`${file}: repeated source anchor`);
 return source.slice(0,first)+replacement+source.slice(first+needle.length);
}
const paths=[
 'admin/local-edit-api.js','admin/preview-server.js','admin/admin.js','cart.html'
];
const extra=[
 'admin/local-order-store.js','assets/js/local-test-checkout.js',
 'docs/sql/LOCAL_DEV_ORDERS_V2.sql'
];
function run(){
 const head=path.join(root,'.git','HEAD');
 ensure(fs.existsSync(path.join(root,'coffee_overflow.sql'))&&fs.existsSync(path.join(root,'db_connection.php')),
   'Reyna database files are missing. First merge and push the latest main commits into your feature branch.');
 const teamSql=fs.readFileSync(path.join(root,'coffee_overflow.sql'),'utf8');
 ensure(teamSql.includes('CREATE TABLE `orders`')&&teamSql.includes('CREATE TABLE `products`'),
   'Team schema files are unexpected; do not install until schema is reviewed.');
 ensure(fs.existsSync(head),'Run this in your cloned coffee_overflow Git repository, not the extracted ZIP folder.');
 ensure(fs.readFileSync(head,'utf8').trim()===allowedBranch,'Switch to feature/hudson-admin-order-management in GitHub Desktop first. Never run on main.');
 for(const f of [...paths,...extra])ensure(fs.existsSync(path.join(root,f)),`Missing ${f}; copy the ZIP contents to the main repository first.`);
 const sources=Object.fromEntries(paths.map(f=>[f,fs.readFileSync(path.join(root,f),'utf8')]));
 for(const [f,c] of Object.entries(sources))ensure(!c.includes('COFFEE_LOCAL_ORDERS_V1')&&!c.includes('COFFEE_LOCAL_ORDERS_V2'),`${f} already contains a local orders patch. No changes made.`);
 const next={...sources};
 const EOL=next['admin/local-edit-api.js'].includes('\r\n')?'\r\n':'\n';
 next['admin/local-edit-api.js']=once(next['admin/local-edit-api.js'],
   "const crypto = require('node:crypto');",
   "const crypto = require('node:crypto');"+EOL+"const {createLocalOrderStore}=require('./local-order-store'); // COFFEE_LOCAL_ORDERS_V2",
   'admin/local-edit-api.js');
 next['admin/local-edit-api.js']=once(next['admin/local-edit-api.js'],
   '  const sessions=new Map(),failures=new Map();',
   '  const sessions=new Map(),failures=new Map();'+EOL+'  const orderStore=createLocalOrderStore(pool);',
   'admin/local-edit-api.js');
 const apiRoutes=`      // LOCAL TEST checkout. Not payment processing; never expose this outside localhost.
      if(req.method==='POST'&&p==='/api/local-checkout/orders'){
        checkOrigin(req);
        return json(res,201,await orderStore.createOrder(await bodyJson(req,16384)));
      }
      if(req.method==='GET'&&p==='/api/local-admin/stats'){
        if(!authed(req))throw fail(401,'Sign in to local development admin first');
        return json(res,200,await orderStore.stats());
      }
      if(req.method==='GET'&&p==='/api/local-admin/orders'){
        if(!authed(req))throw fail(401,'Sign in to local development admin first');
        return json(res,200,await orderStore.listOrders({sort:u.searchParams.get('sort')||'date-desc',status:u.searchParams.get('status')||'all',search:u.searchParams.get('search')||''}));
      }
      const orderId=p.match(/^\\/api\\/local-admin\\/orders\\/(\\d+)$/);
      if(req.method==='GET'&&orderId){
        if(!authed(req))throw fail(401,'Sign in to local development admin first');
        return json(res,200,{order:await orderStore.getOrder(Number(orderId[1]))});
      }
      const statusId=p.match(/^\\/api\\/local-admin\\/orders\\/(\\d+)\\/status$/);
      if(req.method==='PATCH'&&statusId){
        checkOrigin(req);
        if(!authed(req))throw fail(401,'Sign in to local development admin first');
        return json(res,200,await orderStore.updateStatus(Number(statusId[1]),await bodyJson(req)));
      }
`.replace(/\n/g,EOL);
 // Template literal uses escaped regex slashes because this is source code being injected.
 next['admin/local-edit-api.js']=once(next['admin/local-edit-api.js'],
 "      return json(res,404,{error:'Local development API route not found'});",
 apiRoutes+"      return json(res,404,{error:'Local development API route not found'});",
 'admin/local-edit-api.js');
 next['admin/preview-server.js']=once(next['admin/preview-server.js'],
   "if(url.pathname.startsWith('/api/local-admin/')){",
   "if(url.pathname.startsWith('/api/local-admin/')||url.pathname.startsWith('/api/local-checkout/')){ // COFFEE_LOCAL_ORDERS_V2",
   'admin/preview-server.js');
 const admin='admin/admin.js';
 next[admin]=once(next[admin],
  " const endpoint=async(path,options={})=>{",
  " const localOrders=!live&&editableProducts&&query.get('orders')==='local'; // COFFEE_LOCAL_ORDERS_V2"+EOL+` const endpoint=async(path,options={})=>{
  if(localOrders && (path==='/api/admin/stats'||/^\\/api\\/admin\\/orders(?:\\/|\\?|$)/.test(path))){
   const method=options.method||'GET';
   if(!['GET','PATCH'].includes(method))throw Error('Unsupported local order operation');
   let r;try{r=await fetch(path.replace('/api/admin/','/api/local-admin/'),{
     method,credentials:'same-origin',headers:{'Content-Type':'application/json','X-Coffee-Dev':'1'},
     body:options.body===undefined?undefined:JSON.stringify(options.body)
   });}catch{throw Error('Local order service is offline. Restart the admin preview server.');}
   let payload;try{payload=await r.json();}catch{throw Error('Local order API returned an invalid response. Create the local_dev_* tables first.');}
   if(r.status===401)throw Error('LOCAL_ORDER_LOGIN_REQUIRED');
   if(!r.ok)throw Error(payload.error||'Local order request failed');
   return payload;
  }`.replace(/\n/g,EOL),admin);
 next[admin]=once(next[admin],
  "qs('#connection-indicator').classList.toggle('live',live||liveProducts);",
  "qs('#connection-indicator').classList.toggle('live',live||liveProducts);"+EOL+
  "  if(localOrders){qs('#connection-indicator').textContent='● Local MySQL · TEST orders + inventory';qs('#reset-demo').hidden=true;}",admin);
 next[admin]=once(next[admin],
  'Orders, discounts and customers remain sample data.',
  "Orders are saved in local MySQL only when orders=local (TEST mode, no payment). Discounts and customers remain sample data.",admin);
 next[admin]=once(next[admin],
  'catch(e){panel(`<div class="panel empty"><h2>Cannot load ${esc(state.tab)}</h2>',
  `catch(e){if(localOrders&&e.message==='LOCAL_ORDER_LOGIN_REQUIRED'){panel('<div class="panel empty"><h2>Local MySQL orders sign-in</h2><p>Use the same protected local development admin password as Inventory.</p><button class="btn" data-action="local-orders-login">Sign in to view test orders</button></div>');return;}panel(\`<div class="panel empty"><h2>Cannot load \${esc(state.tab)}</h2>`,admin);
 next[admin]=once(next[admin],
  ' function showLocalLogin(productId){',
  ` function showLocalOrdersLogin(){dialog('<form class="stack" id="local-order-login-form"><p class="notice-box">These are LOCAL TEST orders stored in coffee_overflow_dev. No payments are processed.</p><label>Local development admin password<input type="password" name="password" class="field" required minlength="12" autocomplete="off"></label><div class="form-actions"><button class="btn" type="submit">Sign in</button></div></form>','Local MySQL test orders');}
 function showLocalLogin(productId){`.replace(/\n/g,EOL),admin);
 next[admin]=once(next[admin],
  "   if(btn.dataset.action==='close-modal'){qs('#modal').innerHTML='';return;}",
  "   if(btn.dataset.action==='close-modal'){qs('#modal').innerHTML='';return;}"+EOL+
  "   if(btn.dataset.action==='local-orders-login'){showLocalOrdersLogin();return;}",admin);
 next[admin]=once(next[admin],
  "['local-login-form','status-form','product-form','coupon-form','user-form']",
  "['local-login-form','local-order-login-form','status-form','product-form','coupon-form','user-form']",admin);
 next[admin]=once(next[admin],
  "   if(f.id==='local-login-form'){",
  "   if(f.id==='local-order-login-form'){await devRequest('POST','login',{password:d.password});close();await reload();return;}"+EOL+"   if(f.id==='local-login-form'){",admin);
 next['cart.html']=once(next['cart.html'],
  '<script src="./assets/js/cart.js"></script>',
  '<script src="./assets/js/cart.js"></script>'+EOL+'  <script src="./assets/js/local-test-checkout.js" defer></script> <!-- COFFEE_LOCAL_ORDERS_V2 -->',
  'cart.html');
 // Backups outside repo. Validate all source anchors first, then write.
 const backup=fs.mkdtempSync(path.join(os.tmpdir(),'coffee_overflow_local_orders_'));
 for(const f of paths){fs.writeFileSync(path.join(backup,path.basename(f)),sources[f],'utf8');}
 const written=[];
 try{for(const f of paths){fs.writeFileSync(path.join(root,f),next[f],'utf8');written.push(f);}}
 catch(e){for(const f of written)fs.writeFileSync(path.join(root,f),sources[f],'utf8');throw e;}
 console.log('SUCCESS: Local MySQL TEST checkout (V2) and admin Orders integration installed on the feature branch.');
 console.log('Modified: '+paths.join(', '));
 console.log('Backups (outside Git): '+backup);
 console.log('NEXT: Run docs/sql/LOCAL_DEV_ORDERS_V2.sql in MySQL Workbench, restart preview on port 5174.');
 console.log('No payments, production backend, main branch, or secrets were changed.');
}
if(require.main===module){try{run();}catch(e){console.error('INSTALL STOPPED: '+e.message);process.exitCode=1;}}
module.exports={run};
