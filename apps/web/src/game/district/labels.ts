import { pointInPolygons } from "./spawn";
import type { DistrictData } from "./types";

/**
 * NAMES FROM THE MAP. A label is shown only for a feature the map names, at
 * the position the map gives it. No name is made up, shortened or moved to a
 * different feature. Where two mapped features carry the same name close
 * together (a shop point inside its named building), one label is shown.
 */
export const LABEL_RULES = {
  /** Two features with the same name closer than this share one label. */
  mergeWithin: 80,
  /** Labels are shown from this far away, nearest first, at most `limit` at once. */
  visibleWithin: 220,
  limit: 6,
  maxLength: 48,
} as const;

export type LabelKind = "station" | "place" | "poi" | "building" | "area" | "gate";

export interface NameLabel {
  /** Map id of the named feature. */
  source: string;
  kind: LabelKind;
  /** The name exactly as mapped. */
  text: string;
  x: number;
  /** Height above the ground at which the label floats. Presentation only. */
  y: number;
  z: number;
}

const PRIORITY: LabelKind[] = ["station", "place", "poi", "building", "area", "gate"];

function ringCentroid(ring: ReadonlyArray<readonly [number, number]>): [number, number] {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j]![0] * ring[i]![1] - ring[i]![0] * ring[j]![1];
    a += f;
    cx += (ring[j]![0] + ring[i]![0]) * f;
    cz += (ring[j]![1] + ring[i]![1]) * f;
  }
  if (Math.abs(a) < 1e-6) return [ring[0]![0], ring[0]![1]];
  return [cx / (3 * a), cz / (3 * a)];
}

export function collectLabels(district: DistrictData, viaductHeight = 9): NameLabel[] {
  const found: NameLabel[] = [];
  const b = district.bounds;
  const inside = (x: number, z: number): boolean => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
  const add = (source: string, kind: LabelKind, name: string | null | undefined, x: number, z: number, y: number): void => {
    const text = (name ?? "").trim();
    if (!text || text.length > LABEL_RULES.maxLength || !inside(x, z)) return;
    found.push({ source, kind, text, x, y, z });
  };

  for (const p of district.rail.points) add(p.id, "station", p.name ?? p.tags?.name, p.point[0], p.point[1], viaductHeight + 9);
  for (const p of district.pois) {
    const host = district.buildings.find((bd) => Math.abs(bd.centre[0] - p.point[0]) < 200 && Math.abs(bd.centre[1] - p.point[1]) < 200 && pointInPolygons(p.point[0], p.point[1], bd.polygons));
    add(p.id, p.tags?.place ? "place" : "poi", p.name ?? p.tags?.name, p.point[0], p.point[1], host ? host.height + 3 : 4.5);
  }
  for (const bd of district.buildings) add(bd.id, "building", bd.tags?.name, bd.centre[0], bd.centre[1], bd.height + 3);
  for (const area of district.areas) {
    if (area.kind === "sector" || !area.polygons.length) continue;
    let [x, z] = ringCentroid(area.polygons[0]!.outer);
    if (!pointInPolygons(x, z, area.polygons) || !inside(x, z)) {
      // A hollow or clipped outline: use the vertex nearest the centroid, which is on the mapped outline.
      let best = Infinity;
      for (const v of area.polygons[0]!.outer) {
        const d = Math.hypot(v[0] - x, v[1] - z);
        if (d < best && inside(v[0], v[1])) [best, x, z] = [d, v[0], v[1]];
      }
    }
    add(area.id, "area", area.name ?? area.tags?.name, x, z, 6);
  }
  for (const p of district.barriers.points) add(p.id, "gate", p.tags?.name, p.point[0], p.point[1], 3.4);

  found.sort((p, q) => PRIORITY.indexOf(p.kind) - PRIORITY.indexOf(q.kind));
  const kept: NameLabel[] = [];
  for (const label of found) {
    if (kept.some((k) => k.text.toLowerCase() === label.text.toLowerCase() && Math.hypot(k.x - label.x, k.z - label.z) < LABEL_RULES.mergeWithin)) continue;
    kept.push(label);
  }
  return kept;
}
