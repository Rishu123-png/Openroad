# Region packages (design)

Status: **design only**. Nothing in this document is implemented except the
projection module and the OSM fetch and inspection tools. The current app
still builds its fictional test district in code.

## Goal

Each city or region is a separately downloadable world package. A player
downloads Greater Noida once, the browser keeps it, and later visits start
from local storage. Other regions (Noida, Delhi, Gurugram) are separate
packages that nobody has to download to play Greater Noida.

## Principle: ship map data, build meshes on the device

A package contains compact world *data* (road lines, footprints, land use,
prop positions) and not baked 3D meshes. The existing generator
(`GeometryBuffer`, `WorldBatcher`, procedural materials) turns a tile's data
into meshes when the tile comes into range. This keeps downloads small (a
tile is expected to be tens of kilobytes compressed; to be measured), lets a
visual improvement reach players without re-downloading the map, and keeps
one code path for every region. Baked assets for landmark buildings can be
added later as extra files in the same package.

## Pipeline

```
OSM extract (data/osm/*.json, ODbL)
  -> tools/build-region (planned): project to metres, clip to tiles, classify
     land use, attach source ids and confidence class, build the road graph
  -> regions/<id>/<version>/ : manifest.json + tiles + navigation
  -> static hosting or CDN
  -> browser: download, verify, store in IndexedDB, stream tiles while driving
```

## Files

```
regions/index.json                     list of available regions
regions/greater-noida/1/manifest.json  one manifest per region version
regions/greater-noida/1/tiles/<x>_<z>.json
regions/greater-noida/1/nav/roads.json
regions/greater-noida/1/preview.jpg
```

`regions/index.json` (drives the future region selection screen):

```json
{ "regions": [ { "id": "greater-noida", "name": "Greater Noida",
    "latestVersion": 1, "downloadBytes": 0, "manifest": "greater-noida/1/manifest.json",
    "preview": "greater-noida/1/preview.jpg" } ] }
```

`manifest.json`:

```json
{
  "formatVersion": 1,
  "id": "greater-noida",
  "name": "Greater Noida",
  "version": 1,
  "builtAt": "2026-11-13T00:00:00Z",
  "origin": { "lat": 28.46526, "lon": 77.5113 },
  "projection": "local-tangent-wgs84",
  "bounds": { "minX": 0, "minZ": 0, "maxX": 0, "maxZ": 0 },
  "tileSize": 220,
  "attribution": [ { "source": "OpenStreetMap", "licence": "ODbL-1.0",
      "text": "© OpenStreetMap contributors", "osmBase": "..." } ],
  "files": [ { "path": "tiles/0_0.json", "bytes": 0, "sha256": "...", "kind": "tile" } ],
  "totalBytes": 0
}
```

A tile holds the features whose geometry falls in it, already in local metres
relative to the region origin:

- `roads`: centre line, class, lanes, one-way flag, width, name, source id.
- `areas`: land-use and park polygons with their type and name.
- `buildings`: footprint, height, land-use class, source id.
- `props`: positions of signals, bus stops, gates, trees.
- every feature: `conf` = `verified`, `approximate` or `decorative`
  (see `GEODATA_SOURCES.md`).

`nav/roads.json` is the road graph for the whole region (nodes at junctions,
edges with length, class, lanes and direction). It is small, loaded whole,
and is what road navigation, future AI traffic and the minimap will use. The
server can load the same file later for multiplayer.

## Download, integrity and storage

- **Storage**: IndexedDB with two stores. `blobs` is keyed by SHA-256 and
  holds file contents. `installed` holds the manifest of each installed region.
- **Integrity**: each file is hashed with `crypto.subtle.digest("SHA-256")`
  after download and rejected on mismatch. A region counts as installed only
  when every file in its manifest is present.
- **Progress and size**: the manifest lists bytes per file, so size is known
  before download and progress is bytes stored over `totalBytes`.
- **Resume**: files already in `blobs` are skipped, so an interrupted
  download continues where it stopped.
- **Updates**: a new version has a new manifest. Only files whose hash is not
  already stored are downloaded, so an edit to one sector re-downloads only
  the affected tiles.
- **Reuse**: because blobs are keyed by content, identical files shared by
  versions or regions are stored once.
- **Removal**: deleting a region removes its manifest and then any blob no
  other installed manifest refers to.
- **Quota**: `navigator.storage.estimate()` before download and
  `navigator.storage.persist()` to ask the browser not to evict the data.
- **Offline**: installed regions load with no network. The app shell needs a
  service worker for a fully offline start (later). Multiplayer always needs
  a connection.

## Runtime streaming

- Tiles within a load radius of the camera are built; tiles beyond an unload
  radius are disposed. Only nearby tiles are in memory.
- Tile building is spread over frames, or moved to a worker, so that driving
  does not stall.
- Each tile keeps the current per-material batching, instancing and tree LOD.
  Distant tiles use a cheaper build (roads and building massing only).
- Collision uses simple shapes derived from the same data: road surface,
  footprint prisms, walls. Physics is not part of this stage.

## Planned modules

| Module | Responsibility |
| --- | --- |
| `tools/build-region.mjs` | OSM extract to package files |
| `src/game/geo/` | Projection (exists), tile addressing |
| `src/game/region/RegionStore` | IndexedDB, hashing, install, update, remove |
| `src/game/region/RegionLoader` | Fetch with progress; read from store |
| `src/game/world/TileStreamer` | Load and unload tiles around the camera |
| `src/game/world/*` generators | Take tile data instead of the fixed `LAYOUT` |
| `src/ui/` region screen | Later: list, size, progress, installed, update, remove |

## Order of work

1. Inspect the real extract and settle the tile contents.
2. `build-region` and the tile format, with tests on a small fixture.
3. Data-driven generators and the first district loaded from package files
   served by the dev server.
4. `RegionStore` with integrity checks and tests.
5. Tile streaming.
6. Region selection screen.
