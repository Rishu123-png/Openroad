import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChaseCamera, CHASE_VIEWS } from "../src/game/camera/ChaseCamera";
import { BuildingIndex } from "../src/game/district/BuildingIndex";
import { dressBuilding, extrudeFootprint } from "../src/game/district/buildingGeometry";
import { addLaneMarkings, addSpeedBreaker, MARKING_RULES } from "../src/game/district/roadMarkings";
import { SegmentGrid } from "../src/game/district/SegmentGrid";
import type { DistrictRoad } from "../src/game/district/types";
import { DistrictGame, QUALITY, SETTING_KEYS, type GarageState, type Settings } from "../src/game/engine/DistrictGame";
import { GeometryBuffer } from "../src/game/geometry/GeometryBuffer";
import type { MaterialKey } from "../src/game/materials/MaterialLibrary";
import { TRAFFIC, TrafficModel } from "../src/game/traffic/TrafficModel";
import { buildCarGeometry } from "../src/game/vehicle/models/carGeometry";
import { CarFactory } from "../src/game/vehicle/models/CarVisual";
import { ALL_CARS, COMPACT_SEDAN, COMPACT_SUV, PLAYER_CARS } from "../src/game/vehicle/models/carSpecs";
import { KeyboardInput } from "../src/input/KeyboardInput";
import { testDistrict } from "./fixtures/district";

function memory(initial: Record<string, string> = {}): Settings & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
}

let engine: NullEngine;
beforeEach(() => {
  engine = new NullEngine({ renderWidth: 320, renderHeight: 180, textureSize: 64, deterministicLockstep: true, lockstepMaxSteps: 4 });
});
afterEach(() => engine.dispose());

/** Extent of every mesh under a car, in the car's own frame. */
function extent(scene: Scene, factory: CarFactory, spec: (typeof ALL_CARS)[number]) {
  const car = factory.create(spec, `t_${spec.id}`, spec.paint);
  car.place(0, 0, 0, 0);
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of car.root.getChildMeshes()) {
    if (mesh.name.includes("shadow")) continue;
    mesh.computeWorldMatrix(true);
    const box = mesh.getBoundingInfo().boundingBox;
    min = min.map((v, i) => Math.min(v, box.minimumWorld.asArray()[i]!));
    max = max.map((v, i) => Math.max(v, box.maximumWorld.asArray()[i]!));
  }
  void scene;
  return { car, size: max.map((v, i) => v - min[i]!), min, max };
}

describe("vehicle models", () => {
  it("are built to the stated length, width and height", () => {
    const scene = new Scene(engine);
    const factory = new CarFactory(scene);
    for (const spec of ALL_CARS) {
      const { size, min } = extent(scene, factory, spec);
      expect(size[2]).toBeCloseTo(spec.length, 1); // length along Z
      expect(size[1]! + min[1]!).toBeCloseTo(spec.height, 1);
      // Body width matches; door mirrors stand out a little further, as on a real car.
      expect(size[0]).toBeGreaterThanOrEqual(spec.width - 0.02);
      expect(size[0]).toBeLessThan(spec.width + 0.45);
      expect(min[1]).toBeGreaterThan(-0.02); // tyres rest on the ground, not through it
    }
    expect(COMPACT_SUV.length).toBeCloseTo(4.33, 2);
    expect(COMPACT_SUV.width).toBeCloseTo(1.79, 2);
    expect(COMPACT_SEDAN.length).toBeCloseTo(3.995, 2);
    expect(COMPACT_SEDAN.width).toBeCloseTo(1.735, 2);
  });

  it("gives the SUV and the sedan different shapes, not different paint", () => {
    const suv = buildCarGeometry(COMPACT_SUV), sedan = buildCarGeometry(COMPACT_SEDAN);
    expect(suv.paint.positions.length).not.toBe(sedan.paint.positions.length);
    // The sedan has a boot: its roof is low at the tail where the SUV's is still high.
    const roofAt = (g: typeof suv, spec: typeof COMPACT_SUV, t: number) => {
      const z = -spec.length / 2 + t * spec.length;
      let top = 0;
      const p = [...g.paint.positions, ...g.glass.positions];
      for (let i = 0; i < p.length; i += 3) if (Math.abs(p[i + 2]! - z) < 0.2) top = Math.max(top, p[i + 1]!);
      return top;
    };
    expect(roofAt(suv, COMPACT_SUV, 0.1)).toBeGreaterThan(1.4);
    expect(roofAt(sedan, COMPACT_SEDAN, 0.1)).toBeLessThan(1.15);
    expect(COMPACT_SUV.height - COMPACT_SEDAN.height).toBeGreaterThan(0.1);
    expect(COMPACT_SUV.clearance).toBeGreaterThan(COMPACT_SEDAN.clearance);
    for (const g of [suv, sedan]) {
      for (const part of [g.paint, g.glass, g.detail, g.lamps, g.brake]) expect(part.indices.length).toBeGreaterThan(0);
    }
  });

  it("has four wheels that turn with distance travelled and steer at the front", () => {
    const scene = new Scene(engine);
    const car = new CarFactory(scene).create(COMPACT_SUV, "w", COMPACT_SUV.paint, true);
    const wheels = car.root.getChildMeshes().filter((m) => m.name.includes("wheel"));
    expect(wheels).toHaveLength(4);
    car.place(0, 0, 0, 0, 0);
    expect(car.wheelSpin).toBe(0);
    car.place(0, 0, 1, 0, 1, 0.3);
    expect(car.wheelSpin).toBeCloseTo(1 / COMPACT_SUV.wheelRadius, 5);
    car.place(0, 0, 0, 0, -1);
    expect(car.wheelSpin).toBeCloseTo(0, 5);
    expect(car.isBraking).toBe(false);
    car.setBraking(true);
    expect(car.isBraking).toBe(true);
  });

  it("stays within a triangle budget", () => {
    const factory = new CarFactory(new Scene(engine));
    for (const spec of ALL_CARS) expect(factory.stats(spec).triangles).toBeLessThan(9000);
  });
});

