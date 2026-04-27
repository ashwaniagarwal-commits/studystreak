// priority-engine.js
//
// Ports the A/B/C priority banding logic from the Study Planner v2 Excel
// (Backlog_Priority sheet). Pure functions; no DB.
//
// Score formula (revised from PRD §8.3 for proper band coverage; backed by
// the Excel sample where real Backlog items scored 208):
//   Score = 100
//         + 80 × statusWeight        (Backlog=1.0, Partial=0.6, Skipped=0.8, Done=0)
//         + 60 × daysSinceScheduled  (days/10, clamped to 0..1)
//         + 30 × subjectGapWeight    (subject's lecture-completion deficit vs schedule)
//         + 30 × relatedTopicRecency (more recent → more value to revise)
//
// Theoretical max: 300. Bands tuned to give meaningful A-band frequency:
//   A ≥ 200   → "Complete lecture + notes + class questions"
//   B 130–199 → "Revise notes / DPP"
//   C < 130   → "Low priority — revisit later"

export const STATUS_WEIGHT = {
  Backlog: 1.0,
  Skipped: 0.8,
  Partial: 0.6,
  Revised: 0.0,
  Done: 0.0,
  null: 0.7,       // unmarked & past-due
  undefined: 0.7,
};

export function score({
  status,
  daysSinceScheduled,
  subjectGap = 0,
  relatedTopicRecency = 0,
}) {
  const sw = STATUS_WEIGHT[status] ?? 0.7;
  const dsn = Math.max(0, Math.min(10, daysSinceScheduled || 0)) / 10;
  const sg = Math.max(0, Math.min(1, subjectGap));
  const rt = Math.max(0, Math.min(1, relatedTopicRecency));

  return Math.round(100 + 80 * sw + 60 * dsn + 30 * sg + 30 * rt);
}

export function band(s) {
  if (s >= 200) return 'A';
  if (s >= 130) return 'B';
  return 'C';
}

export function suggestedAction(status, b) {
  if (status === 'Done' || status === 'Revised') return 'Revise only if weak';
  if (b === 'A') return 'Complete lecture + notes + class questions';
  if (b === 'B') return 'Revise notes / DPP';
  return 'Low priority — revisit later';
}

/**
 * Rank a list of lectures into the catch-up queue.
 *
 * @param {Array} lectures - each { id, status, scheduledAt (Date|ISO), subject }
 * @param {Date}  now
 * @param {object} subjectGaps - { Physics: 0.3, Math: 0.1, Chemistry: 0.0 }
 * @returns {Array} sorted desc by score, with score+band+action attached
 */
export function rankBacklog(lectures, now, subjectGaps = {}) {
  const enriched = lectures.map(l => {
    const at = l.scheduledAt instanceof Date ? l.scheduledAt : new Date(l.scheduledAt);
    const days = Math.max(0, (now - at) / 86400000);
    const s = score({
      status: l.status,
      daysSinceScheduled: days,
      subjectGap: subjectGaps[l.subject] || 0,
      relatedTopicRecency: 0,
    });
    const b = band(s);
    return {
      ...l,
      score: s,
      band: b,
      action: suggestedAction(l.status, b),
      daysSinceScheduled: Math.round(days),
    };
  });

  enriched.sort((a, b) => b.score - a.score);
  return enriched;
}

/**
 * Pick the top N items, with subject diversity tie-breaking.
 * If 3 picks would all be the same subject, swap the 3rd for a different subject's #1.
 */
export function topPicks(rankedLectures, n = 3) {
  const onlyActive = rankedLectures.filter(
    l => l.status !== 'Done' && l.status !== 'Revised'
  );
  if (onlyActive.length <= n) return onlyActive;

  const picked = [];
  const subjects = new Set();

  // First pass: greedy by score but ensure subject diversity in top-3
  for (const l of onlyActive) {
    if (picked.length === n) break;
    if (picked.length < n - 1 || !subjects.has(l.subject) || picked.length === 0) {
      picked.push(l);
      subjects.add(l.subject);
    }
  }
  // Pad with next best if diversity rule didn't fill
  for (const l of onlyActive) {
    if (picked.length === n) break;
    if (!picked.includes(l)) picked.push(l);
  }
  return picked;
}

/**
 * 6-item backlog ceiling (PRD §C2): if backlog count would exceed 6, auto-defer
 * the lowest-priority items in B/C bands. A-band items are never auto-deferred.
 */
export function applyBacklogCeiling(rankedLectures, ceiling = 6) {
  const backlog = rankedLectures.filter(l => l.status === 'Backlog');
  if (backlog.length <= ceiling) {
    return { kept: backlog, deferred: [] };
  }

  const aBand = backlog.filter(l => l.band === 'A');
  const others = backlog.filter(l => l.band !== 'A').sort((a, b) => b.score - a.score);

  const remainingSlots = Math.max(0, ceiling - aBand.length);
  const kept = [...aBand, ...others.slice(0, remainingSlots)];
  const deferred = others.slice(remainingSlots);

  return { kept, deferred };
}
