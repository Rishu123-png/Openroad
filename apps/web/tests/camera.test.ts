import type { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChaseCamera, CHASE_VIEWS } from "../src/game/camera/ChaseCamera";
import { DistrictGame, SETTING_KEYS } from "../src/game/engine/DistrictGame";
import { DAYLIGHT } from "../src/game/lighting/createDaylight";
import { DEFAULT_KEY_BINDINGS, InputAction } from "../src/input/InputActions";
import { testDistrict } from "./fixtures/district";
import { keyboard, memory, nullEngine } from "./support/harness";

let engine: NullEngine;
beforeEach(() => {
  engine = nullEngine();
});
afterEach(() => engine.dispose());

const DT = 1 / 60;

describe("chase camera views", () => {
  it("cycles Chase, Bonnet, High, Overview in order and stays valid however often it is cycled", () => {
    const camera = new ChaseCamera(new Scene(engine));
    expect(CHASE_VIEWS.map((v) => v.name)).toEqual(["Chase", "Bonnet", "High", "Overview"]);
    const seen: string[] = [];
    for (let i = 0; i < 4 * 250 + 3; i++) {
      seen.push(camera.viewName);
      camera.update(10, 20, 0.3, DT, 8);
      const p = camera.camera.position;
      expect([p.x, p.y, p.z].every(Number.isFinite), `view ${camera.viewName} after ${i} changes`).toBe(true);
      expect(p.y).toBeGreaterThan(0.3); // never under the road
      expect(camera.haze).toBeGreaterThan(0);
      camera.nextView();
    }
    expect(seen.slice(0, 9)).toEqual(["Chase", "Bonnet", "High", "Overview", "Chase", "Bonnet", "High", "Overview", "Chase"]);
    expect(camera.viewName).toBe("Overview"); // 1003 changes from Chase: 1003 mod 4 = 3
  });

  it("frames the vehicle differently in each view: behind, on it, far above", () => {
    const camera = new ChaseCamera(new Scene(engine));
    camera.setVehicleSize(4.33, 1.635);
    const at = (): { back: number; height: number } => {
      camera.snap(0);
      for (let i = 0; i < 30; i++) camera.update(0, 0, 0, DT);
      return { back: -camera.camera.position.z, height: camera.camera.position.y };
    };
    const chase = at();
    expect(chase.back).toBeCloseTo(CHASE_VIEWS[0]!.back, 1);
    expect(chase.height).toBeGreaterThan(1.635); // above the roof, so the car does not hide the road
    camera.nextView();
    const bonnet = at();
    expect(Math.abs(bonnet.back)).toBeLessThan(4.33 / 2); // within the car's length
    expect(bonnet.height).toBeGreaterThan(1.0);
    expect(bonnet.height).toBeLessThan(1.635); // below the roof line: a driver's eye
    camera.nextView();
    const high = at();
    expect(high.height).toBeGreaterThan(30);
    camera.nextView();
    const overview = at();
    expect(overview.height).toBeGreaterThan(high.height);
    // Distant views thin the haze so the district can be seen.
    expect(CHASE_VIEWS[3]!.haze).toBeLessThan(CHASE_VIEWS[0]!.haze);
  });

  it("scales the bonnet view to the vehicle it is mounted on", () => {
    const camera = new ChaseCamera(new Scene(engine));
    camera.nextView();
    camera.setVehicleSize(4.33, 1.635);
    camera.update(0, 0, 0, DT);
    const suv = camera.camera.position.y;
    camera.setVehicleSize(3.995, 1.515);
    camera.update(0, 0, 0, DT);
    expect(camera.camera.position.y).toBeLessThan(suv);
    expect(camera.camera.position.y / suv).toBeCloseTo(1.515 / 1.635, 5);
  });
});

