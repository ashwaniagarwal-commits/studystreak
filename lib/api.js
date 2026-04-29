// lib/api.js — shared helpers for Vercel API routes.

import { ensureSchema } from './db.js';
import { seedIfEmpty } from './seed.js';
import { readSessionCookie, verifySessionToken } from './auth.js';

let initPromise = null;
export async function init() {
  if (!initPromise) {
    initPromise = (async () => {
      await ensureSchema();
      // Keep the demo user seeded for back-compat (lets us hit /api/today?userId=demo
      // without auth for smoke testing).
      await seedIfEmpty('demo');
    })();
  }
  return initPromise;
}

/**
 * Resolve userId for a request.
 *  1. Prefer the session cookie (authenticated user).
 *  2. Fall back to ?userId=... query param (demo / smoke testing only).
 *  3. Default to 'demo'.
 */
export function userIdOf(req) {
  const token = readSessionCookie(req);
  const session = verifySessionToken(token);
  if (session?.sub) return session.sub;
  return (req.query && req.query.userId) || 'demo';
}

/** Returns userId only if authenticated; null otherwise. */
export function authUserIdOf(req) {
  const token = readSessionCookie(req);
  const session = verifySessionToken(token);
  return session?.sub || null;
}

export async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}

export function send(res, status, payload) {
  res.status(status);
  res.setHeader('content-type', 'application/json');
  res.send(JSON.stringify(payload));
}

export function methodNotAllowed(res, allowed) {
  res.setHeader('Allow', allowed.join(', '));
  send(res, 405, { error: 'method_not_allowed', allowed });
}
