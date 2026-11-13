#!/usr/bin/env node
/**
 * Downloads the OpenStreetMap extract for the first OPENROAD district
 * (Pari Chowk corridor, Greater Noida) and writes a trimmed copy to
 * data/osm/greater-noida-corridor.json.
 *
 *   node tools/fetch-osm.mjs                 download from Overpass
 *   node tools/fetch-osm.mjs --from raw.json convert an Overpass JSON export
 *
 * Data © OpenStreetMap contributors, Open Database License (ODbL) 1.0.
 * No dependencies; needs Node 18 or newer.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** south, west, north, east. Pari Chowk roundabout is at about 28.4652, 77.5113. */
export const BBOX = [28.445, 77.485, 28.5, 77.54];

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

export const QUERY = `[out:json][timeout:180][bbox:${BBOX.join(",")}];
(
  way[highway];
  way[building];
  way[landuse];
  way[leisure];
  way[natural];
  way[amenity];
  way[barrier];
  way[railway];
  node[place];
  node[amenity];
  node[shop];
  node[railway=station];
  node[barrier=gate];
  node[natural=tree];
  node[highway~"^(traffic_signals|bus_stop|crossing)$"];
);
out body geom qt;`;

const round = (v) => Math.round(v * 1e7) / 1e7;

/** Keeps ids, tags and coordinates; drops everything else. */
export function trim(raw) {
  const ways = [];
  const nodes = [];
  for (const el of raw.elements ?? []) {
    if (el.type === "way" && Array.isArray(el.geometry) && el.geometry.length >= 2) {
      const pts = [];
      for (const p of el.geometry) if (p) pts.push(round(p.lat), round(p.lon));
      ways.push({ id: el.id, tags: el.tags ?? {}, pts });
    } else if (el.type === "node" && el.tags) {
      nodes.push({ id: el.id, tags: el.tags, lat: round(el.lat), lon: round(el.lon) });
    }
  }
  ways.sort((a, b) => a.id - b.id);
  nodes.sort((a, b) => a.id - b.id);
  return {
    source: "OpenStreetMap via Overpass API",
    licence: "ODbL 1.0, © OpenStreetMap contributors, https://www.openstreetmap.org/copyright",
    osmBase: raw.osm3s?.timestamp_osm_base ?? null,
    bbox: BBOX,
    format: "ways[].pts is a flat list: lat, lon, lat, lon ... in WGS84 degrees",
    ways,
    nodes,
  };
}

async function download() {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const url of ENDPOINTS) {
      try {
        console.log(`Requesting ${url} ...`);
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "openroad-fetch-osm/1.0" },
          body: "data=" + encodeURIComponent(QUERY),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!Array.isArray(json.elements) || json.elements.length === 0) throw new Error("empty result");
        return json;
      } catch (err) {
        lastError = err;
        console.log(`  failed: ${err.message}`);
      }
    }
    const wait = 10 * 2 ** attempt;
    console.log(`All servers failed; waiting ${wait} s before retrying.`);
    await new Promise((r) => setTimeout(r, wait * 1000));
  }
  throw new Error(`Could not download OSM data: ${lastError?.message}`);
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const out = resolve(root, "data/osm/greater-noida-corridor.json");
  const i = process.argv.indexOf("--from");
  const raw = i > 0 ? JSON.parse(await readFile(process.argv[i + 1], "utf8")) : await download();
  const data = trim(raw);
  const count = (key) => data.ways.filter((w) => key in w.tags).length;
  await mkdir(dirname(out), { recursive: true });
  const text = JSON.stringify(data);
  await writeFile(out, text + "\n");
  console.log(`Wrote ${out} (${(text.length / 1e6).toFixed(2)} MB)`);
  console.log(
    `ways ${data.ways.length}: highway ${count("highway")}, building ${count("building")}, ` +
      `landuse ${count("landuse")}, leisure ${count("leisure")}; tagged nodes ${data.nodes.length}; OSM base ${data.osmBase}`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
