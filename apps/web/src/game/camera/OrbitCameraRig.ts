import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";

export interface CameraPreset {
  name: string;
  /** Point the camera looks at, in metres. */
  target: readonly [number, number, number];
  /** Compass angle around the target, in radians. */
  alpha: number;
  /** Angle down from vertical, in radians. */
  beta: number;
  /** Distance from the target, in metres. */
  radius: number;
}

/** Views cycled by the CameraChange action. */
export const CAMERA_PRESETS: readonly CameraPreset[] = [
  // About where a chase camera will sit: behind and above the middle lane, heading +Z.
  { name: "Driving view", target: [-7.25, 1.3, -52], alpha: -Math.PI / 2, beta: 1.47, radius: 9 },
  { name: "Footpath", target: [-11, 1.5, -24], alpha: -2.25, beta: 1.5, radius: 7.5 },
  { name: "Junction", target: [0, 3, 0], alpha: -2.2, beta: 1.2, radius: 58 },
  { name: "Aerial", target: [0, 0, 40], alpha: -1.95, beta: 0.95, radius: 210 },
];

/** Vertical field of view: 58 degrees, about 90 degrees horizontally on a 16:9 screen. */
const FIELD_OF_VIEW = 1.01;
/** Higher is snappier. The camera covers about 95% of a move in one second. */
const TRANSITION_RATE = 3;

/**
 * An inspection camera that orbits a point in the world. It is a stand-in
 * until the vehicle exists and a chase camera replaces it.
 *
 * Changing view glides to the new position instead of cutting.
 */
export class OrbitCameraRig {
  readonly camera: ArcRotateCamera;
  private presetIndex = 0;
  private attachedTo: HTMLElement | null = null;
  private goal: CameraPreset | null = null;

  constructor(scene: Scene) {
    const first = CAMERA_PRESETS[0]!;
    this.camera = new ArcRotateCamera("orbitCamera", first.alpha, first.beta, first.radius, new Vector3(...first.target), scene);
    this.camera.fov = FIELD_OF_VIEW;
    this.camera.minZ = 0.3;
    this.camera.maxZ = 4000;
    this.camera.lowerRadiusLimit = 2.5;
    this.camera.upperRadiusLimit = 420;
    this.camera.upperBetaLimit = Math.PI / 2 - 0.02; // never dip below the ground
    this.camera.wheelDeltaPercentage = 0.02;
    this.camera.inertia = 0.88; // mouse movement eases out
    this.camera.panningSensibility = 0; // orbit and zoom only
    // The keyboard belongs to the input layer. Without this, Babylon's default
    // camera input would also react to the arrow keys.
    this.camera.inputs.removeByType("ArcRotateCameraKeyboardMoveInput");
    scene.activeCamera = this.camera;
  }

  get presetName(): string {
    return CAMERA_PRESETS[this.presetIndex]!.name;
  }

  get isMoving(): boolean {
    return this.goal !== null;
  }

  /** Enable mouse and touch orbiting on the given element. Touching the view cancels a glide. */
  attach(element: HTMLElement): void {
    this.camera.attachControl(element, true);
    element.addEventListener("pointerdown", this.cancelTransition);
    element.addEventListener("wheel", this.cancelTransition, { passive: true });
    this.attachedTo = element;
  }

  nextPreset(): void {
    this.presetIndex = (this.presetIndex + 1) % CAMERA_PRESETS.length;
    this.goal = CAMERA_PRESETS[this.presetIndex]!;
  }

  reset(): void {
    this.presetIndex = 0;
    this.goal = CAMERA_PRESETS[0]!;
  }

  /** Advance the glide toward the selected view. Call once per frame. */
  update(deltaSeconds: number): void {
    const goal = this.goal;
    if (!goal) return;
    const camera = this.camera;
    // Frame-rate independent easing.
    const t = 1 - Math.exp(-TRANSITION_RATE * Math.max(0, deltaSeconds));
    // Take the short way round the compass.
    let turn = (goal.alpha - camera.alpha) % (Math.PI * 2);
    if (turn > Math.PI) turn -= Math.PI * 2;
    if (turn < -Math.PI) turn += Math.PI * 2;
    camera.alpha += turn * t;
    camera.beta += (goal.beta - camera.beta) * t;
    camera.radius += (goal.radius - camera.radius) * t;
    const target = camera.target;
    target.x += (goal.target[0] - target.x) * t;
    target.y += (goal.target[1] - target.y) * t;
    target.z += (goal.target[2] - target.z) * t;
    camera.inertialAlphaOffset = 0;
    camera.inertialBetaOffset = 0;
    camera.inertialRadiusOffset = 0;

    const remaining =
      Math.abs(turn) * (1 - t) +
      Math.abs(goal.beta - camera.beta) +
      Math.abs(goal.radius - camera.radius) / 50 +
      (Math.abs(goal.target[0] - target.x) + Math.abs(goal.target[1] - target.y) + Math.abs(goal.target[2] - target.z)) / 50;
    if (remaining < 0.0005) {
      camera.alpha = goal.alpha;
      camera.beta = goal.beta;
      camera.radius = goal.radius;
      target.set(goal.target[0], goal.target[1], goal.target[2]);
      this.goal = null;
    }
  }

  dispose(): void {
    if (this.attachedTo) {
      this.attachedTo.removeEventListener("pointerdown", this.cancelTransition);
      this.attachedTo.removeEventListener("wheel", this.cancelTransition);
      this.camera.detachControl();
      this.attachedTo = null;
    }
    this.camera.dispose();
  }

  private readonly cancelTransition = (): void => {
    this.goal = null;
  };
}
