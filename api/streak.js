import { init, userIdOf, send, methodNotAllowed } from '../lib/api.js';
import { getStreakState, rowToStreakState } from '../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  await init();
  const userId = userIdOf(req);
  return send(res, 200, rowToStreakState(await getStreakState(userId)));
}
