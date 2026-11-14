import { fbm, hash2, valueNoise } from "../../utils/random";

/**
 * Textures generated in code as raw pixels. Nothing here touches the DOM or
 * the GPU, so the functions run in tests and no image files are downloaded.
 * Every texture tiles seamlessly.
 */
export interface PixelImage {
  width: number;
  height: number;
  /** RGBA, 8 bits per channel, row by row from the top. */
  data: Uint8Array;
}

type Rgb = readonly [number, number, number];

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function paint(width: number, height: number, pixel: (x: number, y: number) => Rgb): PixelImage {
  const data = new Uint8Array(width * height * 4);
  let i = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = pixel(x, y);
      data[i++] = clamp255(c[0]);
      data[i++] = clamp255(c[1]);
      data[i++] = clamp255(c[2]);
      data[i++] = 255;
    }
  }
  return { width, height, data };
}

/** Builds a tangent-space normal map from a height field (values around 0..1). */
export function normalMapFromHeight(
  width: number,
  height: number,
  heightAt: (x: number, y: number) => number,
  strength: number,
): PixelImage {
  const h = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) h[y * width + x] = heightAt(x, y);
  const at = (x: number, y: number): number =>
    h[((y + height) % height) * width + ((x + width) % width)]!;
  return paint(width, height, (x, y) => {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
    const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const inv = 1 / Math.hypot(dx, dy, 1);
    return [(-dx * inv * 0.5 + 0.5) * 255, (-dy * inv * 0.5 + 0.5) * 255, (inv * 0.5 + 0.5) * 255];
  });
}

export interface SurfaceTextures {
  albedo: PixelImage;
  normal: PixelImage;
}

/** Asphalt: dark binder with fine stone aggregate. One tile covers 4 m. */
export function asphaltTextures(size = 512): SurfaceTextures {
  const grain = (x: number, y: number): number => hash2(x, y, 11);
  const stone = (x: number, y: number): number => {
    const r = hash2(x >> 1, y >> 1, 23);
    return r > 0.93 ? 1 : r < 0.05 ? -0.6 : 0;
  };
  const patch = (x: number, y: number): number => fbm((x / size) * 6, (y / size) * 6, 5, 3, 6);
  const albedo = paint(size, size, (x, y) => {
    const v = 74 + (grain(x, y) - 0.5) * 20 + stone(x, y) * 30 + (patch(x, y) - 0.5) * 16;
    return [v, v, v * 1.03];
  });
  const normal = normalMapFromHeight(
    size,
    size,
    (x, y) => grain(x, y) * 0.5 + stone(x, y) * 0.5 + patch(x, y) * 0.3,
    1.6,
  );
  return { albedo, normal };
}

/** Interlocking concrete pavers, mostly weathered grey with some dull red blocks, as on Indian footpaths. One tile covers 2 m. */
export function paverTextures(size = 512): SurfaceTextures {
  const bw = size / 10; // 20 cm
  const bh = size / 20; // 10 cm
  const brick = (x: number, y: number): { u: number; v: number; id: number } => {
    const row = Math.floor(y / bh);
    const sx = x + (row % 2) * (bw / 2);
    const col = Math.floor(sx / bw) % 10;
    return { u: (sx % bw) / bw, v: (y % bh) / bh, id: row * 31 + col };
  };
  const joint = (b: { u: number; v: number }): number => {
    const e = Math.min(b.u, 1 - b.u) * bw;
    const f = Math.min(b.v, 1 - b.v) * bh;
    return Math.min(1, Math.min(e, f) / 1.6);
  };
  const albedo = paint(size, size, (x, y) => {
    const b = brick(x, y);
    const r = hash2(b.id, 7, 3);
    const tone = 0.92 + hash2(b.id, 3, 9) * 0.16;
    const dirt = 0.82 + fbm((x / size) * 5, (y / size) * 5, 41, 3, 5) * 0.3;
    const speck = 0.94 + hash2(x, y, 5) * 0.12;
    const base: Rgb = r < 0.72 ? [152, 147, 138] : r < 0.9 ? [150, 122, 110] : [132, 128, 122];
    const k = tone * dirt * speck * (0.45 + 0.55 * joint(b));
    return [base[0] * k, base[1] * k, base[2] * k];
  });
  const normal = normalMapFromHeight(
    size,
    size,
    (x, y) => {
      const b = brick(x, y);
      return joint(b) + hash2(x, y, 5) * 0.08 + hash2(b.id, 1, 2) * 0.15;
    },
    1.3,
  );
  return { albedo, normal };
}

