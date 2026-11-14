import { TargetCamera } from "@babylonjs/core/Cameras/targetCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";

export interface ChaseView {
  name: string;
  /** Metres behind the vehicle. */
  back: number;
  height: number;
  /** How far ahead of the vehicle the camera looks. */
  lookAhead: number;
  lookHeight: number;
  /** Haze relative to street level. High views use less, or the ground would vanish. */
  haze: number;
}

export const CHASE_VIEWS: readonly ChaseView[] = [
  { name: "Chase", back: 7.5, height: 2.9, lookAhead: 5, lookHeight: 1.2, haze: 1 },
  { name: "Street", back: 0.4, height: 1.25, lookAhead: 20, lookHeight: 1.2, haze: 1 },
  { name: "High", back: 45, height: 60, lookAhead: 12, lookHeight: 0, haze: 0.45 },
  { name: "Overview", back: 150, height: 330, lookAhead: 30, lookHeight: 0, haze: 0.12 },
];

/** Higher turns the camera behind the vehicle sooner. */
const FOLLOW_RATE = 3.5;

/**
 * Follows the vehicle from behind. The camera swings round a little later
 * than the vehicle turns, which shows the turn without making it abrupt.
 */
export class ChaseCamera {
  readonly camera: TargetCamera;
  private viewIndex = 0;
  private heading = 0;
  private readonly target = new Vector3();

  constructor(scene: Scene) {
    this.camera = new TargetCamera("chaseCamera", new Vector3(0, 3, -8), scene);
    this.camera.fov = 1.01;
    this.camera.minZ = 0.5;
    this.camera.maxZ = 4000;
    scene.activeCamera = this.camera;
  }

  /** Haze multiplier of the current view. */
  get haze(): number {
    return CHASE_VIEWS[this.viewIndex]!.haze;
  }

  get viewName(): string {
    return CHASE_VIEWS[this.viewIndex]!.name;
  }

  nextView(): void {
    this.viewIndex = (this.viewIndex + 1) % CHASE_VIEWS.length;
  }

  /** Jump straight behind the vehicle, without the usual lag. */
  snap(heading: number): void {
    this.heading = heading;
  }

  update(x: number, z: number, heading: number, deltaSeconds: number): void {
    let diff = heading - this.heading;
    if (diff > Math.PI) diff -= Math.PI * 2;
    else if (diff < -Math.PI) diff += Math.PI * 2;
    this.heading += diff * (1 - Math.exp(-FOLLOW_RATE * deltaSeconds));

    const view = CHASE_VIEWS[this.viewIndex]!;
    const sin = Math.sin(this.heading), cos = Math.cos(this.heading);
    this.camera.position.set(x - sin * view.back, view.height, z - cos * view.back);
    this.target.set(x + sin * view.lookAhead, view.lookHeight, z + cos * view.lookAhead);
    this.camera.setTarget(this.target);
  }

  dispose(): void {
    this.camera.dispose();
  }
}
