// lib/auth.js — password hashing + HMAC-signed session cookies.
// No external deps: uses node:crypto only. Works in Vercel serverless functions.

import crypto from 'node:crypto';

const SESSION_COOKIE = 'studystreak_session';
const SESSION_TTL_DAYS = 30;

function getSecret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error('SESSION_SECRET is not set or too short (need 16+ chars). Add it in Vercel project env vars.');
  }
  return s;
}

// ---------- password hashing (scrypt) ----------

export function hashPassword(password) {
  if (!password || password.length < 6) throw new Error('password too short (min 6 chars)');
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt:')) return false;
  const [, salt, hash] = stored.split(':');
  let test;
  try {
    test = crypto.scryptSync(password, salt, 64).toString('hex');
  } catch { return false; }
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(test, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ---------- session tokens (HMAC-signed cookies) ----------

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

export function issueSessionToken(userId) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_DAYS * 86400;
  const payload = JSON.stringify({ sub: userId, exp });
  const payloadB64 = b64url(payload);
  const sig = crypto.createHmac('sha256', getSecret()).update(payloadB64).digest();
  const sigB64 = b64url(sig);
  return `${payloadB64}.${sigB64}`;
}

export function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  const expectedSig = crypto.createHmac('sha256', getSecret()).update(payloadB64).digest();
  const givenSig = b64urlDecode(sigB64);
  if (expectedSig.length !== givenSig.length) return null;
  if (!crypto.timingSafeEqual(expectedSig, givenSig)) return null;
  let payload;
  try { payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8')); }
  catch { return null; }
  if (!payload.sub || !payload.exp) return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

// ---------- cookie helpers ----------

export function buildSetCookieHeader(token) {
  const maxAge = SESSION_TTL_DAYS * 86400;
  return `${SESSION_COOKIE}=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export function buildClearCookieHeader() {
  return `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export function readSessionCookie(req) {
  const raw = req.headers?.cookie || '';
  const parts = raw.split(';').map(s => s.trim()).filter(Boolean);
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    const k = p.slice(0, eq);
    if (k === SESSION_COOKIE) return p.slice(eq + 1);
  }
  return null;
}

// ---------- middleware-style helper ----------

/**
 * withAuth wraps a Vercel-style handler. Resolves userId from the session
 * cookie. If unauthenticated, returns 401. Also touches last_active_at for
 * DAU/WAU/MAU tracking (debounced; safe to call frequently).
 */
export function withAuth(handler) {
  return async (req, res) => {
    const token = readSessionCookie(req);
    const session = verifySessionToken(token);
    if (!session) {
      res.status(401);
      res.setHeader('content-type', 'application/json');
      res.send(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    req.userId = session.sub;
    // Fire-and-forget activity tracking — don't await, don't break the request
    import('./db.js').then(m => m.touchActive(session.sub)).catch(() => {});
    return handler(req, res);
  };
}

/**
 * withAdmin requires both auth AND a query-param/header admin password match.
 * Used for /api/admin/* routes.
 */
export function withAdmin(handler) {
  return async (req, res) => {
    const expected = process.env.ADMIN_PASSWORD;
    if (!expected) {
      res.status(500);
      res.setHeader('content-type', 'application/json');
      res.send(JSON.stringify({ error: 'admin_not_configured' }));
      return;
    }
    const given = req.headers?.['x-admin-password'] || req.query?.admin || '';
    if (given !== expected) {
      res.status(401);
      res.setHeader('content-type', 'application/json');
      res.send(JSON.stringify({ error: 'admin_unauthorized' }));
      return;
    }
    return handler(req, res);
  };
}