describe("garage and settings", () => {
  let input: KeyboardInput, keys: EventTarget;
  const press = (code: string) => {
    for (const type of ["keydown", "keyup"]) {
      const e = new Event(type, { cancelable: true }) as Event & { code: string; repeat: boolean };
      e.code = code;
      e.repeat = false;
      keys.dispatchEvent(e);
    }
  };
  beforeEach(() => {
    keys = new EventTarget();
    input = new KeyboardInput(keys);
  });
  afterEach(() => input.dispose());

  it("opens on a first visit, changes vehicle, saves the choice and spawns it next time", () => {
    const settings = memory();
    const states: GarageState[] = [];
    const game = new DistrictGame({ engine, input, district: testDistrict(), settings, onGarage: (s) => states.push(s) });
    expect(game.isGarageOpen).toBe(true);
    expect(game.selectedVehicle).toBe(PLAYER_CARS[0]);
    const first = game.playerCar;

    press("KeyD");
    expect(game.selectedVehicle).toBe(COMPACT_SEDAN);
    expect(game.playerCar).not.toBe(first);
    expect(game.vehicle.wheelbase).toBe(COMPACT_SEDAN.wheelbase);
    expect(states.at(-1)).toMatchObject({ open: true, index: 1, total: 2 });
    expect(states.at(-1)!.vehicle.basis).toMatch(/Generic model.*Not a manufacturer asset/);

    // The car does not drive away while the garage is open.
    const down = new Event("keydown", { cancelable: true }) as Event & { code: string; repeat: boolean };
    down.code = "KeyW";
    down.repeat = false;
    keys.dispatchEvent(down);
    for (let i = 0; i < 30; i++) game.renderFrame();
    expect(game.vehicle.speed).toBe(0);

    press("Enter");
    expect(game.isGarageOpen).toBe(false);
    expect(settings.data[SETTING_KEYS.vehicle]).toBe("compact-sedan");
    game.dispose();

    const again = new DistrictGame({ engine, input, district: testDistrict(), settings, onGarage: (s) => states.push(s) });
    expect(again.isGarageOpen).toBe(false);
    expect(again.selectedVehicle).toBe(COMPACT_SEDAN);
    expect([again.vehicle.x, again.vehicle.z]).toEqual([0, -40]);
    again.dispose();
  });

  it("ignores an unknown saved vehicle, and switches graphics setting, lights and brake lamps", () => {
    const settings = memory({ [SETTING_KEYS.vehicle]: "tank", [SETTING_KEYS.quality]: "low" });
    const game = new DistrictGame({ engine, input, district: testDistrict(), settings });
    expect(game.selectedVehicle).toBe(COMPACT_SUV);
    expect(game.quality).toBe("low");
    expect(QUALITY.low.scaling).toBeGreaterThan(QUALITY.medium.scaling);
    game.setQuality("medium");
    expect(settings.data[SETTING_KEYS.quality]).toBe("medium");

    press("KeyL");
    expect(game.areHeadlightsOn).toBe(true);
    expect(game.scene.lights.filter((l) => l.name === "headlight" && l.isEnabled())).toHaveLength(2);
    press("KeyL");
    expect(game.scene.lights.filter((l) => l.name === "headlight" && l.isEnabled())).toHaveLength(0);

    game.vehicle.speed = 10;
    const down = new Event("keydown", { cancelable: true }) as Event & { code: string; repeat: boolean };
    down.code = "KeyS";
    down.repeat = false;
    keys.dispatchEvent(down);
    game.renderFrame();
    expect(game.playerCar.isBraking).toBe(true);
    game.dispose();
  });
});

