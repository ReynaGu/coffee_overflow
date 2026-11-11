'use strict';
/* Preview-only static file server. Starts on localhost and serves the repository's files.
   It does NOT run the team API, authenticate users, or connect to MySQL. */
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.svg':'image/svg+xml','.jpeg':'image/jpeg','.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp'};
const port=Number(process.env.ADMIN_PREVIEW_PORT)||5173;
http.createServer((req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  const pathname=decodeURIComponent(url.pathname);
  const full=path.resolve(root,'.'+pathname,(pathname.endsWith('/')?'index.html':''));
  if(!full.startsWith(root+path.sep)){res.writeHead(403);res.end('Forbidden');return;}
  fs.stat(full,(e,st)=>{if(e||!st.isFile()){res.writeHead(404);res.end('Not found');return;}
   res.setHeader('Content-Type',mime[path.extname(full)]||'application/octet-stream');
   fs.createReadStream(full).pipe(res);
  });
 }catch{res.writeHead(400);res.end('Bad request');}
}).listen(port,'127.0.0.1',()=>console.log(`Admin sample preview: http://localhost:${port}/admin/`));
