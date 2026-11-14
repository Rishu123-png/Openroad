import type { DistrictRoad } from "../district/types";

/**
 * Junctions for traffic, found from the road graph, and the geometry test
 * for two vehicle bodies. Nothing here moves a vehicle: TrafficModel does.
 */

/** One road leaving a junction: the segment of `road` from point `index` to `index + dir`. */
export interface JunctionArm {
  road: number;
  roadId: string;
  index: number;
  dir: 1 | -1;
  /** The road segment this arm is, numbered by its lower point. */
  segment: number;
  /** Compass bearing of the arm, leaving the junction, in radians: 0 is +z (north), pi/2 is +x (east). */
  bearing: number;
  /** True when the arm's two lanes are far enough apart for two vehicles to pass each other. */
  wide: boolean;
}

export interface Junction {
  /** "junction@x,z" in district metres: stable for a district file. */
  id: string;
  x: number;
  z: number;
  /** Radius of the conflict area: only vehicles holding a reservation may be inside it. */
  radius: number;
  arms: JunctionArm[];
  /** Vehicles holding a reservation, in the order they were granted. */
  holders: number[];
}

export const JUNCTION = {
  /** A point where at least this many drivable road segments meet is a junction. Two is a bend or a join. */
  minArms: 3,
  /** The conflict area reaches this far beyond the widest arm's half width. */
  radiusBeyondHalfWidth: 1.5,
  minRadius: 4.5,
  maxRadius: 10,
} as const;

const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"] as const;

/** The compass name of a bearing: 0 is north (+z), pi/2 is east (+x). */
export function compass(bearing: number): string {
  const turns = ((bearing / (Math.PI * 2)) % 1 + 1) % 1;
  return COMPASS[Math.round(turns * 8) % 8]!;
}

export type Movement = "straight" | "left" | "right" | "u-turn" | "ends";

/** What a vehicle does at a junction, from the bearing it travels in on and the bearing it leaves on. */
export function movement(travelIn: number, travelOut: number): Movement {
  let turn = travelOut - travelIn;
  while (turn > Math.PI) turn -= Math.PI * 2;
  while (turn < -Math.PI) turn += Math.PI * 2;
  const degrees = (turn * 180) / Math.PI;
  if (Math.abs(degrees) <= 30) return "straight";
  if (Math.abs(degrees) >= 150) return "u-turn";
  return degrees > 0 ? "right" : "left";
}

/**
 * Finds the junctions: every point shared by road segments traffic can drive,
 * where three or more such segments meet. A point in the middle of one road
 * (a bend) and a point where two roads join end to end have two, and are not
 * junctions. Segments excluded from traffic do not count.
 *
 * `links` maps a point key to the (road, point index) pairs at that point.
 */
export function findJunctions(
  roads: readonly DistrictRoad[],
  links: ReadonlyMap<number, ReadonlyArray<{ road: number; index: number }>>,
  blocked: ReadonlyArray<ReadonlyArray<boolean>>,
  laneSeparation: (road: number, segment: number) => number,
  passingWidth: number,
): { junctions: Junction[]; byNode: Map<number, number> } {
  const junctions: Junction[] = [];
  const byNode = new Map<number, number>();
  for (const [node, list] of links) {
    const arms: JunctionArm[] = [];
    let halfWidth = 0;
    for (const link of list) {
      const road = roads[link.road]!;
      for (const dir of [1, -1] as const) {
        const next = link.index + dir;
        if (next < 0 || next >= road.points.length) continue;
        const segment = dir === 1 ? link.index : link.index - 1;
        if (blocked[link.road]?.[segment]) continue;
        const a = road.points[link.index]!, b = road.points[next]!;
        // A repeated point is not a way out of the junction.
        if (Math.round(a[0] * 10) === Math.round(b[0] * 10) && Math.round(a[1] * 10) === Math.round(b[1] * 10)) continue;
        arms.push({ road: link.road, roadId: road.id, index: link.index, dir, segment, bearing: Math.atan2(b[0] - a[0], b[1] - a[1]), wide: !road.oneway && laneSeparation(link.road, segment) >= passingWidth });
        halfWidth = Math.max(halfWidth, road.width / 2);
      }
    }
    if (arms.length < JUNCTION.minArms) continue;
    // A fixed order, so that ties in priority are settled the same way on every run.
    arms.sort((p, q) => p.bearing - q.bearing || p.road - q.road || p.index - q.index || p.dir - q.dir);
    const first = list[0]!, at = roads[first.road]!.points[first.index]!;
    byNode.set(node, junctions.length);
    junctions.push({
      id: `junction@${at[0].toFixed(1)},${at[1].toFixed(1)}`, x: at[0], z: at[1],
      radius: Math.max(JUNCTION.minRadius, Math.min(JUNCTION.maxRadius, halfWidth + JUNCTION.radiusBeyondHalfWidth)), arms, holders: [],
    });
  }
  return { junctions, byNode };
}

