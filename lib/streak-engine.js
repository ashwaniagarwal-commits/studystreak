// streak-engine.js
//
// Pure-logic streak rules. No I/O, no DB, no clock — all inputs are explicit so
// this module is trivially unit-testable and identical on client + server.
//
// Core invariant: a "streak day" is a calendar day in the user's local timezone
// during which the user logged at least one Done. Streaks increment exactly once
// per local day on the FIRST Done of that day. Subsequent Dones on the same day
// are no-ops for the streak counter.
//
// Freezes: 2 free per calendar month. A freeze is auto-applied when the user
// closes a day with 0 Dones AND has freezes available. This is an explicit,
// visible action — never silent.

/**
 * Convert a Date to a YYYY-MM-DD key in the given IANA timezone.
 * Day boundaries are user-local, not UTC, so streaks behave correctly across
 * timezones and across midnight.
 */
export function localDayKey(date, timezone = 'Asia/Kolkata') {
  // en-CA gives ISO-style YYYY-MM-DD output
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(date);
}

/**
 * Days between two YYYY-MM-DD keys (a - b). Always integer. b is the older.
 */
export function daysBetween(aKey, bKey) {
  const a = new Date(aKey + 'T12:00:00Z');
  const b = new Date(bKey + 'T12:00:00Z');
  return Math.round((a - b) / 86400000);
}

/**
 * Apply a Done event to a streak state.
 *
 * @param {object} state - { current, longest, lastStreakDay, freezesUsedThisMonth }
 * @param {Date}  eventTime
 * @param {string} timezone - IANA tz, default Asia/Kolkata
 * @returns {{ state: object, incremented: boolean, isFirstDoneOfDay: boolean }}
 */
export function applyDone(state, eventTime, timezone = 'Asia/Kolkata') {
  const today = localDayKey(eventTime, timezone);
  const last = state.lastStreakDay || null;

  // Already counted a Done today — no-op for streak.
  if (last === today) {
    return { state, incremented: false, isFirstDoneOfDay: false };
  }

  let current = state.current || 0;
  if (last == null) {
    current = 1;
  } else {
    const gap = daysBetween(today, last);
    if (gap === 1) {
      current = current + 1;
    } else if (gap > 1) {
      // Streak broke. Re-start at 1.
      current = 1;
    } else {
      // gap === 0 handled above; gap < 0 would mean clock went backwards.
      current = 1;
    }
  }

  const longest = Math.max(state.longest || 0, current);

  return {
    state: { ...state, current, longest, lastStreakDay: today },
    incremented: true,
    isFirstDoneOfDay: true,
  };
}

/**
 * Close out a calendar day at local-midnight. If the user logged 0 Dones AND
 * has freezes remaining, auto-apply a freeze. Otherwise the streak breaks.
 *
 * @param {object} state
 * @param {Date} closeTime - typically local-midnight of the day being closed
 * @param {{ doneCount:number }} dayMetrics
 * @param {string} timezone
 */
export function closeDay(state, closeTime, dayMetrics, timezone = 'Asia/Kolkata') {
  const dayKey = localDayKey(closeTime, timezone);
  if (dayMetrics.doneCount > 0) {
    // Day was a streak day. Already handled by applyDone. No-op.
    return { state, action: 'kept' };
  }

  // Day had 0 Dones.
  const freezesUsed = state.freezesUsedThisMonth || 0;
  const freezesAvailable = 2 - freezesUsed;
  if (freezesAvailable > 0) {
    return {
      state: {
        ...state,
        lastStreakDay: dayKey,
        freezesUsedThisMonth: freezesUsed + 1,
      },
      action: 'frozen',
    };
  }

  // No freeze available. Streak breaks.
  return {
    state: { ...state, current: 0 },
    action: 'broken',
  };
}

/**
 * Reset the freeze counter at the start of a new calendar month.
 */
export function rollMonth(state) {
  return { ...state, freezesUsedThisMonth: 0 };
}

/**
 * Initial state for a new user.
 */
export function initialState() {
  return {
    current: 0,
    longest: 0,
    lastStreakDay: null,
    freezesUsedThisMonth: 0,
  };
}
