// POST /api/squad/cheer → send a 1-tap cheer to a squadmate
import { init, readJsonBody, send, methodNotAllowed } from '../../lib/api.js';
import { withAuth } from '../../lib/auth.js';
import { getSquad, sendCheer, getUser } from '../../lib/db.js';

const TEMPLATES = new Set([
  "You got this 💪",
  "Don't break it 🔥",
  "25-min sprint? ⏱️",
  "Study together? 🤝",
  "Way to go 🎯",
]);
const RATE_PER_HOUR = 30; // anti-spam soft cap

async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  await init();

  const body = await readJsonBody(req);
  const toUser = (body?.toUser || '').trim().toLowerCase();
  const message = (body?.message || '').trim();

  if (!toUser || !TEMPLATES.has(message)) {
    return send(res, 400, { error: 'invalid_cheer', allowed: [...TEMPLATES] });
  }
  if (toUser === req.userId) return send(res, 400, { error: 'cannot_cheer_self' });

  const squad = await getSquad(req.userId);
  if (!squad.some(m => m.id === toUser)) {
    return send(res, 403, { error: 'not_squadmate' });
  }
  const target = await getUser(toUser);
  if (!target) return send(res, 404, { error: 'user_not_found' });

  await sendCheer(req.userId, toUser, message);
  return send(res, 200, { ok: true });
}

export default withAuth(handler);
