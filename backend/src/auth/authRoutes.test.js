'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createAuthHandlers, limitForIp, readCookie} = require('./authRoutes');
const ORIGIN = 'http://127.0.0.1:5177';
function makeResponse() {
  return {code:0, headers:{}, payload:null,
    setHeader(name, value){this.headers[name.toLowerCase()] = value;},
    status(code){this.code = code;return this;},
    json(payload){this.payload = payload;return this;}};
}
function fixture() {
  let calls = {register:0,login:0,logout:0,resolve:0};
  const service = {
    async register(body){calls.register++; if(body.role)throw Object.assign(Error('Roles forbidden'),{status:400}); return {id:7,email:body.email,role:'customer'};},
    async login(email,pw){calls.login++;if(pw!=='correct-password')throw Object.assign(Error('Invalid email or password'),{status:401});return {sessionToken:'x'.repeat(43),csrfToken:'z'.repeat(43),expiresAt:'2026-11-23T00:00:00.000Z',user:{id:7,role:'customer'}};},
    async resolveVerifiedSession(req){calls.resolve++;return req.verified || null;},
    async logout(token){calls.logout++;assert.equal(token,'x'.repeat(43));return true;}
  };
  const handlers = createAuthHandlers({service,allowedOrigin:ORIGIN,secureCookies:false});
  function req(body,opts={}){return {body,headers:{origin:ORIGIN,...(opts.headers||{})},socket:{remoteAddress:opts.ip||'127.0.0.1'},verified:opts.verified||null};}
  return {calls,service,handlers,req};
}
test('requires a verified server auth service and exact origin',()=>{
  assert.throws(()=>createAuthHandlers({allowedOrigin:ORIGIN}),/authentication service is required/);
  const service=fixture().service;
  assert.throws(()=>createAuthHandlers({service}),/origin/);
  assert.throws(()=>createAuthHandlers({service,allowedOrigin:'https://example.com',secureCookies:false}),/loopback/);
});
test('registration refuses missing or foreign Origin before touching database',async()=>{
  const f=fixture();const r=makeResponse();await f.handlers.register(f.req({email:'a@example.test'},{headers:{origin:'http://evil.local'}}),r);
  assert.equal(r.code,403);assert.equal(f.calls.register,0);
});
test('registration creates only customer response',async()=>{
  const f=fixture();const r=makeResponse();await f.handlers.register(f.req({email:'a@example.test'}),r);
  assert.equal(r.code,201);assert.deepEqual(r.payload.user,{id:7,email:'a@example.test',role:'customer'});
});
test('registration does not allow user-supplied role',async()=>{
  const f=fixture();const r=makeResponse();await f.handlers.register(f.req({email:'a@example.test',role:'admin'}),r);
  assert.equal(r.code,400);
});
test('register and login require JSON objects',async()=>{
  const f=fixture();for(const handler of [f.handlers.register,f.handlers.login]){
    const r=makeResponse();await handler(f.req([]),r);assert.equal(r.code,400);
  }assert.equal(f.calls.login+f.calls.register,0);
});
test('login sets HttpOnly SameSite cookie and returns CSRF token only in body',async()=>{
  const f=fixture();const r=makeResponse();await f.handlers.login(f.req({email:'a@example.test',password:'correct-password'}),r);
  assert.equal(r.code,200);assert.equal(r.payload.csrfToken,'z'.repeat(43));
  assert.match(r.headers['set-cookie'],/HttpOnly/);assert.match(r.headers['set-cookie'],/SameSite=Lax/);
  assert.doesNotMatch(r.headers['set-cookie'],/z{43}/);assert.equal(r.headers['cache-control'],'no-store');
});
test('login rejects wrong credentials without setting session cookie',async()=>{
  const f=fixture();const r=makeResponse();await f.handlers.login(f.req({email:'a@example.test',password:'bad'}),r);
  assert.equal(r.code,401);assert.equal(r.headers['set-cookie'],undefined);
});
test('session endpoint only returns identity from verified resolver',async()=>{
  const f=fixture();const a=makeResponse();await f.handlers.session(f.req({id:99,role:'admin'}),a);
  assert.deepEqual(a.payload,{authenticated:false});
  const b=makeResponse();await f.handlers.session(f.req(null,{verified:{authenticated:true,userId:7,role:'customer'}}),b);
  assert.deepEqual(b.payload,{authenticated:true,user:{id:7,role:'customer'}});
});
test('logout rejects missing CSRF and does not revoke session',async()=>{
  const f=fixture();const r=makeResponse();await f.handlers.logout(f.req(null,{headers:{cookie:'co_session='+('x'.repeat(43))},verified:{authenticated:true,userId:7,role:'customer',csrfVerified:false}}),r);
  assert.equal(r.code,403);assert.equal(f.calls.logout,0);
});
test('logout revokes session and expires cookie after CSRF verification',async()=>{
  const f=fixture();const r=makeResponse();await f.handlers.logout(f.req(null,{headers:{cookie:'co_session='+('x'.repeat(43))},verified:{authenticated:true,userId:7,role:'customer',csrfVerified:true}}),r);
  assert.equal(r.code,200);assert.equal(f.calls.logout,1);assert.match(r.headers['set-cookie'],/Max-Age=0/);
});
test('logout rejects forged origin even with valid session and CSRF',async()=>{
  const f=fixture();const r=makeResponse();await f.handlers.logout(f.req(null,{headers:{origin:'http://malicious.example',cookie:'co_session='+('x'.repeat(43))},verified:{authenticated:true,userId:7,role:'customer',csrfVerified:true}}),r);
  assert.equal(r.code,403);assert.equal(f.calls.logout,0);
});
test('request limiting uses socket IP rather than forwarded header',async()=>{
  const f=fixture(),limit=limitForIp({max:1});
  const h=createAuthHandlers({service:f.service,allowedOrigin:ORIGIN,secureCookies:false,rateLimit:limit});
  const r1=makeResponse();await h.login(f.req({email:'a@example.test',password:'bad'},{headers:{'x-forwarded-for':'1.1.1.1'}}),r1);
  const r2=makeResponse();await h.login(f.req({email:'a@example.test',password:'bad'},{headers:{'x-forwarded-for':'2.2.2.2'}}),r2);
  assert.equal(r1.code,401);assert.equal(r2.code,429);assert.equal(f.calls.login,1);
});
test('misconfigured database failure does not leak internal detail',async()=>{
  const f=fixture();f.service.login=async()=>{throw Error('SQL connection password is BAD');};
  const h=createAuthHandlers({service:f.service,allowedOrigin:ORIGIN,secureCookies:false});
  const r=makeResponse();const old=console.error;console.error=()=>{};
  try{await h.login(f.req({email:'a@example.test',password:'correct-password'}),r);}finally{console.error=old;}
  assert.equal(r.code,503);assert.doesNotMatch(r.payload.error,/SQL|password/);
});
test('cookie reader rejects malformed and uses named cookie only',()=>{
  assert.equal(readCookie({headers:{cookie:'other=a; co_session='+('x'.repeat(43))}}),'x'.repeat(43));
  assert.equal(readCookie({headers:{cookie:'co_session=short; other=ok'}}),null);
});
