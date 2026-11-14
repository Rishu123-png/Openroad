import { SpotLight } from "@babylonjs/core/Lights/spotLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { InputAction } from "../../input/InputActions";
import { ChaseCamera } from "../camera/ChaseCamera";
import { createDistrictWorld, type DistrictWorld } from "../district/createDistrictWorld";
import { spawnProblem } from "../district/spawn";
import type { DistrictData } from "../district/types";
import { createDaylight, DAYLIGHT, type Daylight } from "../lighting/createDaylight";
import { TRAFFIC, TrafficModel } from "../traffic/TrafficModel";
import { TrafficView } from "../traffic/TrafficView";
import type { CarVisual } from "../vehicle/models/CarVisual";
import { PLAYER_CARS, type CarSpec } from "../vehicle/models/carSpecs";
import { VehicleModel, type VehicleInput } from "../vehicle/VehicleModel";
import { GameBase, type GameOptions, type GameStats } from "./GameBase";

export type GraphicsQuality = "low" | "medium" | "high";

/**
 * What each graphics setting changes. `scaling` is how many screen pixels one
 * rendered pixel covers; `traffic` is the number of moving vehicles.
 */
export const QUALITY: Record<GraphicsQuality, { scaling: number; traffic: number; ambientOcclusion: boolean }> = {
  low: { scaling: 1.5, traffic: 6, ambientOcclusion: false },
  medium: { scaling: 1, traffic: TRAFFIC.count, ambientOcclusion: false },
  high: { scaling: 1, traffic: 18, ambientOcclusion: true },
};

/** The parts of localStorage the game uses, so tests can pass a plain object. */
export interface Settings {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const SETTING_KEYS = { vehicle: "openroad.vehicle", quality: "openroad.quality" } as const;

export interface DistrictGameOptions extends GameOptions {
  district: DistrictData;
  /** Where the chosen vehicle and graphics setting are kept. Omit to keep nothing. */
  settings?: Settings;
  /** Overrides the number of traffic vehicles from the graphics setting. */
  trafficCount?: number;
  /** Called when the garage opens or closes, or its vehicle changes. */
  onGarage?: (state: GarageState) => void;
}

export interface GarageState {
  open: boolean;
  vehicle: CarSpec;
  index: number;
  total: number;
  quality: GraphicsQuality;
}

/** Height of the road surface the vehicle rides on. */
const RIDE_HEIGHT = 0.03;
/** Distance at which the player's car and a traffic car touch. */
const CAR_CONTACT = 2.3;

/**
 * A district built from map data, with a vehicle the player chooses and
 * drives, traffic on the mapped roads, and a camera that follows.
 */
export class DistrictGame extends GameBase {
  declare readonly district: DistrictData;
  declare readonly world: DistrictWorld;
  declare readonly daylight: Daylight;
  declare readonly camera: ChaseCamera;
  declare readonly vehicle: VehicleModel;
  declare readonly traffic: TrafficModel;
  declare playerCar: CarVisual;
  // Assigned in build(), which runs inside the base constructor, before field initialisers would.
  declare private controls: VehicleInput;
  declare private trafficView: TrafficView;
  declare private vehicleIndex: number;
  declare private garageOpen: boolean;
  declare private graphics: GraphicsQuality;
  declare private headlights: SpotLight[];
  declare private headlightsOn: boolean;
  declare private ambientOcclusion: { dispose(): void } | null;

  constructor(options: DistrictGameOptions) {
    super(options);
  }

  private get opts(): DistrictGameOptions {
    return this.options as DistrictGameOptions;
  }

