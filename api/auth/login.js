import { init, readJsonBody, send, methodNotAllowed } from '../../lib/api.js';
import { verifyPassword, issueSessionToken, buildSetCookieHeader } from '../../lib/auth.js';
import { getUser } from '../../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  await init();

  const body = await readJsonBody(req);
  const studentId = (body?.studentId || '').trim().toLowerCase();
  const password = body?.password || '';

  if (!studentId || !password) {
    return send(res, 400, { error: 'missing_credentials' });
  }

  const user = await getUser(studentId);
  if (!user || !user.password_hash) {
    return send(res, 401, { error: 'invalid_credentials' });
  }
  if (!verifyPassword(password, user.password_hash)) {
    return send(res, 401, { error: 'invalid_credentials' });
  }

  const token = issueSessionToken(user.id);
  res.setHeader('Set-Cookie', buildSetCookieHeader(token));
  return send(res, 200, { ok: true, userId: user.id, displayName: user.display_name });
}
