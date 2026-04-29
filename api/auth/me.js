import { init, send, methodNotAllowed } from '../../lib/api.js';
import { readSessionCookie, verifySessionToken } from '../../lib/auth.js';
import { getUser } from '../../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  await init();

  const token = readSessionCookie(req);
  const session = verifySessionToken(token);
  if (!session) return send(res, 200, { authenticated: false });

  const user = await getUser(session.sub);
  if (!user) return send(res, 200, { authenticated: false });

  return send(res, 200, {
    authenticated: true,
    userId: user.id,
    displayName: user.display_name,
    batch: user.batch || null,
  });
}
