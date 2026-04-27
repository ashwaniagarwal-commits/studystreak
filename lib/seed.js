// lib/seed.js — seed demo data on first request.
// Idempotent: if 'demo' user already has lectures, returns immediately.

import { sql, ensureUser, lectureCount } from './db.js';

const PLAN = {
  Physics: [
    { topic: 'Motion in a straight line', sub: 'Intro to kinematics' },
    { topic: 'Motion in a straight line', sub: 'Velocity & acceleration' },
    { topic: 'Motion in a straight line', sub: 'Equations of motion' },
    { topic: 'Motion in a straight line', sub: 'Vertical motion under gravity' },
    { topic: 'Motion in a straight line', sub: 'Graphs of motion' },
    { topic: 'Motion in a plane', sub: 'Intro & projectile motion' },
    { topic: 'Motion in a plane', sub: 'Projectile from a height' },
    { topic: 'Motion in a plane', sub: 'Relative motion' },
    { topic: 'Laws of motion', sub: 'Newton\'s laws' },
    { topic: 'Laws of motion', sub: 'Friction' },
    { topic: 'Laws of motion', sub: 'Pseudo forces' },
    { topic: 'Work, Energy, Power', sub: 'Work-energy theorem' },
    { topic: 'Work, Energy, Power', sub: 'Conservation of energy' },
    { topic: 'Work, Energy, Power', sub: 'Power & efficiency' },
  ],
  Math: [
    { topic: 'Sets', sub: 'Definitions, types, operations' },
    { topic: 'Relations', sub: 'Cartesian product, inverse' },
    { topic: 'Functions', sub: 'Domain & modulus' },
    { topic: 'Functions', sub: 'Exponential & log' },
    { topic: 'Functions', sub: 'Graph transformations' },
    { topic: 'Trigonometry', sub: 'Angles & ratios' },
    { topic: 'Trigonometry', sub: 'Identities' },
    { topic: 'Trigonometry', sub: 'Inverse trig' },
    { topic: 'Complex Numbers', sub: 'Modulus & argument' },
    { topic: 'Complex Numbers', sub: 'De Moivre' },
    { topic: 'Quadratic Equations', sub: 'Roots & nature' },
    { topic: 'Sequences & Series', sub: 'AP basics' },
    { topic: 'Sequences & Series', sub: 'GP & HP' },
    { topic: 'Sequences & Series', sub: 'Sum to n terms' },
  ],
  Chemistry: [
    { topic: 'Mole & Eqt. Concept', sub: 'Atoms, molecules, mole' },
    { topic: 'Mole & Eqt. Concept', sub: 'Empirical & molecular formulae' },
    { topic: 'Mole & Eqt. Concept', sub: 'Stoichiometry' },
    { topic: 'Mole & Eqt. Concept', sub: 'Limiting reagent' },
    { topic: 'Mole & Eqt. Concept', sub: 'POAC' },
    { topic: 'Atomic Structure', sub: 'Bohr model' },
    { topic: 'Atomic Structure', sub: 'Quantum numbers' },
    { topic: 'Atomic Structure', sub: 'Aufbau & electronic config' },
    { topic: 'Periodic Properties', sub: 'Trends in period & group' },
    { topic: 'Periodic Properties', sub: 'Ionization & electron affinity' },
    { topic: 'Chemical Bonding', sub: 'Ionic & covalent' },
    { topic: 'Chemical Bonding', sub: 'VSEPR theory' },
    { topic: 'Chemical Bonding', sub: 'Hybridization' },
    { topic: 'Chemical Bonding', sub: 'Molecular orbital theory' },
  ],
};

const SLOTS = [
  { subject: 'Physics',   start: '16:00', duration: 120 },
  { subject: 'Math',      start: '18:30', duration: 120 },
  { subject: 'Chemistry', start: '21:00', duration: 120 },
];

const pad = n => String(n).padStart(2, '0');

export async function seedIfEmpty(userId = 'demo', daysAhead = 14, daysBehind = 6) {
  await ensureUser(userId, 'Arjun');
  if ((await lectureCount(userId)) > 0) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - daysBehind);

  const counters = { Physics: 0, Math: 0, Chemistry: 0 };
  const dates = [];
  for (let i = 0; i < daysBehind + daysAhead; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    dates.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  }

  // Build all rows then insert in chunks (Neon HTTP supports up to ~1MB per request)
  const rows = [];
  for (const yyyymmdd of dates) {
    for (const slot of SLOTS) {
      const idx = counters[slot.subject] % PLAN[slot.subject].length;
      const lec = PLAN[slot.subject][idx];
      counters[slot.subject]++;
      const iso = new Date(`${yyyymmdd}T${slot.start}:00+05:30`).toISOString();
      rows.push([userId, yyyymmdd, iso, slot.duration, slot.subject, lec.topic, lec.sub]);
    }
  }
  // Insert in one go via unnest for speed
  await sql`
    INSERT INTO lectures (user_id, scheduled_date, scheduled_start, scheduled_duration_min, subject, topic, sub_topic)
    SELECT * FROM UNNEST(
      ${rows.map(r => r[0])}::text[],
      ${rows.map(r => r[1])}::date[],
      ${rows.map(r => r[2])}::timestamptz[],
      ${rows.map(r => r[3])}::int[],
      ${rows.map(r => r[4])}::text[],
      ${rows.map(r => r[5])}::text[],
      ${rows.map(r => r[6])}::text[]
    )
  `;

  // Pre-mark some past lectures as Done / Backlog / Partial for a realistic demo.
  const past = dates.slice(0, daysBehind);
  if (past[0]) await sql`UPDATE lectures SET status='Done', status_changed_at=NOW() WHERE user_id=${userId} AND scheduled_date=${past[0]}`;
  if (past[1]) await sql`UPDATE lectures SET status='Done', status_changed_at=NOW() WHERE user_id=${userId} AND scheduled_date=${past[1]}`;
  if (past[2]) {
    await sql`UPDATE lectures SET status='Backlog', status_changed_at=NOW() WHERE user_id=${userId} AND scheduled_date=${past[2]} AND subject='Physics'`;
    await sql`UPDATE lectures SET status='Done', status_changed_at=NOW() WHERE user_id=${userId} AND scheduled_date=${past[2]} AND subject<>'Physics'`;
  }
  if (past[3]) {
    await sql`UPDATE lectures SET status='Partial', status_changed_at=NOW() WHERE user_id=${userId} AND scheduled_date=${past[3]} AND subject='Math'`;
    await sql`UPDATE lectures SET status='Done', status_changed_at=NOW() WHERE user_id=${userId} AND scheduled_date=${past[3]} AND subject<>'Math'`;
  }
  if (past[4]) await sql`UPDATE lectures SET status='Done', status_changed_at=NOW() WHERE user_id=${userId} AND scheduled_date=${past[4]}`;

  // Yesterday: mark all Done so today's first Done extends streak 5 → 6
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const yKey = `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}`;
  await sql`UPDATE lectures SET status='Done', status_changed_at=NOW() WHERE user_id=${userId} AND scheduled_date=${yKey}`;

  await sql`
    UPDATE streak_state SET current_count=5, longest=5, last_streak_day=${yKey}, sessions_completed=14
    WHERE user_id=${userId}
  `;

  return true;
}
