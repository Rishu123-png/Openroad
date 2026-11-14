import type { Color, GeometryBuffer } from "../geometry/GeometryBuffer";
import { FACADE, GENERIC_FACADE_VARIANTS } from "../materials/proceduralTextures";
import type { MaterialKey } from "../materials/MaterialLibrary";
import { FACADE_RULES, FACADE_STYLES, outwardSide, usableHeight } from "./buildingGeometry";
import { pointInPolygons } from "./spawn";
import type { BuildingCategory, DistrictBuilding, Point } from "./types";

/**
 * GENERATED APPEARANCE. Nothing decided here is in the map data.
 *
 * The map gives a footprint and, rarely, a use or a number of levels. It
 * gives no colour, material, roof or facade. Everything in this file is
 * therefore decoration, chosen by a hash of the building's id so that the
 * same building always looks the same, on every load and every machine.
 *
 * A building whose use is unknown is a GENERIC RECONSTRUCTION: it gets one of
 * the plain wall patterns and never the look of a house, a block of flats or
 * a shop. Being inside a residential land-use area changes nothing here.
 */
export const APPEARANCE_RULES = {
  version: "appearance/1",
  /** Plain wall patterns for buildings of unknown use, stacked in the one generic texture. */
  genericVariants: GENERIC_FACADE_VARIANTS,
  /** No roof objects on footprints smaller than this. */
  roofObjectsMinArea: 45,
  stairHeadMinArea: 70,
  stairHeadMinHeight: 6,
  /** Roof objects stay this far inside every wall, so none overhangs the footprint. */
  roofEdgeClearance: 0.6,
  tank: { radius: 0.55, height: 1.15, stand: 0.45 },
  stairHead: { width: 2.6, depth: 3, height: 2.4 },
  /** Painted bands lie this far in front of the wall: paint, not structure. */
  bandProud: 0.03,
  plinthHeight: 0.5,
} as const;

/** 0..1 from a string; the same on every run. */
export function hash01(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

const rgb = (r: number, g: number, b: number): Color => [(r / 255) ** 2.2, (g / 255) ** 2.2, (b / 255) ** 2.2];

/** Plaster colours common on low-rise buildings in the region. They vary the street; they are not the real colours. */
const PLASTER: Color[] = [
  rgb(238, 230, 212), rgb(228, 216, 192), rgb(242, 238, 230), rgb(224, 208, 188), rgb(216, 222, 214), rgb(234, 216, 202), rgb(212, 216, 224),
  rgb(232, 224, 196), rgb(240, 226, 190), rgb(226, 200, 180), rgb(206, 214, 200), rgb(236, 232, 222), rgb(222, 226, 230), rgb(230, 210, 170),
];
const ACCENTS: Color[] = [rgb(150, 82, 60), rgb(110, 116, 122), rgb(168, 150, 120), rgb(96, 110, 96), rgb(140, 100, 84), rgb(200, 196, 188)];
const CATEGORY_WALL: Partial<Record<BuildingCategory, Color>> = {
  commercial: rgb(214, 216, 220),
  institutional: rgb(228, 212, 190),
  industrial: rgb(186, 190, 194),
  healthcare: rgb(236, 236, 232),
  other: rgb(198, 192, 182),
};

export interface RoofObject {
  kind: "water-tank" | "stair-head";
  x: number;
  z: number;
  yaw: number;
  /** Tank colour: the black and the white moulded tanks are both common. */
  dark: boolean;
}

export interface BuildingAppearance {
  /** Version of the rule set and the choice made, e.g. "appearance/1 generic-reconstruction wall=genericB". */
  rule: string;
  /** True when the building's use is unknown: every visible feature of it is a neutral guess. */
  genericReconstruction: boolean;
  wallLayer: MaterialKey;
  /** Which of the stacked plain patterns a generic wall uses (0 for every other wall). */
  wallVariant: number;
  /** The same as a shift up the wall texture, in metres. */
  wallRow: number;
  wall: Color;
  accent: Color;
  roof: Color;
  floorBands: boolean;
  plinth: boolean;
  roofObjects: RoofObject[];
}

function edgeDistance(x: number, z: number, building: DistrictBuilding): number {
  let best = Infinity;
  for (const polygon of building.polygons) {
    for (const ring of [polygon.outer, ...polygon.holes]) {
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1]!, b = ring[i]!;
        const dx = b[0] - a[0], dz = b[1] - a[1];
        const t = dx || dz ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz))) : 0;
        best = Math.min(best, Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz));
      }
    }
  }
  return best;
}

