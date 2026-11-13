import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import { Random } from "../../utils/random";
import { WorldBatcher } from "../geometry/WorldBatcher";
import { createMaterialLibrary, type MaterialKey, type MaterialLibrary } from "../materials/MaterialLibrary";
import { buildBuildings } from "./buildings";
import { buildFurniture } from "./furniture";
import { buildGroundworks } from "./groundworks";
import { LAYOUT } from "./layout";
import { buildRoads } from "./roads";
import { plantVegetation } from "./vegetation";
import type { WorldContext } from "./WorldContext";

export interface World {
  materials: MaterialLibrary;
  /** Meshes that should be drawn into the shadow map. */
  shadowCasters: AbstractMesh[];
  /** What was generated, by name: buildings, trees, streetLights and so on. */
  counts: Readonly<Record<string, number>>;
}

/** Which material layers cast shadows. Flat ground layers never do. */
const CASTS_SHADOW: Record<MaterialKey, boolean> = {
  asphalt: false,
  roadPaint: false,
  grate: false,
  concrete: false,
  pavers: false,
  grass: false,
  plaster: true,
  metal: true,
  foliage: true,
  residential: true,
  glass: true,
  ribbon: true,
  shopfront: true,
  signs: false,
};

/**
 * Generates the test district: a divided six-lane road crossing a four-lane
 * road, with footpaths, planting, buildings and street furniture.
 *
 * Everything is procedural and seeded, so the same world is built every time
 * and no model or image files are downloaded.
 */
export function createWorld(scene: Scene, seed = 2026): World {
  const materials = createMaterialLibrary(scene);
  const ctx: WorldContext = {
    scene,
    materials,
    batch: new WorldBatcher<MaterialKey>(LAYOUT.tileSize),
    random: new Random(seed),
    trees: [],
    counts: {},
  };

  buildRoads(ctx);
  buildGroundworks(ctx);
  buildBuildings(ctx);
  const furniture = buildFurniture(ctx);
  const vegetation = plantVegetation(ctx);

  const layers = Object.fromEntries(
    (Object.keys(CASTS_SHADOW) as MaterialKey[]).map((key) => [key, { material: materials[key], castShadows: CASTS_SHADOW[key] }]),
  ) as Record<MaterialKey, { material: MaterialLibrary[MaterialKey]; castShadows: boolean }>;
  const built = ctx.batch.build(scene, layers);
  ctx.counts.staticMeshes = built.meshes.length;

  // The distant skyline is too far away to shade the street.
  const casters = built.casters.filter((mesh) => !mesh.name.endsWith("@skyline"));
  return {
    materials,
    shadowCasters: [...casters, ...furniture.casters, ...vegetation.casters],
    counts: ctx.counts,
  };
}
