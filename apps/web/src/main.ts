import { createEngine } from "./game/engine/createEngine";
import { Game } from "./game/engine/Game";
import { KeyboardInput } from "./input/KeyboardInput";
import { Overlay } from "./ui/Overlay";

/**
 * Composition root: creates the engine, input, UI and game, connects them and
 * guarantees they are torn down together.
 */
function boot(): () => void {
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

    const game = new Game({
      engine,
      input,
      canvas,
      resizeTarget: window,
      onStats: ({ fps, cameraView }) => {
        overlay.setStatus(`OPENROAD ${__APP_VERSION__} · ${fps.toFixed(0)} FPS · ${cameraView}`);
      },
      onContextChange: (lost) => {
        if (lost) overlay.showError("The graphics context was lost. Waiting for the browser to restore it…");
        else overlay.hideError();
      },
    });
    disposers.push(() => game.dispose());

    overlay.setHelp("Drag: orbit · Wheel: zoom · C: change view · R: reset view");
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

const shutdown = boot();

// Free GPU resources when the tab closes. A page restored from the
// back/forward cache is reloaded, because its engine was disposed on pagehide.
const handlePageShow = (event: PageTransitionEvent): void => {
  if (event.persisted) window.location.reload();
};
window.addEventListener("pagehide", shutdown);
window.addEventListener("pageshow", handlePageShow);

// During development, dispose the old game before Vite swaps in new code,
// otherwise every edit would leave another engine running on the canvas.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    window.removeEventListener("pagehide", shutdown);
    window.removeEventListener("pageshow", handlePageShow);
    shutdown();
  });
}
