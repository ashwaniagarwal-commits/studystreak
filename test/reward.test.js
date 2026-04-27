import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dropProbability, rollMysteryBox, sampleXp, seededRng, DEFAULT_CONFIG,
} from '../lib/reward-engine.js';

test('dropProbability is clamped at base on day 0', () => {
  assert.equal(dropProbability(0), 0.20);
});

test('dropProbability climbs linearly with streak', () => {
  // 0.20 + 0.008 × 7 = 0.256
  assert.ok(Math.abs(dropProbability(7) - 0.256) < 1e-9);
  // 0.20 + 0.008 × 14 = 0.312
  assert.ok(Math.abs(dropProbability(14) - 0.312) < 1e-9);
});

test('dropProbability caps at 0.45', () => {
  assert.equal(dropProbability(100), 0.45);
});

test('new user with <3 completed sessions never drops', () => {
  for (let i = 0; i < 3; i++) {
    const r = rollMysteryBox({
      streakDays: 7,
      sessionsCompleted: i,
      alreadyDroppedToday: false,
      rng: () => 0.0, // would always trigger if allowed
    });
    assert.equal(r.drops, false);
    assert.equal(r.reason, 'new_user_block');
  }
});

test('alreadyDroppedToday blocks even when roll succeeds', () => {
  const r = rollMysteryBox({
    streakDays: 7,
    sessionsCompleted: 50,
    alreadyDroppedToday: true,
    rng: () => 0.0,
  });
  assert.equal(r.drops, false);
  assert.equal(r.reason, 'daily_cap');
});

test('observed drop rate converges to configured probability', () => {
  const trials = 20000;
  const streak = 7; // p = 0.256
  let drops = 0;
  const rng = seededRng(42);
  for (let i = 0; i < trials; i++) {
    const r = rollMysteryBox({
      streakDays: streak,
      sessionsCompleted: 50,
      alreadyDroppedToday: false,
      rng,
    });
    if (r.drops) drops++;
  }
  const observed = drops / trials;
  // Allow ±2pp drift
  assert.ok(
    Math.abs(observed - 0.256) < 0.02,
    `observed=${observed} expected≈0.256`
  );
});

test('XP distribution sums to ~1 and average is reasonable', () => {
  const totalWeight = DEFAULT_CONFIG.xpDistribution.reduce((s, x) => s + x.weight, 0);
  assert.ok(Math.abs(totalWeight - 1.0) < 1e-6);

  // Expected average: 0.40*50 + 0.25*80 + 0.18*120 + 0.10*200 + 0.05*380 + 0.02*600
  //                = 20 + 20 + 21.6 + 20 + 19 + 12 = 112.6
  const trials = 10000;
  const rng = seededRng(7);
  let total = 0;
  for (let i = 0; i < trials; i++) {
    total += sampleXp(rng, DEFAULT_CONFIG.xpDistribution);
  }
  const avg = total / trials;
  assert.ok(
    Math.abs(avg - 112.6) < 5,
    `expected avg≈112.6, got ${avg}`
  );
});

test('XP draw never returns a value outside the configured set', () => {
  const valid = new Set(DEFAULT_CONFIG.xpDistribution.map(d => d.xp));
  const rng = seededRng(123);
  for (let i = 0; i < 1000; i++) {
    const x = sampleXp(rng, DEFAULT_CONFIG.xpDistribution);
    assert.ok(valid.has(x), `invalid xp value: ${x}`);
  }
});