describe("chase camera following", () => {
  it("stays behind the vehicle through a turn, easing round rather than snapping", () => {
    const camera = new ChaseCamera(new Scene(engine));
    camera.snap(0);
    camera.update(0, 0, 0, DT);
    expect(camera.camera.position.x).toBeCloseTo(0, 6);
    expect(camera.camera.position.z).toBeLessThan(-5);

    // The vehicle turns to face east in one frame. The camera takes several frames to come round.
    camera.update(0, 0, Math.PI / 2, DT);
    const first = Math.atan2(-camera.camera.position.x, -camera.camera.position.z); // heading the camera is behind
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(Math.PI / 8);
    let previous = first, largest = 0;
    for (let i = 0; i < 240; i++) {
      camera.update(0, 0, Math.PI / 2, DT);
      const angle = Math.atan2(-camera.camera.position.x, -camera.camera.position.z);
      expect(angle).toBeGreaterThanOrEqual(previous - 1e-9); // always toward the new heading, no overshoot back
      largest = Math.max(largest, angle - previous);
      previous = angle;
    }
    expect(largest).toBeLessThan(0.2); // no frame jumps more than about 11 degrees
    expect(previous).toBeCloseTo(Math.PI / 2, 2);
    expect(camera.camera.position.x).toBeLessThan(-5); // now west of the car, behind it
  });

  it("takes the short way round when the heading wraps past south", () => {
    const camera = new ChaseCamera(new Scene(engine));
    camera.snap(Math.PI - 0.1);
    camera.update(0, 0, Math.PI - 0.1, DT);
    let travelled = 0, previous = Math.atan2(-camera.camera.position.x, -camera.camera.position.z);
    for (let i = 0; i < 200; i++) {
      camera.update(0, 0, -Math.PI + 0.1, DT); // 0.2 rad further clockwise, across the +/-pi seam
      const angle = Math.atan2(-camera.camera.position.x, -camera.camera.position.z);
      let step = angle - previous;
      if (step > Math.PI) step -= Math.PI * 2;
      if (step < -Math.PI) step += Math.PI * 2;
      travelled += Math.abs(step);
      previous = angle;
    }
    expect(travelled).toBeLessThan(0.25); // 0.2 rad, not 6.08 the long way
  });

  it("moves at the same pace whatever the frame rate, and ignores a zero-length frame", () => {
    const after = (fps: number): number => {
      const camera = new ChaseCamera(new Scene(engine));
      camera.snap(0);
      camera.update(0, 0, 0, 1 / fps);
      for (let i = 0; i < fps / 2; i++) camera.update(0, 0, 1.2, 1 / fps); // half a second
      return Math.atan2(-camera.camera.position.x, -camera.camera.position.z);
    };
    expect(after(30)).toBeCloseTo(after(120), 2);
    const camera = new ChaseCamera(new Scene(engine));
    camera.snap(0);
    camera.update(5, 5, 0, DT);
    const before = camera.camera.position.asArray();
    camera.update(5, 5, 0, 0);
    expect(camera.camera.position.asArray()).toEqual(before);
  });

  it("drops back a little at speed and keeps the vehicle ahead of it", () => {
    const camera = new ChaseCamera(new Scene(engine));
    camera.snap(0);
    for (let i = 0; i < 300; i++) camera.update(0, 0, 0, DT, 0);
    const slow = camera.chaseDistance;
    for (let i = 0; i < 300; i++) camera.update(0, 0, 0, DT, 25);
    expect(camera.chaseDistance).toBeGreaterThan(slow);
    expect(camera.chaseDistance - slow).toBeLessThan(2);
  });
});