/** Cast concrete with stains. One tile covers 2 m. */
export function concreteTextures(size = 256): SurfaceTextures {
  const stain = (x: number, y: number): number => fbm((x / size) * 4, (y / size) * 4, 61, 4, 4);
  const albedo = paint(size, size, (x, y) => {
    const v = 150 + (stain(x, y) - 0.5) * 50 + (hash2(x, y, 8) - 0.5) * 16;
    return [v, v * 0.985, v * 0.955];
  });
  const normal = normalMapFromHeight(size, size, (x, y) => stain(x, y) * 0.6 + hash2(x, y, 8) * 0.25, 1);
  return { albedo, normal };
}

/** Painted plaster with faint rain streaks, near white so vertex colours can tint it. One tile covers 4 m. */
export function plasterTextures(size = 256): SurfaceTextures {
  const streak = (x: number, y: number): number =>
    valueNoise((x / size) * 24, (y / size) * 2, 71, 24) * 0.6 + fbm((x / size) * 4, (y / size) * 4, 73, 3, 4) * 0.4;
  const albedo = paint(size, size, (x, y) => {
    const v = 236 + (streak(x, y) - 0.5) * 34 + (hash2(x, y, 4) - 0.5) * 6;
    return [v, v, v];
  });
  const normal = normalMapFromHeight(size, size, (x, y) => hash2(x, y, 4) * 0.3 + streak(x, y) * 0.2, 0.6);
  return { albedo, normal };
}

/** Grass and ground cover, near neutral green so vertex colours can dry it out. One tile covers 3 m. */
export function grassTextures(size = 256): SurfaceTextures {
  const blade = (x: number, y: number): number => hash2(x, y >> 1, 31);
  const clump = (x: number, y: number): number => fbm((x / size) * 8, (y / size) * 8, 33, 4, 8);
  const albedo = paint(size, size, (x, y) => {
    const c = clump(x, y);
    const b = 0.75 + blade(x, y) * 0.5;
    return [(86 + c * 44) * b, (112 + c * 30) * b, (52 + c * 20) * b];
  });
  const normal = normalMapFromHeight(size, size, (x, y) => blade(x, y) * 0.6 + clump(x, y), 1.4);
  return { albedo, normal };
}

/** Greyscale leaf and bark detail, multiplied by vertex colour. One tile covers 1.5 m. */
export function foliageTextures(size = 256): SurfaceTextures {
  const leaf = (x: number, y: number): number => {
    const cell = valueNoise((x / size) * 40, (y / size) * 40, 91, 40);
    const fine = hash2(x, y, 93);
    return cell * 0.7 + fine * 0.3;
  };
  const albedo = paint(size, size, (x, y) => {
    const l = leaf(x, y);
    const v = 120 + l * 135;
    return [v, v, v];
  });
  const normal = normalMapFromHeight(size, size, leaf, 2.4);
  return { albedo, normal };
}

/** Thermoplastic road paint with wear. One tile covers 1 m. */
export function roadPaintTexture(size = 128): PixelImage {
  return paint(size, size, (x, y) => {
    const wear = fbm((x / size) * 6, (y / size) * 6, 51, 3, 6);
    const chip = hash2(x, y, 53) > 0.9 ? 0.72 : 1;
    const v = (206 + wear * 40) * chip;
    return [v, v, v * 0.97];
  });
}