/** A point on the roof with `radius` clear of every wall and of the objects already placed, or null. */
function roofSpot(building: DistrictBuilding, radius: number, salt: string, taken: RoofObject[]): [number, number] | null {
  const ring = building.polygons[0]!.outer;
  const n = ring.length - 1;
  if (n < 3) return null;
  const [cx, cz] = building.centre;
  const start = Math.floor(hash01(`${building.id}${salt}`) * n);
  for (let k = 0; k <= 12; k++) {
    let x = cx, z = cz;
    if (k > 0) {
      const v = ring[(start + k * 3) % n]!;
      const t = 0.25 + 0.5 * hash01(`${building.id}${salt}${k}`);
      x = v[0] + (cx - v[0]) * t;
      z = v[1] + (cz - v[1]) * t;
    }
    if (!pointInPolygons(x, z, building.polygons)) continue;
    if (edgeDistance(x, z, building) < radius + APPEARANCE_RULES.roofEdgeClearance) continue;
    if (taken.some((o) => Math.hypot(o.x - x, o.z - z) < radius + 2.6)) continue;
    return [x, z];
  }
  return null;
}

function longestWallYaw(ring: readonly Point[]): number {
  let best = 0, yaw = 0;
  for (let i = 1; i < ring.length; i++) {
    const dx = ring[i]![0] - ring[i - 1]![0], dz = ring[i]![1] - ring[i - 1]![1];
    const len = dx * dx + dz * dz;
    if (len > best) [best, yaw] = [len, Math.atan2(dx, dz) - Math.PI / 2];
  }
  return yaw;
}

/** Decides how one building is dressed. Pure and deterministic: the building's id and mapped data are the only inputs. */
export function planAppearance(building: DistrictBuilding): BuildingAppearance {
  const R = APPEARANCE_RULES;
  const id = building.id;
  const generic = building.category === "unclassified";
  const wallLayer = FACADE_STYLES[building.category].wall;
  const wallVariant = wallLayer === "generic" ? Math.floor(hash01(`${id}w`) * R.genericVariants) % R.genericVariants : 0;
  const base = CATEGORY_WALL[building.category] ?? PLASTER[Math.floor(hash01(`${id}c`) * PLASTER.length)]!;
  const k = 0.93 + hash01(id) * 0.12;
  const roofShade = 0.56 + hash01(`${id}r`) * 0.12;
  const h = usableHeight(building.height);
  const plain = building.area < FACADE_RULES.plainBelowArea || h < FACADE_RULES.plainBelowHeight;

  const roofObjects: RoofObject[] = [];
  if (!plain && building.area >= R.roofObjectsMinArea) {
    const yaw = longestWallYaw(building.polygons[0]!.outer);
    if (building.area >= R.stairHeadMinArea && h >= R.stairHeadMinHeight && hash01(`${id}s`) < 0.7) {
      const spot = roofSpot(building, Math.hypot(R.stairHead.width, R.stairHead.depth) / 2, "s", roofObjects);
      if (spot) roofObjects.push({ kind: "stair-head", x: spot[0], z: spot[1], yaw, dark: false });
    }
    const roll = hash01(`${id}t`);
    const tanks = roll < 0.15 ? 0 : roll < 0.7 || building.area < 150 ? 1 : building.area > 600 ? 3 : 2;
    for (let i = 0; i < tanks; i++) {
      const spot = roofSpot(building, R.tank.radius + 0.2, `t${i}`, roofObjects);
      if (spot) roofObjects.push({ kind: "water-tank", x: spot[0], z: spot[1], yaw, dark: hash01(`${id}d${i}`) < 0.65 });
    }
  }
  const floorBands = !plain && hash01(`${id}b`) < 0.6;
  const plinth = !plain && hash01(`${id}p`) < 0.7;
  return {
    rule: `${R.version} ${generic ? "generic-reconstruction" : `category-style:${building.category}`} wall=${wallLayer}/${wallVariant}`,
    genericReconstruction: generic,
    wallLayer,
    wallVariant,
    wallRow: wallVariant * FACADE.floors * FACADE.floorHeight,
    wall: [base[0] * k, base[1] * k, base[2] * k],
    accent: ACCENTS[Math.floor(hash01(`${id}a`) * ACCENTS.length)]!,
    roof: [roofShade, roofShade * 0.97, roofShade * 0.93],
    floorBands,
    plinth,
    roofObjects,
  };
}

