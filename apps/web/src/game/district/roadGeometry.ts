import type { Color, GeometryBuffer } from "../geometry/GeometryBuffer";
import type { Point } from "./types";

/** Sharp bends are not allowed to stretch the corner further than this many times the offset. */
const MITER_LIMIT = 2.5;

/**
 * The line `offset` metres to the left of a centre line (negative: to the
 * right). "Left" is as seen when travelling along the points. Corners are
 * mitred, so both sides of a bend stay parallel to the centre line.
 */
export function offsetLine(points: readonly Point[], offset: number): Array<[number, number]> {
  const n = points.length;
  const closed = n > 3 && points[0]![0] === points[n - 1]![0] && points[0]![1] === points[n - 1]![1];
  const normal = (i: number): [number, number] | null => {
    // Left normal of the segment from point i to i + 1.
    if (i < 0 || i >= n - 1) {
      if (!closed) return null;
      i = (i + (n - 1)) % (n - 1);
    }
    const dx = points[i + 1]![0] - points[i]![0], dz = points[i + 1]![1] - points[i]![1];
    const len = Math.hypot(dx, dz);
    return len > 1e-6 ? [-dz / len, dx / len] : null;
  };
  const out: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const before = normal(i - 1), after = normal(i);
    const a = before ?? after, b = after ?? before;
    if (!a || !b) {
      out.push([points[i]![0], points[i]![1]]);
      continue;
    }
    let mx = a[0] + b[0], mz = a[1] + b[1];
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-6) {
      mx = a[0];
      mz = a[1];
    } else {
      mx /= ml;
      mz /= ml;
    }
    const scale = Math.min(MITER_LIMIT, 1 / Math.max(1e-3, mx * a[0] + mz * a[1]));
    out.push([points[i]![0] + mx * offset * scale, points[i]![1] + mz * offset * scale]);
  }
  return out;
}

/** A flat strip between two offsets from a centre line. Texture coordinates are world metres, so overlapping strips match. */
export function addStrip(buffer: GeometryBuffer, points: readonly Point[], leftOffset: number, rightOffset: number, y: number, color: Color): void {
  if (points.length < 2) return;
  const left = offsetLine(points, leftOffset);
  const right = offsetLine(points, rightOffset);
  for (let i = 1; i < points.length; i++) {
    const a = left[i - 1]!, b = left[i]!, c = right[i]!, d = right[i - 1]!;
    buffer.quad([[a[0], y, a[1]], [b[0], y, b[1]], [c[0], y, c[1]], [d[0], y, d[1]]], [0, 1, 0], [a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]], color);
  }
}

/** A flat disc, used to close the gap where roads meet at an angle. */
export function addDisc(buffer: GeometryBuffer, x: number, z: number, radius: number, y: number, color: Color, segments = 14): void {
  const ring: Array<[number, number]> = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    ring.push([x + Math.cos(a) * radius, z + Math.sin(a) * radius]);
  }
  buffer.polygonY(ring, [], y, color);
}
