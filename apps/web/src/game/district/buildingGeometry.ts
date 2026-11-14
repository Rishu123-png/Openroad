import type { Color, GeometryBuffer } from "../geometry/GeometryBuffer";
import type { Point, Polygon } from "./types";

function signedArea(ring: readonly Point[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j]![0] * ring[i]![1] - ring[i]![0] * ring[j]![1];
  return a / 2;
}

function walls(buffer: GeometryBuffer, ring: readonly Point[], y0: number, y1: number, color: Color, isHole: boolean): void {
  // For a counter-clockwise ring the outside is to the right of each edge.
  // The wall of a courtyard faces into the hole instead.
  const flip = signedArea(ring) > 0 !== isHole ? 1 : -1;
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
