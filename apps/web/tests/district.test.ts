import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CHASE_VIEWS } from "../src/game/camera/ChaseCamera";
import { BuildingIndex } from "../src/game/district/BuildingIndex";
import { extrudeFootprint } from "../src/game/district/buildingGeometry";
import { DEBUG_VIEWS } from "../src/game/district/DebugViews";
import { DistrictUnavailableError, loadDistrict, parseDistrict } from "../src/game/district/loadDistrict";
import { addDisc, addStrip, offsetLine } from "../src/game/district/roadGeometry";
import { SegmentGrid } from "../src/game/district/SegmentGrid";
import { pointInPolygons, spawnProblem } from "../src/game/district/spawn";
import { DistrictGame } from "../src/game/engine/DistrictGame";
import { GeometryBuffer } from "../src/game/geometry/GeometryBuffer";
import { VEHICLE, VehicleModel } from "../src/game/vehicle/VehicleModel";
import { KeyboardInput } from "../src/input/KeyboardInput";
import { COURT_HOLE, COURT_OUTER, L_SHAPE, testDistrict } from "./fixtures/district";

// Everything here runs on SYNTHETIC fixtures. It checks the code, not the real map.

/** Area of the upward-facing triangles of a buffer at height `y`. */
function flatArea(g: GeometryBuffer, y: number): number {
  let area = 0;
  for (let i = 0; i < g.indices.length; i += 3) {
    const [a, b, c] = [g.indices[i]!, g.indices[i + 1]!, g.indices[i + 2]!];
    if ([a, b, c].some((v) => Math.abs(g.positions[v * 3 + 1]! - y) > 1e-6)) continue;
    const ax = g.positions[a * 3]!, az = g.positions[a * 3 + 2]!;
    area += Math.abs((g.positions[b * 3]! - ax) * (g.positions[c * 3 + 2]! - az) - (g.positions[c * 3]! - ax) * (g.positions[b * 3 + 2]! - az)) / 2;
  }
  return area;
}
const corners = (g: GeometryBuffer, y: number): Set<string> => {
  const out = new Set<string>();
  for (let v = 0; v < g.vertexCount; v++) if (Math.abs(g.positions[v * 3 + 1]! - y) < 1e-6) out.add(`${g.positions[v * 3]},${g.positions[v * 3 + 2]}`);
  return out;
};
const NO_INPUT = { accelerate: false, brake: false, left: false, right: false, handbrake: false };

describe("building geometry", () => {
  it("keeps the mapped footprint: every corner, no others, at ground and roof", () => {
    const g = new GeometryBuffer();
    extrudeFootprint(g, [{ outer: L_SHAPE, holes: [] }], 0, 16, [1, 1, 1], [1, 1, 1]);
    const expected = new Set(L_SHAPE.map((p) => `${p[0]},${p[1]}`));
    expect(corners(g, 16)).toEqual(expected);
    expect(corners(g, 0)).toEqual(expected);
    expect(flatArea(g, 16)).toBeCloseTo(40 * 14 + 15 * 22, 6);
    // Six walls, each exactly as long as its footprint edge.
    let wallArea = 0;
    for (let i = 1; i < L_SHAPE.length; i++) wallArea += Math.hypot(L_SHAPE[i]![0] - L_SHAPE[i - 1]![0], L_SHAPE[i]![1] - L_SHAPE[i - 1]![1]) * 16;
    expect(g.indices.length / 3).toBe(6 * 2 + 4); // 12 wall triangles and 4 roof triangles
    expect(wallArea).toBe(152 * 16);
  });

  it("keeps a relation's courtyard open and walls it on the inside", () => {
    const g = new GeometryBuffer();
    extrudeFootprint(g, [{ outer: COURT_OUTER, holes: [COURT_HOLE] }], 0, 10, [1, 1, 1], [1, 1, 1]);
    expect(flatArea(g, 10)).toBeCloseTo(60 * 44 - 24 * 16, 6);
    // Courtyard walls face into the courtyard: the wall on its west side faces east.
    let found = false;
    for (let v = 0; v < g.vertexCount; v++) {
      if (g.positions[v * 3] === -62 && g.positions[v * 3 + 2]! > 34 && g.positions[v * 3 + 2]! < 50 === false) continue;
      if (g.positions[v * 3] === -62 && g.normals[v * 3 + 1] === 0 && Math.abs(g.normals[v * 3 + 2]!) < 1e-9) {
        expect(g.normals[v * 3]).toBe(1);
        found = true;
      }
    }
    expect(found).toBe(true);
  });
});

