# Geodata pipeline

Turns an OpenStreetMap extract into game-ready layers in local metres. It
does not build any 3D geometry. Data © OpenStreetMap contributors, ODbL 1.0;
the layers are a derivative database and stay under ODbL.

Status: every result quoted in this file comes from **synthetic fixtures**
(`npm run test:tools`). The agent has not run the pipeline on the real
extract, which exists only in the project owner's environment.

## Commands

```
node tools/fetch-osm.mjs --profile v2          download (already done)
node tools/inspect-osm.mjs --file data/osm/greater-noida-corridor-v2.json --validate
node tools/build-layers.mjs                    -> data/region/greater-noida/*.json
node tools/render-coverage.mjs                 -> data/region/greater-noida/coverage.html
npm run test:tools
```

`data/osm/*.json`, reports and `data/region/` are in `.gitignore`.

## Steps

1. **Validate** (`tools/geo/validate.mjs`). Reports malformed coordinates
   (missing, not a number, out of range) separately from valid coordinates
   that are simply far away. Nothing in the extract is changed. Malformed
   elements are skipped and listed in the manifest.
2. **Project** (`tools/geo/projection.mjs`). Local tangent plane at the Pari
   Chowk roundabout (28.46526 N, 77.51130 E) using WGS84 radii of curvature;
   +x east, +z north, metres, rounded to the centimetre. Same formula as
   `apps/web/src/game/geo/projection.ts`. Latitude and longitude never reach
   the game.
3. **Assemble relations** (`tools/geo/rings.mjs`). Member ways are joined end
   to end into rings; inner rings become holes of the outer ring that contains
   them. Full way geometry from the extract is preferred over the cut copy
   stored inside the relation. A member with no geometry, or a chain that
   does not close, makes the relation `incomplete`: the reasons and missing
   way ids are recorded and the unclosed chains are kept as lines only.
   Nothing is added to close a gap.
4. **Clip** (`tools/geo/clip.mjs`) to the region rectangle (the extract bbox,
   or `bbox` passed to `convert`). Lines are cut with Liang-Barsky; a road
   that leaves and re-enters becomes ordered pieces, each recording whether it
   continues beyond the region at its start or end. Polygons and holes are cut
   with Sutherland-Hodgman. Features entirely outside are counted and dropped.
   A final check throws if any coordinate in any layer is outside the region.
5. **Write layers** and `manifest.json`.

## Layers

| File | Content |
| --- | --- |
| `roads.json` | Every `highway` way as line pieces. `kind` is `road`, `path` or `not-built` (construction, proposed). |
| `buildings.json` | Footprints from closed building ways and from multipolygon relations (outer rings with courtyards). |
| `buildingParts.json` | `building:part` outlines. |
| `areas.json` | Land use, leisure, natural, amenity and boundary polygons, from ways and relations. |
| `barriers.json` | Walls and fences as lines; gates, bollards and entrances as points. |
| `pois.json` | Points of interest from nodes, plus the centre of any outline tagged shop, office, craft, tourism, healthcare or amenity. `commercial` marks shops and similar. |
| `rail.json` | Railway and metro lines, stations and platforms. |
| `furniture.json` | Street lamps, signals, crossings, bus stops, trees, poles and similar nodes. |
| `coverage.json` | 250 m cells: `footprints`, `streets-without-footprints`, `sparse` or `nothing-mapped`. |

A node goes to exactly one layer, in this order: barriers, rail, furniture,
points of interest.

### Feature fields

| Field | Meaning |
| --- | --- |
| `id`, `osm` | `way/123`, `node/123` or `relation/123`, and the OSM type and id |
| `tags` | All OSM tags, unchanged |
| `source` | Values read directly from tags (lanes, levels, height, name ...). `null` means the tag is absent |
| `derived` | Measured from the source geometry after clipping (length, area, centre) |
| `estimated` | Filled in by a rule, each with its `basis`. Not source data |
| `clipped` | Geometry was cut at the region boundary |
| `incomplete`, `incompleteReasons`, `missingMembers` | Relation outline could not be fully assembled |
| `tagsFrom` | For old-style multipolygons, the outer way the tags were taken from |
| `geometry` | `point`, `line` (`points`), `polygons` (`outer` + `holes`) or `open-outline` (`lines`) |

Estimates currently produced: road width (from the lanes tag, else a class
default), default lane count, one-way for roundabouts and motorways, and
building height from `building:levels` x 3.2 m. A building with neither
height nor levels gets `estimated.height.value = null`; the generator must
choose a height and label it as an estimate.

### Duplicates

A building relation and its outer member way describe the same building. The
relation is exported and the way is not; the pairs are listed under
`issues.waysReplacedByRelation` in the manifest.

## The "INVALID coordinates outside 28-29 N, 77-78 E: 0 -> 1" result

The first validator counted any way with a vertex outside a fixed window as
invalid. Overpass returns the whole geometry of every way that touches the
bbox, and the v2 query added long linear features (power lines, waterways,
boundary member ways), so a single long way with one distant vertex is enough
to raise that count. That is a legitimate feature and a validator fault, not
malformed data, **if** the element turns out to be such a way. The agent could
not confirm which element it is without the dataset. This command prints the
exact type, id, coordinate and an openstreetmap.org link:

```
node tools/inspect-osm.mjs --file data/osm/greater-noida-corridor-v2.json --validate
```

The metric is now split into "INVALID malformed coordinates" and a
non-failing count of elements outside the old window. Regression tests cover
both a long valid way and truly malformed values.

## Coverage view

`coverage.html` is a self-contained page: tick layers on and off, scroll to
zoom, drag to pan, hover for the OSM id. It draws roads, footprints from
ways, footprints from relations (incomplete ones outlined in red), sector
boundaries, gates, points of interest and missing-coverage cells. Missing
cells are only tinted; no buildings are drawn where none are mapped.

## Known limitations

- The polygon clipper joins the lobes of a concave polygon along the boundary
  edge when the boundary cuts it into several parts. Area and containment
  stay correct; the outline has a zero-width bridge on the edge.
- A hole cut by the boundary stays a hole touching the edge.
- Sector labels in the coverage view match names by pattern (Alpha, Beta,
  Gamma ...); other named residential areas are drawn but not labelled.
- Route relations are not downloaded. `site` relations are skipped.
- The coverage page has been generated from a fixture and checked as text; it
  has not yet been opened in a browser by the agent.
- Road widths and lane defaults are rules of thumb, not measurements.
