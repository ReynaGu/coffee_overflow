'use strict';
/**
 * Coffee Overflow — isolated auth service, schema integration prototype.
 *
 * No HTTP routes are mounted and no .env file is read here. A trusted server
 * must inject a mysql2/promise pool for the approved schema, set/clear cookies,
 * and rate-limit public endpoints before using this in an app.
 *
 * Uses Reyna's legacy users columns and separate auth_credentials/auth_sessions
 * from coffee_overflow_integration. Registration always creates a CUSTOMER;
 * there is deliberately no public admin registration/role-assignment function.
 */
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scryptAsync = promisify(crypto.scrypt);
const COOKIE = 'co_session';
const TTL_SECONDS = 8 * 60 * 60;
const PARAMETERS = Object.freeze({ N: 16384, r: 8, p: 1, keyLength: 64, maxmem: 32 * 1024 * 1024 });
const SESSION_RE = /^[A-Za-z0-9_-]{43}$/;
const CSRF_RE = /^[A-Za-z0-9_-]{43}$/;
const HEX_RE = /^[0-9a-f]{64}$/;
// A legitimate scrypt-format dummy hash prevents a missing email from skipping
// the password derivation work. This is NOT a credential for any account.
const DUMMY_SALT = Buffer.from('9e8a35b6be85f325ccd04c7e901124ef', 'hex');
const DUMMY_DIGEST = crypto.scryptSync('not-an-account-password', DUMMY_SALT, PARAMETERS.keyLength, PARAMETERS);
const DUMMY_HASH = `scrypt$${PARAMETERS.N}$${PARAMETERS.r}$${PARAMETERS.p}$${DUMMY_SALT.toString('base64url')}$${DUMMY_DIGEST.toString('base64url')}`;

