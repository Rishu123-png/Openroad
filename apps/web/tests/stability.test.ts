import type { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DistrictGame, SETTING_KEYS } from "../src/game/engine/DistrictGame";
import type { GameStats } from "../src/game/engine/GameBase";
import { TRAFFIC } from "../src/game/traffic/TrafficModel";
import type { DistrictData } from "../src/game/district/types";
import { testDistrict } from "./fixtures/district";
import { largeDistrict } from "./fixtures/largeDistrict";
import { checkDistrict } from "./support/districtChecks";
import { keyboard, memory, nullEngine } from "./support/harness";

/**
 * Stability and resource use. Nothing here measures speed: the null engine
 * draws nothing, and frame rate on a test machine says nothing about a
 * player's. These tests count what the scene holds, which is what decides
 * whether it can be fast.
 */
let engine: NullEngine;
let kb: ReturnType<typeof keyboard>;
beforeEach(() => {
  engine = nullEngine();
  engine.getDeltaTime = () => 1000 / 60;
  kb = keyboard();
});
afterEach(() => {
  vi.restoreAllMocks();
  kb.input.dispose();
  engine.dispose();
});

const start = (district: DistrictData, trafficCount?: number, onStats?: (s: GameStats) => void): DistrictGame =>
  new DistrictGame({ engine, input: kb.input, district, settings: memory({ [SETTING_KEYS.vehicle]: "compact-suv" }), trafficCount, onStats });

interface Census {
  meshes: number;
  geometries: number;
  materials: number;
  textures: number;
  nodes: number;
  lights: number;
}
const census = (game: DistrictGame): Census => ({
  meshes: game.scene.meshes.length,
  geometries: game.scene.geometries.length,
  materials: game.scene.materials.length,
  textures: game.scene.textures.length,
  nodes: game.scene.transformNodes.length,
  lights: game.scene.lights.length,
});
const trianglesOf = (meshes: readonly AbstractMesh[]): number => meshes.reduce((sum, m) => sum + ((m as Mesh).getTotalIndices?.() ?? 0) / 3, 0);

describe("large districts", () => {
  it("the grid fixture is itself a sound district", () => {
    expect(checkDistrict(largeDistrict(5, 4))).toEqual([]);
    expect(largeDistrict(5, 4)).toEqual(largeDistrict(5, 4)); // deterministic
  });

  it("batches buildings: sixteen hundred of them cost a few more meshes, no more materials or textures", () => {
    const small = start(largeDistrict(5, 4), 0); // 400 buildings on 350 m
    const a = census(small), aCounts = { ...small.world.counts };
    small.dispose();
    const big = start(largeDistrict(8, 5), 0); // 1600 buildings on 560 m
    const b = census(big), bCounts = big.world.counts;
    expect(aCounts.buildings).toBe(400);
    expect(bCounts.buildings).toBe(1600);

    // Materials and textures belong to the kind of thing drawn, not to how many there are.
    expect(b.materials).toBe(a.materials);
    expect(b.textures).toBe(a.textures);
    expect(b.materials).toBeLessThan(45);
    // Static geometry is merged per material and map tile: far fewer batches than buildings, growing with area and not with count.
    expect(aCounts.staticMeshes).toBeLessThan(60);
    expect(bCounts.staticMeshes).toBeLessThan(120);
    expect(bCounts.staticMeshes! / aCounts.staticMeshes!).toBeLessThan((560 * 560) / (350 * 350) + 0.5); // 4x the buildings on 2.56x the ground
    expect(b.geometries - a.geometries).toBeLessThan(bCounts.staticMeshes! - aCounts.staticMeshes! + 5);
    // No mesh per building anywhere.
    expect(b.meshes).toBeLessThan(1600);
    big.dispose();
  });

  it("keeps every building standing at the largest size, each one solid where it is mapped", () => {
    const district = largeDistrict(8, 5);
    const game = start(district, 0);
    let wrong = 0;
    for (const b of district.buildings) {
      if (game.world.buildingIndex.at(b.centre[0], b.centre[1])?.id !== b.id) wrong++;
      // A point in the street beside it is free.
    }
    expect(wrong).toBe(0);
    for (let k = 0; k <= 8; k++) expect(game.world.buildingIndex.at(k * 70, 35)).toBeNull();
    // Nothing invalid reached the GPU buffers.
    let bad = 0;
    for (const mesh of game.scene.meshes) {
      const positions = (mesh as Mesh).getVerticesData?.("position");
      if (positions) for (let i = 0; i < positions.length; i++) if (!Number.isFinite(positions[i])) bad++;
    }
    expect(bad).toBe(0);
    game.dispose();
  });
});

