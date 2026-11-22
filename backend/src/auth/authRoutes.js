'use strict';
/**
 * Coffee Overflow — opt-in Express authentication endpoints for an APPROVED
 * server-backed auth service. Not mounted automatically; no .env read here.
 *
 * The injecting server must use express.json({limit:'16kb'}), a known same-origin
 * deployment, HTTPS outside localhost, and its own durable edge rate limiting.
 * This small per-process limiter is defense in depth only, NOT a production
 * brute-force defense across multiple processes.
 */
const {COOKIE, sessionCookie, clearSessionCookie} = require('./authService');

function httpError(status, message) {
  const e = new Error(message); e.status = status; return e;
}
const SESSION_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
function readCookie(req) {
  const raw = String(req?.headers?.cookie ?? '');
  for (const segment of raw.split(';')) {
    const s = segment.trim();
    if (s.startsWith(`${COOKIE}=`)) {
      const token = s.slice(COOKIE.length + 1);
      return SESSION_TOKEN_RE.test(token) ? token : null;
    }
  }
  return null;
}
function writeJson(res, status, data) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(status).json(data);
}
function limitForIp({now = () => Date.now(), max = 12, windowMs = 15 * 60 * 1000} = {}) {
  const entries = new Map();
  return function enforce(req) {
    const ip = String(req?.socket?.remoteAddress || 'unknown');
    const t = now();
    const record = entries.get(ip);
    const next = !record || record.until <= t ? {until:t + windowMs, count:1} : {until:record.until, count:record.count + 1};
    entries.set(ip, next);
    // Keep this development-only limiter bounded.
    if (entries.size > 2000) {
      for (const [key, entry] of entries) if (entry.until <= t) entries.delete(key);
      if (entries.size > 2000) entries.delete(entries.keys().next().value);
    }
    if (next.count > max) throw httpError(429, 'Too many authentication attempts. Try again later.');
  };
}
function createAuthHandlers({service, allowedOrigin, secureCookies = true, rateLimit = limitForIp()} = {}) {
  if (!service || ['register','login','logout','resolveVerifiedSession'].some(k => typeof service[k] !== 'function')) {
    throw new Error('A complete server-side authentication service is required');
  }
  if (typeof allowedOrigin !== 'string' || !/^https?:\/\/[^/]+$/.test(allowedOrigin)) {
    throw new Error('An exact allowed origin is required');
  }
  if (!secureCookies && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(allowedOrigin)) {
    throw new Error('Insecure session cookies allowed only on local loopback development');
  }
  if (typeof rateLimit !== 'function') throw new Error('An authentication limiter is required');
  function checkOrigin(req) {
    if (req?.headers?.origin !== allowedOrigin) throw httpError(403, 'Request origin is not allowed');
  }
  function checkBody(req) {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw httpError(400, 'JSON body required');
  }
  function run(fn) {
    return async (req, res) => {
      try { await fn(req, res); }
      catch (e) {
        const status = Number(e?.status) || 500;
        // Never expose SQL errors, token values, or internal exceptions.
        if (status >= 500) console.error('Auth route failed:', e?.message ?? 'unknown');
        writeJson(res, status >= 400 && status < 500 ? status : 503,
          {error:status >= 500 ? 'Authentication temporarily unavailable' : e.message});
      }
    };
  }
  const register = run(async (req, res) => {
    checkOrigin(req); rateLimit(req); checkBody(req);
    const user = await service.register(req.body);
    writeJson(res, 201, {user:{id:user.id, email:user.email, role:'customer'}});
  });
  const login = run(async (req, res) => {
    checkOrigin(req); rateLimit(req); checkBody(req);
    const result = await service.login(req.body.email, req.body.password);
    res.setHeader('Set-Cookie', sessionCookie(result.sessionToken, {secure:secureCookies}));
    writeJson(res, 200, {user:result.user, csrfToken:result.csrfToken, expiresAt:result.expiresAt});
  });
  const session = run(async (req, res) => {
    const verified = await service.resolveVerifiedSession(req);
    if (!verified?.authenticated || !Number.isSafeInteger(verified.userId)) {
      writeJson(res, 200, {authenticated:false}); return;
    }
    writeJson(res, 200, {authenticated:true, user:{id:verified.userId,role:verified.role}});
  });
  const logout = run(async (req, res) => {
    checkOrigin(req);
    const verified = await service.resolveVerifiedSession(req);
    if (!verified?.authenticated) throw httpError(401, 'Please sign in');
    if (verified.csrfVerified !== true) throw httpError(403, 'Request verification failed');
    const token = readCookie(req);
    if (!token) throw httpError(401, 'Please sign in');
    await service.logout(token);
    res.setHeader('Set-Cookie', clearSessionCookie({secure:secureCookies}));
    writeJson(res, 200, {ok:true});
  });
  return Object.freeze({register,login,session,logout});
}
function createAuthRouter(options) {
  // Lazy import lets the endpoint handlers be tested without starting Express.
  const express = require('express');
  const handlers = createAuthHandlers(options);
  const router = express.Router();
  router.post('/register', handlers.register);
  router.post('/login', handlers.login);
  router.get('/session', handlers.session);
  router.post('/logout', handlers.logout);
  return router;
}
module.exports = {createAuthRouter,createAuthHandlers,readCookie,limitForIp};