function problem(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
function sha256(value) { return crypto.createHash('sha256').update(value, 'utf8').digest('hex'); }
function safeHexEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !HEX_RE.test(a) || !HEX_RE.test(b)) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
function normalizedEmail(value) {
  const s = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (s.length < 5 || s.length > 50 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw problem(400, 'Enter a valid email address (50 characters maximum)');
  return s;
}
function limitedText(value, label, max) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s || s.length > max) throw problem(400, `${label} is required (up to ${max} characters)`);
  return s;
}
function validPassword(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128 || Buffer.byteLength(value, 'utf8') > 256) {
    throw problem(400, 'Password must be between 12 and 128 characters');
  }
  return value;
}
function validateRegistration(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw problem(400, 'Invalid registration');
  if (Object.hasOwn(input, 'role') || Object.hasOwn(input, 'is_active') || Object.hasOwn(input, 'id')) {
    throw problem(400, 'Account roles and IDs cannot be supplied by the customer');
  }
  const zip = typeof input.zip_code === 'string' ? input.zip_code : String(input.zip_code ?? '');
  if (!/^\d{5}$/.test(zip)) throw problem(400, 'A five-digit ZIP code is required');
  return {
    first_name: limitedText(input.first_name, 'First name', 50),
    last_name: limitedText(input.last_name, 'Last name', 50),
    email: normalizedEmail(input.email),
    password: validPassword(input.password),
    street: limitedText(input.street, 'Street', 50),
    city: limitedText(input.city, 'City', 50),
    state: limitedText(input.state, 'State', 15),
    zip_code: Number(zip),
  };
}
async function hashPassword(password) {
  validPassword(password);
  const salt = crypto.randomBytes(16);
  const digest = await scryptAsync(password, salt, PARAMETERS.keyLength, PARAMETERS);
  return `scrypt$${PARAMETERS.N}$${PARAMETERS.r}$${PARAMETERS.p}$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}
async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || Buffer.byteLength(password, 'utf8') > 256) return false;
  if (typeof encoded !== 'string') return false;
  const fields = encoded.split('$');
  if (fields.length !== 6 || fields[0] !== 'scrypt' ||
      fields[1] !== String(PARAMETERS.N) || fields[2] !== String(PARAMETERS.r) || fields[3] !== String(PARAMETERS.p) ||
      !/^[A-Za-z0-9_-]{22}$/.test(fields[4]) || !/^[A-Za-z0-9_-]{86}$/.test(fields[5])) return false;
  let salt, expected;
  try { salt = Buffer.from(fields[4], 'base64url'); expected = Buffer.from(fields[5], 'base64url'); }
  catch { return false; }
  if (salt.length !== 16 || expected.length !== PARAMETERS.keyLength) return false;
  const candidate = await scryptAsync(password, salt, PARAMETERS.keyLength, PARAMETERS);
  return crypto.timingSafeEqual(candidate, expected);
}
function cookieValue(req, name) {
  const raw = String(req && req.headers && req.headers.cookie || '');
  for (const segment of raw.split(';')) {
    const item = segment.trim();
    if (item.startsWith(`${name}=`)) return item.slice(name.length + 1);
  }
  return null;
}
function sessionCookie(raw, {secure = true} = {}) {
  if (!SESSION_RE.test(raw)) throw new Error('Invalid internal session token');
  return `${COOKIE}=${raw}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TTL_SECONDS}${secure ? '; Secure' : ''}`;
}
function clearSessionCookie({secure = true} = {}) {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}
function utcSqlDate(d) { return d.toISOString().slice(0, 19).replace('T', ' '); }

function createAuthService(pool, {now = () => new Date()} = {}) {
  if (!pool || typeof pool.execute !== 'function' || typeof pool.getConnection !== 'function') {
    throw new Error('An injected mysql2/promise pool is required');
  }
  async function register(raw) {
    const input = validateRegistration(raw);
    const encoded = await hashPassword(input.password);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [result] = await conn.execute(`INSERT INTO users
        (first_name, last_name, password, email, street, city, state, zip_code)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
        input.first_name, input.last_name, '!auth_credentials_only!', input.email,
        input.street, input.city, input.state, input.zip_code
      ]);
      const id = Number(result.insertId);
      if (!Number.isSafeInteger(id) || id < 1) throw new Error('User ID generation failed');
      await conn.execute(`INSERT INTO auth_credentials
        (user_id, password_hash, role, is_active) VALUES (?, ?, 'customer', 1)`, [id, encoded]);
      await conn.commit();
      return {id, email:input.email, role:'customer'};
    } catch (e) {
      try { await conn.rollback(); } catch {}
      if (e.code === 'ER_DUP_ENTRY') throw problem(409, 'An account with that email already exists');
      throw e;
    } finally { conn.release(); }
  }
  async function login(emailInput, passwordInput) {
    // Public HTTP endpoints must independently enforce rate limits and lockouts.
    const password = typeof passwordInput === 'string' ? passwordInput : '';
    let email;
    try { email = normalizedEmail(emailInput); } catch { throw problem(401, 'Invalid email or password'); }
    if (Buffer.byteLength(password, 'utf8') > 256) throw problem(401, 'Invalid email or password');
    const [rows] = await pool.execute(`SELECT c.user_id, c.password_hash, c.role, c.is_active
      FROM auth_credentials c JOIN users u ON u.id = c.user_id
      WHERE u.email = ? LIMIT 1`, [email]);
    const record = rows[0];
    const verified = await verifyPassword(password, record ? record.password_hash : DUMMY_HASH);
    if (!verified || !record || Number(record.is_active) !== 1 || !['customer','admin'].includes(record.role)) {
      throw problem(401, 'Invalid email or password');
    }
    const token = crypto.randomBytes(32).toString('base64url');
    const csrfToken = crypto.randomBytes(32).toString('base64url');
    const date = now();
    const expires = new Date(date.getTime() + TTL_SECONDS * 1000);
    await pool.execute(`INSERT INTO auth_sessions
      (token_hash, user_id, csrf_token_hash, expires_at)
      VALUES (?, ?, ?, ?)`, [sha256(token), record.user_id, sha256(csrfToken), utcSqlDate(expires)]);
    return {
      // These are for trusted HTTP route code to set an HttpOnly session cookie
      // and return a separate CSRF token. Do not log or persist raw tokens.
      sessionToken:token, csrfToken, expiresAt:expires.toISOString(),
      user:{id:Number(record.user_id),role:record.role}
    };
  }
  async function verifySession(sessionToken, csrfToken = null) {
    if (typeof sessionToken !== 'string' || !SESSION_RE.test(sessionToken)) return null;
    const [rows] = await pool.execute(`SELECT s.user_id, s.csrf_token_hash, c.role, c.is_active
      FROM auth_sessions s JOIN auth_credentials c ON c.user_id = s.user_id
      WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > UTC_TIMESTAMP()
      LIMIT 1`, [sha256(sessionToken)]);
    const record = rows[0];
    if (!record || Number(record.is_active) !== 1 || !['customer','admin'].includes(record.role)) return null;
    return {
      authenticated:true,
      userId:Number(record.user_id),
      role:record.role,
      csrfVerified:typeof csrfToken === 'string' && CSRF_RE.test(csrfToken) &&
        safeHexEqual(sha256(csrfToken), record.csrf_token_hash),
    };
  }
  async function resolveVerifiedSession(req) {
    const token = cookieValue(req, COOKIE);
    const csrf = req && req.headers && req.headers['x-coffee-csrf'];
    return verifySession(token, typeof csrf === 'string' ? csrf : null);
  }
  async function logout(sessionToken) {
    if (typeof sessionToken !== 'string' || !SESSION_RE.test(sessionToken)) return false;
    const [result] = await pool.execute(`UPDATE auth_sessions
      SET revoked_at = UTC_TIMESTAMP()
      WHERE token_hash = ? AND revoked_at IS NULL`, [sha256(sessionToken)]);
    return result.affectedRows === 1;
  }
  return Object.freeze({register,login,logout,verifySession,resolveVerifiedSession});
}

module.exports = {
  createAuthService, hashPassword, verifyPassword, validateRegistration,
  sessionCookie, clearSessionCookie, COOKIE, TTL_SECONDS,
};
