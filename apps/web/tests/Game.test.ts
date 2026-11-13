import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Game } from "../src/game/engine/Game";
import { CAMERA_PRESETS } from "../src/game/camera/OrbitCameraRig";
import { PLAYGROUND } from "../src/game/scene/createPlayground";
import { KeyboardInput } from "../src/input/KeyboardInput";

function press(target: EventTarget, code: string): void {
  target.dispatchEvent(Object.assign(new Event("keydown"), { code }));
  target.dispatchEvent(Object.assign(new Event("keyup"), { code }));
}

/** Runs the real scene code on Babylon's headless engine (no GPU, no DOM). */
describe("Game", () => {
  let engine: NullEngine;
  let keys: EventTarget;
  let input: KeyboardInput;
  let windowLike: EventTarget;

  beforeEach(() => {
    engine = new NullEngine();
    keys = new EventTarget();
    input = new KeyboardInput(keys);
    windowLike = new EventTarget();
  });
  afterEach(() => {
    input.dispose();
    engine.dispose();
  });

  it("builds ground, road, lighting and an active camera", () => {
    const game = new Game({ engine, input });
    const { scene } = game;

    expect(scene.getMeshByName("ground")).not.toBeNull();
    expect(scene.getMeshByName("road")).not.toBeNull();
    expect(scene.getMeshByName("edgeLineLeft")).not.toBeNull();
    expect(scene.getMeshByName("edgeLineRight")).not.toBeNull();
    expect(scene.lights.map((light) => light.name).sort()).toEqual(["skyLight", "sunLight"]);
    expect(scene.activeCamera).toBe(game.cameraRig.camera);
    // Keyboard input must only reach the camera through the input layer.
    expect(Object.keys(game.cameraRig.camera.inputs.attached)).not.toContain("keyboard");

    // The road lies on top of the ground and is as wide as specified.
    const road = scene.getMeshByName("road")!;
    const size = road.getBoundingInfo().boundingBox.extendSize;
    expect(size.x * 2).toBeCloseTo(PLAYGROUND.roadWidth);
    expect(size.z * 2).toBeCloseTo(PLAYGROUND.roadLength);
    expect(road.position.y).toBeGreaterThan(0);

    // Centre dashes fit inside the road.
    expect(game.playground.dashCount).toBeGreaterThan(10);
    const dashes = scene.meshes.filter((mesh) => mesh.name.startsWith("centreDash_"));
    expect(dashes).toHaveLength(game.playground.dashCount);
    for (const dash of dashes) {
      expect(Math.abs(dash.position.z) + PLAYGROUND.dashLength / 2).toBeLessThanOrEqual(
        PLAYGROUND.roadLength / 2,
      );
    }
    game.dispose();
  });

  it("renders frames and reports statistics", () => {
    const onStats = vi.fn();
    const game = new Game({ engine, input, onStats });
    expect(() => {
      for (let i = 0; i < 3; i++) game.renderFrame();
    }).not.toThrow();
    expect(game.scene.getFrameId()).toBe(3);
    expect(onStats).toHaveBeenCalled();
    expect(onStats.mock.calls[0]![0].cameraView).toBe(CAMERA_PRESETS[0]!.name);
    game.dispose();
  });

  it("starts and stops the render loop without duplicating it", () => {
    const game = new Game({ engine, input });
    game.start();
    game.start();
    expect(game.isRunning).toBe(true);
    expect(engine.activeRenderLoops).toHaveLength(1);
    game.stop();
    expect(game.isRunning).toBe(false);
    expect(engine.activeRenderLoops).toHaveLength(0);
    game.dispose();
  });

  it("cycles camera views with C and resets with R", () => {
    const game = new Game({ engine, input });
    const camera = game.cameraRig.camera;

    press(keys, "KeyC");
    expect(game.cameraRig.presetName).toBe(CAMERA_PRESETS[1]!.name);
    expect(camera.radius).toBe(CAMERA_PRESETS[1]!.radius);

    press(keys, "KeyR");
    expect(game.cameraRig.presetName).toBe(CAMERA_PRESETS[0]!.name);
    expect(camera.radius).toBe(CAMERA_PRESETS[0]!.radius);

    for (let i = 0; i < CAMERA_PRESETS.length; i++) press(keys, "KeyC");
    expect(game.cameraRig.presetName).toBe(CAMERA_PRESETS[0]!.name); // wrapped around
    game.dispose();
  });

  it("resizes the engine when the window resizes", () => {
    const resize = vi.spyOn(engine, "resize");
    const game = new Game({ engine, input, resizeTarget: windowLike });
    windowLike.dispatchEvent(new Event("resize"));
    expect(resize).toHaveBeenCalledTimes(1);
    game.dispose();
  });

  it("notifies when the graphics context is lost and restored", () => {
    const onContextChange = vi.fn();
    const game = new Game({ engine, input, onContextChange });
    engine.onContextLostObservable.notifyObservers(engine);
    engine.onContextRestoredObservable.notifyObservers(engine);
    expect(onContextChange.mock.calls).toEqual([[true], [false]]);
    game.dispose();
  });

  it("releases everything on dispose", () => {
    const resize = vi.spyOn(engine, "resize");
    const onContextChange = vi.fn();
    const game = new Game({ engine, input, resizeTarget: windowLike, onContextChange });
    game.start();
    game.dispose();
    game.dispose(); // second call is a no-op

    expect(game.isDisposed).toBe(true);
    expect(game.isRunning).toBe(false);
    expect(game.scene.isDisposed).toBe(true);
    expect(engine.scenes).toHaveLength(0);
    expect(engine.activeRenderLoops).toHaveLength(0);

    // Listeners are gone: nothing reacts any more.
    windowLike.dispatchEvent(new Event("resize"));
    expect(resize).not.toHaveBeenCalled();
    engine.onContextLostObservable.notifyObservers(engine);
    expect(onContextChange).not.toHaveBeenCalled();
    const viewBefore = game.cameraRig.presetName;
    press(keys, "KeyC");
    expect(game.cameraRig.presetName).toBe(viewBefore);

    expect(() => game.start()).toThrow(/after dispose/);
  });
});
