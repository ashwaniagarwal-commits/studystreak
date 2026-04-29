import { init, userIdOf, readJsonBody, send, methodNotAllowed } from '../../../lib/api.js';
import * as streakEngine from '../../../lib/streak-engine.js';
import * as rewardEngine from '../../../lib/reward-engine.js';
import {
  getLecture, setLectureStatus, getStreakState, saveStreakState, rowToStreakState,
  rewardEventsToday, logRewardEvent,
} from '../../../lib/db.js';

const TZ = 'Asia/Kolkata';
const VALID_STATUS = new Set(['Done', 'Partial', 'Backlog', 'Revised']);

function ensureMonthRollover(state, now) {
  const monthKey = streakEngine.localDayKey(now, TZ).slice(0, 7);
  if (state.freezeMonth !== monthKey) {
    return { ...state, freezesUsedThisMonth: 0, freezeMonth: monthKey };
  }
  return state;
}

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH']);
  await init();

  const id = Number(req.query.id);
  const body = await readJsonBody(req);
  const status = body?.status;
  if (!VALID_STATUS.has(status)) return send(res, 400, { error: 'invalid_status', allowed: [...VALID_STATUS] });

  const lec = await getLecture(id);
  if (!lec) return send(res, 404, { error: 'not_found' });

  const userId = lec.user_id;
  const now = new Date();
  await setLectureStatus(id, status, now);

  let state = rowToStreakState(await getStreakState(userId));
  state = ensureMonthRollover(state, now);

  let streakChanged = false;
  let reward = null;
  const dayKey = streakEngine.localDayKey(now, TZ);

  if (status === 'Done') {
    const prevStreak = state.current;
    const r = streakEngine.applyDone(state, now, TZ);
    state = r.state;
    state.sessionsCompleted = (state.sessionsCompleted || 0) + 1;
    streakChanged = r.incremented;
    if (r.incremented) {
      await logRewardEvent(userId, 'streak_inc', 0, { newStreak: state.current }, dayKey);
    }

    const todayEvents = await rewardEventsToday(userId, dayKey);
    const droppedToday = todayEvents.some(e => e.type === 'mystery_box');

    const roll = rewardEngine.rollMysteryBox({
      streakDays: prevStreak,
      sessionsCompleted: state.sessionsCompleted,
      alreadyDroppedToday: droppedToday,
    });

    if (roll.drops) {
      state.totalXp = (state.totalXp || 0) + roll.xp;
      reward = { type: 'mystery_box', xp: roll.xp, p: roll.p };
      await logRewardEvent(userId, 'mystery_box', roll.xp, { p: roll.p }, dayKey);
    } else {
      reward = { type: null, reason: roll.reason, p: roll.p };
    }
  }

  await saveStreakState(userId, state);
  const updated = await getLecture(id);
  return send(res, 200, {
    ok: true,
    lecture: {
      ...updated,
      scheduled_start: updated.scheduled_start instanceof Date ? updated.scheduled_start.toISOString() : updated.scheduled_start,
      scheduled_date: updated.scheduled_date instanceof Date ? updated.scheduled_date.toISOString().slice(0, 10) : updated.scheduled_date,
    },
    streakChanged,
    streak: state.current,
    longestStreak: state.longest,
    totalXp: state.totalXp,
    reward,
  });
}