/** Cast-iron drain grate with slots. One tile covers 0.5 m. */
export function grateTexture(size = 64): PixelImage {
  return paint(size, size, (x, y) => {
    const border = x < 5 || y < 5 || x > size - 6 || y > size - 6;
    const slot = !border && x % 12 > 6 && (y % 32 > 5 && y % 32 < 28);
    const v = slot ? 8 : 52 + hash2(x, y, 6) * 22;
    return [v, v, v * 1.04];
  });
}

/** Facade tile: 4 bays by 4 floors. Bays are 3 m wide and floors 3.2 m high. */
export const FACADE = { bays: 4, floors: 4, bayWidth: 3, floorHeight: 3.2 } as const;

function facade(
  size: number,
  seed: number,
  cell: (u: number, v: number, random: (salt: number) => number, x: number, y: number) => Rgb,
): PixelImage {
  const cw = size / FACADE.bays;
  const ch = size / FACADE.floors;
  return paint(size, size, (x, y) => {
    const cx = Math.floor(x / cw);
    const cy = Math.floor(y / ch);
    const random = (salt: number): number => hash2(cx * 7 + salt, cy * 13 + salt, seed);
    return cell((x % cw) / cw, (y % ch) / ch, random, x, y);
  });
}

function glass(v: number, shade: number, tint: Rgb): Rgb {
  // Brighter toward the top of each pane, as if reflecting the sky.
  const k = (0.55 + (1 - v) * 0.6) * shade;
  return [tint[0] * k, tint[1] * k, tint[2] * k];
}

/** Apartment block: plaster wall, a window per bay, some with curtains or a recessed balcony. */
export function residentialFacade(size = 512): PixelImage {
  return facade(size, 101, (u, v, random, x, y) => {
    const stain = 0.93 + fbm(x / 40, y / 90, 103, 3) * 0.1;
    const wall: Rgb = [238 * stain, 236 * stain, 230 * stain];
    if (v > 0.94) return [wall[0] * 0.8, wall[1] * 0.8, wall[2] * 0.8]; // floor slab line
    const balcony = random(1) < 0.3;
    const left = balcony ? 0.12 : 0.24;
    const right = balcony ? 0.88 : 0.76;
    const top = 0.2;
    const bottom = balcony ? 0.9 : 0.7;
    if (u > left && u < right && v > top && v < bottom) {
      const frame = Math.min(u - left, right - u) < 0.025 || Math.min(v - top, bottom - v) < 0.03;
      if (frame) return [205, 205, 200];
      if (balcony && v > 0.62) return (Math.floor(u * 40) % 2 === 0 ? [70, 72, 76] : [44, 46, 50]); // railing
      if (Math.abs(u - (left + right) / 2) < 0.012) return [190, 190, 186]; // mullion
      const curtain = random(2);
      if (curtain < 0.3 && v < top + (bottom - top) * (0.4 + curtain)) return [196, 184, 160];
      return glass((v - top) / (bottom - top), 0.75 + random(3) * 0.4, balcony ? [46, 54, 62] : [74, 96, 118]);
    }
    if (!balcony && v > 0.7 && v < 0.74 && u > 0.2 && u < 0.8) return [200, 198, 192]; // sill
    return wall;
  });
}

/**
 * A plain urban wall with one simple window per bay and nothing else: no
 * balconies, curtains or shop fronts. Used for buildings whose use is unknown.
 */
export function genericFacade(size = 512): PixelImage {
  // Four plain variants stacked in one texture, so that buildings of unknown use differ without a material each.
  // A wall picks one by starting its texture rows at a multiple of the tile height (see GENERIC_FACADE_VARIANTS).
  const parts = [genericFacadeA(size), genericFacadeB(size), genericFacadeC(size, 701, 0.22), genericFacadeC(size, 811, 0)];
  const data = new Uint8Array(size * size * 4 * parts.length);
  parts.forEach((part, i) => data.set(part.data, i * size * size * 4));
  return { width: size, height: size * parts.length, data };
}

