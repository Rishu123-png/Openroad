/**
 * Line segments in a uniform grid, for collision and "is this on a road"
 * queries. Queries read numbers only and allocate nothing.
 */
export class SegmentGrid {
  /** ax, az, bx, bz, radius per segment. */
  private readonly data: number[] = [];
  private readonly cells = new Map<number, number[]>();
  /** Result of the last successful pushOut(). */
  outX = 0;
  outZ = 0;

  /**
   * @param reach largest query distance in metres; segments are registered in every cell within this distance
   */
  constructor(
    private readonly cellSize = 32,
    private readonly reach = 4,
  ) {}

  get count(): number {
    return this.data.length / 5;
  }

  add(ax: number, az: number, bx: number, bz: number, radius = 0): void {
    const index = this.data.length / 5;
    this.data.push(ax, az, bx, bz, radius);
    const pad = radius + this.reach;
    const c = this.cellSize;
    const x0 = Math.floor((Math.min(ax, bx) - pad) / c), x1 = Math.floor((Math.max(ax, bx) + pad) / c);
    const z0 = Math.floor((Math.min(az, bz) - pad) / c), z1 = Math.floor((Math.max(az, bz) + pad) / c);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const key = (cx + 32768) * 65536 + (cz + 32768);
        const list = this.cells.get(key);
        if (list) list.push(index);
        else this.cells.set(key, [index]);
      }
    }
  }

  private cellAt(x: number, z: number): number[] | undefined {
    const c = this.cellSize;
    return this.cells.get((Math.floor(x / c) + 32768) * 65536 + (Math.floor(z / c) + 32768));
  }

  private distanceSquared(i: number, x: number, z: number): number {
    const d = this.data;
    const ax = d[i]!, az = d[i + 1]!;
    const dx = d[i + 2]! - ax, dz = d[i + 3]! - az;
    const len = dx * dx + dz * dz;
    const t = len > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len)) : 0;
    const px = x - ax - t * dx, pz = z - az - t * dz;
    return px * px + pz * pz;
  }

  /** True when the point is within `extra` metres of a segment's own radius. `extra` must not exceed `reach`. */
  near(x: number, z: number, extra = 0): boolean {
    const list = this.cellAt(x, z);
    if (!list) return false;
    for (let k = 0; k < list.length; k++) {
      const i = list[k]! * 5;
      const r = this.data[i + 4]! + extra;
      if (this.distanceSquared(i, x, z) < r * r) return true;
    }
    return false;
  }

  /**
   * Moves a circle out of every segment it overlaps. Returns true when it
   * had to move; the new centre is in `outX`, `outZ`.
   */
  pushOut(x: number, z: number, radius: number): boolean {
    let moved = false;
    const d = this.data;
    for (let pass = 0; pass < 3; pass++) {
      const list = this.cellAt(x, z);
      if (!list) break;
      let hit = false;
      for (let k = 0; k < list.length; k++) {
        const i = list[k]! * 5;
        const r = radius + d[i + 4]!;
        const ax = d[i]!, az = d[i + 1]!;
        const dx = d[i + 2]! - ax, dz = d[i + 3]! - az;
        const len = dx * dx + dz * dz;
        const t = len > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len)) : 0;
        let px = x - ax - t * dx, pz = z - az - t * dz;
        const dist2 = px * px + pz * pz;
        if (dist2 >= r * r) continue;
        let dist = Math.sqrt(dist2);
        if (dist < 1e-6) {
          // Exactly on the line: leave along its normal.
          const l = Math.sqrt(len) || 1;
          px = -dz / l;
          pz = dx / l;
          dist = 1;
          x += px * r;
          z += pz * r;
        } else {
          x += (px / dist) * (r - dist);
          z += (pz / dist) * (r - dist);
        }
        hit = true;
      }
      if (!hit) break;
      moved = true;
    }
    this.outX = x;
    this.outZ = z;
    return moved;
  }
}
