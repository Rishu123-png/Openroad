import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { RawCubeTexture } from "@babylonjs/core/Materials/Textures/rawCubeTexture";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { CubeMapToSphericalPolynomialTools } from "@babylonjs/core/Misc/HighDynamicRange/cubemapToSphericalPolynomial";
import { Scene } from "@babylonjs/core/scene";
import { textureFromPixels } from "../materials/MaterialLibrary";
import { SKY, skyCubeFaces, skyPanorama } from "../materials/proceduralTextures";

export interface Daylight {
  sun: DirectionalLight;
  shadows: ShadowGenerator;
  skyDome: Mesh;
  /**
   * Registers the static shadow casters. The shadow map is drawn once, when
   * the scene is ready, and reused every frame after that.
   */
  setStaticShadowCasters(casters: readonly AbstractMesh[]): void;
}

export const DAYLIGHT = {
  sunIntensity: 4.2,
  skyIntensity: 1.5,
  exposure: 1.2,
  contrast: 1.12,
  /** Exponential-squared haze: about 5% at 100 m, 37% at 300 m, 75% at 550 m. */
  fogDensity: 0.00215,
  shadowMapSize: 4096,
} as const;

const SKY_CUBE_SIZE = 32;

function linear(c: readonly [number, number, number]): Color3 {
  return new Color3(Math.pow(c[0] / 255, 2.2), Math.pow(c[1] / 255, 2.2), Math.pow(c[2] / 255, 2.2));
}

/** An inward-facing sphere that follows the camera and shows the sky panorama. */
function createSkyDome(scene: Scene): Mesh {
  const rings = 24;
  const segments = 48;
  const radius = 1800;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let j = 0; j <= rings; j++) {
    const theta = (j / rings) * Math.PI;
    for (let i = 0; i <= segments; i++) {
      const phi = (i / segments) * Math.PI * 2;
      positions.push(Math.cos(phi) * Math.sin(theta) * radius, Math.cos(theta) * radius, Math.sin(phi) * Math.sin(theta) * radius);
      uvs.push(i / segments, j / rings);
    }
  }
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * (segments + 1) + i;
      indices.push(a, a + 1, a + segments + 2, a, a + segments + 2, a + segments + 1);
    }
  }
  const dome = new Mesh("skyDome", scene);
  const data = new VertexData();
  data.positions = positions;
  data.uvs = uvs;
  data.indices = indices;
  data.applyToMesh(dome);

  const material = new StandardMaterial("skyMaterial", scene);
  const panorama = textureFromPixels(scene, "skyPanorama", skyPanorama(), 1, 1, 1);
  panorama.wrapV = Texture.CLAMP_ADDRESSMODE;
  material.emissiveTexture = panorama;
  material.disableLighting = true;
  material.backFaceCulling = false;
  material.fogEnabled = false;
  material.disableDepthWrite = true;
  dome.material = material;
  dome.infiniteDistance = true;
  dome.isPickable = false;
  dome.applyFog = false;
  dome.alwaysSelectAsActiveMesh = true;
  return dome;
}

/**
 * Ambient light and reflections from the sky, as a tiny cube map computed in
 * code. Its diffuse contribution is stored as spherical harmonics, so no HDR
 * environment file has to be downloaded.
 */
function createSkyLight(scene: Scene): void {
  // The headless test engine has no GPU to hold a cube map.
  if (!(scene.getEngine() as { _gl?: unknown })._gl) return;
  const faces = skyCubeFaces(SKY_CUBE_SIZE);
  const cube = new RawCubeTexture(scene, faces, SKY_CUBE_SIZE, 5, 0, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  cube.name = "skyCube";
  cube.gammaSpace = true;
  const [right, left, up, down, front, back] = faces as [Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array];
  cube.sphericalPolynomial = CubeMapToSphericalPolynomialTools.ConvertCubeMapToSphericalPolynomial({
    size: SKY_CUBE_SIZE,
    right,
    left,
    up,
    down,
    front,
    back,
    format: 5, // RGBA
    type: 0, // unsigned byte
    gammaSpace: true,
  });
  scene.environmentTexture = cube;
  scene.environmentIntensity = DAYLIGHT.skyIntensity;
}

/** Clear-day lighting: sky dome, sky ambient, a shadow-casting sun, haze and filmic tone mapping. */
export function createDaylight(scene: Scene): Daylight {
  const horizon = linear(SKY.horizon);
  scene.clearColor = new Color4(horizon.r, horizon.g, horizon.b, 1);
  scene.ambientColor = Color3.Black();

  const skyDome = createSkyDome(scene);
  createSkyLight(scene);

  const toSun = new Vector3(SKY.toSun[0], SKY.toSun[1], SKY.toSun[2]);
  const sun = new DirectionalLight("sunLight", toSun.scale(-1), scene);
  sun.position = toSun.scale(600);
  sun.intensity = DAYLIGHT.sunIntensity;
  sun.diffuse = new Color3(1, 0.95, 0.86);
  sun.specular = new Color3(1, 0.96, 0.9);
  sun.autoCalcShadowZBounds = true;

  const shadows = new ShadowGenerator(DAYLIGHT.shadowMapSize, sun);
  shadows.usePercentageCloserFiltering = true;
  shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
  shadows.bias = 0.0012;
  shadows.normalBias = 0.03;
  shadows.darkness = 0.15; // sky light fills the shadows

  // Aerial perspective: distant objects fade toward the horizon colour.
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = DAYLIGHT.fogDensity;
  scene.fogColor = horizon;

  // Filmic tone mapping in the material shaders: no post-processing pass.
  const image = scene.imageProcessingConfiguration;
  image.toneMappingEnabled = true;
  image.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
  image.exposure = DAYLIGHT.exposure;
  image.contrast = DAYLIGHT.contrast;

  const setStaticShadowCasters = (casters: readonly AbstractMesh[]): void => {
    const map = shadows.getShadowMap();
    if (!map) return;
    map.renderList = [...casters];
    // Fit the shadow frustum to the casters now, then stop refitting and
    // redrawing: nothing in the district moves.
    scene.executeWhenReady(() => {
      if (scene.isDisposed) return;
      map.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
      scene.onAfterRenderObservable.addOnce(() => {
        sun.autoUpdateExtends = false;
        sun.autoCalcShadowZBounds = false;
      });
    });
  };

  return { sun, shadows, skyDome, setStaticShadowCasters };
}
