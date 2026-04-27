// streak engine tests
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDone, closeDay, initialState, localDayKey, daysBetween, rollMonth } from '../lib/streak-engine.js';

const TZ = 'Asia/Kolkata';

// utility: build a Date in IST
const ist = (yyyymmdd, hhmm = '12:00') => new Date(`${yyyymmdd}T${hhmm}:00+05:30`);

test('localDayKey returns IST-local day even when UTC has rolled over', () => {
  // 7:00 PM UTC on May 4 = 12:30 AM IST on May 5
  const d = new Date('2026-05-04T19:00:00Z');
  assert.equal(localDayKey(d, TZ), '2026-05-05');
});

test('daysBetween ignores time-of-day', () => {
  assert.equal(daysBetween('2026-05-05', '2026-05-04'), 1);
  assert.equal(daysBetween('2026-05-10', '2026-05-04'), 6);
});

test('first-ever Done starts streak at 1', () => {
  const { state, incremented } = applyDone(initialState(), ist('2026-05-04'), TZ);
  assert.equal(state.current, 1);
  assert.equal(state.longest, 1);
  assert.equal(state.lastStreakDay, '2026-05-04');
  assert.equal(incremented, true);
});

test('second Done same day does not double-count', () => {
  let { state } = applyDone(initialState(), ist('2026-05-04', '10:00'), TZ);
  const r = applyDone(state, ist('2026-05-04', '20:00'), TZ);
  assert.equal(r.state.current, 1);
  assert.equal(r.incremented, false);
  assert.equal(r.isFirstDoneOfDay, false);
});

test('consecutive day extends streak', () => {
  let s = initialState();
  s = applyDone(s, ist('2026-05-04'), TZ).state;
  s = applyDone(s, ist('2026-05-05'), TZ).state;
  s = applyDone(s, ist('2026-05-06'), TZ).state;
  assert.equal(s.current, 3);
  assert.equal(s.longest, 3);
});

test('gap >1 day resets streak to 1, longest preserved', () => {
  let s = initialState();
  s = applyDone(s, ist('2026-05-04'), TZ).state;
  s = applyDone(s, ist('2026-05-05'), TZ).state;
  s = applyDone(s, ist('2026-05-06'), TZ).state;
  // 3-day gap
  s = applyDone(s, ist('2026-05-10'), TZ).state;
  assert.equal(s.current, 1);
  assert.equal(s.longest, 3);
});

test('closeDay with 0 Dones and freezes available auto-freezes', () => {
  let s = applyDone(initialState(), ist('2026-05-04'), TZ).state;
  const closed = closeDay(s, ist('2026-05-05', '23:59'), { doneCount: 0 }, TZ);
  assert.equal(closed.action, 'frozen');
  assert.equal(closed.state.freezesUsedThisMonth, 1);
  assert.equal(closed.state.lastStreakDay, '2026-05-05'); // freeze keeps the chain

  // Next day Done should extend, not reset
  const after = applyDone(closed.state, ist('2026-05-06'), TZ);
  assert.equal(after.state.current, 2);
});

test('closeDay with 0 Dones and 0 freezes left breaks streak', () => {
  let s = applyDone(initialState(), ist('2026-05-04'), TZ).state;
  // Burn both freezes
  s = closeDay(s, ist('2026-05-05', '23:59'), { doneCount: 0 }, TZ).state;
  s = closeDay(s, ist('2026-05-06', '23:59'), { doneCount: 0 }, TZ).state;
  assert.equal(s.freezesUsedThisMonth, 2);

  // Third miss = break
  const broken = closeDay(s, ist('2026-05-07', '23:59'), { doneCount: 0 }, TZ);
  assert.equal(broken.action, 'broken');
  assert.equal(broken.state.current, 0);
});

test('rollMonth resets freezesUsedThisMonth', () => {
  const s = { ...initialState(), freezesUsedThisMonth: 2 };
  assert.equal(rollMonth(s).freezesUsedThisMonth, 0);
});

test('crossing-midnight UTC events count as the right local day', () => {
  // 6:30 PM UTC on May 4 → 12:00 AM IST on May 5
  const at = new Date('2026-05-04T18:30:00Z');
  const r = applyDone(initialState(), at, TZ);
  assert.equal(r.state.lastStreakDay, '2026-05-05');
});