/**
 * True when two vehicle bodies overlap: rectangles of the given length and
 * width, centred at (x, z), facing `heading`. `margin` widens the first on
 * every side. Separating axis test on the four edge directions.
 */
export function bodiesOverlap(ax: number, az: number, ah: number, al: number, aw: number, bx: number, bz: number, bh: number, bl: number, bw: number, margin = 0): boolean {
  const dx = bx - ax, dz = bz - az;
  const reach = (al + bl + aw + bw) / 2 + margin * 2;
  if (dx * dx + dz * dz > reach * reach) return false;
  const afx = Math.sin(ah), afz = Math.cos(ah), bfx = Math.sin(bh), bfz = Math.cos(bh);
  const ahl = al / 2 + margin, ahw = aw / 2 + margin, bhl = bl / 2, bhw = bw / 2;
  // cos and sin of the angle between the two headings
  const c = Math.abs(afx * bfx + afz * bfz), s = Math.abs(afx * bfz - afz * bfx);
  // A's forward and side axes
  if (Math.abs(dx * afx + dz * afz) > ahl + bhl * c + bhw * s) return false;
  if (Math.abs(dx * afz - dz * afx) > ahw + bhl * s + bhw * c) return false;
  // B's forward and side axes
  if (Math.abs(dx * bfx + dz * bfz) > bhl + ahl * c + ahw * s) return false;
  if (Math.abs(dx * bfz - dz * bfx) > bhw + ahl * s + ahw * c) return false;
  return true;
}

/**
 * A stretch of two-way road too narrow for two vehicles to pass: its two
 * lanes are closer together than a vehicle is wide (the road is narrow, or its
 * lanes were moved toward the centre line to clear a building). Traffic uses
 * it in one direction at a time.
 */
export interface NarrowRun {
  id: string;
  /** The (road index, segment) pairs it is made of, in order from end 0 to end 1. */
  segments: Array<[number, number]>;
  roadIds: string[];
  length: number;
  /** Where it starts and stops, in district metres. */
  ends: [[number, number], [number, number]];
  /**
   * True when it must be used by one vehicle at a time: it ends in a dead end
   * or at the district's edge, so whatever goes in comes back out the same way.
   */
  exclusive: boolean;
}

export interface NarrowRuns {
  runs: NarrowRun[];
  /** Per road, per segment: the run it belongs to, or -1. */
  runOf: number[][];
  /** Per road, per segment and direction (index segment * 2, +1 for direction -1): which end of the run that travel leads to, 0 or 1. */
  towards: number[][];
}

/**
 * Groups narrow segments into runs. Narrow segments that meet at a point which
 * is not a junction (a bend, or two roads joined end to end) are one run: a
 * vehicle cannot wait or turn off between them. A junction ends a run.
 */
