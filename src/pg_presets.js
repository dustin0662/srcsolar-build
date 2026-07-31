/* pg_presets.js — the quality dial, shared by the UI and the worker.
   Kept in its own module so the interface can describe the presets without
   pulling the whole reconstruction engine into the main bundle. */

export const PRESETS = {
  draft: {
    label: 'Draft', maxDim: 900, features: 1400, fastThreshold: 16, candidates: 5,
    dense: false, denseStride: 4, denseSamples: 24, minScore: 0.62, neighbours: 3,
    note: 'Camera positions and a sparse point cloud only — a quick check that the capture covered the site.',
  },
  fast: {
    label: 'Fast', maxDim: 1100, features: 1800, fastThreshold: 14, candidates: 6,
    dense: true, denseStride: 4, denseSamples: 28, minScore: 0.62, neighbours: 3,
    note: 'A usable model in a few minutes. Good enough for progress and volume checks.',
  },
  balanced: {
    label: 'Balanced', maxDim: 1500, features: 2600, fastThreshold: 12, candidates: 8,
    dense: true, denseStride: 2, denseSamples: 40, minScore: 0.58, neighbours: 4,
    note: 'The default: solid detail without an all-day wait.',
  },
  detailed: {
    label: 'High detail', maxDim: 2200, features: 3600, fastThreshold: 10, candidates: 10,
    dense: true, denseStride: 1, denseSamples: 64, minScore: 0.55, neighbours: 5,
    note: 'Everything the photos support — four times the points of Balanced. Slow; leave the tab open.',
  },
};

export const PRESET_ORDER = ['draft', 'fast', 'balanced', 'detailed'];

/* The presets describe intent; this decides what is actually affordable for
   the number of photos in hand. Anything it changes is reported to the
   operator, because a silently downgraded model is worse than a slow one. */
export function adaptSettings(preset, n) {
  const opt = Object.assign({}, preset);
  const notes = [];
  const cap = (key, value, what) => { if (opt[key] > value) { opt[key] = value; notes.push(what); } };
  const floor = (key, value, what) => { if (opt[key] < value) { opt[key] = value; notes.push(what); } };
  if (n > 150) {
    cap('maxDim', 1600, 'working images capped at 1600 px');
    cap('features', 2600, '2,600 features per photo');
    cap('candidates', 9, '9 match candidates per photo');
  }
  if (n > 300) {
    cap('maxDim', 1400, 'working images capped at 1400 px');
    cap('features', 2200, '2,200 features per photo');
    floor('denseStride', 3, 'dense sampling every 3 px');
    cap('candidates', 8, '8 match candidates per photo');
    cap('neighbours', 4, '4 stereo partners per view');
  }
  if (n > 450) {
    cap('maxDim', 1200, 'working images capped at 1200 px');
    cap('features', 2000, '2,000 features per photo');
    floor('denseStride', 4, 'dense sampling every 4 px');
    cap('candidates', 7, '7 match candidates per photo');
  }
  return { opt: opt, notes: notes };
}

/* how many points to keep, and therefore how much memory the fusion grid may
   take: a site model is not improved by holding ten million samples */
export function pointBudget(n) {
  if (n <= 60) return 2500000;
  if (n <= 200) return 3000000;
  return 3500000;
}