describe("maximum traffic", () => {
  it("runs forty cars for a minute of game time with every car on a road and none run into from behind", () => {
    const district = largeDistrict(5, 4);
    const game = start(district, 999); // asks for far too many: the limit applies
    game.renderFrame(); // cars are placed on the first frame
    expect(game.traffic.activeCount).toBe(TRAFFIC.maxCount);
    let overlaps = 0, offRoad = 0, invalid = 0, moved = 0;
    const startAt = game.traffic.cars.map((c) => [c.x, c.z]);
    for (let frame = 0; frame < 1800; frame++) {
      game.traffic.update(1 / 30, game.vehicle.x, game.vehicle.z);
      if (frame % 15 !== 0) continue;
      const cars = game.traffic.cars.filter((c) => c.active);
      for (let i = 0; i < cars.length; i++) {
        const c = cars[i]!;
        if (![c.x, c.z, c.heading, c.speed].every(Number.isFinite)) invalid++;
        if (!game.world.roadSurfaces.near(c.x, c.z, 0.5)) offRoad++;
        if (game.world.buildingIndex.at(c.x, c.z)) offRoad++;
        // Cars travelling the same way keep apart on the open road. Junctions are not covered: there is no
        // right-of-way rule yet, so crossing and merging cars can pass through each other there. Known limitation.
        if (district.junctions.some((q) => Math.hypot(q.point[0] - c.x, q.point[1] - c.z) < 12)) continue;
        for (let j = i + 1; j < cars.length; j++) {
          const o = cars[j]!;
          if (Math.cos(c.heading - o.heading) > 0.9 && Math.hypot(c.x - o.x, c.z - o.z) < 1.5) overlaps++;
        }
      }
    }
    game.traffic.cars.forEach((c, i) => void (Math.hypot(c.x - startAt[i]![0]!, c.z - startAt[i]![1]!) > 10 && moved++));
    expect(invalid).toBe(0);
    expect(offRoad).toBe(0);
    expect(overlaps).toBe(0);
    expect(moved).toBeGreaterThan(30); // it is traffic, not a car park: no gridlock
    expect(game.traffic.cars).toHaveLength(TRAFFIC.maxCount);
    game.dispose();
  });

  it("draws forty cars from shared geometry and materials: the cost over twelve is instances only", () => {
    const twelve = start(largeDistrict(5, 4), 12);
    twelve.renderFrame();
    const a = census(twelve);
    twelve.dispose();
    const forty = start(largeDistrict(5, 4), 40);
    forty.renderFrame();
    const b = census(forty);
    expect(b.materials).toBe(a.materials);
    expect(b.textures).toBe(a.textures);
    expect(b.geometries).toBe(a.geometries);
    expect(b.meshes).toBeGreaterThan(a.meshes); // the extra cars are really there
    const added = forty.scene.meshes.slice(a.meshes);
    expect(added.length).toBeGreaterThan(28);
    // Each extra car is instances of the shared parts, plus one mesh of its own for the paint so it can have its own colour. That mesh shares the model's geometry.
    const own = added.filter((m) => m.getClassName() !== "InstancedMesh");
    expect(own.map((m) => m.name.split(":")[1])).toEqual(Array.from({ length: 28 }, () => "paint"));
    expect(added.length).toBeGreaterThan(28 * 4);
    forty.dispose();
  });

  it("gives back what it took when the amount of traffic is turned down, and does not grow when turned up again", () => {
    const game = start(largeDistrict(5, 4), 40);
    game.renderFrame();
    const full = census(game);
    const enabled = (): number => game.scene.meshes.filter((m) => m.isEnabled()).length;
    const shown = enabled();
    game.traffic.setCount(6);
    game.renderFrame();
    expect(game.traffic.activeCount).toBe(6);
    expect(enabled()).toBeLessThan(shown - 34 * 3); // at least body, glass and wheels of 34 cars are no longer drawn
    for (let cycle = 0; cycle < 6; cycle++) {
      game.traffic.setCount(cycle % 2 ? 6 : 40);
      for (let i = 0; i < 5; i++) game.renderFrame();
    }
    game.traffic.setCount(40);
    game.renderFrame();
    expect(census(game)).toEqual(full);
    expect(enabled()).toBe(shown);
    game.dispose();
  });
});

