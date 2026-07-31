/* pg_progress.js — work-unit progress model.

   A reconstruction is a sequence of stages whose costs differ by orders of
   magnitude, so a flat "stage 3 of 6" bar is useless. Each stage declares how
   many units of work it has (photos, image pairs, depth maps) and a prior cost
   per unit derived from the settings. As a stage runs, the prior is replaced by
   the rate actually observed, so both the percentage and the time remaining
   converge on the truth instead of drifting. */

export function createProgress(stages, now) {
  const clock = now || (() => Date.now());
  const list = stages.map((s) => ({
    key: s.key, label: s.label,
    units: Math.max(0, s.units || 0),
    prior: Math.max(1e-6, s.cost || 0.1),   // seconds per unit, before measurement
    done: 0, started: 0, elapsed: 0, measured: 0,
  }));
  const byKey = new Map(list.map((s) => [s.key, s]));
  const t0 = clock();
  let current = null;

  /* Blend the prior with what has actually been observed, weighted by how many
     units have been measured: one finished unit already says a lot, and by the
     third the prior is barely involved. */
  let lastPct = 0, lastEta = null, lastEtaAt = 0;
  const rate = (s) => {
    if (!(s.measured > 0) || !(s.elapsed > 0)) return s.prior;
    const observed = s.elapsed / 1000 / s.measured;
    return (s.prior + observed * s.measured) / (1 + s.measured);
  };
  const totalCost = () => list.reduce((a, s) => a + s.units * rate(s), 0);
  const doneCost = () => list.reduce((a, s) => a + Math.min(s.done, s.units) * rate(s), 0);

  return {
    /* Adjust a stage's unit count once it is actually known (the number of
       image pairs, say, is only known after candidate selection). */
    setUnits(key, units) {
      const s = byKey.get(key);
      if (s) s.units = Math.max(0, units);
    },
    begin(key) {
      const s = byKey.get(key);
      if (!s) return;
      if (current && current !== s) current.started = 0;
      current = s;
      s.started = clock();
    },
    /* absolute number of finished units in the current stage */
    tick(key, done) {
      const s = byKey.get(key);
      if (!s) return;
      const t = clock();
      if (s.started) { s.elapsed += t - s.started; s.measured += Math.max(0, done - s.done); }
      s.started = t;
      s.done = done;
    },
    finish(key) {
      const s = byKey.get(key);
      if (!s) return;
      this.tick(key, s.units);
      s.started = 0;
    },
    /* Once one stage has been measured, its ratio to the prior says how fast
       this machine and this photo size actually are; carry that over to the
       stages that have not started, so the first estimate is not off by the
       factor the priors happen to assume. */
    calibrate(fromKey) {
      const s = byKey.get(fromKey);
      if (!s || s.measured < Math.min(3, s.units) || !(s.elapsed > 0)) return 1;
      const observed = s.elapsed / 1000 / s.measured;
      const factor = Math.max(0.05, Math.min(20, observed / s.prior));
      for (const x of list) if (x !== s && x.measured === 0) x.prior *= factor;
      return factor;
    },

    /* { pct, etaMs, elapsedMs, stage, done, units } */
    snapshot(key) {
      const total = totalCost(), completed = doneCost();
      let pct = total > 0 ? Math.max(0, Math.min(1, completed / total)) : 0;
      // never step backwards: learning that a stage is slower than its prior
      // raises the total, and a bar that retreats reads as a fault
      pct = Math.max(lastPct, pct);
      lastPct = pct;
      const elapsedMs = clock() - t0;
      let etaMs = null;
      const remaining = Math.max(0, total - completed);
      if (pct > 0.005) {
        // mostly the per-stage model, with a little plain elapsed/progress
        // extrapolation to steady it while the first stage is still measuring
        const extrapolated = elapsedMs * (1 - pct) / pct;
        const measuredStages = list.filter((x) => x.measured > 0).length;
        const w = measuredStages > 1 ? 0.85 : 0.6;
        etaMs = w * remaining * 1000 + (1 - w) * extrapolated;
        // smooth against the previous estimate, decayed by the time since, so
        // the countdown drifts rather than jumping
        if (lastEta != null) {
          const decayed = Math.max(0, lastEta - (clock() - lastEtaAt));
          etaMs = 0.45 * decayed + 0.55 * etaMs;
        }
        lastEta = etaMs; lastEtaAt = clock();
      }
      const s = key ? byKey.get(key) : current;
      return {
        pct: pct, etaMs: etaMs, elapsedMs: elapsedMs,
        stage: s ? s.key : '', stageLabel: s ? s.label : '',
        done: s ? s.done : 0, units: s ? s.units : 0,
      };
    },
  };
}

/* Prior cost per unit, in seconds, for the stages of a build. These are
   starting points only — measured rates take over within a few units — but
   they make the first estimate land in the right order of magnitude. */
export function priorCosts(opt, photoCount) {
  const mp = Math.pow(opt.maxDim / 1000, 2);
  const featureScale = opt.features / 2000;
  return {
    features: 0.55 * mp + 0.25 * featureScale,          // decode + detect + describe
    matching: 0.035 * featureScale * featureScale,      // per image pair
    verify: 0.11 * featureScale,                        // per image pair
    register: 0.10 + 0.0006 * photoCount,               // per photo, grows with the model
    bundle: 0.9 + 0.004 * photoCount,                   // per "round" unit
    dense: opt.dense ? (1.9 * mp * (opt.denseSamples / 32) * (4 / (opt.denseStride * opt.denseStride))
      * Math.max(1, opt.neighbours / 3)) : 0,           // per depth map
    fuse: 0.02,                                         // per view fused
    mesh: 2.5,                                          // one unit
  };
}

/* Total expected build time, in seconds, from the priors alone — what the
   operator sees before pressing the button. */
export function estimateBuildSeconds(opt, photoCount, wantMesh) {
  const c = priorCosts(opt, photoCount);
  const pairs = Math.min(photoCount * (photoCount - 1) / 2, photoCount * (opt.candidates + 2));
  return photoCount * c.features
    + pairs * (c.matching + c.verify)
    + photoCount * c.register
    + 10 * c.bundle
    + (opt.dense ? photoCount * (c.dense + c.fuse) : 0)
    + (wantMesh === false ? 0 : c.mesh);
}
