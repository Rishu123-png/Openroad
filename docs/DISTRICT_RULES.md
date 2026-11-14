# District rules: what is mapped, what is estimated, what is generated

This describes how the Alpha 1 district is built from the region layers
(`tools/build-district.mjs`) and turned into 3D (`apps/web/src/game/district/`).

Three kinds of content are kept apart in the data, in the code and on screen:

| Kind | Meaning | Where it is marked |
| --- | --- | --- |
| **Mapped** | Position and outline come from OpenStreetMap | every feature keeps its OSM id and tags |
| **Estimated** | A value OSM does not give, filled by a stated rule | `heightStatus`, `widthStatus`, `DISTRICT_ASSUMPTIONS` |
| **Generated** | Decoration that is not in the map at all | `generated: true`, `decorations.ts`, `generated*` counts |

Press **V** in the game to cycle the data views: building classification,
height source, and data source (mapped / estimated / generated).

Nothing here makes the district an exact replica. Footprints and road centre
lines are as accurate as the OSM mapping; heights, widths and the look of
every object are approximations.

## Build

```
node tools/build-layers.mjs        # region layers from the extract
node tools/build-district.mjs      # Alpha 1 -> apps/web/public/regions/greater-noida/alpha-1.json
npm run dev                        # the app loads that file
```

Options: `--buffer <metres>` (default 150), `--dir`, `--out`, and
`--synthetic` (invented test layout, written to `synthetic.json`, opened with
`?district=synthetic`; the game shows a warning banner). `?world=test` opens
the older fictional test district.

The district file is derived OSM data (ODbL) and is git-ignored.

## Selecting Alpha 1

- The sector is the area in the `areas` layer whose `name`, `name:en`,
  `alt_name`, `official_name` or `short_name` is "Alpha 1", "Alpha-1" or
  "Alpha I". A `landuse=residential` match is preferred; if several match, the
  largest is used and a warning is printed.
- No coordinates are written in the code. If no such area exists the script
  stops, lists the named residential areas that do exist, and writes nothing.
- The district is the bounding rectangle of that outline plus the buffer,
  limited to the region. Everything is clipped to it. Coordinates stay in
  local metres from the Pari Chowk origin.
- `inSector` on each building records whether its centre is inside the sector
  outline itself, so counts can be given for Alpha 1 proper and for the buffer.

## Building classification

`tools/district/classify.mjs`. Only the building's own tags are used. The
first matching rule wins and the rule is stored in `categoryRule`.

| Order | Category | Evidence |
| --- | --- | --- |
| 1 | healthcare | `building=hospital/clinic`; `amenity=hospital/clinic/doctors/dentist/nursing_home`; any `healthcare=*` |
| 2 | institutional | `building=school/university/college/kindergarten/public/government/civic/` religious values `/fire_station/train_station/transportation`; `amenity=school/college/university/kindergarten/library/research_institute/police/fire_station/townhall/courthouse/post_office/community_centre/place_of_worship/public_building/social_facility` |
| 3 | industrial | `building=industrial/warehouse/factory/manufacture`; `man_made=works` |
| 4 | commercial | `building=commercial/retail/office/supermarket/kiosk/shop/hotel/mall`; any `shop=*` or `office=*`; `tourism=hotel/guest_house`; `amenity=bank/restaurant/fast_food/cafe/food_court/bar/pub/fuel/marketplace/cinema/atm/pharmacy` |
| 5 | apartments | `building=apartments/dormitory`; `building=residential` with `building:levels` of 5 or more |
| 6 | house | `building=house/detached/semidetached_house/terrace/bungalow/villa/residential` |
| 7 | other | any other `building` value except `yes` (garage, shed, roof, ...) |
| 8 | unclassified | `building=yes` with none of the above |

`building=yes` is never promoted, whatever its size, height or surroundings.
`building=residential` is treated as a house unless its mapped levels say
otherwise; that is a judgement, recorded in the rule text.

## Building heights

