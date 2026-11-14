import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addBuildingDetails, APPEARANCE_RULES, planAppearance } from "../src/game/district/buildingAppearance";
import { BUILDING_LAYERS, dressBuilding, FACADE_RULES } from "../src/game/district/buildingGeometry";
import { GATE_RULES, planGates } from "../src/game/district/gates";
import { collectLabels, LABEL_RULES } from "../src/game/district/labels";
import { buildingProvenance, categoryClass, heightClass, isUnpaved, PROVENANCE_CLASSES, roadKey, roadSurface, summariseProvenance, widthClass } from "../src/game/district/provenance";
import { laneCountMapped, MARKING_RULES, paintedLanes } from "../src/game/district/roadMarkings";
import { pointInPolygons } from "../src/game/district/spawn";
import { planVerges, VERGE_RULES } from "../src/game/district/streetDetail";
import type { DistrictBuilding, DistrictData, Point, Polygon } from "../src/game/district/types";
import { DistrictGame } from "../src/game/engine/DistrictGame";
import { GeometryBuffer } from "../src/game/geometry/GeometryBuffer";
import type { MaterialKey } from "../src/game/materials/MaterialLibrary";
import { KeyboardInput } from "../src/input/KeyboardInput";
import { COURT_HOLE, testDistrict } from "./fixtures/district";
import { AVENUE_X, GATE_ON_STREET, LIFT_GATE, realismDistrict, WALL_GATE } from "./fixtures/realismDistrict";

// Everything here runs on SYNTHETIC fixtures. It checks the rules, not the real map.

const box = (x: number, z: number, w: number, d: number): Point[] => [[x, z], [x + w, z], [x + w, z + d], [x, z + d], [x, z]];
function building(id: string, polygons: Polygon[], over: Partial<DistrictBuilding> = {}): DistrictBuilding {
  const pts = polygons.flatMap((p) => p.outer);
  const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
  const area = polygons.reduce((s, p) => s + (Math.max(...p.outer.map((q) => q[0])) - Math.min(...p.outer.map((q) => q[0]))) * (Math.max(...p.outer.map((q) => q[1])) - Math.min(...p.outer.map((q) => q[1]))), 0);
  return {
    id, osm: { type: "way", id: Number(id.split("/")[1]) }, tags: { building: "yes" }, category: "unclassified", categoryRule: "building=yes with no other evidence",
    height: 9.8, heightStatus: "estimated", heightBasis: "generic low-rise estimate", polygons, area, centre: [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2],
    inSector: true, clipped: false, fromRelation: false, ...over,
  };
}
function distanceToRings(x: number, z: number, b: DistrictBuilding): number {
  let best = Infinity;
  for (const p of b.polygons) for (const ring of [p.outer, ...p.holes]) for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1]!, c = ring[i]!;
    const dx = c[0] - a[0], dz = c[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz));
  }
  return best;
}
/** Dresses one building the way the district does and returns every buffer, split into mapped and generated. */
function dressed(b: DistrictBuilding): { mapped: Map<MaterialKey, GeometryBuffer>; generated: Map<MaterialKey, GeometryBuffer>; all: GeometryBuffer[] } {
  const mapped = new Map<MaterialKey, GeometryBuffer>(), generated = new Map<MaterialKey, GeometryBuffer>();
  const layer = (key: MaterialKey, gen = false): GeometryBuffer => {
    const m = gen ? generated : mapped;
    if (!m.has(key)) m.set(key, new GeometryBuffer());
    return m.get(key)!;
  };
  const look = planAppearance(b);
  dressBuilding(layer, b, look.wall, look.roof, look.wallRow);
  addBuildingDetails(layer, b, look);
  return { mapped, generated, all: [...mapped.values(), ...generated.values()] };
}
const points = (g: GeometryBuffer): Array<[number, number, number]> => {
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < g.positions.length; i += 3) out.push([g.positions[i]!, g.positions[i + 1]!, g.positions[i + 2]!]);
  return out;
};
const COURT = building("way/900", [{ outer: box(0, 0, 60, 44), holes: [box(18, 14, 24, 16)] }], { area: 60 * 44 - 24 * 16 });
const SAMPLE: DistrictBuilding[] = [
  building("way/901", [{ outer: box(0, 0, 12, 9), holes: [] }]),
  building("way/902", [{ outer: [[0, 0], [40, 0], [40, 14], [15, 14], [15, 36], [0, 36], [0, 0]], holes: [] }], { area: 40 * 14 + 15 * 22, height: 13 }),
  COURT,
  building("way/903", [{ outer: box(0, 0, 4, 5), holes: [] }], { height: 3 }),
  building("way/904", [{ outer: box(0, 0, 30, 20), holes: [] }], { category: "commercial", categoryRule: "building=commercial", tags: { building: "commercial" }, height: 12.8, heightStatus: "source-levels", heightBasis: "building:levels=4 x 3.2 m" }),
];

