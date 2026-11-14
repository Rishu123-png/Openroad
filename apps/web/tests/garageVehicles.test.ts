import type { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SegmentGrid } from "../src/game/district/SegmentGrid";
import { DistrictGame, SETTING_KEYS, type DistrictGameOptions, type GarageState } from "../src/game/engine/DistrictGame";
import { ROAD_SAFETY } from "../src/game/traffic/roadSafety";
import { buildCarGeometry } from "../src/game/vehicle/models/carGeometry";
import { CarFactory, SUSPENSION } from "../src/game/vehicle/models/CarVisual";
import { ALL_CARS, collisionBody, PLAYER_CARS, PLAYER_PAINTS, TRAFFIC_CARS, type CarSpec } from "../src/game/vehicle/models/carSpecs";
import { carThumbnail, cssColor } from "../src/game/vehicle/models/carThumbnail";
import { VehicleModel } from "../src/game/vehicle/VehicleModel";
import { testDistrict } from "./fixtures/district";
import { keyboard, memory, nullEngine } from "./support/harness";

let engine: NullEngine;
let kb: ReturnType<typeof keyboard>;
let games: DistrictGame[];
beforeEach(() => {
  engine = nullEngine();
  kb = keyboard();
  games = [];
});
afterEach(() => {
  for (const game of games) game.dispose();
  kb.input.dispose();
  engine.dispose();
});

function start(options: Partial<DistrictGameOptions> = {}, states?: GarageState[]): DistrictGame {
  const game = new DistrictGame({ engine, input: kb.input, district: testDistrict(), onGarage: states ? (s) => states.push(s) : undefined, ...options });
  games.push(game);
  return game;
}
const frames = (game: DistrictGame, n: number): void => {
  engine.getDeltaTime = () => 1000 / 60; // the null engine has no clock of its own
  for (let i = 0; i < n; i++) game.renderFrame();
};
const paintVertices = (spec: CarSpec): number => buildCarGeometry(spec).paint.positions.length / 3;