/** Number of variants stacked in `genericFacade`. */
export const GENERIC_FACADE_VARIANTS = 4;

function genericFacadeA(size: number): PixelImage {
  return facade(size, 501, (u, v, random, x, y) => {
    const stain = 0.92 + fbm(x / 45, y / 80, 503, 3) * 0.11;
    const wall: Rgb = [236 * stain, 234 * stain, 228 * stain];
    if (v > 0.95) return [wall[0] * 0.84, wall[1] * 0.84, wall[2] * 0.84]; // floor line
    const left = 0.3, right = 0.7, top = 0.26, bottom = 0.68;
    if (u > left && u < right && v > top && v < bottom) {
      if (Math.min(u - left, right - u) < 0.025 || Math.min(v - top, bottom - v) < 0.03) return [150, 150, 146];
      if (Math.abs(u - 0.5) < 0.012) return [150, 150, 146];
      return glass((v - top) / (bottom - top), 0.7 + random(3) * 0.35, [62, 78, 92]);
    }
    if (v >= 0.68 && v < 0.715 && u > 0.27 && u < 0.73) return [196, 194, 188]; // sill
    if (v > 0.2 && v <= 0.26 && u > 0.27 && u < 0.73) return [wall[0] * 0.9, wall[1] * 0.9, wall[2] * 0.9]; // shade over the window
    return wall;
  });
}

/**
 * Second plain wall for buildings of unknown use: one wide, low window per
 * bay behind a simple grille, under a projecting shade. Still nothing that
 * states a use.
 */
function genericFacadeB(size: number): PixelImage {
  return facade(size, 601, (u, v, random, x, y) => {
    const stain = 0.91 + fbm(x / 50, y / 70, 607, 3) * 0.12;
    const wall: Rgb = [234 * stain, 232 * stain, 226 * stain];
    if (v > 0.955) return [wall[0] * 0.8, wall[1] * 0.8, wall[2] * 0.8]; // floor line
    const left = 0.16, right = 0.84, top = 0.3, bottom = 0.64;
    if (v > 0.22 && v <= top && u > left - 0.05 && u < right + 0.05) return [wall[0] * 0.82, wall[1] * 0.82, wall[2] * 0.82]; // shade
    if (u > left && u < right && v > top && v < bottom) {
      if (Math.min(u - left, right - u) < 0.02 || Math.min(v - top, bottom - v) < 0.03) return [128, 124, 118];
      const pane = ((u - left) / (right - left)) * 3;
      if (pane % 1 < 0.04) return [128, 124, 118];
      if (Math.floor(((v - top) / (bottom - top)) * 5) !== Math.floor(((v - top) / (bottom - top)) * 5 - 0.12)) return [96, 96, 98]; // grille bar
      return glass((v - top) / (bottom - top), 0.65 + random(3) * 0.35, [58, 72, 84]);
    }
    return wall;
  });
}

/** Third plain wall for buildings of unknown use: a tall, narrow window per bay with a small vent above; some bays blank. */
function genericFacadeC(size: number, seed: number, blank: number): PixelImage {
  return facade(size, seed, (u, v, random, x, y) => {
    const stain = 0.92 + fbm(x / 38, y / 95, 709, 3) * 0.11;
    const wall: Rgb = [237 * stain, 235 * stain, 229 * stain];
    if (v > 0.95 || v < 0.03) return [wall[0] * 0.86, wall[1] * 0.86, wall[2] * 0.86]; // slab band
    if (random(5) < blank) return wall; // blank bay
    const left = 0.36, right = 0.64, top = 0.3, bottom = 0.8;
    if (u > left && u < right && v > 0.14 && v < 0.22) return Math.floor(u * 60) % 2 === 0 ? [92, 92, 94] : [150, 148, 144]; // vent
    if (u > left && u < right && v > top && v < bottom) {
      if (Math.min(u - left, right - u) < 0.022 || Math.min(v - top, bottom - v) < 0.025) return [160, 156, 148];
      if (Math.abs(v - 0.55) < 0.012) return [160, 156, 148];
      return glass((v - top) / (bottom - top), 0.7 + random(3) * 0.35, [66, 82, 96]);
    }
    return wall;
  });
}

