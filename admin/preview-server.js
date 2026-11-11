'use strict';
/* Local-only Coffee Overflow preview. The local edit API is disabled by default.
 * STATIC FILE SECURITY: never serve backend/.env, .git, node_modules, or server-side code.
 */
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.svg':'image/svg+xml','.jpeg':'image/jpeg','.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp'};
const port=Number(process.env.ADMIN_PREVIEW_PORT)||5173;
const back=path.join(root,'backend');
if(fs.existsSync(path.join(back,'.env'))){
  const dotenv=require(require.resolve('dotenv',{paths:[back]}));
  // backend/.env is private, ignored by Git. Never serve it from preview.
  dotenv.config({path:path.join(back,'.env')});
}
let localApi=null;
if(process.env.ADMIN_LOCAL_EDIT==='1'){
  if(process.env.DB_NAME!=='coffee_overflow_dev')throw Error('Local write mode requires DB_NAME=coffee_overflow_dev');
  if(!['127.0.0.1','localhost'].includes(process.env.DB_HOST))throw Error('Local editing requires local DB_HOST only');
  if(process.env.DB_USER!=='coffee_overflow_app')throw Error('Local editing requires the restricted coffee_overflow_app MySQL account');
  if(process.env.ADMIN_LOCAL_EDIT_PASSWORD===process.env.DB_PASSWORD)throw Error('Use a different local admin password from DB_PASSWORD');
  const {createLocalEditApi}=require('./local-edit-api');
  const db=require('../backend/src/config/db');
  localApi=createLocalEditApi({password:process.env.ADMIN_LOCAL_EDIT_PASSWORD,pool:db,database:process.env.DB_NAME});
}
const visibleAdmin=new Set(['index.html','admin.css','admin.js','demo-data.js','product-bridge.js']);
const visibleRoot=new Set(['index.html','products.html','about.html','contact.html','cart.html']);
function staticAllowed(name){
  const parts=name.split('/').filter(Boolean);
  if(parts.length===1&&visibleRoot.has(parts[0]))return true;
  if(parts.length===2&&parts[0]==='admin'&&visibleAdmin.has(parts[1]))return true;
  if(parts.length>=3&&parts[0]==='assets'&&['css','js','images'].includes(parts[1])){
    return parts.every(x=>!x.startsWith('.')&&!['node_modules','.git'].includes(x));
  }
  return false;
}
function createServer(){return http.createServer((req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname.startsWith('/api/local-admin/')){
      if(!localApi){res.writeHead(404);res.end('Not enabled');return;}
      localApi.handle(req,res);return;
    }
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end('Method not allowed');return;}
    let name=decodeURIComponent(url.pathname);
    if(name==='/admin/'||name==='/admin')name='/admin/index.html';
    name=name.replace(/^\/+/, '');
    if(!staticAllowed(name)){res.writeHead(404);res.end('Not found');return;}
    const full=path.resolve(root,name);
    if(!full.startsWith(root+path.sep)){res.writeHead(403);res.end('Forbidden');return;}
    fs.stat(full,(e,st)=>{
      if(e||!st.isFile()){res.writeHead(404);res.end('Not found');return;}
      res.setHeader('Content-Type',mime[path.extname(full)]||'application/octet-stream');
      res.setHeader('X-Content-Type-Options','nosniff');
      res.setHeader('Cache-Control','no-store');
      if(req.method==='HEAD'){res.end();return;}
      fs.createReadStream(full).pipe(res);
    });
  }catch{res.writeHead(400);res.end('Bad request');}
});}
if(require.main===module){
  createServer().listen(port,'127.0.0.1',()=>console.log(`Admin preview: http://localhost:${port}/admin/${localApi?' (LOCAL DEV EDIT ENABLED)':''}`));
}
module.exports={createServer,staticAllowed};
