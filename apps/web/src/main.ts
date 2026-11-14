import { loadDistrict, districtUrl } from "./game/district/loadDistrict";
import type { DistrictData } from "./game/district/types";
import { createEngine } from "./game/engine/createEngine";
import { DistrictGame } from "./game/engine/DistrictGame";
import { Game } from "./game/engine/Game";
import type { GameBase, GameOptions } from "./game/engine/GameBase";
import { KeyboardInput } from "./input/KeyboardInput";
import { Overlay } from "./ui/Overlay";

/**
 * Composition root: creates the engine, input, UI and game, connects them and
 * guarantees they are torn down together.
 */
function boot(district: DistrictData | null): () => void {
  const canvas = document.getElementById("game");
  const uiRoot = document.getElementById("ui");
  if (!(canvas instanceof HTMLCanvasElement) || !uiRoot) {
    throw new Error("index.html is missing the #game canvas or the #ui container.");
  }

  const overlay = new Overlay(uiRoot);
  const disposers: Array<() => void> = [() => overlay.dispose()];
  const shutdown = (): void => {
    // Reverse order: game, then input, then engine, then UI.
    for (const dispose of disposers.splice(0).reverse()) dispose();
  };

  try {
    const engine = createEngine(canvas);
    disposers.push(() => engine.dispose());

    const input = new KeyboardInput(window);
    disposers.push(() => input.dispose());

    const options: GameOptions = {
      engine,
      input,
      canvas,
      resizeTarget: window,
      onStats: (stats) => {
        overlay.setStatus(`OPENROAD ${__APP_VERSION__} · ${stats.fps.toFixed(0)} FPS · ${stats.cameraView}`);
        overlay.setDetail(
          `${stats.drawCalls} draw calls · ${stats.activeMeshes} meshes · ${(stats.triangles / 1000).toFixed(0)}k triangles`,
        );
        if (stats.speedKmh !== undefined) overlay.setSpeed(stats.speedKmh, stats.onRoad === false ? "off road" : "");
        overlay.setLegend(stats.debugLegend ? `${stats.debugView}: ${stats.debugLegend}` : "");
      },
      onContextChange: (lost) => {
        if (lost) overlay.showError("The graphics context was lost. Waiting for the browser to restore it…");
        else overlay.hideError();
      },
    };
    const game: GameBase = district ? new DistrictGame({ ...options, district }) : new Game(options);
    disposers.push(() => game.dispose());
    // Development aid: inspect the running game from the browser console.
    if (import.meta.env.DEV || new URLSearchParams(window.location.search).has("inspect")) (window as unknown as { openroad?: GameBase }).openroad = game;

    if (district) {
      overlay.setHelp("W/S or ↑/↓: drive, brake, reverse · A/D or ←/→: steer · Space: handbrake · C: camera · V: data views · R: back to start");
      if (district.synthetic) overlay.setCredit("SYNTHETIC TEST DATA: an invented layout, not a map of Greater Noida", true);
      else overlay.setCredit(`${district.name} · ${district.attribution} · building heights and road widths are partly estimated (press V)`);
    } else {
      overlay.setHelp("Fictional test district · Drag: orbit · Wheel: zoom · C: change view · R: reset view");
      overlay.setCredit("Fictional test district: not a real place", true);
    }
    game.start();
    canvas.focus();
  } catch (error) {
    console.error("[OPENROAD] Startup failed:", error);
    const message = error instanceof Error ? error.message : String(error);
    shutdown();
    // Keep a fresh overlay on screen so the player sees why nothing rendered.
    const errorOverlay = new Overlay(uiRoot);
    errorOverlay.showError(message);
    errorOverlay.setStatus("OPENROAD failed to start");
    return () => errorOverlay.dispose();
  }

  return shutdown;
}

/**
 * Chooses what to show:
 *   (default)             the Alpha 1 district built from the OpenStreetMap extract
 *   ?district=synthetic   invented test data from tools/build-district.mjs --synthetic
 *   ?world=test           the fictional test district from before map data existed
 */
async function chooseWorld(): Promise<DistrictData | null> {
  const params = new URLSearchParams(window.location.search);
  if (params.get("world") === "test") return null;
  const id = params.get("district") === "synthetic" ? "synthetic" : "alpha-1";
  return loadDistrict(districtUrl(import.meta.env.BASE_URL, "greater-noida", id));
}

let shutdown: () => void = () => {};
let closed = false;
chooseWorld().then(
  (district) => {
    if (!closed) shutdown = boot(district);
  },
  (error: unknown) => {
    console.error("[OPENROAD] District could not be loaded:", error);
    const uiRoot = document.getElementById("ui");
    if (!uiRoot || closed) return;
    const overlay = new Overlay(uiRoot);
    const message = error instanceof Error ? error.message : String(error);
    overlay.showError(`${message} To look at something without the map data, add ?district=synthetic (invented test layout) or ?world=test (fictional test district) to the address.`);
    overlay.setStatus("OPENROAD: no district data");
    shutdown = () => overlay.dispose();
  },
);
const handlePageHide = (): void => {
  closed = true;
  shutdown();
};
// Free GPU resources when the tab closes. A page restored from the
// back/forward cache is reloaded, because its engine was disposed on pagehide.
const handlePageShow = (event: PageTransitionEvent): void => {
  if (event.persisted) window.location.reload();
};

window.addEventListener("pagehide", handlePageHide);
window.addEventListener("pageshow", handlePageShow);

// During development, dispose the old game before Vite swaps in new code,
// otherwise every edit would leave another engine running on the canvas.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    window.removeEventListener("pagehide", handlePageHide);
    window.removeEventListener("pageshow", handlePageShow);
    handlePageHide();
  });
}
