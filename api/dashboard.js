import { init, userIdOf, send, methodNotAllowed } from '../lib/api.js';
import { localDayKey } from '../lib/streak-engine.js';
import { getStreakState, getLecturesInRange, rewardEvents30d, rowToStreakState } from '../lib/db.js';

const TZ = 'Asia/Kolkata';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  await init();
  const userId = userIdOf(req);
  const stateRow = await getStreakState(userId);
  const state = rowToStreakState(stateRow);

  const start = new Date(); start.setDate(start.getDate() - 30);
  const fmt = d => localDayKey(d, TZ);
  const lectures = await getLecturesInRange(userId, fmt(start), fmt(new Date()));

  const total = lectures.length;
  const done = lectures.filter(l => l.status === 'Done' || l.status === 'Revised').length;
  const partial = lectures.filter(l => l.status === 'Partial').length;
  const backlog = lectures.filter(l => l.status === 'Backlog').length;

  const subjects = {};
  for (const l of lectures) {
    if (!subjects[l.subject]) subjects[l.subject] = { total: 0, done: 0, backlog: 0 };
    subjects[l.subject].total++;
    if (l.status === 'Done' || l.status === 'Revised') subjects[l.subject].done++;
    if (l.status === 'Backlog') subjects[l.subject].backlog++;
  }

  const events = await rewardEvents30d(userId, fmt(start));

  return send(res, 200, {
    streak: { current: state.current, longest: state.longest, totalXp: state.totalXp, sessions: state.sessionsCompleted, freezesUsed: state.freezesUsedThisMonth },
    coverage: { total, done, partial, backlog, completionPct: total ? done / total : 0, backlogPct: total ? backlog / total : 0 },
    subjects,
    rewards30d: events,
  });
}
