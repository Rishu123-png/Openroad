# Session 01 — Foundation and 3D scene

**Milestone:** OPENROAD 0.1 — Foundation and 3D scene.

**Branch:** `arena/cf0809af-openroad`. `main` is unchanged.

**Status:** implemented and verified by the AI coding agent, including in a real headless browser. Two things remain for the owner: a check on real hardware, and approval to merge.

**Note:** this is a record of the first session. The flat test scene it describes was later replaced by the procedural district, and the camera views were renamed. See [World generation and rendering](../WORLD_GENERATION.md).

**Scope:** Rapier.js is not installed. Physics starts with the vehicle milestone.

## What was built

- npm workspaces monorepo with the browser client in `apps/web`.
- Babylon.js engine creation with a readable error when WebGL is unavailable.
- `Game` class with a build, start, stop and dispose lifecycle.
- Test environment: 800 m ground, 400 m straight two-lane road, shoulders, edge lines, dashed centre line, roadside posts.
- Daylight: sky light, sun light, distance fog.
- Orbit camera with three view presets. Mouse orbits and zooms; the keyboard reaches it only through the input layer.
- Input actions with a keyboard source. Driving keys are bound but nothing consumes them yet.
- DOM overlay: status line with FPS, controls hint, error screen.
- 12 unit tests.

See [Technical architecture](../TECHNICAL_ARCHITECTURE.md) for how the parts fit together and for the list of known technical debt.

## Verification performed by the agent

Environment: Linux, Node.js 22.22.3, npm 10.9.8, after a clean `npm ci`.

### Automated checks

| Check | Result |
| --- | --- |
| `npm ci` | Installed, 0 vulnerabilities reported |
| `npm run typecheck` | No errors |
| `npm test` | 12 of 12 passed |
| `npm run build` | Succeeded. JavaScript 1.11 MB (264 kB gzipped), CSS 0.67 kB. Vite warns that the chunk exceeds 500 kB, which is expected |

### HTTP server check

`npm run dev` started Vite on port 5173 and the page returned HTTP 200. This proves the server responds. It proves nothing about rendering.

### Browser rendering check

Run in headless Chromium 153 with WebGL 2 on SwiftShader, a software renderer, at 1280 × 720. The browser came from a temporary install outside the repository, so this check is not repeatable with a repository command yet.

| Check | Development server | Production build |
| --- | --- | --- |
| Page loads with no console errors, warnings, failed requests or HTTP errors | Pass | Pass |
| Status line shows `OPENROAD 0.1.0`, FPS and `Road level` | Pass | Pass |
| Controls hint is shown | Pass | Pass |
| `C` cycles `Three-quarter`, `Overview`; `R` returns to `Road level` | Pass | Pass |
| Canvas matches the window after resizing to 800 × 900 | Pass | Pass |
| Mouse drag orbits the camera | Pass (screenshot) | Not run |
| Sky, ground, road, shoulders, edge lines, centre dashes and posts are drawn, with no flicker visible in still screenshots | Pass (screenshots) | Not run |
| With WebGL disabled, the error screen explains the problem | Pass | Not run |

### Not verified

- Frame rate. The software renderer reported 8 to 24 FPS, which says nothing about a real GPU.
- Flicker while the camera moves. Only still screenshots were inspected.
- Mouse wheel zoom.
- Real GPU context loss.
- Firefox, Edge and Safari.
- Vite hot reload leaving no engine behind after repeated edits.

## Fixes made during verification

| Problem | Fix |
| --- | --- |
| The arrow keys rotated the camera through Babylon's built-in keyboard input, bypassing the input layer | Removed that camera input; a unit test covers it |
| The `pageshow` listener was added again on every hot reload | Listeners are now removed when Vite replaces the module |
| Fog mode was a bare number | Uses `Scene.FOGMODE_LINEAR` |
| `vite/client` types were declared twice | Declared once, in `src/env.d.ts` |

## Your part: check it on the Victus

### 1. Get the branch

```powershell
node -v
git clone https://github.com/Rishu123-png/Openroad.git
cd Openroad
git switch arena/cf0809af-openroad
npm install
```

Node.js must be 22 or newer.

### 2. Run the automated checks

```powershell
npm run typecheck
npm test
npm run build
```

Expected: no type errors, 12 tests passed, and a build that ends with the chunk-size warning.

### 3. Run it in Chrome

```powershell
npm run dev
```

Open http://localhost:5173 and press F12 to open DevTools. These are the items the agent could not verify:

- [ ] The FPS number is close to your display refresh rate.
- [ ] No flickering on the road, lines or shoulders while you orbit and zoom.
- [ ] The mouse wheel zooms, and the camera cannot go under the ground.
- [ ] The picture stays sharp at your screen resolution and scaling.
- [ ] The console shows no red errors.
- [ ] Edit a colour in `apps/web/src/game/scene/createPlayground.ts` and save several times. The page updates and the FPS does not drop.

Write down the FPS and the GPU that Chrome used (`chrome://gpu`). It is the first performance baseline.

### 4. Decide

If every box is ticked, approve a pull request from this branch. If something fails, report which box and what the console says.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| "OPENROAD could not start" mentioning WebGL | Hardware acceleration is off | Turn on "Use graphics acceleration when available" in Chrome settings and restart Chrome |
| Low FPS | Chrome is using the integrated GPU | In Windows Graphics settings, set Chrome to "High performance" |
| Port 5173 is in use | Another dev server is running | Stop it, or run `npm run dev -- --port 5174` |
| `npm error No workspaces found` | The command was run inside `apps/web` | Run it from the repository root |

## Next: Session 02 — Vehicle prototype

Starts only after the hardware check passes and the foundation is approved.

1. Add continuous integration and a Playwright browser test, so the checks above run from the repository.
2. Install Rapier.js and add a fixed-timestep simulation loop.
3. Collision for the ground.
4. A placeholder vehicle body with raycast suspension, steering, engine and brakes.
5. Chase camera and speedometer.
