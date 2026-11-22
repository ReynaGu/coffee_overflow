'use strict';
/**
 * Coffee Overflow — localhost-only, read-only shared-order dashboard preview.
 * Separate from Express and admin/preview-server.js. Does NOT mount /api/admin.
 * Credentials are entered at startup, never persisted or imported from .env.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '../../..');
const UI = path.join(ROOT, 'admin', 'shared-orders-preview.html');
const SCRIPT = path.join(ROOT, 'admin', 'shared-orders-preview.js');
const CSS = path.join(ROOT, 'admin', 'admin.css');
const HOST = '127.0.0.1';
const PORT = 5176;
const DB = 'coffee_overflow_integration';
const USER = 'coffee_overflow_integration_app';

function hiddenPrompt(message) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    if (!input.isTTY || !input.setRawMode) return reject(new Error('Run in interactive Windows CMD or PowerShell.'));
    let value = '';
    const priorRaw = Boolean(input.isRaw);
    process.stdout.write(message);
    input.setRawMode(true); input.resume();
    const end = (err) => { input.off('data', onData); input.setRawMode(priorRaw); process.stdout.write('\n'); err ? reject(err) : resolve(value); };
    function onData(buf) {
      for (const ch of buf.toString('utf8')) {
        if (ch === '\r' || ch === '\n') return end();
        if (ch === '\u0003') return end(new Error('Cancelled'));
        if (ch === '\b' || ch === '\u007f') value = value.slice(0, -1);
        else if (ch >= ' ') value += ch;
      }
    }
    input.on('data', onData);
  });
}
function constantTimeEq(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
function createPreviewServer({ store, accessCode, files = { html: UI, js: SCRIPT, css: CSS } }) {
  if (!store || !['stats', 'listOrders', 'getOrder'].every(x => typeof store[x] === 'function')) throw new Error('Read-only order store required');
  if (typeof accessCode !== 'string' || accessCode.length < 12) throw new Error('Strong preview access code required');
  const sessions = new Map();
  let attempts = 0;
  let attemptsWindowStart = Date.now();
  function headers(res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  }
  function json(res, status, data) { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(data)); }
  function authenticated(req) {
    const cookie = String(req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('co_integration_session='));
    const token = cookie ? cookie.slice('co_integration_session='.length) : '';
    const expiry = sessions.get(token);
    if (!token || !expiry || expiry < Date.now()) return false;
    return true;
  }
  function readBody(req) {
    return new Promise((resolve, reject) => {
      let text = '';
      req.on('data', chunk => {
        text += chunk.toString();
        if (text.length > 2048) { reject(Object.assign(new Error('Request too large'), {status:413})); req.destroy(); }
      });
      req.on('end', () => { try { resolve(JSON.parse(text)); } catch { reject(Object.assign(new Error('Invalid JSON'), {status:400})); } });
      req.on('error', reject);
    });
  }
  return http.createServer(async (req, res) => {
    headers(res);
    try {
      const u = new URL(req.url, `http://${HOST}:${PORT}`);
      const p = u.pathname;
      if (p === '/') { res.writeHead(302, {Location:'/admin/shared-orders-preview.html'}); res.end(); return; }
      const staticFiles = {
        '/admin/shared-orders-preview.html': [files.html, 'text/html; charset=utf-8'],
        '/admin/shared-orders-preview.js': [files.js, 'application/javascript; charset=utf-8'],
        '/admin/admin.css': [files.css, 'text/css; charset=utf-8'],
      };
      if (Object.hasOwn(staticFiles,p) && req.method === 'GET') {
        const [file, type] = staticFiles[p];
        const body = await fs.promises.readFile(file);
        res.writeHead(200, {'Content-Type':type}); res.end(body); return;
      }
      if (p === '/api/preview/session' && req.method === 'GET') { json(res, 200, {authenticated:authenticated(req),read_only:true}); return; }
      if (p === '/api/preview/login' && req.method === 'POST') {
        if (req.headers.origin !== `http://${HOST}:${PORT}` || !String(req.headers['content-type']||'').startsWith('application/json')) { json(res,403,{error:'Invalid local request'}); return; }
        if (Date.now() - attemptsWindowStart > 60000) { attempts = 0; attemptsWindowStart = Date.now(); }
        if (attempts >= 8) { json(res,429,{error:'Too many attempts; restart preview to try again'}); return; }
        const body = await readBody(req);
        if (!constantTimeEq(body.code || '', accessCode)) { attempts++; json(res,401,{error:'Invalid preview access code'}); return; }
        attempts = 0;
        const token = crypto.randomBytes(32).toString('hex');
        sessions.clear(); sessions.set(token, Date.now() + 60 * 60 * 1000);
        res.setHeader('Set-Cookie', `co_integration_session=${token}; HttpOnly; SameSite=Strict; Path=/api/preview; Max-Age=3600`);
        json(res,200,{ok:true,read_only:true}); return;
      }
      if (p === '/api/preview/logout' && req.method === 'POST') {
        if (req.headers.origin !== `http://${HOST}:${PORT}`) { json(res,403,{error:'Invalid local request'}); return; }
        sessions.clear();
        res.setHeader('Set-Cookie', 'co_integration_session=; HttpOnly; SameSite=Strict; Path=/api/preview; Max-Age=0');
        json(res,200,{ok:true}); return;
      }
      if (p.startsWith('/api/preview/')) {
        if (req.method !== 'GET') { json(res,405,{error:'Read-only preview; writes are disabled'}); return; }
        if (!authenticated(req)) { json(res,401,{error:'Enter the temporary access code first'}); return; }
        if (p === '/api/preview/stats') { json(res,200,await store.stats()); return; }
        if (p === '/api/preview/orders') { json(res,200,await store.listOrders({sort:u.searchParams.get('sort')||'date-desc',status:u.searchParams.get('status')||'all',search:u.searchParams.get('search')||''})); return; }
        const match=p.match(/^\/api\/preview\/orders\/([1-9][0-9]*)$/);
        if (match) { json(res,200,{order:await store.getOrder(match[1])}); return; }
        json(res,404,{error:'Unknown preview endpoint'});return;
      }
      json(res,404,{error:'Not found'});
    } catch (e) {
      if (!res.writableEnded && !res.destroyed) {
        if (!e.status || Number(e.status) >= 500) console.error('Read-only preview error:',e.message);
        json(res, Number(e.status) || 500, {error:Number(e.status)>=400 && Number(e.status)<500 ? e.message : 'Preview is unavailable'});
      }
    }
  });
}
async function main() {
  // Dynamically import mysql2 only for the actual CLI server, not unit tests.
  const mysql = require('mysql2/promise');
  const { createSharedOrderStore } = require('./sharedOrderStore');
  console.log('Coffee Overflow — read-only shared MySQL order dashboard (LOCAL TEST ONLY)');
  console.log(`Database locked to ${DB}; account ${USER}; no .env changes or production admin routes.`);
  const password = await hiddenPrompt(`Integration database password for ${USER} (hidden): `);
  if (!password) throw Error('A database password is required');
  const pool = mysql.createPool({host:HOST,port:3306,user:USER,password,database:DB,connectionLimit:3,waitForConnections:true});
  try {
    const [[who]] = await pool.query('SELECT CURRENT_USER() AS account, DATABASE() AS schema_name');
    if (who.schema_name !== DB || who.account.split('@')[0] !== USER) throw Error('Refusing to connect to an unexpected database/account');
    const store = createSharedOrderStore(pool);
    await store.stats(); // Fail at startup if the shared schema is not ready.
    const accessCode = crypto.randomBytes(12).toString('hex');
    const server = createPreviewServer({store,accessCode});
    server.on('error', async err => { console.error('Preview failed:',err.message); await pool.end(); process.exitCode=1; });
    server.listen(PORT, HOST, () => {
      console.log(`\nLOCAL PREVIEW: http://${HOST}:${PORT}/admin/shared-orders-preview.html`);
      console.log(`TEMPORARY ACCESS CODE: ${accessCode}`);
      console.log('READ-ONLY: Orders, receipts and statistics only; no changes permitted.');
      console.log('Press Ctrl+C to stop. Do not publish this server to the internet.');
    });
    process.on('SIGINT', () => server.close(async () => { await pool.end(); process.exit(0); }));
  } catch(e) { await pool.end();throw e; }
}
if(require.main===module) main().catch(e=>{console.error('PREVIEW FAILED:',e.message); process.exitCode=1;});
module.exports = {createPreviewServer};
