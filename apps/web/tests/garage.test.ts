import type { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DistrictGame, QUALITY, SETTING_KEYS, type DistrictGameOptions, type GarageState } from "../src/game/engine/DistrictGame";
import { TRAFFIC } from "../src/game/traffic/TrafficModel";
import { parseTrafficCount } from "../src/game/traffic/trafficOption";
import { buildCarGeometry } from "../src/game/vehicle/models/carGeometry";
import { COMPACT_SEDAN, COMPACT_SUV, PLAYER_CARS } from "../src/game/vehicle/models/carSpecs";
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
  for (let i = 0; i < n; i++) game.renderFrame();
};
/** The model actually in the scene, read back from the mesh, not from the game's own bookkeeping. */
function spawnedModel(game: DistrictGame): { id: string; bodyVertices: number; players: number } {
  const bodies = game.scene.meshes.filter((m) => m.name === "player:paint");
  const vertices = bodies[0]?.getTotalVertices() ?? 0;
  const match = PLAYER_CARS.find((spec) => buildCarGeometry(spec).paint.positions.length / 3 === vertices);
  return { id: match?.id ?? "none", bodyVertices: vertices, players: game.scene.transformNodes.filter((n) => n.name === "player").length };
}

describe("garage", () => {
  it("opens for a first-time player with the default vehicle, holds the car still, and lets it go on Enter", () => {
    const states: GarageState[] = [];
    const settings = memory();
    const game = start({ settings }, states);
    expect(game.isGarageOpen).toBe(true);
    expect(states.at(-1)).toMatchObject({ open: true, index: 0, total: PLAYER_CARS.length, quality: "medium" });
    expect(game.selectedVehicle).toBe(COMPACT_SUV);
    expect(spawnedModel(game)).toMatchObject({ id: "compact-suv", players: 1 });
    expect(game.camera.viewName).toBe("Garage");
    // Nothing is saved until the player chooses.
    expect(settings.data[SETTING_KEYS.vehicle]).toBeUndefined();

    kb.down("KeyW");
    frames(game, 40);
    expect([game.vehicle.x, game.vehicle.z, game.vehicle.speed]).toEqual([0, -40, 0]);

    kb.press("Enter");
    expect(game.isGarageOpen).toBe(false);
    expect(states.at(-1)!.open).toBe(false);
    expect(game.camera.viewName).toBe("Chase");
    for (let i = 0; i < 60; i++) game.vehicle.update({ accelerate: kb.input.isDown("accelerate"), brake: false, left: false, right: false, handbrake: false }, 1 / 60);
    expect(game.vehicle.speed).toBeGreaterThan(3); // W, still held, now drives
    kb.up("KeyW");
  });

  it("does not open, and cannot trap the player, when there is no garage panel to close it with", () => {
    const game = start({ settings: memory() });
    expect(game.isGarageOpen).toBe(false);
    expect(game.camera.viewName).toBe("Chase");
  });

  it("opens and closes with G, and Enter never opens it", () => {
    const states: GarageState[] = [];
    const game = start({ settings: memory({ [SETTING_KEYS.vehicle]: "compact-suv" }) }, states);
    expect(game.isGarageOpen).toBe(false);
    expect(states).toHaveLength(0);
    kb.press("Enter");
    expect(game.isGarageOpen).toBe(false);
    kb.press("KeyG");
    expect(game.isGarageOpen).toBe(true);
    kb.press("KeyG");
    expect(game.isGarageOpen).toBe(false);
    expect(states.map((s) => s.open)).toEqual([true, false]);
    // Opening it while moving stops the car where it is rather than letting it coast unattended.
    game.vehicle.speed = 15;
    kb.press("KeyG");
    const at = [game.vehicle.x, game.vehicle.z];
    frames(game, 20);
    expect(game.vehicle.speed).toBe(0);
    expect([game.vehicle.x, game.vehicle.z]).toEqual(at);
  });

  it("switches vehicle in both directions, wrapping at each end, with letter and arrow keys", () => {
    const states: GarageState[] = [];
    const game = start({ settings: memory() }, states);
    const order: string[] = [];
    for (const code of ["KeyD", "KeyD", "KeyA", "KeyA", "ArrowRight", "ArrowLeft"]) {
      kb.press(code);
      order.push(game.selectedVehicle.id);
      // The mesh in the scene is the chosen model every time, and there is only ever one player car.
      expect(spawnedModel(game)).toMatchObject({ id: game.selectedVehicle.id, players: 1 });
      expect(states.at(-1)!.vehicle).toBe(game.selectedVehicle);
    }
    expect(order).toEqual(["compact-sedan", "compact-suv", "compact-sedan", "compact-suv", "compact-sedan", "compact-suv"]);
    // By index too, including out-of-range and negative ones.
    game.selectVehicle(PLAYER_CARS.length + 1);
    expect(game.selectedVehicle).toBe(PLAYER_CARS[1]);
    game.selectVehicle(-1);
    expect(game.selectedVehicle).toBe(PLAYER_CARS[PLAYER_CARS.length - 1]);
  });

  it("leaves the steering keys alone when the garage is closed", () => {
    const game = start({ settings: memory({ [SETTING_KEYS.vehicle]: "compact-sedan" }) }, []);
    const car = game.playerCar;
    kb.press("KeyA");
    kb.press("KeyD");
    kb.press("ArrowLeft");
    expect(game.selectedVehicle).toBe(COMPACT_SEDAN);
    expect(game.playerCar).toBe(car);
  });

  it("spawns the chosen model where the player is, sized for driving and for the camera", () => {
    const game = start({ settings: memory() }, []);
    kb.press("Enter");
    game.vehicle.place(0, 60, Math.PI); // somewhere other than the start, facing south
    kb.press("KeyG");
    kb.press("KeyD");
    kb.press("Enter");
    expect(spawnedModel(game)).toMatchObject({ id: "compact-sedan", players: 1 });
    expect(game.playerCar.spec).toBe(COMPACT_SEDAN);
    expect(game.playerCar.root.position.x).toBeCloseTo(0);
    expect(game.playerCar.root.position.z).toBeCloseTo(60);
    expect(game.playerCar.root.rotation.y).toBeCloseTo(Math.PI);
    expect(game.vehicle.wheelbase).toBe(COMPACT_SEDAN.wheelbase);
    // The bonnet camera sits lower in the lower car.
    kb.press("KeyC");
    frames(game, 1);
    const sedanEye = game.camera.camera.position.y;
    kb.press("KeyG");
    kb.press("KeyA");
    kb.press("Enter");
    frames(game, 1);
    expect(game.camera.viewName).toBe("Bonnet");
    expect(game.camera.camera.position.y).toBeGreaterThan(sedanEye);
  });

  it("remembers the choice across a reload and spawns that model straight away", () => {
    const settings = memory();
    const first = start({ settings }, []);
    kb.press("KeyD");
    kb.press("Enter");
    expect(settings.data[SETTING_KEYS.vehicle]).toBe("compact-sedan");
    first.dispose();

    const states: GarageState[] = [];
    const second = start({ settings }, states);
    expect(second.isGarageOpen).toBe(false); // a returning player goes straight to the road
    expect(states).toHaveLength(0);
    expect(second.selectedVehicle).toBe(COMPACT_SEDAN);
    expect(spawnedModel(second)).toMatchObject({ id: "compact-sedan", players: 1 });
    expect([second.vehicle.x, second.vehicle.z]).toEqual([0, -40]);
  });

  it("falls back to the default when the saved choice is unusable", () => {
    // "hatchback" is a real model, but a traffic one: it must not become drivable through a saved value.
    for (const saved of ["", "tank", "COMPACT-SEDAN", "hatchback", "__proto__"]) {
      const states: GarageState[] = [];
      const game = start({ settings: memory({ [SETTING_KEYS.vehicle]: saved, [SETTING_KEYS.quality]: saved }) }, states);
      expect(game.selectedVehicle, `saved "${saved}"`).toBe(COMPACT_SUV);
      expect(spawnedModel(game).id).toBe("compact-suv");
      expect(game.quality).toBe("medium");
      // Treated as a first visit: the player is asked to choose again.
      expect(game.isGarageOpen, `saved "${saved}"`).toBe(true);
      game.dispose();
    }
  });

  it("keeps working when storage throws on read or write", () => {
    const broken = {
      getItem: (): string | null => {
        throw new Error("SecurityError: storage is disabled");
      },
      setItem: (): void => {
        throw new Error("QuotaExceededError");
      },
    };
    const game = start({ settings: broken }, []);
    expect(game.selectedVehicle).toBe(COMPACT_SUV);
    kb.press("KeyD");
    kb.press("Enter");
    game.setQuality("low");
    expect(game.selectedVehicle).toBe(COMPACT_SEDAN);
    expect(game.isGarageOpen).toBe(false);
    expect(game.quality).toBe("low");
    // A store that returns something other than a string is ignored as well.
    const odd = start({ settings: { getItem: () => 7 as unknown as string, setItem: () => undefined } }, []);
    expect(odd.selectedVehicle).toBe(COMPACT_SUV);
  });

  it("does not disturb respawn, camera or data views while open, and returns to the view it left", () => {
    const game = start({ settings: memory({ [SETTING_KEYS.vehicle]: "compact-suv" }) }, []);
    kb.press("KeyC"); // Bonnet
    kb.press("KeyG");
    expect(game.camera.viewName).toBe("Garage");
    kb.press("KeyR");
    kb.press("KeyV");
    frames(game, 3);
    expect(game.camera.viewName).toBe("Garage");
    expect(game.isGarageOpen).toBe(true);
    kb.press("KeyV");
    kb.press("KeyV");
    kb.press("KeyV");
    kb.press("Enter");
    expect(game.camera.viewName).toBe("Bonnet");
    expect(game.world.debug.view.name).toBe("Normal");
  });
});

