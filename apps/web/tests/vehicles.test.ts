import type { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SegmentGrid } from "../src/game/district/SegmentGrid";
import { DistrictGame } from "../src/game/engine/DistrictGame";
import { buildCarGeometry, buildWheel } from "../src/game/vehicle/models/carGeometry";
import { CarFactory } from "../src/game/vehicle/models/CarVisual";
import { ALL_CARS, COMPACT_SEDAN, COMPACT_SUV, HATCHBACK, LARGE_SUV, PLAYER_CARS, TRAFFIC_CARS, TRAFFIC_PAINTS, type CarSpec } from "../src/game/vehicle/models/carSpecs";
import { VEHICLE, VehicleModel } from "../src/game/vehicle/VehicleModel";
import { testDistrict } from "./fixtures/district";
import { keyboard, meshProblems, nullEngine, triangleAreas } from "./support/harness";

let engine: NullEngine;
beforeEach(() => {
  engine = nullEngine();
});
afterEach(() => engine.dispose());

const BODY_PARTS = ["paint", "glass", "detail", "lamps", "brake"] as const;

/** Extent of the body (everything except wheels) straight from the generated geometry. */
function bodyExtent(spec: CarSpec) {
  const g = buildCarGeometry(spec);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const name of BODY_PARTS) {
    const p = g[name].positions;
    for (let i = 0; i < p.length; i++) {
      min[i % 3] = Math.min(min[i % 3]!, p[i]!);
      max[i % 3] = Math.max(max[i % 3]!, p[i]!);
    }
  }
  return { g, min, max, size: max.map((v, i) => v - min[i]!) };
}

