import { profileAt, type CarSpec } from "./carSpecs";

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
    if (nx * nx + ny * ny + nz * nz < 1e-18) return;
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
  /** Tyres' surroundings: trim, cladding, grille, interior, plates. */
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
const PLASTIC: Rgb = [0.035, 0.035, 0.04];
const RUBBER: Rgb = [0.02, 0.02, 0.022];
const ALLOY: Rgb = [0.6, 0.61, 0.63];
const CHROME: Rgb = [0.5, 0.5, 0.52];
const INTERIOR: Rgb = [0.05, 0.048, 0.045];
const PLATE: Rgb = [0.85, 0.85, 0.82];
const HEAD: Rgb = [1, 0.97, 0.9];
const AMBER: Rgb = [0.9, 0.42, 0.04];
const RED: Rgb = [1, 1, 1]; // brake material supplies the red

const STATION = 0.04;
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/**
 * Builds a vehicle body by lofting a cross-section along its length.
 *
 * The section has nine points per side, from the centre of the floor round
 * the sill, flank and shoulder to the centre of the roof. Its heights come
 * from the side profile, its widths from a plan-view taper, and the flanks
 * are lifted over each axle to form open wheel arches. Each panel between two
 * points goes to the painted, glazed or trim part according to where it is.
 */
export function buildCarGeometry(spec: CarSpec): CarGeometry {
  const paint = new Part(), glass = new Part(), detail = new Part(), lamps = new Part(), brake = new Part();
  const L = spec.length, W = spec.width / 2, R = spec.wheelRadius;
  const frontAxle = L / 2 - spec.frontOverhang, rearAxle = frontAxle - spec.wheelbase;
  const archR = R + 0.075;
  const zAt = (t: number): number => -L / 2 + t * L;

  const planWidth = (t: number): number => {
    // Rounded corners at both ends, full width between.
    const end = t < 0.5 ? t / 0.12 : (1 - t) / 0.13;
    const k = clamp01(end);
    return W * (t < 0.5 ? lerp(0.8, 1, Math.sqrt(k * (2 - k))) : lerp(0.74, 1, Math.sqrt(k * (2 - k))));
  };
  const floorAt = (t: number): number => spec.clearance + 0.13 * Math.pow(clamp01(t < 0.5 ? 1 - t / 0.07 : 1 - (1 - t) / 0.07), 2);
  const archAt = (z: number): number => {
    for (const axle of [frontAxle, rearAxle]) {
      const d = Math.abs(z - axle);
      if (d < archR) return R + Math.sqrt(archR * archR - d * d);
    }
    return 0;
  };

  interface Station { t: number; z: number; ring: V3[]; top: number; belt: number; roofW: number; w: number }
  const count = Math.round(L / STATION);
  const stations: Station[] = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count, z = zAt(t);
    const w = planWidth(t), f = floorAt(t);
    const top = profileAt(spec.top, t);
    const belt = Math.min(profileAt(spec.belt, t), top - 0.035);
    const cabin = clamp01((top - belt) / 0.45);
    const roofW = Math.max(0.2, w - 0.02 - 0.17 * cabin);
    const arch = archAt(z);
    const lift = (y: number): number => Math.min(Math.max(y, arch), belt - 0.06);
    const ring: V3[] = [
      [0, f, z],
      [w * 0.78, lift(f), z],
      [w * 0.97, lift(f + 0.07), z],
      [w, lift(f + 0.24), z],
      [w, lift(lerp(f, belt, 0.62)), z],
      [w * 0.985, belt, z],
      [roofW + 0.035 * cabin, top - 0.02 - 0.05 * cabin, z],
      [roofW * 0.84, top - 0.006, z],
      [0, top + 0.018 * cabin, z],
    ];
    stations.push({ t, z, ring, top, belt, roofW, w });
  }

  const inRange = (t: number, r: readonly [number, number]): boolean => t >= r[0] && t <= r[1];
  const partFor = (s: Station, seg: number): Part => {
    if (seg === 0) return detail;
    if (seg <= 2) return spec.cladding ? detail : paint;
    if (seg === 5) {
      const tall = s.ring[6]![1] - s.belt > 0.11;
      const pillar = spec.pillars.some((p) => Math.abs(s.t - p) < 0.013);
      return tall && !pillar && inRange(s.t, spec.sideWindows) ? glass : paint;
    }
    if (seg === 7) return inRange(s.t, spec.windshield) || inRange(s.t, spec.rearGlass) ? glass : paint;
    return paint;
  };
  const colourFor = (part: Part, seg: number): Rgb => (part === detail ? (seg === 0 ? RUBBER : PLASTIC) : WHITE);

  // Shared vertices inside each part give smooth panels; a change of part gives a crisp edge.
  const shared = new Map<string, number>();
  const vertexOf = (part: Part, tag: string, i: number, k: number, side: number, color: Rgb): number => {
    const p = stations[i]!.ring[k]!;
    const key = `${tag}:${i}:${k}:${p[0] === 0 ? 0 : side}`;
    let index = shared.get(key);
    if (index === undefined) shared.set(key, (index = part.vertex([p[0] * side, p[1], p[2]], color)));
    return index;
  };
  const tags = new Map<Part, string>([[paint, "p"], [glass, "g"], [detail, "d"]]);
  for (let i = 0; i < count; i++) {
    // Classify by the middle of the panel so zone edges fall on station lines.
    const mid = { ...stations[i]!, t: (stations[i]!.t + stations[i + 1]!.t) / 2 };
    for (let seg = 0; seg < 8; seg++) {
      const part = partFor(mid, seg);
      const color = colourFor(part, seg);
      const tag = `${tags.get(part)}${part === detail ? seg : ""}`;
      for (const side of [1, -1]) {
        const a = vertexOf(part, tag, i, seg, side, color), b = vertexOf(part, tag, i + 1, seg, side, color);
        const c = vertexOf(part, tag, i + 1, seg + 1, side, color), d = vertexOf(part, tag, i, seg + 1, side, color);
        if (side === 1) {
          part.tri(a, d, c);
          part.tri(a, c, b);
        } else {
          part.tri(a, c, d);
          part.tri(a, b, c);
        }
      }
    }
  }

  // Closed ends: a fan over the first and last sections.
  for (const [index, facing] of [[0, -1], [count, 1]] as const) {
    const s = stations[index]!;
    const centre = paint.vertex([0, (s.ring[0]![1] + s.ring[8]![1]) / 2, s.z], WHITE);
    const outline = [...s.ring.map((p): V3 => [p[0], p[1], p[2]]), ...s.ring.slice(1, 8).reverse().map((p): V3 => [-p[0], p[1], p[2]])];
    const ids = outline.map((p) => paint.vertex(p, WHITE));
    for (let k = 0; k < ids.length; k++) {
      const a = ids[k]!, b = ids[(k + 1) % ids.length]!;
      if (facing === 1) paint.tri(centre, a, b);
      else paint.tri(centre, b, a);
    }
  }

  const at = (t: number): Station => stations[Math.round(clamp01(t) * count)]!;
  const front = at(1), rear = at(0);
  const zF = L / 2, zR = -L / 2;

  // ---- front: grille, lower intake, headlamps, indicators, plate
  const noseTop = at(0.985).top;
  detail.box(0, lerp(spec.clearance, noseTop, 0.62), zF + 0.004, front.w * 1.15, (noseTop - spec.clearance) * 0.26, 0.03, PLASTIC);
  detail.box(0, spec.clearance + 0.17, zF + 0.004, front.w * 1.5, 0.12, 0.03, PLASTIC);
  detail.box(0, lerp(spec.clearance, noseTop, 0.36), zF + 0.022, 0.5, 0.11, 0.012, PLATE);
  const headlamps: V3[] = [];
  for (const side of [1, -1]) {
    const lamp = at(0.972);
    const x = side * lamp.w * 0.8, y = lamp.top - 0.115;
    lamps.box(x, y, lamp.z + 0.03, lamp.w * 0.36, 0.085, 0.09, HEAD);
    lamps.box(side * lamp.w * 0.86, y - 0.075, lamp.z + 0.022, lamp.w * 0.2, 0.035, 0.07, AMBER);
    detail.box(side * front.w * 0.92, spec.clearance + 0.2, zF - 0.02, 0.16, 0.07, 0.06, PLASTIC); // fog lamp surround
    headlamps.push([x, y, lamp.z + 0.08]);
  }

  // ---- rear: tail lamps, optional light bar, high stop lamp, plate, bumper insert
  const tail = at(0.022);
  const tailY = Math.min(tail.belt - 0.02, tail.top - 0.12);
  for (const side of [1, -1]) brake.box(side * tail.w * 0.82, tailY, tail.z - 0.03, tail.w * 0.36, 0.11, 0.1, RED);
  if (spec.lightBar) brake.box(0, tailY, zR - 0.006, rear.w * 1.3, 0.03, 0.02, RED);
  const stopT = spec.rearGlass[1];
  brake.box(0, at(stopT).top - 0.035, at(stopT).z - 0.02, 0.26, 0.022, 0.03, RED);
  detail.box(0, tailY - 0.17, zR - 0.012, 0.5, 0.11, 0.012, PLATE);
  detail.box(0, spec.clearance + 0.19, zR - 0.004, rear.w * 1.5, 0.13, 0.03, PLASTIC);

  // ---- sides: door lines, handles, mirrors, arch trim, sill
  for (const side of [1, -1]) {
    for (const t of spec.doorLines) {
      const s = at(t);
      const x = side * (s.w + 0.003);
      detail.quad([x, spec.clearance + 0.26, s.z - 0.006], [x, spec.clearance + 0.26, s.z + 0.006], [x * 0.988, s.belt, s.z + 0.006], [x * 0.988, s.belt, s.z - 0.006], [side, 0, 0], PLASTIC);
    }
    for (let d = 1; d < spec.doorLines.length; d++) {
      const s = at(spec.doorLines[d - 1]! + 0.03);
      paint.box(side * (s.w + 0.012), s.belt - 0.09, s.z, 0.03, 0.028, 0.15, WHITE);
      detail.box(side * (s.w + 0.004), s.belt - 0.09, s.z, 0.012, 0.05, 0.19, PLASTIC);
    }
    const m = at(spec.windshield[1] - 0.035);
    detail.box(side * (m.w + 0.03), m.belt + 0.05, m.z, 0.09, 0.03, 0.05, PLASTIC);
    paint.box(side * (m.w + 0.13), m.belt + 0.08, m.z, 0.15, 0.1, 0.075, WHITE);
    detail.box(side * (m.w + 0.13), m.belt + 0.08, m.z - 0.04, 0.12, 0.075, 0.006, CHROME);
    if (spec.cladding) {
      // Trim following each wheel arch.
      for (const axle of [frontAxle, rearAxle]) {
        const steps = 14;
        for (let k = 0; k < steps; k++) {
          const a0 = (Math.PI * k) / steps, a1 = (Math.PI * (k + 1)) / steps;
          const x = side * (W + 0.006);
          const pt = (a: number, r: number): V3 => [x, R + Math.sin(a) * r, axle + Math.cos(a) * r];
          detail.quad(pt(a0, archR - 0.005), pt(a1, archR - 0.005), pt(a1, archR + 0.055), pt(a0, archR + 0.055), [side, 0, 0], PLASTIC);
        }
      }
    }
    if (spec.roofRails) {
      const a = at(spec.sideWindows[0] + 0.04), b = at(spec.windshield[0] - 0.02);
      detail.box(side * (a.roofW - 0.02), Math.max(a.top, b.top) + 0.035, (a.z + b.z) / 2, 0.035, 0.03, b.z - a.z, CHROME);
      for (const s of [a, b]) detail.box(side * (s.roofW - 0.02), s.top + 0.012, s.z, 0.035, 0.03, 0.06, PLASTIC);
    }
  }

  // ---- interior: a dark tub with seat backs, seen through the glass
  const cabinRear = at(spec.rearGlass[1] + 0.01), cabinFront = at(spec.windshield[1] - 0.01);
  const tubTop = Math.min(cabinRear.belt, cabinFront.belt) - 0.03;
  detail.box(0, (spec.clearance + tubTop) / 2 + 0.1, (cabinRear.z + cabinFront.z) / 2, W * 1.84, tubTop - spec.clearance - 0.2, cabinFront.z - cabinRear.z, INTERIOR);
  for (const row of [0.42, 0.72]) {
    const z = lerp(cabinRear.z, cabinFront.z, 1 - row);
    for (const x of row < 0.5 ? [-0.38, 0.38] : [0]) {
      detail.box(x, tubTop + 0.2, z, row < 0.5 ? 0.46 : 1.2, 0.46, 0.1, INTERIOR);
      if (row < 0.5) detail.box(x, tubTop + 0.5, z, 0.24, 0.16, 0.09, INTERIOR);
    }
  }
  detail.box(0, tubTop + 0.04, cabinFront.z - 0.25, W * 1.8, 0.1, 0.5, INTERIOR); // dashboard

  for (const part of [paint, glass, detail, lamps, brake]) part.finish();

  const wheelX = W - 0.012 - spec.tyreWidth / 2;
  return {
    paint, glass, detail, lamps, brake,
    wheel: buildWheel(R, spec.tyreWidth, spec.spokes),
    wheelCentres: [[wheelX, R, frontAxle], [-wheelX, R, frontAxle], [wheelX, R, rearAxle], [-wheelX, R, rearAxle]],
    headlamps,
  };
}

