import { init, userIdOf, readJsonBody, send, methodNotAllowed } from '../lib/api.js';
import { localDayKey } from '../lib/streak-engine.js';
import {
  saveReflection, getReflections, getStreakState, saveStreakState,
  logRewardEvent, rowToStreakState,
} from '../lib/db.js';

const TZ = 'Asia/Kolkata';

export default async function handler(req, res) {
  await init();
  const userId = userIdOf(req);

  if (req.method === 'GET') {
    const list = await getReflections(userId, 20);
    return send(res, 200, list.map(r => ({ ...r, created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at })));
  }

  if (req.method === 'POST') {
    const body = await readJsonBody(req);
    const { lectureId, text } = body || {};
    if (!lectureId || !text || text.length > 500) {
      return send(res, 400, { error: 'invalid_reflection' });
    }
    await saveReflection(userId, Number(lectureId), text);

    const state = rowToStreakState(await getStreakState(userId));
    state.totalXp = (state.totalXp || 0) + 20;
    await saveStreakState(userId, state);
    await logRewardEvent(userId, 'reflection_xp', 20, { lectureId }, localDayKey(new Date(), TZ));
    return send(res, 200, { ok: true, xpAwarded: 20, totalXp: state.totalXp });
  }

  return methodNotAllowed(res, ['GET', 'POST']);
}