/** Curtain-wall office tower: glass panes in aluminium mullions with spandrel bands. */
export function glassFacade(size = 512): PixelImage {
  return facade(size, 201, (u, v, random) => {
    const mu = (u * 2) % 1;
    if (Math.min(mu, 1 - mu) < 0.03 || v < 0.035) return [92, 98, 104];
    const spandrel = v > 0.74;
    const shade = 0.8 + random(Math.floor(u * 2) + 4) * 0.35;
    if (spandrel) return [58 * shade, 68 * shade, 78 * shade];
    return glass(v / 0.74, shade, [104, 124, 138]);
  });
}

/** Office or commercial floor: a ribbon of windows between cladding bands. */
export function ribbonFacade(size = 512): PixelImage {
  return facade(size, 301, (u, v, random, x, y) => {
    const stain = 0.94 + fbm(x / 50, y / 70, 303, 3) * 0.09;
    if (v > 0.3 && v < 0.74) {
      const mu = (u * 3) % 1;
      if (Math.min(mu, 1 - mu) < 0.04 || v < 0.325 || v > 0.715) return [70, 74, 80];
      const blind = random(Math.floor(u * 3) + 2);
      if (blind < 0.25 && v < 0.3 + 0.44 * (0.3 + blind * 2)) return [176, 178, 172];
      return glass((v - 0.3) / 0.44, 0.8 + random(5) * 0.3, [66, 88, 108]);
    }
    if (u < 0.02 || u > 0.98) return [214 * stain, 214 * stain, 210 * stain];
    return [236 * stain, 235 * stain, 230 * stain];
  });
}

/** Ground-floor shops: glazed fronts, rolling shutters and plaster piers. 4 bays by 1 floor (12 m by 4 m). */
export function shopfrontFacade(width = 512, height = 128): PixelImage {
  const cw = width / FACADE.bays;
  return paint(width, height, (x, y) => {
    const bay = Math.floor(x / cw);
    const u = (x % cw) / cw;
    const v = y / height;
    const r = hash2(bay, 3, 401);
    if (u < 0.07 || u > 0.93 || v < 0.1) {
      const s = 0.88 + fbm(x / 30, y / 30, 403, 3) * 0.14;
      return [222 * s, 218 * s, 208 * s]; // pier and lintel
    }
    if (v > 0.95) return [120, 116, 110]; // step
    if (r < 0.3) {
      const slat = Math.floor(y / 3) % 2 === 0 ? 1 : 0.8; // rolling shutter
      return [150 * slat, 154 * slat, 158 * slat];
    }
    if (Math.abs(u - 0.5) < 0.012 || Math.abs(v - 0.3) < 0.012) return [58, 60, 64]; // frame
    const interior = 0.5 + valueNoise(x / 9, y / 14, 405) * 0.9;
    return v < 0.3 ? glass(v / 0.3, 0.9, [70, 92, 108]) : [34 * interior, 36 * interior, 40 * interior];
  });
}

/** Two round traffic signs side by side: "keep left" and "no parking". Pictograms only. */
export function signAtlas(size = 128): PixelImage {
  return paint(size * 2, size, (x, y) => {
    const which = x < size ? 0 : 1;
    const px = ((x % size) + 0.5) / size - 0.5;
    const py = (y + 0.5) / size - 0.5;
    const r = Math.hypot(px, py);
    if (r > 0.5) return [150, 152, 156]; // outside the disc: bare metal
    if (r > 0.455) return [236, 236, 232]; // white rim
    if (which === 0) {
      // Arrow pointing down-left on a blue disc.
      const d = (px + py) * Math.SQRT1_2; // across the shaft
      const a = (-px + py) * Math.SQRT1_2; // along the shaft, positive toward the tip
      const shaft = Math.abs(d) < 0.045 && a > -0.3 && a < 0.12;
      const head = a >= 0.08 && a < 0.3 && Math.abs(d) < (0.3 - a) * 0.75;
      return shaft || head ? [240, 240, 236] : [24, 78, 160];
    }
    // Red ring and slash on a blue disc.
    if (r > 0.36) return [196, 34, 30];
    if (Math.abs((px - py) * Math.SQRT1_2) < 0.05) return [196, 34, 30];
    return [24, 78, 160];
  });
}

