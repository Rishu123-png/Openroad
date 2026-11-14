import type { DistrictData, DistrictRoad, Point } from "./types";

/**
 * GENERATED ROADSIDE. The map records no kerbs or footpaths in this district.
 *
 * A raised, paved verge with a kerb is drawn beside the through roads, where
 * the ground beside the road is free: not on any other mapped road or path,
 * not in a building. It breaks at every side road, so it never crosses a
 * carriageway. It is decoration and blocks nothing.
 */
export const VERGE_RULES = {
  classes: ["trunk", "primary", "secondary", "tertiary"] as readonly string[],
  /** Paved margin between the carriageway edge and the kerb (the same as the shoulder of these roads). */
  inset: 1.2,
  width: 1.5,
  height: 0.14,
  step: 3,
  /** Shorter stretches than this are left out. */
  minRun: 6,
} as const;

export interface VergeRun {
  road: string;
  /** +1 left of the direction the road is mapped in, -1 right. */
  side: 1 | -1;
  /** Stretch of the mapped centre line the verge runs beside. */
  points: Point[];
  /** Distance of the kerb from the centre line. */
  inner: number;
}

function sidewalkTagged(road: DistrictRoad, side: 1 | -1): boolean {
  const s = road.sidewalk;
  return s === "both" || s === "yes" || (side === 1 ? s === "left" : s === "right");
}

/**
 * @param free (x, z, radius): true when a disc there is clear of every road surface and building and inside the district
 */
export function planVerges(district: DistrictData, free: (x: number, z: number, radius: number) => boolean): VergeRun[] {
  const V = VERGE_RULES;
  const runs: VergeRun[] = [];
  for (const road of district.roads) {
    if (road.kind !== "road" || road.elevated || road.tunnel || !V.classes.includes(road.class)) continue;
    const inner = road.width / 2 + V.inset;
    const mid = inner + V.width / 2;
    for (const side of [1, -1] as const) {
      if (sidewalkTagged(road, side)) continue; // the mapped footpath is drawn there already
      let run: Point[] = [];
      let length = 0;
      const close = (): void => {
        if (run.length >= 2 && length >= V.minRun) runs.push({ road: road.id, side, points: run, inner });
        run = [];
        length = 0;
      };
      for (let i = 1; i < road.points.length; i++) {
        const a = road.points[i - 1]!, b = road.points[i]!;
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 1e-3) continue;
        const dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len;
        const steps = Math.max(1, Math.ceil(len / V.step));
        for (let s = 0; s < steps; s++) {
          const t0 = (len * s) / steps, t1 = (len * (s + 1)) / steps;
          const ok = [t0, (t0 + t1) / 2, t1].every((t) => free(a[0] + dx * t - dz * mid * side, a[1] + dz * t + dx * mid * side, V.width / 2 + 0.15));
          if (!ok) {
            close();
            continue;
          }
          if (run.length === 0) run.push([a[0] + dx * t0, a[1] + dz * t0]);
          run.push([a[0] + dx * t1, a[1] + dz * t1]);
          length += t1 - t0;
        }
      }
      close();
    }
  }
  return runs;
}
