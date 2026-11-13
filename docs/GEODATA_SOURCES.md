# Geographic data: sources, licences and confidence

Status: **preliminary**. The bulk OpenStreetMap extract has not been downloaded
yet, so everything below comes from individual lookups. The coverage section
must be redone with `node tools/inspect-osm.mjs` once
`data/osm/greater-noida-corridor.json` exists.

## Sources

| Source | Used for | Licence | Decision |
| --- | --- | --- | --- |
| OpenStreetMap (Overpass API, Nominatim) | Roads, sector outlines, building footprints, parks, railway, points of interest | ODbL 1.0, © OpenStreetMap contributors | **Use.** Primary source. |
| GNIDA OneMap (`onemapup.nic.in/gnida`) | Possible cross-check of sector and plot layout | Page footer reads "© 2021 Greater Noida Industrial Development Authority", built by NIC. No open-data licence or download terms were found. | **Do not copy.** May be viewed by a person to cross-check; no data is imported from it unless GNIDA gives written permission or publishes a licence. |
| Photos supplied by the project owner | Visual reference for architecture and street character | Not ours to redistribute | **Reference only.** Never committed to the repository. |

### What ODbL requires of OPENROAD

- Show "© OpenStreetMap contributors" where players can see it (in-game credits
  or overlay) and in the README. Not done in the app yet.
- The OSM extract and any region package built from it are a derivative
  database: they stay under ODbL and must be offered on request. Keeping the
  query in `tools/fetch-osm.mjs` covers the "means to recreate it".
- The rendered 3D world is a produced work and can carry the game's own licence.

## Projection

`apps/web/src/game/geo/projection.ts`: local tangent plane at the region origin
using WGS84 radii of curvature. +X east, +Z north, metres. Origin for Greater
Noida is the centre of the Pari Chowk roundabout, 28.46526 N, 77.51130 E.
At this latitude one degree is about 110.83 km north-south and 97.92 km
east-west. Error over the district is well under a metre.

## Coverage check of the requested boundary

Requested extract: south 28.445, west 77.485, north 28.500, east 77.540
(about 5.4 km east-west by 6.1 km north-south). The north edge was moved from
28.495 to 28.500 because Gamma 2 reached to within 80 m of the old edge.

Bounding boxes below are from Nominatim lookups on 2026-11-13.

| Place | OSM object | Latitude range | Longitude range | Inside boundary |
| --- | --- | --- | --- | --- |
| Pari Chowk roundabout | ways 63223327, 753900885 (secondary, roundabout) | 28.4649 to 28.4656 | 77.5109 to 77.5117 | Yes |
| Pari Chowk metro station | way 696191675 | 28.4627 to 28.4636 | 77.5075 to 77.5087 | Yes |
| Alpha 1 | way 86832059 (landuse residential) | 28.4695 to 28.4786 | 77.5043 to 77.5156 | Yes |
| Alpha 2 | way 86831848 (landuse residential) | 28.4742 to 28.4830 | 77.5125 to 77.5232 | Yes |
| Beta 1 | way 86833501 (landuse residential) | 28.4749 to 28.4858 | 77.5008 to 77.5116 | Yes |
| Beta 2 | way 86833506 (landuse residential) | 28.4794 to 28.4904 | 77.5072 to 77.5197 | Yes |
| Gamma 1 | way 86834784 (landuse residential) | 28.4789 to 28.4911 | 77.4948 to 77.5063 | Yes |
| Gamma 2 | way 86834787 (landuse residential) | 28.4865 to 28.4943 | 77.5045 to 77.5144 | Yes (570 m margin after the change) |
| Knowledge Park II metro station | way 696190204 | 28.4565 to 28.4575 | 77.4996 to 77.5009 | Yes |
| Knowledge Park II (area) | no named area found | | | **Unknown** |
| Knowledge Park I (area) | no named object found | | | **Unknown** |
| Jagat Farm | no named object found by Nominatim | | | **Unknown** |

Not yet known, and not to be assumed:

- Whether Jagat Farm and the Knowledge Park areas exist in OSM under another
  spelling, as unnamed land use, or not at all. If they are missing, their
  outlines cannot be claimed as verified.
- How many building footprints are mapped per sector, and how many carry
  height or level tags.
- Whether service roads, medians and footpaths are mapped as separate ways.

## Audit tool

`node tools/inspect-osm.mjs --out data/osm/audit-report.txt` reads the extract
and reports: integrity problems and duplicates; road classes with name, lane
and one-way coverage; roundabouts; roads around Pari Chowk and each sector;
per-sector building, park, gate and land-use counts; searches of every tag for
Knowledge Park and Jagat Farm with nearby education and commerce features;
building sizes, shapes and an evidence-based classification; barriers, gates
and named residential areas; and a list of gaps. `--find <pattern>` lists every
feature with a matching tag value. `npm run test:tools` tests it on a synthetic
fixture.

The audit has **not yet been run on the real extract by the agent**: the file
exists only on the project owner's machine and has not been shared. The
tables above therefore still rest on individual lookups.

Classification rule: a building is called institutional, commercial or an
apartment block only when its own tags or an enclosing tagged area say so.
Guesses from footprint size are printed in rows marked UNCONFIRMED.

## Extract profiles

`tools/fetch-osm.mjs --profile v2` writes a second, wider extract to
`greater-noida-corridor-v2.json` without touching the baseline (see
`data/osm/README.md`). `tools/compare-osm.mjs` compares two extracts metric by
metric, lists features present in only one of them, and flags any metric that
got worse. The v2 query has been checked for syntax by reading only: the
agent's sandbox could not reach an Overpass server, so its first real run is
on the project owner's machine. If a server rejects the bbox-limited relation
output, the script retries with a simpler form.

The wider query can only download what OpenStreetMap already holds. It cannot
add shops at Jagat Farm or campuses in the Knowledge Parks that nobody has
mapped.

## Confidence classes

Every generated feature will carry one of these, and the classes will stay
visible in the package data and in the documentation.

| Class | Meaning | Examples |
| --- | --- | --- |
| `verified` | Position and shape come directly from a source object, with its id kept | Road centre lines, sector outlines, mapped building footprints, named stations |
| `approximate` | Based on a real feature, with missing attributes filled in by rule | Road width from class when no `lanes` tag; building height when no `height` or `building:levels`; facade style |
| `decorative` | Original content with no real counterpart | Trees, street furniture, parked cars, generic signboards without real names |

Rules: no invented coordinates; no invented society, shop or landmark names;
real names appear only when they come from the source data; approximate
buildings are never described as replicas.
