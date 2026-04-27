// lib/db.js — Postgres adapter using `pg` with a connection pool.
// Designed for a long-running Node process (Fastify on App Runner / ECS).
// One pool per process, reused across all requests. NOT for serverless.

import pg from 'pg';
const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. See AWS_DEPLOY.md.');
}

// SSL is required by RDS in production. Set DATABASE_SSL=disable only for local dev
// without TLS (e.g., docker-compose Postgres without certs).
const useSsl = (process.env.DATABASE_SSL || 'require') !== 'disable';
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  console.error('[pg] idle client error', err);
});

// Tagged-template helper so call sites read like the Neon version.
// Usage:  await sql`SELECT * FROM users WHERE id = ${id}`;
export function sql(strings, ...values) {
  const text = strings.reduce((acc, str, i) => {
    return acc + str + (i < values.length ? `$${i + 1}` : '');
  }, '');
  return pool.query(text, values).then(r => r.rows);
}

// ---------- migrations ----------
let migrated = false;
export async function ensureSchema() {
  if (migrated) return;
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS lectures (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      scheduled_date DATE NOT NULL,
      scheduled_start TIMESTAMPTZ NOT NULL,
      scheduled_duration_min INTEGER NOT NULL DEFAULT 120,
      subject TEXT NOT NULL,
      topic TEXT NOT NULL,
      sub_topic TEXT,
      status TEXT,
      status_changed_at TIMESTAMPTZ,
      actual_minutes INTEGER
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_lect_user_date ON lectures(user_id, scheduled_date)`;
  await sql`
    CREATE TABLE IF NOT EXISTS streak_state (
      user_id TEXT PRIMARY KEY REFERENCES users(id),
      current_count INTEGER NOT NULL DEFAULT 0,
      longest INTEGER NOT NULL DEFAULT 0,
      last_streak_day DATE,
      freezes_used_this_month INTEGER NOT NULL DEFAULT 0,
      freeze_month TEXT,
      total_xp INTEGER NOT NULL DEFAULT 0,
      sessions_completed INTEGER NOT NULL DEFAULT 0
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS reward_events (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      xp INTEGER NOT NULL DEFAULT 0,
      payload JSONB,
      day_local DATE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_rev_user_day ON reward_events(user_id, day_local)`;
  await sql`
    CREATE TABLE IF NOT EXISTS reflections (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      lecture_id BIGINT NOT NULL,
      text TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  migrated = true;
}

// ---------- queries ----------

export async function getUser(id) {
  const rows = await sql`SELECT * FROM users WHERE id = ${id}`;
  return rows[0] || null;
}

export async function ensureUser(id = 'demo', displayName = 'Arjun') {
  const existing = await getUser(id);
  if (existing) return existing;
  await sql`INSERT INTO users (id, display_name) VALUES (${id}, ${displayName}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO streak_state (user_id) VALUES (${id}) ON CONFLICT (user_id) DO NOTHING`;
  return await getUser(id);
}

export async function getStreakState(userId) {
  const rows = await sql`SELECT * FROM streak_state WHERE user_id = ${userId}`;
  return rows[0] || null;
}

export async function saveStreakState(userId, s) {
  await sql`
    UPDATE streak_state SET
      current_count = ${s.current},
      longest = ${s.longest},
      last_streak_day = ${s.lastStreakDay},
      freezes_used_this_month = ${s.freezesUsedThisMonth || 0},
      freeze_month = ${s.freezeMonth || null},
      total_xp = ${s.totalXp || 0},
      sessions_completed = ${s.sessionsCompleted || 0}
    WHERE user_id = ${userId}
  `;
}

export async function getLecturesInRange(userId, fromDate, toDate) {
  return await sql`
    SELECT * FROM lectures
    WHERE user_id = ${userId} AND scheduled_date BETWEEN ${fromDate} AND ${toDate}
    ORDER BY scheduled_start ASC
  `;
}

export async function getLecture(id) {
  const rows = await sql`SELECT * FROM lectures WHERE id = ${id}`;
  return rows[0] || null;
}

export async function setLectureStatus(id, status, when) {
  await sql`
    UPDATE lectures SET status = ${status}, status_changed_at = ${when.toISOString()}
    WHERE id = ${id}
  `;
}

export async function logRewardEvent(userId, type, xp, payload, dayLocal) {
  await sql`
    INSERT INTO reward_events (user_id, type, xp, payload, day_local)
    VALUES (${userId}, ${type}, ${xp}, ${JSON.stringify(payload || {})}::jsonb, ${dayLocal})
  `;
}

export async function rewardEventsToday(userId, dayLocal) {
  return await sql`
    SELECT * FROM reward_events
    WHERE user_id = ${userId} AND day_local = ${dayLocal}
  `;
}

export async function saveReflection(userId, lectureId, text) {
  await sql`
    INSERT INTO reflections (user_id, lecture_id, text)
    VALUES (${userId}, ${lectureId}, ${text})
  `;
}

export async function getReflections(userId, limit = 20) {
  return await sql`
    SELECT r.*, l.subject, l.topic FROM reflections r
    JOIN lectures l ON l.id = r.lecture_id
    WHERE r.user_id = ${userId}
    ORDER BY r.created_at DESC LIMIT ${limit}
  `;
}

export async function lectureCount(userId) {
  const rows = await sql`SELECT COUNT(*)::int AS c FROM lectures WHERE user_id = ${userId}`;
  return rows[0].c;
}

export async function rewardEvents30d(userId, fromDate) {
  return await sql`
    SELECT type, SUM(xp)::int AS xp, COUNT(*)::int AS c
    FROM reward_events
    WHERE user_id = ${userId} AND day_local >= ${fromDate}
    GROUP BY type
  `;
}

export async function deleteAllForReset() {
  await sql`DELETE FROM reward_events`;
  await sql`DELETE FROM reflections`;
  await sql`DELETE FROM lectures`;
  await sql`DELETE FROM streak_state`;
  await sql`DELETE FROM users`;
}

export function rowToStreakState(row) {
  if (!row) return null;
  const lsd = row.last_streak_day instanceof Date
    ? row.last_streak_day.toISOString().slice(0, 10)
    : row.last_streak_day;
  return {
    current: row.current_count,
    longest: row.longest,
    lastStreakDay: lsd,
    freezesUsedThisMonth: row.freezes_used_this_month,
    freezeMonth: row.freeze_month,
    totalXp: row.total_xp,
    sessionsCompleted: row.sessions_completed,
  };
}
