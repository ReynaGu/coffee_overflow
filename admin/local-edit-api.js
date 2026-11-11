'use strict';
/**
 * LOCAL-DEVELOPMENT ONLY product management for coffee_overflow_dev.
 * Not production authentication. Never mount outside the local preview server.
 * The team's Express product GET endpoint and all teammate files are unchanged.
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
async function bodyJson(req,limit=8192){
  if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))throw fail(415,'JSON request required');
  let size=0,raw='';
  for await (const chunk of req){size+=chunk.length;if(size>limit)throw fail(413,'Request body too large');raw+=chunk;}
  try{const d=JSON.parse(raw);if(!d||Array.isArray(d)||typeof d!=='object')throw Error();return d;}
  catch{throw fail(400,'Invalid JSON body');}
}
function isCents(v,minimum=0){return Number.isSafeInteger(v)&&v>=minimum&&v<=100000000;}
// An image path refers to an existing file in the team's assets/images folder.
// No file upload or external image fetching is added by this patch.
function validImage(image){
  return typeof image==='string'&&image.length<=255&&
    /^\/assets\/images\/[a-zA-Z0-9_./-]+\.(?:jpeg|jpg|png|webp)$/i.test(image)&&
    !image.split('/').includes('..')&&!image.split('/').includes('.');
}
function validateFields(body){
  if(!body||typeof body!=='object'||Array.isArray(body))throw fail(400,'Missing product fields');
  const name=typeof body.name==='string'?body.name.trim():'';
  const description=typeof body.description==='string'?body.description.trim():'';
  const category=typeof body.category==='string'?body.category.trim():'';
  const image=typeof body.image==='string'?body.image.trim():'';
  if(name.length<2||name.length>120)throw fail(400,'Name must be 2–120 characters');
  if(description.length>1200)throw fail(400,'Description must be at most 1200 characters');
  if(category.length<1||category.length>50)throw fail(400,'Category must be 1–50 characters');
  if(!validImage(image))throw fail(400,'Image must be an existing /assets/images/*.jpg, .jpeg, .png or .webp path');
  if(!Number.isSafeInteger(body.stock)||body.stock<0||body.stock>1000000)throw fail(400,'Invalid stock');
  if(!isCents(body.price_cents,1))throw fail(400,'Invalid regular price');
  if(body.sale_price_cents!==null && (!isCents(body.sale_price_cents,1)||body.sale_price_cents>=body.price_cents))throw fail(400,'Sale price must be below regular price');
  if(body.active!==0&&body.active!==1)throw fail(400,'Active must be zero or one');
  return {name,description,category,image,stock:body.stock,price_cents:body.price_cents,
    sale_price_cents:body.sale_price_cents,active:body.active};
}
function validateCreate(body){return validateFields(body);}
function validateEdit(body){
  const fields=validateFields(body);
  if(!body.expected||typeof body.expected!=='object')throw fail(400,'Expected prior product values are required');
  const expected=validateFields(body.expected);
  return {...fields,expected};
}
function matchesExpected(row,expected){
  return String(row.name??'')===expected.name&&String(row.description??'')===expected.description&&
    String(row.category??'')===expected.category&&String(row.image??'')===expected.image&&
    Number(row.stock)===expected.stock&&Number(row.price_cents)===expected.price_cents&&
    (row.sale_price_cents==null?null:Number(row.sale_price_cents))===expected.sale_price_cents&&
    Number(row.active)===expected.active;
}
function createLocalEditApi({password,pool,database,clock=()=>Date.now()}){
  if(typeof password!=='string'||password.length<12)throw Error('Set ADMIN_LOCAL_EDIT_PASSWORD to a distinct password of at least 12 characters');
  if(database!=='coffee_overflow_dev')throw Error('Local editing is restricted to DB_NAME=coffee_overflow_dev');
  if(!pool || typeof pool.getConnection!=='function')throw Error('MySQL pool required');
  const sessions=new Map(),failures=new Map();
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
  async function createProduct(fields){
    const connection=await pool.getConnection();
    try{
      await connection.beginTransaction();
      const [result]=await connection.execute(
        'INSERT INTO products (name,description,category,image,stock,price_cents,sale_price_cents,active) VALUES (?,?,?,?,?,?,?,?)',
        [fields.name,fields.description,fields.category,fields.image,fields.stock,fields.price_cents,fields.sale_price_cents,fields.active]);
      if(!Number.isSafeInteger(result.insertId)||result.insertId<1)throw fail(500,'Product insert did not return a valid ID');
      await connection.commit();
      return {ok:true,id:result.insertId,created:true};
    }catch(e){try{await connection.rollback();}catch{}throw e;}finally{connection.release();}
  }
  async function editProduct(id,changes){
    const connection=await pool.getConnection();
    try{
      await connection.beginTransaction();
      const [rows]=await connection.execute(
        'SELECT id,name,description,category,image,stock,price_cents,sale_price_cents,active FROM products WHERE id=? FOR UPDATE',[id]);
      if(!rows.length)throw fail(404,'Product not found');
      if(!matchesExpected(rows[0],changes.expected))throw fail(409,'Product changed since you opened it. Refresh Inventory and try again.');
      const [result]=await connection.execute(
        'UPDATE products SET name=?,description=?,category=?,image=?,stock=?,price_cents=?,sale_price_cents=?,active=? WHERE id=?',
        [changes.name,changes.description,changes.category,changes.image,changes.stock,
          changes.price_cents,changes.sale_price_cents,changes.active,id]);
      if(result.affectedRows!==1)throw fail(409,'Product was not updated');
      await connection.commit();
      return {ok:true,id,updated:true};
    }catch(e){try{await connection.rollback();}catch{}throw e;}finally{connection.release();}
  }
  async function handle(req,res){
    try{
      if(!allowedHost(req))throw fail(403,'Localhost only');
      const u=new URL(req.url,'http://localhost'),p=u.pathname;
      if(req.method==='GET'&&p==='/api/local-admin/session'){
        return json(res,authed(req)?200:401,{authenticated:authed(req)});
      }
      if(req.method==='POST'&&p==='/api/local-admin/login'){
        checkOrigin(req);
        const f=failures.get('local')||{count:0,until:0};
        if(clock()>f.until){f.count=0;f.until=clock()+60000;}
        if(f.count>=5)throw fail(429,'Too many attempts; try again in a minute');
        const b=await bodyJson(req);
        const supplied=Buffer.from(String(b.password||'')),expected=Buffer.from(password);
        const good=supplied.length===expected.length&&crypto.timingSafeEqual(supplied,expected);
        if(!good){f.count++;failures.set('local',f);throw fail(401,'Incorrect local development password');}
        failures.delete('local');const id=crypto.randomBytes(32).toString('hex');sessions.set(id,clock()+2*60*60*1000);
        return json(res,200,{ok:true},{'Set-Cookie':`${secretName}=${id}; HttpOnly; SameSite=Strict; Path=/api/local-admin; Max-Age=7200`});
      }
      if(req.method==='POST'&&p==='/api/local-admin/logout'){
        checkOrigin(req);sessions.delete(parseCookie(req,secretName));
        return json(res,200,{ok:true},{'Set-Cookie':`${secretName}=; HttpOnly; SameSite=Strict; Path=/api/local-admin; Max-Age=0`});
      }
      if(req.method==='POST'&&p==='/api/local-admin/products'){
        checkOrigin(req);
        if(!authed(req))throw fail(401,'Sign in to local development admin first');
        return json(res,201,await createProduct(validateCreate(await bodyJson(req))));
      }
      const match=p.match(/^\/api\/local-admin\/products\/(\d+)$/);
      if(req.method==='PATCH'&&match){
        checkOrigin(req);
        if(!authed(req))throw fail(401,'Sign in to local development admin first');
        const id=Number(match[1]);if(!Number.isSafeInteger(id)||id<1)throw fail(400,'Invalid product ID');
        return json(res,200,await editProduct(id,validateEdit(await bodyJson(req))));
      }
      return json(res,404,{error:'Local development API route not found'});
    }catch(e){
      const status=e.status||500;
      if(status>=500)console.error('Local admin dev API error:',e.code||e.message);
      return json(res,status,{error:status>=500?'Local development database operation failed':e.message});
    }
  }
  return {handle,editProduct,createProduct};
}
module.exports={createLocalEditApi,validateCreate,validateEdit,validateFields,matchesExpected};