/**
 * Adds the generated details of `look`: painted plinth and floor bands on the
 * mapped walls, and the roof objects. All are requested with `generated` set.
 * Nothing reaches further than `bandProud` beyond the footprint.
 *
 * @returns how many of each were added
 */
export function addBuildingDetails(layer: (key: MaterialKey, generated?: boolean) => GeometryBuffer, building: DistrictBuilding, look: BuildingAppearance): { bands: number; tanks: number; stairHeads: number } {
  const R = APPEARANCE_RULES;
  const h = usableHeight(building.height);
  let bands = 0, tanks = 0, stairHeads = 0;

  if (look.plinth || look.floorBands) {
    const floors = Math.max(1, Math.round(h / FACADE.floorHeight));
    const rows: Array<[number, number, Color]> = [];
    if (look.plinth) rows.push([0, R.plinthHeight, [look.wall[0] * 0.55, look.wall[1] * 0.55, look.wall[2] * 0.55]]);
    if (look.floorBands) for (let f = 1; f < floors; f++) rows.push([(f * h) / floors - 0.11, (f * h) / floors + 0.11, look.accent]);
    const g = layer("plaster", true);
    for (const polygon of building.polygons) {
      const rings: Array<[readonly Point[], boolean]> = [[polygon.outer, false], ...polygon.holes.map((hole): [readonly Point[], boolean] => [hole, true])];
      for (const [ring, isHole] of rings) {
        const flip = outwardSide(ring, isHole);
        for (let i = 1; i < ring.length; i++) {
          const a = ring[i - 1]!, b = ring[i]!;
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (len < 1) continue;
          const nx = ((b[1] - a[1]) / len) * flip, nz = (-(b[0] - a[0]) / len) * flip;
          const ox = nx * R.bandProud, oz = nz * R.bandProud;
          const [lx, lz, rx, rz] = flip === 1 ? [b[0], b[1], a[0], a[1]] : [a[0], a[1], b[0], b[1]];
          for (const [y0, y1, color] of rows) {
            g.wallUV(lx + ox, lz + oz, rx + ox, rz + oz, y0, y1, nx, nz, color, 0, len, y0, y1);
            bands++;
          }
        }
      }
    }
  }

  for (const o of look.roofObjects) {
    const g = layer("plaster", true);
    if (o.kind === "stair-head") {
      g.box(o.x, h, o.z, R.stairHead.width, R.stairHead.height, R.stairHead.depth, { yaw: o.yaw, color: look.wall, topColor: look.roof });
      stairHeads++;
    } else {
      const tone: Color = o.dark ? [0.03, 0.03, 0.035] : [0.8, 0.8, 0.78];
      g.box(o.x, h, o.z, 1.3, R.tank.stand, 1.3, { yaw: o.yaw, color: [look.wall[0] * 0.8, look.wall[1] * 0.8, look.wall[2] * 0.8] });
      g.cylinder(o.x, h + R.tank.stand, o.z, R.tank.height, R.tank.radius, R.tank.radius * 0.92, 10, tone);
      tanks++;
    }
  }
  return { bands, tanks, stairHeads };
}
