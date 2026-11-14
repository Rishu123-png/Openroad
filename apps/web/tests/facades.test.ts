import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import type { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BUILDING_LAYERS, dressBuilding, FACADE_RULES, FACADE_STYLES, usableHeight } from "../src/game/district/buildingGeometry";
import { pointInPolygons, pointInRing } from "../src/game/district/spawn";
import { BUILDING_CATEGORIES, type BuildingCategory, type DistrictBuilding, type Point, type Polygon } from "../src/game/district/types";
import { DistrictGame } from "../src/game/engine/DistrictGame";
import { GeometryBuffer } from "../src/game/geometry/GeometryBuffer";
import type { MaterialKey } from "../src/game/materials/MaterialLibrary";
import { FACADE } from "../src/game/materials/proceduralTextures";
import { COURT_HOLE, COURT_OUTER, L_SHAPE, testDistrict } from "./fixtures/district";
import { distanceToLine, keyboard, meshProblems, nullEngine, triangleAreas } from "./support/harness";

const box = (x: number, z: number, w: number, d: number): Point[] => [[x, z], [x + w, z], [x + w, z + d], [x, z + d], [x, z]];
const U_SHAPE: Point[] = [[0, 0], [40, 0], [40, 30], [28, 30], [28, 10], [12, 10], [12, 30], [0, 30], [0, 0]];

function area(polygons: Polygon[]): number {
  const ring = (r: readonly Point[]): number => {
    let a = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j]![0] * r[i]![1] - r[i]![0] * r[j]![1];
    return Math.abs(a / 2);
  };
  return polygons.reduce((sum, p) => sum + ring(p.outer) - p.holes.reduce((h, r) => h + ring(r), 0), 0);
}

function building(category: BuildingCategory, polygons: Polygon[], height = 16): DistrictBuilding {
  const pts = polygons.flatMap((p) => p.outer);
  const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
  return {
    id: "way/1", osm: { type: "way", id: 1 }, tags: { building: "yes" }, category, categoryRule: "test", height, heightStatus: "estimated", heightBasis: "test",
    polygons, area: area(polygons), centre: [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2], inSector: true, clipped: false, fromRelation: false,
  };
}

function dress(b: DistrictBuilding) {
  const layers = new Map<MaterialKey, GeometryBuffer>();
  const balconies = dressBuilding((key) => layers.get(key) ?? layers.set(key, new GeometryBuffer()).get(key)!, b, [0.8, 0.8, 0.8], [0.6, 0.6, 0.6]);
  return { layers, balconies, used: [...layers.entries()].filter(([, g]) => g.indices.length > 0).map(([k]) => k).sort() };
}

const rings = (b: DistrictBuilding): Point[][] => b.polygons.flatMap((p) => [p.outer, ...p.holes]);
const WALL_LAYERS: MaterialKey[] = ["residential", "generic", "ribbon", "shopfront"];

const SHAPES: Array<[string, Polygon[]]> = [
  ["rectangle", [{ outer: box(0, 0, 30, 18), holes: [] }]],
  ["rectangle wound the other way", [{ outer: [...box(0, 0, 30, 18)].reverse(), holes: [] }]],
  ["L", [{ outer: L_SHAPE, holes: [] }]],
  ["U (concave)", [{ outer: U_SHAPE, holes: [] }]],
  ["courtyard", [{ outer: COURT_OUTER, holes: [COURT_HOLE] }]],
  ["courtyard, hole wound the other way", [{ outer: COURT_OUTER, holes: [[...COURT_HOLE].reverse()] }]],
  ["narrow sliver", [{ outer: box(0, 0, 60, 1.2), holes: [] }]],
  ["triangle", [{ outer: [[0, 0], [25, 0], [10, 20], [0, 0]], holes: [] }]],
  ["repeated corner", [{ outer: [[0, 0], [30, 0], [30, 0], [30, 20], [0, 20], [0, 20], [0, 0]], holes: [] }]],
  ["two parts", [{ outer: box(0, 0, 20, 12), holes: [] }, { outer: box(40, 0, 15, 15), holes: [] }]],
  ["skewed quadrilateral", [{ outer: [[0, 0], [31.7, 4.3], [27.9, 22.1], [-3.2, 17.4], [0, 0]], holes: [] }]],
];

