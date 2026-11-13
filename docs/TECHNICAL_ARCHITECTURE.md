# Technical architecture

Scope: OPENROAD 0.1, the browser client only. This document grows with each milestone.

## Module responsibilities

| Module | Responsibility | May depend on |
| --- | --- | --- |
| `src/main.ts` | Composition root. Creates the engine, input, UI and game, connects them, tears them down | Everything |
| `game/engine/createEngine.ts` | Creates the WebGL engine and turns a failure into a readable error | Babylon.js, DOM canvas |
| `game/engine/Game.ts` | Owns the scene and its lifecycle: build, start, stop, dispose | Babylon.js, `input/`, other `game/` modules |
| `game/world/` | Generates the procedural test district | Babylon.js, `game/geometry/`, `game/materials/`, `utils/` |
| `game/geometry/` | Builds meshes from boxes, cylinders and other shapes; batches them per material and ground tile | Babylon.js |
| `game/materials/` | Shared physically based materials; textures generated as raw pixels | Babylon.js, `utils/` |
| `game/lighting/` | Sky dome, sky ambient light, sun, static shadow map, haze, tone mapping | Babylon.js, `game/materials/` |
| `utils/` | Seeded random numbers and noise | Nothing |
| `game/camera/` | Camera rig and its view presets | Babylon.js |
| `input/` | Turns keyboard events into game actions | Nothing |
| `ui/` | DOM overlay: status line, help text, error screen | DOM only |

Rules that keep these separate:

1. `ui/` never imports Babylon.js, and `game/` never touches the DOM overlay. `Game` reports through callbacks (`onStats`, `onContextChange`) and `main.ts` forwards them to the overlay.
2. Game code reads actions (`InputAction.Accelerate`), never keys. A gamepad or touch source can be added later without changing game code (master plan section 8.4).
3. The keyboard reaches the game only through `input/`. Babylon's built-in camera keyboard input is removed, so the arrow keys do not move the camera behind the input layer's back. Mouse and touch orbiting still use Babylon's camera input, attached to the canvas.
4. `Game` receives its engine. In the browser that is a WebGL `Engine`. In tests it is Babylon's `NullEngine`, so the real scene code runs without a GPU or a DOM.

## Lifecycle

```
boot()                         main.ts
  Overlay                      "Loading OPENROAD…"
  createEngine(canvas)         throws GraphicsUnavailableError if WebGL is missing
  KeyboardInput(window)
  Game({ engine, input, ... }) builds lighting, district, camera
  game.start()                 engine.runRenderLoop(renderFrame)

shutdown()                     on pagehide, on Vite hot reload, or after a startup error
  game.dispose()               stops the loop, removes listeners, disposes the scene
  input.dispose()
  engine.dispose()
  overlay.dispose()
```

Each object disposes only what it created. `Game` does not dispose the engine or the input, because `main.ts` created them.

## Error handling

| Failure | Behaviour |
| --- | --- |
| WebGL cannot start | Full-screen message telling the player to enable hardware acceleration or update the browser |
| Any other startup error | Everything created so far is disposed; the error message is shown on screen and logged to the console |
| GPU context lost while running | Message shown until the browser restores the context. Babylon.js rebuilds GPU resources itself |
| Scene construction throws | The half-built scene is disposed before the error propagates |
| Page restored from the back/forward cache | The page reloads, because its engine was disposed on `pagehide` |

## World conventions

- Units are metres.
- Y is up. The main road runs along the Z axis, the cross road along X, and they meet at the origin.
- Traffic keeps left.
- See [World generation and rendering](WORLD_GENERATION.md) for the district layout and rendering techniques.
- Babylon.js default left-handed coordinates.

## Decisions

| Decision | Reason |
| --- | --- |
| npm workspaces with `apps/web` | Matches the target layout in Part 10 of the master plan, so the server and shared packages can be added without moving files |
| Deep imports such as `@babylonjs/core/Meshes/mesh` | Lets the bundler drop unused parts of Babylon.js. The production entry chunk is 1.19 MB (297 kB gzipped) |
| Physically based materials with textures generated in code | Realistic response to light with no assets to license or download |
| Batching per material and ground tile; instances for repeated objects | About 200 draw calls for the whole district |
| Orbit camera with four presets and gliding transitions | An inspection camera until the vehicle exists and the chase camera replaces it |
| No UI framework | The overlay is three elements. Revisit when menus are built |
| No physics engine | Rapier.js is planned for the vehicle milestone and is not installed |

## Verification

| Layer | How it is checked | Automated in the repository |
| --- | --- | --- |
| Types | `npm run typecheck` | Yes |
| District contents, camera, lifecycle, disposal | `tests/Game.test.ts` on Babylon's `NullEngine` | Yes |
| Mesh winding, texture coordinates, textures, noise | `tests/geometry.test.ts` | Yes |
| Keyboard input | `tests/KeyboardInput.test.ts` | Yes |
| Production bundle | `npm run build` | Yes |
| Real rendering, overlay, `main.ts`, error screen | Manual check in a browser (see Session 01) | No |

## Known technical debt

| Item | Impact | When to address |
| --- | --- | --- |
| No browser test in the repository | `main.ts`, `Overlay` and real rendering are only checked by hand | Add Playwright before the vehicle milestone grows the UI |
| No continuous integration | Checks run only when someone remembers | Add a GitHub Actions workflow running typecheck, test and build |
| No linter or formatter | Style is unenforced | Before the first collaborator joins |
| Single 1.1 MB JavaScript chunk | Slower first load | When assets and Rapier.js are added; split with dynamic imports |
| `KeyboardInput` calls `preventDefault` on every bound key | Would block typing W, A, S, D or Space in a text field | Before chat or any text input exists |
| Driving actions are bound but unused | None today | Consumed by the vehicle controller in Session 02 |
| Only the keyboard input source exists | No gamepad or touch | Android milestone |
| Frame rate on a real GPU is unmeasured | The district may be too heavy for integrated graphics | Measure on the RTX 3050, then add graphics quality settings |
| No graphics quality settings | No fallback for slow devices | With the first hardware measurements |
| Sky ambient light is skipped on the headless test engine | Tests do not cover it | When a browser test exists |
| A development-only `window.openroad` handle exposes the game | None in production builds | Keep |
| Context-loss handling is unit-tested with a simulated event only | Real GPU loss is unverified | Test with `WEBGL_lose_context` when Playwright is added |
| Dev server allows `.e2b.app` hosts | Development only; needed for the agent's hosted preview | Remove if agent previews are no longer used |

## Not built yet

Vehicle and physics, AI traffic, real map data, multiplayer, accounts, database, audio, graphics settings.
