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

The window pattern, floor lines, parapet, door and balconies are generated by category. They are not records of the real buildings.

- `unclassified` (`building=yes`): plain wall with plain windows (`generic`). Never styled as a house or a shop.
- `house`, `apartments`: residential pattern; apartments get balconies on walls of 9 m or more.
- `commercial`: glazed bands, and a shopfront at ground level only for this category.
- Footprints under 30 m² or lower than 3.6 m stay plain.
- Estimated heights are still marked in the "Height source" view.

### Road markings (`MARKING_RULES`)

Marking positions are **not mapped**. They are drawn by rule and coloured as generated in the "Data source" view.

- Centre and lane lines only on trunk, primary, secondary and tertiary roads at least 5.5 m wide. Lane count comes from the `lanes` tag when present, otherwise from the width.
- Stop lines and crossings at junctions of those classes.
- Speed breakers only where `traffic_calming` is mapped.
- Parked cars (limit 40) stand off the carriageway; kerb grates are decorative.

### Traffic (`TRAFFIC`)

12 vehicles by default (6 on low, 18 on high, `?traffic=N` to override, hard limit 40). They follow mapped road centre lines on the left, obey `oneway`, slow at junctions and behind other vehicles, and never spawn in a building or within 45 m of the player.

### Controls added

G garage, Enter confirm, L headlights. C now cycles Chase, Bonnet, High and Overview. The chase camera moves in rather than pass through a building.
