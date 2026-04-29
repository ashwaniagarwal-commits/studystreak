// lib/db.js — Neon Postgres adapter for Vercel serverless functions.
// HTTP transport survives across cold starts and avoids socket-pool issues.

import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Link Neon in the Vercel dashboard or set it in .env.local for `vercel dev`.');
}

export const sql = neon(process.env.DATABASE_URL);

let migrated = false;
export async function ensureSchema() {
  if (migrated) return;
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
      password_hash TEXT,
      batch TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  // Idempotent column adds for existing tables (older deploys)
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS batch TEXT`;
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
  await sql`
    CREATE TABLE IF NOT EXISTS chapter_progress (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      subject TEXT NOT NULL,
      chapter TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Not Started',
      notes TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, subject, chapter)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_chap_user ON chapter_progress(user_id)`;
  migrated = true;
}

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

// ---------- auth-aware user creation ----------

export async function createUserWithPassword({ id, displayName, batch, passwordHash }) {
  await sql`
    INSERT INTO users (id, display_name, batch, password_hash)
    VALUES (${id}, ${displayName}, ${batch || null}, ${passwordHash})
  `;
  await sql`INSERT INTO streak_state (user_id) VALUES (${id}) ON CONFLICT (user_id) DO NOTHING`;
}

// ---------- chapter progress ----------

export async function getChapterProgress(userId) {
  return await sql`
    SELECT subject, chapter, status, updated_at
    FROM chapter_progress
    WHERE user_id = ${userId}
    ORDER BY subject, chapter
  `;
}

export async function upsertChapterProgress(userId, subject, chapter, status) {
  await sql`
    INSERT INTO chapter_progress (user_id, subject, chapter, status, updated_at)
    VALUES (${userId}, ${subject}, ${chapter}, ${status}, NOW())
    ON CONFLICT (user_id, subject, chapter)
    DO UPDATE SET status = EXCLUDED.status, updated_at = EXCLUDED.updated_at
  `;
}

// ---------- admin queries ----------

export async function listAllUsers() {
  return await sql`
    SELECT u.id, u.display_name, u.batch, u.created_at,
           s.current_count AS current_streak, s.longest, s.total_xp, s.sessions_completed
    FROM users u
    LEFT JOIN streak_state s ON s.user_id = u.id
    ORDER BY u.created_at DESC
  `;
}

export async function getStudentSummary(userId) {
  const userRows = await sql`
    SELECT u.id, u.display_name, u.batch, u.created_at,
           s.current_count AS current_streak, s.longest, s.total_xp, s.sessions_completed,
           s.freezes_used_this_month, s.last_streak_day
    FROM users u
    LEFT JOIN streak_state s ON s.user_id = u.id
    WHERE u.id = ${userId}
  `;
  if (!userRows[0]) return null;
  const chapters = await getChapterProgress(userId);
  const lecRows = await sql`
    SELECT subject, status, COUNT(*)::int AS c
    FROM lectures
    WHERE user_id = ${userId}
    GROUP BY subject, status
  `;
  const reflectRows = await sql`
    SELECT id, lecture_id, text, created_at
    FROM reflections
    WHERE user_id = ${userId}
    ORDER BY created_at DESC LIMIT 20
  `;
  return {
    user: userRows[0],
    chapters,
    lectureCounts: lecRows,
    reflections: reflectRows,
  };
}

export async function getAdminCsvRows() {
  return await sql`
    SELECT u.id AS student_id, u.display_name, u.batch,
           cp.subject, cp.chapter, cp.status, cp.updated_at
    FROM users u
    LEFT JOIN chapter_progress cp ON cp.user_id = u.id
    ORDER BY u.id, cp.subject, cp.chapter
  `;
}