describe("facade geometry", () => {
  it("leaves the source footprint exactly as it was", () => {
    for (const category of BUILDING_CATEGORIES) {
      for (const [name, polygons] of SHAPES) {
        const b = building(category, structuredClone(polygons));
        const before = JSON.stringify(b);
        dress(b);
        expect(JSON.stringify(b), `${category} ${name}`).toBe(before);
      }
    }
  });

  it("stands every wall on a mapped edge, from the ground to the roof, facing outward", () => {
    for (const category of BUILDING_CATEGORIES) {
      for (const [name, polygons] of SHAPES) {
        const b = building(category, polygons);
        const { layers } = dress(b);
        const label = `${category} ${name}`;
        for (const key of WALL_LAYERS) {
          const g = layers.get(key);
          if (!g) continue;
          for (let i = 0; i < g.positions.length; i += 3) {
            const x = g.positions[i]!, y = g.positions[i + 1]!, z = g.positions[i + 2]!;
            // On an outline, not beside it.
            expect(Math.min(...rings(b).map((r) => distanceToLine(x, z, r))), `${label} ${key} wall off the outline`).toBeLessThan(1e-6);
            expect(y).toBeGreaterThanOrEqual(0);
            expect(y).toBeLessThanOrEqual(b.height + 1e-9);
            // Its normal points out of the building: a step along it leaves the footprint (or enters a courtyard).
            const nx = g.normals[i]!, nz = g.normals[i + 2]!;
            expect(Math.abs(g.normals[i + 1]!)).toBeLessThan(1e-6);
            // Tested at the middle of the wall this vertex belongs to, to stay clear of corners.
            const q = i - (((i / 3) % 4) * 3);
            const mx = (g.positions[q]! + g.positions[q + 3]! + g.positions[q + 6]! + g.positions[q + 9]!) / 4, mz = (g.positions[q + 2]! + g.positions[q + 5]! + g.positions[q + 8]! + g.positions[q + 11]!) / 4;
            expect(pointInPolygons(mx + nx * 0.05, mz + nz * 0.05, b.polygons), `${label} ${key} wall faces inward`).toBe(false);
            expect(pointInPolygons(mx - nx * 0.05, mz - nz * 0.05, b.polygons), `${label} ${key} wall faces inward`).toBe(true);
          }
        }
        // Every mapped corner carries a wall from the ground up.
        const ground = new Set<string>();
        for (const g of layers.values()) for (let i = 0; i < g.positions.length; i += 3) if (g.positions[i + 1] === 0) ground.add(`${g.positions[i]},${g.positions[i + 2]}`);
        for (const ring of rings(b)) for (const p of ring) expect(ground.has(`${p[0]},${p[1]}`), `${label} corner ${p.join(",")} has no wall`).toBe(true);
      }
    }
  });

  it("keeps everything it adds within the building: no further out than a balcony, no higher than the parapet", () => {
    const reach = FACADE_RULES.balconyDepth + 0.1;
    for (const category of BUILDING_CATEGORIES) {
      for (const [name, polygons] of SHAPES) {
        const b = building(category, polygons);
        const { layers } = dress(b);
        for (const [key, g] of layers) {
          for (let i = 0; i < g.positions.length; i += 3) {
            const x = g.positions[i]!, y = g.positions[i + 1]!, z = g.positions[i + 2]!;
            const label = `${category} ${name} ${key}`;
            expect(y, label).toBeGreaterThanOrEqual(-1e-9);
            expect(y, label).toBeLessThanOrEqual(b.height + FACADE_RULES.parapetHeight + 1e-9);
            if (pointInPolygons(x, z, b.polygons)) continue;
            // The parapet and everything else at or above the roof stays on or inside the outline: no overhang.
            if (y >= b.height) expect(Math.min(...rings(b).map((r) => distanceToLine(x, z, r))), `${label} overhangs the footprint at the roof`).toBeLessThan(1e-6);
            expect(Math.min(...rings(b).map((r) => distanceToLine(x, z, r))), `${label} sticks out`).toBeLessThanOrEqual(reach);
          }
        }
      }
    }
  });

  it("roofs exactly the footprint and leaves courtyards open to the sky", () => {
    for (const [name, polygons] of SHAPES) {
      const b = building("apartments", polygons);
      const roof = dress(b).layers.get("concrete")!;
      let roofArea = 0;
      for (let i = 0; i < roof.indices.length; i += 3) {
        const [a, c, d] = [roof.indices[i]! * 3, roof.indices[i + 1]! * 3, roof.indices[i + 2]! * 3];
        expect(roof.positions[a + 1]).toBe(b.height);
        const cx = (roof.positions[a]! + roof.positions[c]! + roof.positions[d]!) / 3, cz = (roof.positions[a + 2]! + roof.positions[c + 2]! + roof.positions[d + 2]!) / 3;
        expect(pointInPolygons(cx, cz, b.polygons), `${name}: a roof triangle lies outside the footprint or over a courtyard`).toBe(true);
        roofArea += Math.abs((roof.positions[c]! - roof.positions[a]!) * (roof.positions[d + 2]! - roof.positions[a + 2]!) - (roof.positions[d]! - roof.positions[a]!) * (roof.positions[c + 2]! - roof.positions[a + 2]!)) / 2;
      }
      expect(roofArea, name).toBeCloseTo(area(polygons), 4);
    }
    // Nothing at all is built inside a courtyard except what hangs off its walls.
    const court = building("apartments", [{ outer: COURT_OUTER, holes: [COURT_HOLE] }]);
    const inner = COURT_HOLE.map((p): Point => [p[0] + Math.sign(-50 - p[0]) * 2.5, p[1] + Math.sign(42 - p[1]) * 2.5]); // the hole shrunk by 2.5 m
    for (const [key, g] of dress(court).layers) {
      for (let i = 0; i < g.positions.length; i += 3) expect(pointInRing(g.positions[i]!, g.positions[i + 2]!, inner), `${key} intrudes into the courtyard`).toBe(false);
    }
  });

  it("produces sound meshes for every category and shape", () => {
    for (const category of BUILDING_CATEGORIES) {
      for (const [name, polygons] of SHAPES) {
        const { layers } = dress(building(category, polygons));
        for (const [key, g] of layers) {
          expect(meshProblems(`${category} ${name} ${key}`, g)).toEqual([]);
          if (g.indices.length === 0) continue;
          expect(g.uvs.length / 2).toBe(g.positions.length / 3);
          expect(g.colors.length % (g.positions.length / 3)).toBe(0);
          // No zero-area triangles apart from none: repeated corners are skipped rather than drawn as slivers.
          expect(triangleAreas(g.positions, g.indices).filter((a) => a < 1e-10).length, `${category} ${name} ${key} collapsed triangles`).toBe(0);
        }
      }
    }
  });
});

