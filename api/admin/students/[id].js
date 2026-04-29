// GET /api/admin/students/[id]?admin=<password> → full drill-in for one student
import { init, send, methodNotAllowed } from '../../../lib/api.js';
import { withAdmin } from '../../../lib/auth.js';
import { getStudentSummary } from '../../../lib/db.js';
import { flatChapterList } from '../../../lib/chapters.js';

async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  await init();

  const id = req.query?.id;
  if (!id) return send(res, 400, { error: 'missing_id' });

  const summary = await getStudentSummary(id);
  if (!summary) return send(res, 404, { error: 'not_found' });

  // Merge chapter progress with master list so we always show all chapters.
  const byKey = new Map();
  for (const p of summary.chapters) {
    byKey.set(`${p.subject}::${p.chapter}`, p);
  }
  const fullChapters = flatChapterList().map(c => {
    const cur = byKey.get(`${c.subject}::${c.chapter}`);
    return {
      subject: c.subject,
      chapter: c.chapter,
      status: cur?.status || 'Not Started',
      updatedAt: cur?.updated_at instanceof Date ? cur.updated_at.toISOString() : cur?.updated_at || null,
    };
  });

  return send(res, 200, {
    user: {
      ...summary.user,
      created_at: summary.user.created_at instanceof Date ? summary.user.created_at.toISOString() : summary.user.created_at,
      last_streak_day: summary.user.last_streak_day instanceof Date ? summary.user.last_streak_day.toISOString().slice(0, 10) : summary.user.last_streak_day,
    },
    chapters: fullChapters,
    lectureCounts: summary.lectureCounts,
    reflections: summary.reflections.map(r => ({ ...r, created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at })),
  });
}

export default withAdmin(handler);