describe("vehicle geometry", () => {
  it("builds every model to its stated length and height, centred, with the body no wider than body plus mirrors", () => {
    for (const spec of ALL_CARS) {
      const { min, max, size } = bodyExtent(spec);
      expect(size[2], `${spec.id} length`).toBeCloseTo(spec.length, 1);
      expect(max[1], `${spec.id} height`).toBeCloseTo(spec.height, 1);
      expect(min[1], `${spec.id} underside`).toBeGreaterThanOrEqual(spec.clearance - 0.03);
      // Symmetric about the centre line, and centred fore and aft.
      expect(min[0]! + max[0]!, `${spec.id} symmetry`).toBeCloseTo(0, 2);
      expect(min[2]! + max[2]!, `${spec.id} centring`).toBeCloseTo(0, 1);
      expect(size[0]).toBeGreaterThanOrEqual(spec.width - 0.02);
      expect(size[0]).toBeLessThan(spec.width + 0.45);
    }
  });

  it("matches the reference dimensions the two player models are scaled from", () => {
    expect([COMPACT_SUV.length, COMPACT_SUV.width, COMPACT_SUV.height]).toEqual([4.33, 1.79, 1.635]);
    expect([COMPACT_SEDAN.length, COMPACT_SEDAN.width, COMPACT_SEDAN.height]).toEqual([3.995, 1.735, 1.515]);
    // The painted body below the mirrors is as wide as stated; door handles stand 3 cm proud of it.
    for (const spec of PLAYER_CARS) {
      const p = buildCarGeometry(spec).paint.positions;
      let half = 0;
      for (let i = 0; i < p.length; i += 3) if (p[i + 1]! < spec.height * 0.55) half = Math.max(half, Math.abs(p[i]!));
      expect(half * 2, `${spec.id} body width`).toBeGreaterThan(spec.width - 0.03);
      expect(half * 2, `${spec.id} body width`).toBeLessThan(spec.width + 0.07);
    }
  });

  it("makes four different silhouettes, not one body resized", () => {
    // Roof height at fixed fractions of the length, tail to nose, relative to the car's own height.
    const outline = (spec: CarSpec): number[] => {
      const { g } = bodyExtent(spec);
      const p = [...g.paint.positions, ...g.glass.positions];
      return [0.06, 0.14, 0.3, 0.5, 0.7, 0.9].map((t) => {
        const z = -spec.length / 2 + t * spec.length;
        let top = 0;
        for (let i = 0; i < p.length; i += 3) if (Math.abs(p[i + 2]! - z) < spec.length * 0.045) top = Math.max(top, p[i + 1]!);
        return top / spec.height;
      });
    };
    const shapes = new Map(ALL_CARS.map((s) => [s.id, outline(s)]));
    // The sedan is the only one with a boot: low over the tail, full height over the cabin.
    expect(shapes.get("compact-sedan")![0]).toBeLessThan(0.75);
    for (const id of ["compact-suv", "hatchback", "large-suv"]) expect(shapes.get(id)![1], id).toBeGreaterThan(0.85);
    for (const [id, s] of shapes) expect(s[3], `${id} roof`).toBeGreaterThan(0.95);
    // Every pair differs somewhere by a clear margin.
    const ids = [...shapes.keys()];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = shapes.get(ids[i]!)!, b = shapes.get(ids[j]!)!;
        const difference = Math.max(...a.map((v, k) => Math.abs(v - b[k]!)));
        const sizeDifference = Math.abs(ALL_CARS[i]!.length - ALL_CARS[j]!.length) + Math.abs(ALL_CARS[i]!.height - ALL_CARS[j]!.height);
        expect(difference > 0.04 || sizeDifference > 0.3, `${ids[i]} against ${ids[j]}`).toBe(true);
      }
    }
    expect(LARGE_SUV.length).toBeGreaterThan(COMPACT_SUV.length);
    expect(HATCHBACK.length).toBeLessThan(COMPACT_SEDAN.length);
  });

  it("generates sound meshes: finite numbers, valid indices, unit normals, no collapsed triangles", () => {
    for (const spec of ALL_CARS) {
      const g = buildCarGeometry(spec);
      for (const name of [...BODY_PARTS, "wheel"] as const) {
        const part = g[name];
        expect(meshProblems(`${spec.id}:${name}`, part)).toEqual([]);
        expect(part.indices.length, `${spec.id}:${name}`).toBeGreaterThan(0);
        const areas = triangleAreas(part.positions, part.indices);
        const collapsed = areas.filter((a) => a < 1e-9).length;
        expect(collapsed, `${spec.id}:${name} collapsed triangles`).toBe(0);
      }
      // Colours are present per vertex where a part carries them, and stay in range.
      for (const name of ["detail", "lamps"] as const) {
        const c = g[name].colors;
        expect(c.length / 4 === g[name].positions.length / 3 || c.length / 3 === g[name].positions.length / 3, `${spec.id}:${name} colours`).toBe(true);
        expect(c.every((v) => v >= 0 && v <= 1.0001)).toBe(true);
      }
    }
  });

  it("faces outward: body panels point away from the middle of the car", () => {
    for (const spec of ALL_CARS) {
      const g = buildCarGeometry(spec);
      const p = g.paint.positions, n = g.paint.normals;
      let outward = 0, counted = 0;
      for (let i = 0; i < p.length; i += 3) {
        // Side panels only: clearly to one side, with a mostly sideways normal.
        if (Math.abs(p[i]!) < spec.width * 0.35 || Math.abs(n[i]!) < 0.8) continue;
        counted++;
        if (Math.sign(n[i]!) === Math.sign(p[i]!)) outward++;
      }
      expect(counted, spec.id).toBeGreaterThan(20);
      expect(outward / counted, `${spec.id} outward side normals`).toBeGreaterThan(0.9);
    }
  });

  it("puts lamps where they belong: tail lamps at the back, headlamps at the front, both sides", () => {
    for (const spec of ALL_CARS) {
      const g = buildCarGeometry(spec);
      const brake = g.brake.positions;
      let left = false, right = false;
      for (let i = 0; i < brake.length; i += 3) {
        // Everything red is in the rear of the car (the high-level stop lamp sits at the rear window)...
        expect(brake[i + 2]!, `${spec.id} red lamp z`).toBeLessThan(-spec.length * 0.15);
        if (Math.abs(brake[i]!) < spec.width * 0.25) continue;
        // ...and the corner lamps are at the very back.
        expect(brake[i + 2]!, `${spec.id} corner lamp z`).toBeLessThan(-spec.length * 0.4);
        if (brake[i]! < 0) left = true;
        else right = true;
      }
      expect(left && right, `${spec.id} tail lamps on both sides`).toBe(true);
      expect(g.headlamps).toHaveLength(2);
      expect(g.headlamps[0]![0]).toBeCloseTo(-g.headlamps[1]![0], 5);
      for (const lamp of g.headlamps) {
        expect(lamp[2]).toBeGreaterThan(spec.length * 0.35);
        expect(lamp[2]).toBeLessThanOrEqual(spec.length / 2 + 0.05);
        expect(lamp[1]).toBeGreaterThan(spec.clearance);
        expect(lamp[1]).toBeLessThan(spec.height * 0.75);
        expect(Math.abs(lamp[0])).toBeLessThan(spec.width / 2);
      }
    }
  });
});

