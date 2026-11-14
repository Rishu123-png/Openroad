import type { Color, GeometryBuffer } from "../geometry/GeometryBuffer";
import type { SegmentGrid } from "./SegmentGrid";
import type { DistrictJunction, DistrictRoad } from "./types";

/**
 * GENERATED ROAD MARKINGS. OpenStreetMap does not record where paint is.
 *
 * These follow the mapped centre line and the mapped or estimated width, and
 * are drawn by rule from the road class and lane count. They show the kind of
 * marking such a road normally has, not the paint that is really there.
 */
export const MARKING_RULES = {
  /** Classes that get any markings. Residential streets get none. */
  classes: ["trunk", "primary", "secondary", "tertiary"],
  /** Classes that also get solid edge lines. */
  edgeLineClasses: ["trunk", "primary", "secondary"],
  minWidth: 5.5,
  minLaneWidth: 2.5,
  lineWidth: 0.12,
  dash: 3,
  gap: 4.5,
  edgeInset: 0.3,
  /** Markings stop this far short of a junction's edge. */
  junctionClearance: 2.5,
  stopLineWidth: 0.3,
  /** Zebra crossings only on arms of these classes, at junctions of three or more arms. */
  crossingClasses: ["trunk", "primary", "secondary"],
  crossingLength: 3,
  crossingStripe: 0.5,
} as const;

const PAINT: Color = [1, 1, 1];
const UP = [0, 1, 0] as const;

function strip(g: GeometryBuffer, ax: number, az: number, bx: number, bz: number, half: number, y: number, color: Color = PAINT): void {
  const len = Math.hypot(bx - ax, bz - az);
  if (len < 1e-3) return;
  const nx = (-(bz - az) / len) * half, nz = ((bx - ax) / len) * half;
  g.quad([[ax + nx, y, az + nz], [bx + nx, y, bz + nz], [bx - nx, y, bz - nz], [ax - nx, y, az - nz]], UP, [ax + nx, az + nz, bx + nx, bz + nz, bx - nx, bz - nz, ax - nx, az - nz], color);
}

/** A line `offset` metres left of the centre line, in dashes (or solid when gap is 0), skipping junction zones. */
export function addLine(g: GeometryBuffer, road: DistrictRoad, offset: number, dash: number, gap: number, y: number, skip: SegmentGrid): number {
  let made = 0;
  let phase = 0; // distance into the current dash-gap cycle
  const cycle = dash + gap;
  for (let i = 1; i < road.points.length; i++) {
    const a = road.points[i - 1]!, b = road.points[i]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-3) continue;
    const dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len;
    const ox = -dz * offset, oz = dx * offset;
    let s = 0;
    while (s < len) {
      const inCycle = phase % cycle;
      if (inCycle < dash) {
        const e = Math.min(len, s + (dash - inCycle));
        const x0 = a[0] + dx * s + ox, z0 = a[1] + dz * s + oz, x1 = a[0] + dx * e + ox, z1 = a[1] + dz * e + oz;
        if (e - s > 0.2 && !skip.near(x0, z0, 0) && !skip.near(x1, z1, 0)) {
          strip(g, x0, z0, x1, z1, MARKING_RULES.lineWidth / 2, y);
          made++;
        }
        phase += e - s;
        s = e;
      } else {
        const e = Math.min(len, s + (cycle - inCycle));
        phase += e - s;
        s = e;
      }
    }
  }
  return made;
}

/** Lane lines for one road, by rule. Returns the number of painted pieces. */
export function addLaneMarkings(g: GeometryBuffer, road: DistrictRoad, y: number, junctionZones: SegmentGrid): number {
  const M = MARKING_RULES;
  if (road.kind !== "road" || !M.classes.includes(road.class as never) || road.width < M.minWidth || road.tunnel) return 0;
  const least = road.oneway ? 1 : 2;
  const stated = Number.isFinite(road.lanes) ? Math.round(road.lanes as number) : least;
  // A lane count the width cannot hold is a data error: never paint lanes narrower than minLaneWidth.
  let lanes = Math.max(least, Math.min(stated, Math.floor(road.width / M.minLaneWidth)));
  // A two-way road is split evenly about its centre line; an odd count (a shared middle lane) is drawn as the even count below it.
  if (!road.oneway) lanes -= lanes % 2;
  let made = 0;
  if (!road.oneway) {
    // Centre line: broken on two-lane roads, solid where there are two or more lanes each way.
    made += lanes >= 4 ? addLine(g, road, 0, 2, 0, y, junctionZones) : addLine(g, road, 0, M.dash, M.gap, y, junctionZones);
  }
  // Lane dividers between lanes going the same way.
  const lane = road.width / lanes;
  for (let k = 1; k < lanes; k++) {
    const offset = -road.width / 2 + k * lane;
    if (!road.oneway && Math.abs(offset) < 0.2) continue; // that one is the centre line
    made += addLine(g, road, offset, M.dash, M.gap, y, junctionZones);
  }
  if (M.edgeLineClasses.includes(road.class as never)) {
    for (const side of [1, -1]) made += addLine(g, road, side * (road.width / 2 - M.edgeInset), 2, 0, y, junctionZones);
  }
  return made;
}

