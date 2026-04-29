// GET  /api/squad/cheers → cheers received (last 30) + unread marked read
// POST /api/squad/cheers/read → explicitly mark all read
import { init, send, methodNotAllowed } from '../../lib/api.js';
import { withAuth } from '../../lib/auth.js';
import { cheersForUser, markCheersRead } from '../../lib/db.js';

async function handler(req, res) {
  await init();

  if (req.method === 'GET') {
    const list = await cheersForUser(req.userId, 30);
    // Auto-mark as read on view
    await markCheersRead(req.userId);
    return send(res, 200, {
      cheers: list.map(c => ({
        id: c.id,
        from: c.from_user,
        fromName: c.from_name,
        message: c.message,
        createdAt: c.created_at instanceof Date ? c.created_at.toISOString() : c.created_at,
        readAt: c.read_at ? (c.read_at instanceof Date ? c.read_at.toISOString() : c.read_at) : null,
      })),
    });
  }

  return methodNotAllowed(res, ['GET']);
}

export default withAuth(handler);