describe("wheels", () => {
  it("stand at the four corners: on the ground, a wheelbase apart, inside the body", () => {
    for (const spec of ALL_CARS) {
      const centres = buildCarGeometry(spec).wheelCentres;
      expect(centres).toHaveLength(4);
      for (const c of centres) {
        expect(c[1], `${spec.id} axle height`).toBeCloseTo(spec.wheelRadius, 5); // tyre touches y = 0
        expect(Math.abs(c[0]) + spec.tyreWidth / 2, `${spec.id} tyre within body`).toBeLessThanOrEqual(spec.width / 2 + 0.03);
        expect(Math.abs(c[0])).toBeGreaterThan(spec.width * 0.36);
      }
      const front = centres.filter((c) => c[2] > 0), rear = centres.filter((c) => c[2] < 0);
      expect([front.length, rear.length]).toEqual([2, 2]);
      expect(front[0]![2] - rear[0]![2], `${spec.id} wheelbase`).toBeCloseTo(spec.wheelbase, 3);
      expect(spec.length / 2 - front[0]![2], `${spec.id} front overhang`).toBeCloseTo(spec.frontOverhang, 3);
      for (const pair of [front, rear]) expect(pair[0]![0]).toBeCloseTo(-pair[1]![0], 5);
      // The first two are the steered pair; CarVisual relies on that order.
      expect(centres[0]![2]).toBeGreaterThan(0);
      expect(centres[1]![2]).toBeGreaterThan(0);
      // Tyres clear the arches: the wheel is smaller than the space under the body allows.
      expect(spec.wheelRadius * 2).toBeLessThan(spec.height * 0.5);
    }
  });

  it("are round, of the stated radius and width, with the stated spokes changing the mesh", () => {
    const wheel = buildWheel(0.345, 0.215, 5);
    const p = wheel.positions;
    let radius = 0, minX = Infinity, maxX = -Infinity;
    for (let i = 0; i < p.length; i += 3) {
      radius = Math.max(radius, Math.hypot(p[i + 1]!, p[i + 2]!));
      minX = Math.min(minX, p[i]!);
      maxX = Math.max(maxX, p[i]!);
    }
    expect(radius).toBeCloseTo(0.345, 2);
    expect(maxX - minX).toBeCloseTo(0.215, 1);
    expect(buildWheel(0.345, 0.215, 8).indices.length).not.toBe(wheel.indices.length);
    expect(meshProblems("wheel", wheel)).toEqual([]);
  });

  it("turn about the axle with distance, backwards in reverse, and only the front pair steers", () => {
    const scene = new Scene(engine);
    for (const spec of ALL_CARS) {
      const car = new CarFactory(scene).create(spec, `w_${spec.id}`, spec.paint);
      const wheels = car.root.getChildMeshes().filter((m) => /:wheel\d$/.test(m.name)).sort((a, b) => a.name.localeCompare(b.name));
      expect(wheels).toHaveLength(4);
      const restYaw = wheels.map((w) => w.rotation.y);

      car.place(0, 0, 0, 0, 1.5, 0.3);
      const spin = 1.5 / spec.wheelRadius;
      expect(car.wheelSpin).toBeCloseTo(spin % (Math.PI * 2), 6);
      // Right and left wheels are mirrored, so their local rotations are opposite: both roll forward.
      expect(wheels[0]!.rotation.x).toBeCloseTo(-wheels[1]!.rotation.x, 6);
      expect(Math.abs(wheels[2]!.rotation.x)).toBeCloseTo(car.wheelSpin, 6);
      expect(wheels[0]!.rotation.y - restYaw[0]!).toBeCloseTo(0.3, 6);
      expect(wheels[1]!.rotation.y - restYaw[1]!).toBeCloseTo(0.3, 6);
      expect(wheels[2]!.rotation.y).toBe(restYaw[2]);
      expect(wheels[3]!.rotation.y).toBe(restYaw[3]);

      car.place(0, 0, 0, 0, -1.5, 0);
      expect(car.wheelSpin).toBeCloseTo(0, 6);
      expect(wheels[0]!.rotation.y).toBeCloseTo(restYaw[0]!, 6); // straightens
      // A very long drive keeps the angle bounded, so precision does not decay.
      for (let i = 0; i < 5000; i++) car.place(0, 0, 0, 0, 0.4);
      expect(Math.abs(car.wheelSpin)).toBeLessThan(Math.PI * 2);
      // Position and heading are applied to the whole car.
      car.place(12, 0.03, -7, 1.2);
      expect(car.root.position.asArray()).toEqual([12, 0.03, -7]);
      expect(car.root.rotation.y).toBe(1.2);
    }
  });
});

