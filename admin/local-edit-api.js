'use strict';
/* Local, development-only admin stock/price updater. Never mount in a deployed app.
 * Does NOT replace the production requireAdmin middleware or Isaac's backend.
 */
const crypto = require('node:crypto');

function json(res,status,data,headers={}){
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});
  res.end(JSON.stringify(data));
}
function fail(status,msg){ const e=new Error(msg);e.status=status;return e; }
function parseCookie(req,name){
  const c=String(req.headers.cookie||'').split(';').map(s=>s.trim());
  const match=c.find(s=>s.startsWith(name+'='));return match?match.slice(name.length+1):'';
}
async function bodyJson(req,limit=4096){
  if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))throw fail(415,'JSON request required');
  let size=0,raw='';
  for await (const chunk of req){size+=chunk.length;if(size>limit)throw fail(413,'Request body too large');raw+=chunk;}
  try{const d=JSON.parse(raw);if(!d||Array.isArray(d)||typeof d!=='object')throw Error();return d;}
  catch{throw fail(400,'Invalid JSON body');}
}
function isCents(v,minimum=0){return Number.isSafeInteger(v)&&v>=minimum&&v<=100000000;}
function validateEdit(b){
  if(!b||typeof b!=='object')throw fail(400,'Missing product changes');
  if(!Number.isSafeInteger(b.stock)||b.stock<0||b.stock>1000000)throw fail(400,'Invalid stock');
  if(!isCents(b.price_cents,1))throw fail(400,'Invalid regular price');
  if(b.sale_price_cents!==null && (!isCents(b.sale_price_cents,1)||b.sale_price_cents>=b.price_cents))throw fail(400,'Sale price must be below regular price');
  if(b.active!==0&&b.active!==1)throw fail(400,'Active must be zero or one');
  if(!b.expected||typeof b.expected!=='object')throw fail(400,'Expected prior product values are required');
  const e=b.expected;
  if(!Number.isSafeInteger(e.stock)||e.stock<0||!isCents(e.price_cents,1)||
     (e.sale_price_cents!==null&&!isCents(e.sale_price_cents,1))||(e.active!==0&&e.active!==1)){
       throw fail(400,'Invalid expected values');
  }
  return {stock:b.stock,price_cents:b.price_cents,sale_price_cents:b.sale_price_cents,active:b.active,expected:e};
}
function matchesExpected(row,e){
  return Number(row.stock)===e.stock && Number(row.price_cents)===e.price_cents &&
    (row.sale_price_cents==null?null:Number(row.sale_price_cents))===e.sale_price_cents && Number(row.active)===e.active;
}
function createLocalEditApi({password,pool,database,clock=()=>Date.now()}){
  if(typeof password!=='string'||password.length<12)throw Error('Set ADMIN_LOCAL_EDIT_PASSWORD to a distinct password of at least 12 characters');
  if(database!=='coffee_overflow_dev')throw Error('Local editing is restricted to DB_NAME=coffee_overflow_dev');
  if(!pool || typeof pool.getConnection!=='function')throw Error('MySQL pool required');
  const sessions=new Map(); const failures=new Map();
  const secretName='coffee_local_admin_session';
  function allowedHost(req){
    const h=String(req.headers.host||'');
    return ['localhost','127.0.0.1'].some(host=>h===host+':'+req.socket.localPort);
  }
  function checkOrigin(req){
    const origin=String(req.headers.origin||'');
    if(origin!==`http://${req.headers.host}`)throw fail(403,'Cross-origin requests are not accepted');
    if(String(req.headers['x-coffee-dev']||'')!=='1')throw fail(403,'Missing development request header');
  }
  function authed(req){
    const sid=parseCookie(req,secretName),expiration=sessions.get(sid);
    if(!sid||!expiration)return false;
    if(expiration<clock()){sessions.delete(sid);return false;}
    return true;
  }
  async function editProduct(id,changes){
    const c=await pool.getConnection();
    try{
      await c.beginTransaction();
      const [rows]=await c.execute('SELECT id, stock, price_cents, sale_price_cents, active FROM products WHERE id=? FOR UPDATE',[id]);
      if(!rows.length)throw fail(404,'Product not found');
      if(!matchesExpected(rows[0],changes.expected))throw fail(409,'Product changed since you opened it. Refresh Inventory and try again.');
      await c.execute('UPDATE products SET stock=?, price_cents=?, sale_price_cents=?, active=? WHERE id=?',
        [changes.stock,changes.price_cents,changes.sale_price_cents,changes.active,id]);
      await c.commit();
      return {ok:true,id,stock:changes.stock,price_cents:changes.price_cents,sale_price_cents:changes.sale_price_cents,active:changes.active};
    }catch(e){try{await c.rollback();}catch{}throw e;}finally{c.release();}
  }
  async function handle(req,res){
    try{
      if(!allowedHost(req))throw fail(403,'Localhost only');
      const u=new URL(req.url,'http://localhost');
      const p=u.pathname;
      if(req.method==='GET'&&p==='/api/local-admin/session'){
        return json(res,authed(req)?200:401,{authenticated:authed(req)});
      }
      if(req.method==='POST'&&p==='/api/local-admin/login'){
        checkOrigin(req);
        const f=failures.get('local')||{count:0,until:0};
        if(clock()>f.until){f.count=0;f.until=clock()+60000;}
        if(f.count>=5)throw fail(429,'Too many attempts; try again in a minute');
        const b=await bodyJson(req);
        const supplied=Buffer.from(String(b.password||''));const expected=Buffer.from(password);
        const good=supplied.length===expected.length&&crypto.timingSafeEqual(supplied,expected);
        if(!good){f.count++;failures.set('local',f);throw fail(401,'Incorrect local development password');}
        failures.delete('local');const id=crypto.randomBytes(32).toString('hex');sessions.set(id,clock()+2*60*60*1000);
        return json(res,200,{ok:true},{'Set-Cookie':`${secretName}=${id}; HttpOnly; SameSite=Strict; Path=/api/local-admin; Max-Age=7200`});
      }
      if(req.method==='POST'&&p==='/api/local-admin/logout'){
        checkOrigin(req);sessions.delete(parseCookie(req,secretName));
        return json(res,200,{ok:true},{'Set-Cookie':`${secretName}=; HttpOnly; SameSite=Strict; Path=/api/local-admin; Max-Age=0`});
      }
      const match=p.match(/^\/api\/local-admin\/products\/(\d+)$/);
      if(req.method==='PATCH'&&match){
        checkOrigin(req);
        if(!authed(req))throw fail(401,'Sign in to local development admin first');
        const id=Number(match[1]);if(!Number.isSafeInteger(id)||id<1)throw fail(400,'Invalid product ID');
        return json(res,200,await editProduct(id,validateEdit(await bodyJson(req))));
      }
      return json(res,404,{error:'Local development API route not found'});
    }catch(e){const status=e.status||500;if(status>=500)console.error('Local admin dev API error:',e.code||e.message);
      return json(res,status,{error:status>=500?'Local development database operation failed':e.message});
    }
  }
  return {handle,editProduct};
}
module.exports={createLocalEditApi,validateEdit,matchesExpected};
