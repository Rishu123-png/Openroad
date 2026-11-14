# Testing

| Command | What it runs | Needs |
| --- | --- | --- |
| `npm run typecheck` | TypeScript over the app and its tests | nothing |
| `npm run test:unit` (or `npm test`) | App tests: vitest, headless Babylon `NullEngine` | nothing |
| `npm run test:tools` | Geodata tool tests: `node --test` | nothing |
| `npm run build` | Typecheck and production build | nothing |
| `npm run check` | The four above, in order | nothing |
| `npm run test:real` | Real Alpha 1 district checks | `apps/web/public/regions/greater-noida/alpha-1.json` |
| `npm run test:smoke` | Builds, serves and drives the game in headless Chrome | a Chrome or Chromium (`CHROME_PATH`) |

## Synthetic and real data

Every test in `npm run test:unit` uses invented data: hand-written fixtures in
`apps/web/tests/fixtures/` and the file `tools/build-district.mjs --synthetic`
writes. A pass says the code is right. It says nothing about the map.

`npm run test:real` reads the district file built on your machine from the
OpenStreetMap extract. That file is git-ignored. Where it is missing, every
real-data test is **skipped**, the run prints `REAL ALPHA 1 TESTS: SKIPPED`
with the reason, and exits 0, so CI and fresh clones are not broken. Nothing
is substituted: a synthetic file placed at the real path fails the identity
test. Use `OPENROAD_DISTRICT=/path/to/alpha-1.json` for another location.

The real suite checks: name, region and source record; that the sector is the
mapped Alpha 1 object; finite numbers throughout; closed outlines; courtyards
inside their buildings; no duplicate building ids; no relation also built as
a way; roads and junctions consistent; nothing outside the region; the spawn
point on a carriageway and outside buildings; and a minute of maximum traffic
on the real roads. The checks themselves (`tests/support/districtChecks.ts`,
`districtFile.ts`) are tested in the ordinary suite on sound data and on data
broken on purpose (`tests/districtChecks.test.ts`).

The traffic part checks every vehicle on every frame for a minute: centre and
whole body against every building footprint. On failure it prints, for each
offending sample, the vehicle, time, position, heading, size, building id,
category and bounds, distance to the wall, road id and segment, and the cause
(A centre line in the building, B lane position, C turning path, D body only),
with the number of different vehicles involved. It always prints the roads
excluded from traffic and why.

## Browser smoke test

`tools/smoke/browser-smoke.mjs` uses real key presses and the game's own
render loop on the synthetic district: startup, first-visit garage, selection
by key and by button, spawn, saved choice, camera cycle, driving, steering,
stopping, reset, overlay statistics from a real renderer, reload, default
traffic, and no uncaught errors or failed requests. With no browser it prints
`BROWSER SMOKE TEST: SKIPPED` and exits 0 (`--require` makes that a failure).
If the real district has been built it also starts the game on it.

It saves `garage-suv`, `garage-sedan`, `chase`, `bonnet` and `street`
screenshots (and `alpha1-street` on real data) to `test-results/smoke/` at
1280x720 with traffic off. These are for a person to look at. They are not
compared with stored images: there is no visual regression suite, because
software rendering differs between machines and the project has no pinned
browser to make a pixel comparison trustworthy.

No test asserts a frame rate.

## Known gaps

- Traffic has no right-of-way at junctions: cars on crossing roads can pass
  through each other. The tests check spacing on the open road only.
- Draw calls and triangle counts are zero under `NullEngine`; only the smoke
  test sees real values, and it only checks they are above zero.
- Mouse and touch camera control, the night/headlight appearance and SSAO are
  not tested.

### District boundary check

`trafficReport` tests every vehicle on every frame against `bounds`: the
centre and the four corners of the body. Each sample outside is reported in
the `REAL DATA` lines with the vehicle number, time and frame, centre,
heading, size, the part that is outside and by how much, the road id, segment
and direction, what follows the segment, whether the centre or only the body
is outside, and a cause label (A road reaches the boundary, B body only,
C off the lane line in a turn, D just placed). Samples and distinct vehicles
are counted separately. The real suite requires no vehicle outside, no
vehicle in a building, and every vehicle to drive more than 10 m.

