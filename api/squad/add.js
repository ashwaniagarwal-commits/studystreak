// POST /api/squad/add → add an existing user to your squad by student ID.
// Both students get linked bidirectionally; squad cap (8) enforced on both sides.
import { init, readJsonBody, send, methodNotAllowed } from '../../lib/api.js';
import { withAuth } from '../../lib/auth.js';
import { getUser, linkSquadMembers, squadCount, getSquad } from '../../lib/db.js';

async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  await init();

  const body = await readJsonBody(req);
  const targetId = (body?.studentId || '').trim().toLowerCase();
  if (!targetId) return send(res, 400, { error: 'missing_student_id' });
  if (targetId === req.userId) return send(res, 400, { error: 'cannot_add_self' });

  const target = await getUser(targetId);
  if (!target) return send(res, 404, { error: 'not_found', detail: `No student with id "${targetId}"` });

  // Check if already in squad
  const existing = await getSquad(req.userId);
  if (existing.some(m => m.id === targetId)) {
    return send(res, 200, { ok: true, alreadyLinked: true });
  }

  const myCount = await squadCount(req.userId);
  if (myCount >= 8) return send(res, 400, { error: 'squad_full', detail: 'You already have 8 squadmates.' });
  const theirCount = await squadCount(targetId);
  if (theirCount >= 8) return send(res, 400, { error: 'their_squad_full', detail: `${target.display_name || targetId}'s squad is already full.` });

  const ok = await linkSquadMembers(req.userId, targetId);
  return send(res, 200, { ok, addedName: target.display_name || targetId });
}

export default withAuth(handler);
