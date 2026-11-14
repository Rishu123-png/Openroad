/**
 * Game actions, independent of the device that produced them (master plan
 * section 8.4). Game code asks "is Accelerate held?", never "is W held?".
 */
export const InputAction = {
  Accelerate: "accelerate",
  Brake: "brake",
  SteerLeft: "steerLeft",
  SteerRight: "steerRight",
  Handbrake: "handbrake",
  CameraChange: "cameraChange",
  Reset: "reset",
  DebugView: "debugView",
} as const;

export type InputAction = (typeof InputAction)[keyof typeof InputAction];

/** Maps `KeyboardEvent.code` values (physical keys) to actions. */
export const DEFAULT_KEY_BINDINGS: Readonly<Record<string, InputAction>> = {
  KeyW: InputAction.Accelerate,
  ArrowUp: InputAction.Accelerate,
  KeyS: InputAction.Brake,
  ArrowDown: InputAction.Brake,
  KeyA: InputAction.SteerLeft,
  ArrowLeft: InputAction.SteerLeft,
  KeyD: InputAction.SteerRight,
  ArrowRight: InputAction.SteerRight,
  Space: InputAction.Handbrake,
  KeyC: InputAction.CameraChange,
  KeyR: InputAction.Reset,
  KeyV: InputAction.DebugView,
};
