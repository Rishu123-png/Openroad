import { fbm } from "../../utils/random";
import type { Color } from "../geometry/GeometryBuffer";
import {
  CROSS_FOOTPATH_INNER,
  CROSS_FOOTPATH_OUTER,
  CROSS_VERGE_OUTER,
  FOOTPATH_INNER,
  FOOTPATH_OUTER,
  LAYOUT as L,
  SIDES,
  srgb,
  VERGE_OUTER,
} from "./layout";
import type { MaterialKey } from "../materials/MaterialLibrary";
import { count, type WorldContext } from "./WorldContext";

const KERB_BLACK = srgb(46, 46, 48);
const KERB_YELLOW = srgb(214, 168, 38);

const grassTint = (x: number, z: number): Color => {
  const dry = fbm(x / 14, z / 14, 211, 3);
  return [0.72 + dry * 0.5, 0.86 + dry * 0.14, 0.7 + dry * 0.2];
};
const dustTint = (x: number, z: number): Color => {
  const n = fbm(x / 60, z / 60, 223, 4);
  // Open land far from the road: dry grass and bare earth.
  return [1.0 + n * 0.45, 0.84 + n * 0.2, 0.58 + n * 0.14];
};
const stoneTint = (x: number, z: number): Color => {
  const n = 0.78 + fbm(x / 7, z / 7, 227, 3) * 0.36;
  return [n, n, n];
};

/** Lays a long rectangle in pieces, so each ground tile gets its own mesh. */
function strip(
  ctx: WorldContext,
  layer: MaterialKey,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  y: number,
  options: { cell?: number; tint?: (x: number, z: number) => Color; color?: Color } = {},
): void {
  const alongZ = Math.abs(z1 - z0) >= Math.abs(x1 - x0);
  const a0 = alongZ ? Math.min(z0, z1) : Math.min(x0, x1);
  const a1 = alongZ ? Math.max(z0, z1) : Math.max(x0, x1);
  const step = 27.5;
  for (let a = a0; a < a1; a += step) {
    const b = Math.min(a + step, a1);
    if (alongZ) ctx.batch.at(layer, (x0 + x1) / 2, (a + b) / 2).rectY(Math.min(x0, x1), a, Math.max(x0, x1), b, y, options);
    else ctx.batch.at(layer, (a + b) / 2, (z0 + z1) / 2).rectY(a, Math.min(z0, z1), b, Math.max(z0, z1), y, options);
  }
}

/** A kerb along one axis, cast in 2 m units with slightly different tones. */
function kerb(ctx: WorldContext, alongZ: boolean, fixed: number, from: number, to: number, width: number, height: number, painted: boolean): void {
  const unit = painted ? 1 : 2;
  const a0 = Math.min(from, to);
  const a1 = Math.max(from, to);
  for (let a = a0, i = 0; a < a1 - 0.01; a += unit, i++) {
    const length = Math.min(unit, a1 - a);
    const tone = 0.85 + ctx.random.next() * 0.3;
    const color: Color = painted ? (i % 2 === 0 ? KERB_BLACK : KERB_YELLOW) : [tone, tone, tone];
    const mid = a + length / 2;
    const [x, z, sx, sz] = alongZ ? [fixed, mid, width, length] : [mid, fixed, length, width];
    ctx.batch.at("concrete", x, z).box(x, 0, z, sx, height, sz, { color });
  }
  count(ctx, "kerbRuns");
}

export function buildGroundworks(ctx: WorldContext): void {
  const end = L.detailHalfLength + 280;

  // Open land under everything, slightly below road level.
  const far = 2600;
  ctx.batch.at("grass", 0, 0, "land").rectY(-far, -far, far, far, -0.03, { cell: 65, tint: dustTint });

  for (const sx of SIDES) {
    for (const sz of SIDES) {
      // Kerbs: main road then cross road, meeting at a square corner.
      kerb(ctx, true, sx * (L.roadEdge + L.kerbWidth / 2), sz * L.crossHalfWidth, sz * end, L.kerbWidth, L.kerbHeight, false);
      kerb(ctx, false, sz * (L.crossHalfWidth + L.kerbWidth / 2), sx * (L.roadEdge + L.kerbWidth), sx * L.crossHalfLength, L.kerbWidth, L.kerbHeight, false);

      // Footpaths.
      strip(ctx, "pavers", sx * FOOTPATH_INNER, sz * L.crossHalfWidth, sx * FOOTPATH_OUTER, sz * end, L.kerbHeight, { cell: 3, tint: stoneTint });
      strip(ctx, "pavers", sx * FOOTPATH_OUTER, sz * CROSS_FOOTPATH_INNER, sx * L.crossHalfLength, sz * CROSS_FOOTPATH_OUTER, L.kerbHeight, { cell: 3, tint: stoneTint });
      // Tactile strip in the corner of each crossing.
      ctx.batch
        .at("pavers", sx * 14, sz * 8.5)
        .rectY(sx * FOOTPATH_INNER, sz * L.crossHalfWidth, sx * (FOOTPATH_INNER + 0.6), sz * (CROSS_FOOTPATH_OUTER - 0.2), L.kerbHeight + 0.004, { color: srgb(250, 214, 110) });

      // Edging between footpath and verge, then the verge itself.
      kerb(ctx, true, sx * (FOOTPATH_OUTER + 0.06), sz * CROSS_FOOTPATH_OUTER, sz * end, 0.12, L.kerbHeight + 0.05, false);
      strip(ctx, "grass", sx * (FOOTPATH_OUTER + 0.12), sz * CROSS_FOOTPATH_OUTER, sx * VERGE_OUTER, sz * end, L.kerbHeight - 0.03, { cell: 3, tint: grassTint });
      strip(ctx, "grass", sx * VERGE_OUTER, sz * CROSS_FOOTPATH_OUTER, sx * L.crossHalfLength, sz * CROSS_VERGE_OUTER, L.kerbHeight - 0.03, { cell: 3, tint: grassTint });

      // Paved apron in front of the plots: parking and service lane.
      strip(ctx, "concrete", sx * VERGE_OUTER, sz * CROSS_VERGE_OUTER, sx * 62, sz * L.detailHalfLength, 0.02, { cell: 5, tint: stoneTint });
    }
  }

  // Raised, planted median with painted kerbs, on both sides of the junction.
  const mh = L.medianHeight;
  const mw = L.medianHalfWidth;
  for (const sz of SIDES) {
    for (const sx of SIDES) kerb(ctx, true, sx * (mw - 0.125), sz * L.medianGap, sz * L.mainHalfLength, 0.25, mh, true);
    // Rounded nose, approximated by a half cylinder.
    ctx.batch.at("concrete", 0, sz * L.medianGap).cylinder(0, 0, sz * L.medianGap, mh, mw, mw, 14, KERB_YELLOW);
    strip(ctx, "grass", -(mw - 0.25), sz * L.medianGap, mw - 0.25, sz * L.mainHalfLength, mh - 0.02, { cell: 2, tint: grassTint });
  }
}
