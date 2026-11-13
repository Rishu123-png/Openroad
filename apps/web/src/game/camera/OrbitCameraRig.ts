import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";

interface CameraPreset {
  name: string;
  alpha: number;
  beta: number;
  radius: number;
}

/** Views cycled by the CameraChange action. Angles in radians, radius in metres. */
export const CAMERA_PRESETS: readonly CameraPreset[] = [
  { name: "Road level", alpha: -Math.PI / 2, beta: 1.45, radius: 14 },
  { name: "Three-quarter", alpha: -Math.PI / 3, beta: 1.15, radius: 30 },
  { name: "Overview", alpha: -Math.PI / 2, beta: 0.55, radius: 90 },
];

/**
 * An inspection camera that orbits a point on the road. It is a stand-in until
 * the vehicle exists and the chase camera replaces it.
 */
export class OrbitCameraRig {
  readonly camera: ArcRotateCamera;
  private presetIndex = 0;
  private attachedTo: HTMLElement | null = null;

  constructor(scene: Scene, target = new Vector3(0, 1, 0)) {
    const first = CAMERA_PRESETS[0]!;
    this.camera = new ArcRotateCamera("orbitCamera", first.alpha, first.beta, first.radius, target, scene);
    this.camera.minZ = 0.2;
    this.camera.maxZ = 600;
    this.camera.lowerRadiusLimit = 4;
    this.camera.upperRadiusLimit = 150;
    this.camera.upperBetaLimit = Math.PI / 2 - 0.03; // never dip below the ground
    this.camera.wheelDeltaPercentage = 0.02;
    this.camera.panningSensibility = 0; // orbit and zoom only
    // The keyboard belongs to the input layer. Without this, Babylon's default
    // camera input would also react to the arrow keys.
    this.camera.inputs.removeByType("ArcRotateCameraKeyboardMoveInput");
    scene.activeCamera = this.camera;
  }

  get presetName(): string {
    return CAMERA_PRESETS[this.presetIndex]!.name;
  }

  /** Enable mouse and touch orbiting on the given element. */
  attach(element: HTMLElement): void {
    this.camera.attachControl(element, true);
    this.attachedTo = element;
  }

  nextPreset(): void {
    this.presetIndex = (this.presetIndex + 1) % CAMERA_PRESETS.length;
    this.applyPreset();
  }

  reset(): void {
    this.presetIndex = 0;
    this.applyPreset();
  }

  dispose(): void {
    if (this.attachedTo) {
      this.camera.detachControl();
      this.attachedTo = null;
    }
    this.camera.dispose();
  }

  private applyPreset(): void {
    const preset = CAMERA_PRESETS[this.presetIndex]!;
    this.camera.alpha = preset.alpha;
    this.camera.beta = preset.beta;
    this.camera.radius = preset.radius;
    // Cancel any leftover orbit momentum from the mouse.
    this.camera.inertialAlphaOffset = 0;
    this.camera.inertialBetaOffset = 0;
    this.camera.inertialRadiusOffset = 0;
  }
}