describe("the garage's vehicles", () => {
  it("offers six vehicles with distinct names, categories and shapes, and no brand names on show", () => {
    expect(PLAYER_CARS).toHaveLength(6);
    expect(new Set(PLAYER_CARS.map((c) => c.id)).size).toBe(6);
    expect(new Set(PLAYER_CARS.map((c) => c.name)).size).toBe(6);
    expect(new Set(PLAYER_CARS.map((c) => c.category))).toEqual(new Set(["SUV", "Sedan", "Hatchback", "Off-road"]));
    // What the player sees names a kind of vehicle, never a maker or a model.
    const brands = /hyundai|maruti|suzuki|mahindra|toyota|tata|honda|kia|creta|dzire|swift|baleno|thar|fortuner|i20/i;
    for (const spec of PLAYER_CARS) {
      expect(`${spec.name} ${spec.klass} ${spec.category} ${spec.id}`).not.toMatch(brands);
      // The note says what the proportions follow and that it is not the maker's model.
      expect(spec.basis).toMatch(/Generic model built in code.*Not a manufacturer asset/);
    }
    // Every vehicle the game uses anywhere is one of the six.
    expect(new Set(ALL_CARS)).toEqual(new Set(PLAYER_CARS));
    expect(new Set(TRAFFIC_CARS)).toEqual(new Set(PLAYER_CARS));
    // The scene test recognises a model by its body mesh, so no two may have the same vertex count.
    expect(new Set(PLAYER_CARS.map(paintVertices)).size).toBe(6);
  });

  it("gives every pair of vehicles a different side outline", () => {
    const outline = (spec: CarSpec): number[] => {
      const g = buildCarGeometry(spec);
      const p = [...g.paint.positions, ...g.glass.positions];
      return [0.05, 0.12, 0.2, 0.3, 0.5, 0.7, 0.8, 0.9].map((t) => {
        const z = -spec.length / 2 + t * spec.length;
        let top = 0;
        for (let i = 0; i < p.length; i += 3) if (Math.abs(p[i + 2]! - z) < 0.12) top = Math.max(top, p[i + 1]!);
        return top; // metres, so a taller or longer-roofed vehicle differs as it does to the eye
      });
    };
    const shapes = PLAYER_CARS.map(outline);
    for (let i = 0; i < shapes.length; i++) {
      for (let j = i + 1; j < shapes.length; j++) {
        const difference = Math.max(...shapes[i]!.map((v, k) => Math.abs(v - shapes[j]![k]!)));
        expect(difference, `${PLAYER_CARS[i]!.id} against ${PLAYER_CARS[j]!.id}`).toBeGreaterThan(0.08);
      }
    }
  });

  it("builds each model complete: glass all round, lamps at both ends, mirrors, trim, and wheels that fit", () => {
    for (const spec of PLAYER_CARS) {
      const g = buildCarGeometry(spec);
      for (const name of ["paint", "glass", "detail", "lamps", "brake", "wheel"] as const) expect(g[name].indices.length, `${spec.id} ${name}`).toBeGreaterThan(0);
      const glass = g.glass.positions;
      let windshield = 0, rear = 0, left = 0, right = 0;
      for (let i = 0; i < glass.length; i += 3) {
        const x = glass[i]!, z = glass[i + 2]!;
        if (Math.abs(x) < 0.2 && z > 0.1) windshield++;
        if (Math.abs(x) < 0.2 && z < -spec.length * 0.2) rear++;
        if (x > spec.width * 0.3) right++;
        if (x < -spec.width * 0.3) left++;
      }
      expect(Math.min(windshield, rear, left, right), `${spec.id} glass: windshield ${windshield}, rear ${rear}, sides ${left}/${right}`).toBeGreaterThanOrEqual(3);
      // Door mirrors stand outside the body on both sides.
      const paint = g.paint.positions;
      let mirrorL = false, mirrorR = false;
      for (let i = 0; i < paint.length; i += 3) {
        if (paint[i]! > spec.width / 2 + 0.08) mirrorR = true;
        if (paint[i]! < -spec.width / 2 - 0.08) mirrorL = true;
      }
      expect(mirrorL && mirrorR, `${spec.id} mirrors`).toBe(true);
      // Headlamps at the front, on both sides, and red lamps only at the back (checked in vehicles.test.ts too).
      expect(g.headlamps).toHaveLength(2);
      expect(g.headlamps[0]![0] * g.headlamps[1]![0]).toBeLessThan(0);
      // Wheels: not oversized, and inside the arches they sit in.
      expect(spec.wheelRadius * 2).toBeLessThan(spec.height * 0.45);
      expect(spec.wheelRadius * 2).toBeGreaterThan(spec.height * 0.36);
      for (const c of g.wheelCentres) expect(Math.abs(c[0]) + spec.tyreWidth / 2).toBeLessThanOrEqual(spec.width / 2);
    }
  });

  it("refers to no model file: every vehicle is built in code, so none can be missing", () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "../src/game/vehicle");
    const files: string[] = [];
    const walk = (d: string): void => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(join(d, entry.name));
        else files.push(join(d, entry.name));
      }
    };
    walk(dir);
    expect(files.length).toBeGreaterThan(3);
    for (const file of files) {
      expect(file, "only source files in the vehicle folder").toMatch(/\.ts$/);
      const text = readFileSync(file, "utf8").replaceAll("http://www.w3.org/2000/svg", ""); // the SVG namespace is a name, not a download
      expect(text, file).not.toMatch(/\.(glb|gltf|obj|fbx|babylon)\b|https?:\/\/|SceneLoader|ImportMesh|fetch\(/);
    }
    // A thumbnail is drawn from the same figures, with nothing linked from outside.
    const thumbs = PLAYER_CARS.map((spec) => carThumbnail(spec));
    for (const svg of thumbs) {
      expect(svg.startsWith("<svg") && svg.endsWith("</svg>")).toBe(true);
      expect(svg).not.toMatch(/href|url\(|<image|<script|NaN|undefined/);
    }
    expect(new Set(thumbs).size).toBe(6);
    expect(cssColor([1, 0, 0.5])).toBe("rgb(255, 0, 186)");
  });
});

