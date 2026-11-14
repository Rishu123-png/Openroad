import type { Material } from "@babylonjs/core/Materials/material";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { GeometryBuffer, type Color } from "../geometry/GeometryBuffer";

/** A plain, unbranded hatchback made of boxes. The origin is on the ground under the middle; the nose points along +Z. */
export function createVehicleMesh(scene: Scene, material: Material): Mesh {
  const body: Color = [0.62, 0.08, 0.05];
  const dark: Color = [0.03, 0.03, 0.035];
  const glass: Color = [0.07, 0.1, 0.13];
  const g = new GeometryBuffer();
  g.box(0, 0.32, 0, 1.74, 0.5, 4.05, { color: body, bottom: true });
  g.box(0, 0.82, -0.25, 1.56, 0.5, 2.2, { color: glass });
  g.box(0, 1.32, -0.25, 1.5, 0.05, 2.1, { color: body });
  for (const x of [-0.84, 0.84]) {
    for (const z of [-1.3, 1.3]) g.box(x, 0, z, 0.22, 0.62, 0.62, { color: dark, bottom: true });
  }
  for (const x of [-0.6, 0.6]) {
    g.box(x, 0.6, 2.02, 0.36, 0.14, 0.04, { color: [1, 0.96, 0.82] }); // headlights
    g.box(x, 0.62, -2.02, 0.36, 0.12, 0.04, { color: [0.7, 0.02, 0.02] }); // tail lights
  }
  const mesh = g.toMesh("vehicle", scene);
  mesh.material = material;
  mesh.receiveShadows = true;
  return mesh;
}
