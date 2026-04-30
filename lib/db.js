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

  // v0.7.2: session-level tracking. Each row is one (subject, topic, sessionNum) tuple.
  // The legacy chapter_progress table stays for back-compat but is unused on the new path.
  await sql`
    CREATE TABLE IF NOT EXISTS session_progress (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      subject TEXT NOT NULL,
      topic TEXT NOT NULL,
      session_num INTEGER,
      sub_topic TEXT,
      status TEXT NOT NULL DEFAULT 'Not Started',
      notes TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, subject, topic, session_num)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_sess_user ON session_progress(user_id)`;

  // v0.6: invited_by column on users + squad links + cheers
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_by TEXT`;
  await sql`
    CREATE TABLE IF NOT EXISTS squad_links (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      squadmate_id TEXT NOT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, squadmate_id)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_squad_user ON squad_links(user_id)`;
  await sql`
    CREATE TABLE IF NOT EXISTS cheers (
      id BIGSERIAL PRIMARY KEY,
      from_user TEXT NOT NULL REFERENCES users(id),
      to_user TEXT NOT NULL REFERENCES users(id),
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      read_at TIMESTAMPTZ
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_cheers_to ON cheers(to_user, created_at DESC)`;

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

export async function createUserWithPassword({ id, displayName, batch, passwordHash, invitedBy }) {
  await sql`
    INSERT INTO users (id, display_name, batch, password_hash, invited_by)
    VALUES (${id}, ${displayName}, ${batch || null}, ${passwordHash}, ${invitedBy || null})
  `;
  await sql`INSERT INTO streak_state (user_id) VALUES (${id}) ON CONFLICT (user_id) DO NOTHING`;
}

// ---------- session progress ----------

export async function getSessionProgress(userId) {
  return await sql`
    SELECT subject, topic, session_num, status, updated_at
    FROM session_progress
    WHERE user_id = ${userId}
  `;
}

export async function upsertSessionProgress(userId, subject, topic, sessionNum, subTopic, status) {
  await sql`
    INSERT INTO session_progress (user_id, subject, topic, session_num, sub_topic, status, updated_at)
    VALUES (${userId}, ${subject}, ${topic}, ${sessionNum}, ${subTopic}, ${status}, NOW())
    ON CONFLICT (user_id, subject, topic, session_num)
    DO UPDATE SET status = EXCLUDED.status, sub_topic = EXCLUDED.sub_topic, updated_at = EXCLUDED.updated_at
  `;
}

export async function sessionsCompletedFor(userId) {
  const rows = await sql`
    SELECT COUNT(*)::int AS c FROM session_progress WHERE user_id = ${userId} AND status = 'Completed'
  `;
  return rows[0].c;
}

// ---------- squad ----------

const SQUAD_CAP = 8;

export async function squadCount(userId) {
  const rows = await sql`SELECT COUNT(*)::int AS c FROM squad_links WHERE user_id = ${userId}`;
  return rows[0].c;
}

export async function linkSquadMembers(userA, userB) {
  if (userA === userB) return;
  const aCount = await squadCount(userA);
  const bCount = await squadCount(userB);
  if (aCount >= SQUAD_CAP || bCount >= SQUAD_CAP) return false;
  await sql`INSERT INTO squad_links (user_id, squadmate_id) VALUES (${userA}, ${userB}) ON CONFLICT DO NOTHING`;
  await sql`INSERT INTO squad_links (user_id, squadmate_id) VALUES (${userB}, ${userA}) ON CONFLICT DO NOTHING`;
  return true;
}

export async function getSquad(userId) {
  return await sql`
    SELECT u.id, u.display_name, u.batch,
           s.current_count AS current_streak, s.longest, s.total_xp, s.sessions_completed
    FROM squad_links sl
    JOIN users u ON u.id = sl.squadmate_id
    LEFT JOIN streak_state s ON s.user_id = u.id
    WHERE sl.user_id = ${userId}
    ORDER BY s.current_count DESC NULLS LAST, s.total_xp DESC NULLS LAST
  `;
}

export async function chapterCompletionFor(userId) {
  const rows = await sql`
    SELECT COUNT(*)::int AS c FROM chapter_progress WHERE user_id = ${userId} AND status = 'Completed'
  `;
  return rows[0].c;
}

// ---------- cheers ----------

export async function sendCheer(fromUser, toUser, message) {
  await sql`
    INSERT INTO cheers (from_user, to_user, message)
    VALUES (${fromUser}, ${toUser}, ${message})
  `;
}

export async function cheersForUser(userId, limit = 30) {
  return await sql`
    SELECT c.id, c.from_user, c.message, c.created_at, c.read_at,
           u.display_name AS from_name
    FROM cheers c
    JOIN users u ON u.id = c.from_user
    WHERE c.to_user = ${userId}
    ORDER BY c.created_at DESC
    LIMIT ${limit}
  `;
}

export async function markCheersRead(userId) {
  await sql`UPDATE cheers SET read_at = NOW() WHERE to_user = ${userId} AND read_at IS NULL`;
}

export async function unreadCheerCount(userId) {
  const rows = await sql`SELECT COUNT(*)::int AS c FROM cheers WHERE to_user = ${userId} AND read_at IS NULL`;
  return rows[0].c;
}

export async function cheersBetween(userId) {
  // For admin: cheers given + received
  const sent = await sql`SELECT COUNT(*)::int AS c FROM cheers WHERE from_user = ${userId}`;
  const received = await sql`SELECT COUNT(*)::int AS c FROM cheers WHERE to_user = ${userId}`;
  return { sent: sent[0].c, received: received[0].c };
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
  // Topic-level rollup from session_progress: Completed if all sessions Done,
  // In Progress if any session in progress / partial, else Not Started.
  const sessions = await sql`
    SELECT subject, topic, session_num, status, updated_at
    FROM session_progress
    WHERE user_id = ${userId}
  `;
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
    sessions,                 // raw 477-session view
    lectureCounts: lecRows,
    reflections: reflectRows,
  };
}

export async function getAdminCsvRows() {
  return await sql`
    SELECT u.id AS student_id, u.display_name, u.batch,
           sp.subject, sp.topic, sp.session_num, sp.sub_topic, sp.status, sp.updated_at
    FROM users u
    LEFT JOIN session_progress sp ON sp.user_id = u.id
    ORDER BY u.id, sp.subject, sp.topic, sp.session_num
  `;
}