describe("choosing in the garage", () => {
  it("cycles through all six with the keyboard, in both directions, and spawns exactly the one shown", () => {
    const states: GarageState[] = [];
    const game = start({ settings: memory() }, states);
    expect(game.isGarageOpen).toBe(true);
    const seen: string[] = [game.selectedVehicle.id];
    for (let i = 0; i < 6; i++) {
      kb.press(i % 2 ? "KeyD" : "ArrowRight");
      seen.push(game.selectedVehicle.id);
      const body = game.scene.meshes.filter((m) => m.name === "player:paint");
      expect(body).toHaveLength(1);
      // The mesh in the world is the model the garage names.
      expect(body[0]!.getTotalVertices()).toBe(paintVertices(game.selectedVehicle));
      expect(game.playerCar.spec).toBe(game.selectedVehicle);
      expect(states.at(-1)).toMatchObject({ open: true, vehicle: game.selectedVehicle, total: 6 });
    }
    expect(seen).toEqual([...PLAYER_CARS.map((c) => c.id), PLAYER_CARS[0]!.id]); // all six, then round to the first
    kb.press("KeyA");
    expect(game.selectedVehicle).toBe(PLAYER_CARS[5]);
    // Select and drive: Enter closes the garage on the chosen vehicle and it moves.
    kb.press("Enter");
    expect(game.isGarageOpen).toBe(false);
    kb.down("KeyW");
    frames(game, 30);
    expect(game.vehicle.speed).toBeGreaterThan(1);
    expect(game.playerCar.spec).toBe(PLAYER_CARS[5]);
  });

  it("changes colour with W and S only while the garage is open, keeps it across vehicles and reloads", () => {
    const settings = memory();
    const states: GarageState[] = [];
    const game = start({ settings }, states);
    const colourOf = (g: DistrictGame): number[] => (g.playerCar.body.material as PBRMaterial).albedoColor.asArray().map((v) => +v.toFixed(3));
    // Until a colour is chosen each vehicle wears its own.
    expect(colourOf(game)).toEqual([...PLAYER_CARS[0]!.paint]);
    expect(PLAYER_PAINTS[game.selectedPaint]!.color).toBe(PLAYER_CARS[0]!.paint);
    for (const spec of PLAYER_CARS) expect(PLAYER_PAINTS.some((p) => p.color === spec.paint), `${spec.id} default colour is on offer`).toBe(true);

    const before = game.selectedPaint;
    kb.press("KeyW");
    expect(game.selectedPaint).toBe((before + 1) % PLAYER_PAINTS.length);
    expect(colourOf(game)).toEqual([...PLAYER_PAINTS[game.selectedPaint]!.color]);
    expect(states.at(-1)!.paint).toBe(game.selectedPaint);
    expect(game.vehicle.speed).toBe(0); // W did not drive the car away
    kb.press("ArrowDown");
    kb.press("ArrowDown");
    expect(game.selectedPaint).toBe((before - 1 + PLAYER_PAINTS.length) % PLAYER_PAINTS.length);
    const chosen = game.selectedPaint;
    // The colour stays when the vehicle changes.
    kb.press("KeyD");
    expect(game.selectedPaint).toBe(chosen);
    expect(colourOf(game)).toEqual([...PLAYER_PAINTS[chosen]!.color]);
    expect(game.scene.meshes.filter((m) => m.name === "player:paint")).toHaveLength(1);
    // Out of range and negative positions wrap.
    game.selectPaint(-1);
    expect(game.selectedPaint).toBe(PLAYER_PAINTS.length - 1);
    game.selectPaint(PLAYER_PAINTS.length + 2);
    expect(game.selectedPaint).toBe(2);
    // Closed: W drives, and the colour does not change.
    kb.press("Enter");
    kb.down("KeyW");
    frames(game, 20);
    kb.up("KeyW");
    expect(game.selectedPaint).toBe(2);
    expect(game.vehicle.speed).toBeGreaterThan(0.5);

    const again = start({ settings });
    expect(again.selectedPaint).toBe(2);
    expect(again.selectedVehicle).toBe(game.selectedVehicle);
    expect(colourOf(again)).toEqual([...PLAYER_PAINTS[2]!.color]);
    // A damaged saved colour falls back to the vehicle's own.
    const odd = start({ settings: memory({ [SETTING_KEYS.vehicle]: "compact-sedan", [SETTING_KEYS.paint]: "Invisible" }) });
    expect(colourOf(odd)).toEqual([...PLAYER_CARS[1]!.paint]);
  });
});

