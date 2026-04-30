// GET /api/admin/students/[id]?admin=<password> → full drill-in for one student
import { init, send, methodNotAllowed } from '../../../lib/api.js';
import { withAdmin } from '../../../lib/auth.js';
import { getStudentSummary, getSquad, cheersBetween } from '../../../lib/db.js';
import { TOPIC_PLAN } from '../../../lib/chapters.js';

async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  await init();

  const id = req.query?.id;
  if (!id) return send(res, 400, { error: 'missing_id' });

  const summary = await getStudentSummary(id);
  if (!summary) return send(res, 404, { error: 'not_found' });

  // Roll up 477-session view into topic-level rows for the admin display:
  // status = 'Completed' if all sessions in topic are Completed,
  //          'In Progress' if any session is In Progress or Completed (partial),
  //          else 'Not Started'.
  const sessByKey = new Map();
  for (const s of summary.sessions || []) {
    sessByKey.set(`${s.subject}::${s.topic}::${s.session_num}`, s);
  }
  const fullChapters = [];
  for (const [subject, topics] of Object.entries(TOPIC_PLAN)) {
    for (const tp of topics) {
      let completed = 0, started = 0, lastUpdate = null;
      for (const s of tp.sessions) {
        const cur = sessByKey.get(`${subject}::${tp.topic}::${s.sessionNum}`);
        if (cur) {
          if (cur.status === 'Completed') completed++;
          if (cur.status === 'Completed' || cur.status === 'In Progress') started++;
          if (cur.updated_at) {
            const t = cur.updated_at instanceof Date ? cur.updated_at.toISOString() : cur.updated_at;
            if (!lastUpdate || t > lastUpdate) lastUpdate = t;
          }
        }
      }
      let status = 'Not Started';
      if (completed === tp.sessions.length) status = 'Completed';
      else if (started > 0) status = 'In Progress';
      fullChapters.push({
        subject,
        chapter: tp.topic,
        status,
        progress: `${completed}/${tp.sessions.length}`,
        updatedAt: lastUpdate,
      });
    }
  }

  // v0.6 additions: squad + cheers
  const squad = await getSquad(id);
  const cheers = await cheersBetween(id);

  return send(res, 200, {
    user: {
      ...summary.user,
      created_at: summary.user.created_at instanceof Date ? summary.user.created_at.toISOString() : summary.user.created_at,
      last_streak_day: summary.user.last_streak_day instanceof Date ? summary.user.last_streak_day.toISOString().slice(0, 10) : summary.user.last_streak_day,
    },
    chapters: fullChapters,
    lectureCounts: summary.lectureCounts,
    reflections: summary.reflections.map(r => ({ ...r, created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at })),
    squad: squad.map(m => ({
      studentId: m.id,
      displayName: m.display_name,
      currentStreak: m.current_streak || 0,
      totalXp: m.total_xp || 0,
    })),
    cheers,
  });
}

export default withAdmin(handler);
