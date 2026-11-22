'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSessionGuards, isTrustedSession } = require('./sessionGuards');

function session(overrides = {}) {
  return { authenticated: true, userId: 7, role: 'customer', csrfVerified: true, ...overrides };
}
async function call(handler, request = {}) {
  const req = { method: 'GET', headers: {}, body: {}, ...request };
  const response = { statusCode: 200, payload: null, nextCalled: 0 };
  const res = {
    status(n) { response.statusCode = n; return this; },
    json(v) { response.payload = v; return this; },
  };
  await handler(req, res, () => { response.nextCalled += 1; });
  return { req, ...response };
}

test('fails closed when no session resolver is supplied', () => {
  assert.throws(() => createSessionGuards(), /server-side verified session resolver/);
});
test('rejects a missing verified session and clears prior req.user', async () => {
  const guards = createSessionGuards({ resolveVerifiedSession: async () => null });
  const r = await call(guards.identifyShopper, { user: { id: 999, role: 'admin' } });
  assert.equal(r.statusCode, 401); assert.equal(r.nextCalled, 0); assert.equal(r.req.user, undefined);
});
test('rejects identities without explicit authenticated flag', async () => {
  const guards = createSessionGuards({ resolveVerifiedSession: async () => ({ userId: 7, role: 'admin' }) });
  const r = await call(guards.requireAdmin); assert.equal(r.statusCode, 401);
});
test('rejects invalid user ids and roles', () => {
  for (const userId of [0, -1, 1.2, '7', NaN, null]) assert.equal(isTrustedSession(session({ userId })), false);
  for (const role of ['owner', 'ADMIN', 'guest', null, '']) assert.equal(isTrustedSession(session({ role })), false);
});
test('allows a verified customer to access shopper routes', async () => {
  const guards = createSessionGuards({ resolveVerifiedSession: async () => session() });
  const r = await call(guards.identifyShopper, { method: 'POST' });
  assert.equal(r.statusCode, 200); assert.equal(r.nextCalled, 1);
  assert.deepEqual(r.req.user, { id: 7, role: 'customer' }); assert.equal(Object.isFrozen(r.req.user), true);
});
test('a customer cannot access administrator routes', async () => {
  const guards = createSessionGuards({ resolveVerifiedSession: async () => session() });
  const r = await call(guards.requireAdmin); assert.equal(r.statusCode, 403); assert.equal(r.nextCalled, 0);
});
test('a verified admin can access read-only admin routes', async () => {
  const guards = createSessionGuards({ resolveVerifiedSession: async () => session({ role: 'admin' }) });
  const r = await call(guards.requireAdmin, { method: 'GET' });
  assert.equal(r.statusCode, 200); assert.equal(r.nextCalled, 1);
});
test('admin writes require a verified anti-CSRF decision', async () => {
  const guards = createSessionGuards({ resolveVerifiedSession: async () => session({ role: 'admin', csrfVerified: false }) });
  for (const method of ['POST','PUT','PATCH','DELETE']) {
    const r = await call(guards.requireAdmin, { method });
    assert.equal(r.statusCode, 403, method); assert.equal(r.nextCalled, 0, method);
  }
});
test('shopper checkout writes also require anti-CSRF verification', async () => {
  const guards = createSessionGuards({ resolveVerifiedSession: async () => session({ csrfVerified: false }) });
  const r = await call(guards.identifyShopper, { method: 'POST' });
  assert.equal(r.statusCode, 403); assert.equal(r.nextCalled, 0);
});
test('spoofed body / header identity cannot override a verified session', async () => {
  const guards = createSessionGuards({ resolveVerifiedSession: async () => session() });
  const r = await call(guards.identifyShopper, { method:'POST', user:{ id:123,role:'admin' }, body:{ user_id:999,role:'admin' }, headers:{'x-user-id':'999','x-role':'admin'} });
  assert.equal(r.nextCalled,1); assert.deepEqual(r.req.user, {id:7,role:'customer'});
});
test('a session-store outage does not let a request through', async () => {
  const guards = createSessionGuards({ resolveVerifiedSession: async () => { throw new Error('DB password secret'); } });
  const r = await call(guards.requireAdmin, { method:'PATCH' });
  assert.equal(r.statusCode,503); assert.equal(r.nextCalled,0);
  assert.doesNotMatch(JSON.stringify(r.payload), /password secret/);
});
