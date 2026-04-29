import { init, userIdOf, send, methodNotAllowed } from '../lib/api.js';
import * as priorityEngine from '../lib/priority-engine.js';
import { localDayKey } from '../lib/streak-engine.js';
import { getLecturesInRange } from '../lib/db.js';

const TZ = 'Asia/Kolkata';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  await init();
  const userId = userIdOf(req);
  const now = new Date();
  const fmt = d => localDayKey(d, TZ);
  const start = new Date(); start.setDate(start.getDate() - 30);
  const end = new Date(); end.setDate(end.getDate() + 7);
  const lectures = await getLecturesInRange(userId, fmt(start), fmt(end));

  const bySubject = {};
  for (const l of lectures) {
    if (!bySubject[l.subject]) bySubject[l.subject] = { total: 0, done: 0 };
    bySubject[l.subject].total++;
    if (l.status === 'Done' || l.status === 'Revised') bySubject[l.subject].done++;
  }
  const gaps = {};
  for (const [s, v] of Object.entries(bySubject)) {
    gaps[s] = v.total ? Math.max(0, 1 - v.done / v.total) : 0;
  }

  const candidates = lectures
    .map(l => ({ ...l, scheduledAt: l.scheduled_start instanceof Date ? l.scheduled_start.toISOString() : l.scheduled_start }))
    .filter(l => new Date(l.scheduledAt) < now)
    .filter(l => l.status !== 'Done' && l.status !== 'Revised');

  const ranked = priorityEngine.rankBacklog(candidates, now, gaps);
  const ceiling = priorityEngine.applyBacklogCeiling(
    ranked.filter(l => l.status === 'Backlog'), 6
  );
  const top = priorityEngine.topPicks(ranked, 3);

  return send(res, 200, {
    top: top.map(l => ({ ...l, scheduled_start: l.scheduledAt, scheduled_date: l.scheduled_date instanceof Date ? l.scheduled_date.toISOString().slice(0, 10) : l.scheduled_date })),
    backlogCount: ceiling.kept.length + ceiling.deferred.length,
    backlogKept: ceiling.kept.length,
    backlogDeferred: ceiling.deferred.length,
    subjectGaps: gaps,
  });
}
