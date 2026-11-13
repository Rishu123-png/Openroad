# Session 01 — Foundation and 3D scene

**Milestone:** OPENROAD 0.1 — Foundation and 3D scene.

**Status:** implemented by the AI coding agent on branch `arena/cf0809af-openroad`. Automated checks pass. The manual browser check below is still to be done.

**Scope change from the first draft of this document:** Rapier.js is not installed in this session. Physics starts with the vehicle milestone, after the rendering prototype is confirmed in a browser.

## What was built

- npm workspaces monorepo with the browser client in `apps/web`.
- Babylon.js engine creation with a readable error when WebGL is unavailable.
- `Game` class with a build, start, stop and dispose lifecycle.
- Test environment: 800 m ground, 400 m straight two-lane road, shoulders, edge lines, dashed centre line, roadside posts.
- Daylight: sky light, sun light, distance fog.
- Orbit camera with three view presets.
- Device-independent input actions with a keyboard source.
- DOM overlay: status line with FPS, controls hint, error screen.
- 12 unit tests.

See [Technical architecture](../TECHNICAL_ARCHITECTURE.md) for how the parts fit together.

## Your part: check it on the Victus

### 1. Check the tools

```powershell
node -v
npm -v
git --version
```

Node.js must be 22 or newer.

### 2. Get the branch

```powershell
git clone https://github.com/Rishu123-png/Openroad.git
cd Openroad
git switch arena/cf0809af-openroad
npm install
```

### 3. Run the automated checks

```powershell
npm run typecheck
npm test
npm run build
```

Expected: no type errors, 12 tests passed, and a build that ends with a warning about one chunk larger than 500 kB. The warning is expected: Babylon.js is 1.1 MB before compression.

### 4. Run it in Chrome

```powershell
npm run dev
```

Open http://localhost:5173 and press F12 to open DevTools.

- [ ] Blue sky, green ground, a dark road running into the distance.
- [ ] White edge lines, a dashed centre line and white posts on both sides.
- [ ] No flickering where the road meets the ground or where the lines meet the road.
- [ ] The far edge of the ground fades into haze instead of ending in a hard line.
- [ ] Top left shows `OPENROAD 0.1.0`, an FPS number and `Road level`.
- [ ] Dragging with the left mouse button orbits. The wheel zooms. The camera cannot go under the ground.
- [ ] `C` switches to `Three-quarter`, then `Overview`, then back to `Road level`.
- [ ] `R` returns to `Road level`.
- [ ] Resizing the window keeps the picture sharp and undistorted.
- [ ] The console shows no red errors.
- [ ] Edit a colour in `apps/web/src/game/scene/createPlayground.ts` and save. The page updates, and the FPS does not drop after several saves.

Write down the FPS and the GPU that Chrome used (`chrome://gpu`). It is the first performance baseline.

### 5. Decide

If every box is ticked, approve a pull request from this branch. If something fails, report which box and what the console says.

`main` is not changed until you approve.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| "OPENROAD could not start" mentioning WebGL | Hardware acceleration is off | Turn on "Use graphics acceleration when available" in Chrome settings and restart Chrome |
| Low FPS | Chrome is using the integrated GPU | In Windows Graphics settings, set Chrome to "High performance" |
| Port 5173 is in use | Another dev server is running | Stop it, or run `npm run dev -- --port 5174` |
| `npm error No workspaces found` | The command was run inside `apps/web` | Run it from the repository root |

## Next: Session 02 — Vehicle prototype

Starts only after the browser check passes.

- Install Rapier.js and add a fixed-timestep simulation loop.
- Collision for the ground.
- A placeholder vehicle body with raycast suspension, steering, engine and brakes.
- Chase camera.
- Speedometer.
