// lib/api.js — shared helpers for Vercel API routes.

import { ensureSchema } from './db.js';
import { seedIfEmpty } from './seed.js';

let initPromise = null;
export async function init() {
  if (!initPromise) {
    initPromise = (async () => {
      await ensureSchema();
      await seedIfEmpty('demo');
    })();
  }
  return initPromise;
}

export function userIdOf(req) {
  return (req.query && req.query.userId) || 'demo';
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