describe("chase camera and buildings", () => {
  it("pulls in front of a wall behind the vehicle, quickly, and eases back out when clear", () => {
    const camera = new ChaseCamera(new Scene(engine));
    camera.snap(0);
    camera.update(0, 0, 0, DT);
    const open = camera.chaseDistance;
    camera.blocked = (_x, z) => z < -3.2; // a building face 3.2 m behind the car
    camera.update(0, 0, 0, DT);
    expect(camera.camera.position.z, "out of the wall on the very next frame").toBeGreaterThanOrEqual(-3.2);
    for (let i = 0; i < 120; i++) {
      camera.update(0, 0, 0, DT);
      expect(camera.blocked(camera.camera.position.x, camera.camera.position.z)).toBe(false);
    }
    expect(camera.chaseDistance).toBeLessThan(open);
    // Closer means higher, so the view is over the roof rather than into the tailgate.
    expect(camera.camera.position.y).toBeGreaterThan(CHASE_VIEWS[0]!.height);

    camera.blocked = () => false;
    const steps: number[] = [];
    for (let i = 0; i < 400; i++) {
      const before = camera.chaseDistance;
      camera.update(0, 0, 0, DT);
      steps.push(camera.chaseDistance - before);
    }
    expect(camera.chaseDistance).toBeCloseTo(open, 1);
    expect(Math.max(...steps)).toBeLessThan(0.2); // eased, not a jump back
  });

  it("is never left inside a building, whichever way the vehicle faces, and is not stuck when surrounded", () => {
    const camera = new ChaseCamera(new Scene(engine));
    // A building occupying everything beyond 4 m from the origin except a north-south street 8 m wide.
    camera.blocked = (x, z) => Math.abs(x) > 4 && Math.abs(z) < 60;
    for (let step = 0; step < 720; step++) {
      const heading = (step / 720) * Math.PI * 2; // the car turns slowly on the spot through a full circle
      camera.update(0, 0, heading, DT);
      expect(camera.blocked(camera.camera.position.x, camera.camera.position.z), `inside the wall at heading ${heading.toFixed(2)}`).toBe(false);
    }
    // Completely enclosed (a mapping error, or a car wedged in a courtyard): the camera goes to its minimum distance and stays usable.
    camera.blocked = () => true;
    for (let i = 0; i < 200; i++) camera.update(0, 0, 0, DT);
    expect(camera.chaseDistance).toBeGreaterThan(0.5);
    expect(camera.chaseDistance).toBeLessThan(3.5);
    expect(camera.camera.position.asArray().every(Number.isFinite)).toBe(true);
    // And it recovers as soon as there is room.
    camera.blocked = () => false;
    for (let i = 0; i < 400; i++) camera.update(0, 0, 0, DT);
    expect(camera.chaseDistance).toBeCloseTo(CHASE_VIEWS[0]!.back, 1);
  });

  it("uses the district's buildings and walls: backing up to a house keeps the camera outside it", () => {
    const kb = keyboard();
    const district = testDistrict();
    const game = new DistrictGame({ engine, input: kb.input, district, settings: memory({ [SETTING_KEYS.vehicle]: "compact-suv" }) });
    // The L block spans x 20..60, z 20..56. Park at (27, 16) facing south (away from it): the camera wants to be 6.6 m north, inside the block.
    game.vehicle.place(27, 16, Math.PI);
    game.camera.snap(Math.PI);
    for (let i = 0; i < 90; i++) {
      game.camera.update(game.vehicle.x, game.vehicle.z, game.vehicle.heading, DT, 0);
      const p = game.camera.camera.position;
      expect(game.world.buildingIndex.at(p.x, p.z), "camera inside the building").toBeNull();
    }
    expect(game.camera.camera.position.z).toBeLessThan(20);
    expect(game.camera.chaseDistance).toBeLessThan(CHASE_VIEWS[0]!.back);
    // In the open the same camera sits at full distance.
    game.vehicle.place(0, -100, 0);
    game.camera.snap(0);
    for (let i = 0; i < 200; i++) game.camera.update(0, -100, 0, DT, 0);
    expect(game.camera.chaseDistance).toBeCloseTo(CHASE_VIEWS[0]!.back, 1);
    game.dispose();
    kb.input.dispose();
  });
});

