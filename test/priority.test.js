import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  score, band, suggestedAction, rankBacklog, topPicks, applyBacklogCeiling,
} from '../lib/priority-engine.js';

test('Done lecture scores low (no urgency)', () => {
  const s = score({ status: 'Done', daysSinceScheduled: 0 });
  assert.equal(band(s), 'C');
  assert.ok(s < 110);
});

test('Backlog 7 days old in lagging subject scores in A band', () => {
  const s = score({ status: 'Backlog', daysSinceScheduled: 7, subjectGap: 0.3 });
  assert.equal(band(s), 'A');
  assert.ok(s >= 200);
});

test('Backlog outranks Partial when other factors are equal', () => {
  const backlog = score({ status: 'Backlog', daysSinceScheduled: 5 });
  const partial = score({ status: 'Partial', daysSinceScheduled: 5 });
  assert.ok(backlog > partial, `expected Backlog (${backlog}) > Partial (${partial})`);
});

test('Days-since-scheduled dominates when status is similar (14d Partial > 1d Backlog)', () => {
  const fresh = score({ status: 'Backlog', daysSinceScheduled: 1 });
  const oldPartial = score({ status: 'Partial', daysSinceScheduled: 14 });
  assert.ok(oldPartial > fresh, `expected old Partial (${oldPartial}) > fresh Backlog (${fresh})`);
});

test('rankBacklog sorts by score descending', () => {
  const now = new Date('2026-05-15T12:00:00Z');
  const lectures = [
    { id: 1, status: 'Done',    scheduledAt: '2026-05-04T16:00:00Z', subject: 'Physics' },
    { id: 2, status: 'Backlog', scheduledAt: '2026-05-08T16:00:00Z', subject: 'Physics' },
    { id: 3, status: 'Partial', scheduledAt: '2026-05-12T18:30:00Z', subject: 'Math' },
    { id: 4, status: null,      scheduledAt: '2026-05-13T21:00:00Z', subject: 'Chemistry' },
  ];
  const ranked = rankBacklog(lectures, now);
  assert.equal(ranked[0].id, 2); // 7-day Backlog wins
  assert.equal(ranked[ranked.length - 1].id, 1); // Done is last
  for (let i = 1; i < ranked.length; i++) {
    assert.ok(ranked[i - 1].score >= ranked[i].score);
  }
});

test('topPicks returns ≤ N items and prefers subject diversity', () => {
  const now = new Date('2026-05-15T12:00:00Z');
  const lectures = [
    { id: 1, status: 'Backlog', scheduledAt: '2026-05-08T16:00:00Z', subject: 'Physics' },
    { id: 2, status: 'Backlog', scheduledAt: '2026-05-09T16:00:00Z', subject: 'Physics' },
    { id: 3, status: 'Backlog', scheduledAt: '2026-05-10T16:00:00Z', subject: 'Physics' },
    { id: 4, status: 'Backlog', scheduledAt: '2026-05-11T18:30:00Z', subject: 'Math' },
  ];
  const ranked = rankBacklog(lectures, now);
  const picks = topPicks(ranked, 3);
  assert.equal(picks.length, 3);
  const subjects = new Set(picks.map(p => p.subject));
  // We should NOT have 3 Physics in top picks; diversity rule must kick in
  assert.ok(subjects.size >= 2);
});

test('applyBacklogCeiling caps at 6 and never defers A-band', () => {
  const now = new Date('2026-05-15T12:00:00Z');
  // Build 8 backlog items: 3 A-band (very old/lagging) + 5 lower
  const lectures = [];
  for (let i = 0; i < 3; i++) {
    lectures.push({ id: 'a' + i, status: 'Backlog', scheduledAt: '2026-04-25T16:00:00Z', subject: 'Physics' });
  }
  for (let i = 0; i < 5; i++) {
    lectures.push({ id: 'b' + i, status: 'Backlog', scheduledAt: '2026-05-13T16:00:00Z', subject: 'Math' });
  }
  const ranked = rankBacklog(lectures, now, { Physics: 0.4 });
  const { kept, deferred } = applyBacklogCeiling(ranked, 6);
  assert.equal(kept.length + deferred.length, 8);
  assert.equal(kept.length, 6);
  assert.equal(deferred.length, 2);
  // No A-band item is in deferred
  for (const d of deferred) assert.notEqual(d.band, 'A');
});

test('suggestedAction maps band to action', () => {
  assert.equal(suggestedAction('Backlog', 'A'), 'Complete lecture + notes + class questions');
  assert.equal(suggestedAction('Partial', 'B'), 'Revise notes / DPP');
  assert.equal(suggestedAction(null, 'C'), 'Low priority — revisit later');
  assert.equal(suggestedAction('Done', 'A'), 'Revise only if weak');
});
