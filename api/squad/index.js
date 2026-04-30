// GET /api/squad → leaderboard of the current user's squadmates + self at top
import { init, send, methodNotAllowed } from '../../lib/api.js';
import { withAuth } from '../../lib/auth.js';
import {
  getSquad, getStreakState, rowToStreakState, getUser,
  chapterCompletionFor, unreadCheerCount,
} from '../../lib/db.js';
import { flatChapterList } from '../../lib/chapters.js';

async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  await init();

  const userId = req.userId;
  const totalChapters = flatChapterList().length;

  // Self stats
  const me = await getUser(userId);
  const myState = rowToStreakState(await getStreakState(userId));
  const myChapters = await chapterCompletionFor(userId);

  const squad = await getSquad(userId);
  const enriched = await Promise.all(squad.map(async (m) => {
    const chap = await chapterCompletionFor(m.id);
    return {
      studentId: m.id,
      displayName: m.display_name,
      batch: m.batch,
      currentStreak: m.current_streak || 0,
      totalXp: m.total_xp || 0,
      sessionsCompleted: m.sessions_completed || 0,
      chaptersCompleted: chap,
    };
  }));

  // Self row for the leaderboard
  const self = {
    studentId: userId,
    displayName: me?.display_name || userId,
    batch: me?.batch,
    currentStreak: myState.current,
    totalXp: myState.totalXp,
    sessionsCompleted: myState.sessionsCompleted,
    chaptersCompleted: myChapters,
    isSelf: true,
  };

  // Sort by chapters completed (primary), then sessions (tiebreak)
  const all = [self, ...enriched]
    .sort((a, b) => (b.chaptersCompleted - a.chaptersCompleted) || (b.sessionsCompleted - a.sessionsCompleted));

  // Find current user's rank
  const myRank = all.findIndex(r => r.isSelf) + 1;

  const unread = await unreadCheerCount(userId);

  return send(res, 200, {
    squad: all,
    myRank,
    squadSize: enriched.length,
    cap: 8,
    inviteUrl: null, // frontend builds this with window.location
    unreadCheers: unread,
    totalChapters,
  });
}

export default withAuth(handler);
