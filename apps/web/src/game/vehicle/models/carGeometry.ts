import { profileAt, type CarSpec, type FaceItem, type FaceKind, type FaceSpec, type WheelStyle } from "./carSpecs";

export type V3 = readonly [number, number, number];
type Rgb = readonly [number, number, number];

/** Triangles for one material of a vehicle. Vertices can be shared, which gives smooth shading. */
export class Part {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly colors: number[] = [];
  readonly indices: number[] = [];

  get isEmpty(): boolean {
    return this.indices.length === 0;
  }

  vertex(p: V3, c: Rgb): number {
    this.positions.push(p[0], p[1], p[2]);
    this.normals.push(0, 0, 0);
    this.colors.push(c[0], c[1], c[2], 1);
    return this.positions.length / 3 - 1;
  }

  /** A triangle whose outside is the side from which a, b, c run anticlockwise (right-hand rule). */
  tri(a: number, b: number, c: number): void {
    const p = this.positions;
    const ux = p[b * 3]! - p[a * 3]!, uy = p[b * 3 + 1]! - p[a * 3 + 1]!, uz = p[b * 3 + 2]! - p[a * 3 + 2]!;
    const vx = p[c * 3]! - p[a * 3]!, vy = p[c * 3 + 1]! - p[a * 3 + 1]!, vz = p[c * 3 + 2]! - p[a * 3 + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    // A triangle with no area (two corners in one place) draws nothing and would leave a vertex without a normal.
    if (nx * nx + ny * ny + nz * nz < 1e-16) return;
    for (const i of [a, b, c]) {
      this.normals[i * 3]! += nx;
      this.normals[i * 3 + 1]! += ny;
      this.normals[i * 3 + 2]! += nz;
    }
    this.indices.push(a, c, b); // Babylon.js front faces are clockwise
  }

  /** A flat four-sided face with its own vertices; `out` says which way it faces. */
  quad(a: V3, b: V3, c: V3, d: V3, out: V3, color: Rgb): void {
    const nx = (b[1] - a[1]) * (d[2] - a[2]) - (b[2] - a[2]) * (d[1] - a[1]);
    const ny = (b[2] - a[2]) * (d[0] - a[0]) - (b[0] - a[0]) * (d[2] - a[2]);
    const nz = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
    const i = [a, b, c, d].map((p) => this.vertex(p, color));
    if (nx * out[0] + ny * out[1] + nz * out[2] >= 0) {
      this.tri(i[0]!, i[1]!, i[2]!);
      this.tri(i[0]!, i[2]!, i[3]!);
    } else {
      this.tri(i[0]!, i[2]!, i[1]!);
      this.tri(i[0]!, i[3]!, i[2]!);
    }
  }

  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: Rgb): void {
    const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], color);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [0, 0, -1], color);
    this.quad([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [1, 0, 0], color);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], color);
    this.quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [0, 1, 0], color);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], color);
  }

  /** Scales every accumulated normal to unit length. Call once, when the part is complete. */
  finish(): void {
    const n = this.normals;
    for (let i = 0; i < n.length; i += 3) {
      const l = Math.hypot(n[i]!, n[i + 1]!, n[i + 2]!);
      if (l < 1e-12) {
        // No triangle uses this vertex, or its faces cancel: point it up rather than leave it unlit.
        n[i] = 0;
        n[i + 1] = 1;
        n[i + 2] = 0;
        continue;
      }
      n[i]! /= l;
      n[i + 1]! /= l;
      n[i + 2]! /= l;
    }
  }

  /** Smallest box containing the part: [minX, minY, minZ, maxX, maxY, maxZ]. */
  bounds(): number[] {
    const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = 0; i < this.positions.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        b[k] = Math.min(b[k]!, this.positions[i + k]!);
        b[k + 3] = Math.max(b[k + 3]!, this.positions[i + k]!);
      }
    }
    return b;
  }
}

export interface CarGeometry {
  /** Painted panels. Vertex colours are white; the paint colour comes from the material. */
  paint: Part;
  glass: Part;
  /** Trim, cladding, grille, underside, interior, plates. */
  detail: Part;
  /** Headlamps and other always-lit lenses. */
  lamps: Part;
  /** Tail and stop lamps, brightened when braking. */
  brake: Part;
  /** One wheel, axle along X, outer face toward +X. */
  wheel: Part;
  /** Centres of the four wheels: front right, front left, rear right, rear left. */
  wheelCentres: V3[];
  /** Where the headlamp beams start. */
  headlamps: V3[];
}

const WHITE: Rgb = [1, 1, 1];
const PLASTIC: Rgb = [0.045, 0.045, 0.05];
const GLOSS: Rgb = [0.012, 0.012, 0.014];
const UNDER: Rgb = [0.016, 0.016, 0.018];
const RUBBER: Rgb = [0.022, 0.022, 0.024];
const ALLOY: Rgb = [0.62, 0.63, 0.65];
const GUNMETAL: Rgb = [0.1, 0.105, 0.115];
const SATIN: Rgb = [0.56, 0.57, 0.59];
const INTERIOR: Rgb = [0.022, 0.021, 0.02];
const PLATE: Rgb = [0.86, 0.86, 0.83];
const HEAD: Rgb = [1, 0.97, 0.9];
const AMBER: Rgb = [0.85, 0.36, 0.03];
const LENS: Rgb = [0.72, 0.74, 0.76];
const REFLECTOR: Rgb = [0.4, 0.02, 0.02];
const DISC: Rgb = [0.3, 0.3, 0.31];

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const smooth = (v: number): number => {
  const k = clamp01(v);
  return k * k * (3 - 2 * k);
};

