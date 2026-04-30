// lib/seed.js — bulk-load the actual Eklavya 2027 lecture plan into the
// `lectures` table for a new user. Each row in lectures-data.json becomes one
// row in the lectures table, on its actual scheduled date.
//
// Idempotent: returns false without inserting if user already has lectures.

import { sql, ensureUser, lectureCount } from './db.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LECTURES = JSON.parse(
  readFileSync(resolve(__dirname, 'lectures-data.json'), 'utf8')
);

// Bulk-insert in chunks so we don't blow past Neon HTTP body size limits
const CHUNK = 100;

export async function seedIfEmpty(userId = 'demo') {
  await ensureUser(userId, 'Arjun');
  if ((await lectureCount(userId)) > 0) return false;

  for (let i = 0; i < LECTURES.length; i += CHUNK) {
    const slice = LECTURES.slice(i, i + CHUNK);
    // Use UNNEST for one round-trip per chunk
    await sql`
      INSERT INTO lectures (user_id, scheduled_date, scheduled_start, scheduled_duration_min, subject, topic, sub_topic)
      SELECT * FROM UNNEST(
        ${slice.map(() => userId)}::text[],
        ${slice.map(l => l.scheduledDate)}::date[],
        ${slice.map(l => l.scheduledStart)}::timestamptz[],
        ${slice.map(l => l.durationMin)}::int[],
        ${slice.map(l => l.subject)}::text[],
        ${slice.map(l => l.topic)}::text[],
        ${slice.map(l => l.subTopic)}::text[]
      )
    `;
  }

  return true;
}
