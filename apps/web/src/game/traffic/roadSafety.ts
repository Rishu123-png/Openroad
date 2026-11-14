import type { BuildingIndex } from "../district/BuildingIndex";
import type { DistrictBounds, DistrictBuilding, DistrictRoad } from "../district/types";

/**
 * Decides which parts of the mapped roads traffic may drive on.
 *
 * The map is not changed. A road that runs through a mapped building (a
 * gateway, a canopy, a mapping error) or too close to one for a vehicle to
 * pass is still drawn exactly as mapped; traffic simply does not use that
 * stretch, and the reason is recorded here. Where only the lane position is
 * the problem, because the road's width is an estimate and a building stands
 * nearer than the estimate allows, the lane is moved toward the centre line
 * instead.
 */
export const ROAD_SAFETY = {
  /** Spacing of the checks along a road, in metres. */
  step: 0.5,
  /** Half the width of the widest traffic vehicle (1.86 m). */
  vehicleHalfWidth: 0.93,
  /** Room kept between a vehicle's side and a wall. */
  margin: 0.25,
  /** Half the length of the longest traffic vehicle (4.70 m). */
  vehicleHalfLength: 2.35,
  /** A stretch of lane shorter than this inside the district is not worth driving. */
  minInsideLength: 6,
  /** Fractions of the wanted lane offset that are tried, widest first. */
  offsetSteps: [1, 0.75, 0.5, 0.25, 0],
} as const;

export type UnsafeReason =
  /** The mapped centre line itself lies inside a building footprint. */
  | "centre-line-inside-building"
  /** The centre line is clear, but a building stands within half a vehicle width of it. */
  | "building-within-vehicle-width-of-centre-line"
  /** The lane lies outside the district, or so near its edge that a vehicle's body would cross it. */
  | "lane-outside-district-boundary"
  /** Found while driving: a vehicle on this stretch had no position clear of a building. The checks before driving missed it. */
  | "vehicle-had-no-safe-position";

export interface ExcludedSegment {
  roadId: string;
  roadClass: string;
  /** Index of the segment's first point in the road's point list. */
  segment: number;
  from: readonly [number, number];
  to: readonly [number, number];
  length: number;
  reason: UnsafeReason;
  buildingId: string;
  buildingCategory: string;
  /** Where the first failing check was. */
  at: readonly [number, number];
}

export interface NarrowedLane {
  roadId: string;
  segment: number;
  /** 1: travelling in the order of the points; -1: against it. */
  direction: 1 | -1;
  wantedOffset: number;
  usedOffset: number;
  buildingId: string;
}

/** A lane cut short because the road runs up to, or across, the district boundary. */
export interface TrimmedLane {
  roadId: string;
  segment: number;
  direction: 1 | -1;
  /** The part vehicles may drive, in metres from the segment's first point. */
  from: number;
  to: number;
  segmentLength: number;
}

export interface RoadSafety {
  /**
   * Per road, per segment and direction: the part of the lane inside the district with room for a whole vehicle,
   * as [from, to] in metres from the segment's first point. Index (segment * 2 + (direction === 1 ? 0 : 1)) * 2.
   */
  limits: number[][];
  trimmed: TrimmedLane[];
  /** The boundary vehicles are kept inside, and how far inside it lane lines must stay. */
  boundaryInset: number;
  /** Per road, per segment: true when traffic must not use it. */
  blocked: boolean[][];
  /** Per road, per segment and direction (index segment * 2, +1 for direction -1): lane offset to the left of travel. */
  offsets: number[][];
  excluded: ExcludedSegment[];
  narrowed: NarrowedLane[];
  /** Roads with at least one excluded segment, and roads with none left. */
  roadsAffected: number;
  roadsFullyExcluded: number;
  excludedLength: number;
  checkedLength: number;
}

/**
 * How far inside the district boundary a vehicle's centre must stay so that no
 * corner of its body can cross the boundary, whichever way it faces: half the
 * diagonal of the largest vehicle, plus the margin.
 */
export const boundaryInset = (): number => Math.hypot(ROAD_SAFETY.vehicleHalfLength, ROAD_SAFETY.vehicleHalfWidth) + ROAD_SAFETY.margin;

