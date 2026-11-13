/**
 * Clipping of lines and polygons to an axis-aligned rectangle
 * { minX, minZ, maxX, maxZ }. Points are [x, z] in metres.
 * Nothing returned by these functions lies outside the rectangle.
 */
export const inside = (p, r) => p[0] >= r.minX && p[0] <= r.maxX && p[1] >= r.minZ && p[1] <= r.maxZ;

export const ringArea = (ring) => {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return Math.abs(a) / 2;
};

export const pointInRing = ([x, z], ring) => {
  let inRing = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inRing = !inRing;
  }
  return inRing;
};

/** Liang-Barsky. Returns [t0, t1] of the visible part of a->b, or null. */
function segmentRange(a, b, r) {
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dz = b[1] - a[1];
  for (const [p, q] of [[-dx, a[0] - r.minX], [dx, r.maxX - a[0]], [-dz, a[1] - r.minZ], [dz, r.maxZ - a[1]]]) {
    if (p === 0) {
      if (q < 0) return null;
    } else {
      const t = q / p;
      if (p < 0) { if (t > t1) return null; if (t > t0) t0 = t; }
      else { if (t < t0) return null; if (t < t1) t1 = t; }
    }
  }
  return [t0, t1];
}

const lerp = (a, b, t, r) => [
  Math.min(r.maxX, Math.max(r.minX, a[0] + (b[0] - a[0]) * t)),
  Math.min(r.maxZ, Math.max(r.minZ, a[1] + (b[1] - a[1]) * t)),
];

/**
 * Clips a polyline. A line that leaves and re-enters the rectangle comes back
 * as several pieces, in order. Each piece records whether its first and last
 * point were created by the cut, so a consumer knows the road continues beyond.
 * Returns { pieces: [{ points, cutStart, cutEnd }], clipped }.
 */
export function clipLine(points, r) {
  const pieces = [];
  let cur = null;
  let clipped = false;
  const close = () => {
    if (cur && cur.points.length >= 2) pieces.push(cur);
    cur = null;
  };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const range = segmentRange(a, b, r);
    if (!range) { clipped = true; close(); continue; }
    const [t0, t1] = range;
    if (t0 > 0 || t1 < 1) clipped = true;
    const start = t0 > 0 ? lerp(a, b, t0, r) : a;
    const end = t1 < 1 ? lerp(a, b, t1, r) : b;
    if (!cur || t0 > 0) { close(); cur = { points: [start], cutStart: t0 > 0, cutEnd: false }; }
    if (end[0] !== start[0] || end[1] !== start[1]) cur.points.push(end);
    if (t1 < 1) { cur.cutEnd = true; close(); }
  }
  close();
  return { pieces, clipped };
}

/**
 * Sutherland-Hodgman clip of one closed ring (first point repeated at the end
 * or not). Returns { ring, clipped } with a closed ring, or ring = null when
 * nothing of it lies inside. A concave ring that the boundary cuts into
 * several lobes comes back as one ring whose lobes are joined along the
 * boundary edge; its area and its containment in the rectangle stay correct.
 */
export function clipRing(ring, r) {
  let pts = ring.slice();
  if (pts.length > 1 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1]) pts.pop();
  const clipped = pts.some((p) => !inside(p, r));
  if (clipped) {
    const edges = [
      [(p) => p[0] >= r.minX, (a, b) => [r.minX, a[1] + ((b[1] - a[1]) * (r.minX - a[0])) / (b[0] - a[0])]],
      [(p) => p[0] <= r.maxX, (a, b) => [r.maxX, a[1] + ((b[1] - a[1]) * (r.maxX - a[0])) / (b[0] - a[0])]],
      [(p) => p[1] >= r.minZ, (a, b) => [a[0] + ((b[0] - a[0]) * (r.minZ - a[1])) / (b[1] - a[1]), r.minZ]],
      [(p) => p[1] <= r.maxZ, (a, b) => [a[0] + ((b[0] - a[0]) * (r.maxZ - a[1])) / (b[1] - a[1]), r.maxZ]],
    ];
    for (const [keep, cut] of edges) {
      const out = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[(i + pts.length - 1) % pts.length], b = pts[i];
        if (keep(b)) { if (!keep(a)) out.push(cut(a, b)); out.push(b); }
        else if (keep(a)) out.push(cut(a, b));
      }
      pts = out;
      if (pts.length === 0) break;
    }
    pts = pts.map((p) => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]);
    pts = pts.filter((p, i) => { const q = pts[(i + pts.length - 1) % pts.length]; return p[0] !== q[0] || p[1] !== q[1]; });
  }
  if (pts.length < 3 || ringArea(pts) < 0.01) return { ring: null, clipped };
  return { ring: [...pts, pts[0]], clipped };
}

/**
 * Clips a polygon with holes. A hole that falls outside disappears; a hole cut
 * by the boundary stays as a hole touching the edge.
 * Returns { outer, holes, clipped } or null when the polygon is outside.
 */
export function clipPolygon(outer, holes, r) {
  const o = clipRing(outer, r);
  if (!o.ring) return null;
  let clipped = o.clipped;
  const kept = [];
  for (const h of holes ?? []) {
    const c = clipRing(h, r);
    clipped ||= c.clipped;
    if (c.ring) kept.push(c.ring);
  }
  return { outer: o.ring, holes: kept, clipped };
}
