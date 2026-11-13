import type { Scene } from "@babylonjs/core/scene";
import type { WorldBatcher } from "../geometry/WorldBatcher";
import type { MaterialKey, MaterialLibrary } from "../materials/MaterialLibrary";
import type { Random } from "../../utils/random";

export type TreeKind = "broad" | "columnar" | "palm" | "shrub" | "flowering";

export interface TreeSpot {
  kind: TreeKind;
  x: number;
  z: number;
  /** Height of the ground at this spot. */
  y?: number;
  scale?: number;
}

/** Shared state while the world is being generated. */
export interface WorldContext {
  scene: Scene;
  materials: MaterialLibrary;
  batch: WorldBatcher<MaterialKey>;
  random: Random;
  /** Planting positions collected by every builder, turned into instances at the end. */
  trees: TreeSpot[];
  /** Named counts for tests and the debug overlay. */
  counts: Record<string, number>;
}

export function count(ctx: WorldContext, name: string, by = 1): void {
  ctx.counts[name] = (ctx.counts[name] ?? 0) + by;
}
