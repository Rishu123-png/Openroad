import { Mesh } from "@babylonjs/core/Meshes/mesh";
import earcut from "earcut";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
import { hash2, valueNoise } from "../../utils/random";

export type Vec3 = readonly [number, number, number];
export type Color = readonly [number, number, number];

export const WHITE: Color = [1, 1, 1];

export interface BoxOptions {
  /** Rotation about the vertical axis, in radians. */
  yaw?: number;
  color?: Color;
  /** Colour of the top face, when it differs from the sides. */
  topColor?: Color;
  top?: boolean;
  bottom?: boolean;
  sides?: boolean;
}

/**
 * Accumulates triangles for one mesh. Shapes are added in world space, in
 * metres, with texture coordinates also in metres, so a material decides how
 * large its texture is with a single scale value.
 *
 * Many small shapes become one mesh and one draw call.
 */
export class GeometryBuffer {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly uvs: number[] = [];
  readonly colors: number[] = [];
  readonly indices: number[] = [];

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  get isEmpty(): boolean {
    return this.indices.length === 0;
  }

  private vertex(p: Vec3, n: Vec3, u: number, v: number, c: Color): number {
    this.positions.push(p[0], p[1], p[2]);
    this.normals.push(n[0], n[1], n[2]);
    this.uvs.push(u, v);
    this.colors.push(c[0], c[1], c[2], 1);
    return this.vertexCount - 1;
  }