/** A wheel: tyre with rounded shoulders, a dished rim and spokes. The axle is the X axis; +X is the outside. */
export function buildWheel(radius: number, width: number, spokes: number): Part {
  const part = new Part();
  const segments = 24;
  const rim = radius * 0.66;
  const h = width / 2;
  // Lathe profile: [x, radius, colour].
  const profile: Array<[number, number, Rgb]> = [
    [-h, rim, RUBBER], [-h, radius - 0.035, RUBBER], [-h + 0.035, radius, RUBBER], [h - 0.035, radius, RUBBER], [h, radius - 0.035, RUBBER], [h, rim, RUBBER],
  ];
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
  let previous = ring(...profile[0]!);
  for (let i = 1; i < profile.length; i++) {
    const next = ring(...profile[i]!);
    join(previous, next);
    previous = next;
  }
  // Rim: a lip, a dish and a dark barrel behind the spokes.
  const lip = ring(h, rim, ALLOY), dish = ring(h - 0.012, rim - 0.02, ALLOY), back = ring(h - 0.06, rim - 0.03, RUBBER), hub = ring(h - 0.06, 0.001, RUBBER);
  join(lip, dish, 1);
  join(dish, back, 1);
  join(back, hub, 1);
  const inner = ring(-h, rim, RUBBER), innerHub = ring(-h, 0.001, RUBBER);
  join(innerHub, inner, -1);
  // Spokes and hub cap, slightly behind the lip.
  const face = h - 0.02;
  for (let k = 0; k < spokes; k++) {
    const a = (k / spokes) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    const half = (rim - 0.02) * Math.sin(Math.PI / spokes) * (spokes > 6 ? 0.62 : 0.4);
    const p = (r: number, side: number): V3 => [face, c * r - s * side, s * r + c * side];
    part.quad(p(0.03, -half * 0.5), p(rim - 0.02, -half), p(rim - 0.02, half), p(0.03, half * 0.5), [1, 0, 0], ALLOY);
  }
  const cap = ring(face + 0.004, rim * 0.24, CHROME), capCentre = ring(face + 0.008, 0.001, CHROME);
  join(cap, capCentre, 1);
  part.finish();
  return part;
}
