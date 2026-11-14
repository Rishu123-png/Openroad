import type { Color, GeometryBuffer } from "../geometry/GeometryBuffer";
import { FACADE } from "../materials/proceduralTextures";
import type { MaterialKey } from "../materials/MaterialLibrary";
import { offsetLine } from "./roadGeometry";
import type { BuildingCategory, DistrictBuilding, Point, Polygon } from "./types";

function signedArea(ring: readonly Point[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j]![0] * ring[i]![1] - ring[i]![0] * ring[j]![1];
  return a / 2;
}

/** +1 when the outside of the building is to the right of each edge of this ring, -1 when it is to the left. */
function outwardSide(ring: readonly Point[], isHole: boolean): 1 | -1 {
  // For a counter-clockwise ring the outside is to the right. A courtyard wall faces into the hole instead.
  return signedArea(ring) > 0 !== isHole ? 1 : -1;
}

function walls(buffer: GeometryBuffer, ring: readonly Point[], y0: number, y1: number, color: Color, isHole: boolean): void {
  const flip = outwardSide(ring, isHole);
  let u = 0;
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1]!, b = ring[i]!;
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) continue;
    buffer.wall(a[0], a[1], b[0], b[1], y0, y1, (dz / len) * flip, (-dx / len) * flip, color, u);
    u += len;
  }
}

/**
 * Extrudes a mapped footprint straight up to a flat roof. Every wall stands
 * on an edge of the footprint, and courtyards stay open, so the plan of the
 * building is exactly the mapped outline. Only the height can be an estimate.
 */
export function extrudeFootprint(buffer: GeometryBuffer, polygons: readonly Polygon[], y0: number, height: number, wallColor: Color, roofColor: Color): void {
  for (const polygon of polygons) {
    walls(buffer, polygon.outer, y0, y0 + height, wallColor, false);
    for (const hole of polygon.holes) walls(buffer, hole, y0, y0 + height, wallColor, true);
    buffer.polygonY(polygon.outer, polygon.holes, y0 + height, roofColor);
  }
}

/**
 * How each category is dressed. These are GENERIC TREATMENTS chosen by
 * category, not records of the real buildings: the window pattern, the floor
 * lines, the balconies, the door and the colours are all generated.
 */
export const FACADE_STYLES: Record<BuildingCategory, { wall: MaterialKey; ground?: MaterialKey; balconies?: boolean; door: boolean }> = {
  house: { wall: "residential", door: true },
  apartments: { wall: "residential", balconies: true, door: true },
  commercial: { wall: "ribbon", ground: "shopfront", door: false },
  institutional: { wall: "ribbon", door: true },
  healthcare: { wall: "ribbon", door: true },
  industrial: { wall: "plaster", door: true },
  other: { wall: "plaster", door: false },
  // Use unknown: a plain wall with plain windows. Not styled as a house.
  unclassified: { wall: "generic", door: true },
};

export const FACADE_RULES = {
  /** Footprints smaller or lower than this are sheds and kiosks: plain walls, no parapet. */
  plainBelowArea: 30,
  plainBelowHeight: 3.6,
  /** Walls shorter than this get plain plaster; a window pattern would be cut in half. */
  minPatternWall: 2.4,
  parapetHeight: 0.6,
  parapetThickness: 0.2,
  shopfrontHeight: 4,
  balconyMinWall: 9,
  balconyDepth: 1.0,
  balconyLimit: 48,
} as const;

/** Layers a building may add geometry to; the caller records them for the debug views. */
export const BUILDING_LAYERS: readonly MaterialKey[] = ["plaster", "residential", "generic", "ribbon", "shopfront", "concrete"];

const DOOR: Color = [0.16, 0.1, 0.06];
const FRAME: Color = [0.75, 0.73, 0.68];

/**
 * A mapped footprint dressed as a building.
 *
 * The plan is untouched: every wall stands on a footprint edge and the roof
 * covers exactly the mapped outline. On top of that come a facade pattern
 * fitted to each wall (whole bays, whole floors), a roof parapet, a door, and
 * for apartments, balconies. All of those are generated.
 *
 * @returns the number of balconies added
 */
