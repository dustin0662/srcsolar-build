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
