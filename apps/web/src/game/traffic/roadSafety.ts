import type { BuildingIndex } from "../district/BuildingIndex";
import type { DistrictBuilding, DistrictRoad } from "../district/types";

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
  /** Fractions of the wanted lane offset that are tried, widest first. */
  offsetSteps: [1, 0.75, 0.5, 0.25, 0],
} as const;

export type UnsafeReason =
  /** The mapped centre line itself lies inside a building footprint. */
  | "centre-line-inside-building"
  /** The centre line is clear, but a building stands within half a vehicle width of it. */
  | "building-within-vehicle-width-of-centre-line"
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

export interface RoadSafety {
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
export function analyseRoads(roads: readonly DistrictRoad[], buildings: BuildingIndex, laneOffset: (road: DistrictRoad) => number): RoadSafety {
  const S = ROAD_SAFETY, clear = laneClearance();
  const out: RoadSafety = { blocked: [], offsets: [], excluded: [], narrowed: [], roadsAffected: 0, roadsFullyExcluded: 0, excludedLength: 0, checkedLength: 0 };
  for (const road of roads) {
    const blocked: boolean[] = [], offsets: number[] = [];
    const wanted = laneOffset(road);
    for (let s = 0; s + 1 < road.points.length; s++) {
      const a = road.points[s]!, b = road.points[s + 1]!;
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      out.checkedLength += length;
      if (length < 1e-6) {
        blocked.push(false);
        offsets.push(0, 0);
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
        out.excluded.push({
          roadId: road.id, roadClass: road.class, segment: s, from: a, to: b, length, at: fault.at,
          reason: onLine ? "centre-line-inside-building" : "building-within-vehicle-width-of-centre-line",
          buildingId: fault.building.id, buildingCategory: fault.building.category,
        });
        out.excludedLength += length;
        continue;
      }
      blocked.push(false);
      // The centre line is drivable. Find the widest lane position that is too, on each side.
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
        offsets.push(used);
        if (obstacle && used < wanted) out.narrowed.push({ roadId: road.id, segment: s, direction, wantedOffset: wanted, usedOffset: used, buildingId: obstacle.id });
      }
    }
    out.blocked.push(blocked);
    out.offsets.push(offsets);
    if (blocked.some(Boolean)) out.roadsAffected++;
    if (blocked.length > 0 && blocked.every(Boolean)) out.roadsFullyExcluded++;
  }
  return out;
}
