import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import {
  asphaltTextures,
  concreteTextures,
  FACADE,
  foliageTextures,
  glassFacade,
  grassTextures,
  grateTexture,
  paverTextures,
  type PixelImage,
  plasterTextures,
  residentialFacade,
  ribbonFacade,
  roadPaintTexture,
  shopfrontFacade,
  genericFacade,
  signAtlas,
} from "./proceduralTextures";

export const MATERIAL_KEYS = [
  "asphalt",
  "roadPaint",
  "grate",
  "concrete",
  "pavers",
  "grass",
  "plaster",
  "metal",
  "foliage",
  "residential",
  "glass",
  "ribbon",
  "shopfront",
  "signs",
  "generic",
] as const;

export type MaterialKey = (typeof MATERIAL_KEYS)[number];
export type MaterialLibrary = Record<MaterialKey, PBRMaterial>;

/** Uploads raw pixels as a repeating, mip-mapped texture. `tileU`/`tileV` are the size of one repeat in metres. */
export function textureFromPixels(
  scene: Scene,
  name: string,
  image: PixelImage,
  tileU: number,
  tileV = tileU,
  anisotropy = 4,
): RawTexture {
  const texture = RawTexture.CreateRGBATexture(
    image.data,
    image.width,
    image.height,
    scene,
    true,
    false,
    Texture.TRILINEAR_SAMPLINGMODE,
  );
  texture.name = name;
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  texture.uScale = 1 / tileU;
  texture.vScale = 1 / tileV;
  texture.anisotropicFilteringLevel = anisotropy;
  return texture;
}

interface Surface {
  albedo: PixelImage;
  normal?: PixelImage;
  tileU: number;
  tileV?: number;
  roughness: number;
  metallic?: number;
  anisotropy?: number;
  bump?: number;
}

function pbr(scene: Scene, name: string, s: Surface): PBRMaterial {
  const material = new PBRMaterial(`${name}Material`, scene);
  material.albedoTexture = textureFromPixels(scene, `${name}Albedo`, s.albedo, s.tileU, s.tileV, s.anisotropy);
  if (s.normal) {
    const bump = textureFromPixels(scene, `${name}Normal`, s.normal, s.tileU, s.tileV, s.anisotropy);
    bump.level = s.bump ?? 1;
    material.bumpTexture = bump;
  }
  material.metallic = s.metallic ?? 0;
  material.roughness = s.roughness;
  // No reflection texture lookups are needed for a horizon this simple.
  material.realTimeFiltering = false;
  material.ambientColor = Color3.White();
  return material;
}

/**
 * Every material in the world. They are few and shared: variation comes from
 * vertex colours, so thousands of objects still render in a handful of draw calls.
 */
export function createMaterialLibrary(scene: Scene): MaterialLibrary {
  const facadeW = FACADE.bays * FACADE.bayWidth;
  const facadeH = FACADE.floors * FACADE.floorHeight;

  const library: MaterialLibrary = {
    asphalt: pbr(scene, "asphalt", { ...asphaltTextures(), tileU: 4, roughness: 0.88, anisotropy: 8, bump: 0.9 }),
    roadPaint: pbr(scene, "roadPaint", { albedo: roadPaintTexture(), tileU: 1, roughness: 0.6, anisotropy: 8 }),
    grate: pbr(scene, "grate", { albedo: grateTexture(), tileU: 0.5, roughness: 0.55, metallic: 0.6 }),
    concrete: pbr(scene, "concrete", { ...concreteTextures(), tileU: 2, roughness: 0.92 }),
    pavers: pbr(scene, "pavers", { ...paverTextures(), tileU: 2, roughness: 0.9, anisotropy: 8 }),
    grass: pbr(scene, "grass", { ...grassTextures(), tileU: 3, roughness: 1 }),
    plaster: pbr(scene, "plaster", { ...plasterTextures(), tileU: 4, roughness: 0.9 }),
    metal: pbr(scene, "metal", { ...plasterTextures(64), normal: undefined, tileU: 4, roughness: 0.45, metallic: 0.35 }),
    foliage: pbr(scene, "foliage", { ...foliageTextures(), tileU: 1.5, roughness: 0.85, bump: 1.2 }),
    residential: pbr(scene, "residential", { albedo: residentialFacade(), tileU: facadeW, tileV: facadeH, roughness: 0.8 }),
    glass: pbr(scene, "glass", { albedo: glassFacade(), tileU: facadeW, tileV: facadeH, roughness: 0.12, metallic: 0.55 }),
    ribbon: pbr(scene, "ribbon", { albedo: ribbonFacade(), tileU: facadeW, tileV: facadeH, roughness: 0.6 }),
    shopfront: pbr(scene, "shopfront", { albedo: shopfrontFacade(), tileU: facadeW, tileV: 4, roughness: 0.6 }),
    signs: pbr(scene, "signs", { albedo: signAtlas(), tileU: 1, roughness: 0.5 }),
    generic: pbr(scene, "generic", { albedo: genericFacade(), tileU: facadeW, tileV: facadeH, roughness: 0.85 }),
  };

  // Markings and grates lie 1 cm above the road; the depth offset stops them flickering far away.
  library.roadPaint.zOffset = -2;
  library.grate.zOffset = -2;
  // Palm fronds and sign backs are seen from both sides.
  library.foliage.backFaceCulling = false;
  library.foliage.twoSidedLighting = true;
  library.signs.backFaceCulling = false;
  library.grass.specularIntensity = 0.3;
  library.foliage.specularIntensity = 0.5;
  return library;
}
