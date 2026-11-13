import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";

export interface Daylight {
  sky: HemisphericLight;
  sun: DirectionalLight;
}

/** Clear-day lighting: soft light from the sky plus a directional sun. */
export function createDaylight(scene: Scene): Daylight {
  scene.clearColor = new Color4(0.55, 0.75, 0.93, 1);
  scene.ambientColor = new Color3(0.3, 0.3, 0.3);

  const sky = new HemisphericLight("skyLight", new Vector3(0, 1, 0), scene);
  sky.intensity = 0.65;
  sky.groundColor = new Color3(0.35, 0.33, 0.3);

  const sun = new DirectionalLight("sunLight", new Vector3(-0.45, -1, -0.35), scene);
  sun.intensity = 0.95;
  sun.diffuse = new Color3(1, 0.96, 0.88);

  // Distance haze hides the hard edge of the ground plane.
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogColor = new Color3(0.55, 0.75, 0.93);
  scene.fogStart = 150;
  scene.fogEnd = 420;

  return { sky, sun };
}
