import { pointInPolygons } from "./spawn";
import type { DistrictBuilding } from "./types";

/** Finds the building under a point without testing every building. */
export class BuildingIndex {
  private readonly cells = new Map<number, DistrictBuilding[]>();

  constructor(
    buildings: readonly DistrictBuilding[],
    private readonly cellSize = 64,
  ) {
    for (const b of buildings) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const poly of b.polygons) {
        for (const p of poly.outer) {
          x0 = Math.min(x0, p[0]);
          x1 = Math.max(x1, p[0]);
          z0 = Math.min(z0, p[1]);
          z1 = Math.max(z1, p[1]);
        }
      }
      for (let cx = Math.floor(x0 / cellSize); cx <= Math.floor(x1 / cellSize); cx++) {
        for (let cz = Math.floor(z0 / cellSize); cz <= Math.floor(z1 / cellSize); cz++) {
          const key = (cx + 32768) * 65536 + (cz + 32768);
          const list = this.cells.get(key);
          if (list) list.push(b);
          else this.cells.set(key, [b]);
        }
      }
    }
  }

  at(x: number, z: number): DistrictBuilding | null {
    const list = this.cells.get((Math.floor(x / this.cellSize) + 32768) * 65536 + (Math.floor(z / this.cellSize) + 32768));
    if (!list) return null;
    for (const b of list) if (pointInPolygons(x, z, b.polygons)) return b;
    return null;
  }
}