describe("building appearance (synthetic)", () => {
  it("gives the same building the same look every time, from its id alone", () => {
    for (const b of SAMPLE) {
      expect(planAppearance(b)).toEqual(planAppearance(structuredClone(b)));
      const a = dressed(b), again = dressed(structuredClone(b));
      expect(a.all.map((g) => [...g.positions])).toEqual(again.all.map((g) => [...g.positions]));
      expect(a.all.map((g) => [...g.uvs])).toEqual(again.all.map((g) => [...g.uvs]));
    }
    // Moving a building changes nothing about its look; only the id decides.
    const moved = building("way/901", [{ outer: box(500, 300, 12, 9), holes: [] }]);
    const { roofObjects: _a, ...first } = planAppearance(SAMPLE[0]!);
    const { roofObjects: _b, ...second } = planAppearance(moved);
    expect(second).toEqual(first);
    expect(_b.length).toBe(_a.length);
  });

  it("varies wall pattern, colour and roof between buildings, so no one model repeats", () => {
    const looks = Array.from({ length: 300 }, (_, i) => planAppearance(building(`way/${5000 + i}`, [{ outer: box(0, 0, 14, 11), holes: [] }])));
    expect(new Set(looks.map((l) => l.wallVariant)).size).toBe(APPEARANCE_RULES.genericVariants);
    expect(new Set(looks.map((l) => l.wall.join())).size).toBeGreaterThan(100);
    expect(new Set(looks.map((l) => l.roofObjects.map((o) => o.kind).join("+"))).size).toBeGreaterThanOrEqual(4);
    expect(looks.some((l) => l.floorBands) && looks.some((l) => !l.floorBands)).toBe(true);
    const commonest = Math.max(...Object.values(looks.reduce<Record<string, number>>((m, l) => ((m[l.rule + l.floorBands + l.plinth + l.roofObjects.length] = (m[l.rule + l.floorBands + l.plinth + l.roofObjects.length] ?? 0) + 1), m), {})));
    expect(commonest).toBeLessThan(looks.length * 0.2);
  });

  it("marks a building of unknown use as a generic reconstruction and never styles it as a home or shop, wherever it stands", () => {
    const inResidentialArea = building("way/910", [{ outer: box(0, 0, 14, 11), holes: [] }], { context: { landuse: "residential", area: "way/31" } });
    for (const b of [SAMPLE[0]!, inResidentialArea, building("way/911", [{ outer: box(0, 0, 60, 40), holes: [] }], { area: 2400 })]) {
      const look = planAppearance(b);
      expect(look.genericReconstruction).toBe(true);
      expect(look.wallLayer).toBe("generic");
      expect(look.rule).toMatch(/generic-reconstruction/);
      const used = [...dressed(b).mapped.keys(), ...dressed(b).generated.keys()];
      for (const key of ["residential", "shopfront", "ribbon"]) expect(used).not.toContain(key);
      expect(buildingProvenance(b, look).genericReconstruction).toBe(true);
    }
    const shop = planAppearance(SAMPLE[4]!);
    expect(shop.genericReconstruction).toBe(false);
    expect(shop.wallVariant).toBe(0);
  });

  it("keeps the footprint: every wall and band stands on a mapped edge and roof objects stay inside", () => {
    for (const b of SAMPLE) {
      const before = structuredClone(b);
      const { all, generated } = dressed(b);
      expect(b).toEqual(before);
      const reach = Math.max(FACADE_RULES.balconyDepth, APPEARANCE_RULES.bandProud) + 0.05;
      for (const g of all) for (const [x, y, z] of points(g)) {
        expect(Number.isFinite(x + y + z)).toBe(true);
        if (!pointInPolygons(x, z, b.polygons)) expect(distanceToRings(x, z, b), `${b.id} at ${x},${z}`).toBeLessThanOrEqual(reach);
      }
      // Above the parapet there are only roof objects, each well inside the outline.
      const top = b.height + FACADE_RULES.parapetHeight + 0.01;
      for (const g of generated.values()) for (const [x, y, z] of points(g)) {
        if (y <= top) continue;
        expect(pointInPolygons(x, z, b.polygons), `${b.id} roof object at ${x},${z}`).toBe(true);
        expect(distanceToRings(x, z, b)).toBeGreaterThan(0.3);
      }
      for (const o of planAppearance(b).roofObjects) expect(distanceToRings(o.x, o.z, b)).toBeGreaterThanOrEqual(APPEARANCE_RULES.roofEdgeClearance);
    }
    expect(planAppearance(SAMPLE[3]!).roofObjects).toEqual([]); // a kiosk gets nothing on its roof
  });

  it("keeps courtyards open: nothing is roofed, placed or painted inside one", () => {
    const hole = COURT.polygons[0]!.holes[0]!;
    const inHole = (x: number, z: number, margin: number): boolean => x > hole[0]![0] + margin && x < hole[2]![0] - margin && z > hole[0]![1] + margin && z < hole[2]![1] - margin;
    for (let i = 0; i < 40; i++) {
      const b = { ...COURT, id: `way/${920 + i}` };
      const { all } = dressed(b);
      for (const g of all) for (const [x, , z] of points(g)) expect(inHole(x, z, APPEARANCE_RULES.bandProud + 0.01), `${b.id} at ${x},${z}`).toBe(false);
      for (const o of planAppearance(b).roofObjects) expect(pointInPolygons(o.x, o.z, b.polygons)).toBe(true);
      // The roof is the footprint less the courtyard.
      const roof = dressed(b).mapped.get("concrete")!;
      let area = 0;
      for (let k = 0; k < roof.indices.length; k += 3) {
        const [p, q, r] = [roof.indices[k]!, roof.indices[k + 1]!, roof.indices[k + 2]!].map((v) => [roof.positions[v * 3]!, roof.positions[v * 3 + 2]!]) as [number[], number[], number[]];
        area += Math.abs((q[0]! - p[0]!) * (r[1]! - p[1]!) - (r[0]! - p[0]!) * (q[1]! - p[1]!)) / 2;
      }
      expect(area).toBeCloseTo(60 * 44 - 24 * 16, 4);
    }
    expect(COURT_HOLE.length).toBe(5);
  });
});

