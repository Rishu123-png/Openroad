import { Random } from "../../utils/random";
import type { BuildingIndex } from "./BuildingIndex";
import type { SegmentGrid } from "./SegmentGrid";
import { pointInPolygons } from "./spawn";
import type { DistrictData } from "./types";

/**
 * GENERATED DECORATION. Nothing placed by this file is in the map data.
 *
 * Trees, street lights, parked cars and drain grates are added by rule to make
 * streets readable at eye level. They mark no real object. Each returned item carries
 * `generated: true` and the rule that placed it, and the debug view colours
 * them separately from mapped objects.
 */
export const DECORATION_RULES = {
  seed: 86832,
  /** Road classes that get roadside trees. */
  treeClasses: ["primary", "secondary", "tertiary", "residential", "unclassified", "living_street"],
  treeSpacing: 28,
  treeSetback: 2.4,
  /** Road classes that get street lights. */
  lightClasses: ["trunk", "primary", "secondary", "tertiary"],
  lightSpacing: 48,
  lightSetback: 0.9,
  /** A generated light is dropped when a mapped lamp is this close. */
  lightNearMapped: 25,
  /** One tree per this many square metres of mapped green area. */
  parkAreaPerTree: 420,
  parkTreeLimit: 600,
  /** Road classes that get a parked car now and then. */
  parkedClasses: ["residential", "living_street", "unclassified"],
  /** Average distance between parked cars along such a road. */
  parkedSpacing: 110,
  parkedLimit: 40,
  /** Parked cars stand fully off the carriageway, this far beyond its edge. */
  parkedSetback: 1.15,
  parkedClearance: 2.2,
  /** Drain grates along the kerb of the roads that get street lights. */
  grateSpacing: 40,
  /** Kept clear of walls and of road and path surfaces, in metres. */
  buildingClearance: 2.5,
  roadClearance: 1.2,
} as const;

export interface Decoration {
  kind: "tree" | "streetLight" | "parkedCar" | "grate";
  generated: true;
  rule: "roadside-tree" | "park-tree" | "roadside-light" | "parked-car" | "kerb-grate";
  /** For parked cars: which model and colour. */
  variant?: number;
  x: number;
  z: number;
  yaw: number;
  scale: number;
}

