// GET /api/admin/activity?admin=PWD&window=24h|7d|30d
// Returns DAU/WAU/MAU counts + the active user list for the requested window.
import { init, send, methodNotAllowed } from '../../lib/api.js';
import { withAdmin } from '../../lib/auth.js';
import { getActivityCounts, getActiveUsersList } from '../../lib/db.js';

const WIN = { '24h': '24 hours', '7d': '7 days', '30d': '30 days' };

async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  await init();

  const w = req.query?.window || '30d';
  const window = WIN[w] || '30 days';

  const [counts, users] = await Promise.all([
    getActivityCounts(),
    getActiveUsersList(window, 200),
  ]);

  return send(res, 200, {
    counts,
    window,
    users: users.map(u => ({
      studentId: u.id,
      displayName: u.display_name,
      batch: u.batch,
      lastActiveAt: u.last_active_at instanceof Date ? u.last_active_at.toISOString() : u.last_active_at,
      currentStreak: u.current_streak || 0,
      totalXp: u.total_xp || 0,
      sessionsCompleted: u.sessions_completed || 0,
    })),
  });
}

export default withAdmin(handler);