/** Ring point indices. The ring runs from the centre of the floor, round the side, to the centre of the roof. */
const FLOOR = 1, SILL = 3, ROCKER = 4, BELT = 8, GLASS_TOP = 9, ROOF_EDGE = 10, CENTRE = 13;
/** The side panels between ring points 6-7 and 7-8 carry wrap-round lamps. */
export const LAMP_BAND: readonly [number, number] = [6, 8];
const CAP_COLUMNS = [0, 0.3, 0.55, 0.75, 0.9, 1];

interface Station { t: number; z: number; ring: V3[]; top: number; belt: number; w: number; arch: number; cabin: number; end: boolean }

/**
 * Builds a vehicle body by lofting a cross-section along its length.
 *
 * The section has fourteen points a side: floor, wheel well, sill, a flank
 * that is widest at the shoulder, the belt line, side glass leaning inward to
 * the roof rail, and a crowned roof. Its heights come from the side profile.
 * Both ends are swept back toward the corners and lean back above the bumper,
 * so the nose and tail are curved in plan rather than cut off flat.
 *
 * Stations are placed exactly on every feature edge (window, pillar, door
 * seam, lamp), so each panel between two stations belongs wholly to one
 * material and the edges are crisp. Front and rear details are patches that
 * follow the curved face a few millimetres proud of it.
 */