export function dressBuilding(layer: (key: MaterialKey) => GeometryBuffer, building: DistrictBuilding, wallColor: Color, roofColor: Color): number {
  const R = FACADE_RULES;
  const style = FACADE_STYLES[building.category];
  const h = building.height;
  const plain = building.area < R.plainBelowArea || h < R.plainBelowHeight;
  let balconies = 0;
  let door: { ax: number; az: number; dx: number; dz: number; nx: number; nz: number; len: number; bays: number } | null = null;

  for (const polygon of building.polygons) {
    const rings: Array<[readonly Point[], boolean]> = [[polygon.outer, false], ...polygon.holes.map((hole): [readonly Point[], boolean] => [hole, true])];
    for (const [ring, isHole] of rings) {
      const flip = outwardSide(ring, isHole);
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1]!, b = ring[i]!;
        const dx = b[0] - a[0], dz = b[1] - a[1];
        const len = Math.hypot(dx, dz);
        if (len < 1e-4) continue;
        const nx = (dz / len) * flip, nz = (-dx / len) * flip;
        // Seen from outside, the wall runs left to right when the outside is on the right of a to b... keep texture unmirrored either way.
        const [lx, lz, rx, rz] = flip === 1 ? [b[0], b[1], a[0], a[1]] : [a[0], a[1], b[0], b[1]];
        if (plain || len < R.minPatternWall) {
          layer("plaster").wallUV(lx, lz, rx, rz, 0, h, nx, nz, wallColor, 0, len, 0, h);
          continue;
        }
        const bays = Math.max(1, Math.round(len / FACADE.bayWidth));
        const uEnd = bays * FACADE.bayWidth;
        let base = 0;
        if (style.ground && h > R.shopfrontHeight + 1.5) {
          base = R.shopfrontHeight;
          layer(style.ground).wallUV(lx, lz, rx, rz, 0, base, nx, nz, wallColor, 0, uEnd, 0, base);
        }
        const floors = Math.max(1, Math.round((h - base) / FACADE.floorHeight));
        layer(style.wall).wallUV(lx, lz, rx, rz, base, h, nx, nz, wallColor, 0, uEnd, 0, floors * FACADE.floorHeight);

        if (!isHole && style.door && bays >= 2 && (!door || len > door.len)) door = { ax: lx, az: lz, dx: (rx - lx) / len, dz: (rz - lz) / len, nx, nz, len, bays };

        if (style.balconies && !isHole && len >= R.balconyMinWall && floors >= 2) {
          const bay = len / bays;
          for (let floor = 1; floor < floors && balconies < R.balconyLimit; floor++) {
            for (let k = floor % 2; k < bays && balconies < R.balconyLimit; k += 2) {
              const along = (k + 0.5) * bay;
              const cx = lx + ((rx - lx) / len) * along + nx * (R.balconyDepth / 2), cz = lz + ((rz - lz) / len) * along + nz * (R.balconyDepth / 2);
              const y = (floor * (h - base)) / floors + base;
              const yaw = Math.atan2((rx - lx) / len, (rz - lz) / len) - Math.PI / 2;
              const g = layer("plaster");
              g.box(cx, y - 0.12, cz, bay * 0.74, 0.12, R.balconyDepth, { yaw, color: FRAME, bottom: true });
              g.box(cx + nx * (R.balconyDepth / 2 - 0.04), y, cz + nz * (R.balconyDepth / 2 - 0.04), bay * 0.74, 0.95, 0.08, { yaw, color: wallColor });
              balconies++;
            }
          }
        }
      }

      if (plain) continue;
      // Parapet: the wall carried above the roof, with an inner face and a flat top.
      const top = h + R.parapetHeight;
      const inner = offsetLine(ring, -flip * R.parapetThickness);
      const g = layer("plaster");
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1]!, b = ring[i]!, ia = inner[i - 1]!, ib = inner[i]!;
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 1e-4) continue;
        const nx = ((b[1] - a[1]) / len) * flip, nz = (-(b[0] - a[0]) / len) * flip;
        g.wallUV(a[0], a[1], b[0], b[1], h, top, nx, nz, wallColor, 0, len, h, top);
        g.wallUV(ia[0], ia[1], ib[0], ib[1], h, top, -nx, -nz, wallColor, 0, len, h, top);
        g.quad([[a[0], top, a[1]], [b[0], top, b[1]], [ib[0], top, ib[1]], [ia[0], top, ia[1]]], [0, 1, 0], [a[0], a[1], b[0], b[1], ib[0], ib[1], ia[0], ia[1]], FRAME);
      }
    }
    layer("concrete").polygonY(polygon.outer, polygon.holes, h, roofColor);
  }

  if (door && !plain) {
    // On the longest wall, at a pier between two windows.
    const bay = door.len / door.bays;
    const along = Math.round(door.bays / 2) * bay;
    const cx = door.ax + door.dx * along, cz = door.az + door.dz * along;
    const yaw = Math.atan2(door.dx, door.dz) - Math.PI / 2;
    const g = layer("plaster");
    g.box(cx + door.nx * 0.03, 0, cz + door.nz * 0.03, 1.3, 2.25, 0.06, { yaw, color: FRAME });
    g.box(cx + door.nx * 0.06, 0, cz + door.nz * 0.06, 1.0, 2.1, 0.06, { yaw, color: DOOR });
  }
  return balconies;
}
