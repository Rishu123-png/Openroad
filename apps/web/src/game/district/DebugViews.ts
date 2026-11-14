import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import type { Material } from "@babylonjs/core/Materials/material";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Color } from "../geometry/GeometryBuffer";

export const DEBUG_VIEWS = [
  { name: "Normal", legend: "" },
  {
    name: "Building classification",
    legend: "house: yellow · apartments: orange · commercial: blue · institutional: purple · industrial: brown · healthcare: red · other mapped: teal · unclassified: grey",
  },
  { name: "Height source", legend: "green: height tag · yellow: mapped levels × 3.2 m · red: estimated (category default)" },
  {
    name: "Data source",
    legend: "blue: OSM building footprint (the window pattern on it is generated) · roads: green = mapped width, yellow = from mapped lanes, orange = estimated width · cyan: mapped point or line · magenta: generated (trees, lights, parked cars, road markings, road margins, parapets, doors, balconies) · yellow line: sector outline",
  },
] as const;

/** Colours of a group of vertices in each debug view after "Normal". */
export type DebugTints = readonly [Color, Color, Color];

export interface TintRange {
  start: number;
  count: number;
  tints: DebugTints;
}

const NEUTRAL: Color = [0.42, 0.42, 0.42];

interface Recolourable {
  mesh: Mesh;
  material: Material | null;
  base: Float32Array;
  ranges: TintRange[];
}

/**
 * Switches the district between its normal look and views that colour each
 * object by classification, by height source, or by where its data came from.
 *
 * Batched meshes get a second set of vertex colours; instanced objects swap
 * material. Nothing is rebuilt, and the normal view costs nothing extra.
 */
export class DebugViews {
  private readonly recolourable: Recolourable[] = [];
  private readonly swaps: Array<{ mesh: Mesh; material: Material | null; debug: Material }> = [];
  private readonly onlyInDebug: Mesh[] = [];
  private index = 0;

  constructor(private readonly flat: Material) {}

  get view(): (typeof DEBUG_VIEWS)[number] {
    return DEBUG_VIEWS[this.index]!;
  }

  get viewIndex(): number {
    return this.index;
  }

  /** A batched mesh whose vertices are recoloured. Vertices outside every range turn grey. */
  addBatched(mesh: Mesh, ranges: TintRange[]): void {
    const colors = mesh.getVerticesData(VertexBuffer.ColorKind);
    this.recolourable.push({ mesh, material: mesh.material, base: new Float32Array(colors ?? []), ranges });
  }

  /** A template mesh (and its instances) shown in one flat colour in the "Data source" view. */
  addSwapped(mesh: Mesh, debug: Material): void {
    this.swaps.push({ mesh, material: mesh.material, debug });
  }

  /** A mesh that exists only for the debug views. */
  addDebugOnly(mesh: Mesh): void {
    mesh.setEnabled(false);
    this.onlyInDebug.push(mesh);
  }

  next(): void {
    this.set((this.index + 1) % DEBUG_VIEWS.length);
  }

  set(index: number): void {
    this.index = index;
    for (const item of this.recolourable) {
      let colors = item.base;
      if (index > 0) {
        colors = new Float32Array(item.base.length);
        for (let i = 0; i < colors.length; i += 4) {
          colors[i] = NEUTRAL[0];
          colors[i + 1] = NEUTRAL[1];
          colors[i + 2] = NEUTRAL[2];
          colors[i + 3] = 1;
        }
        for (const range of item.ranges) {
          const c = range.tints[index - 1]!;
          for (let v = range.start; v < range.start + range.count; v++) {
            colors[v * 4] = c[0];
            colors[v * 4 + 1] = c[1];
            colors[v * 4 + 2] = c[2];
          }
        }
      }
      item.mesh.setVerticesData(VertexBuffer.ColorKind, colors, false, 4);
      item.mesh.material = index > 0 ? this.flat : item.material;
    }
    for (const swap of this.swaps) swap.mesh.material = index === 3 ? swap.debug : swap.material;
    for (const mesh of this.onlyInDebug) mesh.setEnabled(index === 3);
  }
}
