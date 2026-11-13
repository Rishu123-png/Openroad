import type { Color } from "../geometry/GeometryBuffer";

/**
 * Cross-section of the test district, in metres. The main road runs along Z
 * and the cross road along X; they meet at the origin. Traffic keeps left.
 *
 *   median | 3 lanes | kerb | footpath | green verge | plots and buildings
 *   0..2     2..12.5          12.8..15.8  15.8..21.8    from 21.8
 */
export const LAYOUT = {
  medianHalfWidth: 2,
  medianHeight: 0.22,
  laneWidth: 3.5,
  lanesPerSide: 3,
  /** Distance from the centre line to the kerb of the main road. */
  roadEdge: 12.5,
  kerbWidth: 0.3,
  kerbHeight: 0.15,
  footpathWidth: 3,
  vergeWidth: 6,
  /** Half-width of the cross road (two lanes each way, no median). */
  crossHalfWidth: 7,
  /** How far the main road extends each way. Fog hides the ends. */
  mainHalfLength: 720,
  crossHalfLength: 320,
  /** Trees, lights and buildings stop here; beyond it only road and haze. */
  detailHalfLength: 440,
  /** The median stops this far from the junction centre. */
  medianGap: 13,
  dashLength: 3,
  dashGap: 6,
  lineWidth: 0.15,
  tileSize: 110,
} as const;

export const FOOTPATH_INNER = LAYOUT.roadEdge + LAYOUT.kerbWidth;
export const FOOTPATH_OUTER = FOOTPATH_INNER + LAYOUT.footpathWidth;
export const VERGE_OUTER = FOOTPATH_OUTER + LAYOUT.vergeWidth;
export const CROSS_FOOTPATH_INNER = LAYOUT.crossHalfWidth + LAYOUT.kerbWidth;
export const CROSS_FOOTPATH_OUTER = CROSS_FOOTPATH_INNER + LAYOUT.footpathWidth;
export const CROSS_VERGE_OUTER = CROSS_FOOTPATH_OUTER + LAYOUT.vergeWidth;

/** Converts an sRGB colour (0..255 per channel) to the linear values that vertex colours use. */
export function srgb(r: number, g: number, b: number): Color {
  return [Math.pow(r / 255, 2.2), Math.pow(g / 255, 2.2), Math.pow(b / 255, 2.2)];
}

export function scale(c: Color, k: number): Color {
  return [c[0] * k, c[1] * k, c[2] * k];
}

export const SIDES = [-1, 1] as const;