/** The first corner of a vehicle-sized rectangle that lies outside the bounds, with how far out it is; or null. */
export function footprintOutside(bounds: DistrictBounds, x: number, z: number, heading: number, length: number, width: number): { part: string; distance: number; x: number; z: number } | null {
  const fx = Math.sin(heading), fz = Math.cos(heading), rx = fz, rz = -fx;
  const hl = length / 2, hw = width / 2;
  let worst: { part: string; distance: number; x: number; z: number } | null = null;
  for (const [along, across, part] of BODY_PARTS) {
    const px = x + fx * along * hl + rx * across * hw, pz = z + fz * along * hl + rz * across * hw;
    const distance = Math.max(bounds.minX - px, px - bounds.maxX, bounds.minZ - pz, pz - bounds.maxZ);
    if (distance > 0 && (!worst || distance > worst.distance)) worst = { part, distance, x: px, z: pz };
  }
  return worst;
}
const BODY_PARTS: ReadonlyArray<readonly [number, number, string]> = [[0, 0, "centre"], [1, -1, "front left corner"], [1, 1, "front right corner"], [-1, -1, "rear left corner"], [-1, 1, "rear right corner"]];

/** The part of the line a + t * (dx, dz), t in [0, length], inside the rectangle inset by `inset`: [from, to], or null. */
function insideInterval(ax: number, az: number, dx: number, dz: number, length: number, b: DistrictBounds, inset: number): [number, number] | null {
  let t0 = 0, t1 = length;
  const clip = (p: number, d: number, min: number, max: number): boolean => {
    if (Math.abs(d) < 1e-12) return p >= min && p <= max;
    let lo = (min - p) / d, hi = (max - p) / d;
    if (lo > hi) [lo, hi] = [hi, lo];
    t0 = Math.max(t0, lo);
    t1 = Math.min(t1, hi);
    return t0 <= t1;
  };
  if (!clip(ax, dx, b.minX + inset, b.maxX - inset) || !clip(az, dz, b.minZ + inset, b.maxZ - inset)) return null;
  return [t0, t1];
}

/** The clearance, from a lane's centre, that must be free of buildings. */
export const laneClearance = (): number => ROAD_SAFETY.vehicleHalfWidth + ROAD_SAFETY.margin;

/**
 * True when a vehicle-sized rectangle overlaps a building. Checks the centre,
 * the four corners and the middle of each side, so a wall corner entering
 * anywhere along the body is seen. Returns the building, or null.
 */
export function footprintHit(buildings: BuildingIndex, x: number, z: number, heading: number, length: number, width: number): DistrictBuilding | null {
  const fx = Math.sin(heading), fz = Math.cos(heading); // forward
  const rx = fz, rz = -fx; // right
  const hl = length / 2, hw = width / 2;
  for (let i = 0; i < FOOTPRINT_POINTS.length; i += 2) {
    const along = FOOTPRINT_POINTS[i]! * hl, across = FOOTPRINT_POINTS[i + 1]! * hw;
    const hit = buildings.at(x + fx * along + rx * across, z + fz * along + rz * across);
    if (hit) return hit;
  }
  return null;
}
// (along, across) in half-lengths and half-widths: centre, corners, side and end midpoints, and the quarter points of the long sides.
const FOOTPRINT_POINTS = [0, 0, 1, 1, 1, -1, -1, 1, -1, -1, 1, 0, -1, 0, 0, 1, 0, -1, 0.5, 1, 0.5, -1, -0.5, 1, -0.5, -1];

/**
 * Checks every segment of every road against the buildings.
 * `laneOffset` is the lane position traffic would like on a road, in metres left of travel.
 */