describe("controls", () => {
  let kb: ReturnType<typeof keyboard>;
  beforeEach(() => {
    kb = keyboard();
  });
  afterEach(() => kb.input.dispose());
  const start = (): DistrictGame => new DistrictGame({ engine, input: kb.input, district: testDistrict(), settings: memory({ [SETTING_KEYS.vehicle]: "compact-suv" }) });
  /** Runs the game's own frame loop. The null engine reports no frame time, so it is given a steady 60 per second. */
  const drive = (game: DistrictGame, frames: number): void => {
    engine.getDeltaTime = () => 1000 / 60;
    for (let i = 0; i < frames; i++) game.renderFrame();
  };

  it("binds every action the game uses, with letters and arrows for driving", () => {
    const bound = (action: InputAction): string[] => Object.entries(DEFAULT_KEY_BINDINGS).filter(([, a]) => a === action).map(([code]) => code).sort();
    expect(bound(InputAction.Accelerate)).toEqual(["ArrowUp", "KeyW"]);
    expect(bound(InputAction.Brake)).toEqual(["ArrowDown", "KeyS"]);
    expect(bound(InputAction.SteerLeft)).toEqual(["ArrowLeft", "KeyA"]);
    expect(bound(InputAction.SteerRight)).toEqual(["ArrowRight", "KeyD"]);
    expect(bound(InputAction.Handbrake)).toEqual(["Space"]);
    expect(bound(InputAction.CameraChange)).toEqual(["KeyC"]);
    expect(bound(InputAction.Garage)).toEqual(["KeyG"]);
    expect(bound(InputAction.Confirm)).toEqual(["Enter"]);
    expect(bound(InputAction.Headlights)).toEqual(["KeyL"]);
    expect(bound(InputAction.DebugView)).toEqual(["KeyV"]);
    expect(bound(InputAction.Reset)).toEqual(["KeyR"]);
    // No key does two things.
    expect(new Set(Object.keys(DEFAULT_KEY_BINDINGS)).size).toBe(Object.keys(DEFAULT_KEY_BINDINGS).length);
  });

  it("drives the same in every camera view, and the view follows the vehicle in each", () => {
    const game = start();
    const distances: number[] = [];
    for (const view of ["Chase", "Bonnet", "High", "Overview"]) {
      expect(game.camera.viewName).toBe(view);
      kb.press("KeyR");
      kb.down("ArrowUp");
      drive(game, 120);
      kb.up("ArrowUp");
      distances.push(game.vehicle.z - -40);
      expect(game.vehicle.onRoad).toBe(true);
      // The camera looks at where the vehicle is now, not where it started.
      const target = game.camera.camera.getTarget();
      expect(Math.hypot(target.x - game.vehicle.x, target.z - game.vehicle.z), view).toBeLessThan(31);
      expect(game.scene.fogDensity).toBeCloseTo(DAYLIGHT.fogDensity * game.camera.haze, 9);
      kb.press("KeyC");
    }
    expect(distances[0]).toBeGreaterThan(8);
    for (const d of distances) expect(d).toBeCloseTo(distances[0]!, 6);
    expect(game.camera.viewName).toBe("Chase");
    game.dispose();
  });

  it("steers, brakes, reverses and resets after camera, data-view, headlight and garage keys", () => {
    const game = start();
    for (const code of ["KeyC", "KeyV", "KeyL", "KeyG", "Enter", "KeyC", "KeyV"]) kb.press(code);
    kb.down("KeyW");
    kb.down("KeyD");
    drive(game, 90);
    expect(game.vehicle.speed).toBeGreaterThan(5);
    expect(game.vehicle.heading).toBeGreaterThan(0.2); // turned right, toward +X
    expect(game.vehicle.x).toBeGreaterThan(0);
    kb.up("KeyW");
    kb.up("KeyD");
    kb.down("Space");
    drive(game, 120);
    expect(game.vehicle.speed).toBe(0);
    kb.up("Space");
    kb.down("ArrowDown");
    drive(game, 60);
    expect(game.vehicle.speed).toBeLessThan(-1);
    expect(game.playerCar.wheelSpin).not.toBe(0);
    kb.up("ArrowDown");
    kb.press("KeyR");
    expect([game.vehicle.x, game.vehicle.z, game.vehicle.heading, game.vehicle.speed]).toEqual([0, -40, 0, 0]);
    expect(game.playerCar.root.position.x).toBe(0);
    game.dispose();
  });

  it("turns the wheels the way the car is travelling, in step with the distance covered", () => {
    const game = start();
    kb.down("KeyW");
    let turned = 0, previous = game.playerCar.wheelSpin, travelled = 0, z = game.vehicle.z;
    for (let i = 0; i < 60; i++) {
      drive(game, 1);
      let step = game.playerCar.wheelSpin - previous;
      if (step < -Math.PI) step += Math.PI * 2;
      expect(step).toBeGreaterThanOrEqual(0); // forwards
      turned += step;
      previous = game.playerCar.wheelSpin;
      travelled += game.vehicle.z - z;
      z = game.vehicle.z;
    }
    kb.up("KeyW");
    expect(travelled).toBeGreaterThan(2);
    expect(turned * game.selectedVehicle.wheelRadius).toBeCloseTo(travelled, 3); // rolling without slipping
    game.dispose();
  });
});

describe("disposal", () => {
  it("removes every listener the game added and stops reacting to keys", () => {
    const kb = keyboard();
    const afterInput = kb.listening; // the keyboard's own three
    const states: boolean[] = [];
    const game = new DistrictGame({ engine, input: kb.input, district: testDistrict(), settings: memory({ [SETTING_KEYS.vehicle]: "compact-suv" }), onGarage: (s) => states.push(s.open) });
    const view = game.camera.viewName, debug = game.world.debug.viewIndex;
    game.dispose();
    for (const code of ["KeyC", "KeyV", "KeyG", "KeyL", "Enter", "KeyR", "KeyA", "KeyD"]) kb.press(code);
    expect(states).toEqual([]);
    expect(game.camera.viewName).toBe(view);
    expect(game.world.debug.viewIndex).toBe(debug);
    expect(game.isGarageOpen).toBe(false);
    expect(game.areHeadlightsOn).toBe(false);
    expect(game.scene.isDisposed).toBe(true);
    expect(engine.scenes).toHaveLength(0);
    game.dispose(); // twice is harmless
    expect(() => game.start()).toThrow(/dispose/);

    // A second game on the same keyboard hears each key once, not twice.
    const second = new DistrictGame({ engine, input: kb.input, district: testDistrict(), settings: memory({ [SETTING_KEYS.vehicle]: "compact-suv" }) });
    kb.press("KeyC");
    expect(second.camera.viewName).toBe("Bonnet");
    second.dispose();
    kb.input.dispose();
    expect(kb.listening).toBe(afterInput - 3); // and the keyboard lets go of the window
    expect(kb.listening).toBe(0);
  });
});