describe("traffic", () => {
  const model = (count: number, edit?: (d: ReturnType<typeof testDistrict>) => void) => {
    const district = testDistrict();
    edit?.(district);
    const traffic = new TrafficModel(district, new BuildingIndex(district.buildings));
    traffic.setCount(count);
    return { traffic, district };
  };
  const run = (traffic: TrafficModel, seconds: number, each?: () => void) => {
    for (let i = 0; i < seconds * 30; i++) {
      traffic.update(1 / 30, 0, -40);
      each?.();
    }
  };

  it("keeps to the configured count, on mapped roads, out of buildings and away from the player at spawn", () => {
    const { traffic, district } = model(6);
    const index = new BuildingIndex(district.buildings);
    traffic.update(1 / 30, 0, -40);
    for (const car of traffic.cars.filter((c) => c.active)) expect(Math.hypot(car.x, car.z + 40)).toBeGreaterThanOrEqual(TRAFFIC.spawnFromPlayer - 0.01);
    let maxActive = 0, maxSpeed = 0;
    run(traffic, 40, () => {
      maxActive = Math.max(maxActive, traffic.activeCount);
      for (const car of traffic.cars) {
        if (!car.active) continue;
        maxSpeed = Math.max(maxSpeed, car.speed);
        expect(index.at(car.x, car.z)).toBeNull();
        // On one of the two streets, which run along x = 0 and z = 0, within the carriageway.
        expect(Math.min(Math.abs(car.x), Math.abs(car.z))).toBeLessThanOrEqual(4.01);
        expect(district.roads[car.road]!.kind).toBe("road"); // never the footway
      }
    });
    expect(maxActive).toBeGreaterThan(0);
    expect(maxActive).toBeLessThanOrEqual(6);
    expect(maxSpeed).toBeGreaterThan(2);
    expect(maxSpeed).toBeLessThanOrEqual(TRAFFIC.speed.tertiary! * 1.2);
    traffic.setCount(0);
    expect(traffic.activeCount).toBe(0);
    traffic.setCount(1000);
    run(traffic, 1);
    expect(traffic.activeCount).toBeLessThanOrEqual(TRAFFIC.maxCount);
  });

  it("drives only forwards along a one-way road", () => {
    const { traffic, district } = model(8, (d) => {
      d.roads[0]!.oneway = true; // west to east
      d.roads[1]!.oneway = true; // south to north (toward +Z)
    });
    let seen = 0;
    run(traffic, 40, () => {
      for (const car of traffic.cars) {
        if (!car.active) continue;
        seen++;
        expect(car.dir).toBe(1);
        if (district.roads[car.road]!.id === "way/20" && Math.abs(car.x) > 12) expect(Math.sin(car.heading)).toBeGreaterThan(0.9);
      }
    });
    expect(seen).toBeGreaterThan(0);
  });

  it("does not run cars into each other", () => {
    const { traffic } = model(10);
    let closest = Infinity;
    run(traffic, 60, () => {
      // Away from the two junctions, at (0, 0) and (0, 100): traffic has no right of way rule, so vehicles on
      // crossing roads can pass through each other there. That is a known limitation, not what this test is about.
      const cars = traffic.cars.filter((c) => c.active && Math.hypot(c.x, c.z) > 12 && Math.hypot(c.x, c.z - 100) > 12);
      for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) closest = Math.min(closest, Math.hypot(cars[i]!.x - cars[j]!.x, cars[i]!.z - cars[j]!.z));
    });
    expect(closest).toBeGreaterThan(2);
  });
});

describe("road markings", () => {
  const road = (over: Partial<DistrictRoad>): DistrictRoad => ({ ...testDistrict().roads[0]!, ...over });
  const none = new SegmentGrid(50);

  it("paints a centre line only where the class and width justify one", () => {
    expect(addLaneMarkings(new GeometryBuffer(), road({}), 0, none)).toBeGreaterThan(0);
    expect(addLaneMarkings(new GeometryBuffer(), road({ class: "residential" }), 0, none)).toBe(0);
    expect(addLaneMarkings(new GeometryBuffer(), road({ class: "service" }), 0, none)).toBe(0);
    expect(addLaneMarkings(new GeometryBuffer(), road({ width: MARKING_RULES.minWidth - 0.5 }), 0, none)).toBe(0);
  });

  it("stays inside the carriageway", () => {
    const g = new GeometryBuffer();
    addLaneMarkings(g, road({ class: "primary", width: 14, lanes: 4 }), 0, none);
    const p = g.positions;
    expect(p.length).toBeGreaterThan(0);
    for (let i = 0; i < p.length; i += 3) expect(Math.abs(p[i + 2]!)).toBeLessThan(7);
  });

  it("draws a speed breaker only on a road near the mapped point", () => {
    const roads = testDistrict().roads;
    expect(addSpeedBreaker(new GeometryBuffer(), 60, 1, roads, 0)).toBe(true);
    expect(addSpeedBreaker(new GeometryBuffer(), 90, 90, roads, 0)).toBe(false);
  });
});