describe("headlights and brake lights in the game", () => {
  const beams = (game: DistrictGame) => game.scene.lights.filter((l) => l.name === "headlight");

  it("toggles two beams mounted at the car's headlamps, pointing forward", () => {
    const game = start({ settings: memory({ [SETTING_KEYS.vehicle]: "compact-suv" }) });
    expect(beams(game)).toHaveLength(0); // none until asked for
    kb.press("KeyL");
    expect(game.areHeadlightsOn).toBe(true);
    const lights = beams(game);
    expect(lights).toHaveLength(2);
    for (const light of lights) {
      expect(light.isEnabled()).toBe(true);
      expect(light.parent).toBe(game.playerCar.root);
      const d = (light as unknown as { direction: { z: number; y: number } }).direction;
      expect(d.z).toBeGreaterThan(0.9);
      expect(d.y).toBeLessThan(0);
    }
    expect(lights.map((l) => (l as unknown as { position: { x: number } }).position.x).sort()).toEqual(game.playerCar.headlamps.map((h) => h[0]).sort());
    kb.press("KeyL");
    expect(game.areHeadlightsOn).toBe(false);
    expect(beams(game).filter((l) => l.isEnabled())).toHaveLength(0);
    // Toggling many times never adds more lights.
    for (let i = 0; i < 21; i++) kb.press("KeyL");
    expect(beams(game)).toHaveLength(2);
    expect(game.areHeadlightsOn).toBe(true);
  });

  it("carries the headlights over to a newly chosen vehicle without leaving the old ones behind", () => {
    const game = start({ settings: memory() }, []);
    kb.press("KeyL");
    kb.press("KeyD");
    expect(game.areHeadlightsOn).toBe(true);
    const lights = beams(game);
    expect(lights).toHaveLength(2);
    for (const light of lights) expect(light.parent).toBe(game.playerCar.root);
    expect((lights[0] as unknown as { position: { z: number } }).position.z).toBeCloseTo(game.playerCar.headlamps[0]![2], 5);
  });

  it("shows brake lights while slowing and with the handbrake, not while accelerating or reversing", () => {
    const game = start({ settings: memory({ [SETTING_KEYS.vehicle]: "compact-suv" }) });
    kb.down("KeyW");
    frames(game, 3);
    expect(game.playerCar.isBraking).toBe(false);
    kb.up("KeyW");
    game.vehicle.speed = 12;
    kb.down("KeyS");
    game.renderFrame();
    expect(game.playerCar.isBraking).toBe(true);
    // Once stopped, S reverses: the lamps go out.
    game.vehicle.speed = -2;
    game.renderFrame();
    expect(game.playerCar.isBraking).toBe(false);
    kb.up("KeyS");
    game.vehicle.speed = 5;
    kb.down("Space");
    game.renderFrame();
    expect(game.playerCar.isBraking).toBe(true);
    kb.up("Space");
    game.vehicle.speed = 5;
    game.renderFrame();
    expect(game.playerCar.isBraking).toBe(false);
  });
});

