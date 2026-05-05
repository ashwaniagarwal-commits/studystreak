// GET /api/admin/students?admin=<password> → list of all students with summary stats
import { init, send, methodNotAllowed } from '../../lib/api.js';
import { withAdmin } from '../../lib/auth.js';
import { listAllUsers, getSessionProgress, sql } from '../../lib/db.js';
import { totalSessionCount } from '../../lib/chapters.js';

async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  await init();

  const users = await listAllUsers();
  const totalChapters = totalSessionCount();

  const enriched = await Promise.all(users.map(async (u) => {
    const progress = await getSessionProgress(u.id);
    const completed = progress.filter(p => p.status === 'Completed').length;
    const inProgress = progress.filter(p => p.status === 'In Progress').length;
    return {
      studentId: u.id,
      displayName: u.display_name,
      batch: u.batch,
      createdAt: u.created_at instanceof Date ? u.created_at.toISOString() : u.created_at,
      currentStreak: u.current_streak || 0,
      longest: u.longest || 0,
      totalXp: u.total_xp || 0,
      sessionsCompleted: u.sessions_completed || 0,
      chapters: { total: totalChapters, completed, inProgress },
    };
  }));

  // Squad attach %: users with ≥1 squad link / total users
  let squadAttachPct = 0;
  if (enriched.length > 0) {
    const r = await sql`SELECT COUNT(DISTINCT user_id)::int AS c FROM squad_links`;
    const linked = r[0]?.c || 0;
    squadAttachPct = Math.round((linked / enriched.length) * 100);
  }

  return send(res, 200, { students: enriched, totalChapters, squadAttachPct });
}

export default withAdmin(handler);