describe("a controlled drive", () => {
  it("holds a steady scene: nothing is created per frame while driving, turning, changing view and vehicle", () => {
    const game = new DistrictGame({ engine, input: kb.input, district: largeDistrict(5, 4), settings: memory(), trafficCount: 40, onGarage: () => {} });
    kb.press("Enter"); // leave the first-visit garage
    for (let i = 0; i < 30; i++) game.renderFrame();
    // Use each control once first: headlights and data views build what they need the first time they are used, and keep it.
    for (const code of ["KeyL", "KeyL", "KeyV", "KeyV", "KeyV", "KeyV", "KeyC", "KeyC", "KeyC", "KeyC"]) {
      kb.press(code);
      game.renderFrame();
    }
    const before = census(game);
    const observers = game.scene.onBeforeRenderObservable.observers.length + game.scene.onAfterRenderObservable.observers.length;
    const listeners = kb.listening;

    // A scripted minute: accelerate, weave, brake, reverse, cycle cameras and data views, toggle lights, reset.
    const script: Array<[number, () => void]> = [
      [0, () => kb.down("KeyW")], [120, () => kb.down("KeyA")], [150, () => kb.up("KeyA")], [200, () => kb.down("KeyD")], [260, () => kb.up("KeyD")],
      [300, () => kb.press("KeyC")], [400, () => kb.press("KeyL")], [500, () => kb.press("KeyV")], [600, () => kb.up("KeyW")], [600, () => kb.down("Space")],
      [700, () => kb.up("Space")], [700, () => kb.down("KeyS")], [900, () => kb.up("KeyS")], [1000, () => kb.press("KeyR")], [1000, () => kb.down("KeyW")],
      [1200, () => kb.press("KeyC")], [1400, () => kb.press("KeyC")], [1600, () => kb.press("KeyV")], [1800, () => kb.press("KeyC")], [2000, () => kb.press("KeyL")],
      [2400, () => kb.press("KeyV")], [2800, () => kb.press("KeyV")], [3200, () => kb.press("KeyR")], [3590, () => kb.up("KeyW")],
    ];
    const samples: Census[] = [];
    let invalid = 0;
    for (let frame = 0; frame < 3600; frame++) {
      for (const [at, act] of script) if (at === frame) act();
      game.renderFrame();
      const v = game.vehicle, p = game.camera.camera.position;
      if (![v.x, v.z, v.heading, v.speed, p.x, p.y, p.z].every(Number.isFinite)) invalid++;
      if (frame % 600 === 599) samples.push(census(game));
    }
    expect(invalid).toBe(0);
    for (const s of samples) expect(s).toEqual(before);
    expect(game.scene.onBeforeRenderObservable.observers.length + game.scene.onAfterRenderObservable.observers.length).toBe(observers);
    expect(kb.listening).toBe(listeners);
    // The player ends inside the district, wherever the script took the car.
    const bounds = game.district.bounds;
    expect(game.vehicle.x).toBeGreaterThanOrEqual(bounds.minX);
    expect(game.vehicle.x).toBeLessThanOrEqual(bounds.maxX);
    expect(game.vehicle.z).toBeGreaterThanOrEqual(bounds.minZ);
    expect(game.vehicle.z).toBeLessThanOrEqual(bounds.maxZ);
    game.dispose();
  });

  it("changing vehicle swaps the model in place: twenty changes leave the scene the size it was", () => {
    const game = new DistrictGame({ engine, input: kb.input, district: testDistrict(), settings: memory(), trafficCount: 12, onGarage: () => {} });
    kb.press("Enter");
    game.renderFrame();
    // Paint materials are made once per colour and kept, so visit both player vehicles before counting.
    for (let i = 0; i < 2; i++) {
      kb.press("KeyG");
      kb.press("ArrowRight");
      kb.press("Enter");
      game.renderFrame();
    }
    const before = census(game);
    for (let i = 0; i < 20; i++) {
      kb.press("KeyG");
      kb.press(i % 3 === 0 ? "ArrowLeft" : "ArrowRight");
      game.renderFrame();
      kb.press("Enter");
      game.renderFrame();
    }
    expect(game.isGarageOpen).toBe(false);
    expect(census(game)).toEqual(before);
    game.dispose();
  });
});