| `heightStatus` | Rule | Standing |
| --- | --- | --- |
| `source-height` | the `height` tag | as mapped |
| `source-levels` | `building:levels` × 3.2 m | levels are mapped; the storey height is assumed |
| `estimated` | category default below, ±8% by a hash of the OSM id | **not a measurement** |

Defaults (`ESTIMATED_HEIGHTS`, changeable in one place or per build):
house 7 m, apartments 15 m, commercial 9 m, institutional 10 m, industrial
8 m, healthcare 10 m, other 4 m, unclassified 6.5 m; any footprint under
30 m² gets 3 m. The defaults are deliberately low: an estimated building
should not look like a confident tower.

## Building geometry

- Each mapped footprint is extruded straight up to a flat roof. Walls stand on
  the footprint edges; no point is moved, added or simplified.
- Relation footprints are used with their inner rings, so courtyards are open.
  Outer ways replaced by a relation are dropped by `build-layers`, and the
  district builder stops if a building id appears twice.
- Unclosed building ways never reach the layers; they are counted, not built.
- Roofs are flat. No facades, windows, signs, names or colours of real
  buildings are added. Wall colour varies slightly by category only.
- `building:part` features are not used yet.

## Roads

- Carriageways and paths follow the clipped OSM centre lines.
- Width: `width` tag (`source-width`), else mapped `lanes` × 3.5 m
  (`source-lanes`), else the class default from `build-layers` (`estimated`).
- Corners are mitred. Where two or more carriageway pieces share a point, a
  disc of the widest road's half-width closes the gap; these are the junctions.
  Points shared by 3 or more arms are counted as intersections.
- Footpaths beside a road are drawn only where the road is tagged
  `sidewalk=both/left/right/yes`, at an assumed 1.8 m.
- Not done: lane markings, medians, kerbs, turn geometry, signals logic.
  Bridges and tunnels are drawn at ground level. `proposed` and
  `construction` roads are skipped.

## Other mapped features

| Feature | Drawn as | Assumed |
| --- | --- | --- |
| parks, gardens, grass, woods | flat green area | none |
| water | flat blue area | none |
| walls, fences, hedges | thin wall on the mapped line | height when untagged (1.8 / 1.5 / 1.2 m) |
| gates, entrances | a post at the mapped point | look |
| rail and metro lines | a 3.2 m strip on the mapped line | deck at 9 m when tagged as a bridge |
| mapped trees, street lamps, signals | generic model at the mapped point | look and orientation |
| points of interest | kept in the file, not drawn | none |

A mapped wall is opened for 2.5 m at each mapped gate, and wherever a mapped
carriageway crosses it, so mapping gaps cannot seal a street.

## Generated decoration

All of it is in `decorations.ts` (`DECORATION_RULES`) and is magenta in the
data-source view.

- Roadside trees about every 28 m on alternate sides of primary to
  residential roads.
- Street lights every 48 m on trunk to tertiary roads, skipped within 25 m of
  a mapped lamp.
- One tree per 420 m² of mapped green area, up to 600.
- Piers every 30 m under elevated rail.

Each item is dropped if it would stand on a road or path, within 2.5 m of a
wall, inside a building, or outside the district. Placement is seeded, so it
is the same on every load.

## Player

- The vehicle is an arcade model (`VehicleModel.ts`): a kinematic bicycle on
  flat ground, about 64 km/h on roads and much slower off them. It is not a
  physics engine.
- Collision: two circles against building walls, mapped barriers and rail
  piers; the district edge is a hard limit.
- Spawn: the middle of a mapped street segment, preferring residential and
  tertiary streets inside the sector near its centre, at least 3 m from any
  building. The game re-checks it on load and refuses to start if it lies in
  a building or outside the district.
- Cameras (C): chase, street level, high, overview. The camera does not yet
  avoid buildings.

## Tests

Tool and app tests use invented fixtures only. They prove the rules and code
paths. They do not prove anything about the real Alpha 1 data; that is shown
by the output of `build-district.mjs` on the real layers.

## Visual upgrade (request 11): what is generated on top of the map

