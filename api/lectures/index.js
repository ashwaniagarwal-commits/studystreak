import { init, userIdOf, send, methodNotAllowed } from '../../lib/api.js';
import { localDayKey } from '../../lib/streak-engine.js';
import { getLecturesInRange } from '../../lib/db.js';

const TZ = 'Asia/Kolkata';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  await init();
  const userId = userIdOf(req);
  let { from, to } = req.query || {};
  if (!from || !to) {
    const t = localDayKey(new Date(), TZ);
    from = to = t;
  }
  const list = await getLecturesInRange(userId, from, to);
  return send(res, 200, list.map(l => ({
    ...l,
    scheduled_start: l.scheduled_start instanceof Date ? l.scheduled_start.toISOString() : l.scheduled_start,
    scheduled_date: l.scheduled_date instanceof Date ? l.scheduled_date.toISOString().slice(0, 10) : l.scheduled_date,
  })));
}