describe("vehicles in a scene", () => {
  it("shares geometry and materials: twenty cars of four models cost four sets of meshes", () => {
    const scene = new Scene(engine);
    const factory = new CarFactory(scene);
    for (const spec of ALL_CARS) factory.create(spec, `first_${spec.id}`, TRAFFIC_PAINTS[0]!);
    const geometries = scene.geometries.length, materials = scene.materials.length, textures = scene.textures.length;
    const meshesBefore = scene.meshes.length, nodesBefore = scene.transformNodes.length;
    const cars = [];
    for (let i = 0; i < 20; i++) cars.push(factory.create(TRAFFIC_CARS[i % TRAFFIC_CARS.length]!, `car_${i}`, TRAFFIC_PAINTS[i % 3]!));
    expect(scene.geometries.length).toBe(geometries); // no new vertex data
    expect(scene.textures.length).toBe(textures);
    expect(scene.materials.length - materials).toBeLessThanOrEqual(2); // only the two extra paint colours
    expect(factory.paint([0.1, 0.2, 0.3])).toBe(factory.paint([0.1, 0.2, 0.3]));

    // Removing them returns the scene to where it was; templates survive for the next car.
    expect(scene.meshes.length).toBeGreaterThan(meshesBefore + 20 * 8);
    for (const car of cars) car.dispose();
    expect(scene.meshes.length).toBe(meshesBefore);
    expect(scene.transformNodes.length).toBe(nodesBefore);
    expect(scene.geometries.length).toBe(geometries);
    const again = factory.create(COMPACT_SUV, "again", COMPACT_SUV.paint);
    expect(again.root.getChildMeshes().length).toBeGreaterThan(8);
  });

  it("removes every mesh of a disposed car and its private tail-lamp material", () => {
    const scene = new Scene(engine);
    const factory = new CarFactory(scene);
    factory.create(COMPACT_SUV, "keep", COMPACT_SUV.paint); // templates and one paint now exist
    const before = { meshes: scene.meshes.length, materials: scene.materials.length, nodes: scene.transformNodes.length };
    for (let i = 0; i < 25; i++) {
      const car = factory.create(COMPACT_SUV, `p${i}`, COMPACT_SUV.paint, true);
      expect(scene.meshes.length).toBeGreaterThan(before.meshes);
      car.dispose();
    }
    expect({ meshes: scene.meshes.length, materials: scene.materials.length, nodes: scene.transformNodes.length }).toEqual(before);
    expect(factory.tailLamps.getScene()).toBe(scene);
    expect(scene.materials).toContain(factory.tailLamps); // the shared one is untouched
  });

  it("lights only its own tail lamps when braking", () => {
    const scene = new Scene(engine);
    const factory = new CarFactory(scene);
    const player = factory.create(COMPACT_SEDAN, "player", COMPACT_SEDAN.paint, true);
    const other = factory.create(COMPACT_SEDAN, "other", TRAFFIC_PAINTS[1]!);
    const lamp = (name: string): PBRMaterial => scene.getMeshByName(`${name}:brake`)!.material as PBRMaterial;
    const sourceLamp = (name: string): PBRMaterial => {
      const mesh = scene.getMeshByName(`${name}:brake`)! as unknown as { sourceMesh?: { material: PBRMaterial }; material: PBRMaterial };
      return mesh.sourceMesh ? mesh.sourceMesh.material : mesh.material;
    };
    expect(lamp("player")).not.toBe(factory.tailLamps);
    const dim = lamp("player").albedoColor.r;
    player.setBraking(true);
    expect(player.isBraking).toBe(true);
    expect(lamp("player").albedoColor.r).toBeGreaterThan(dim * 2);
    expect(sourceLamp("other").albedoColor.r).toBeCloseTo(dim, 5); // traffic did not light up with the player
    expect(other.isBraking).toBe(false);
    player.setBraking(false);
    expect(lamp("player").albedoColor.r).toBeCloseTo(dim, 5);
  });

  it("uses physically sensible materials: clear glass, metallic clear-coated paint, unlit lamps", () => {
    const scene = new Scene(engine);
    const factory = new CarFactory(scene);
    const car = factory.create(COMPACT_SUV, "m", COMPACT_SUV.paint);
    expect(factory.glass.alpha).toBeGreaterThan(0.3);
    expect(factory.glass.alpha).toBeLessThan(0.85);
    expect(factory.glass.roughness).toBeLessThan(0.15);
    const paint = car.body.material as PBRMaterial;
    expect(paint.albedoColor.asArray().map((v) => +v.toFixed(3))).toEqual([...COMPACT_SUV.paint]);
    expect(paint.clearCoat.isEnabled).toBe(true);
    for (const m of [paint, factory.detail]) {
      expect(m.metallic).toBeGreaterThanOrEqual(0);
      expect(m.metallic).toBeLessThanOrEqual(1);
      expect(m.roughness).toBeGreaterThan(0);
      expect(m.roughness).toBeLessThanOrEqual(1);
    }
    expect(factory.lamps.unlit).toBe(true);
    for (const colour of TRAFFIC_PAINTS) expect(colour.every((v) => v >= 0 && v <= 1)).toBe(true);
    // Whites and silvers are listed twice on purpose (they are the commonest); there are still several distinct colours.
    expect(new Set(TRAFFIC_PAINTS.map((c) => c.join())).size).toBeGreaterThanOrEqual(6);
    // No mesh under the car can be picked or carries a non-finite bound.
    for (const mesh of car.root.getChildMeshes()) {
      expect(mesh.isPickable).toBe(false);
      mesh.computeWorldMatrix(true);
      const box = mesh.getBoundingInfo().boundingBox;
      expect([...box.minimumWorld.asArray(), ...box.maximumWorld.asArray()].every(Number.isFinite)).toBe(true);
    }
  });
});