export function buildCarGeometry(spec: CarSpec): CarGeometry {
  const paint = new Part(), glass = new Part(), detail = new Part(), lamps = new Part(), brake = new Part();
  const L = spec.length, W = spec.width / 2, R = spec.wheelRadius;
  /** Half-width of the body itself; flared arches reach the stated width. */
  const WB = W - spec.flare;
  const z0 = -L / 2 + (spec.rearExtra ?? 0), zEnd = L / 2, Lb = zEnd - z0;
  const frontAxle = L / 2 - spec.frontOverhang, rearAxle = frontAxle - spec.wheelbase;
  const archR = R + (spec.cladding ? 0.07 : 0.052);
  const zAt = (t: number): number => z0 + t * Lb;
  const tAt = (z: number): number => (z - z0) / Lb;

  // ---- how the ends are shaped
  const zoneF = Math.max(0.12, Math.min(0.5, spec.frontOverhang - archR - 0.03));
  const zoneR = Math.max(0.12, Math.min(0.5, rearAxle - z0 - archR - 0.03));
  const floorAt = (z: number): number => spec.clearance + 0.13 * Math.pow(clamp01(1 - Math.min(zEnd - z, z - z0) / 0.3), 2);
  const planWidth = (z: number): number => {
    const front = zEnd - z < z - z0;
    const face = front ? spec.front : spec.rear;
    const k = clamp01((front ? zEnd - z : z - z0) / face.corner);
    return WB * lerp(face.endWidth, 1, Math.sqrt(k * (2 - k)));
  };
  const faceRange = (front: boolean): { low: number; high: number; bumper: number } => {
    const z = front ? zEnd : z0;
    const low = floorAt(z), high = Math.min(profileAt(spec.belt, front ? 1 : 0), profileAt(spec.top, front ? 1 : 0) - 0.035);
    return { low, high, bumper: lerp(low, high, 0.34) };
  };
  const rangeF = faceRange(true), rangeR = faceRange(false);
  // The sweep must stay well under the length it is spread over, or panels would fold over each other.
  const fit = (face: FaceSpec, zone: number, range: { high: number; bumper: number }): { bow: number; lean: number } => {
    const leanDepth = face.lean * (range.high - range.bumper + 0.3);
    const k = Math.min(1, (0.55 * zone) / Math.max(1e-6, face.bow + leanDepth));
    return { bow: face.bow * k, lean: face.lean * k };
  };
  const shapeF = fit(spec.front, zoneF, rangeF), shapeR = fit(spec.rear, zoneR, rangeR);
  const sweep = (u: number): number => Math.pow(Math.min(1, u), 2.4);
  /** Moves a point of the straight loft to its place on the swept body. */
  const shaped = (x: number, y: number, z: number): V3 => {
    const wF = smooth(1 - (zEnd - z) / zoneF), wR = smooth(1 - (z - z0) / zoneR);
    const u = Math.abs(x) / W;
    let out = z;
    if (wF > 0) out -= wF * (shapeF.bow * sweep(u) + shapeF.lean * Math.max(0, y - rangeF.bumper));
    if (wR > 0) out += wR * (shapeR.bow * sweep(u) + shapeR.lean * Math.max(0, y - rangeR.bumper));
    return [x, y, out];
  };

  const archAt = (z: number): number => {
    for (const axle of [frontAxle, rearAxle]) {
      const d = Math.abs(z - axle);
      if (d < archR) return R + Math.sqrt(archR * archR - d * d);
    }
    return 0;
  };
  const flareAt = (y: number, z: number): number => {
    if (spec.flare <= 0) return 0;
    let best = 0;
    for (const axle of [frontAxle, rearAxle]) {
      const d = Math.hypot(z - axle, y - R) - archR;
      best = Math.max(best, clamp01(1 - Math.max(0, d) / 0.11));
    }
    return spec.flare * best * best;
  };

  const makeStation = (t: number, end = false): Station => {
    const z = zAt(t);
    const w = planWidth(z), f = floorAt(z);
    const top = profileAt(spec.top, t);
    const belt = Math.min(profileAt(spec.belt, t), top - 0.035);
    const cabin = clamp01((top - belt) / 0.4);
    const arch = archAt(z);
    const lift = (y: number): number => Math.min(Math.max(y, arch), belt - 0.05);
    const side = (k: number, y: number): V3 => {
      const yy = lift(y);
      return [w * k + flareAt(yy, z), yy, z];
    };
    const yGlass = top - 0.11 * cabin - 0.012;
    const xGlass = Math.max(0.25, 0.962 * w - spec.tumblehome * (yGlass - belt));
    const xRoof = Math.max(0.2, xGlass - 0.05 * cabin - 0.012);
    const crown = 0.012 + 0.024 * cabin;
    const ring: V3[] = [
      [0, f, z],
      [0.6 * w, f, z],
      [0.6 * w + 0.01, lift(f), z],
      side(0.94, f + 0.04),
      side(0.985, f + 0.15),
      side(1, lerp(f, belt, 0.42)),
      side(1, lerp(f, belt, 0.66)),
      side(0.99, belt - 0.07),
      [0.962 * w, belt, z],
      [xGlass, yGlass, z],
      [xRoof, top - 0.02 * cabin - crown, z],
      [xRoof * 0.66, top - crown * 0.22, z],
      [xRoof * 0.33, top - crown * 0.04, z],
      [0, top, z],
    ];
    return { t, z, ring, top, belt, w, arch, cabin, end };
  };

  // ---- stations: every feature edge, then even steps between them
  const m = (metres: number): number => metres / Lb;
  const seam = m(0.0045);
  const cowl: readonly [number, number] = [spec.windshield[1], spec.windshield[1] + m(0.07)];
  const features = new Set<number>([0, 1]);
  const add = (t: number): void => void (t > 0 && t < 1 && features.add(t));
  for (const r of [spec.rearGlass, spec.windshield, spec.sideWindows, cowl, spec.sunroof ?? []]) for (const t of r) add(t);
  for (const t of spec.pillars) for (const s of [-1, 1]) add(t + (s * m(spec.pillarWidth)) / 2);
  for (const t of spec.doorLines) for (const s of [-1, 1]) add(t + s * seam);
  if (spec.front.wrap > 0) add(1 - m(spec.front.wrap));
  if (spec.rear.wrap > 0) add(m(spec.rear.wrap));
  for (const axle of [frontAxle, rearAxle]) for (const s of [-1, 1]) add(tAt(axle + s * archR));
  for (const z of [zEnd - zoneF, z0 + zoneR]) add(tAt(z));
  const sorted = [...features].sort((a, b) => a - b).filter((t, i, all) => i === 0 || t - all[i - 1]! > m(0.003));
  const stations: Station[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!, b = sorted[i + 1]!;
    const zm = zAt((a + b) / 2);
    const curved = Math.min(zEnd - zm, zm - z0) < 0.34 || Math.min(Math.abs(zm - frontAxle), Math.abs(zm - rearAxle)) < archR;
    const steps = Math.max(1, Math.ceil(((b - a) * Lb) / (curved ? 0.042 : 0.075) - 1e-6));
    for (let k = 0; k < steps; k++) stations.push(makeStation(lerp(a, b, k / steps)));
  }
  stations.push(makeStation(1));
  const count = stations.length - 1;

  const within = (t: number, r: readonly number[] | undefined): boolean => !!r && r.length === 2 && t > r[0]! && t < r[1]!;
  const cabinRange: readonly [number, number] = [spec.rearGlass[0], spec.windshield[1]];
  const roofRange: readonly [number, number] = [spec.rearGlass[1], spec.windshield[0]];
  /** Which part a panel belongs to, and its colour there. `s` is the station at the middle of the panel. */
  const classify = (s: Station, seg: number): [Part, Rgb, string] => {
    const t = s.t;
    const inArch = s.arch > 0;
    if (seg === SILL) return spec.cladding || inArch ? [detail, PLASTIC, "c"] : [paint, WHITE, "p"];
    if (seg >= ROCKER && seg < BELT) {
      if (spec.doorLines.some((d) => Math.abs(t - d) < seam)) return [detail, GLOSS, "s"];
      const band = seg >= LAMP_BAND[0];
      if (band && spec.front.wrap > 0 && spec.front.wrapSegs.includes(seg) && t > 1 - m(spec.front.wrap)) return [detail, LENS, "l"];
      if (band && spec.rear.wrap > 0 && spec.rear.wrapSegs.includes(seg) && t < m(spec.rear.wrap)) return [brake, WHITE, "b"];
      return [paint, WHITE, "p"];
    }
    if (seg === BELT) {
      const tall = s.ring[GLASS_TOP]![1] - s.belt > 0.1;
      if (!tall || !within(t, spec.sideWindows)) return spec.twoTone && tall && within(t, cabinRange) ? [detail, GLOSS, "k"] : [paint, WHITE, "p"];
      if (spec.pillars.some((p) => Math.abs(t - p) < m(spec.pillarWidth) / 2)) return spec.blackPillars || spec.twoTone ? [detail, GLOSS, "k"] : [paint, WHITE, "p"];
      return [glass, WHITE, "g"];
    }
    if (seg === GLASS_TOP) return spec.twoTone && within(t, cabinRange) ? [detail, GLOSS, "k"] : [paint, WHITE, "p"];
    // The roof, bonnet and boot.
    if (within(t, spec.windshield) || within(t, spec.rearGlass)) return [glass, WHITE, "g"];
    if (within(t, cowl)) return [detail, PLASTIC, "c"];
    if (seg > ROOF_EDGE && within(t, spec.sunroof)) return [glass, WHITE, "g"];
    if (spec.twoTone && within(t, roofRange)) return [detail, GLOSS, "k"];
    return [paint, WHITE, "p"];
  };

  // ---- the skin. Shared vertices inside a part give smooth panels; a change of part gives a crisp edge.
  const shared = new Map<string, number>();
  const vertexOf = (part: Part, tag: string, i: number, k: number, side: number, color: Rgb): number => {
    const p = stations[i]!.ring[k]!;
    const key = `${tag}:${i}:${k}:${p[0] === 0 ? 0 : side}`;
    let index = shared.get(key);
    if (index === undefined) shared.set(key, (index = part.vertex(shaped(p[0] * side, p[1], p[2]), color)));
    return index;
  };
  for (let i = 0; i < count; i++) {
    const a = stations[i]!, b = stations[i + 1]!;
    const mid = makeStation((a.t + b.t) / 2);
    for (let seg = SILL; seg < CENTRE; seg++) {
      const [part, color, tag] = classify(mid, seg);
      for (const side of [1, -1]) {
        const v0 = vertexOf(part, tag, i, seg, side, color), v1 = vertexOf(part, tag, i + 1, seg, side, color);
        const v2 = vertexOf(part, tag, i + 1, seg + 1, side, color), v3 = vertexOf(part, tag, i, seg + 1, side, color);
        if (side === 1) {
          part.tri(v0, v3, v2);
          part.tri(v0, v2, v1);
        } else {
          part.tri(v0, v2, v3);
          part.tri(v0, v1, v2);
        }
      }
    }
  }

  // ---- underside and wheel wells: long flat panels where the floor is straight, fine ones in the arches and at the ends
  let from = 0;
  for (let i = 1; i <= count; i++) {
    const a = stations[from]!, b = stations[i]!;
    const straight = a.arch === 0 && b.arch === 0 && Math.abs(a.w - WB) < 1e-9 && Math.abs(b.w - WB) < 1e-9 && b.z - a.z < 0.9;
    const next = stations[i + 1];
    if (straight && next && next.arch === 0 && Math.abs(next.w - WB) < 1e-9 && next.z - a.z < 0.9) continue;
    for (let seg = 0; seg < SILL; seg++) {
      for (const side of [1, -1]) {
        const at = (s: Station, k: number): V3 => shaped(s.ring[k]![0] * side, s.ring[k]![1], s.ring[k]![2]);
        detail.quad(at(a, seg), at(b, seg), at(b, seg + 1), at(a, seg + 1), [side * 0.5, -1, 0], UNDER);
      }
    }
    from = i;
  }

  // ---- the two faces: a grid across the last section, swept and leaning like the body
  for (const front of [false, true]) {
    const s = stations[front ? count : 0]!;
    const rows = s.ring.slice(FLOOR + 1);
    const ids: number[][] = rows.map((p) => {
      const row: number[] = [];
      for (let c = -CAP_COLUMNS.length + 1; c < CAP_COLUMNS.length; c++) {
        const u = Math.sign(c) * CAP_COLUMNS[Math.abs(c)]!;
        row.push(paint.vertex(shaped(p[0] * u, p[1], p[2]), WHITE));
      }
      return row;
    });
    for (let r = 0; r < rows.length - 1; r++) {
      for (let c = 0; c < ids[r]!.length - 1; c++) {
        const a = ids[r]![c]!, b = ids[r]![c + 1]!, c2 = ids[r + 1]![c + 1]!, d = ids[r + 1]![c]!;
        if (front) {
          paint.tri(a, b, c2);
          paint.tri(a, c2, d);
        } else {
          paint.tri(a, c2, b);
          paint.tri(a, d, c2);
        }
      }
    }
  }

  // ---- helpers for things fixed to the body
  const stationAt = (t: number): Station => makeStation(clamp01(t));
  /** Half-width of the body side at a height, on a section. */
  const sideX = (s: Station, y: number): number => {
    const r = s.ring;
    for (let k = SILL; k < BELT; k++) {
      const a = r[k]!, b = r[k + 1]!;
      if (y <= b[1] || k === BELT - 1) return b[1] - a[1] < 1e-6 ? Math.max(a[0], b[0]) : lerp(a[0], b[0], clamp01((y - a[1]) / (b[1] - a[1])));
    }
    return s.w;
  };
  /** A straight bar between two points. */
  const beam = (part: Part, a: V3, b: V3, width: number, height: number, color: Rgb): void => {
    const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len = Math.hypot(d[0], d[1], d[2]);
    if (len < 1e-6) return;
    const f: V3 = [d[0] / len, d[1] / len, d[2] / len];
    // Sideways is level and square to the bar; up completes the set.
    let sx = f[2], sz = -f[0];
    const sl = Math.hypot(sx, sz);
    if (sl < 1e-6) {
      sx = 1;
      sz = 0;
    } else {
      sx /= sl;
      sz /= sl;
    }
    const up: V3 = [sz * f[1], sx * f[2] - sz * f[0], -sx * f[1]];
    const ul = Math.hypot(up[0], up[1], up[2]) || 1;
    const u: V3 = [up[0] / ul, up[1] / ul, up[2] / ul];
    const corner = (p: V3, i: number, j: number): V3 => [p[0] + sx * i * width / 2 + u[0] * j * height / 2, p[1] + u[1] * j * height / 2, p[2] + sz * i * width / 2 + u[2] * j * height / 2];
    const A = [corner(a, -1, -1), corner(a, 1, -1), corner(a, 1, 1), corner(a, -1, 1)], B = [corner(b, -1, -1), corner(b, 1, -1), corner(b, 1, 1), corner(b, -1, 1)];
    part.quad(A[0]!, A[1]!, A[2]!, A[3]!, [-f[0], -f[1], -f[2]], color);
    part.quad(B[0]!, B[1]!, B[2]!, B[3]!, f, color);
    part.quad(A[0]!, B[0]!, B[1]!, A[1]!, [-u[0], -u[1], -u[2]], color);
    part.quad(A[3]!, B[3]!, B[2]!, A[2]!, u, color);
    part.quad(A[1]!, B[1]!, B[2]!, A[2]!, [sx, 0, sz], color);
    part.quad(A[0]!, B[0]!, B[3]!, A[3]!, [-sx, 0, -sz], color);
  };

  // ---- front and rear details
  const materialOf = (kind: FaceKind): [Part, Rgb] => {
    switch (kind) {
      case "dark": return [detail, PLASTIC];
      case "mesh": return [detail, GLOSS];
      case "satin": return [detail, SATIN];
      case "paint": return [paint, WHITE];
      case "lamp": return [lamps, HEAD];
      case "amber": return [detail, AMBER];
      case "plate": return [detail, PLATE];
      case "tail": return [brake, WHITE];
      case "lens": return [detail, LENS];
      case "reflector": return [detail, REFLECTOR];
    }
  };
  const headlamps: V3[] = [];
  const dress = (front: boolean, face: FaceSpec): void => {
    const end = stations[front ? count : 0]!;
    const range = front ? rangeF : rangeR;
    const dir = front ? 1 : -1;
    const yOf = (v: number): number => lerp(range.low, range.high, v);
    const point = (u: number, v: number, proud: number): V3 => {
      const y = yOf(v);
      const p = shaped(u * (sideX(end, y) - 0.012), y, end.z);
      return [p[0], p[1], p[2] + dir * proud];
    };
    const vBumper = (range.bumper - range.low) / (range.high - range.low);
    /** A patch between two u values; its bottom and top can differ at each end. */
    const patch = (part: Part, color: Rgb, u0: number, u1: number, v: readonly number[], proud: number): void => {
      const columns = Math.max(1, Math.ceil((Math.abs(u1 - u0) * W) / 0.11));
      for (let c = 0; c < columns; c++) {
        const k0 = c / columns, k1 = (c + 1) / columns;
        const ua = lerp(u0, u1, k0), ub = lerp(u0, u1, k1);
        const lowA = lerp(v[0]!, v[2] ?? v[0]!, k0), highA = lerp(v[1]!, v[3] ?? v[1]!, k0);
        const lowB = lerp(v[0]!, v[2] ?? v[0]!, k1), highB = lerp(v[1]!, v[3] ?? v[1]!, k1);
        // The face changes slope at the bumper line, so a patch crossing it is made in two pieces.
        const cuts = lowA < vBumper - 0.01 && highA > vBumper + 0.01 && lowB < vBumper - 0.01 && highB > vBumper + 0.01 ? [0, 1, 2] : [0, 2];
        for (let r = 0; r < cuts.length - 1; r++) {
          const va = (cut: number, low: number, high: number): number => (cut === 0 ? low : cut === 2 ? high : vBumper);
          part.quad(point(ua, va(cuts[r]!, lowA, highA), proud), point(ub, va(cuts[r]!, lowB, highB), proud), point(ub, va(cuts[r + 1]!, lowB, highB), proud), point(ua, va(cuts[r + 1]!, lowA, highA), proud), [0, 0, dir], color);
        }
      }
    };
    const draw = (item: FaceItem, flip: number): void => {
      const [part, color] = materialOf(item.kind);
      const proud = item.proud ?? 0.006;
      const u0 = item.u[0] * flip, u1 = item.u[1] * flip;
      if (item.round) {
        const cu = (u0 + u1) / 2, cv = (item.v[0] + item.v[1]) / 2;
        const centre = point(cu, cv, proud + 0.012);
        const n = 14;
        const rim = (r: number, k: number, lift: number): V3 => {
          const a = (k / n) * Math.PI * 2;
          const base = point(cu, cv, proud + lift);
          return [base[0] + Math.cos(a) * r, base[1] + Math.sin(a) * r, base[2]];
        };
        const c = part.vertex(centre, color);
        const lens = Array.from({ length: n }, (_, k) => part.vertex(rim(item.round!, k, 0.004), color));
        for (let k = 0; k < n; k++) {
          const a = lens[k]!, b = lens[(k + 1) % n]!;
          if (front) part.tri(c, a, b);
          else part.tri(c, b, a);
        }
        for (let k = 0; k < n; k++) detail.quad(rim(item.round, k, 0.004), rim(item.round, k + 1, 0.004), rim(item.round + 0.018, k + 1, -0.004), rim(item.round + 0.018, k, -0.004), [0, 0, dir], SATIN);
        if (item.kind === "lamp") headlamps.push([centre[0], centre[1], centre[2]]);
        return;
      }
      if (item.slots) {
        const pitch = (u1 - u0) / item.slots;
        for (let k = 0; k < item.slots; k++) patch(part, color, u0 + pitch * (k + 0.2), u0 + pitch * (k + 0.8), item.v, proud);
        return;
      }
      const tall = Math.abs(item.v[1] - item.v[0]) * (range.high - range.low) > 0.075;
      if (item.kind === "lamp" && tall) {
        // A dark housing with the bright reflector set inside it.
        const inset = (a: number, b: number, k: number): number => lerp(a, b, k);
        const v2 = item.v[2] ?? item.v[0], v3 = item.v[3] ?? item.v[1];
        patch(detail, GLOSS, u0, u1, item.v, proud);
        patch(detail, LENS, inset(u0, u1, 0.06), inset(u0, u1, 0.94), [inset(item.v[0], item.v[1], 0.12), inset(item.v[0], item.v[1], 0.88), inset(v2, v3, 0.12), inset(v2, v3, 0.88)], proud + 0.004);
        patch(part, color, inset(u0, u1, 0.14), inset(u0, u1, 0.62), [inset(item.v[0], item.v[1], 0.24), inset(item.v[0], item.v[1], 0.76), inset(v2, v3, 0.24), inset(v2, v3, 0.76)], proud + 0.008);
        patch(detail, AMBER, inset(u0, u1, 0.7), inset(u0, u1, 0.9), [inset(item.v[0], item.v[1], 0.24), inset(item.v[0], item.v[1], 0.76), inset(v2, v3, 0.24), inset(v2, v3, 0.76)], proud + 0.008);
      } else patch(part, color, u0, u1, item.v, proud);
      if (item.bars) {
        const [barPart, barColor] = materialOf(item.barKind ?? "satin");
        for (let k = 0; k < item.bars; k++) {
          const at = (low: number, high: number): [number, number] => {
            const c = lerp(low, high, (k + 0.5) / item.bars!), h = ((high - low) / item.bars!) * 0.2;
            return [c - h, c + h];
          };
          const inner = at(item.v[0], item.v[1]), outer = at(item.v[2] ?? item.v[0], item.v[3] ?? item.v[1]);
          patch(barPart, barColor, lerp(u0, u1, 0.02), lerp(u0, u1, 0.98), [...inner, ...outer], proud + 0.007);
        }
      }
      if (item.kind === "lamp" && front && headlamps.length < 2 && item.mirror) {
        const p = point((u0 + u1) / 2, (item.v[0] + item.v[1] + (item.v[2] ?? item.v[0]) + (item.v[3] ?? item.v[1])) / 4, 0.05);
        headlamps.push(p);
      }
    };
    for (const item of face.items) {
      draw(item, 1);
      if (item.mirror) draw(item, -1);
    }
  };
  // Beams come from the main lamps, which are listed last on each front.
  dress(true, { ...spec.front, items: [...spec.front.items].reverse() });
  headlamps.splice(2);
  headlamps.sort((a, b) => b[0] - a[0]);
  dress(false, spec.rear);

  // ---- high-level stop lamp, on a lip over the rear glass
  const stop = stationAt(spec.rearGlass[1] + m(0.03));
  const lip = shaped(0, stop.top - 0.004, stop.z);
  paint.box(0, lip[1] + 0.004, lip[2], Math.min(1.1, stop.ring[ROOF_EDGE]![0] * 1.5), 0.022, 0.1, WHITE);
  brake.box(0, lip[1] - 0.002, lip[2] - 0.055, 0.26, 0.02, 0.02, WHITE);

  // ---- sides: handles, mirrors, arch trim, steps, rails
  const lines = [...spec.doorLines].sort((a, b) => a - b);
  for (const side of [1, -1]) {
    for (let d = 0; d < lines.length - 1; d++) {
      const s = stationAt(lines[d]! + m(0.13));
      const y = s.belt - 0.105;
      const x = side * (sideX(s, y) + 0.011);
      paint.box(x, y, s.z, 0.026, 0.03, 0.17, WHITE);
      detail.box(x - side * 0.008, y - 0.004, s.z, 0.012, 0.05, 0.2, GLOSS);
    }
    // Door mirror: a black foot on the door, a painted shell, and the glass facing back.
    const ms = stationAt(spec.windshield[1] - m(0.16));
    const mx = side * 0.962 * ms.w, my = ms.belt + 0.075;
    beam(detail, [mx - side * 0.01, my - 0.035, ms.z], [mx + side * 0.07, my - 0.01, ms.z], 0.05, 0.035, GLOSS);
    paint.box(mx + side * 0.125, my, ms.z + 0.01, 0.145, 0.09, 0.045, WHITE);
    paint.box(mx + side * 0.12, my, ms.z + 0.04, 0.105, 0.06, 0.025, WHITE);
    detail.box(mx + side * 0.125, my, ms.z - 0.014, 0.13, 0.075, 0.004, LENS);

    if (spec.cladding) {
      for (const axle of [frontAxle, rearAxle]) {
        const steps = 16;
        const x = side * (planWidth(axle) + spec.flare + 0.004);
        const thick = 0.05 + spec.flare * 0.5;
        for (let k = 0; k < steps; k++) {
          const a0 = (Math.PI * k) / steps, a1 = (Math.PI * (k + 1)) / steps;
          const pt = (a: number, r: number, inset: number): V3 => [x - side * inset, R + Math.sin(a) * r, axle + Math.cos(a) * r];
          detail.quad(pt(a0, archR - 0.004, 0), pt(a1, archR - 0.004, 0), pt(a1, archR + thick, 0), pt(a0, archR + thick, 0), [side, 0, 0], PLASTIC);
          // The outer edge of the trim turns back to the body.
          detail.quad(pt(a0, archR + thick, 0), pt(a1, archR + thick, 0), pt(a1, archR + thick + 0.012, spec.flare * 0.6 + 0.006), pt(a0, archR + thick + 0.012, spec.flare * 0.6 + 0.006), [side * 0.5, Math.sin((a0 + a1) / 2), Math.cos((a0 + a1) / 2)], PLASTIC);
        }
      }
    }
    if (spec.sideSteps) {
      const y = spec.clearance + 0.035, x = side * (WB + 0.045);
      beam(detail, [x, y, rearAxle + archR + 0.06], [x, y, frontAxle - archR - 0.06], 0.13, 0.035, PLASTIC);
      beam(detail, [x + side * 0.03, y + 0.02, rearAxle + archR + 0.08], [x + side * 0.03, y + 0.02, frontAxle - archR - 0.08], 0.05, 0.012, SATIN);
    }
    if (spec.roofRails) {
      const t0 = spec.sideWindows[0] + m(0.12), t1 = spec.windshield[0] - m(0.05);
      const pieces = 5;
      const railAt = (t: number, lift: number): V3 => {
        const s = stationAt(t);
        const p = s.ring[ROOF_EDGE]!;
        return shaped(side * (p[0] - 0.035), p[1] + lift, p[2]);
      };
      for (let k = 0; k < pieces; k++) beam(detail, railAt(lerp(t0, t1, k / pieces), 0.05), railAt(lerp(t0, t1, (k + 1) / pieces), 0.05), 0.032, 0.026, SATIN);
      for (const t of [t0, (t0 + t1) / 2, t1]) beam(detail, railAt(t, 0.0), railAt(t, 0.05), 0.03, 0.07, PLASTIC);
    }
    // Wiper: an arm lying on the glass above the cowl.
    const wa = stationAt(spec.windshield[1] - m(0.015)), wb = stationAt(spec.windshield[1] - m(0.2));
    const wx = side > 0 ? 0.12 : -0.42;
    const onGlass = (s: Station, x: number): V3 => shaped(x, s.top + 0.03, s.z);
    beam(detail, onGlass(wa, wx), onGlass(wb, wx + 0.36), 0.022, 0.012, GLOSS);
  }
  // Aerial fin on the roof.
  const fin = stationAt(spec.rearGlass[1] + m(0.22));
  beam(detail, shaped(0, fin.top + 0.008, fin.z + 0.07), shaped(0, fin.top + 0.026, fin.z - 0.05), 0.035, 0.034, GLOSS);

  // ---- spare wheel on the tailgate
  if (spec.spare) {
    const spare = buildWheel(R * 0.97, spec.tyreWidth, spec.spokes, spec.wheelStyle);
    const cy = lerp(rangeR.low, rangeR.high, 0.66), cz = -L / 2 + spec.tyreWidth / 2 + 0.004;
    const base = detail.positions.length / 3;
    for (let i = 0; i < spare.positions.length; i += 3) {
      // The wheel's axle (x) becomes the car's length; its outer face looks back.
      detail.positions.push(spare.positions[i + 2]!, spare.positions[i + 1]! + cy, -spare.positions[i]! + cz);
      detail.normals.push(0, 0, 0);
      detail.colors.push(spare.colors[(i / 3) * 4]!, spare.colors[(i / 3) * 4 + 1]!, spare.colors[(i / 3) * 4 + 2]!, 1);
    }
    for (let i = 0; i < spare.indices.length; i += 3) detail.tri(base + spare.indices[i]!, base + spare.indices[i + 2]!, base + spare.indices[i + 1]!);
    detail.box(0, cy, z0 - 0.025, 0.2, 0.2, 0.06, PLASTIC);
  }

  // ---- interior: a dark tub with seats, seen dimly through tinted glass
  const cabinRear = stationAt(spec.rearGlass[1] + m(0.05)), cabinFront = stationAt(spec.windshield[1] - m(0.05));
  const tubTop = Math.min(cabinRear.belt, cabinFront.belt) - 0.04;
  const tubLow = spec.clearance + 0.1;
  detail.box(0, (tubLow + tubTop) / 2, (cabinRear.z + cabinFront.z) / 2, WB * 1.8, tubTop - tubLow, cabinFront.z - cabinRear.z, INTERIOR);
  const rows = lines.length > 2 ? [0.4, 0.72] : [0.42, 0.78];
  for (const row of rows) {
    const z = lerp(cabinRear.z, cabinFront.z, 1 - row);
    const frontRow = row < 0.5;
    for (const x of frontRow ? [-0.37, 0.37] : [0]) {
      detail.box(x, tubTop + 0.05, z, frontRow ? 0.46 : 1.15, 0.2, 0.1, INTERIOR);
    }
  }
  detail.box(0, tubTop + 0.03, cabinFront.z - 0.2, WB * 1.74, 0.1, 0.4, INTERIOR);

  for (const part of [paint, glass, detail, lamps, brake]) part.finish();

  const wheelX = W - 0.012 - spec.tyreWidth / 2;
  return {
    paint, glass, detail, lamps, brake,
    wheel: buildWheel(R, spec.tyreWidth, spec.spokes, spec.wheelStyle),
    wheelCentres: [[wheelX, R, frontAxle], [-wheelX, R, frontAxle], [wheelX, R, rearAxle], [-wheelX, R, rearAxle]],
    headlamps,
  };
}

