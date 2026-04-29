import { init, readJsonBody, send, methodNotAllowed } from '../../lib/api.js';
import { hashPassword, issueSessionToken, buildSetCookieHeader } from '../../lib/auth.js';
import { getUser, createUserWithPassword } from '../../lib/db.js';
import { seedIfEmpty } from '../../lib/seed.js';

const ID_RE = /^[a-zA-Z0-9_.-]{3,32}$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  await init();

  const body = await readJsonBody(req);
  const studentId = (body?.studentId || '').trim().toLowerCase();
  const displayName = (body?.displayName || '').trim();
  const batch = (body?.batch || '').trim() || null;
  const password = body?.password || '';

  if (!ID_RE.test(studentId)) {
    return send(res, 400, { error: 'invalid_student_id', detail: 'Use 3-32 chars: letters, digits, _, ., -' });
  }
  if (!displayName || displayName.length > 64) {
    return send(res, 400, { error: 'invalid_display_name' });
  }
  if (typeof password !== 'string' || password.length < 6) {
    return send(res, 400, { error: 'password_too_short', detail: 'Min 6 characters.' });
  }

  const existing = await getUser(studentId);
  if (existing) return send(res, 409, { error: 'student_id_taken' });

  let passwordHash;
  try { passwordHash = hashPassword(password); }
  catch (e) { return send(res, 400, { error: 'password_invalid', detail: e.message }); }

  await createUserWithPassword({ id: studentId, displayName, batch, passwordHash });

  // Seed lectures so the new user has a working daily loop on first login.
  await seedIfEmpty(studentId);

  const token = issueSessionToken(studentId);
  res.setHeader('Set-Cookie', buildSetCookieHeader(token));
  return send(res, 200, { ok: true, userId: studentId, displayName });
}