describe("graphics setting and traffic count", () => {
  it("gives low, medium and high their documented traffic, all within the limit", () => {
    expect([QUALITY.low.traffic, QUALITY.medium.traffic, QUALITY.high.traffic]).toEqual([6, 12, 18]);
    expect(QUALITY.medium.traffic).toBe(TRAFFIC.count);
    expect(TRAFFIC.maxCount).toBe(40);
    const settings = memory({ [SETTING_KEYS.vehicle]: "compact-suv" });
    const game = start({ settings });
    for (const quality of ["low", "medium", "high"] as const) {
      game.setQuality(quality);
      expect(game.traffic.cars).toHaveLength(QUALITY[quality].traffic);
      expect(game.quality).toBe(quality);
      expect(settings.data[SETTING_KEYS.quality]).toBe(quality);
      expect(QUALITY[quality].traffic).toBeLessThanOrEqual(TRAFFIC.maxCount);
    }
    game.setQuality("ultra" as never);
    expect(game.quality).toBe("high"); // an unknown setting is ignored
    expect(settings.data[SETTING_KEYS.quality]).toBe("high");
    game.dispose();
    expect(start({ settings }).quality).toBe("high"); // and it is remembered
  });

  it("lets an explicit traffic count override the setting, clamped to 0..40", () => {
    const saved = { [SETTING_KEYS.vehicle]: "compact-suv" };
    for (const [asked, expected] of [[0, 0], [41, 40], [-4, 0], [7.9, 7], [Number.NaN, 0]] as const) {
      const game = start({ settings: memory(saved), trafficCount: asked });
      expect(game.traffic.cars.length, `trafficCount ${asked}`).toBe(expected);
      game.setQuality("high");
      expect(game.traffic.cars.length).toBe(expected); // the override survives a change of setting
      frames(game, 3);
      expect(game.traffic.activeCount).toBeLessThanOrEqual(expected);
      game.dispose();
    }
  });

  it("reads ?traffic=N strictly: whole numbers only, limited to 40, otherwise the setting decides", () => {
    expect(parseTrafficCount("")).toBeUndefined();
    expect(parseTrafficCount("?district=synthetic")).toBeUndefined();
    expect(parseTrafficCount("?traffic=0")).toBe(0);
    expect(parseTrafficCount("?traffic=12")).toBe(12);
    expect(parseTrafficCount("?district=synthetic&traffic=40")).toBe(40);
    expect(parseTrafficCount("?traffic=41")).toBe(40);
    expect(parseTrafficCount("?traffic=999999")).toBe(40);
    for (const bad of ["", "-1", "abc", "1e3", "3.5", "NaN", "Infinity", "0x10", "12cars", "9999999999999999999999", " ", "%00"]) {
      expect(parseTrafficCount(`?traffic=${bad}`), `traffic=${bad}`).toBeUndefined();
    }
    // The first value wins when the option is repeated.
    expect(parseTrafficCount("?traffic=5&traffic=30")).toBe(5);
  });
});