export function placeDecorations(district: DistrictData, obstacles: SegmentGrid, roadSurfaces: SegmentGrid, buildings: BuildingIndex): Decoration[] {
  const R = DECORATION_RULES;
  const random = new Random(R.seed);
  const out: Decoration[] = [];
  const b = district.bounds;
  const free = (x: number, z: number): boolean =>
    x > b.minX + 1 && x < b.maxX - 1 && z > b.minZ + 1 && z < b.maxZ - 1 &&
    !roadSurfaces.near(x, z, R.roadClearance) && !obstacles.near(x, z, R.buildingClearance) && buildings.at(x, z) === null;
  const mappedLamps = district.furniture.filter((f) => f.kind === "street_lamp");

  // Parked cars first, so that trees and lights keep clear of them.
  let parked = 0;
  for (const road of district.roads) {
    if (road.kind !== "road" || road.tunnel || road.elevated || !R.parkedClasses.includes(road.class as never)) continue;
    let travelled = 0;
    let next = random.range(15, R.parkedSpacing * 1.5);
    for (let i = 1; i < road.points.length && parked < R.parkedLimit; i++) {
      const p = road.points[i - 1]!, q = road.points[i]!;
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < 1e-3) continue;
      const dx = (q[0] - p[0]) / len, dz = (q[1] - p[1]) / len;
      for (; next <= travelled + len && parked < R.parkedLimit; next += R.parkedSpacing * random.range(0.5, 1.6)) {
        const t = next - travelled;
        const side = random.chance(0.5) ? 1 : -1;
        const off = (road.width / 2 + R.parkedSetback) * side;
        const x = p[0] + dx * t - dz * off, z = p[1] + dz * t + dx * off;
        // Both ends of the car must be clear of every road surface, wall and building.
        let ok = true;
        for (const e of [-1.9, 0, 1.9]) {
          const ex = x + dx * e, ez = z + dz * e;
          if (ex < b.minX + 3 || ex > b.maxX - 3 || ez < b.minZ + 3 || ez > b.maxZ - 3 || roadSurfaces.near(ex, ez, 0.95) || obstacles.near(ex, ez, R.parkedClearance) || buildings.at(ex, ez)) ok = false;
        }
        if (!ok) continue;
        // Parked on the left of the direction it faces, as vehicles are in India.
        out.push({ kind: "parkedCar", generated: true, rule: "parked-car", x, z, yaw: Math.atan2(dx * side, dz * side), scale: 1, variant: random.int(0, 999) });
        obstacles.add(x - dx * 1.3, z - dz * 1.3, x + dx * 1.3, z + dz * 1.3, 0.95);
        parked++;
      }
      travelled += len;
    }
  }

  for (const road of district.roads) {
    if (road.kind !== "road" || road.tunnel || road.elevated) continue;
    const trees = R.treeClasses.includes(road.class as never);
    const lights = R.lightClasses.includes(road.class as never);
    if (!trees && !lights) continue;
    const walk = road.sidewalk === "both" || road.sidewalk === "left" || road.sidewalk === "right" || road.sidewalk === "yes" ? 1.8 : 0;
    let travelled = 0;
    let nextTree = random.range(4, R.treeSpacing);
    let nextLight = random.range(6, R.lightSpacing);
    let nextGrate = random.range(5, R.grateSpacing);
    let side = random.chance(0.5) ? 1 : -1;
    for (let i = 1; i < road.points.length; i++) {
      const p = road.points[i - 1]!, q = road.points[i]!;
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < 1e-3) continue;
      const dx = (q[0] - p[0]) / len, dz = (q[1] - p[1]) / len;
      const place = (at: number, setback: number): [number, number] => {
        const t = at - travelled;
        const off = (road.width / 2 + walk + setback) * side;
        return [p[0] + dx * t - dz * off, p[1] + dz * t + dx * off];
      };
      while (trees && nextTree <= travelled + len) {
        const [x, z] = place(nextTree, R.treeSetback + random.range(0, 1.2));
        if (free(x, z)) out.push({ kind: "tree", generated: true, rule: "roadside-tree", x, z, yaw: random.range(0, Math.PI * 2), scale: random.range(0.75, 1.15) });
        nextTree += R.treeSpacing * random.range(0.8, 1.25);
        side = -side;
      }
      while (lights && nextLight <= travelled + len) {
        const [x, z] = place(nextLight, R.lightSetback);
        const nearMapped = mappedLamps.some((m) => Math.hypot(m.point[0] - x, m.point[1] - z) < R.lightNearMapped);
        if (!nearMapped && free(x, z)) out.push({ kind: "streetLight", generated: true, rule: "roadside-light", x, z, yaw: Math.atan2(dx, dz), scale: 1 });
        nextLight += R.lightSpacing;
      }
      while (lights && nextGrate <= travelled + len) {
        const t = nextGrate - travelled;
        for (const edge of [1, -1]) {
          const off = (road.width / 2 - 0.35) * edge;
          out.push({ kind: "grate", generated: true, rule: "kerb-grate", x: p[0] + dx * t - dz * off, z: p[1] + dz * t + dx * off, yaw: Math.atan2(dx, dz), scale: 1 });
        }
        nextGrate += R.grateSpacing;
      }
      travelled += len;
    }
  }

  let parkTrees = 0;
  for (const area of district.areas) {
    if (area.kind !== "green") continue;
    for (const polygon of area.polygons) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const p of polygon.outer) {
        x0 = Math.min(x0, p[0]);
        x1 = Math.max(x1, p[0]);
        z0 = Math.min(z0, p[1]);
        z1 = Math.max(z1, p[1]);
      }
      const step = Math.sqrt(R.parkAreaPerTree);
      for (let x = x0 + step / 2; x < x1; x += step) {
        for (let z = z0 + step / 2; z < z1; z += step) {
          const tx = x + random.range(-0.4, 0.4) * step, tz = z + random.range(-0.4, 0.4) * step;
          if (parkTrees >= R.parkTreeLimit || !pointInPolygons(tx, tz, [polygon]) || !free(tx, tz)) continue;
          out.push({ kind: "tree", generated: true, rule: "park-tree", x: tx, z: tz, yaw: random.range(0, Math.PI * 2), scale: random.range(0.8, 1.3) });
          parkTrees++;
        }
      }
    }
  }
  return out;
}