/** Sun direction and sky colours shared by the sky dome, the fog and the ambient light. */
export const SKY = {
  /** Unit vector pointing from the ground toward the sun. */
  toSun: normalize([-0.5, 0.74, -0.32]),
  zenith: [58, 112, 196] as Rgb,
  horizon: [188, 204, 218] as Rgb,
  ground: [150, 142, 128] as Rgb,
};

function normalize(v: [number, number, number]): Rgb {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Sky colour (sRGB, 0..255) seen in a unit direction. */
export function skyColor(dx: number, dy: number, dz: number, clouds = true): Rgb {
  if (dy < 0) {
    const t = Math.min(1, -dy * 6);
    return mix(SKY.horizon, SKY.ground, t);
  }
  const t = Math.pow(dy, 0.5);
  let c = mix(SKY.horizon, SKY.zenith, t);
  const sun = Math.max(0, dx * SKY.toSun[0] + dy * SKY.toSun[1] + dz * SKY.toSun[2]);
  const glow = Math.pow(sun, 24) * 0.35 + Math.pow(sun, 600) * 1.5;
  c = [c[0] + 255 * glow, c[1] + 245 * glow, c[2] + 220 * glow];
  if (clouds) {
    const k = 1.6 / (dy + 0.12);
    const px = dx * k;
    const pz = dz * k;
    const density = fbm(px + 13.7, pz + 4.2, 601, 5);
    const cover = smoothstep(0.5, 0.74, density) * smoothstep(0.02, 0.2, dy) * 0.85;
    const light = 0.82 + 0.18 * fbm(px * 2 + 3, pz * 2 - 5, 603, 3);
    c = mix(c, [250 * light, 250 * light, 252 * light], cover);
  }
  return c;
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Sky panorama for the dome: u is the compass angle, v runs from straight up to straight down. */
export function skyPanorama(width = 1024, height = 512): PixelImage {
  return paint(width, height, (x, y) => {
    const phi = ((x + 0.5) / width) * Math.PI * 2;
    const theta = ((y + 0.5) / height) * Math.PI;
    const s = Math.sin(theta);
    return skyColor(Math.cos(phi) * s, Math.cos(theta), Math.sin(phi) * s);
  });
}

/**
 * The six faces of a small sky cube used for ambient light and reflections,
 * in the order +X, -X, +Y, -Y, +Z, -Z.
 */
export function skyCubeFaces(size = 32): Uint8Array[] {
  const dir: Array<(u: number, v: number) => [number, number, number]> = [
    (u, v) => [1, -v, -u],
    (u, v) => [-1, -v, u],
    (u, v) => [u, 1, v],
    (u, v) => [u, -1, -v],
    (u, v) => [u, -v, 1],
    (u, v) => [-u, -v, -1],
  ];
  return dir.map((face) => {
    const image = paint(size, size, (x, y) => {
      const d = normalize(face(((x + 0.5) / size) * 2 - 1, ((y + 0.5) / size) * 2 - 1));
      // Light arriving from the sky is whiter than the sky looks: haze and
      // clouds scatter sunlight. Without this, shadows turn deep blue.
      const c = skyColor(d[0], d[1], d[2], false);
      const grey = (c[0] + c[1] + c[2]) / 3;
      return [c[0] * 0.5 + grey * 0.56, c[1] * 0.5 + grey * 0.54, c[2] * 0.5 + grey * 0.5];
    });
    return image.data;
  });
}

