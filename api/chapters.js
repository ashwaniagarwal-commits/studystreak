// /api/chapters
//   GET   → all 477 sessions grouped by subject → topic → sessions[],
//           merged with the user's per-session status. Plus per-subject totals.
//   PATCH → update a single session's status. Body:
//             { subject, topic, sessionNum, subTopic?, status }
//
// Internal naming: keeps the path /api/chapters and label "Topics" in UI.
// The legacy chapter_progress table is unused on this path; we now write to
// session_progress.

import { init, readJsonBody, send, methodNotAllowed } from '../lib/api.js';
import { withAuth } from '../lib/auth.js';
import { getSessionProgress, upsertSessionProgress } from '../lib/db.js';
import { TOPIC_PLAN, STATUSES } from '../lib/chapters.js';

const VALID = new Set(STATUSES);

function findTopic(subject, topic) {
  const list = TOPIC_PLAN[subject];
  if (!list) return null;
  return list.find(t => t.topic === topic) || null;
}

async function handler(req, res) {
  await init();

  if (req.method === 'GET') {
    const progress = await getSessionProgress(req.userId);
    const byKey = new Map();
    for (const p of progress) {
      const k = `${p.subject}::${p.topic}::${p.session_num}`;
      byKey.set(k, {
        status: p.status,
        updatedAt: p.updated_at instanceof Date ? p.updated_at.toISOString() : p.updated_at,
      });
    }

    // Build response: subject → list of { topic, totalSessions, completed, inProgress, sessions: [...] }
    const grouped = {};
    const totals = {};
    for (const [subject, topics] of Object.entries(TOPIC_PLAN)) {
      grouped[subject] = [];
      let subjectTotal = 0;
      let subjectCompleted = 0;
      let subjectInProgress = 0;
      for (const tp of topics) {
        const sessions = tp.sessions.map(s => {
          const k = `${subject}::${tp.topic}::${s.sessionNum}`;
          const cur = byKey.get(k);
          return {
            sessionNum: s.sessionNum,
            subTopic: s.subTopic,
            status: cur?.status || 'Not Started',
            updatedAt: cur?.updatedAt || null,
          };
        });
        const completed = sessions.filter(s => s.status === 'Completed').length;
        const inProgress = sessions.filter(s => s.status === 'In Progress').length;
        subjectTotal += sessions.length;
        subjectCompleted += completed;
        subjectInProgress += inProgress;
        grouped[subject].push({
          topic: tp.topic,
          totalSessions: sessions.length,
          completed,
          inProgress,
          sessions,
        });
      }
      totals[subject] = {
        total: subjectTotal,
        completed: subjectCompleted,
        inProgress: subjectInProgress,
      };
    }

    return send(res, 200, { grouped, totals });
  }

  if (req.method === 'PATCH') {
    const body = await readJsonBody(req);
    const { subject, topic, sessionNum, status } = body || {};
    if (!TOPIC_PLAN[subject]) return send(res, 400, { error: 'unknown_subject' });
    const tp = findTopic(subject, topic);
    if (!tp) return send(res, 400, { error: 'unknown_topic' });
    const session = tp.sessions.find(s => s.sessionNum === sessionNum);
    if (!session) return send(res, 400, { error: 'unknown_session' });
    if (!VALID.has(status)) return send(res, 400, { error: 'invalid_status', allowed: STATUSES });

    await upsertSessionProgress(req.userId, subject, topic, sessionNum, session.subTopic, status);
    return send(res, 200, { ok: true });
  }

  return methodNotAllowed(res, ['GET', 'PATCH']);
}

export default withAuth(handler);
