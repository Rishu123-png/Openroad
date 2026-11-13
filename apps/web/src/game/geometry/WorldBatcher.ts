import type { Material } from "@babylonjs/core/Materials/material";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { GeometryBuffer } from "./GeometryBuffer";

export interface BatchLayer<K extends string> {
  material: Material;
  /** Whether meshes of this layer cast shadows. */
  castShadows?: boolean;
  receiveShadows?: boolean;
  key: K;
}

/**
 * Groups static geometry by material and by square ground tile, so each tile
 * is one mesh per material. Tiles outside the camera's view are skipped by
 * Babylon.js frustum culling, and this is the same division that world
 * streaming will later load and unload.
 */
export class WorldBatcher<K extends string> {
  private readonly buffers = new Map<string, { layer: K; buffer: GeometryBuffer }>();

  constructor(private readonly tileSize: number) {}

  /** The buffer for a material at a ground position. Pass `tile` to force everything into one named tile. */
  at(layer: K, x: number, z: number, tile?: string): GeometryBuffer {
    const id = tile ?? `${Math.floor(x / this.tileSize)}_${Math.floor(z / this.tileSize)}`;
    const key = `${layer}@${id}`;
    let entry = this.buffers.get(key);
    if (!entry) {
      entry = { layer, buffer: new GeometryBuffer() };
      this.buffers.set(key, entry);
    }
    return entry.buffer;
  }

  build(scene: Scene, layers: Record<K, Omit<BatchLayer<K>, "key">>): { meshes: Mesh[]; casters: Mesh[] } {
    const meshes: Mesh[] = [];
    const casters: Mesh[] = [];
    for (const [key, { layer, buffer }] of this.buffers) {
      if (buffer.isEmpty) continue;
      const config = layers[layer];
      const mesh = buffer.toMesh(key, scene);
      mesh.material = config.material;
      mesh.receiveShadows = config.receiveShadows ?? true;
      mesh.freezeWorldMatrix();
      mesh.doNotSyncBoundingInfo = true;
      meshes.push(mesh);
      if (config.castShadows) casters.push(mesh);
    }
    this.buffers.clear();
    return { meshes, casters };
  }
}
