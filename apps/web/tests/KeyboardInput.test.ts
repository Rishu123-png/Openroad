import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InputAction } from "../src/input/InputActions";
import { KeyboardInput } from "../src/input/KeyboardInput";

function key(type: "keydown" | "keyup", code: string, repeat = false): Event {
  return Object.assign(new Event(type), { code, repeat });
}

describe("KeyboardInput", () => {
  let target: EventTarget;
  let input: KeyboardInput;

  beforeEach(() => {
    target = new EventTarget();
    input = new KeyboardInput(target);
  });
  afterEach(() => input.dispose());

  it("reports held actions for both bound keys", () => {
    expect(input.isDown(InputAction.Accelerate)).toBe(false);
    target.dispatchEvent(key("keydown", "KeyW"));
    target.dispatchEvent(key("keydown", "ArrowUp"));
    expect(input.isDown(InputAction.Accelerate)).toBe(true);
    target.dispatchEvent(key("keyup", "KeyW"));
    expect(input.isDown(InputAction.Accelerate)).toBe(true); // ArrowUp still held
    target.dispatchEvent(key("keyup", "ArrowUp"));
    expect(input.isDown(InputAction.Accelerate)).toBe(false);
  });

  it("fires onPressed once per press and ignores key repeat", () => {
    const listener = vi.fn();
    input.onPressed(InputAction.CameraChange, listener);
    target.dispatchEvent(key("keydown", "KeyC"));
    target.dispatchEvent(key("keydown", "KeyC", true));
    expect(listener).toHaveBeenCalledTimes(1);
    target.dispatchEvent(key("keyup", "KeyC"));
    target.dispatchEvent(key("keydown", "KeyC"));
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("ignores unbound keys", () => {
    const listener = vi.fn();
    input.onPressed(InputAction.Reset, listener);
    target.dispatchEvent(key("keydown", "KeyQ"));
    expect(listener).not.toHaveBeenCalled();
  });

  it("releases held keys when focus is lost", () => {
    target.dispatchEvent(key("keydown", "Space"));
    expect(input.isDown(InputAction.Handbrake)).toBe(true);
    target.dispatchEvent(new Event("blur"));
    expect(input.isDown(InputAction.Handbrake)).toBe(false);
  });

  it("stops listening after unsubscribe and after dispose", () => {
    const listener = vi.fn();
    const unsubscribe = input.onPressed(InputAction.Reset, listener);
    unsubscribe();
    target.dispatchEvent(key("keydown", "KeyR"));
    expect(listener).not.toHaveBeenCalled();

    input.dispose();
    target.dispatchEvent(key("keydown", "KeyW"));
    expect(input.isDown(InputAction.Accelerate)).toBe(false);
  });
});