describe("facade style by classification", () => {
  it("gives apartments balconies and no other category any", () => {
    const long = [{ outer: box(0, 0, 36, 18), holes: [] }];
    for (const category of BUILDING_CATEGORIES) {
      const { balconies } = dress(building(category, long, 16));
      if (category === "apartments") expect(balconies).toBeGreaterThan(8);
      else expect(balconies, category).toBe(0);
    }
    expect(Object.entries(FACADE_STYLES).filter(([, s]) => s.balconies).map(([c]) => c)).toEqual(["apartments"]);
  });

  it("puts balconies on upper floors of long walls only, against the wall, and stops at the limit", () => {
    const b = building("apartments", [{ outer: box(0, 0, 36, 18), holes: [] }], 16);
    const g = dress(b).layers.get("plaster")!;
    const outline = b.polygons[0]!.outer;
    // Balconies are the only thing that stands more than 12 cm proud of the walls (the door stands 9 cm).
    let balconyVertices = 0;
    for (let i = 0; i < g.positions.length; i += 3) {
      const x = g.positions[i]!, y = g.positions[i + 1]!, z = g.positions[i + 2]!;
      const out = pointInRing(x, z, outline) ? 0 : distanceToLine(x, z, outline);
      if (out > 0.12) {
        balconyVertices++;
        expect(y, "a balcony at ground level").toBeGreaterThan(2.5);
        expect(y, "a balcony above the roof").toBeLessThan(b.height);
        expect(out).toBeLessThanOrEqual(FACADE_RULES.balconyDepth + 0.05);
      }
      // Below the roof, nothing is built inside the rooms.
      if (y < b.height) expect(pointInRing(x, z, box(0.3, 0.3, 35.4, 17.4)), "geometry inside the building").toBe(false);
    }
    expect(balconyVertices).toBeGreaterThan(8 * 8);
    // One storey, or short walls: none.
    expect(dress(building("apartments", [{ outer: box(0, 0, 36, 18), holes: [] }], 3.8)).balconies).toBe(0);
    expect(dress(building("apartments", [{ outer: box(0, 0, 8, 8), holes: [] }], 16)).balconies).toBe(0);
    // A tower with a long outline is capped.
    expect(dress(building("apartments", [{ outer: box(0, 0, 120, 60), holes: [] }], 90)).balconies).toBe(FACADE_RULES.balconyLimit);
    // Courtyard walls get none: they would fill the courtyard.
    const yard = dress(building("apartments", [{ outer: COURT_OUTER, holes: [COURT_HOLE] }], 16));
    const outerOnly = dress(building("apartments", [{ outer: COURT_OUTER, holes: [] }], 16));
    expect(yard.balconies).toBe(outerOnly.balconies);
  });

  it("uses the shopfront only for buildings classified commercial, and only when tall enough to have an upper floor", () => {
    const shape = [{ outer: box(0, 0, 30, 18), holes: [] }];
    for (const category of BUILDING_CATEGORIES) {
      const { used } = dress(building(category, shape, 12));
      expect(used.includes("shopfront"), category).toBe(category === "commercial");
    }
    expect(Object.entries(FACADE_STYLES).filter(([, s]) => s.ground === "shopfront").map(([c]) => c)).toEqual(["commercial"]);
    const tall = dress(building("commercial", shape, 12)).layers.get("shopfront")!;
    for (let i = 1; i < tall.positions.length; i += 3) expect(tall.positions[i]!).toBeLessThanOrEqual(FACADE_RULES.shopfrontHeight);
    expect(dress(building("commercial", shape, 4.5)).used).not.toContain("shopfront"); // single storey: no separate ground floor
  });

  it("never dresses an unclassified building as a house, flat or shop", () => {
    for (const [name, polygons] of SHAPES) {
      for (const height of [3, 6.5, 16, 60]) {
        const { used, balconies } = dress(building("unclassified", polygons, height));
        expect(balconies, name).toBe(0);
        for (const key of ["residential", "shopfront", "ribbon"]) expect(used, `${name} at ${height} m`).not.toContain(key);
      }
    }
    expect(FACADE_STYLES.unclassified).toEqual({ wall: "generic", door: true });
    // A house and an unclassified building of the same shape do not look the same.
    const shape = [{ outer: box(0, 0, 30, 18), holes: [] }];
    expect(dress(building("house", shape)).used).toContain("residential");
    expect(dress(building("unclassified", shape)).used).toContain("generic");
  });

  it("covers every category with a style drawn from the building layers", () => {
    expect(Object.keys(FACADE_STYLES).sort()).toEqual([...BUILDING_CATEGORIES].sort());
    for (const [category, style] of Object.entries(FACADE_STYLES)) {
      expect(BUILDING_LAYERS, category).toContain(style.wall);
      if (style.ground) expect(BUILDING_LAYERS).toContain(style.ground);
    }
    const shape = [{ outer: box(0, 0, 30, 18), holes: [] }];
    for (const category of BUILDING_CATEGORIES) for (const key of dress(building(category, shape)).used) expect(BUILDING_LAYERS, `${category} uses ${key}`).toContain(key);
  });

  it("fits whole window bays and whole floors to each wall, so no window is cut by a corner or the roof", () => {
    for (const [name, polygons] of SHAPES) {
      for (const category of ["house", "unclassified", "commercial"] as const) {
        const b = building(category, polygons, 13);
        const g = dress(b).layers.get(FACADE_STYLES[category].wall);
        if (!g) continue;
        for (let q = 0; q < g.uvs.length; q += 8) {
          const us = [g.uvs[q]!, g.uvs[q + 2]!, g.uvs[q + 4]!, g.uvs[q + 6]!], vs = [g.uvs[q + 1]!, g.uvs[q + 3]!, g.uvs[q + 5]!, g.uvs[q + 7]!];
          const bays = (Math.max(...us) - Math.min(...us)) / FACADE.bayWidth, floors = (Math.max(...vs) - Math.min(...vs)) / FACADE.floorHeight;
          expect(Math.abs(bays - Math.round(bays)), `${category} ${name}: ${bays} bays`).toBeLessThan(1e-9);
          expect(Math.abs(floors - Math.round(floors)), `${category} ${name}: ${floors} floors`).toBeLessThan(1e-9);
          expect(bays).toBeGreaterThanOrEqual(1);
          expect(floors).toBeGreaterThanOrEqual(1);
          // The pattern is stretched or squeezed by less than half a bay and half a floor.
          const p = (q / 2) * 3;
          const wallLength = Math.hypot(g.positions[p + 3]! - g.positions[p]!, g.positions[p + 5]! - g.positions[p + 2]!) || Math.hypot(g.positions[p + 6]! - g.positions[p]!, g.positions[p + 8]! - g.positions[p + 2]!);
          expect(Math.abs(wallLength - bays * FACADE.bayWidth)).toBeLessThanOrEqual(FACADE.bayWidth / 2 + 1e-9);
        }
      }
    }
  });

  it("places the door on the longest outside wall, on the ground, within that wall", () => {
    const shape = [{ outer: box(0, 0, 30, 12), holes: [] }];
    const b = building("house", shape, 7.5);
    const withDoor = dress(b).layers.get("plaster")!;
    const without = dress({ ...b, category: "commercial" }).layers.get("plaster")!; // commercial has no door, the same parapet, and walls in another layer
    const door = withDoor.positions.slice(without.positions.length);
    expect(door.length).toBe(2 * 20 * 3); // a frame and a leaf: two boxes of five faces
    let minX = Infinity, maxX = -Infinity, top = 0;
    for (let i = 0; i < door.length; i += 3) {
      minX = Math.min(minX, door[i]!);
      maxX = Math.max(maxX, door[i]!);
      top = Math.max(top, door[i + 1]!);
      expect(door[i + 1]!).toBeGreaterThanOrEqual(0);
      // Against one of the two 30 m walls (z = 0 or z = 12), not on a 12 m end wall.
      expect(Math.min(Math.abs(door[i + 2]!), Math.abs(door[i + 2]! - 12))).toBeLessThan(0.15);
    }
    expect(minX).toBeGreaterThan(1);
    expect(maxX).toBeLessThan(29);
    expect(maxX - minX).toBeCloseTo(1.3, 5);
    expect(top).toBeLessThan(FACADE.floorHeight); // within the ground floor
    // On a pier between window bays, so it never lands on a window.
    const centre = (minX + maxX) / 2, bay = 30 / Math.round(30 / FACADE.bayWidth);
    expect(Math.abs(centre / bay - Math.round(centre / bay))).toBeLessThan(1e-6);
    // No door in a courtyard wall, and none on buildings too small for one.
    expect(dress(building("house", [{ outer: box(0, 0, 4, 4), holes: [] }], 7.5)).layers.get("plaster")!.positions.length).toBe(dress(building("other", [{ outer: box(0, 0, 4, 4), holes: [] }], 7.5)).layers.get("plaster")!.positions.length);
  });

  it("keeps sheds and kiosks plain: no pattern, parapet or door", () => {
    for (const b of [building("house", [{ outer: box(0, 0, 5, 5), holes: [] }], 7.5), building("commercial", [{ outer: box(0, 0, 30, 18), holes: [] }], 3)]) {
      const { used, layers } = dress(b);
      expect(used).toEqual(["concrete", "plaster"]);
      const g = layers.get("plaster")!;
      for (let i = 1; i < g.positions.length; i += 3) expect(g.positions[i]!).toBeLessThanOrEqual(b.height);
    }
  });
});

