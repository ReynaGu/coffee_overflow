'use strict';
/**
 * Coffee Overflow — shared authorization boundary.
 *
 * This module does NOT authenticate credentials, parse cookies, create sessions,
 * or trust req.user / req.body / headers as proof of identity.
 *
 * The team-owned `resolveVerifiedSession(req)` must query and validate a real
 * server-side session, check expiration/revocation and user role, and return:
 *   { authenticated: true, userId: positive integer,
 *     role: 'customer' | 'admin', csrfVerified: boolean }
 *
 * The last field must represent a SERVER-VERIFIED anti-CSRF check for unsafe
 * methods. A cookie or string from the request is not proof on its own.
 *
 * Intentionally unmounted until Isaac + Reyna agree on authentication.
 */
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const ROLES = new Set(['customer', 'admin']);

function isTrustedSession(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && value.authenticated === true
    && Number.isSafeInteger(value.userId) && value.userId > 0
    && ROLES.has(value.role));
}

function createSessionGuards({ resolveVerifiedSession } = {}) {
  if (typeof resolveVerifiedSession !== 'function') {
    throw new Error('A real server-side verified session resolver is required');
  }
  function guard(requiredRole) {
    return async (req, res, next) => {
      // Never treat a value attached by an earlier untrusted middleware as identity.
      req.user = undefined;
      let session;
      try {
        session = await resolveVerifiedSession(req);
      } catch (_err) {
        return res.status(503).json({ error: 'Session verification is unavailable' });
      }
      if (!isTrustedSession(session)) {
        return res.status(401).json({ error: 'Please sign in' });
      }
      if (requiredRole === 'admin' && session.role !== 'admin') {
        return res.status(403).json({ error: 'Administrator access required' });
      }
      if (UNSAFE.has(String(req.method || '').toUpperCase()) && session.csrfVerified !== true) {
        return res.status(403).json({ error: 'Request verification failed' });
      }
      req.user = Object.freeze({ id: session.userId, role: session.role });
      return next();
    };
  }
  return Object.freeze({
    identifyShopper: guard('shopper'),
    requireAdmin: guard('admin'),
  });
}

module.exports = { createSessionGuards, isTrustedSession };