/**
 * A wheel: a tyre with a rounded shoulder and bulging sidewall, a rim with a
 * lip and a deep barrel, a brake disc behind, and spokes with thickness.
 * The axle is the X axis; +X is the outside.
 */
export function buildWheel(radius: number, width: number, spokes: number, style: WheelStyle = "spoke"): Part {
  const part = new Part();
  const segments = 20;
  const rim = radius * (style === "steel" ? 0.6 : 0.69);
  const h = width / 2;
  const face = style === "steel" ? GUNMETAL : ALLOY;
  const ring = (x: number, r: number, c: Rgb): number[] => {
    const ids: number[] = [];
    for (let s = 0; s <= segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      ids.push(part.vertex([x, Math.cos(a) * r, Math.sin(a) * r], c));
    }
    return ids;
  };
  /** Joins two rings. `axial` 0 means the surface faces away from the wheel centre; +1 or -1 means along the axle. */
  const join = (a: number[], b: number[], axial = 0): void => {
    const p = part.positions;
    const i = a[0]! * 3, j = a[1]! * 3, k = b[1]! * 3;
    const ux = p[j]! - p[i]!, uy = p[j + 1]! - p[i + 1]!, uz = p[j + 2]! - p[i + 2]!;
    const vx = p[k]! - p[i]!, vy = p[k + 1]! - p[i + 1]!, vz = p[k + 2]! - p[i + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const mx = (p[i]! + p[k]!) / 2, my = (p[i + 1]! + p[k + 1]!) / 2, mz = (p[i + 2]! + p[k + 2]!) / 2;
    const facing = axial !== 0 ? nx * axial : nx * mx + ny * my + nz * mz;
    for (let s = 0; s < segments; s++) {
      if (facing >= 0) {
        part.tri(a[s]!, a[s + 1]!, b[s + 1]!);
        part.tri(a[s]!, b[s + 1]!, b[s]!);
      } else {
        part.tri(a[s]!, b[s + 1]!, a[s + 1]!);
        part.tri(a[s]!, b[s]!, b[s + 1]!);
      }
    }
  };
  // Tyre: inner bead, sidewall bulge, shoulder, tread, shoulder, sidewall, outer bead.
  const mid = (rim + radius) / 2;
  const tyre: Array<[number, number]> = [[-h + 0.012, rim], [-h + 0.01, radius - 0.03], [-h + 0.045, radius], [h - 0.045, radius], [h - 0.018, radius - 0.02], [h, mid], [h - 0.012, rim]];
  let previous = ring(tyre[0]![0], tyre[0]![1], RUBBER);
  for (let i = 1; i < tyre.length; i++) {
    const next = ring(tyre[i]![0], tyre[i]![1], RUBBER);
    join(previous, next);
    previous = next;
  }
  // Rim: a bright lip, then a barrel running back to the brake disc.
  const depth = Math.min(0.075, width * 0.36);
  join(ring(h - 0.012, rim, face), ring(h - 0.008, rim - 0.022, face), 1);
  join(ring(h - 0.008, rim - 0.022, GUNMETAL), ring(h - depth, rim - 0.03, UNDER), 1);
  join(ring(h - depth, rim - 0.03, DISC), ring(h - depth, 0.001, DISC), 1);
  join(ring(-h + 0.012, 0.001, UNDER), ring(-h + 0.012, rim, UNDER), -1);

  // Spokes: a face and two flanks each, from the hub out to the rim.
  const front = h - 0.018, back = h - depth + 0.006;
  const outer = rim - 0.02, hubR = rim * 0.2;
  const spoke = (angle: number, halfIn: number, halfOut: number, lean: number): void => {
    const c = Math.cos(angle), s = Math.sin(angle);
    const p = (x: number, r: number, side: number): V3 => [x, c * r - s * side, s * r + c * side];
    const a = p(front, hubR, -halfIn), b = p(front - lean, outer, -halfOut), cc = p(front - lean, outer, halfOut), d = p(front, hubR, halfIn);
    part.quad(a, b, cc, d, [1, 0, 0], face);
    const flank = style === "steel" ? GUNMETAL : DISC;
    part.quad(a, b, p(back, outer, -halfOut * 1.15), p(back, hubR, -halfIn * 1.15), [0, s, -c], flank);
    part.quad(d, cc, p(back, outer, halfOut * 1.15), p(back, hubR, halfIn * 1.15), [0, -s, c], flank);
  };
  const pitch = (Math.PI * 2) / spokes;
  const arc = outer * Math.sin(pitch / 2);
  for (let k = 0; k < spokes; k++) {
    const a = k * pitch;
    if (style === "split") {
      for (const twin of [-1, 1]) spoke(a + twin * pitch * 0.17, arc * 0.1, arc * 0.13, 0.012);
    } else if (style === "steel") spoke(a, arc * 0.5, arc * 0.62, 0.004);
    else if (style === "turbine") spoke(a + 0.12, arc * 0.2, arc * 0.34, 0.01);
    else spoke(a, arc * 0.26, arc * 0.2, 0.014);
  }
  // Hub: a raised cap with a darker ring of wheel nuts around it.
  join(ring(front, hubR * 1.25, face), ring(front + 0.007, hubR * 0.8, face), 1);
  join(ring(front + 0.007, hubR * 0.8, GUNMETAL), ring(front + 0.011, 0.001, GUNMETAL), 1);
  part.finish();
  return part;
}