Nothing in this section changes mapped geometry. Footprints, road centre lines and widths come from the district file exactly as before; tests compare the dressed buildings with a plain extrusion.

**Verified so far on the synthetic fixture only.** The real `alpha-1.json` is git-ignored and was not available where this was developed. Screenshots named `docs/screenshots/r11-*.jpg` show the synthetic layout, and say so on screen.

### Vehicles

| Model | Size (L × W × H) | Source |
| --- | --- | --- |
| Compact SUV | 4.33 × 1.79 × 1.635 m | Generic, built in code (`vehicle/models`). Proportioned after the Hyundai Creta class. |
| Compact sedan | 3.995 × 1.735 × 1.515 m | Generic, built in code. Proportioned after the Maruti Suzuki Dzire class. |
| Hatchback | 3.86 × 1.735 × 1.52 m | Generic, traffic only. |
| Large SUV | 4.70 × 1.86 × 1.80 m | Generic, traffic only. |

No third-party or manufacturer meshes are used, and no badges are drawn. The garage states "Generic model … Not a manufacturer asset" for each player vehicle.

### Facades (`FACADE_STYLES`, `FACADE_RULES`)

The window pattern, floor lines, parapet, door and balconies are generated by category. They are not records of the real buildings. The parapet stands on or inside the mapped outline, never beyond it. Parapets, doors and balconies show magenta in the Data source view; unusable heights (missing, zero, negative, not a number, above 400 m) are replaced by 3.2 m and counted.

- `unclassified` (`building=yes`): plain wall with plain windows (`generic`). Never styled as a house or a shop.
- `house`, `apartments`: residential pattern; apartments get balconies on walls of 9 m or more.
- `commercial`: glazed bands, and a shopfront at ground level only for this category.
- Footprints under 30 m² or lower than 3.6 m stay plain.
- Estimated heights are still marked in the "Height source" view.

### Road markings (`MARKING_RULES`)

Marking positions are **not mapped**. They are drawn by rule and coloured as generated in the "Data source" view.

- Centre and lane lines only on trunk, primary, secondary and tertiary roads at least 5.5 m wide. Lane count comes from the `lanes` tag when present, otherwise from the width. A mapped count is reduced until every lane is at least 2.5 m wide, and a two-way road is drawn with an even count split about its centre line.
- Stop lines and crossings at junctions of those classes.
- Speed breakers only where `traffic_calming` is mapped.
- Parked cars (limit 40) stand off the carriageway; kerb grates are decorative.

### Traffic (`TRAFFIC`)

12 vehicles by default (6 on low, 18 on high, `?traffic=N` to override, hard limit 40). They follow mapped road centre lines on the left, obey `oneway`, slow at junctions and behind other vehicles, and never spawn in a building or within 45 m of the player.

#### Traffic and buildings (`ROAD_SAFETY`, `traffic/roadSafety.ts`)

Mapped roads and mapped buildings sometimes conflict: a gatehouse or canopy drawn across a road, a lane whose estimated width reaches into the houses beside it, a wall at the inside of a bend. The map is never changed to hide this. Traffic is kept out of the buildings instead:

- Before driving, every road segment is checked every 0.5 m along its centre line and 1.18 m either side (half the widest traffic vehicle, 0.93 m, plus 0.25 m).
  - Centre line inside a footprint: the segment is **excluded from traffic routing** (`centre-line-inside-building`).
  - A building within 1.18 m of the centre line: excluded (`building-within-vehicle-width-of-centre-line`).
  - Otherwise the lane position (normally a quarter of the road width left of the centre line) is tried at 100, 75, 50, 25 and 0 % until its own 1.18 m either side is clear. A reduced lane is recorded as narrowed.
