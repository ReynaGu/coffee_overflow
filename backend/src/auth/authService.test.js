'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createAuthService, hashPassword, verifyPassword, validateRegistration,
  sessionCookie, clearSessionCookie
} = require('./authService');

const input = (overrides = {}) => ({
  first_name:'Sample', last_name:'Shopper', email:'sample.shopper@example.test',
  password:'Correct-Horse-Battery-Testing-2026!',
  street:'1 Test Street', city:'San Antonio', state:'TX', zip_code:'78253',
  ...overrides
});

function memoryDb() {
  let next = 1;
  const users = new Map(), credentials = new Map(), sessions = new Map();
  let failCredentialInsert = false;
  function interpret(sql, args) {
    if (sql.includes('INSERT INTO users')) {
      const [first_name,last_name,password,email,street,city,state,zip_code]=args;
      if ([...users.values()].some(u => u.email === email)) throw Object.assign(Error('duplicate'), {code:'ER_DUP_ENTRY'});
      const id=next++;
      users.set(id,{id,first_name,last_name,password,email,street,city,state,zip_code});
      return [{insertId:id,affectedRows:1}];
    }
    if (sql.includes('INSERT INTO auth_credentials')) {
      if (failCredentialInsert) throw Error('Injected credentials write failure');
      const [user_id,password_hash]=args;
      credentials.set(user_id,{user_id,password_hash,role:'customer',is_active:1});
      return [{affectedRows:1}];
    }
    if (sql.includes('SELECT c.user_id')) {
      const user=[...users.values()].find(u=>u.email===args[0]);
      const cred=user&&credentials.get(user.id);
      return [[cred?structuredClone(cred):undefined].filter(Boolean)];
    }
    if (sql.includes('INSERT INTO auth_sessions')) {
      const [token_hash,user_id,csrf_token_hash,expires_at]=args;
      sessions.set(token_hash,{token_hash,user_id,csrf_token_hash,expires_at,revoked_at:null});
      return [{affectedRows:1}];
    }
    if (sql.includes('SELECT s.user_id')) {
      const session=sessions.get(args[0]);
      const cred=session&&credentials.get(session.user_id);
      const valid=session&&!session.revoked_at&&new Date(session.expires_at.replace(' ','T')+'Z').getTime()>Date.now();
      return [[valid&&cred?{user_id:session.user_id,csrf_token_hash:session.csrf_token_hash,
        role:cred.role,is_active:cred.is_active}:undefined].filter(Boolean)];
    }
    if (sql.includes('UPDATE auth_sessions')) {
      const s=sessions.get(args[0]);
      if (!s||s.revoked_at) return [{affectedRows:0}];
      s.revoked_at=new Date().toISOString();
      return [{affectedRows:1}];
    }
    throw new Error('Unexpected test SQL: '+sql);
  }
  const pool = {
    execute:async(sql,args=[])=>interpret(sql,args),
    getConnection:async()=>{
      let snapshot;
      return {
        beginTransaction:async()=>{ snapshot={users:new Map(users),credentials:new Map(credentials)}; },
        execute:async(sql,args=[])=>interpret(sql,args),
        commit:async()=>{snapshot=null;},
        rollback:async()=>{ if(snapshot){users.clear();credentials.clear();for(const [k,v] of snapshot.users)users.set(k,v);for(const [k,v] of snapshot.credentials)credentials.set(k,v);} },
        release:()=>{}
      };
    }
  };
  return {pool,users,credentials,sessions,failCredentialInsert:()=>{failCredentialInsert=true;}};
}

test('scrypt creates salted hashes, verifies valid passwords, and rejects malformed hashes', async()=>{
  const p='Correct-Horse-Battery-Testing-2026!';
  const a=await hashPassword(p), b=await hashPassword(p);
  assert.notEqual(a,b);
  assert.ok(a.length<255);
  assert.equal(await verifyPassword(p,a),true);
  assert.equal(await verifyPassword('incorrect-password',a),false);
  assert.equal(await verifyPassword(p,'plaintext-password'),false);
  assert.equal(await verifyPassword(p,'scrypt$999999999$8$1$x$z'),false);
});

test('registration requires legacy users fields, rejects insecure passwords and forged roles',()=>{
  assert.throws(()=>validateRegistration(input({password:'short'})),{status:400});
  assert.throws(()=>validateRegistration(input({role:'admin'})),{status:400});
  assert.throws(()=>validateRegistration(input({id:2})),{status:400});
  assert.throws(()=>validateRegistration(input({zip_code:'not-zip'})),{status:400});
  assert.throws(()=>validateRegistration(input({email:'a'.repeat(42)+'@example.test'})),{status:400});
  assert.equal(validateRegistration(input({email:'  SAMPLE@EXAMPLE.TEST '})).email,'sample@example.test');
});

