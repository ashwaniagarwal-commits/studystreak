// GET /api/admin/export?admin=<password> → CSV download of all students × chapters
import { init, methodNotAllowed } from '../../lib/api.js';
import { withAdmin } from '../../lib/auth.js';
import { getAdminCsvRows } from '../../lib/db.js';

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  await init();

  const rows = await getAdminCsvRows();
  const header = ['student_id', 'display_name', 'batch', 'subject', 'chapter', 'status', 'updated_at'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([
      csvEscape(r.student_id),
      csvEscape(r.display_name),
      csvEscape(r.batch),
      csvEscape(r.subject),
      csvEscape(r.chapter),
      csvEscape(r.status),
      csvEscape(r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at),
    ].join(','));
  }

  const csv = lines.join('\n');
  const filename = `studystreak_export_${new Date().toISOString().slice(0, 10)}.csv`;
  res.status(200);
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

export default withAdmin(handler);