export function analyseRoads(roads: readonly DistrictRoad[], buildings: BuildingIndex, laneOffset: (road: DistrictRoad) => number, bounds?: DistrictBounds): RoadSafety {
  const S = ROAD_SAFETY, clear = laneClearance(), inset = boundaryInset();
  const out: RoadSafety = { limits: [], trimmed: [], boundaryInset: inset, blocked: [], offsets: [], excluded: [], narrowed: [], roadsAffected: 0, roadsFullyExcluded: 0, excludedLength: 0, checkedLength: 0 };
  for (const road of roads) {
    const blocked: boolean[] = [], offsets: number[] = [], limits: number[] = [];
    const wanted = laneOffset(road);
    for (let s = 0; s + 1 < road.points.length; s++) {
      const a = road.points[s]!, b = road.points[s + 1]!;
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      out.checkedLength += length;
      if (length < 1e-6) {
        blocked.push(false);
        offsets.push(0, 0);
        limits.push(0, length, 0, length);
        continue;
      }
      const dx = (b[0] - a[0]) / length, dz = (b[1] - a[1]) / length;
      const lx = -dz, lz = dx; // left of travel from a to b
      const steps = Math.max(1, Math.ceil(length / S.step));
      /** The first building met by a line parallel to the segment, `lateral` metres to its left. */
      const along = (lateral: number): { building: DistrictBuilding; at: readonly [number, number] } | null => {
        for (let i = 0; i <= steps; i++) {
          const t = (i / steps) * length;
          const x = a[0] + dx * t + lx * lateral, z = a[1] + dz * t + lz * lateral;
          const building = buildings.at(x, z);
          if (building) return { building, at: [x, z] };
        }
        return null;
      };
      const corridor = (centre: number): { building: DistrictBuilding; at: readonly [number, number] } | null => along(centre) ?? along(centre - clear) ?? along(centre + clear);

      const onLine = along(0);
      const beside = onLine ? null : (along(-clear) ?? along(clear));
      const fault = onLine ?? beside;
      if (fault) {
        blocked.push(true);
        offsets.push(0, 0);
        limits.push(0, 0, 0, 0);
        out.excluded.push({
          roadId: road.id, roadClass: road.class, segment: s, from: a, to: b, length, at: fault.at,
          reason: onLine ? "centre-line-inside-building" : "building-within-vehicle-width-of-centre-line",
          buildingId: fault.building.id, buildingCategory: fault.building.category,
        });
        out.excludedLength += length;
        continue;
      }
      // The centre line is drivable. Find the widest lane position that is too, on each side.
      const laneOffsets: number[] = [];
      for (const direction of [1, -1] as const) {
        let used = 0, obstacle: DistrictBuilding | null = null;
        for (const f of S.offsetSteps) {
          const offset = wanted * f;
          const hit = offset === 0 ? null : corridor(offset * direction);
          if (!hit) {
            used = offset;
            break;
          }
          obstacle ??= hit.building;
        }
        laneOffsets.push(used);
        if (obstacle && used < wanted) out.narrowed.push({ roadId: road.id, segment: s, direction, wantedOffset: wanted, usedOffset: used, buildingId: obstacle.id });
      }

      // The district boundary. Each lane line is kept far enough inside it for a whole vehicle at any heading.
      const laneLimits: number[] = [];
      let outside = false;
      for (const direction of [1, -1] as const) {
        if (direction === -1 && road.oneway) {
          laneLimits.push(0, 0); // never driven
          continue;
        }
        const lateral = laneOffsets[direction === 1 ? 0 : 1]! * direction;
        const part = bounds ? insideInterval(a[0] + lx * lateral, a[1] + lz * lateral, dx, dz, length, bounds, inset) : ([0, length] as [number, number]);
        // Usable when the whole segment is inside, or when what is left is long enough to drive and turn round on.
        if (!part || (part[1] - part[0] < length - 1e-6 && part[1] - part[0] < Math.min(S.minInsideLength, length))) {
          outside = true;
          laneLimits.push(0, 0);
          continue;
        }
        laneLimits.push(part[0], part[1]);
      }
      if (outside) {
        blocked.push(true);
        offsets.push(0, 0);
        limits.push(0, 0, 0, 0);
        // The first point of the segment's centre line that is in the edge zone or beyond it.
        const whole = insideInterval(a[0], a[1], dx, dz, length, bounds!, inset);
        const t = !whole ? 0 : whole[0] > 1e-6 ? 0 : whole[1];
        out.excluded.push({ roadId: road.id, roadClass: road.class, segment: s, from: a, to: b, length, at: [a[0] + dx * t, a[1] + dz * t], reason: "lane-outside-district-boundary", buildingId: "district-boundary", buildingCategory: "boundary" });
        out.excludedLength += length;
        continue;
      }
      blocked.push(false);
      offsets.push(laneOffsets[0]!, laneOffsets[1]!);
      limits.push(...laneLimits);
      [1, -1].forEach((direction, i) => {
        const from = laneLimits[i * 2]!, to = laneLimits[i * 2 + 1]!;
        if ((direction === 1 || !road.oneway) && (from > 1e-6 || to < length - 1e-6)) out.trimmed.push({ roadId: road.id, segment: s, direction: direction as 1 | -1, from, to, segmentLength: length });
      });
    }
    out.blocked.push(blocked);
    out.offsets.push(offsets);
    out.limits.push(limits);
    if (blocked.some(Boolean)) out.roadsAffected++;
    if (blocked.length > 0 && blocked.every(Boolean)) out.roadsFullyExcluded++;
  }
  return out;
}