describe("road geometry", () => {
  it("offsets a centre line to both sides and mitres a right-angle bend", () => {
    const line = [[0, 0], [10, 0], [10, 10]] as const;
    const left = offsetLine(line, 2), right = offsetLine(line, -2);
    expect(left[0]).toEqual([0, 2]);
    expect(right[0]).toEqual([0, -2]);
    expect(left[1]![0]).toBeCloseTo(8);
    expect(left[1]![1]).toBeCloseTo(2);
    expect(right[1]![0]).toBeCloseTo(12);
    expect(right[1]![1]).toBeCloseTo(-2);
    expect(left[2]![0]).toBeCloseTo(8);
  });

  it("turns a centre line into a surface of the stated width", () => {
    const g = new GeometryBuffer();
    addStrip(g, [[0, 0], [50, 0], [50, 30]], 3, -3, 0.03, [1, 1, 1]);
    expect(flatArea(g, 0.03)).toBeCloseTo(80 * 6, 4);
    const disc = new GeometryBuffer();
    addDisc(disc, 5, 5, 4, 0.03, [1, 1, 1], 64);
    expect(flatArea(disc, 0.03)).toBeGreaterThan(Math.PI * 16 * 0.99);
  });

  it("closes a loop without a gap", () => {
    const loop = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]] as const;
    const out = offsetLine(loop, -1);
    expect(out[0]![0]).toBeCloseTo(out[4]![0]);
    expect(out[0]![1]).toBeCloseTo(out[4]![1]);
    expect(out[0]![0]).toBeCloseTo(-1);
    expect(out[0]![1]).toBeCloseTo(-1);
  });
});

