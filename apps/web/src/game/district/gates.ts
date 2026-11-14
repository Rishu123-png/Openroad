import type { DistrictData, DistrictPoint } from "./types";

/**
 * MAPPED GATES. The position of every gate comes from the map; its look does not.
 *
 * A gate point that lies on a mapped road gets a generic gate across that
 * road, drawn open so that it never blocks the carriageway: two pillars
 * outside the road edge with the leaves swung back, or a raised boom for a
 * lift gate. A gate point that is not on a road keeps a simple post.
 *
 * No gate is added anywhere else, no wall is added beside a gate, and a gate
 * shows a name only when the map gives it one.
 */
export const GATE_RULES = {
  kinds: ["gate", "lift_gate", "swing_gate", "sliding_gate"] as readonly string[],
  /** A gate point belongs to a road when it lies this close to its centre line. */
  onRoadWithin: 3,
  /** Pillars stand this far beyond the edge of the carriageway. */
  pillarSetback: 0.55,
  pillarSize: 0.5,
  pillarHeight: 2.4,
  leafHeight: 1.7,
  maxLeaf: 2.4,
} as const;

export interface GatePlan {
  id: string;
  kind: string;
  /** The mapped position, unchanged. */
  x: number;
  z: number;
  /** Name from the map, or null. Never made up. */
  name: string | null;
  /** The mapped road the gate stands across, or null when it is not on a road. */
  road: string | null;
  /** Unit direction of that road at the gate. */
  dx: number;
  dz: number;
  /** Half the (mapped or estimated) width of that road. */
  half: number;
  /** Pillar positions, each outside the carriageway. Empty when the gate is not on a road. */
  pillars: Array<{ x: number; z: number; side: 1 | -1 }>;
}

export const isGate = (point: DistrictPoint): boolean => GATE_RULES.kinds.includes(point.kind ?? point.tags?.barrier ?? "");

/**
 * @param free true where a pillar may stand: off every road surface and outside every building
 */
export function planGates(district: DistrictData, free: (x: number, z: number) => boolean): GatePlan[] {
  const G = GATE_RULES;
  const plans: GatePlan[] = [];
  for (const point of district.barriers.points) {
    if (!isGate(point)) continue;
    const [x, z] = point.point;
    let best: number = G.onRoadWithin, road: string | null = null, dx = 0, dz = 1, half = 0;
    for (const r of district.roads) {
      if (r.kind !== "road" || r.elevated || r.tunnel) continue;
      for (let i = 1; i < r.points.length; i++) {
        const a = r.points[i - 1]!, b = r.points[i]!;
        const ex = b[0] - a[0], ez = b[1] - a[1];
        const len2 = ex * ex + ez * ez;
        if (len2 < 1e-6) continue;
        const t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (z - a[1]) * ez) / len2));
        const d = Math.hypot(x - a[0] - t * ex, z - a[1] - t * ez);
        if (d < best) {
          const len = Math.sqrt(len2);
          [best, road, dx, dz, half] = [d, r.id, ex / len, ez / len, r.width / 2];
        }
      }
    }
    const pillars: GatePlan["pillars"] = [];
    if (road) {
      for (const side of [1, -1] as const) {
        const off = (half + G.pillarSetback + G.pillarSize / 2) * side;
        const px = x - dz * off, pz = z + dx * off;
        if (free(px, pz)) pillars.push({ x: px, z: pz, side });
      }
    }
    plans.push({ id: point.id, kind: point.kind ?? point.tags.barrier ?? "gate", x, z, name: point.tags?.name ?? null, road, dx, dz, half, pillars });
  }
  return plans;
}