- Excluded segments are still drawn and still drivable by the player. Traffic turns off or turns round before them. A road with no usable segment carries no traffic.
- While driving, a vehicle's whole body (its own length and width, at its heading) is tested before every move. If the eased path through a turn would overlap a building, the vehicle is held closer to its checked lane line, then on it.
- Last resort: if no position is clear, the vehicle is removed where it stands and re-enters elsewhere. The turn it had just made is not offered again, or, if it was well along the segment, that segment is excluded (`vehicle-had-no-safe-position`).
- Everything is recorded on `game.traffic.safety` (`excluded`, `narrowed`) and `game.traffic.removals`, with road id, segment, coordinates, reason and building id. `npm run test:real` prints it.


### Controls added

G garage, Enter confirm, L headlights. C now cycles Chase, Bonnet, High and Overview. The chase camera moves in rather than pass through a building.

## Traffic and the district boundary

The boundary is `bounds` in the district file. Traffic never changes it; the
rendered map and the player are unaffected.

- **Margin.** A traffic vehicle's centre stays `boundaryInset()` inside the
  boundary: half the diagonal of the largest traffic vehicle (4.70 × 1.86 m)
  plus `ROAD_SAFETY.margin`, about 2.78 m. At that distance no corner of the
  body can cross the boundary at any heading.
- **Lanes are cut, not roads.** For each segment and direction, the part of
  the lane line inside the margin is recorded (`safety.limits`, listed in
  `safety.trimmed`). A segment with no lane part of at least
  `ROAD_SAFETY.minInsideLength` (6 m, or its own length if shorter) inside is
  excluded from traffic with the reason `lane-outside-district-boundary`.
- **At the cut.** A vehicle slows, stops at the limit and turns back into the
  opposite lane of the same segment, waiting for room there. On a one-way
  road, or where the opposite lane is also outside, it is removed at the limit
  and placed again elsewhere.
- **Entering.** A segment whose lane starts inside the margin zone is not
  entered from that end.
- **Placement.** Spawn and respawn pick a point within the recorded limits and
  then pass the same whole-body check as movement.
- **Backstop.** Every move tests the centre and four corners against the
  boundary (`footprintOutside`) together with the building test. A move that
  would cross is pulled to the lane line; failing that the vehicle is removed
  in place and the turn or segment is no longer used (`safety.removals`,
  `buildingId: "district-boundary"`).

Limitation: the boundary used is the rectangle `bounds`, which is what the
tests measure against. It is not the sector outline polygon.

## Traffic at junctions and between vehicles

Code: `apps/web/src/game/traffic/junctions.ts` (finding junctions and narrow
stretches, the body overlap test) and `TrafficModel.ts` (everything that moves
a vehicle). Settings are in `TRAFFIC`.

### What a junction is

A point where **three or more** road segments that traffic can drive meet.
A point in the middle of one road (a bend), two roads joined end to end, and
a dead end are not junctions. Segments excluded from traffic and repeated
points do not count. Each junction has an id `junction@x,z`, its arms sorted
by compass bearing, and a circular **conflict area**: the widest arm's half
width plus 1.5 m, between 4.5 m and 10 m.

Each vehicle decides what it will do at the next junction when the junction
first comes into view (straight on 60 % of the time where it can, otherwise
a turn chosen at random), and keeps that plan. The plan gives the arm it
enters by, the arm it leaves by, and so the movement: straight, left, right,
U-turn.

### Priority policy

1. **A reservation is needed to enter the conflict area.** A vehicle without
   one stops with its front 0.5 m short of the area.
2. **Arrival.** A vehicle has arrived when it is within 6 m of its stopping
   place. From then it asks to enter on every frame.
3. **It is refused** while any of these holds, in this order:
   - `junction-occupied`: a vehicle on a conflicting movement holds a reservation;
   - `another-vehicle-has-priority`: a waiting vehicle on a conflicting movement arrived earlier.
     Vehicles that arrive in the same frame go in the order of their approach arm
     (by bearing, west first, then north, east, south), then by vehicle number;
   - `vehicle-ahead` / `player-ahead`: it is not the first in its queue;
   - `exit-not-clear`: there is not room beyond the junction for all of it
     (its length and 3 m), so it would stop across the junction;
   - `narrow-road-occupied`: its exit is a road too narrow to pass on and something is coming along it.
