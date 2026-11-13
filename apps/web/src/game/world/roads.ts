import { fbm } from "../../utils/random";
import type { Color } from "../geometry/GeometryBuffer";
import { LAYOUT as L, SIDES } from "./layout";
import { count, type WorldContext } from "./WorldContext";

const ROAD_Y = 0;
const PAINT_Y = 0.012;

/** Lane-centre offsets from the median edge, used for wheel-path wear. */
function wear(across: number, along: number): number {
  // Tyres polish two tracks per lane slightly lighter; the lane centre collects oil and is darker.
  const lane = ((across % L.laneWidth) + L.laneWidth) % L.laneWidth;
  const fromCentre = Math.abs(lane - L.laneWidth / 2);
  const track = Math.exp(-((fromCentre - 0.85) ** 2) / 0.12) * 0.07;
  const oil = Math.exp(-(fromCentre ** 2) / 0.1) * 0.05;
  const patches = (fbm(across / 9, along / 23, 7, 4) - 0.5) * 0.32;
  const repairs = fbm(across / 3.5 + 40, along / 6, 19, 2) > 0.74 ? -0.1 : 0;
  return 1 + track - oil + patches + repairs;
}

function asphaltTint(x: number, z: number): Color {
  const onCross = Math.abs(x) > L.roadEdge;
  const k = onCross ? wear(Math.abs(z), x) : wear(Math.abs(x) - L.medianHalfWidth, z);
  // Braking and turning darken the junction.
  const junction = Math.exp(-(x * x + z * z) / 500) * 0.1;
  const v = k - junction;
  return [v, v, v];
}

export function buildRoads(ctx: WorldContext): void {
  const { batch } = ctx;
  const step = 27.5;

  // Main carriageway, laid in strips so each ground tile gets its own mesh.
  for (let z = -L.mainHalfLength; z < L.mainHalfLength; z += step) {
    batch.at("asphalt", 0, z + step / 2).rectY(-L.roadEdge, z, L.roadEdge, z + step, ROAD_Y, { cell: 1.75, tint: asphaltTint });
  }
  for (const side of SIDES) {
    for (let d = L.roadEdge; d < L.crossHalfLength; d += step) {
      const x0 = side * d;
      const x1 = side * Math.min(d + step, L.crossHalfLength);
      batch
        .at("asphalt", (x0 + x1) / 2, 0)
        .rectY(Math.min(x0, x1), -L.crossHalfWidth, Math.max(x0, x1), L.crossHalfWidth, ROAD_Y, { cell: 1.75, tint: asphaltTint });
    }
  }

  const mark = (x0: number, z0: number, x1: number, z1: number, yellow = false): void => {
    const fade = 0.72 + ctx.random.next() * 0.28; // paint ages unevenly
    const color: Color = yellow ? [0.78 * fade, 0.56 * fade, 0.06 * fade] : [fade, fade, fade];
    batch.at("roadPaint", (x0 + x1) / 2, (z0 + z1) / 2).rectY(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1), PAINT_Y, { color });
    count(ctx, "markings");
  };
  const half = L.lineWidth / 2;
  const period = L.dashLength + L.dashGap;

  // Main road: edge lines, lane dashes, stop lines and zebra crossings.
  const zebraNear = L.crossHalfWidth + 0.6;
  const zebraFar = zebraNear + 3;
  const stopLine = zebraFar + 1;
  const linesStart = stopLine + 0.5;
  for (const side of SIDES) {
    const inner = side * (L.medianHalfWidth + 0.45);
    const outer = side * (L.roadEdge - 0.4);
    for (const dir of SIDES) {
      for (let d = linesStart; d < L.mainHalfLength; d += 20) {
        const z0 = dir * d;
        const z1 = dir * Math.min(d + 20, L.mainHalfLength);
        mark(inner - half, z0, inner + half, z1, true);
        mark(outer - half, z0, outer + half, z1);
      }
      for (let lane = 1; lane < L.lanesPerSide; lane++) {
        const x = side * (L.medianHalfWidth + lane * L.laneWidth);
        for (let d = linesStart + 2; d + L.dashLength < L.mainHalfLength; d += period) {
          mark(x - half, dir * d, x + half, dir * (d + L.dashLength));
          count(ctx, "laneDashes");
        }
      }
      // Zebra crossing: bars run along the direction of travel.
      for (let x = L.medianHalfWidth + 0.5; x + 0.5 <= L.roadEdge - 0.3; x += 1) {
        mark(side * x, dir * zebraNear, side * (x + 0.5), dir * zebraFar);
      }
    }
    // Stop line only on the approach side. Keep-left: traffic heading +Z uses x < 0.
    const approach = -side;
    mark(side * L.medianHalfWidth, approach * stopLine, side * L.roadEdge, approach * (stopLine + 0.3));
  }

  // Cross road: centre line, lane dashes, edge lines, crossings and stop lines.
  const crossZebraNear = L.roadEdge + 0.5;
  const crossZebraFar = crossZebraNear + 3;
  const crossStop = crossZebraFar + 1;
  for (const dir of SIDES) {
    for (let d = crossStop + 0.5; d < L.crossHalfLength; d += 20) {
      const x0 = dir * d;
      const x1 = dir * Math.min(d + 20, L.crossHalfLength);
      mark(x0, -half, x1, half);
      for (const side of SIDES) mark(x0, side * (L.crossHalfWidth - 0.4) - half, x1, side * (L.crossHalfWidth - 0.4) + half);
    }
    for (const side of SIDES) {
      const z = side * L.laneWidth;
      for (let d = crossStop + 2.5; d + L.dashLength < L.crossHalfLength; d += period) {
        mark(dir * d, z - half, dir * (d + L.dashLength), z + half);
      }
    }
    for (let z = -L.crossHalfWidth + 0.5; z + 0.5 <= L.crossHalfWidth - 0.3; z += 1) {
      mark(dir * crossZebraNear, z, dir * crossZebraFar, z + 0.5);
    }
    // Traffic heading +X keeps to z > 0 and approaches from x < 0.
    const zSide = -dir;
    mark(dir * crossStop, 0, dir * (crossStop + 0.3), zSide * L.crossHalfWidth);
  }

  // Storm-drain grates against the kerb, and a few manhole covers in the lanes.
  for (const side of SIDES) {
    for (const dir of SIDES) {
      for (let d = 30; d < L.detailHalfLength; d += 28) {
        const x = side * (L.roadEdge - 0.3);
        batch.at("grate", x, dir * d).rectY(x - 0.25, dir * d - 0.5, x + 0.25, dir * d + 0.5, PAINT_Y);
        count(ctx, "drains");
      }
    }
  }
  for (let i = 0; i < 14; i++) {
    const x = ctx.random.pick(SIDES) * (L.medianHalfWidth + ctx.random.range(1.5, 9));
    const z = ctx.random.range(-L.detailHalfLength, L.detailHalfLength);
    if (Math.abs(z) < 20) continue;
    batch.at("grate", x, z).rectY(x - 0.35, z - 0.35, x + 0.35, z + 0.35, PAINT_Y, { color: [1.6, 1.5, 1.4] });
  }
}