describe("provenance records (synthetic)", () => {
  it("separates source, inferred and estimated heights, and never calls an estimate measured", () => {
    expect([heightClass("source-height"), heightClass("source-levels"), heightClass("estimated")]).toEqual(["source", "inferred", "estimated"]);
    const cases: Array<[Partial<DistrictBuilding>, string]> = [
      [{ height: 21, heightStatus: "source-height", heightBasis: "height=21" }, "source"],
      [{ height: 9.6, heightStatus: "source-levels", heightBasis: "building:levels=3 x 3.2 m" }, "inferred"],
      [{ height: 6.6, heightStatus: "estimated", heightBasis: "generic low-rise estimate" }, "estimated"],
    ];
    for (const [over, cls] of cases) {
      const b = building("way/930", [{ outer: box(0, 0, 20, 15), holes: [] }], over);
      const p = buildingProvenance(b, planAppearance(b));
      expect(p.height).toEqual({ value: b.height, class: cls, status: b.heightStatus, basis: b.heightBasis });
      expect(p.footprint.class).toBe("source");
      expect(p.appearance.class).toBe("decorative");
      // The drawn walls reach exactly the stated height: the estimate is used as given, not altered again.
      const wallTop = Math.max(...[...dressed(b).mapped.entries()].filter(([k]) => k !== "concrete").flatMap(([, g]) => points(g).map((v) => v[1])));
      expect(wallTop).toBeCloseTo(b.height, 6);
    }
  });

  it("records where a category came from, also for files written before the field existed", () => {
    const b = (over: Partial<DistrictBuilding>): DistrictBuilding => building("way/931", [{ outer: box(0, 0, 20, 15), holes: [] }], over);
    expect(categoryClass(b({}))).toBe("none");
    expect(categoryClass(b({ category: "commercial", categoryRule: "building=retail" }))).toBe("source");
    expect(categoryClass(b({ category: "commercial", categoryRule: "inferred: point of interest node/1 (amenity=bank) lies inside the footprint" }))).toBe("inferred");
    expect(categoryClass(b({ category: "institutional", categoryRule: "x", categoryStatus: "inferred" }))).toBe("inferred");
    // A stale status can never make an unknown building look classified.
    expect(categoryClass(b({ category: "unclassified", categoryStatus: "source" }))).toBe("none");
  });

  it("separates mapped, lane-derived and estimated road widths, and mapped from assumed surfaces", () => {
    expect([widthClass("source-width"), widthClass("source-lanes"), widthClass("estimated")]).toEqual(["source", "inferred", "estimated"]);
    const d = realismDistrict();
    expect(roadSurface(d.roads[1]!)).toEqual({ value: "paved", class: "source", basis: "surface=paved" });
    expect(roadSurface(d.roads[0]!).class).toBe("estimated");
    expect(isUnpaved(d.roads[4]!)).toBe(true);
    expect(isUnpaved(d.roads[0]!)).toBe(false);
    expect(PROVENANCE_CLASSES).toEqual(["source", "inferred", "estimated", "decorative"]);
  });
});