test('registration creates a customer and never writes plaintext to users.password',async()=>{
  const db=memoryDb(), service=createAuthService(db.pool);
  const created=await service.register(input());
  assert.deepEqual(created,{id:1,email:'sample.shopper@example.test',role:'customer'});
  assert.equal(db.users.get(1).password,'!auth_credentials_only!');
  assert.equal(db.credentials.get(1).role,'customer');
  assert.notEqual(db.credentials.get(1).password_hash,input().password);
  assert.equal(await verifyPassword(input().password,db.credentials.get(1).password_hash),true);
});

test('duplicate emails fail with 409 without adding a second user',async()=>{
  const db=memoryDb(), service=createAuthService(db.pool);
  await service.register(input());
  await assert.rejects(service.register(input()),e=>e.status===409);
  assert.equal(db.users.size,1);
});

test('partial account writes roll back on credential insert failure',async()=>{
  const db=memoryDb(), service=createAuthService(db.pool);
  db.failCredentialInsert();
  await assert.rejects(service.register(input()),/Injected credentials write failure/);
  assert.equal(db.users.size,0);
  assert.equal(db.credentials.size,0);
});

test('successful login creates a hashed session ID and hashed CSRF secret',async()=>{
  const db=memoryDb(), service=createAuthService(db.pool);
  await service.register(input());
  const login=await service.login(input().email,input().password);
  assert.equal(login.user.role,'customer');
  assert.equal(login.sessionToken.length,43);
  assert.equal(login.csrfToken.length,43);
  assert.equal(db.sessions.size,1);
  const stored=[...db.sessions.values()][0];
  assert.notEqual(stored.token_hash,login.sessionToken);
  assert.notEqual(stored.csrf_token_hash,login.csrfToken);
  assert.match(stored.token_hash,/^[0-9a-f]{64}$/);
});

test('bad credentials, absent users, or disabled accounts cannot login',async()=>{
  const db=memoryDb(), service=createAuthService(db.pool);
  await service.register(input());
  await assert.rejects(service.login(input().email,'wrong'),e=>e.status===401);
  await assert.rejects(service.login('missing@example.test',input().password),e=>e.status===401);
  db.credentials.get(1).is_active=0;
  await assert.rejects(service.login(input().email,input().password),e=>e.status===401);
  assert.equal(db.sessions.size,0);
});

test('trusted resolver uses an HttpOnly cookie and header-bound CSRF verification',async()=>{
  const db=memoryDb(), service=createAuthService(db.pool);
  await service.register(input());
  const auth=await service.login(input().email,input().password);
  const base={headers:{cookie:`other=x; co_session=${auth.sessionToken}`}};
  assert.deepEqual(await service.resolveVerifiedSession(base),{
    authenticated:true,userId:1,role:'customer',csrfVerified:false
  });
  const yes=await service.resolveVerifiedSession({headers:{...base.headers,'x-coffee-csrf':auth.csrfToken}});
  assert.equal(yes.csrfVerified,true);
  const no=await service.resolveVerifiedSession({headers:{...base.headers,'x-coffee-csrf':'x'.repeat(43)}});
  assert.equal(no.csrfVerified,false);
  assert.equal(await service.resolveVerifiedSession({headers:{'x-user-id':'1'}}),null);
});

test('logout revokes session, no repeat revocation, disabled users lose existing sessions',async()=>{
  const db=memoryDb(), service=createAuthService(db.pool);
  await service.register(input());
  const a=await service.login(input().email,input().password);
  assert.ok(await service.verifySession(a.sessionToken));
  db.credentials.get(1).is_active=0;
  assert.equal(await service.verifySession(a.sessionToken),null);
  db.credentials.get(1).is_active=1;
  assert.equal(await service.logout(a.sessionToken),true);
  assert.equal(await service.logout(a.sessionToken),false);
  assert.equal(await service.verifySession(a.sessionToken),null);
});

test('server-side role changes are read on each session resolution',async()=>{
  const db=memoryDb(), service=createAuthService(db.pool);
  await service.register(input());
  const auth=await service.login(input().email,input().password);
  assert.equal((await service.verifySession(auth.sessionToken)).role,'customer');
  db.credentials.get(1).role='admin'; // trusted DB-side change, NOT public registration
  assert.equal((await service.verifySession(auth.sessionToken)).role,'admin');
});

test('cookie helper makes session HttpOnly, SameSite and Secure by default',()=>{
  const token='a'.repeat(43);
  assert.match(sessionCookie(token),/HttpOnly; SameSite=Lax; Max-Age=28800; Secure/);
  assert.match(clearSessionCookie(),/Max-Age=0; Secure/);
  assert.doesNotMatch(sessionCookie(token,{secure:false}),/; Secure/);
  assert.throws(()=>sessionCookie('invalid'));
});
