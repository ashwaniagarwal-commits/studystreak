// lib/chapters.js — master list of chapters (Eklavya 2027 plan).
// Single source of truth for the Chapters tab + admin view.

export const CHAPTER_PLAN = {
  Physics: [
    'Motion in a straight line',
    'Motion in a plane',
    'Laws of motion',
    'Work, Energy, Power',
    'Rotational Motion',
    'Gravitation',
    'Properties of Solids and Liquids',
    'Thermodynamics',
    'Kinetic Theory of Gases',
    'Oscillations and Waves',
    'Electrostatics',
    'Current Electricity',
  ],
  Math: [
    'Sets',
    'Relations',
    'Functions',
    'Trigonometry',
    'Complex Numbers',
    'Quadratic Equations',
    'Sequences & Series',
    'Permutations & Combinations',
    'Binomial Theorem',
    'Matrices & Determinants',
    'Limits, Continuity & Differentiability',
    'Differential Calculus Applications',
  ],
  Chemistry: [
    'Mole & Eqt. Concept',
    'Atomic Structure',
    'Periodic Properties',
    'Chemical Bonding',
    'States of Matter',
    'Thermodynamics (Chem)',
    'Equilibrium',
    'Redox Reactions',
    'Hydrogen',
    's-Block Elements',
    'p-Block Elements',
    'Organic Chemistry — Basic Principles',
  ],
};

export const STATUSES = ['Not Started', 'In Progress', 'Completed'];

export function flatChapterList() {
  const out = [];
  for (const [subject, chapters] of Object.entries(CHAPTER_PLAN)) {
    for (const chapter of chapters) {
      out.push({ subject, chapter });
    }
  }
  return out;
}
