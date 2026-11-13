import { describe, expect, it } from "vitest";
import { GeometryBuffer } from "../src/game/geometry/GeometryBuffer";
import { asphaltTextures, paverTextures, signAtlas, skyColor, skyCubeFaces } from "../src/game/materials/proceduralTextures";
import { fbm, Random, valueNoise } from "../src/utils/random";

/** For each triangle, the dot product of its geometric normal (Babylon.js winding) with its vertex normal. */
function facing(g: GeometryBuffer): number[] {
  const out: number[] = [];
  const p = g.positions;
  for (let i = 0; i < g.indices.length; i += 3) {
    const [a, b, c] = [g.indices[i]!, g.indices[i + 1]!, g.indices[i + 2]!];
    const u = [p[b * 3]! - p[a * 3]!, p[b * 3 + 1]! - p[a * 3 + 1]!, p[b * 3 + 2]! - p[a * 3 + 2]!];
    const v = [p[c * 3]! - p[a * 3]!, p[c * 3 + 1]! - p[a * 3 + 1]!, p[c * 3 + 2]! - p[a * 3 + 2]!];
    const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    out.push(n[0]! * g.normals[a * 3]! + n[1]! * g.normals[a * 3 + 1]! + n[2]! * g.normals[a * 3 + 2]!);
  }
  return out;
}

describe("GeometryBuffer", () => {
  it("winds every face of a box, beam, cylinder and blob to face outward", () => {
    const g = new GeometryBuffer();
    g.box(3, 0, -2, 2, 4, 6, { yaw: 0.7, bottom: true });
    g.beam([0, 0, 0], [3, 5, -2], 0.2);
    g.cylinder(0, 0, 0, 3, 0.5, 0.3, 8);
    g.blob(0, 5, 0, 2, 1.5, 2, 3, () => [1, 1, 1]);
    g.rectY(-1, -1, 4, 5, 0, { cell: 1 });
    // Babylon.js front faces have a negative value here.
    for (const f of facing(g)) expect(f).toBeLessThan(0);
  });

  it("gives box sides texture coordinates in metres", () => {
    const g = new GeometryBuffer();
    g.box(0, 2, 0, 6, 9.6, 3, { top: false });
    expect(g.vertexCount).toBe(16);
    expect(Math.max(...g.uvs.filter((_, i) => i % 2 === 0))).toBe(6); // widest face
    expect(Math.max(...g.uvs.filter((_, i) => i % 2 === 1))).toBe(9.6); // height
    expect(Math.min(...g.positions.filter((_, i) => i % 3 === 1))).toBe(2); // stands on y0
  });

  it("subdivides a tinted rectangle", () => {
    const g = new GeometryBuffer();
    g.rectY(0, 0, 10, 20, 0, { cell: 5, tint: (x) => [x / 10, 0, 0] });
    expect(g.vertexCount).toBe(3 * 5);
    expect(g.indices.length).toBe(2 * 4 * 6);
    expect(Math.max(...g.colors.filter((_, i) => i % 4 === 0))).toBe(1);
  });
});

describe("procedural textures", () => {
  it("are deterministic, opaque and the requested size", () => {
    const a = asphaltTextures(64);
    const b = asphaltTextures(64);
    expect(a.albedo.width).toBe(64);
    expect(a.albedo.data).toHaveLength(64 * 64 * 4);
    expect(a.albedo.data).toEqual(b.albedo.data);
    expect(a.normal.data[3]).toBe(255);
    // Normal maps point mostly straight out of the surface.
    let blue = 0;
    for (let i = 2; i < a.normal.data.length; i += 4) blue += a.normal.data[i]!;
    expect(blue / (64 * 64)).toBeGreaterThan(170);
  });

  it("keeps asphalt dark and pavers mid-toned", () => {
    const mean = (d: Uint8Array): number => {
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += d[i]! + d[i + 1]! + d[i + 2]!;
      return sum / ((d.length / 4) * 3);
    };
    expect(mean(asphaltTextures(64).albedo.data)).toBeGreaterThan(55);
    expect(mean(asphaltTextures(64).albedo.data)).toBeLessThan(95);
    expect(mean(paverTextures(128).albedo.data)).toBeGreaterThan(80);
  });

  it("draws two different signs", () => {
    const atlas = signAtlas(64);
    expect(atlas.width).toBe(128);
    const centre = (x: number): number[] => Array.from(atlas.data.slice((32 * 128 + x) * 4, (32 * 128 + x) * 4 + 3));
    expect(centre(32)).not.toEqual(centre(96));
  });

  it("makes the sky bluer overhead and lighter at the horizon", () => {
    const up = skyColor(0.3, 0.95, 0.1, false);
    const horizon = skyColor(1, 0.02, 0, false);
    expect(up[2]).toBeGreaterThan(up[0] * 1.5);
    expect(horizon[0]).toBeGreaterThan(up[0]);
    expect(skyCubeFaces(8)).toHaveLength(6);
  });
});

describe("random", () => {
  it("is repeatable and uniform enough", () => {
    const a = new Random(42);
    const b = new Random(42);
    const values = Array.from({ length: 2000 }, () => a.next());
    expect(values.slice(0, 5)).toEqual(Array.from({ length: 5 }, () => b.next()));
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
  });

  it("produces noise that tiles at its period", () => {
    for (const y of [0.3, 2.7]) {
      expect(valueNoise(0.4, y, 9, 4)).toBeCloseTo(valueNoise(4.4, y, 9, 4), 10);
      expect(fbm(0.4, y, 9, 3, 4)).toBeCloseTo(fbm(4.4, y, 9, 3, 4), 10);
    }
  });
});