Synthetic regression tests are in `apps/web/tests/trafficBoundary.test.ts`
with the fixture `tests/fixtures/edgeDistrict.ts`.

### Junctions and vehicle collisions

`apps/web/tests/trafficJunctions.test.ts` (synthetic, scripted with
`traffic.place()` and `traffic.route()`, fixtures in
`tests/fixtures/junctionDistrict.ts`) covers: finding junctions; two
vehicles on conflicting approaches, for every pair of approaches and turns;
exact and near ties; yielding and proceeding; turns across traffic; eight
vehicles from four sides; following; exits; a junction that stays blocked;
narrow roads; and whole districts with 40 vehicles where every pair of
bodies is tested on every frame.

`trafficReport` (used by the real-data suite) now tests every pair of
vehicle bodies on every frame with `vehicleCollisions()`: full rectangles,
real sizes and headings, no margin. Each overlap is printed in the
`REAL DATA` lines with both vehicles' positions, headings, speeds, roads,
junction state and yield reason, and the nearest junction. It also prints
junction totals and every recovery. The real suite requires no collision
and no safety removal.

`experience.test.ts` "does not run cars into each other" checks every pair
everywhere again, junctions included, by centre distance and by body.

## Reconstruction and provenance (M004)

`apps/web/tests/realism.test.ts` (synthetic fixtures, `tests/fixtures/realismDistrict.ts`):

| Protected | Test |
|---|---|
| Stable appearance from the building id | "gives the same building the same look every time", "builds each mapped building once ... the same on every load" |
| Footprint preservation | "keeps the footprint: every wall and band stands on a mapped edge and roof objects stay inside" |
| Courtyard preservation | "keeps courtyards open" |
| No duplicate building geometry | "builds each mapped building once" (roof area equals footprint area) |
| Height provenance | "separates source, inferred and estimated heights" |
| Road width provenance | "separates mapped, lane-derived and estimated road widths", "records every road's class, access, width basis ..." |
| Gate placement | "stands a gate only at a mapped gate point", "plans gates from the mapped points alone" |
| No fabricated compounds | "invents no compound" |
| Marking width rules | "paints by width and by what is mapped" |
| Decoration off the roads | "keeps everything it adds off the roads", "plans verges only where the ground beside the road is free" |
| Named features | "labels only what the map names, where the map puts it" |
| Private access | "keeps private and permissive access exactly as mapped" |
| Unknown buildings stay generic | "marks a building of unknown use as a generic reconstruction" |

Tool tests (`tools/district.test.mjs`) cover category inference, the generic height bands and
the recorded category status.

`apps/web/tests/real/alpha1Realism.real.test.ts` runs the same invariants on the real file
(`npm run test:real`) with every expectation derived from that file, and prints the measured
counts: provenance totals, gates, labels, meshes, materials and world build time. It is
skipped where the file is absent.

`npm run audit:district` prints what the district file contains (read only).

## Visual quality upgrade V1: vehicles

`apps/web/tests/garageVehicles.test.ts` (13 tests) covers the six-vehicle garage:

- six vehicles with distinct names, categories and side outlines, and no maker or model name in anything the player is shown;
- every model builds complete (glass all round, lamps at both ends, mirrors, wheels inside the arches) and refers to no model file;
- keyboard cycling reaches all six in both directions, and the mesh in the world is the model the garage names;
- colour selection with W / S only while the garage is open, kept across vehicles and reloads;
- per-vehicle collision length, width, height and wheelbase, taken from the stated size and not from the mesh;
- every vehicle stops with its nose, tail and side at a wall, stays out of buildings and inside the district when driven hard;
- traffic uses the six models within the clearances the existing safety tests were written for;
- wheel rotation, front-only steering and the sprung body (dive, squat, roll) with the wheels left on the road.

Three older tests were changed because they stated that the garage has two vehicles; their other assertions are unchanged:
`experience.test.ts` (garage total), `garage.test.ts` (order of vehicles when cycling; `hatchback` is now a drivable model, so it left the list of unusable saved names and `minibus` and a near-miss spelling joined it).
No safety assertion was changed.

These tests run on generated geometry and the small test district. They say nothing about how the vehicles look; that needs a person and a GPU.