  protected build(): void {
    const { district } = this.opts;
    const problem = spawnProblem(district);
    if (problem) throw new Error(`The district cannot be started: ${problem}. Rebuild it with tools/build-district.mjs.`);

    const self = this as { -readonly [K in "district" | "world" | "daylight" | "camera" | "vehicle" | "traffic"]: DistrictGame[K] };
    this.controls = { accelerate: false, brake: false, left: false, right: false, handbrake: false };
    this.headlights = [];
    this.headlightsOn = false;
    this.ambientOcclusion = null;
    self.district = district;
    self.daylight = createDaylight(this.scene);
    self.world = createDistrictWorld(this.scene, district);
    this.daylight.setStaticShadowCasters(this.world.shadowCasters);
    self.vehicle = new VehicleModel(district.bounds, this.world.obstacles, this.world.roadSurfaces);
    self.camera = new ChaseCamera(this.scene);
    const { obstacles, buildingIndex } = this.world;
    this.camera.blocked = (x, z) => obstacles.near(x, z, 0.45) || buildingIndex.at(x, z) !== null;

    self.traffic = new TrafficModel(district, buildingIndex);
    this.trafficView = new TrafficView(this.traffic, this.world.cars, RIDE_HEIGHT);

    const saved = this.readSetting(SETTING_KEYS.vehicle);
    const savedIndex = PLAYER_CARS.findIndex((c) => c.id === saved);
    this.vehicleIndex = Math.max(0, savedIndex);
    this.spawnPlayerCar();
    this.respawn();

    const quality = this.readSetting(SETTING_KEYS.quality);
    this.graphics = quality === "low" || quality === "high" ? quality : "medium"; // anything else, including a damaged value
    this.applyQuality();

    // First visit: choose a vehicle before driving.
    this.garageOpen = false;
    if (savedIndex < 0 && this.opts.onGarage) this.openGarage();

    const input = this.options.input;
    this.cleanups.push(
      input.onPressed(InputAction.CameraChange, () => {
        this.camera.nextView();
        this.scene.fogDensity = DAYLIGHT.fogDensity * this.camera.haze;
      }),
      input.onPressed(InputAction.Reset, () => this.respawn()),
      input.onPressed(InputAction.DebugView, () => this.world.debug.next()),
      input.onPressed(InputAction.Garage, () => (this.garageOpen ? this.closeGarage() : this.openGarage())),
      input.onPressed(InputAction.Confirm, () => this.closeGarage()),
      input.onPressed(InputAction.SteerLeft, () => this.garageOpen && this.selectVehicle(this.vehicleIndex - 1)),
      input.onPressed(InputAction.SteerRight, () => this.garageOpen && this.selectVehicle(this.vehicleIndex + 1)),
      input.onPressed(InputAction.Headlights, () => this.setHeadlights(!this.headlightsOn)),
    );
  }

  /** Storage can refuse (private browsing, full quota, blocked cookies). The game then runs without remembering. */
  private readSetting(key: string): string | null {
    try {
      const value = this.opts.settings?.getItem(key);
      return typeof value === "string" ? value : null;
    } catch {
      return null;
    }
  }

  private writeSetting(key: string, value: string): void {
    try {
      this.opts.settings?.setItem(key, value);
    } catch {
      // Nothing to do: the choice still applies to this session.
    }
  }

  get selectedVehicle(): CarSpec {
    return PLAYER_CARS[this.vehicleIndex]!;
  }

  get isGarageOpen(): boolean {
    return this.garageOpen;
  }

  get quality(): GraphicsQuality {
    return this.graphics;
  }

  get areHeadlightsOn(): boolean {
    return this.headlightsOn;
  }

  private spawnPlayerCar(): void {
    const spec = this.selectedVehicle;
    const lightsWereOn = this.headlightsOn;
    this.setHeadlights(false);
    for (const light of this.headlights) light.dispose();
    this.headlights = [];
    this.playerCar?.dispose();
    this.playerCar = this.world.cars.create(spec, "player", spec.paint, true);
    this.vehicle.wheelbase = spec.wheelbase;
    this.vehicle.collisionOffset = spec.length / 2 - 0.95;
    this.camera.setVehicleSize(spec.length, spec.height);
    if (lightsWereOn) this.setHeadlights(true);
  }

  /** Chooses a vehicle by position in the list (wraps round) and remembers it. */
  selectVehicle(index: number): void {
    const n = PLAYER_CARS.length;
    const next = ((index % n) + n) % n;
    if (next !== this.vehicleIndex) {
      this.vehicleIndex = next;
      this.spawnPlayerCar();
      this.update(0);
    }
    this.writeSetting(SETTING_KEYS.vehicle, this.selectedVehicle.id);
    this.notifyGarage();
  }

  /** Stops the vehicle and circles it with the camera while the player chooses. */
  openGarage(): void {
    this.garageOpen = true;
    this.vehicle.speed = 0;
    this.camera.setOrbiting(true);
    this.scene.fogDensity = DAYLIGHT.fogDensity;
    this.notifyGarage();
  }

  closeGarage(): void {
    if (!this.garageOpen) return;
    this.garageOpen = false;
    this.camera.setOrbiting(false);
    this.camera.snap(this.vehicle.heading);
    this.scene.fogDensity = DAYLIGHT.fogDensity * this.camera.haze;
    this.writeSetting(SETTING_KEYS.vehicle, this.selectedVehicle.id);
    this.notifyGarage();
  }

