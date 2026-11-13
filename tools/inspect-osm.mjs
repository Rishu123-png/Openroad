#!/usr/bin/env node
/**
 * Reports what data/osm/greater-noida-corridor.json actually contains, so that
 * coverage is checked rather than assumed.
 *
 *   node tools/inspect-osm.mjs [path-to-json]
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Places the first district must cover, with the patterns used to find them by name. */
const TARGETS = [
  ["Pari Chowk", /pari\s*chowk/i],
  ["Alpha 1", /^alpha[\s-]*(1|i)$/i],
  ["Alpha 2", /^alpha[\s-]*(2|ii)$/i],
  ["Beta 1", /^beta[\s-]*(1|i)$/i],
  ["Beta 2", /^beta[\s-]*(2|ii)$/i],
  ["Gamma 1", /^gamma[\s-]*(1|i)$/i],
  ["Gamma 2", /^gamma[\s-]*(2|ii)$/i],
  ["Jagat Farm", /jagat/i],
  ["Knowledge Park I", /knowledge\s*park[\s-]*(1|i)$/i],
  ["Knowledge Park II", /knowledge\s*park[\s-]*(2|ii)$/i],
];

const bboxOf = (pts) => {
  let s = 90, w = 180, n = -90, e = -180;
  for (let i = 0; i < pts.length; i += 2) {
    s = Math.min(s, pts[i]); n = Math.max(n, pts[i]);
    w = Math.min(w, pts[i + 1]); e = Math.max(e, pts[i + 1]);
  }
  return [s, w, n, e];
};
const closed = (pts) => pts.length >= 8 && pts[0] === pts.at(-2) && pts[1] === pts.at(-1);
const inPolygon = (lat, lon, pts) => {
  let inside = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const yi = pts[i], xi = pts[i + 1], yj = pts[j], xj = pts[j + 1];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const tally = (items, key) => {
  const m = new Map();
  for (const it of items) m.set(it.tags[key], (m.get(it.tags[key]) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
};
const fmt = (v) => v.toFixed(4);

export function inspect(data) {
  const out = [];
  const [S, W, N, E] = data.bbox;
  const km = (a, b, perDeg) => (((b - a) * perDeg) / 1000).toFixed(2);
  out.push(`OSM base: ${data.osmBase}`);
  out.push(`Requested bbox: S ${S} W ${W} N ${N} E ${E} (${km(W, E, 97900)} km x ${km(S, N, 110830)} km)`);

  const roads = data.ways.filter((w) => w.tags.highway);
  const buildings = data.ways.filter((w) => w.tags.building);
  const landuse = data.ways.filter((w) => w.tags.landuse);
  const leisure = data.ways.filter((w) => w.tags.leisure);
  out.push(`\nWays ${data.ways.length}, tagged nodes ${data.nodes.length}`);
  out.push(`\nRoads ${roads.length}: ` + tally(roads, "highway").map(([k, n]) => `${k} ${n}`).join(", "));
  const has = (list, k) => list.filter((w) => w.tags[k] !== undefined).length;
  out.push(`  with name ${has(roads, "name")}, lanes ${has(roads, "lanes")}, width ${has(roads, "width")}, oneway ${has(roads, "oneway")}, roundabouts ${roads.filter((w) => w.tags.junction === "roundabout").length}`);
  out.push(`\nBuildings ${buildings.length}: with height ${has(buildings, "height")}, levels ${has(buildings, "building:levels")}, name ${has(buildings, "name")}`);
  out.push("  types: " + tally(buildings, "building").slice(0, 12).map(([k, n]) => `${k} ${n}`).join(", "));
  out.push(`\nLand use ${landuse.length}: ` + tally(landuse, "landuse").map(([k, n]) => `${k} ${n}`).join(", "));
  out.push(`Leisure ${leisure.length}: ` + tally(leisure, "leisure").map(([k, n]) => `${k} ${n}`).join(", "));
  out.push(`Railway ways ${has(data.ways, "railway")}, barrier ways ${has(data.ways, "barrier")}`);
  for (const k of ["place", "amenity", "shop", "highway", "natural", "barrier"]) out.push(`Nodes with ${k}: ${has(data.nodes, k)}`);

  const centroids = buildings.map((b) => {
    const [s, w, n, e] = bboxOf(b.pts);
    return [(s + n) / 2, (w + e) / 2];
  });

  out.push("\nTarget places (found by name in the data):");
  for (const [label, re] of TARGETS) {
    const ways = data.ways.filter((w) => re.test(w.tags.name ?? ""));
    const nodes = data.nodes.filter((n) => re.test(n.tags.name ?? ""));
    if (ways.length + nodes.length === 0) {
      out.push(`  ${label}: NOT FOUND by name`);
      continue;
    }
    out.push(`  ${label}: ${ways.length} ways, ${nodes.length} nodes`);
    for (const w of ways.slice(0, 6)) {
      const [s, wst, n, e] = bboxOf(w.pts);
      const kind = w.tags.landuse ? `landuse=${w.tags.landuse}` : w.tags.highway ? `highway=${w.tags.highway}` : w.tags.railway ? `railway=${w.tags.railway}` : Object.keys(w.tags)[0];
      // A way touching the requested edge is probably cut off there.
      const m = 0.0005;
      const clipped = s < S + m || n > N - m || wst < W + m || e > E - m;
      let extra = "";
      if (w.tags.landuse && closed(w.pts)) {
        const count = centroids.filter(([la, lo]) => inPolygon(la, lo, w.pts)).length;
        const area = ((n - s) * 110830 * (e - wst) * 97900) / 1e6;
        extra = `, ${count} building footprints inside (bbox area ${area.toFixed(2)} km2)`;
      }
      out.push(`    way ${w.id} "${w.tags.name}" ${kind} lat ${fmt(s)}..${fmt(n)} lon ${fmt(wst)}..${fmt(e)}${clipped ? " TOUCHES EXTRACT EDGE" : ""}${extra}`);
    }
    for (const n of nodes.slice(0, 4)) out.push(`    node ${n.id} "${n.tags.name}" ${fmt(n.lat)}, ${fmt(n.lon)}`);
  }

  const named = landuse.filter((w) => w.tags.name).map((w) => `${w.tags.name} (${w.tags.landuse})`);
  out.push(`\nNamed land-use areas (${named.length}): ${named.sort().join("; ")}`);
  return out.join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const file = process.argv[2] ?? resolve(root, "data/osm/greater-noida-corridor.json");
  try {
    console.log(inspect(JSON.parse(await readFile(file, "utf8"))));
  } catch (err) {
    console.error(`Cannot read ${file}: ${err.message}\nRun "node tools/fetch-osm.mjs" first.`);
    process.exit(1);
  }
}
