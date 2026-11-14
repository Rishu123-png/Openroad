import { TargetCamera } from "@babylonjs/core/Cameras/targetCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";

export interface ChaseView {
  name: string;
  /** Metres behind the middle of the vehicle; negative is ahead of it. */
  back: number;
  height: number;
  /** How far ahead of the vehicle the camera looks. */
  lookAhead: number;
  lookHeight: number;
  /** Haze relative to street level. High views use less, or the ground would vanish. */
  haze: number;
  /** Whether buildings can get between this camera and the vehicle. */
  avoidsWalls: boolean;
  /** Multiplies back and height by the vehicle's size, for views attached to the body. */
  onVehicle?: boolean;
}

export const CHASE_VIEWS: readonly ChaseView[] = [
  { name: "Chase", back: 6.6, height: 2.45, lookAhead: 5, lookHeight: 1.15, haze: 1, avoidsWalls: true },
  { name: "Bonnet", back: -0.2, height: 0.86, lookAhead: 30, lookHeight: 0.9, haze: 1, avoidsWalls: false, onVehicle: true },
  { name: "High", back: 45, height: 60, lookAhead: 12, lookHeight: 0, haze: 0.45, avoidsWalls: false },
  { name: "Overview", back: 150, height: 330, lookAhead: 30, lookHeight: 0, haze: 0.12, avoidsWalls: false },
];

/** Higher turns the camera behind the vehicle sooner. */
const FOLLOW_RATE = 3.2;
const EASE_OUT_RATE = 1.6;
const MIN_DISTANCE = 1.6;
const PROBE_STEP = 0.5;

/**
 * Follows the vehicle from behind. It swings round a little later than the
 * vehicle turns, drops back slightly with speed, and moves in and up when a
 * building would come between it and the vehicle.
 */
export class ChaseCamera {
  readonly camera: TargetCamera;
  /** Returns true where the camera must not be: inside or against a building. */
  blocked: (x: number, z: number) => boolean = () => false;
  private viewIndex = 0;
  private heading = 0;
  private distance = CHASE_VIEWS[0]!.back;
  private orbiting = false;
  private orbitAngle = 0;
  private vehicleLength = 4.2;
  private vehicleHeight = 1.5;
  private readonly target = new Vector3();

  constructor(scene: Scene) {
    this.camera = new TargetCamera("chaseCamera", new Vector3(0, 3, -8), scene);
    this.camera.fov = 1.01;
    this.camera.minZ = 0.25;
    this.camera.maxZ = 4000;
    scene.activeCamera = this.camera;
  }

  get viewName(): string {
    return this.orbiting ? "Garage" : CHASE_VIEWS[this.viewIndex]!.name;
  }

  /** Haze multiplier of the current view. */
  get haze(): number {
    return this.orbiting ? 1 : CHASE_VIEWS[this.viewIndex]!.haze;
  }

  /** Metres between the camera and the vehicle in the chase view, after avoiding walls. */
  get chaseDistance(): number {
    return this.distance;
  }

  nextView(): void {
    this.viewIndex = (this.viewIndex + 1) % CHASE_VIEWS.length;
    this.distance = Math.max(MIN_DISTANCE, CHASE_VIEWS[this.viewIndex]!.back);
  }

  setVehicleSize(length: number, height: number): void {
    this.vehicleLength = length;
    this.vehicleHeight = height;
  }

  /** Circle the vehicle slowly, for the garage. */
  setOrbiting(on: boolean): void {
    this.orbiting = on;
    if (on) this.orbitAngle = 0.7;
  }

  /** Jump straight behind the vehicle, without the usual lag. */
  snap(heading: number): void {
    this.heading = heading;
    this.distance = Math.max(MIN_DISTANCE, CHASE_VIEWS[this.viewIndex]!.back);
  }

  update(x: number, z: number, heading: number, deltaSeconds: number, speed = 0): void {
    if (this.orbiting) {
      this.orbitAngle += deltaSeconds * 0.35;
      const a = heading + this.orbitAngle;
      let r = 6.4;
      // Keep the showroom view out of walls too.
      while (r > 3 && this.blocked(x + Math.sin(a) * r, z + Math.cos(a) * r)) r -= 0.5;
      this.camera.position.set(x + Math.sin(a) * r, 1.75, z + Math.cos(a) * r);
      this.target.set(x, 0.75, z);
      this.camera.setTarget(this.target);
      return;
    }

    let diff = heading - this.heading;
    if (diff > Math.PI) diff -= Math.PI * 2;
    else if (diff < -Math.PI) diff += Math.PI * 2;
    this.heading += diff * (1 - Math.exp(-FOLLOW_RATE * deltaSeconds));

    const view = CHASE_VIEWS[this.viewIndex]!;
    const sin = Math.sin(this.heading), cos = Math.cos(this.heading);
    let back = view.back, height = view.height;
    if (view.onVehicle) {
      back = view.back * this.vehicleLength;
      height = view.height * this.vehicleHeight;
      // Attached to the body: no lag, or the bonnet would slide about.
      const s = Math.sin(heading), c = Math.cos(heading);
      this.camera.position.set(x - s * back, height, z - c * back);
      this.target.set(x + s * view.lookAhead, view.lookHeight, z + c * view.lookAhead);
      this.camera.setTarget(this.target);
      return;
    }
    if (view.avoidsWalls) {
      const wanted = view.back + Math.min(1.6, Math.abs(speed) * 0.07);
      let clear = wanted;
      for (let d = MIN_DISTANCE; d <= wanted + 0.4; d += PROBE_STEP) {
        if (this.blocked(x - sin * d, z - cos * d)) {
          clear = Math.max(MIN_DISTANCE, d - PROBE_STEP);
          break;
        }
      }
      // In at once, out gradually: easing inward would leave the camera inside the wall while it caught up.
      if (clear < this.distance) this.distance = clear;
      else this.distance += (clear - this.distance) * (1 - Math.exp(-EASE_OUT_RATE * deltaSeconds));
      back = this.distance;
      // Closer means higher, so the vehicle stays in view over its own roof.
      height = view.height + Math.max(0, view.back - back) * 0.38;
    }
    this.camera.position.set(x - sin * back, height, z - cos * back);
    this.target.set(x + sin * view.lookAhead, view.lookHeight, z + cos * view.lookAhead);
    this.camera.setTarget(this.target);
  }

  dispose(): void {
    this.camera.dispose();
  }
}