  /** Adds a triangle wound so that it faces along `n` (Babylon.js left-handed convention). */
  private triangle(a: number, b: number, c: number, n: Vec3): void {
    const p = this.positions;
    const ax = p[a * 3]!, ay = p[a * 3 + 1]!, az = p[a * 3 + 2]!;
    const ux = p[b * 3]! - ax, uy = p[b * 3 + 1]! - ay, uz = p[b * 3 + 2]! - az;
    const vx = p[c * 3]! - ax, vy = p[c * 3 + 1]! - ay, vz = p[c * 3 + 2]! - az;
    const facing = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2];
    if (facing < 0) this.indices.push(a, b, c);
    else this.indices.push(a, c, b);
  }

  /** A flat four-sided face. Corners go around the face; `uv` gives each corner's texture coordinate. */
  quad(corners: readonly [Vec3, Vec3, Vec3, Vec3], n: Vec3, uv: readonly number[], color: Color = WHITE): void {
    const i = corners.map((p, k) => this.vertex(p, n, uv[k * 2]!, uv[k * 2 + 1]!, color));
    this.triangle(i[0]!, i[1]!, i[2]!, n);
    this.triangle(i[0]!, i[2]!, i[3]!, n);
  }

  /**
   * A horizontal rectangle facing up. With `cell`, it is divided into a grid
   * so that `tint` can vary the colour smoothly across the surface.
   */
  rectY(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    y: number,
    options: { color?: Color; cell?: number; tint?: (x: number, z: number) => Color } = {},
  ): void {
    const up: Vec3 = [0, 1, 0];
    const nx = options.cell ? Math.max(1, Math.round(Math.abs(x1 - x0) / options.cell)) : 1;
    const nz = options.cell ? Math.max(1, Math.round(Math.abs(z1 - z0) / options.cell)) : 1;
    const base = this.vertexCount;
    for (let j = 0; j <= nz; j++) {
      for (let i = 0; i <= nx; i++) {
        const x = x0 + ((x1 - x0) * i) / nx;
        const z = z0 + ((z1 - z0) * j) / nz;
        this.vertex([x, y, z], up, x, z, options.tint ? options.tint(x, z) : (options.color ?? WHITE));
      }
    }
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const a = base + j * (nx + 1) + i;
        const b = a + 1;
        const c = a + nx + 2;
        const d = a + nx + 1;
        this.triangle(a, b, c, up);
        this.triangle(a, c, d, up);
      }
    }
  }

  /**
   * A box standing on height `y0`. `sx` and `sz` are full widths, `sy` the height.
   * Side textures start at the left edge of each face and at the bottom of the box.
   */
  box(cx: number, y0: number, cz: number, sx: number, sy: number, sz: number, options: BoxOptions = {}): void {
    const color = options.color ?? WHITE;
    const cos = Math.cos(options.yaw ?? 0);
    const sin = Math.sin(options.yaw ?? 0);
    const hx = sx / 2;
    const hz = sz / 2;
    const at = (lx: number, y: number, lz: number): Vec3 => [cx + lx * cos + lz * sin, y, cz - lx * sin + lz * cos];
    const dir = (lx: number, lz: number): Vec3 => [lx * cos + lz * sin, 0, -lx * sin + lz * cos];
    const y1 = y0 + sy;

    if (options.sides !== false) {
      // Each side: outward normal, the two bottom corners (left then right, seen from outside) and width.
      const sides: Array<[Vec3, [number, number], [number, number], number]> = [
        [dir(0, -1), [-hx, -hz], [hx, -hz], sx],
        [dir(1, 0), [hx, -hz], [hx, hz], sz],
        [dir(0, 1), [hx, hz], [-hx, hz], sx],
        [dir(-1, 0), [-hx, hz], [-hx, -hz], sz],
      ];
      for (const [n, a, b, width] of sides) {
        this.quad(
          [at(a[0], y0, a[1]), at(b[0], y0, b[1]), at(b[0], y1, b[1]), at(a[0], y1, a[1])],
          n,
          [0, 0, width, 0, width, sy, 0, sy],
          color,
        );
      }
    }
    if (options.top !== false) {
      const c = [at(-hx, y1, -hz), at(hx, y1, -hz), at(hx, y1, hz), at(-hx, y1, hz)] as const;
      this.quad(c, [0, 1, 0], c.flatMap((p) => [p[0], p[2]]), options.topColor ?? color);
    }
    if (options.bottom) {
      const c = [at(-hx, y0, -hz), at(hx, y0, -hz), at(hx, y0, hz), at(-hx, y0, hz)] as const;
      this.quad(c, [0, -1, 0], c.flatMap((p) => [p[0], p[2]]), color);
    }
  }

  /** A square beam between two points, for arms, rails and brackets. */
  beam(from: Vec3, to: Vec3, thickness: number, color: Color = WHITE): void {
    const d: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
    const length = Math.hypot(d[0], d[1], d[2]);
    if (length === 0) return;
    const f: Vec3 = [d[0] / length, d[1] / length, d[2] / length];
    // Any vector not parallel to the beam gives a usable sideways axis.
    const ref: Vec3 = Math.abs(f[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const r = unit(cross(ref, f));
    const u = cross(f, r);
    const h = thickness / 2;
    const corner = (base: Vec3, a: number, b: number): Vec3 => [
      base[0] + r[0] * a * h + u[0] * b * h,
      base[1] + r[1] * a * h + u[1] * b * h,
      base[2] + r[2] * a * h + u[2] * b * h,
    ];
    const ring: Array<[number, number]> = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let i = 0; i < 4; i++) {
      const a = ring[i]!;
      const b = ring[(i + 1) % 4]!;
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      const n: Vec3 = [r[0] * mx + u[0] * my, r[1] * mx + u[1] * my, r[2] * mx + u[2] * my];
      this.quad(
        [corner(from, a[0], a[1]), corner(from, b[0], b[1]), corner(to, b[0], b[1]), corner(to, a[0], a[1])],
        n,
        [0, 0, thickness, 0, thickness, length, 0, length],
        color,
      );
    }
    for (const [base, n] of [[from, [-f[0], -f[1], -f[2]]], [to, f]] as Array<[Vec3, Vec3]>) {
      this.quad(
        [corner(base, -1, -1), corner(base, 1, -1), corner(base, 1, 1), corner(base, -1, 1)],
        n,
        [0, 0, thickness, 0, thickness, thickness, 0, thickness],
        color,
      );
    }
  }

  /** A vertical cylinder or cone frustum with smooth sides and an optional top cap. */
  cylinder(
    cx: number,
    y0: number,
    cz: number,
    height: number,
    r0: number,
    r1: number,
    segments: number,
    color: Color = WHITE,
    options: { cap?: boolean; topColor?: Color; lean?: readonly [number, number] } = {},
  ): void {
    const y1 = y0 + height;
    const tx = cx + (options.lean?.[0] ?? 0);
    const tz = cz + (options.lean?.[1] ?? 0);
    const base = this.vertexCount;
    const topColor = options.topColor ?? color;
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const u = (i / segments) * Math.PI * 2 * Math.max(r0, r1);
      this.vertex([cx + c * r0, y0, cz + s * r0], [c, 0, s], u, 0, color);
      this.vertex([tx + c * r1, y1, tz + s * r1], [c, 0, s], u, height, topColor);
    }
    for (let i = 0; i < segments; i++) {
      const a = base + i * 2;
      const mid = ((i + 0.5) / segments) * Math.PI * 2;
      const n: Vec3 = [Math.cos(mid), 0, Math.sin(mid)];
      this.triangle(a, a + 2, a + 3, n);
      this.triangle(a, a + 3, a + 1, n);
    }
    if (options.cap !== false && r1 > 0) {
      const centre = this.vertex([tx, y1, tz], [0, 1, 0], tx, tz, topColor);
      const ring = this.vertexCount;
      for (let i = 0; i <= segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        const x = tx + Math.cos(a) * r1;
        const z = tz + Math.sin(a) * r1;
        this.vertex([x, y1, z], [0, 1, 0], x, z, topColor);
      }
      for (let i = 0; i < segments; i++) this.triangle(centre, ring + i, ring + i + 1, [0, 1, 0]);
    }
  }

  /**
   * An irregular rounded mass, used for tree crowns and shrubs: an ellipsoid
   * whose surface is pushed in and out by noise. `colorAt` receives the height
   * within the blob (0 bottom, 1 top) and a noise value (0..1).
   */
  blob(
    cx: number,
    cy: number,
    cz: number,
    rx: number,
    ry: number,
    rz: number,
    seed: number,
    colorAt: (height: number, noise: number) => Color,
    detail = 1,
  ): void {
    const rings = Math.max(4, Math.round(7 * detail));
    const segments = Math.max(6, Math.round(10 * detail));
    const base = this.vertexCount;
    for (let j = 0; j <= rings; j++) {
      const theta = (j / rings) * Math.PI;
      const st = Math.sin(theta);
      const ct = Math.cos(theta);
      for (let i = 0; i <= segments; i++) {
        const phi = (i / segments) * Math.PI * 2;
        const dx = Math.cos(phi) * st;
        const dz = Math.sin(phi) * st;
        // Coarse lumps plus fine roughness. The seam and both poles share
        // values so the surface stays closed.
        const pole = j === 0 || j === rings;
        const wrapI = pole ? 0 : i % segments;
        const lump = valueNoise(wrapI * 0.9 + seed, j * 0.9, seed, 0);
        const fine = pole ? 0.5 : hash2(wrapI, j, seed);
        const k = 0.78 + lump * 0.34 + fine * 0.1;
        const nl = Math.hypot(dx / rx, ct / ry, dz / rz) || 1;
        this.vertex(
          [cx + dx * rx * k, cy + ct * ry * k, cz + dz * rz * k],
          [dx / rx / nl, ct / ry / nl, dz / rz / nl],
          (i / segments) * Math.PI * 2 * rx,
          (j / rings) * Math.PI * ry,
          colorAt((ct + 1) / 2, fine),
        );
      }
    }
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < segments; i++) {
        const a = base + j * (segments + 1) + i;
        const b = a + 1;
        const c = a + segments + 2;
        const d = a + segments + 1;
        const theta = ((j + 0.5) / rings) * Math.PI;
        const phi = ((i + 0.5) / segments) * Math.PI * 2;
        const n: Vec3 = [Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta)];
        // At the poles one of the two triangles has no area.
        if (j > 0) this.triangle(a, b, c, n);
        if (j < rings - 1) this.triangle(a, c, d, n);
      }
    }
  }

  /** A flat disc facing a horizontal direction, textured from a rectangle of an atlas. */
  disc(centre: Vec3, yaw: number, radius: number, uv: readonly [number, number, number, number], segments = 20): void {
    const n: Vec3 = [Math.sin(yaw), 0, Math.cos(yaw)];
    const right: Vec3 = [Math.cos(yaw), 0, -Math.sin(yaw)];
    const point = (a: number, r: number): [Vec3, number, number] => {
      const c = Math.cos(a) * r;
      const s = Math.sin(a) * r;
      const u = uv[0] + (0.5 - Math.cos(a) * 0.5 * (r / radius)) * (uv[2] - uv[0]);
      const v = uv[1] + (0.5 - Math.sin(a) * 0.5 * (r / radius)) * (uv[3] - uv[1]);
      return [[centre[0] + right[0] * c, centre[1] + s, centre[2] + right[2] * c], u, v];
    };
    const [p0, u0, v0] = point(0, 0);
    const mid = this.vertex(p0, n, u0, v0, WHITE);
    const ring = this.vertexCount;
    for (let i = 0; i <= segments; i++) {
      const [p, u, v] = point((i / segments) * Math.PI * 2, radius);
      this.vertex(p, n, u, v, WHITE);
    }
    for (let i = 0; i < segments; i++) this.triangle(mid, ring + i, ring + i + 1, n);
  }

  /**
   * A flat polygon facing up, with optional holes. Rings are lists of [x, z]
   * points in metres; a repeated closing point is ignored. The outline is
   * triangulated as given, so its shape is kept exactly.
   */
  polygonY(outer: ReadonlyArray<readonly number[]>, holes: ReadonlyArray<ReadonlyArray<readonly number[]>>, y: number, color: Color = WHITE): void {
    const flat: number[] = [];
    const holeStarts: number[] = [];
    const push = (ring: ReadonlyArray<readonly number[]>): void => {
      const last = ring.length - 1;
      const closed = last > 0 && ring[0]![0] === ring[last]![0] && ring[0]![1] === ring[last]![1];
      for (let i = 0; i < (closed ? last : ring.length); i++) flat.push(ring[i]![0]!, ring[i]![1]!);
    };
    push(outer);
    for (const hole of holes) {
      holeStarts.push(flat.length / 2);
      push(hole);
    }
    const triangles = earcut(flat, holeStarts, 2);
    const up: Vec3 = [0, 1, 0];
    const base = this.vertexCount;
    for (let i = 0; i < flat.length; i += 2) this.vertex([flat[i]!, y, flat[i + 1]!], up, flat[i]!, flat[i + 1]!, color);
    for (let i = 0; i < triangles.length; i += 3) this.triangle(base + triangles[i]!, base + triangles[i + 1]!, base + triangles[i + 2]!, up);
  }

  /** A vertical wall between two ground points, facing along (nx, nz). Texture runs along the wall in metres from `u0`. */
  wall(ax: number, az: number, bx: number, bz: number, y0: number, y1: number, nx: number, nz: number, color: Color = WHITE, u0 = 0): void {
    const u1 = u0 + Math.hypot(bx - ax, bz - az);
    this.quad([[ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az]], [nx, 0, nz], [u0, y0, u1, y0, u1, y1, u0, y1], color);
  }

  /** A vertical wall with explicit texture coordinates, so a facade pattern can be fitted to it. */
  wallUV(ax: number, az: number, bx: number, bz: number, y0: number, y1: number, nx: number, nz: number, color: Color, u0: number, u1: number, v0: number, v1: number): void {
    this.quad([[ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az]], [nx, 0, nz], [u0, v0, u1, v0, u1, v1, u0, v1], color);
  }

  /** Creates the mesh. The buffer can be discarded afterwards. */
  toMesh(name: string, scene: Scene): Mesh {
    const mesh = new Mesh(name, scene);
    const data = new VertexData();
    data.positions = this.positions;
    data.normals = this.normals;
    data.uvs = this.uvs;
    data.colors = this.colors;
    data.indices = this.indices;
    data.applyToMesh(mesh);
    mesh.isPickable = false;
    mesh.hasVertexAlpha = false;
    return mesh;
  }
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function unit(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
