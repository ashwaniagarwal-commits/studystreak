import { init, userIdOf, send, methodNotAllowed } from '../lib/api.js';
import { localDayKey } from '../lib/streak-engine.js';
import { getLecturesInRange, getStreakState, getUser, rowToStreakState } from '../lib/db.js';

const TZ = 'Asia/Kolkata';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  await init();

  const userId = userIdOf(req);
  const today = localDayKey(new Date(), TZ);
  const lectures = await getLecturesInRange(userId, today, today);
  const stateRow = await getStreakState(userId);
  const state = rowToStreakState(stateRow);
  const user = await getUser(userId);

  const total = lectures.length;
  const done = lectures.filter(l => l.status === 'Done' || l.status === 'Revised').length;

  // If no lectures today, look up the next future lecture date for messaging
  let nextLectureDate = null;
  if (lectures.length === 0) {
    const rows = await import('../lib/db.js').then(m => m.sql`
      SELECT MIN(scheduled_date) AS next_date
      FROM lectures
      WHERE user_id = ${userId} AND scheduled_date > ${today}
    `);
    const nd = rows[0]?.next_date;
    nextLectureDate = nd instanceof Date ? nd.toISOString().slice(0, 10) : nd;
  }

  return send(res, 200, {
    user: { id: userId, displayName: user?.display_name },
    today,
    lectures: lectures.map(normalizeLecture),
    nextLectureDate,
    summary: {
      total, done,
      progress: total ? done / total : 0,
      streak: state.current,
      longestStreak: state.longest,
      totalXp: state.totalXp,
    },
  });
}

function normalizeLecture(l) {
  return {
    ...l,
    scheduled_start: l.scheduled_start instanceof Date ? l.scheduled_start.toISOString() : l.scheduled_start,
    scheduled_date: l.scheduled_date instanceof Date ? l.scheduled_date.toISOString().slice(0, 10) : l.scheduled_date,
  };
}
