# OPENROAD

A browser-based, multiplayer, open-world driving and social game. The first world is Greater Noida, India.

**Current milestone:** OPENROAD 0.1 — Foundation and 3D scene. The application renders a test environment (ground, a straight two-lane road, daylight, an orbit camera). There is no vehicle, physics, multiplayer or backend yet.

## Requirements

- Node.js 22 or newer (npm 10 or newer ships with it)
- A desktop browser with WebGL 2: Chrome or Edge recommended

## Setup

```sh
git clone https://github.com/Rishu123-png/Openroad.git
cd Openroad
npm install
```

## Commands

Run all commands from the repository root.

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the development server at http://localhost:5173 with live reload |
| `npm run typecheck` | Checks TypeScript types without building |
| `npm test` | Runs the unit tests once |
| `npm run build` | Type-checks, then builds the production bundle into `apps/web/dist` |
| `npm run preview` | Serves the production bundle at http://localhost:4173 |

## Controls

| Input | Action |
| --- | --- |
| Left mouse drag | Orbit the camera |
| Mouse wheel | Zoom |
| C | Change camera view |
| R | Reset camera view |

W/A/S/D, the arrow keys and Space are already bound to driving actions, but nothing uses them until the vehicle exists.

## Repository layout

```
apps/web/               the browser game (Vite + TypeScript + Babylon.js)
  index.html
  src/
    main.ts             composition root: creates and connects everything
    game/engine/        engine creation and the Game lifecycle
    game/scene/         the test environment
    game/camera/        camera rig
    game/lighting/      lights, sky colour, fog
    input/              device-independent input actions
    ui/                 DOM overlay and styles
  tests/
docs/                   project documents
```

## Documents

- [Technical architecture](docs/TECHNICAL_ARCHITECTURE.md)
- [Project management decisions](docs/PROJECT_MANAGEMENT.md)
- [Session 01 — Foundation and 3D scene](docs/sessions/SESSION_01.md)
