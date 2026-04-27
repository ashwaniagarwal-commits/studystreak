// server/server.js — Fastify app for AWS App Runner / ECS Fargate.
// One process, one Postgres pool, all routes in one file. Serves /api/* and
// the static frontend from public/.

import Fastify from 'fastify';
import staticPlugin from '@fastify/static';
import cors from '@fastify/cors';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import * as streakEngine from '../lib/streak-engine.js';
import * as priorityEngine from '../lib/priority-engine.js';
import * as rewardEngine from '../lib/reward-engine.js';
import {
  ensureSchema, getUser, ensureUser,
  getStreakState, saveStreakState, rowToStreakState,
  getLecturesInRange, getLecture, setLectureStatus,
  logRewardEvent, rewardEventsToday,
  saveReflection, getReflections,
  rewardEvents30d, deleteAllForReset,
} from '../lib/db.js';
import { seedIfEmpty } from '../lib/seed.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TZ = 'Asia/Kolkata';
const VALID_STATUS = new Set(['Done', 'Partial', 'Backlog', 'Revised']);

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL || 'info' },
  trustProxy: true,
});

await app.register(cors, { origin: true });
await app.register(staticPlugin, {
  root: resolve(__dirname, '..', 'public'),
  prefix: '/',
});

// ---------- bootstrap (run once at startup) ----------
await ensureSchema();
await ensureUser('demo', 'Arjun');
await seedIfEmpty('demo');

// ---------- helpers ----------
const userIdOf = req => (req.query && req.query.userId) || 'demo';
const todayLocal = () => streakEngine.localDayKey(new Date(), TZ);
const ensureMonthRollover = (state, now) => {
  const monthKey = streakEngine.localDayKey(now, TZ).slice(0, 7);
  if (state.freezeMonth !== monthKey) {
    return { ...state, freezesUsedThisMonth: 0, freezeMonth: monthKey };
  }
  return state;
};
const normalizeLecture = l => ({
  ...l,
  scheduled_start: l.scheduled_start instanceof Date ? l.scheduled_start.toISOString() : l.scheduled_start,
  scheduled_date: l.scheduled_date instanceof Date ? l.scheduled_date.toISOString().slice(0, 10) : l.scheduled_date,
});

// ---------- health (App Runner pings this) ----------
app.get('/healthz', async () => ({ ok: true, ts: new Date().toISOString() }));

// ---------- routes ----------

app.get('/api/today', async (req) => {
  const userId = userIdOf(req);
  const today = todayLocal();
  const lectures = await getLecturesInRange(userId, today, today);
  const state = rowToStreakState(await getStreakState(userId));
  const user = await getUser(userId);

  const total = lectures.length;
  const done = lectures.filter(l => l.status === 'Done' || l.status === 'Revised').length;

  return {
    user: { id: userId, displayName: user?.display_name },
    today,
    lectures: lectures.map(normalizeLecture),
    summary: {
      total, done,
      progress: total ? done / total : 0,
      streak: state.current,
      longestStreak: state.longest,
      totalXp: state.totalXp,
    },
  };
});

app.get('/api/lectures', async (req) => {
  const userId = userIdOf(req);
  let { from, to } = req.query || {};
  if (!from || !to) { const t = todayLocal(); from = to = t; }
  const list = await getLecturesInRange(userId, from, to);
  return list.map(normalizeLecture);
});

app.patch('/api/lectures/:id/status', async (req, reply) => {
  const id = Number(req.params.id);
  const status = req.body?.status;
  if (!VALID_STATUS.has(status)) {
    reply.code(400);
    return { error: 'invalid_status', allowed: [...VALID_STATUS] };
  }
  const lec = await getLecture(id);
  if (!lec) { reply.code(404); return { error: 'not_found' }; }

  const userId = lec.user_id;
  const now = new Date();
  await setLectureStatus(id, status, now);

  let state = rowToStreakState(await getStreakState(userId));
  state = ensureMonthRollover(state, now);

  let streakChanged = false;
  let reward = null;
  const dayKey = todayLocal();

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
  return {
    ok: true,
    lecture: normalizeLecture(await getLecture(id)),
    streakChanged,
    streak: state.current,
    longestStreak: state.longest,
    totalXp: state.totalXp,
    reward,
  };
});

app.get('/api/streak', async (req) => {
  return rowToStreakState(await getStreakState(userIdOf(req)));
});

app.get('/api/backlog', async (req) => {
  const userId = userIdOf(req);
  const now = new Date();
  const fmt = d => streakEngine.localDayKey(d, TZ);
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

  return {
    top: top.map(l => ({ ...l, scheduled_start: l.scheduledAt, scheduled_date: l.scheduled_date instanceof Date ? l.scheduled_date.toISOString().slice(0, 10) : l.scheduled_date })),
    backlogCount: ceiling.kept.length + ceiling.deferred.length,
    backlogKept: ceiling.kept.length,
    backlogDeferred: ceiling.deferred.length,
    subjectGaps: gaps,
  };
});

app.get('/api/reflections', async (req) => {
  const list = await getReflections(userIdOf(req), 20);
  return list.map(r => ({ ...r, created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at }));
});

app.post('/api/reflections', async (req, reply) => {
  const userId = userIdOf(req);
  const { lectureId, text } = req.body || {};
  if (!lectureId || !text || text.length > 500) {
    reply.code(400);
    return { error: 'invalid_reflection' };
  }
  await saveReflection(userId, Number(lectureId), text);
  const state = rowToStreakState(await getStreakState(userId));
  state.totalXp = (state.totalXp || 0) + 20;
  await saveStreakState(userId, state);
  await logRewardEvent(userId, 'reflection_xp', 20, { lectureId }, todayLocal());
  return { ok: true, xpAwarded: 20, totalXp: state.totalXp };
});

app.get('/api/dashboard', async (req) => {
  const userId = userIdOf(req);
  const state = rowToStreakState(await getStreakState(userId));
  const start = new Date(); start.setDate(start.getDate() - 30);
  const fmt = d => streakEngine.localDayKey(d, TZ);
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
  return {
    streak: { current: state.current, longest: state.longest, totalXp: state.totalXp, sessions: state.sessionsCompleted, freezesUsed: state.freezesUsedThisMonth },
    coverage: { total, done, partial, backlog, completionPct: total ? done / total : 0, backlogPct: total ? backlog / total : 0 },
    subjects,
    rewards30d: events,
  };
});

app.post('/api/__reset', async (req, reply) => {
  if (process.env.ALLOW_RESET !== '1') {
    reply.code(403);
    return { error: 'reset_disabled' };
  }
  await deleteAllForReset();
  await ensureUser('demo', 'Arjun');
  const seeded = await seedIfEmpty('demo');
  return { ok: true, seeded };
});

// ---------- start ----------
const PORT = Number(process.env.PORT || 8080);
app.listen({ port: PORT, host: '0.0.0.0' }, (err, address) => {
  if (err) { app.log.error(err); process.exit(1); }
  app.log.info(`StudyStreak ready at ${address}`);
});

// Graceful shutdown so App Runner can rotate cleanly
['SIGTERM', 'SIGINT'].forEach(s => process.on(s, async () => {
  app.log.info(`received ${s}, draining`);
  await app.close();
  process.exit(0);
}));