describe("collision size of each vehicle", () => {
  it("comes from the vehicle's stated size and covers it: length, width, height and wheelbase", () => {
    const game = start({ settings: memory() });
    const sizes = new Set<string>();
    for (let i = 0; i < PLAYER_CARS.length; i++) {
      game.selectVehicle(i);
      const spec = game.selectedVehicle, body = collisionBody(spec), v = game.vehicle;
      expect([body.length, body.width, body.height, body.wheelbase]).toEqual([spec.length, spec.width, spec.height, spec.wheelbase]);
      expect([v.collisionRadius, v.collisionOffset, v.wheelbase, v.collisionHeight]).toEqual([body.radius, body.offset, spec.wheelbase, spec.height]);
      // The two circles reach 5 cm past each bumper and 7 cm past each side: the body is always inside them.
      expect(2 * (v.collisionOffset + v.collisionRadius) - spec.length).toBeCloseTo(0.1, 9);
      expect(2 * v.collisionRadius - spec.width).toBeCloseTo(0.14, 9);
      expect(v.collisionOffset).toBeGreaterThan(0);
      // The shape is not the mesh: the drawn body (without mirrors) fits inside it.
      const p = buildCarGeometry(spec).paint.positions;
      let halfLength = 0;
      for (let k = 0; k < p.length; k += 3) halfLength = Math.max(halfLength, Math.abs(p[k + 2]!));
      expect(halfLength).toBeLessThanOrEqual(v.collisionOffset + v.collisionRadius);
      sizes.add(`${v.collisionRadius.toFixed(3)}/${v.collisionOffset.toFixed(3)}`);
    }
    expect(sizes.size).toBeGreaterThanOrEqual(5); // not one shape for all
  });

  it("stops every vehicle with its nose at a wall, forwards and in reverse, and the side clear of a wall alongside", () => {
    const roads = new SegmentGrid();
    roads.add(0, -100, 0, 100, 4);
    const input = { accelerate: false, brake: false, left: false, right: false, handbrake: false };
    for (const spec of PLAYER_CARS) {
      const body = collisionBody(spec);
      const make = (walls: SegmentGrid): VehicleModel => {
        const v = new VehicleModel({ minX: -200, maxX: 200, minZ: -200, maxZ: 200 }, walls, roads);
        v.collisionOffset = body.offset;
        v.collisionRadius = body.radius;
        v.wheelbase = body.wheelbase;
        v.place(0, 0, 0);
        return v;
      };
      const ahead = new SegmentGrid();
      ahead.add(-20, 30, 20, 30, 0);
      const forward = make(ahead);
      for (let i = 0; i < 900; i++) forward.update({ ...input, accelerate: true }, 1 / 60);
      expect(forward.z + spec.length / 2, `${spec.id} nose`).toBeLessThanOrEqual(30.001);
      expect(30 - (forward.z + spec.length / 2), `${spec.id} gap`).toBeLessThan(0.15);

      const behind = new SegmentGrid();
      behind.add(-20, -20, 20, -20, 0);
      const back = make(behind);
      for (let i = 0; i < 900; i++) back.update({ ...input, brake: true }, 1 / 60);
      expect(back.speed).toBeLessThanOrEqual(0);
      expect(back.z - spec.length / 2, `${spec.id} tail`).toBeGreaterThanOrEqual(-20.001);
      expect(back.z - spec.length / 2 + 20, `${spec.id} tail gap`).toBeLessThan(0.15);

      // A wall along the road, one metre from the centre line: the body's side never crosses it.
      const beside = new SegmentGrid();
      beside.add(1, -100, 1, 100, 0);
      const along = make(beside);
      for (let i = 0; i < 300; i++) along.update({ ...input, accelerate: true, right: i < 60 }, 1 / 60);
      expect(along.x + spec.width / 2, `${spec.id} side`).toBeLessThanOrEqual(1.001);
    }
  });

  it("keeps every vehicle out of buildings and inside the district however it is driven", () => {
    const district = testDistrict();
    const b = district.bounds;
    for (let i = 0; i < PLAYER_CARS.length; i++) {
      const game = start({ settings: memory({ [SETTING_KEYS.vehicle]: PLAYER_CARS[i]!.id }), trafficCount: 0 });
      const spec = game.selectedVehicle;
      expect(spec).toBe(PLAYER_CARS[i]);
      kb.down("KeyW");
      let moved = 0;
      for (let f = 0; f < 420; f++) {
        // Weave hard, off the road and toward whatever is there.
        const phase = Math.floor(f / 45) % 4;
        if (f % 45 === 0) {
          kb.up("KeyA");
          kb.up("KeyD");
          if (phase === 1 || phase === 2) kb.down(i % 2 ? "KeyA" : "KeyD");
          if (phase === 3) kb.down(i % 2 ? "KeyD" : "KeyA");
        }
        const px = game.vehicle.x, pz = game.vehicle.z;
        frames(game, 1);
        const v = game.vehicle;
        moved += Math.hypot(v.x - px, v.z - pz);
        // Centre, nose and tail of the body are never inside a mapped building.
        for (const along of [0, spec.length / 2 - 0.05, -spec.length / 2 + 0.05]) {
          const x = v.x + Math.sin(v.heading) * along, z = v.z + Math.cos(v.heading) * along;
          expect(game.world.buildingIndex.at(x, z), `${spec.id} frame ${f} at ${x.toFixed(1)}, ${z.toFixed(1)}`).toBeNull();
        }
        expect(v.x).toBeGreaterThanOrEqual(b.minX + 3);
        expect(v.x).toBeLessThanOrEqual(b.maxX - 3);
        expect(v.z).toBeGreaterThanOrEqual(b.minZ + 3);
        expect(v.z).toBeLessThanOrEqual(b.maxZ - 3);
      }
      kb.up("KeyW");
      kb.up("KeyA");
      kb.up("KeyD");
      expect(moved, `${spec.id} actually drove`).toBeGreaterThan(20);
      game.dispose();
      games.pop();
    }
  });

  it("lets traffic use all six models within the clearances traffic was checked with", () => {
    expect(TRAFFIC_CARS).toHaveLength(6);
    // Road-safety checks assume the widest traffic vehicle; no model is wider or longer than those they were written for.
    expect(Math.max(...TRAFFIC_CARS.map((c) => c.width)) / 2).toBeCloseTo(ROAD_SAFETY.vehicleHalfWidth, 6);
    expect(Math.max(...TRAFFIC_CARS.map((c) => c.length))).toBe(4.7);
    // The first four keep their places: existing safety tests name them by position.
    expect(TRAFFIC_CARS.slice(0, 4).map((c) => `${c.id} ${c.length} ${c.width}`)).toEqual(["compact-sedan 3.995 1.735", "hatchback 3.86 1.735", "compact-suv 4.33 1.79", "large-suv 4.7 1.86"]);
    const game = start({ settings: memory({ [SETTING_KEYS.vehicle]: "compact-suv" }), trafficCount: 18 });
    frames(game, 5);
    const drawn = new Set(game.scene.meshes.filter((m) => /^traffic.*:paint$/.test(m.name) || /:paint$/.test(m.name)).map((m) => m.getTotalVertices()));
    const known = new Set(PLAYER_CARS.map(paintVertices));
    for (const n of drawn) expect(known.has(n)).toBe(true);
    expect(drawn.size).toBeGreaterThanOrEqual(4);
  });
});

