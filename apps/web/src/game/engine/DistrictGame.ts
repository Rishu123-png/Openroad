import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { InputAction } from "../../input/InputActions";
import { ChaseCamera } from "../camera/ChaseCamera";
import { createDistrictWorld, type DistrictWorld } from "../district/createDistrictWorld";
import { spawnProblem } from "../district/spawn";
import type { DistrictData } from "../district/types";
import { createDaylight, DAYLIGHT, type Daylight } from "../lighting/createDaylight";
import { createVehicleMesh } from "../vehicle/createVehicleMesh";
import { VehicleModel, type VehicleInput } from "../vehicle/VehicleModel";
import { GameBase, type GameOptions, type GameStats } from "./GameBase";

export interface DistrictGameOptions extends GameOptions {
  district: DistrictData;
}

/** Height of the road surface the vehicle rides on. */
const RIDE_HEIGHT = 0.03;

/**
 * A district built from map data, with a vehicle the player drives and a
 * camera that follows it.
 */
export class DistrictGame extends GameBase {
  declare readonly district: DistrictData;
  declare readonly world: DistrictWorld;
  declare readonly daylight: Daylight;
  declare readonly camera: ChaseCamera;
  declare readonly vehicle: VehicleModel;
  declare readonly vehicleMesh: Mesh;
  // Assigned in build(), which runs inside the base constructor, before field initialisers would.
  declare private controls: VehicleInput;

  constructor(options: DistrictGameOptions) {
    super(options);
  }

  protected build(): void {
    const district = (this.options as DistrictGameOptions).district;
    const problem = spawnProblem(district);
    if (problem) throw new Error(`The district cannot be started: ${problem}. Rebuild it with tools/build-district.mjs.`);

    const self = this as { -readonly [K in "district" | "world" | "daylight" | "camera" | "vehicle" | "vehicleMesh"]: DistrictGame[K] };
    this.controls = { accelerate: false, brake: false, left: false, right: false, handbrake: false };
    self.district = district;
    self.daylight = createDaylight(this.scene);
    self.world = createDistrictWorld(this.scene, district);
    this.daylight.setStaticShadowCasters(this.world.shadowCasters);
    self.vehicle = new VehicleModel(district.bounds, this.world.obstacles, this.world.roadSurfaces);
    self.vehicleMesh = createVehicleMesh(this.scene, this.world.materials.metal);
    self.camera = new ChaseCamera(this.scene);
    this.respawn();

    const input = this.options.input;
    this.cleanups.push(
      input.onPressed(InputAction.CameraChange, () => {
        this.camera.nextView();
        this.scene.fogDensity = DAYLIGHT.fogDensity * this.camera.haze;
      }),
      input.onPressed(InputAction.Reset, () => this.respawn()),
      input.onPressed(InputAction.DebugView, () => this.world.debug.next()),
    );
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
    c.accelerate = input.isDown(InputAction.Accelerate);
    c.brake = input.isDown(InputAction.Brake);
    c.left = input.isDown(InputAction.SteerLeft);
    c.right = input.isDown(InputAction.SteerRight);
    c.handbrake = input.isDown(InputAction.Handbrake);

    const v = this.vehicle;
    v.update(c, deltaSeconds);
    this.vehicleMesh.position.set(v.x, RIDE_HEIGHT, v.z);
    this.vehicleMesh.rotation.y = v.heading;
    this.camera.update(v.x, v.z, v.heading, deltaSeconds);
  }

  protected get viewName(): string {
    return this.camera.viewName;
  }

  protected override extraStats(): Partial<GameStats> {
    const view = this.world.debug.view;
    return { speedKmh: this.vehicle.speedKmh, onRoad: this.vehicle.onRoad, debugView: view.name, debugLegend: view.legend };
  }

  protected disposeWorld(): void {
    this.camera.dispose();
  }
}
