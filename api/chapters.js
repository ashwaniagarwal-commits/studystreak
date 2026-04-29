// /api/chapters
//   GET   → list chapters with the current user's progress merged in
//   PATCH → update a single chapter's status

import { init, readJsonBody, send, methodNotAllowed } from '../lib/api.js';
import { withAuth } from '../lib/auth.js';
import { getChapterProgress, upsertChapterProgress } from '../lib/db.js';
import { CHAPTER_PLAN, STATUSES, flatChapterList } from '../lib/chapters.js';

const VALID = new Set(STATUSES);

async function handler(req, res) {
  await init();

  if (req.method === 'GET') {
    const progress = await getChapterProgress(req.userId);
    const byKey = new Map();
    for (const p of progress) {
      byKey.set(`${p.subject}::${p.chapter}`, {
        status: p.status,
        updatedAt: p.updated_at instanceof Date ? p.updated_at.toISOString() : p.updated_at,
      });
    }

    const list = flatChapterList().map(c => {
      const key = `${c.subject}::${c.chapter}`;
      const cur = byKey.get(key);
      return {
        subject: c.subject,
        chapter: c.chapter,
        status: cur?.status || 'Not Started',
        updatedAt: cur?.updatedAt || null,
      };
    });

    // Group by subject for the UI's convenience
    const grouped = {};
    for (const c of list) {
      if (!grouped[c.subject]) grouped[c.subject] = [];
      grouped[c.subject].push(c);
    }

    const totals = {};
    for (const [subject, chapters] of Object.entries(grouped)) {
      const completed = chapters.filter(c => c.status === 'Completed').length;
      const inProgress = chapters.filter(c => c.status === 'In Progress').length;
      totals[subject] = { total: chapters.length, completed, inProgress };
    }

    return send(res, 200, { grouped, totals });
  }

  if (req.method === 'PATCH') {
    const body = await readJsonBody(req);
    const { subject, chapter, status } = body || {};
    if (!CHAPTER_PLAN[subject]) return send(res, 400, { error: 'unknown_subject' });
    if (!CHAPTER_PLAN[subject].includes(chapter)) return send(res, 400, { error: 'unknown_chapter' });
    if (!VALID.has(status)) return send(res, 400, { error: 'invalid_status', allowed: STATUSES });

    await upsertChapterProgress(req.userId, subject, chapter, status);
    return send(res, 200, { ok: true });
  }

  return methodNotAllowed(res, ['GET', 'PATCH']);
}

export default withAuth(handler);