describe("disposal", () => {
  it("releases the whole scene, and ten games in a row leave nothing behind", () => {
    const listeners = kb.listening;
    for (let i = 0; i < 10; i++) {
      const game = start(testDistrict(), 40);
      game.start();
      game.renderFrame();
      const scene = game.scene;
      expect(scene.meshes.length).toBeGreaterThan(100);
      game.dispose();
      expect(scene.isDisposed).toBe(true);
      expect([scene.meshes.length, scene.materials.length, scene.textures.length, scene.geometries.length, scene.transformNodes.length, scene.lights.length, scene.cameras.length]).toEqual([0, 0, 0, 0, 0, 0, 0]);
      expect(engine.scenes).toHaveLength(0);
      expect(engine.activeRenderLoops).toHaveLength(0);
      expect(kb.listening).toBe(listeners);
    }
  });
});

describe("statistics", () => {
  it("reports draw calls, meshes, triangles, speed and traffic as usable numbers, a few times a second", () => {
    let clock = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const reports: GameStats[] = [];
    const game = start(largeDistrict(5, 4), 18, (s) => reports.push(s));
    for (let frame = 0; frame < 120; frame++) {
      clock += 1000 / 60;
      game.renderFrame();
    }
    // Two seconds at four a second, not one per frame.
    expect(reports.length).toBeGreaterThanOrEqual(7);
    expect(reports.length).toBeLessThanOrEqual(9);
    for (const r of reports) {
      for (const value of [r.fps, r.drawCalls, r.activeMeshes, r.triangles, r.speedKmh!, r.traffic!]) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
      expect(Number.isInteger(r.drawCalls) && Number.isInteger(r.activeMeshes) && Number.isInteger(r.triangles)).toBe(true);
      expect(r.traffic).toBe(18);
      expect(r.cameraView).toBe("Chase");
      expect(r.onRoad).toBe(true);
    }
    // Culling works: the camera sees part of the district, not all of it.
    const last = reports.at(-1)!;
    expect(last.activeMeshes).toBeGreaterThan(20);
    expect(last.activeMeshes).toBeLessThan(game.scene.meshes.length);
    expect(last.activeMeshes).toBe(game.scene.getActiveMeshes().length);
    // The null engine draws nothing, so draw calls and triangles are zero here; the browser smoke test checks them on a real renderer.
    // What can be checked: the visible part is a fraction of the triangles the scene holds.
    const visible = trianglesOf(game.scene.getActiveMeshes().data.slice(0, game.scene.getActiveMeshes().length));
    const all = trianglesOf(game.scene.meshes.filter((m) => m.getClassName() === "Mesh"));
    expect(visible).toBeGreaterThan(1000);
    expect(visible).toBeLessThan(all);
    game.dispose();
  });
});