describe("wheels, steering and body movement", () => {
  it("turns the wheels of every vehicle by distance over radius, backwards in reverse, and steers the front pair only", () => {
    const scene = new Scene(engine);
    const factory = new CarFactory(scene);
    for (const spec of PLAYER_CARS) {
      const car = factory.create(spec, `w_${spec.id}`, spec.paint, true, true);
      const wheels = car.root.getChildMeshes().filter((m) => /:wheel\d$/.test(m.name));
      expect(wheels).toHaveLength(4);
      car.place(0, 0, 0, 0, 1.5, 0.3);
      expect(car.wheelSpin).toBeCloseTo(1.5 / spec.wheelRadius, 6);
      // Front pair (0, 1) turned by the steering angle; rear pair straight.
      expect(wheels[0]!.rotation.y).toBeCloseTo(0.3, 6);
      expect(wheels[1]!.rotation.y).toBeCloseTo(Math.PI + 0.3, 6);
      expect(wheels[2]!.rotation.y).toBeCloseTo(0, 6);
      expect(wheels[3]!.rotation.y).toBeCloseTo(Math.PI, 6);
      const forward = car.wheelSpin;
      car.place(0, 0, 0, 0, -0.5, 0);
      expect(car.wheelSpin).toBeLessThan(forward);
      // Wheels hang from the root, not from the sprung body: leaning the body cannot lift them.
      for (const wheel of wheels) expect(wheel.parent).toBe(car.root);
      expect(car.body.parent).toBe(car.sprung);
      expect(car.sprung.parent).toBe(car.root);
    }
  });

  it("dips the nose under braking, lifts it under power, rolls outward in a turn, within limits, and leaves the wheels alone", () => {
    const scene = new Scene(engine);
    const factory = new CarFactory(scene);
    const car = factory.create(PLAYER_CARS[0]!, "s", PLAYER_CARS[0]!.paint, true, true);
    car.place(0, 0, 0, 0);
    const worldY = (x: number, z: number): number => {
      car.root.computeWorldMatrix(true);
      car.sprung.computeWorldMatrix(true);
      return Vector3.TransformCoordinates(new Vector3(x, 0.8, z), car.sprung.getWorldMatrix()).y;
    };
    const settle = (forward: number, rightward: number): void => {
      for (let i = 0; i < 120; i++) car.setBodyMotion(forward, rightward, 1 / 60);
    };
    const level = worldY(0, 2);
    settle(-12, 0); // braking hard
    expect(worldY(0, 2)).toBeLessThan(level - 0.02);
    expect(worldY(0, -2)).toBeGreaterThan(level + 0.02);
    expect(car.bodyLean.pitch).toBeGreaterThan(0);
    settle(5, 0); // accelerating
    expect(worldY(0, 2)).toBeGreaterThan(level);
    settle(0, 6); // turning right: the body rolls to the left, the outside of the turn
    expect(worldY(-0.8, 0)).toBeLessThan(level - 0.01);
    expect(worldY(0.8, 0)).toBeGreaterThan(level + 0.01);
    settle(1000, -1000);
    expect(Math.abs(car.bodyLean.pitch)).toBeLessThanOrEqual(SUSPENSION.maxPitch + 1e-9);
    expect(Math.abs(car.bodyLean.roll)).toBeLessThanOrEqual(SUSPENSION.maxRoll + 1e-9);
    settle(0, 0);
    expect(Math.abs(car.bodyLean.pitch) + Math.abs(car.bodyLean.roll)).toBeLessThan(1e-4);
    // A zero-length frame changes nothing, and a car that is not sprung never leans.
    car.setBodyMotion(-12, 6, 0);
    expect(Math.abs(car.bodyLean.pitch)).toBeLessThan(1e-4);
    const plain = factory.create(PLAYER_CARS[1]!, "t", PLAYER_CARS[1]!.paint);
    expect(plain.sprung).toBe(plain.root);
    for (let i = 0; i < 60; i++) plain.setBodyMotion(-12, 6, 1 / 60);
    expect([plain.root.rotation.x, plain.root.rotation.z]).toEqual([0, 0]);
  });

  it("leans the player's car in the game without changing where it drives or collides", () => {
    const game = start({ settings: memory({ [SETTING_KEYS.vehicle]: "large-suv" }), trafficCount: 0 });
    kb.down("KeyW");
    frames(game, 90);
    kb.up("KeyW");
    expect(game.playerCar.bodyLean.pitch).toBeLessThan(0); // nose up under power
    kb.down("KeyS");
    frames(game, 12);
    expect(game.playerCar.bodyLean.pitch).toBeGreaterThan(0.005); // nose down under braking
    expect(game.playerCar.isBraking).toBe(true);
    kb.up("KeyS");
    // The root, which carries the wheels and the collision position, stays flat on the road.
    expect([game.playerCar.root.rotation.x, game.playerCar.root.rotation.z]).toEqual([0, 0]);
    expect(game.playerCar.root.position.x).toBeCloseTo(game.vehicle.x, 9);
    expect(game.playerCar.root.position.z).toBeCloseTo(game.vehicle.z, 9);
  });
});