describe("building heights", () => {
  it("passes valid heights through and replaces unusable ones with one storey", () => {
    for (const h of [0.5, 3.2, 6.5, 16, 120, 400]) expect(usableHeight(h)).toBe(h);
    for (const bad of [0, -3, Number.NaN, Infinity, -Infinity, undefined, null, "12", {}]) expect(usableHeight(bad), String(bad)).toBe(FACADE_RULES.fallbackHeight);
    expect(usableHeight(401)).toBe(400);
    expect(usableHeight(1e9)).toBe(400);
  });

  it("builds finite geometry whatever height the file states", () => {
    const shape = [{ outer: COURT_OUTER, holes: [COURT_HOLE] }];
    for (const category of ["apartments", "commercial", "unclassified"] as const) {
      for (const bad of [0, -8, Number.NaN, Infinity, undefined, 1e7, 0.001]) {
        const b = { ...building(category, shape), height: bad as number };
        const { layers } = dress(b);
        let top = 0;
        for (const [key, g] of layers) {
          expect(meshProblems(`${category} height ${String(bad)} ${key}`, g)).toEqual([]);
          for (let i = 1; i < g.positions.length; i += 3) top = Math.max(top, g.positions[i]!);
        }
        expect(top).toBeGreaterThan(0);
        expect(top).toBeLessThanOrEqual(FACADE_RULES.maxHeight + FACADE_RULES.parapetHeight);
        // The roof is still the footprint.
        expect(layers.get("concrete")!.indices.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("buildings in the district", () => {
  let engine: NullEngine;
  let kb: ReturnType<typeof keyboard>;
  beforeEach(() => {
    engine = nullEngine();
    kb = keyboard();
  });
  afterEach(() => {
    kb.input.dispose();
    engine.dispose();
  });

  it("does not alter the district it was given", () => {
    const district = testDistrict();
    const before = JSON.stringify(district);
    const game = new DistrictGame({ engine, input: kb.input, district });
    for (let i = 0; i < 5; i++) game.renderFrame();
    game.dispose();
    expect(JSON.stringify(district)).toBe(before);
  });

  it("colours each building by where its height came from: measured, from levels, or estimated", () => {
    const district = testDistrict();
    const game = new DistrictGame({ engine, input: kb.input, district });
    expect(game.world.counts["height:estimated"]).toBe(1);
    expect(game.world.counts["height:source-levels"]).toBe(1);
    expect(game.world.counts["height:source-height"]).toBe(1);
    expect(game.world.counts.heightsUnusable).toBeUndefined();

    /** Colour of the roof vertex over a building's first corner, in the current view. */
    const roofColour = (index: number): number[] => {
      const b = district.buildings[index]!;
      const corner = b.polygons[0]!.outer[0]!;
      for (const mesh of game.scene.meshes.filter((m) => m.name.startsWith("concrete@"))) {
        const p = mesh.getVerticesData(VertexBuffer.PositionKind)!, c = mesh.getVerticesData(VertexBuffer.ColorKind)!;
        for (let v = 0; v < p.length / 3; v++) {
          if (p[v * 3] === corner[0] && p[v * 3 + 2] === corner[1] && p[v * 3 + 1] === b.height) return [c[v * 4]!, c[v * 4 + 1]!, c[v * 4 + 2]!].map((x) => +x.toFixed(2));
        }
      }
      throw new Error(`no roof vertex for ${b.id}`);
    };
    const normal = [0, 1, 2].map(roofColour);
    game.world.debug.set(2);
    expect(game.world.debug.view.name).toBe("Height source");
    expect(game.world.debug.view.legend).toMatch(/estimat/i);
    const [measured, levels, estimated] = [0, 1, 2].map(roofColour) as [number[], number[], number[]];
    // Three different colours: green for a mapped height, yellow for levels, red for an estimate.
    expect(measured[1]).toBeGreaterThan(measured[0]! * 3);
    expect(levels[0]).toBeGreaterThan(0.7);
    expect(levels[1]).toBeGreaterThan(0.7);
    expect(estimated[0]).toBeGreaterThan(estimated[1]! * 5);
    expect(new Set([measured, levels, estimated].map(String)).size).toBe(3);
    // Every face of the estimated building carries the estimate colour, facades and balconies included.
    let tinted = 0;
    for (const mesh of game.scene.meshes) {
      if (!BUILDING_LAYERS.some((layer) => mesh.name.startsWith(`${layer}@`))) continue;
      const p = mesh.getVerticesData(VertexBuffer.PositionKind)!, c = mesh.getVerticesData(VertexBuffer.ColorKind)!;
      for (let v = 0; v < p.length / 3; v++) {
        if (p[v * 3]! < -80.5 || p[v * 3]! > -19.5 || p[v * 3 + 2]! < 19.5 || p[v * 3 + 2]! > 64.5) continue; // the courtyard block and a little around it
        if (p[v * 3 + 1]! < 0.5) continue; // ground-level paving shares these layers
        expect([+c[v * 4]!.toFixed(2), +c[v * 4 + 1]!.toFixed(2), +c[v * 4 + 2]!.toFixed(2)]).toEqual(estimated);
        tinted++;
      }
    }
    expect(tinted).toBeGreaterThan(50);
    game.world.debug.set(0);
    expect([0, 1, 2].map(roofColour)).toEqual(normal);
    game.dispose();
  });

  it("counts buildings whose stated height could not be used, and still builds them", () => {
    const district = testDistrict();
    district.buildings[0]!.height = Number.NaN;
    district.buildings[1]!.height = -4;
    const game = new DistrictGame({ engine, input: kb.input, district });
    expect(game.world.counts.heightsUnusable).toBe(2);
    expect(game.world.counts.buildings).toBe(3);
    for (const mesh of game.scene.meshes) {
      const p = mesh.getVerticesData(VertexBuffer.PositionKind);
      if (p) for (let i = 0; i < p.length; i++) if (!Number.isFinite(p[i])) throw new Error(`${mesh.name} has a non-finite position`);
    }
    game.dispose();
  });
});