describe("collision and vehicle", () => {
  const bounds = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };

  it("pushes a circle out of a wall", () => {
    const grid = new SegmentGrid();
    grid.add(-10, 5, 10, 5);
    expect(grid.pushOut(0, 4.5, 1)).toBe(true);
    expect(grid.outZ).toBeCloseTo(4);
    expect(grid.pushOut(0, 2, 1)).toBe(false);
    expect(grid.near(0, 5.5, 1)).toBe(true);
    expect(grid.near(0, 9, 1)).toBe(false);
  });

  it("accelerates, steers right toward +X, brakes and reverses", () => {
    const road = new SegmentGrid();
    road.add(0, -100, 0, 100, 50);
    const car = new VehicleModel(bounds, new SegmentGrid(), road);
    car.place(0, 0, 0);
    for (let i = 0; i < 120; i++) car.update({ ...NO_INPUT, accelerate: true }, 1 / 60);
    expect(car.z).toBeGreaterThan(5);
    expect(car.x).toBeCloseTo(0);
    expect(car.speed).toBeGreaterThan(5);
    for (let i = 0; i < 60; i++) car.update({ ...NO_INPUT, accelerate: true, right: true }, 1 / 60);
    expect(car.heading).toBeGreaterThan(0.2);
    expect(car.x).toBeGreaterThan(0.5);
    for (let i = 0; i < 240; i++) car.update({ ...NO_INPUT, brake: true }, 1 / 60);
    expect(car.speed).toBeLessThan(0);
    expect(car.speed).toBeGreaterThanOrEqual(-VEHICLE.maxReverse);
    for (let i = 0; i < 600; i++) car.update({ ...NO_INPUT, accelerate: true }, 1 / 60);
    expect(car.speed).toBeLessThanOrEqual(VEHICLE.maxSpeed);
  });

  it("is stopped by a building wall and by the edge of the district, at any frame rate", () => {
    for (const dt of [1 / 144, 1 / 60, 1 / 12]) {
      const walls = new SegmentGrid();
      walls.add(-20, 30, 20, 30);
      const road = new SegmentGrid();
      road.add(0, -100, 0, 100, 50);
      const car = new VehicleModel(bounds, walls, road);
      car.place(0, -60, 0);
      for (let t = 0; t < 20; t += dt) car.update({ ...NO_INPUT, accelerate: true }, dt);
      expect(car.z).toBeLessThan(30 - VEHICLE.collisionOffset - VEHICLE.collisionRadius + 0.05);
      expect(car.z).toBeGreaterThan(20);

      const free = new VehicleModel(bounds, new SegmentGrid(), road);
      free.place(0, 0, Math.PI / 2);
      for (let t = 0; t < 40; t += dt) free.update({ ...NO_INPUT, accelerate: true }, dt);
      expect(free.x).toBeLessThanOrEqual(bounds.maxX - 3);
      expect(free.x).toBeGreaterThan(90);
    }
  });

  it("is slower off the mapped roads", () => {
    const run = (road: SegmentGrid): number => {
      const car = new VehicleModel({ minX: -5000, maxX: 5000, minZ: -5000, maxZ: 5000 }, new SegmentGrid(), road);
      car.place(0, 0, 0);
      for (let i = 0; i < 900; i++) car.update({ ...NO_INPUT, accelerate: true }, 1 / 60);
      return car.speed;
    };
    const road = new SegmentGrid();
    road.add(0, -5000, 0, 5000, 4);
    expect(run(road)).toBeGreaterThan(16);
    expect(run(new SegmentGrid())).toBeLessThan(10);
  });
});

describe("spawn", () => {
  it("accepts a spawn on the road and rejects one in a building or outside the district", () => {
    const d = testDistrict();
    expect(spawnProblem(d)).toBeNull();
    expect(spawnProblem({ ...d, spawn: { ...d.spawn, x: 30, z: -40 } })).toMatch(/inside building way\/10/);
    expect(spawnProblem({ ...d, spawn: { ...d.spawn, x: 400 } })).toMatch(/outside the district/);
    // The courtyard of the relation building is open ground, not "inside".
    expect(spawnProblem({ ...d, spawn: { ...d.spawn, x: -50, z: 42 } })).toBeNull();
    expect(spawnProblem({ ...d, spawn: { ...d.spawn, x: -75, z: 42 } })).toMatch(/relation\/12/);
    const index = new BuildingIndex(d.buildings);
    expect(index.at(30, -40)?.id).toBe("way/10");
    expect(index.at(0, 0)).toBeNull();
  });
});

describe("district file", () => {
  it("rejects files that are not districts and explains a missing file", async () => {
    expect(() => parseDistrict({ kind: "something" })).toThrow(DistrictUnavailableError);
    expect(() => parseDistrict({ kind: "district", formatVersion: 2 })).toThrow(/format 2/);
    expect(parseDistrict(testDistrict()).id).toBe("test");
    const html = (async () => new Response("<html>", { headers: { "content-type": "text/html" } })) as typeof fetch;
    await expect(loadDistrict("/x.json", html)).rejects.toThrow(/build-district/);
    const good = (async () => new Response(JSON.stringify(testDistrict()), { headers: { "content-type": "application/json" } })) as typeof fetch;
    expect((await loadDistrict("/x.json", good)).buildings).toHaveLength(3);
  });
});

