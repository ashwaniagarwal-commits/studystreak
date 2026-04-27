// reward-engine.js
//
// Variable-reward logic. The mystery box is the heart of the Hooked loop's
// reward stage. This module is pure: deterministic given an `rng` injected by
// the caller, so it's testable.
//
// Rules from PRD §8.2:
//   p_drop(streak) = clamp(0.20 + 0.008 × streak, 0.20, 0.45)
//   XP distribution:
//     50  : 0.40
//     80  : 0.25
//     120 : 0.18
//     200 : 0.10
//     380 : 0.05
//     600 : 0.02
//   Hard caps:
//     - Box can never drop in the first 3 sessions of a new user.
//     - Cap of 1 box per calendar day.
//     - All thresholds remote-config-able.

export const DEFAULT_CONFIG = {
  base: 0.20,
  perDay: 0.008,
  pCap: 0.45,
  newUserSessionsBlocked: 3,
  xpDistribution: [
    { xp: 50,  weight: 0.40 },
    { xp: 80,  weight: 0.25 },
    { xp: 120, weight: 0.18 },
    { xp: 200, weight: 0.10 },
    { xp: 380, weight: 0.05 },
    { xp: 600, weight: 0.02 },
  ],
};

export function dropProbability(streakDays, cfg = DEFAULT_CONFIG) {
  const raw = cfg.base + cfg.perDay * streakDays;
  return Math.max(cfg.base, Math.min(cfg.pCap, raw));
}

/**
 * Decide whether a mystery box drops on this Done event.
 *
 * @param {object} input
 *   - streakDays: current streak count BEFORE this Done (0 = first day)
 *   - sessionsCompleted: lifetime Done count (used for new-user block)
 *   - alreadyDroppedToday: bool (1-per-day cap)
 *   - rng: () => number in [0,1) — inject for tests; defaults to Math.random
 * @returns {{ drops:boolean, xp:number|null, p:number, reason:string|null }}
 */
export function rollMysteryBox({
  streakDays,
  sessionsCompleted,
  alreadyDroppedToday,
  rng = Math.random,
}, cfg = DEFAULT_CONFIG) {
  if (sessionsCompleted < cfg.newUserSessionsBlocked) {
    return { drops: false, xp: null, p: 0, reason: 'new_user_block' };
  }
  if (alreadyDroppedToday) {
    return { drops: false, xp: null, p: 0, reason: 'daily_cap' };
  }

  const p = dropProbability(streakDays, cfg);
  const r = rng();
  if (r >= p) {
    return { drops: false, xp: null, p, reason: 'roll_miss' };
  }

  const xp = sampleXp(rng, cfg.xpDistribution);
  return { drops: true, xp, p, reason: null };
}

/**
 * Weighted sample over xp distribution.
 */
export function sampleXp(rng, distribution) {
  const r = rng();
  let cum = 0;
  for (const { xp, weight } of distribution) {
    cum += weight;
    if (r < cum) return xp;
  }
  // numerical safety: return last bucket
  return distribution[distribution.length - 1].xp;
}

/**
 * Simple seeded RNG for deterministic tests (mulberry32).
 */
export function seededRng(seed) {
  let t = seed | 0;
  return function () {
    t = (t + 0x6D2B79F5) | 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