describe("vehicle collision bounds", () => {
  it("cover the selected model: two circles spanning its length and width within 30 cm", () => {
    const kb = keyboard();
    const game = new DistrictGame({ engine, input: kb.input, district: testDistrict() });
    for (let i = 0; i < PLAYER_CARS.length; i++) {
      game.selectVehicle(i);
      const spec = game.selectedVehicle;
      const length = 2 * (game.vehicle.collisionOffset + VEHICLE.collisionRadius);
      expect(length, `${spec.id} collision length`).toBeGreaterThanOrEqual(spec.length - 0.05);
      expect(length - spec.length, `${spec.id} collision length`).toBeLessThan(0.3);
      expect(2 * VEHICLE.collisionRadius - spec.width, `${spec.id} collision width`).toBeGreaterThanOrEqual(0);
      expect(2 * VEHICLE.collisionRadius - spec.width).toBeLessThan(0.3);
      expect(game.vehicle.wheelbase).toBe(spec.wheelbase);
    }
    game.dispose();
    kb.input.dispose();
  });

  it("stops the nose, not the middle, at a wall: the gap left equals the bumper clearance", () => {
    const walls = new SegmentGrid();
    walls.add(-20, 30, 20, 30, 0); // a wall across the road at z = 30
    const roads = new SegmentGrid();
    roads.add(0, -100, 0, 100, 4);
    for (const spec of PLAYER_CARS) {
      const v = new VehicleModel({ minX: -200, maxX: 200, minZ: -200, maxZ: 200 }, walls, roads);
      v.collisionOffset = spec.length / 2 - 0.95;
      v.place(0, 0, 0);
      for (let i = 0; i < 900; i++) v.update({ accelerate: true, brake: false, left: false, right: false, handbrake: false }, 1 / 60);
      const nose = v.z + spec.length / 2;
      expect(nose, `${spec.id} nose`).toBeLessThanOrEqual(30.001); // the model never enters the wall
      expect(30 - nose, `${spec.id} gap`).toBeLessThan(0.15); // and does not stop visibly short of it
    }
  });

  it("is pushed clear of another vehicle and slowed, but not when apart or exactly on top", () => {
    const v = new VehicleModel({ minX: -200, maxX: 200, minZ: -200, maxZ: 200 }, new SegmentGrid(), new SegmentGrid());
    v.place(0, 0, 0);
    v.speed = 20;
    expect(v.pushAway(0, 5, 2.3)).toBe(false);
    expect(v.speed).toBe(20);
    expect(v.pushAway(0, 1, 2.3)).toBe(true);
    expect(Math.hypot(v.x, v.z - 1)).toBeCloseTo(2.3, 6);
    expect(v.speed).toBe(VEHICLE.scrapeSpeed);
    v.place(3, 3, 0);
    expect(v.pushAway(3, 3, 2.3)).toBe(false); // no direction to push in; must not produce NaN
    expect([v.x, v.z]).toEqual([3, 3]);
  });
});
