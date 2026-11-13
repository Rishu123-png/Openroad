import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { Observer } from "@babylonjs/core/Misc/observable";
import { Scene } from "@babylonjs/core/scene";
import { InputAction } from "../../input/InputActions";
import type { KeyboardInput } from "../../input/KeyboardInput";
import { OrbitCameraRig } from "../camera/OrbitCameraRig";
import { createDaylight, type Daylight } from "../lighting/createDaylight";
import { createWorld, type World } from "../world/createWorld";

export interface GameOptions {
  engine: AbstractEngine;
  input: KeyboardInput;
  /** Element that receives mouse and touch camera control. Omit when headless. */
  canvas?: HTMLCanvasElement;
  /** Source of `resize` events, normally `window`. Omit when headless. */
  resizeTarget?: EventTarget;
  /** Called about four times per second with display statistics. */
  onStats?: (stats: GameStats) => void;
  /** Called when the GPU context is lost or restored. */
  onContextChange?: (lost: boolean) => void;
}

export interface GameStats {
  fps: number;
  cameraView: string;
  /** Draw calls in the last frame. */
  drawCalls: number;
  /** Meshes that passed frustum culling in the last frame. */
  activeMeshes: number;
  /** Triangles submitted in the last frame. */
  triangles: number;
}

const STATS_INTERVAL_MS = 250;

/**
 * Owns the Babylon.js scene and its lifecycle: build, run, stop, dispose.
 *
 * The engine, input and UI are passed in, so this class has no dependency on
 * the DOM or WebGL and can run under a headless engine in tests.
 */
export class Game {
  readonly scene: Scene;
  readonly world: World;
  readonly daylight: Daylight;
  readonly cameraRig: OrbitCameraRig;

  private readonly engine: AbstractEngine;
  private readonly options: GameOptions;
  private readonly cleanups: Array<() => void> = [];
  private contextLostObserver: Observer<AbstractEngine> | null = null;
  private contextRestoredObserver: Observer<AbstractEngine> | null = null;
  private running = false;
  private disposed = false;
  private lastStatsAt = 0;
  private lastDrawCalls = 0;

  constructor(options: GameOptions) {
    this.options = options;
    this.engine = options.engine;

    this.scene = new Scene(this.engine);
    try {
      // Nothing is clickable yet, so skip the per-move picking pass.
      this.scene.skipPointerMovePicking = true;
      this.daylight = createDaylight(this.scene);
      this.world = createWorld(this.scene);
      this.daylight.setStaticShadowCasters(this.world.shadowCasters);
      this.cameraRig = new OrbitCameraRig(this.scene);
      if (options.canvas) this.cameraRig.attach(options.canvas);
    } catch (error) {
      // Do not leak a half-built scene.
      this.scene.dispose();
      throw error;
    }

    this.cleanups.push(
      options.input.onPressed(InputAction.CameraChange, () => this.cameraRig.nextPreset()),
      options.input.onPressed(InputAction.Reset, () => this.cameraRig.reset()),
    );

    if (options.resizeTarget) {
      const target = options.resizeTarget;
      target.addEventListener("resize", this.handleResize);
      this.cleanups.push(() => target.removeEventListener("resize", this.handleResize));
    }

    this.contextLostObserver = this.engine.onContextLostObservable.add(() => {
      this.options.onContextChange?.(true);
    });
    this.contextRestoredObserver = this.engine.onContextRestoredObservable.add(() => {
      this.options.onContextChange?.(false);
    });
  }

  get isRunning(): boolean {
    return this.running;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Start the render loop. Safe to call more than once. */
  start(): void {
    if (this.disposed) throw new Error("Game.start() was called after dispose().");
    if (this.running) return;
    this.running = true;
    this.engine.runRenderLoop(this.renderFrame);
  }

  /** Stop the render loop but keep the scene, so `start()` can resume it. */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.engine.stopRenderLoop(this.renderFrame);
  }

  /** Render a single frame. Called by the render loop; public for tests. */
  renderFrame = (): void => {
    this.cameraRig.update(this.engine.getDeltaTime() / 1000);
    const drawCallsBefore = this.engine._drawCalls.current;
    this.scene.render();
    this.lastDrawCalls = this.engine._drawCalls.current - drawCallsBefore;

    const now = performance.now();
    if (this.options.onStats && now - this.lastStatsAt >= STATS_INTERVAL_MS) {
      this.lastStatsAt = now;
      this.options.onStats({
        fps: this.engine.getFps(),
        cameraView: this.cameraRig.presetName,
        drawCalls: this.lastDrawCalls,
        activeMeshes: this.scene.getActiveMeshes().length,
        triangles: Math.round(this.scene.getActiveIndices() / 3),
      });
    }
  };

  /**
   * Stop rendering and release everything this class created: listeners,
   * camera controls and the scene with its meshes and materials.
   * The engine and input belong to the caller and are not disposed here.
   */
  dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;

    for (const cleanup of this.cleanups) cleanup();
    this.cleanups.length = 0;
    this.engine.onContextLostObservable.remove(this.contextLostObserver);
    this.engine.onContextRestoredObservable.remove(this.contextRestoredObserver);
    this.contextLostObserver = null;
    this.contextRestoredObserver = null;

    this.cameraRig.dispose();
    this.scene.dispose();
  }

  private readonly handleResize = (): void => {
    this.engine.resize();
  };
}