/**
 * Stop lines, and zebra crossings on the larger roads, on each arm of a
 * junction of three or more arms. Returns [stop lines, crossings].
 */
export function addJunctionMarkings(g: GeometryBuffer, junction: DistrictJunction, roads: readonly DistrictRoad[], y: number): [number, number] {
  const M = MARKING_RULES;
  let stops = 0, crossings = 0;
  if (junction.arms < 3) return [0, 0];
  const [jx, jz] = junction.point;
  for (const road of roads) {
    if (road.kind !== "road" || !M.classes.includes(road.class as never) || road.width < M.minWidth) continue;
    for (let i = 0; i < road.points.length; i++) {
      const p = road.points[i]!;
      if (Math.abs(p[0] - jx) > 0.06 || Math.abs(p[1] - jz) > 0.06) continue;
      for (const step of [1, -1]) {
        const q = road.points[i + step];
        if (!q) continue;
        const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
        const start = junction.radius + 1.2;
        if (len < start + M.crossingLength + 2) continue; // the arm bends too soon to place markings reliably
        const ax = (q[0] - p[0]) / len, az = (q[1] - p[1]) / len; // away from the junction
        // Traffic approaching along this arm travels toward the junction; with left-hand traffic its side is to its left.
        const approaching = road.oneway ? step === -1 : true;
        const lx = az, lz = -ax; // left of the approaching direction
        const half = road.width / 2 - 0.3;
        let d = start;
        if (M.crossingClasses.includes(road.class as never)) {
          for (let o = -half + M.crossingStripe / 2; o <= half; o += M.crossingStripe * 2) {
            strip(g, p[0] + ax * d + lx * o, p[1] + az * d + lz * o, p[0] + ax * (d + M.crossingLength) + lx * o, p[1] + az * (d + M.crossingLength) + lz * o, M.crossingStripe / 2, y);
          }
          crossings++;
          d += M.crossingLength + 1;
        }
        if (approaching) {
          const from = road.oneway ? -half : 0.1;
          const cx = p[0] + ax * d, cz = p[1] + az * d;
          strip(g, cx + lx * from, cz + lz * from, cx + lx * half, cz + lz * half, M.stopLineWidth / 2, y);
          stops++;
        }
      }
    }
  }
  return [stops, crossings];
}

/** A painted hump across the road at a mapped traffic-calming point. */
export function addSpeedBreaker(g: GeometryBuffer, x: number, z: number, roads: readonly DistrictRoad[], y: number): boolean {
  let best: { d: number; ax: number; az: number; road: DistrictRoad; px: number; pz: number } | null = null;
  for (const road of roads) {
    if (road.kind !== "road") continue;
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1]!, b = road.points[i]!;
      const len2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
      if (len2 < 1e-6) continue;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * (b[0] - a[0]) + (z - a[1]) * (b[1] - a[1])) / len2));
      const px = a[0] + (b[0] - a[0]) * t, pz = a[1] + (b[1] - a[1]) * t;
      const d = Math.hypot(px - x, pz - z);
      if (!best || d < best.d) {
        const len = Math.sqrt(len2);
        best = { d, ax: (b[0] - a[0]) / len, az: (b[1] - a[1]) / len, road, px, pz };
      }
    }
  }
  if (!best || best.d > best.road.width) return false;
  const half = best.road.width / 2;
  // Alternating yellow and dark bands across the road.
  const bands = Math.max(4, Math.round(best.road.width / 0.6));
  for (let k = 0; k < bands; k++) {
    const o0 = -half + (k * 2 * half) / bands, o1 = -half + ((k + 1) * 2 * half) / bands;
    const mid = (o0 + o1) / 2;
    const cx = best.px - best.az * mid, cz = best.pz + best.ax * mid;
    strip(g, cx - best.ax * 0.45, cz - best.az * 0.45, cx + best.ax * 0.45, cz + best.az * 0.45, (o1 - o0) / 2, y, k % 2 === 0 ? [1, 0.72, 0.05] : [0.12, 0.12, 0.12]);
  }
  return true;
}