describe("the district as built (synthetic)", () => {
  let engine: NullEngine;
  let input: KeyboardInput;
  beforeEach(() => {
    engine = new NullEngine({ renderWidth: 320, renderHeight: 180, textureSize: 64, deterministicLockstep: true, lockstepMaxSteps: 4 });
    input = new KeyboardInput(new EventTarget());
  });
  afterEach(() => {
    input.dispose();
    engine.dispose();
  });
  const start = (district: DistrictData): DistrictGame => new DistrictGame({ engine, input, district });
  const vertices = (game: DistrictGame, layer: string): Array<[number, number, number]> => {
    const out: Array<[number, number, number]> = [];
    for (const mesh of game.scene.meshes.filter((m) => m.name.startsWith(`${layer}@`))) {
      const p = mesh.getVerticesData(VertexBuffer.PositionKind)!;
      for (let i = 0; i < p.length; i += 3) out.push([p[i]!, p[i + 1]!, p[i + 2]!]);
    }
    return out;
  };

  it("builds each mapped building once, with one provenance record each, the same on every load", () => {
    const district = realismDistrict();
    const before = structuredClone(district);
    const a = start(district), b = start(realismDistrict());
    expect(district).toEqual(before); // building the world changes no map data
    const { provenance, counts } = a.world;
    expect(counts.buildings).toBe(district.buildings.length);
    expect([...provenance.buildings.keys()]).toEqual(district.buildings.map((x) => x.id));
    expect(new Set(district.buildings.map((x) => x.id)).size).toBe(district.buildings.length);
    for (const bd of district.buildings) {
      const p = provenance.buildings.get(bd.id)!;
      expect(p.osm).toEqual(bd.osm);
      expect(p.category.value).toBe(bd.category);
      expect(p.category.rule).toBe(bd.categoryRule);
      expect(p.height.value).toBe(bd.height);
      expect(p.appearance.rule).toMatch(/^appearance\/1 /);
      expect(p.genericReconstruction).toBe(bd.category === "unclassified");
    }
    expect(counts.genericReconstructions).toBe(district.buildings.filter((x) => x.category === "unclassified").length);
    // Roof area equals footprint area: no footprint was built twice, none was left out.
    const heights = new Set(district.buildings.map((x) => x.height));
    let roof = 0;
    for (const mesh of a.scene.meshes.filter((m) => m.name.startsWith("concrete@"))) {
      const p = mesh.getVerticesData(VertexBuffer.PositionKind)!, n = mesh.getVerticesData(VertexBuffer.NormalKind)!, idx = mesh.getIndices()!;
      for (let i = 0; i < idx.length; i += 3) {
        const [u, v, w] = [idx[i]!, idx[i + 1]!, idx[i + 2]!];
        if (n[u * 3 + 1]! < 0.99 || !heights.has(p[u * 3 + 1]!) || !district.buildings.some((x) => pointInPolygons((p[u * 3]! + p[v * 3]! + p[w * 3]!) / 3, (p[u * 3 + 2]! + p[v * 3 + 2]! + p[w * 3 + 2]!) / 3, x.polygons))) continue;
        roof += Math.abs((p[v * 3]! - p[u * 3]!) * (p[w * 3 + 2]! - p[u * 3 + 2]!) - (p[w * 3]! - p[u * 3]!) * (p[v * 3 + 2]! - p[u * 3 + 2]!)) / 2;
      }
    }
    expect(roof).toBeCloseTo(district.buildings.reduce((s, x) => s + x.area, 0), 3);
    // Same input, same geometry.
    for (const layer of BUILDING_LAYERS) expect(vertices(b, layer)).toEqual(vertices(a, layer));
    expect(summariseProvenance(b.world.provenance)).toEqual(summariseProvenance(provenance));
    a.dispose();
    b.dispose();
  });

  it("records every road's class, access, width basis, surface and paint without changing any of them", () => {
    const district = realismDistrict();
    const game = start(district);
    const { roads } = game.world.provenance;
    expect(roads.size).toBe(district.roads.length);
    for (const road of district.roads) {
      const p = roads.get(roadKey(road))!;
      expect(p.roadClass.value).toBe(road.class);
      expect(p.oneway).toBe(road.oneway);
      expect(p.width).toEqual({ value: road.width, class: widthClass(road.widthStatus), status: road.widthStatus, basis: road.widthBasis });
      expect(p.access?.value ?? null).toBe(road.tags.access ?? null);
      expect(p.markings.class).toBe("decorative");
    }
    const s = summariseProvenance(game.world.provenance);
    expect(s.roads.width).toEqual({ source: 1, inferred: 0, estimated: 4, decorative: 0 });
    expect(s.roads.access).toEqual({ private: 1, permissive: 1 });
    expect(s.roads.surface).toEqual({ "estimated:paved": 3, "source:paved": 1, "source:unpaved": 1 });
    expect(game.world.counts.unpavedRoads).toBe(1);
    game.dispose();
  });

  it("keeps private and permissive access exactly as mapped", () => {
    const district = realismDistrict();
    const tags = district.roads.map((r) => ({ ...r.tags }));
    const game = start(district);
    for (let i = 0; i < 120; i++) game.renderFrame();
    expect(district.roads.map((r) => r.tags)).toEqual(tags);
    expect(district.roads[1]!.tags.access).toBe("private");
    expect(game.world.provenance.roads.get(roadKey(district.roads[1]!))!.access).toEqual({ value: "private", class: "source" });
    expect(game.world.provenance.roads.get(roadKey(district.roads[0]!))!.access).toBeNull(); // no tag: nothing is assumed
    // A gate drawn on the private street does not close it or open it: the road data and its surface are untouched.
    expect(game.world.roadSurfaces.near(GATE_ON_STREET[0], GATE_ON_STREET[1], 0)).toBe(true);
    expect(game.world.obstacles.near(GATE_ON_STREET[0], GATE_ON_STREET[1], 1.5)).toBe(false);
    game.dispose();
  });

  it("stands a gate only at a mapped gate point, across the mapped road, open and clear of the carriageway", () => {
    const district = realismDistrict();
    const game = start(district);
    const { gates, counts, roadSurfaces, obstacles, provenance } = game.world;
    const mappedGates = district.barriers.points.filter((p) => GATE_RULES.kinds.includes(p.kind ?? ""));
    expect(gates.map((g) => [g.id, g.x, g.z])).toEqual(mappedGates.map((p) => [p.id, p.point[0], p.point[1]]));
    const onStreet = gates.find((g) => g.x === GATE_ON_STREET[0] && g.z === GATE_ON_STREET[1])!;
    expect(onStreet.road).toBe("way/21");
    expect(onStreet.name).toBe("Gate No. 4");
    expect(onStreet.pillars).toHaveLength(2);
    // Pillars mirror each other about the mapped point and stand outside the road.
    expect((onStreet.pillars[0]!.x + onStreet.pillars[1]!.x) / 2).toBeCloseTo(onStreet.x, 6);
    expect((onStreet.pillars[0]!.z + onStreet.pillars[1]!.z) / 2).toBeCloseTo(onStreet.z, 6);
    for (const g of gates) for (const p of g.pillars) {
      expect(roadSurfaces.near(p.x, p.z, GATE_RULES.pillarSize / 2)).toBe(false);
      expect(Math.hypot(p.x - g.x, p.z - g.z)).toBeGreaterThan(g.half + GATE_RULES.pillarSize / 2);
      expect(obstacles.near(p.x, p.z, 0.1)).toBe(true);
    }
    const lift = gates.find((g) => g.kind === "lift_gate")!;
    expect([lift.x, lift.z, lift.road]).toEqual([LIFT_GATE[0], LIFT_GATE[1], "way/20"]);
    // The gate on the wall, away from any road, stays a post: no pillars, no name.
    const wall = gates.find((g) => g.x === WALL_GATE[0] && g.z === WALL_GATE[1])!;
    expect([wall.road, wall.pillars.length, wall.name]).toEqual([null, 0, null]);
    expect(gates.filter((g) => g.name !== null).map((g) => g.name)).toEqual(["Gate No. 4"]);
    // The bollard is a mapped barrier point but not a gate: it gets no gate.
    expect(gates.some((g) => g.x === 0 && g.z === 60)).toBe(false);
    expect(counts.mappedGates).toBe(district.barriers.points.length);
    expect(counts.gatesOnRoads).toBe(2);
    expect(provenance.features.filter((f) => f.kind === "gate").length).toBe(district.barriers.points.length);
    expect(provenance.features.filter((f) => f.kind === "gate").every((f) => f.position === "source" && f.form === "decorative" && f.source !== null)).toBe(true);
    // No gate geometry on any carriageway: nothing above the road surface within the road at either gate.
    for (const layer of ["plaster", "metal"]) for (const [x, y, z] of vertices(game, layer)) {
      if (y < 0.1 || Math.hypot(x - GATE_ON_STREET[0], z - GATE_ON_STREET[1]) > 8) continue;
      expect(Math.abs(x - GATE_ON_STREET[0]), `gate part at ${x},${y},${z}`).toBeGreaterThan(onStreet.half);
    }
    // A district with no gate points gets no gates.
    const none = realismDistrict();
    none.barriers.points = [];
    const bare = start(none);
    expect(bare.world.gates).toEqual([]);
    expect(bare.world.counts.generatedGatePillars).toBeUndefined();
    game.dispose();
    bare.dispose();
  });

  it("plans gates from the mapped points alone", () => {
    const district = realismDistrict();
    const all = planGates(district, () => true);
    expect(all.map((g) => g.id)).toEqual(["node/41", "node/42", "node/43"]);
    // Where a pillar would stand on a road or in a building it is left out; the gate itself stays where it is mapped.
    const blocked = planGates(district, () => false);
    expect(blocked.map((g) => [g.x, g.z])).toEqual(all.map((g) => [g.x, g.z]));
    expect(blocked.every((g) => g.pillars.length === 0)).toBe(true);
  });

  it("invents no compound: without mapped barrier lines there are no walls, however many gates and land-use areas exist", () => {
    const district = realismDistrict();
    district.barriers.lines = [];
    const game = start(district);
    const { counts, obstacles, provenance } = game.world;
    expect(counts.barrierSegments).toBeUndefined();
    expect(counts.barrierOpenings).toBeUndefined();
    expect(Object.keys(counts).filter((k) => /wall|compound|boundary|society/i.test(k))).toEqual([]);
    expect(provenance.features.filter((f) => /wall|compound|boundary|society/i.test(f.kind))).toEqual([]);
    // Nothing stands along the outline of the residential land-use area, and nothing joins one gate to another.
    const outline = district.areas.find((a) => a.id === "way/31")!.polygons[0]!.outer;
    for (let i = 1; i < outline.length; i++) for (let t = 0.05; t < 1; t += 0.05) {
      const x = outline[i - 1]![0] + (outline[i]![0] - outline[i - 1]![0]) * t, z = outline[i - 1]![1] + (outline[i]![1] - outline[i - 1]![1]) * t;
      if (district.buildings.some((b) => distanceToRings(x, z, b) < 3 || pointInPolygons(x, z, b.polygons)) || game.world.decorations.some((d) => Math.hypot(d.x - x, d.z - z) < 4) || Math.abs(z - 130) < 6) continue;
      expect(obstacles.near(x, z, 0.4), `obstacle on the land-use outline at ${x},${z}`).toBe(false);
    }
    for (let t = 0.1; t < 1; t += 0.1) expect(obstacles.near(WALL_GATE[0] + (GATE_ON_STREET[0] + 6 - WALL_GATE[0]) * t, WALL_GATE[1] + (GATE_ON_STREET[1] - WALL_GATE[1]) * t, 0.3)).toBe(false);
    // Every building keeps its own record: none is grouped into a society.
    for (const p of provenance.buildings.values()) expect(Object.keys(p)).not.toContain("compound");
    // With the mapped wall in place it is drawn as before.
    const walled = start(realismDistrict());
    expect(walled.world.counts.barrierSegments).toBeGreaterThan(10);
    game.dispose();
    walled.dispose();
  });

  it("paints by width and by what is mapped: nothing on residential or narrow roads, no lane lines from an estimated lane count", () => {
    const district = realismDistrict();
    const game = start(district);
    const half = MARKING_RULES.lineWidth / 2 + 0.01;
    // Avenue: 14 m and four lanes, both only class defaults. Centre and edge lines; no lane dividers.
    const offsets = new Set<number>();
    for (const [x, , z] of vertices(game, "roadPaint")) if (Math.abs(x - AVENUE_X) < 7 && Math.abs(z) > 20 && Math.abs(z) < 120) offsets.add(Math.round(Math.abs(x - AVENUE_X) * 10) / 10);
    for (const o of offsets) expect([0, 0.1].some((c) => Math.abs(o - c) <= half) || Math.abs(o - (7 - MARKING_RULES.edgeInset)) <= half + 0.1, `paint ${o} m from the centre line`).toBe(true);
    expect(offsets.size).toBeGreaterThan(0);
    expect(laneCountMapped(district.roads[3]!)).toBe(false);
    expect(paintedLanes(district.roads[3]!).lanes).toBe(2);
    expect(district.roads[3]!.lanes).toBe(4); // the file is not changed
    // The residential street and the service road carry no paint at all, away from the junction.
    for (const [x, , z] of vertices(game, "roadPaint")) {
      if (Math.abs(x) < 3 && Math.abs(z) > 12 && Math.abs(z - 80) > 2) throw new Error(`paint on the residential street at ${x},${z}`);
      if (x < -110 && Math.abs(z - 110) < 1.75) throw new Error(`paint on the service road at ${x},${z}`);
    }
    // All paint lies on a carriageway.
    for (const [x, , z] of vertices(game, "roadPaint")) expect(game.world.roadSurfaces.near(x, z, 0.05), `paint off the road at ${x},${z}`).toBe(true);
    expect(game.world.provenance.roads.get(roadKey(district.roads[3]!))!.markings.rule).toMatch(/lane count is not mapped/);
    expect(game.world.provenance.roads.get(roadKey(district.roads[1]!))!.markings).toEqual({ class: "decorative", rule: "none: residential roads are not marked", pieces: 0 });
    game.dispose();

    // With a mapped lanes tag the dividers are painted.
    const tagged = realismDistrict();
    Object.assign(tagged.roads[3]!, { tags: { highway: "secondary", lanes: "4" }, widthStatus: "source-lanes", widthBasis: "lanes tag x 3.5 m" });
    const withLanes = start(tagged);
    const seen = new Set<number>();
    for (const [x, , z] of vertices(withLanes, "roadPaint")) if (Math.abs(x - AVENUE_X) < 7 && Math.abs(z) > 20 && Math.abs(z) < 120) seen.add(Math.round(Math.abs(x - AVENUE_X)));
    expect(seen.has(3) || seen.has(4)).toBe(true);
    withLanes.dispose();

    // A through road narrower than the limit gets nothing.
    const narrow = realismDistrict();
    Object.assign(narrow.roads[3]!, { width: MARKING_RULES.minWidth - 0.5 });
    const thin = start(narrow);
    expect(vertices(thin, "roadPaint").filter(([x, , z]) => Math.abs(x - AVENUE_X) < 7 && Math.abs(z) > 20 && Math.abs(z) < 120)).toEqual([]);
    thin.dispose();
  });

  it("keeps everything it adds off the roads: verges, gates, piers, station and roof objects", () => {
    const district = realismDistrict();
    const game = start(district);
    const { verges, roadSurfaces, provenance, counts, obstacles } = game.world;
    expect(verges.length).toBeGreaterThan(0);
    expect(verges.every((v) => v.road === "way/23")).toBe(true); // only the through road without a mapped footpath
    for (const [x, y, z] of vertices(game, "concrete")) if (Math.abs(y - VERGE_RULES.height) < 1e-6) expect(roadSurfaces.near(x, z, 0), `verge on a road at ${x},${z}`).toBe(false);
    // The verge breaks where the avenue crosses the other mapped road.
    for (const [x, y, z] of vertices(game, "concrete")) if (Math.abs(y - VERGE_RULES.height) < 1e-6 && Math.abs(x - AVENUE_X) < 12) expect(Math.abs(z)).toBeGreaterThan(4);
    expect(provenance.features.filter((f) => f.kind === "verge").length).toBe(verges.length);
    // Verges are not obstacles: a car may mount the kerb.
    const v = verges[0]!;
    const beside = AVENUE_X + (v.side === 1 ? -1 : 1) * (v.inner + VERGE_RULES.width / 2);
    expect(obstacles.near(beside, (v.points[0]![1] + v.points[1]![1]) / 2, 0.2)).toBe(false);
    // The mapped bollard on the street is recorded but not stood in the traffic.
    expect(counts.barrierPointsOnRoadNotDrawn).toBe(1);
    // Nothing generated above road level lies inside a carriageway, except the viaduct and station far overhead.
    for (const layer of ["plaster", "metal", "concrete"]) for (const [x, y, z] of vertices(game, layer)) {
      if (y < 0.2 || y > 6) continue;
      if (district.roads.some((r) => r.kind === "road" && r.points.some((p, i) => i > 0 && distanceToSegment(x, z, r.points[i - 1]!, p) < r.width / 2 - 0.05))) throw new Error(`${layer} geometry at height ${y.toFixed(2)} inside a carriageway at ${x.toFixed(2)},${z.toFixed(2)}`);
    }
    expect(counts.generatedRailPiers).toBeGreaterThan(3);
    expect(counts.generatedStationCanopies).toBe(1); // two mapped points of one station: one canopy
    const station = provenance.features.find((f) => f.kind === "station")!;
    expect([station.x, station.z, station.position, station.form]).toEqual([20, 131, "source", "decorative"]);
    expect(provenance.features.find((f) => f.kind === "viaduct")!.rule).toMatch(/estimate/);
    // Every decoration and every feature states what it is.
    expect(provenance.features.every((f) => f.rule.length > 0 && PROVENANCE_CLASSES.includes(f.form))).toBe(true);
    expect(provenance.features.filter((f) => f.kind.startsWith("decoration:")).length).toBe(game.world.decorations.length);
    // Traffic still drives through the gates.
    for (let i = 0; i < 600; i++) game.traffic.update(1 / 30, 500, 500);
    expect(game.traffic.activeCount).toBeGreaterThan(0);
    expect(game.traffic.removalCount).toBe(0);
    game.dispose();
  });

  it("plans verges only where the ground beside the road is free", () => {
    const district = realismDistrict();
    expect(planVerges(district, () => false)).toEqual([]);
    const open = planVerges(district, () => true);
    expect(new Set(open.map((r) => r.road))).toEqual(new Set(["way/23"])); // way/20 has mapped footpaths; the others are not through roads
    expect(open.every((r) => r.inner === 7 + VERGE_RULES.inset)).toBe(true);
  });

  it("labels only what the map names, where the map puts it", () => {
    const district = realismDistrict();
    const labels = collectLabels(district);
    const named = new Map<string, [number, number]>([
      ["Alpha 1", [20, 131]],
      ["Test Chowk", [0, 0]],
      ["Test Bank", [35, -40]],
      ["Court House", district.buildings[2]!.centre as [number, number]],
      ["Gate No. 4", GATE_ON_STREET],
    ]);
    for (const [text, [x, z]] of named) {
      const label = labels.find((l) => l.text === text)!;
      expect(label, text).toBeDefined();
      expect([label.x, label.z]).toEqual([x, z]);
    }
    const block = labels.find((l) => l.text === "Block A")!;
    expect(pointInPolygons(block.x, block.z, district.areas.find((a) => a.id === "way/31")!.polygons)).toBe(true);
    expect(labels.map((l) => l.text).sort()).toEqual([...named.keys(), "Block A"].sort());
    // One label per name: the station's two points and the bank's point and building are not doubled.
    expect(labels.filter((l) => l.text === "Alpha 1").map((l) => l.kind)).toEqual(["station"]);
    expect(labels.filter((l) => l.text === "Test Bank").map((l) => l.kind)).toEqual(["poi"]);
    expect(labels.find((l) => l.text === "Test Chowk")!.kind).toBe("place");
    // Every label traces to a mapped feature carrying exactly that name.
    const names = new Map<string, string>();
    for (const f of [...district.pois, ...district.rail.points, ...district.barriers.points, ...district.buildings, ...district.areas]) if (f.tags.name) names.set(f.id, f.tags.name);
    for (const l of labels) expect(names.get(l.source)).toBe(l.text);
    // The sector name, unnamed features and unnamed gates get none; a district without names gets none.
    expect(labels.some((l) => l.source === "way/1" || l.source === "node/72" || l.source === "node/41")).toBe(false);
    expect(collectLabels(testDistrict())).toEqual([]);

    const game = start(district);
    expect(game.world.labels).toEqual(labels);
    for (let i = 0; i < 3; i++) game.renderFrame();
    const shown = game.visibleLabels();
    expect(shown.length).toBeLessThanOrEqual(LABEL_RULES.limit);
    for (const s of shown) {
      expect(labels.some((l) => l.text === s.text)).toBe(true);
      expect(s.distance).toBeLessThanOrEqual(LABEL_RULES.visibleWithin);
      expect(s.x > 0 && s.x < 1 && s.y > 0 && s.y < 1).toBe(true);
    }
    for (let i = 1; i < shown.length; i++) expect(shown[i]!.distance).toBeGreaterThanOrEqual(shown[i - 1]!.distance);
    game.dispose();
  });
});

function distanceToSegment(x: number, z: number, a: Point, b: Point): number {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz);
}