export function findNarrowRuns(
  roads: readonly DistrictRoad[],
  links: ReadonlyMap<number, ReadonlyArray<{ road: number; index: number }>>,
  junctionAt: ReadonlyMap<number, number>,
  isNarrow: (road: number, segment: number) => boolean,
  isDrivable: (road: number, segment: number) => boolean,
  isCutShort: (road: number, segment: number) => boolean,
): NarrowRuns {
  const nodeKey = (p: readonly [number, number]): number => Math.round(p[0] * 10) * 1_000_003 + Math.round(p[1] * 10);
  const real = (r: number, s: number): boolean => nodeKey(roads[r]!.points[s]!) !== nodeKey(roads[r]!.points[s + 1]!);
  const runOf = roads.map((road) => new Array<number>(Math.max(0, road.points.length - 1)).fill(-1));
  const towards = roads.map((road) => new Array<number>(Math.max(0, road.points.length - 1) * 2).fill(0));
  /** The drivable, real segments that meet at a point. */
  const at = (node: number): Array<[number, number]> => {
    const out: Array<[number, number]> = [];
    for (const link of links.get(node) ?? []) {
      for (const s of [link.index - 1, link.index]) {
        if (s < 0 || s >= roads[link.road]!.points.length - 1 || !real(link.road, s) || !isDrivable(link.road, s)) continue;
        if (!out.some((o) => o[0] === link.road && o[1] === s)) out.push([link.road, s]);
      }
    }
    return out;
  };
  /** The narrow segment that continues a run through a point, or null where the run ends there. */
  const onward = (node: number, r: number, s: number): [number, number] | null => {
    if (junctionAt.has(node)) return null;
    const here = at(node);
    if (here.length !== 2) return null;
    const other = here[0]![0] === r && here[0]![1] === s ? here[1]! : here[1]![0] === r && here[1]![1] === s ? here[0]! : null;
    return other && isNarrow(other[0], other[1]) ? other : null;
  };
  /** True when a vehicle can leave the run at this point onto a road it can pass on, or into a junction. */
  const open = (node: number): boolean => junctionAt.has(node) || at(node).length === 2;

  const runs: NarrowRun[] = [];
  for (let r = 0; r < roads.length; r++) {
    for (let s = 0; s < roads[r]!.points.length - 1; s++) {
      if (runOf[r]![s] !== -1 || !real(r, s) || !isDrivable(r, s) || !isNarrow(r, s)) continue;
      // Walk back to one end of the run, then forward along it. A ring of narrow segments has no end: start anywhere.
      let cr = r, cs = s, node = nodeKey(roads[r]!.points[s]!);
      for (let guard = 0; guard < 10_000; guard++) {
        const back = onward(node, cr, cs);
        if (!back || (back[0] === r && back[1] === s)) break;
        [cr, cs] = back;
        const a = nodeKey(roads[cr]!.points[cs]!), b = nodeKey(roads[cr]!.points[cs + 1]!);
        node = a === node ? b : a;
      }
      const id = runs.length;
      const run: NarrowRun = { id: `narrow/${id}`, segments: [], roadIds: [], length: 0, ends: [[0, 0], [0, 0]], exclusive: false };
      const first = node;
      let ring = false;
      for (let guard = 0; guard < 10_000; guard++) {
        const pa = roads[cr]!.points[cs]!, pb = roads[cr]!.points[cs + 1]!;
        const forward = nodeKey(pa) === node; // travelling with the road's point order leads away from end 0
        if (run.segments.length === 0) run.ends[0] = forward ? [pa[0], pa[1]] : [pb[0], pb[1]];
        runOf[cr]![cs] = id;
        towards[cr]![cs * 2] = forward ? 1 : 0;
        towards[cr]![cs * 2 + 1] = forward ? 0 : 1;
        run.segments.push([cr, cs]);
        if (!run.roadIds.includes(roads[cr]!.id)) run.roadIds.push(roads[cr]!.id);
        run.length += Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
        if (isCutShort(cr, cs)) run.exclusive = true;
        node = forward ? nodeKey(pb) : nodeKey(pa);
        run.ends[1] = forward ? [pb[0], pb[1]] : [pa[0], pa[1]];
        const next = onward(node, cr, cs);
        if (!next) break;
        if (runOf[next[0]]![next[1]] !== -1) {
          ring = true;
          break;
        }
        [cr, cs] = next;
      }
      if (ring || !open(first) || !open(node)) run.exclusive = true;
      runs.push(run);
    }
  }
  return { runs, runOf, towards };
}
