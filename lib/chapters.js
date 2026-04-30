// lib/chapters.js — master session list (477 entries) sourced from
// Study Planner 2 / Session_Log.csv. Each entry is one tracked session.
//
// The structure is two-level: subject → list of topics, each topic has
// an array of sessions (with subTopic + sessionNum). Sessions are the
// trackable unit; topics are display groupings.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(resolve(__dirname, 'topics-data.json'), 'utf8');

/**
 * Shape:
 * {
 *   Physics: [
 *     { topic: 'Motion in a straight line', sessions: [
 *       { sessionNum: 1, subTopic: 'Introduction to kinematics ...' },
 *       { sessionNum: 2, subTopic: 'Average and Instantaneous Velocity ...' },
 *       ...
 *     ] },
 *     ...
 *   ],
 *   Math: [...],
 *   Chemistry: [...],
 * }
 */
export const TOPIC_PLAN = JSON.parse(raw);

// Back-compat for older callers expecting CHAPTER_PLAN shape
// (subject → string[] of chapter names)
export const CHAPTER_PLAN = Object.fromEntries(
  Object.entries(TOPIC_PLAN).map(([s, tps]) => [s, tps.map(t => t.topic)])
);

export const STATUSES = ['Not Started', 'In Progress', 'Completed'];

/**
 * Flat array of every session (477 entries).
 * Each: { subject, topic, sessionNum, subTopic, key }
 * `key` uniquely identifies a session: `${subject}::${topic}::${sessionNum}`.
 */
export function flatSessionList() {
  const out = [];
  for (const [subject, topics] of Object.entries(TOPIC_PLAN)) {
    for (const tp of topics) {
      for (const s of tp.sessions) {
        out.push({
          subject,
          topic: tp.topic,
          sessionNum: s.sessionNum,
          subTopic: s.subTopic,
          key: `${subject}::${tp.topic}::${s.sessionNum}`,
        });
      }
    }
  }
  return out;
}

/**
 * Back-compat. Older code uses flatChapterList() expecting (subject, chapter)
 * pairs at TOPIC granularity, not session granularity. Keep this for any
 * remaining call sites; new code should use flatSessionList().
 */
export function flatChapterList() {
  const out = [];
  for (const [subject, topics] of Object.entries(TOPIC_PLAN)) {
    for (const tp of topics) {
      out.push({ subject, chapter: tp.topic });
    }
  }
  return out;
}

export function totalSessionCount() {
  return flatSessionList().length;
}

export function totalsBySubject() {
  const out = {};
  for (const [subject, topics] of Object.entries(TOPIC_PLAN)) {
    let count = 0;
    for (const tp of topics) count += tp.sessions.length;
    out[subject] = { totalTopics: topics.length, totalSessions: count };
  }
  return out;
}
