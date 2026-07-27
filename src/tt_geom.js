/* ------------------------------------------------------------------ */
/*  Task Tracker — shared geometry helpers                             */
/* ------------------------------------------------------------------ */

/* Monotone-chain convex hull. Input/output: [[x,y], …] (counter-clockwise). */
export function convexHull(pts) {
  if (!pts || pts.length < 3) return (pts || []).slice();
  const p = pts.slice().sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  const upper = [];
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

/* Push a hull outward from its centroid so the outline reads as a silhouette
   around the block rather than slicing through the outermost dots. */
export function padHull(hull, pad) {
  if (!hull || hull.length < 3 || !pad) return hull || [];
  let cx = 0, cy = 0;
  for (const [x, y] of hull) { cx += x; cy += y; }
  cx /= hull.length; cy /= hull.length;
  return hull.map(([x, y]) => {
    const dx = x - cx, dy = y - cy; const d = Math.hypot(dx, dy) || 1;
    return [x + dx / d * pad, y + dy / d * pad];
  });
}

/* Convex hull of the points belonging to one section, padded. */
export function sectionHull(points, sections, secIdx, pad) {
  if (!points || sections == null || secIdx == null) return [];
  const sub = [];
  for (let i = 0; i < points.length; i++) if (sections[i] === secIdx) sub.push(points[i]);
  return padHull(convexHull(sub), pad || 0);
}

/* Normalized rect from two corner points. */
export function normRect(a, b) {
  return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
}

export function rectContains(r, x, y) { return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1; }

/* A drag is a marquee only once it clears this many CSS pixels; anything
   smaller is treated as a plain click. */
export const DRAG_SLOP = 6;

/* ------------------------------------------------------------------ */
/*  Subtask weighting                                                  */
/* ------------------------------------------------------------------ */

/* Subtasks hang off a parent install stage ('s1'…'s4') and carry a percentage
   weight of that stage's completion. A point sitting at stage k earns partial
   credit toward stage k+1 equal to the summed weight of its completed
   subtasks for that stage (capped at 100%). */
export function subsForParent(subtasks, parent) {
  return (subtasks || []).filter((s) => s && s.parent === parent);
}

/* Fraction (0…1) of stage `next` earned at point i by completed subtasks. */
export function subFraction(subtasks, sub, next, i) {
  const list = subsForParent(subtasks, 's' + next);
  if (!list.length || !sub) return 0;
  let w = 0;
  for (const s of list) { const bits = sub[s.id]; if (bits && bits[i] === '1') w += (+s.weight || 0); }
  return Math.max(0, Math.min(1, w / 100));
}

/* True once a point's completed subtasks fully cover the next stage. */
export function subComplete(subtasks, sub, next, i) {
  return subsForParent(subtasks, 's' + next).length > 0 && subFraction(subtasks, sub, next, i) >= 1;
}