4. **Conflicts.** Two movements may hold the junction together only when
   they enter by the same arm (one follows the other), or when they are the
   two directions of one straight route and both roads are wide enough to
   pass on. Everything else conflicts, including turns that only merge.
5. **Release.** The reservation is given up when the vehicle's body has
   left the conflict area on the far side.
6. A vehicle whose own exit is blocked does not hold up vehicles that
   arrived after it.

There are no signals, signs or major and minor roads in this policy: it is
first come, first served, like an unmarked junction.

### Slowing and following

- A vehicle slows for a junction ahead as if braking at 2.5 m/s² down to
  4 m/s at the stopping place, and crosses at 4 m/s.
- It looks along **its own lane path** (through bends and through its
  planned turn), not straight ahead, for other vehicles and the player. Its
  speed is 0.4 /s times the room left beyond a 2.5 m bumper gap, which never
  asks for more than the 6 m/s² braking limit.
- Sizes and headings are real: how far another body reaches across and
  along the path is worked out from its length, width and heading.

### Bodies never overlap

Before a vehicle is moved, the rectangle of its body at the new position
(real length, width and heading, 0.15 m wider on every side) is tested
against every other vehicle's and the player's. If it would overlap, the
vehicle is not moved: it goes back to where it was on the road, stopped.
Vehicles are updated one at a time, so no pair can end a frame overlapping.
This is the guarantee; the reservations and the following rule exist so
that it is rarely needed (`junctionStats.blockedMoves` counts when it is).

### Roads too narrow to pass on

Where the two lanes of a two-way road are closer together than a vehicle is
wide plus 0.3 m (a narrow road, or lanes moved toward the centre line to
clear a building), two vehicles cannot pass. Such segments are grouped into
**narrow stretches** (`traffic.narrowRuns`), ended by junctions. A vehicle
waits before the stretch, where the road is still wide, until nothing in it
is coming the other way, and not ahead of a vehicle that has waited longer
at the other end. A stretch ending in a dead end or at the district's edge
takes one vehicle at a time.

### Waiting too long: recovery, in order

| After | What the vehicle does |
|---|---|
| 2.5 s nose to nose with another vehicle (plus 0.25 s per vehicle number modulo 8, so one of a pair goes first) | turns round where it stands, if the opposite lane is clear; it will not turn round again for 12 s |
| 15 s stopped at a junction | chooses a different exit, keeping its place in the order |
| 30 s stopped behind a vehicle or the player (45 s waiting for a narrow road) | turns round |
| 60 s without moving, and more than 30 m from the player | taken out and placed again elsewhere (`junctionStats.stuckReplacements`). The last resort, and never used to hide a collision: a vehicle that cannot move safely does not move |

### Diagnostics

Nothing is printed in the browser. With `?inspect`, `window.openroad` gives
the game; on `traffic`:

- `junctions`, `narrowRuns`: what was found.
- `junctionStatus()`: for each junction in use, who holds it (vehicle,
  approach, movement) and who waits (vehicle, approach, movement, seconds
  waited, reason, which vehicle it waits for).
- `events`: the newest 200 yields, entries, forced entries, changes of
  exit, U-turns, refused moves and replacements, each with time, vehicle,
  junction id, approach, movement, reason, the other vehicle and the wait.
- `junctionStats`: totals, and the longest wait.
- on each vehicle: `yield` (why it is holding back now) and `blockedBy`.

### Limitations

- Two junctions closer together than a vehicle can stop between are not
  treated as one. A vehicle that finds itself inside the second is let
  through (`forcedEntries`) under the body check alone.
- Turning vehicles always wait for the whole junction, even where a left
  turn would not cross anything. Throughput is lower than a real junction's.
- A refused move stops the vehicle at once, which is not how a car brakes.
- Turning round is done on the spot, in the vehicle's own length.
- The player is not controlled: the player can drive into traffic. Traffic
  will not drive into the player.
- No signals, signs, roundabout rules or lane choice.