  private notifyGarage(): void {
    this.opts.onGarage?.({ open: this.garageOpen, vehicle: this.selectedVehicle, index: this.vehicleIndex, total: PLAYER_CARS.length, quality: this.graphics });
  }

  setQuality(quality: GraphicsQuality): void {
    if (!(quality in QUALITY)) return;
    this.graphics = quality;
    this.writeSetting(SETTING_KEYS.quality, quality);
    this.applyQuality();
    this.notifyGarage();
  }

  private applyQuality(): void {
    const q = QUALITY[this.graphics];
    this.engine.setHardwareScalingLevel(q.scaling);
    this.traffic.setCount(this.opts.trafficCount ?? q.traffic);
    // Ambient occlusion needs a real GPU and a canvas; it is loaded only when asked for.
    if (q.ambientOcclusion && !this.ambientOcclusion && this.options.canvas) {
      const scene = this.scene;
      void import("../lighting/ambientOcclusion").then(({ createAmbientOcclusion }) => {
        if (scene.isDisposed || this.ambientOcclusion || !QUALITY[this.graphics].ambientOcclusion) return;
        this.ambientOcclusion = createAmbientOcclusion(scene, this.camera.camera);
      });
    } else if (!q.ambientOcclusion && this.ambientOcclusion) {
      this.ambientOcclusion.dispose();
      this.ambientOcclusion = null;
    }
  }

  /** Two beams from the headlamps. They matter in shade and under trees; there is no night yet. */
  setHeadlights(on: boolean): void {
    this.headlightsOn = on;
    if (on && this.headlights.length === 0 && this.playerCar) {
      for (const lamp of this.playerCar.headlamps) {
        const light = new SpotLight("headlight", new Vector3(lamp[0], lamp[1], lamp[2]), new Vector3(0, -0.12, 1), 0.9, 12, this.scene);
        light.parent = this.playerCar.root;
        light.intensity = 260;
        light.range = 45;
        light.diffuse.set(1, 0.96, 0.86);
        this.headlights.push(light);
      }
    }
    for (const light of this.headlights) light.setEnabled(on);
  }

  /** Puts the vehicle back on the mapped road it started on. */
  respawn(): void {
    const { spawn } = this.district;
    this.vehicle.place(spawn.x, spawn.z, spawn.heading);
    this.camera.snap(spawn.heading);
    this.update(0);
  }

  protected update(deltaSeconds: number): void {
    const input = this.options.input;
    const c = this.controls;
    const driving = !this.garageOpen;
    c.accelerate = driving && input.isDown(InputAction.Accelerate);
    c.brake = driving && input.isDown(InputAction.Brake);
    c.left = driving && input.isDown(InputAction.SteerLeft);
    c.right = driving && input.isDown(InputAction.SteerRight);
    c.handbrake = !driving || input.isDown(InputAction.Handbrake);

    const v = this.vehicle;
    const px = v.x, pz = v.z;
    v.update(c, deltaSeconds);

    this.traffic.update(deltaSeconds, v.x, v.z);
    const cars = this.traffic.cars;
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i]!;
      if (car.active) v.pushAway(car.x, car.z, CAR_CONTACT);
    }
    this.trafficView.update();

    // Distance along the heading, so the wheels turn backwards in reverse.
    const travelled = (v.x - px) * Math.sin(v.heading) + (v.z - pz) * Math.cos(v.heading);
    this.playerCar.place(v.x, RIDE_HEIGHT, v.z, v.heading, travelled, v.steer);
    // Lit by the handbrake and while the brake pedal slows forward motion; not when S is reversing the car.
    this.playerCar.setBraking(driving && (c.handbrake || v.braking || (c.brake && v.speed > 0.3)));
    this.camera.update(v.x, v.z, v.heading, deltaSeconds, v.speed);
  }

  protected get viewName(): string {
    return this.camera.viewName;
  }

  protected override extraStats(): Partial<GameStats> {
    const view = this.world.debug.view;
    return { speedKmh: this.vehicle.speedKmh, onRoad: this.vehicle.onRoad, debugView: view.name, debugLegend: view.legend, traffic: this.traffic.activeCount };
  }

  protected disposeWorld(): void {
    this.ambientOcclusion?.dispose();
    this.camera.dispose();
  }
}
