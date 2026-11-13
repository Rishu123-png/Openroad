# OpenStreetMap extract

`greater-noida-corridor.json` is produced by `node tools/fetch-osm.mjs` from the
repository root. It is not in the repository yet; run the script to create it.

- Source: OpenStreetMap, downloaded through the Overpass API.
- Licence: Open Database License (ODbL) 1.0. © OpenStreetMap contributors.
  <https://www.openstreetmap.org/copyright>
- Area: south 28.445, west 77.485, north 28.500, east 77.540 (WGS84), which
  covers Pari Chowk and the Alpha, Beta, Gamma and Knowledge Park sectors.
- Content: ways tagged highway, building, landuse, leisure, natural, amenity,
  barrier or railway, and selected tagged nodes. Relations are not included.

The file is a trimmed copy of OSM data, so it stays under ODbL. The exact query
is in `tools/fetch-osm.mjs`, so anyone can reproduce it.
