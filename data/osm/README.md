# OpenStreetMap extracts

All files here come from OpenStreetMap through the Overpass API.
Licence: Open Database License (ODbL) 1.0. © OpenStreetMap contributors.
<https://www.openstreetmap.org/copyright>

| File | Made by | Content |
| --- | --- | --- |
| `greater-noida-corridor.json` | `node tools/fetch-osm.mjs` | Baseline (v1): ways tagged highway, building, landuse, leisure, natural, amenity, barrier or railway, and a few kinds of tagged node. No relations. |
| `greater-noida-corridor-v2.json` | `node tools/fetch-osm.mjs --profile v2` | Expanded: everything in v1 plus multipolygon, site, building and boundary relations with member ways; building parts; all barrier, entrance, highway, railway and transit nodes (gates, bollards, street lamps); and wider shop, office, craft, tourism, healthcare and named-feature coverage. |
| `audit-report.txt`, `comparison-report.txt` | `tools/inspect-osm.mjs --out`, `tools/compare-osm.mjs --out` | Reports. They quote OSM names and ids, so the same licence applies. |

Both extracts use the same boundary: south 28.445, west 77.485, north 28.500,
east 77.540 (WGS84). Each file records its profile, the exact query, the
server used, the extraction time and the OSM snapshot time (`osmBase`).
OpenStreetMap ids and all tags are kept on every feature.

The fetch script never overwrites an existing file unless `--force` is given,
so the baseline stays recoverable. The data files and reports are listed in
`.gitignore`; they are committed only on the project owner's decision
(`git add -f <file>`).
