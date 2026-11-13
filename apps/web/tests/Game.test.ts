import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Game } from "../src/game/engine/Game";
import { CAMERA_PRESETS } from "../src/game/camera/OrbitCameraRig";
import { LAYOUT } from "../src/game/world/layout";
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

  it("builds the district, lighting and an active camera", () => {
    const game = new Game({ engine, input });
    const { scene, world } = game;

    // Roads, kerbs, footpaths and verges exist as batched meshes.
    for (const layer of ["asphalt", "roadPaint", "concrete", "pavers", "grass", "plaster", "metal", "signs"]) {
      expect(scene.meshes.some((mesh) => mesh.name.startsWith(`${layer}@`)), layer).toBe(true);
    }
    expect(scene.getMeshByName("skyDome")).not.toBeNull();
    expect(scene.lights.map((light) => light.name)).toEqual(["sunLight"]);
    expect(scene.activeCamera).toBe(game.cameraRig.camera);
    // Keyboard input must only reach the camera through the input layer.
    expect(Object.keys(game.cameraRig.camera.inputs.attached)).not.toContain("keyboard");

    // The district is populated.
    expect(world.counts.buildings).toBeGreaterThan(40);
    expect(world.counts.skylineTowers).toBeGreaterThan(60);
    expect(world.counts.trees).toBeGreaterThan(200);
    expect(world.counts.shrubs).toBeGreaterThan(200);
    expect(world.counts.streetLights).toBeGreaterThan(20);
    expect(world.counts.signals).toBe(4);
    expect(world.counts.laneDashes).toBeGreaterThan(100);
    expect(world.shadowCasters.length).toBeGreaterThan(200);

    // Batching keeps the mesh count far below the object count.
    expect(world.counts.staticMeshes).toBeLessThan(400);

    // The carriageway is flat, at ground level, and reaches the kerb.
    const road = scene.meshes.find((mesh) => mesh.name.startsWith("asphalt@0_0"))!;
    const box = road.getBoundingInfo().boundingBox;
    expect(box.maximumWorld.x).toBeGreaterThanOrEqual(LAYOUT.roadEdge);
    expect(box.minimumWorld.y).toBe(0);
    expect(box.maximumWorld.y).toBe(0);
    game.dispose();
  });

  it("generates the same district every time", () => {
    const a = new Game({ engine, input });
    const countsA = { ...a.world.counts };
    const verticesA = a.scene.getTotalVertices();
    a.dispose();
    const b = new Game({ engine, input });
    expect(b.world.counts).toEqual(countsA);
    expect(b.scene.getTotalVertices()).toBe(verticesA);
    b.dispose();
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
    // The view glides: part of the way after a short time, all the way later.
    const startRadius = camera.radius;
    game.cameraRig.update(0.1);
    expect(game.cameraRig.isMoving).toBe(true);
    expect(camera.radius).not.toBe(startRadius);
    expect(camera.radius).not.toBe(CAMERA_PRESETS[1]!.radius);
    for (let i = 0; i < 600; i++) game.cameraRig.update(1 / 60);
    expect(game.cameraRig.isMoving).toBe(false);
    expect(camera.radius).toBe(CAMERA_PRESETS[1]!.radius);
    expect(camera.target.z).toBe(CAMERA_PRESETS[1]!.target[2]);

    press(keys, "KeyR");
    expect(game.cameraRig.presetName).toBe(CAMERA_PRESETS[0]!.name);
    for (let i = 0; i < 600; i++) game.cameraRig.update(1 / 60);
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
