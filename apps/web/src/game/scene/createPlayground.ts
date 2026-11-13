import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
// Side-effect import: registers Mesh.createInstance().
import "@babylonjs/core/Meshes/instancedMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";

/** All dimensions are in metres (master plan section 2.4). */
export const PLAYGROUND = {
  groundSize: 800,
  roadLength: 400,
  /** Two 3.5 m lanes. */
  roadWidth: 7,
  /** Paved strip on each side of the carriageway. */
  shoulderWidth: 1.5,
  dashLength: 3,
  dashGap: 6,
  lineWidth: 0.15,
  /** Roadside posts, as a scale and motion reference. */
  postSpacing: 25,
} as const;

export interface Playground {
  ground: Mesh;
  road: Mesh;
  /** Number of centre-line dashes drawn. */
  dashCount: number;
}

function matte(scene: Scene, name: string, color: Color3): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = color;
  material.specularColor = new Color3(0.04, 0.04, 0.04);
  return material;
}

/**
 * Builds the test environment: a flat ground with one straight two-lane road
 * running along the Z axis, lane markings and roadside posts.
 *
 * The scene is static, so world matrices are frozen and repeated objects are
 * instances.
 */
export function createPlayground(scene: Scene): Playground {
  const p = PLAYGROUND;

  const ground = CreateGround("ground", { width: p.groundSize, height: p.groundSize }, scene);
  ground.material = matte(scene, "groundMaterial", new Color3(0.36, 0.45, 0.27));

  // Layers sit a few millimetres apart so they do not flicker (z-fighting).
  const shoulder = CreateGround(
    "shoulder",
    { width: p.roadWidth + p.shoulderWidth * 2, height: p.roadLength },
    scene,
  );
  shoulder.position.y = 0.01;
  shoulder.material = matte(scene, "shoulderMaterial", new Color3(0.42, 0.4, 0.37));

  const road = CreateGround("road", { width: p.roadWidth, height: p.roadLength }, scene);
  road.position.y = 0.02;
  road.material = matte(scene, "asphaltMaterial", new Color3(0.17, 0.18, 0.2));

  const paint = matte(scene, "roadPaintMaterial", new Color3(0.92, 0.92, 0.88));
  paint.emissiveColor = new Color3(0.25, 0.25, 0.24); // keep lines readable in shade

  // Solid edge lines.
  for (const side of [-1, 1]) {
    const edge = CreateGround(
      side < 0 ? "edgeLineLeft" : "edgeLineRight",
      { width: p.lineWidth, height: p.roadLength },
      scene,
    );
    edge.position.set(side * (p.roadWidth / 2 - 0.25), 0.03, 0);
    edge.material = paint;
    edge.freezeWorldMatrix();
  }

  // Dashed centre line: one mesh, drawn many times.
  const dash = CreateGround("centreDash", { width: p.lineWidth, height: p.dashLength }, scene);
  dash.material = paint;
  dash.isVisible = false; // template only
  const period = p.dashLength + p.dashGap;
  const dashCount = Math.floor(p.roadLength / period);
  const firstZ = -((dashCount - 1) * period) / 2;
  for (let i = 0; i < dashCount; i++) {
    const instance = dash.createInstance(`centreDash_${i}`);
    instance.position.set(0, 0.03, firstZ + i * period);
    instance.freezeWorldMatrix();
  }

  // Roadside posts.
  const post = CreateBox("post", { width: 0.12, depth: 0.12, height: 1 }, scene);
  post.material = matte(scene, "postMaterial", new Color3(0.9, 0.9, 0.9));
  post.isVisible = false; // template only
  const postX = p.roadWidth / 2 + p.shoulderWidth + 0.4;
  for (let z = -p.roadLength / 2; z <= p.roadLength / 2; z += p.postSpacing) {
    for (const side of [-1, 1]) {
      const instance = post.createInstance(`post_${side < 0 ? "L" : "R"}_${z}`);
      instance.position.set(side * postX, 0.5, z);
      instance.freezeWorldMatrix();
    }
  }

  for (const mesh of [ground, shoulder, road]) mesh.freezeWorldMatrix();

  return { ground, road, dashCount };
}
