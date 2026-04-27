// Demo reset endpoint. Only enabled when ALLOW_RESET=1 (off in real prod).
import { init, send, methodNotAllowed } from '../lib/api.js';
import { deleteAllForReset, ensureUser } from '../lib/db.js';
import { seedIfEmpty } from '../lib/seed.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  if (process.env.ALLOW_RESET !== '1') {
    return send(res, 403, { error: 'reset_disabled', hint: 'set ALLOW_RESET=1 in env' });
  }
  await init();
  await deleteAllForReset();
  await ensureUser('demo', 'Arjun');
  const seeded = await seedIfEmpty('demo');
  return send(res, 200, { ok: true, seeded });
}
