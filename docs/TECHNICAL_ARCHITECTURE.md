# Technical architecture

Scope: OPENROAD 0.1, the browser client only. This document grows with each milestone.

## Module responsibilities

| Module | Responsibility | May depend on |
| --- | --- | --- |
| `src/main.ts` | Composition root. Creates the engine, input, UI and game, connects them, tears them down | Everything |
| `game/engine/createEngine.ts` | Creates the WebGL engine and turns a failure into a readable error | Babylon.js, DOM canvas |
| `game/engine/Game.ts` | Owns the scene and its lifecycle: build, start, stop, dispose | Babylon.js, `input/`, other `game/` modules |
| `game/scene/` | Builds the static test environment | Babylon.js |
| `game/lighting/` | Lights, sky colour, fog | Babylon.js |
| `game/camera/` | Camera rig and its view presets | Babylon.js |
| `input/` | Turns device events into game actions | Nothing |
| `ui/` | DOM overlay: status line, help text, error screen | DOM only |

Rules that keep these separate:

1. `ui/` never imports Babylon.js, and `game/` never touches the DOM overlay. `Game` reports through callbacks (`onStats`, `onContextChange`) and `main.ts` forwards them to the overlay.
2. Game code reads actions (`InputAction.Accelerate`), never keys. A gamepad or touch source can be added later without changing game code (master plan section 8.4).
3. `Game` receives its engine. In the browser that is a WebGL `Engine`. In tests it is Babylon's `NullEngine`, so the real scene code runs without a GPU or a DOM.

## Lifecycle

```
boot()                         main.ts
  Overlay                      "Loading OPENROAD…"
  createEngine(canvas)         throws GraphicsUnavailableError if WebGL is missing
  KeyboardInput(window)
  Game({ engine, input, ... }) builds lighting, playground, camera
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
- Y is up. The test road runs along the Z axis and is centred on the origin.
- Babylon.js default left-handed coordinates.

## Decisions

| Decision | Reason |
| --- | --- |
| npm workspaces with `apps/web` | Matches the target layout in Part 10 of the master plan, so the server and shared packages can be added without moving files |
| Deep imports such as `@babylonjs/core/Meshes/mesh` | Lets the bundler drop unused parts of Babylon.js. The production bundle is 1.1 MB (264 kB gzipped) |
| `StandardMaterial`, flat colours, no textures | No assets to license or load yet. PBR materials come with real assets |
| Instances for lane dashes and posts | One draw call per repeated object type |
| Orbit camera with three presets | An inspection camera for the empty scene. The chase camera replaces it when the vehicle exists |
| No UI framework | The overlay is three elements. Revisit when menus are built |
| No physics engine | Rapier.js is planned for the vehicle milestone and is not installed |

## Not built yet

Vehicle and physics, AI traffic, real map data, multiplayer, accounts, database, audio, graphics settings.