describe("DistrictGame", () => {
  let engine: NullEngine;
  let keys: EventTarget;
  let input: KeyboardInput;
  const key = (type: "keydown" | "keyup", code: string): void => void keys.dispatchEvent(Object.assign(new Event(type), { code }));
  const frames = (game: DistrictGame, n: number): void => {
    for (let i = 0; i < n; i++) game.renderFrame();
  };

  beforeEach(() => {
    engine = new NullEngine({ renderWidth: 320, renderHeight: 180, textureSize: 64, deterministicLockstep: true, lockstepMaxSteps: 4 });
    keys = new EventTarget();
    input = new KeyboardInput(keys);
  });
  afterEach(() => {
    input.dispose();
    engine.dispose();
  });

  it("builds one extrusion per mapped building and nothing twice", () => {
    const district = testDistrict();
    const game = new DistrictGame({ engine, input, district });
    const { counts } = game.world;
    expect(counts.buildings).toBe(3);
    expect(counts["buildings:house"]).toBe(1);
    expect(counts["height:estimated"]).toBe(1);
    expect(counts["height:source-height"]).toBe(1);
    expect(counts["height:source-levels"]).toBe(1);
    // Roof area over all building meshes equals the footprints, so no footprint was built twice.
    const heights = new Map(district.buildings.map((b) => [b.height, b]));
    let roofArea = 0;
    for (const mesh of game.scene.meshes.filter((m) => m.name.startsWith("plaster@"))) {
      const p = mesh.getVerticesData(VertexBuffer.PositionKind)!, n = mesh.getVerticesData(VertexBuffer.NormalKind)!, idx = mesh.getIndices()!;
      for (let i = 0; i < idx.length; i += 3) {
        const [a, b, c] = [idx[i]!, idx[i + 1]!, idx[i + 2]!];
        if (n[a * 3 + 1]! < 0.99 || !heights.has(p[a * 3 + 1]!)) continue;
        roofArea += Math.abs((p[b * 3]! - p[a * 3]!) * (p[c * 3 + 2]! - p[a * 3 + 2]!) - (p[c * 3]! - p[a * 3]!) * (p[b * 3 + 2]! - p[a * 3 + 2]!)) / 2;
      }
    }
    expect(roofArea).toBeCloseTo(30 * 40 + (40 * 14 + 15 * 22) + (60 * 44 - 24 * 16), 3);
    expect(counts.roads).toBe(2);
    expect(counts.paths).toBe(1);
    expect(counts.intersections).toBe(1);
    expect(counts.sidewalkRoads).toBe(1);
    expect(counts.mappedTrees).toBe(1);
    expect(counts.mappedLamps).toBe(1);
    game.dispose();
  });

  it("opens mapped walls at gates and where a mapped road crosses", () => {
    const game = new DistrictGame({ engine, input, district: testDistrict() });
    const { obstacles, counts } = game.world;
    expect(counts.barrierOpenings).toBeGreaterThanOrEqual(5);
    expect(obstacles.near(0, -80, 1)).toBe(false); // the road
    expect(obstacles.near(60, -80, 1)).toBe(false); // the gate
    expect(obstacles.near(30, -80, 1)).toBe(true); // the wall
    game.dispose();
  });

  it("marks generated decoration and keeps it off roads and out of buildings", () => {
    const district = testDistrict();
    const a = new DistrictGame({ engine, input, district });
    const { decorations, roadSurfaces, counts } = a.world;
    expect(decorations.length).toBeGreaterThan(5);
    expect(decorations.every((d) => d.generated === true && d.rule.length > 0)).toBe(true);
    expect(counts.generatedTrees! + counts.generatedLights!).toBe(decorations.length);
    for (const d of decorations) {
      expect(roadSurfaces.near(d.x, d.z, 0)).toBe(false);
      expect(district.buildings.some((b) => pointInPolygons(d.x, d.z, b.polygons))).toBe(false);
      expect(Math.abs(d.x) < 150 && Math.abs(d.z) < 150).toBe(true);
    }
    // Generated and mapped objects use separate templates, so they can be told apart.
    expect(a.scene.meshes.some((m) => m.name.startsWith("generatedTree_"))).toBe(true);
    expect(a.scene.meshes.some((m) => m.name.startsWith("mappedTree_"))).toBe(true);
    const b = new DistrictGame({ engine, input, district: testDistrict() });
    expect(b.world.decorations).toEqual(decorations);
    a.dispose();
    b.dispose();
  });

  it("starts the vehicle on the mapped road and drives it with the keyboard", () => {
    const district = testDistrict();
    const game = new DistrictGame({ engine, input, district });
    expect([game.vehicle.x, game.vehicle.z]).toEqual([0, -40]);
    expect(game.world.roadSurfaces.near(game.vehicle.x, game.vehicle.z, 0)).toBe(true);
    expect(game.world.buildingIndex.at(game.vehicle.x, game.vehicle.z)).toBeNull();
    expect(game.scene.activeCamera).toBe(game.camera.camera);
    // The camera sits behind and above the vehicle, looking the way it faces.
    expect(game.camera.camera.position.z).toBeLessThan(-45);
    expect(game.camera.camera.position.y).toBeGreaterThan(2);

    key("keydown", "KeyW");
    for (let i = 0; i < 200; i++) game.vehicle.update({ ...NO_INPUT, accelerate: input.isDown("accelerate") }, 1 / 60);
    frames(game, 2);
    expect(game.vehicle.z).toBeGreaterThan(-35);
    expect(game.vehicleMesh.position.z).toBeCloseTo(game.vehicle.z);
    expect(game.vehicle.onRoad).toBe(true);
    key("keyup", "KeyW");

    key("keydown", "KeyR");
    key("keyup", "KeyR");
    expect([game.vehicle.x, game.vehicle.z, game.vehicle.speed]).toEqual([0, -40, 0]);
    game.dispose();
  });

  it("refuses to start with a spawn point inside a building", () => {
    const district = testDistrict();
    district.spawn = { ...district.spawn, x: 30, z: -40 };
    expect(() => new DistrictGame({ engine, input, district })).toThrow(/inside building way\/10/);
  });

  it("cycles camera views and data views, and restores the normal look", () => {
    const game = new DistrictGame({ engine, input, district: testDistrict() });
    const mesh = game.scene.meshes.find((m) => m.name.startsWith("plaster@"))!;
    const normal = Array.from(new Float32Array(mesh.getVerticesData(VertexBuffer.ColorKind)!)); // as stored on the GPU
    const material = mesh.material;
    const names = [game.world.debug.view.name];
    for (let i = 1; i < DEBUG_VIEWS.length; i++) {
      key("keydown", "KeyV");
      key("keyup", "KeyV");
      names.push(game.world.debug.view.name);
      expect(Array.from(mesh.getVerticesData(VertexBuffer.ColorKind)!)).not.toEqual(normal);
      expect(game.scene.getMeshByName("sectorOutline")!.isEnabled()).toBe(i === 3);
    }
    expect(names).toEqual(DEBUG_VIEWS.map((v) => v.name));
    // In the "Data source" view generated decoration is magenta and mapped objects are cyan.
    expect(game.scene.getMeshByName("generatedTree101")!.material!.name).toBe("debugGenerated");
    expect(game.scene.getMeshByName("mappedTree101")!.material!.name).toBe("debugMapped");
    key("keydown", "KeyV");
    key("keyup", "KeyV");
    expect(Array.from(mesh.getVerticesData(VertexBuffer.ColorKind)!)).toEqual(normal);
    expect(mesh.material).toBe(material);
    expect(game.scene.getMeshByName("generatedTree101")!.material!.name).toBe("foliageMaterial");

    const views = [];
    for (let i = 0; i < CHASE_VIEWS.length; i++) {
      views.push(game.camera.viewName);
      key("keydown", "KeyC");
      key("keyup", "KeyC");
    }
    expect(views).toEqual(CHASE_VIEWS.map((v) => v.name));
    game.dispose();
    expect(game.isDisposed).toBe(true);
  });
});