describe("facades", () => {
  it("keep the mapped footprint: same roof and same wall base as a plain extrusion", () => {
    for (const building of testDistrict().buildings) {
      const layers = new Map<MaterialKey, GeometryBuffer>();
      dressBuilding((key) => layers.get(key) ?? layers.set(key, new GeometryBuffer()).get(key)!, building, [1, 1, 1], [1, 1, 1]);
      const plain = new GeometryBuffer();
      extrudeFootprint(plain, building.polygons, 0, building.height, [1, 1, 1], [1, 1, 1]);
      const corners = new Set(building.polygons.flatMap((p) => [p.outer, ...p.holes]).flat().map((q) => `${q[0]},${q[1]}`));
      // Every vertex at ground level is a mapped corner or lies on a mapped edge (doors), never outside the footprint's box.
      const xs = [...corners].map((c) => Number(c.split(",")[0])), zs = [...corners].map((c) => Number(c.split(",")[1]));
      const ground = new Set<string>();
      for (const g of layers.values()) {
        const p = g.positions;
        for (let i = 0; i < p.length; i += 3) {
          if (p[i + 1]! < 4) {
            // Doors, balconies and shopfront trim may stand proud of the wall by well under a metre.
            expect(p[i]!).toBeGreaterThan(Math.min(...xs) - 1.6);
            expect(p[i]!).toBeLessThan(Math.max(...xs) + 1.6);
            expect(p[i + 2]!).toBeGreaterThan(Math.min(...zs) - 1.6);
            expect(p[i + 2]!).toBeLessThan(Math.max(...zs) + 1.6);
          }
          if (p[i + 1] === 0) ground.add(`${p[i]},${p[i + 2]}`);
        }
      }
      for (const corner of corners) expect(ground.has(corner)).toBe(true);
      // The roof polygon is identical to the plain extrusion's.
      const roof = (g: GeometryBuffer) => {
        let area = 0;
        const p = g.positions, n = g.normals, idx = g.indices;
        for (let i = 0; i < idx.length; i += 3) {
          const [a, b, c] = [idx[i]!, idx[i + 1]!, idx[i + 2]!];
          if (n[a * 3 + 1]! < 0.99 || p[a * 3 + 1] !== building.height) continue;
          area += Math.abs((p[b * 3]! - p[a * 3]!) * (p[c * 3 + 2]! - p[a * 3 + 2]!) - (p[c * 3]! - p[a * 3]!) * (p[b * 3 + 2]! - p[a * 3 + 2]!)) / 2;
        }
        return area;
      };
      expect(roof(layers.get("concrete")!)).toBeCloseTo(roof(plain), 3);
    }
  });

  it("gives unclassified buildings the generic facade, never the house or shop one", () => {
    const unclassified = { ...testDistrict().buildings[2]!, area: 2256 };
    const used = new Set<MaterialKey>();
    dressBuilding((key) => (used.add(key), new GeometryBuffer()), unclassified, [1, 1, 1], [1, 1, 1]);
    expect(used.has("generic")).toBe(true);
    expect(used.has("residential")).toBe(false);
    expect(used.has("shopfront")).toBe(false);
    expect(used.has("ribbon")).toBe(false);
  });
});

describe("chase camera", () => {
  it("offers chase and bonnet views and pulls in rather than pass through a wall", () => {
    const scene = new Scene(engine);
    const camera = new ChaseCamera(scene);
    expect(CHASE_VIEWS.map((v) => v.name)).toEqual(expect.arrayContaining(["Chase", "Bonnet"]));
    camera.snap(0);
    camera.update(0, 0, 0, 1 / 60);
    const open = camera.chaseDistance;
    expect(camera.camera.position.z).toBeLessThan(-3);
    camera.blocked = (_x, z) => z < -3; // a wall 3 m behind the car
    for (let i = 0; i < 120; i++) camera.update(0, 0, 0, 1 / 60);
    expect(camera.chaseDistance).toBeLessThan(open);
    expect(camera.camera.position.z).toBeGreaterThanOrEqual(-3.01);
  });
});
