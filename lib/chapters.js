// lib/chapters.js — master topic list, sourced from the Eklavya 2027
// Session_Log.csv. Each entry is one topic of the JEE syllabus.
//
// Cleanup applied vs raw CSV:
//  - dropped "ONE-SHOT" placeholder entries (those are session types, not topics)
//  - deduplicated case variants ("Current Electricity" / "Current electricity")
//  - fixed obvious typos ("Cordinate" → "Coordinate")
//  - normalized stray spaces ("p -block" → "p-Block")
//  - dropped "Revision" (session type, not a topic milestone)
//
// File name kept as chapters.js for backwards compat with the chapter_progress
// table; UI label is "Topics" everywhere.

export const CHAPTER_PLAN = {
  Physics: [
    'Motion in a straight line',
    'Motion in a plane',
    'Relative Motion',
    'Laws Of Motion',
    'Friction',
    'Work, energy and power',
    'Circular motion',
    'Centre of mass, momentum and collision',
    'Rotational Motion',
    'Fluid mechanics',
    'Mechanical properties of solids',
    'Simple harmonic motion',
    'Waves',
    'Wave Optics',
    'Ray Optics',
    'Human eye and optical instruments',
    'Heat, temperature and calorimetry',
    'Heat Transfer',
    'Kinetic theory of gases',
    'Thermodynamics',
    'Gravitation',
    'Electrostatics',
    'Capacitance',
    'Current Electricity',
    'Magnetic effects of current',
    'Magnetism and matter',
    'Electromagnetic induction',
    'Alternating current',
    'Electromagnetic waves',
    'Modern Physics',
    'Semiconductors and electronic devices',
    'Units and measurements',
    'Experimental Physics',
  ],
  Math: [
    'Sets',
    'Relations',
    'Functions',
    'Trigonometry',
    'Inverse Trigonometry Functions',
    'Complex Numbers',
    'Quadratic Equation',
    'Sequence and Series',
    'Permutation and combination',
    'Binomial Theorem',
    'Determinant And Matrices',
    'Limits, Continuity & Differentiability',
    'Differentiation',
    'Application of Derivatives',
    'Indefinite Integration',
    'Definite Integration',
    'Area under the Curve',
    'Differential Equations',
    'Coordinate Geometry — Straight Lines',
    'Coordinate Geometry — Circles',
    'Coordinate Geometry — Conics',
    'Vector',
    '3D Geometry',
    'Statistics',
    'Probability',
  ],
  Chemistry: [
    'Mole & Eqt. Concept',
    'Redox Reactions',
    'Structure of an Atom',
    'Periodic Properties',
    'Chemical Bonding',
    'Gaseous State',
    'Thermodynamics and Thermochemistry',
    'Chemical Equilibrium',
    'Ionic Equilibrium',
    'Hydrogen',
    's-Block',
    'p-Block (group 13 and 14)',
    'p-Block (group 15-18)',
    'd and f Block Elements',
    'Coordination Compounds',
    'Metallurgy',
    'Solid State',
    'Solutions',
    'Electrochemistry',
    'Chemical Kinetics',
    'Surface Chemistry',
    'General Organic Chemistry',
    'Isomerism',
    'Hydrocarbons',
    'Alkyl And Aryl Halides',
    'Alcohol Phenol And Ether',
    'Aldehydes and Ketones',
    'Carboxylic Acid and Its Derivatives',
    'Amines',
    'Biomolecules',
    'Polymers',
    'Chemistry in Everyday Life',
    'Practical Chemistry',
    'Environmental Chemistry',
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
