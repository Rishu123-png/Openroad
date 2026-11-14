/**
 * SYNTHETIC TEST DATA. Not a map of any real place.
 *
 * Builds a small invented extract in the same format as tools/fetch-osm.mjs,
 * so the district builder and the game can be tested without the real
 * dataset. It is marked `synthetic: true`, and everything derived from it
 * carries that flag; the game shows a banner while it is loaded.
 *
 * The residential area is named "Alpha 1" only because the district builder
 * looks the sector up by that name. Its shape, streets and buildings are made up.
 */
import { BBOX } from "../fetch-osm.mjs";
import { makeProjection } from "../geo/projection.mjs";

export function syntheticExtract() {
  const { toGeo } = makeProjection();
  let nextId = 1;
  const ways = [], nodes = [], relations = [];
  const flat = (pts) => pts.flatMap(([x, z]) => { const g = toGeo(x, z); return [Math.round(g.lat * 1e7) / 1e7, Math.round(g.lon * 1e7) / 1e7]; });
  const way = (tags, pts) => { const w = { id: nextId++, tags, pts: flat(pts) }; ways.push(w); return w; };
  const node = (tags, [x, z]) => { const g = toGeo(x, z); nodes.push({ id: nextId++, tags, lat: g.lat, lon: g.lon }); };
  const box = (x, z, w, d) => [[x, z], [x + w, z], [x + w, z + d], [x, z + d], [x, z]];

  // Sector: 600 m x 480 m, south-west corner at (200, 300).
  const X0 = 200, Z0 = 300, W = 600, D = 480;
  way({ landuse: "residential", name: "Alpha 1" }, box(X0, Z0, W, D));

  // Streets: every way has a point at each crossing, as OSM ways share nodes.
  const xs = [X0, X0 + 150, X0 + 300, X0 + 450, X0 + W];
  const zs = [Z0, Z0 + 120, Z0 + 240, Z0 + 360, Z0 + D];
  xs.forEach((x, i) => {
    const edge = i === 0 || i === xs.length - 1;
    const pts = [[x, Z0 - 300], ...zs.map((z) => [x, z]), [x, Z0 + D + 300]];
    way(edge ? { highway: "secondary", lanes: "4", name: `Synthetic Avenue ${i + 1}` } : { highway: "residential" }, edge ? pts : pts.slice(1, -1));
  });
  zs.forEach((z, j) => {
    const edge = j === 0 || j === zs.length - 1;
    const pts = [[X0 - 300, z], ...xs.map((x) => [x, z]), [X0 + W + 300, z]];
    way(edge ? { highway: "tertiary", width: "9", sidewalk: "both" } : { highway: "residential", ...(j === 2 ? { oneway: "yes" } : {}) }, edge ? pts : pts.slice(1, -1));
  });
  way({ highway: "service" }, [[X0 + 150, Z0 + 60], [X0 + 225, Z0 + 60], [X0 + 225, Z0 + 95]]);
  way({ highway: "footway" }, [[X0 + 300, Z0 + 240], [X0 + 375, Z0 + 300], [X0 + 450, Z0 + 360]]);
  way({ highway: "proposed" }, [[X0 + 20, Z0 + 20], [X0 + 60, Z0 + 20]]);

  // Buildings: rows of plots in each block, set back from the streets.
  const kinds = [
    { building: "house" }, { building: "yes" }, { building: "house", "building:levels": "2" }, { building: "residential" },
    { building: "yes" }, { building: "detached", height: "7.5" }, { building: "yes", "building:levels": "3" }, { building: "house" },
  ];
  let k = 0;
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      if ((i === 1 && j === 1) || (i === 2 && j === 2) || (i === 3 && j === 0)) continue; // special blocks below
      const bx = xs[i] + 14, bz = zs[j] + 12;
      for (let c = 0; c < 6; c++) for (const row of [0, 1]) way(kinds[k++ % kinds.length], box(bx + c * 20.5, bz + row * 56, 15, 40 - (c % 3) * 4));
    }
  }
  // Block (1,1): apartments, one L-shaped, and a courtyard block mapped as a relation.
  const ax = xs[1] + 16, az = zs[1] + 14;
  way({ building: "apartments", "building:levels": "8" }, box(ax, az, 30, 18));
  way({ building: "apartments" }, [[ax + 45, az], [ax + 85, az], [ax + 85, az + 14], [ax + 60, az + 14], [ax + 60, az + 36], [ax + 45, az + 36], [ax + 45, az]]);
  const outer = way({ building: "yes" }, box(ax, az + 48, 60, 44)); // also tagged itself: must not be built twice
  const inner = way({}, box(ax + 18, az + 62, 24, 16));
  relations.push({ id: nextId++, tags: { type: "multipolygon", building: "apartments", "building:levels": "6" }, clipped: false, members: [{ type: "way", ref: outer.id, role: "outer", pts: outer.pts }, { type: "way", ref: inner.id, role: "inner", pts: inner.pts }] });
  // Block (2,2): a school, a clinic and a park.
  const sx = xs[2] + 14, sz = zs[2] + 12;
  way({ building: "school", name: "Synthetic School" }, box(sx, sz, 50, 24));
  way({ building: "yes", amenity: "clinic" }, box(sx + 70, sz, 22, 18));
  way({ leisure: "park" }, box(sx, sz + 44, 120, 50));
  way({ barrier: "wall" }, [[sx - 2, sz - 2], [sx + 54, sz - 2], [sx + 54, sz + 28]]);
  node({ barrier: "gate" }, [sx + 54, sz + 28]);
  // Block (3,0): shops, an office with a mapped height, a warehouse and a shed.
  const cx = xs[3] + 14, cz = zs[0] + 12;
  way({ building: "retail" }, box(cx, cz, 40, 16));
  way({ building: "yes", shop: "supermarket" }, box(cx + 50, cz, 24, 16));
  way({ building: "office", height: "21" }, box(cx, cz + 40, 30, 30));
  way({ building: "warehouse" }, box(cx + 50, cz + 40, 50, 28));
  way({ building: "shed" }, box(cx + 110, cz + 40, 5, 4));
  way({ building: "yes" }, [[cx + 60, cz + 80], [cx + 80, cz + 80], [cx + 80, cz + 95]]); // unclosed: must be skipped, not invented
  // Outside the sector, inside the buffer: a tower and an elevated rail line with a station.
  way({ building: "yes" }, box(X0 + W + 30, Z0 + 40, 40, 40));
  way({ railway: "subway", bridge: "yes", layer: "1" }, [[X0 - 300, Z0 - 60], [X0 + W + 300, Z0 - 60]]);
  node({ railway: "station", name: "Synthetic Station" }, [X0 + 300, Z0 - 60]);
  for (let i = 0; i < 6; i++) node({ highway: "street_lamp" }, [X0 + 8, Z0 + 30 + i * 70]);
  for (let i = 0; i < 5; i++) node({ natural: "tree" }, [sx + 15 + i * 22, sz + 70]);
  node({ shop: "bakery", name: "Synthetic Bakery" }, [cx + 20, cz + 8]);
  node({ highway: "traffic_signals" }, [X0, Z0]);

  return {
    synthetic: true,
    source: "SYNTHETIC TEST DATA (tools/fixtures/synthetic-extract.mjs). Not OpenStreetMap, not a real place.",
    licence: "none", profile: "v2", osmBase: null, extractedAt: "2026-01-01T00:00:00Z", endpoint: null,
    bbox: BBOX, query: null, format: "synthetic", ways, nodes, relations,
  };
}
