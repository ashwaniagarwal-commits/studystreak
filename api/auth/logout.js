import { send, methodNotAllowed } from '../../lib/api.js';
import { buildClearCookieHeader } from '../../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  res.setHeader('Set-Cookie', buildClearCookieHeader());
  return send(res, 200, { ok: true });
}
