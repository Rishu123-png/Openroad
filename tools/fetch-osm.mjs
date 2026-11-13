#!/usr/bin/env node
/**
 * Downloads the OpenStreetMap extract for the first OPENROAD district
 * (Pari Chowk corridor, Greater Noida) and writes a trimmed copy to data/osm/.
 *
 *   node tools/fetch-osm.mjs                  baseline (v1) -> greater-noida-corridor.json
 *   node tools/fetch-osm.mjs --profile v2     expanded      -> greater-noida-corridor-v2.json
 *   node tools/fetch-osm.mjs --profile v2 --from raw.json   convert an Overpass JSON export
 *   node tools/fetch-osm.mjs --profile v2 --print-query     show the query and exit
 *
 * An existing output file is never overwritten unless --force is given.
 *
 * Data © OpenStreetMap contributors, Open Database License (ODbL) 1.0.
 * No dependencies; needs Node 18 or newer.
 */
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** south, west, north, east. Pari Chowk roundabout is at about 28.4652, 77.5113. */
export const BBOX = [28.445, 77.485, 28.5, 77.54];
const B = BBOX.join(",");

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const QUERY_V1 = `[out:json][timeout:180][bbox:${B}];
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

/**
 * v2 adds: relations (multipolygon, site, building, non-administrative and
 * local administrative boundaries) with their member ways; building parts;
 * every barrier, entrance, highway, railway and transit node (gates, lift
 * gates, bollards, street lamps, signals, crossings); and wider point-of-
 * interest coverage (shop, office, craft, tourism, healthcare, leisure,
 * man_made, power, emergency, advertising, and any named node or way).
 * Relation geometry is limited to the bbox so that a large boundary cannot
 * pull in geometry far outside the district.
 */
const QUERY_V2 = `[out:json][timeout:300][maxsize:536870912][bbox:${B}];
(
  way[highway];
  way[building];
  way["building:part"];
  way[landuse];
  way[leisure];
  way[natural];
  way[amenity];
  way[barrier];
  way[railway];
  way[shop];
  way[office];
  way[craft];
  way[tourism];
  way[healthcare];
  way[man_made];
  way[power];
  way[waterway];
  way[place];
  way[public_transport];
  way[boundary];
  way[residential];
  way[name];
  node[place];
  node[amenity];
  node[shop];
  node[office];
  node[craft];
  node[tourism];
  node[healthcare];
  node[leisure];
  node[railway];
  node[public_transport];
  node[barrier];
  node[entrance];
  node[highway];
  node[natural=tree];
  node[man_made];
  node[power];
  node[emergency];
  node[advertising];
  node[name];
)->.features;
(
  relation[type=multipolygon];
  relation[type=site];
  relation[building];
  relation[type=boundary][boundary!=administrative];
  relation[boundary=administrative][admin_level~"^(8|9|10|11)$"];
)->.rels;
way(r.rels)(${B})->.members;
(.features; .members;);
out body geom qt;
.rels out body geom(${B}) qt;`;

export const PROFILES = {
  v1: { query: QUERY_V1, file: "greater-noida-corridor.json" },
  v2: {
    query: QUERY_V2,
    file: "greater-noida-corridor-v2.json",
    // Used only if a server rejects the bbox-limited relation output as a syntax error.
    fallbackQuery: QUERY_V2.replace(/\.rels out body geom\([^)]*\) qt;$/, ".rels out body geom qt;"),
  },
};
/** Kept for older callers. */
export const QUERY = QUERY_V1;

const round = (v) => Math.round(v * 1e7) / 1e7;
const flat = (geometry) => {
  const pts = [];
  let missing = 0;
  for (const p of geometry ?? []) {
    if (p) pts.push(round(p.lat), round(p.lon));
    else missing++;
  }
  return { pts, missing };
};

/** Keeps ids, tags, roles and coordinates; drops everything else. */
export function trim(raw, meta = {}) {
  const ways = new Map();
  const nodes = new Map();
  const relations = new Map();
  for (const el of raw.elements ?? []) {
    if (el.type === "way" && Array.isArray(el.geometry)) {
      const { pts } = flat(el.geometry);
      if (pts.length >= 4) ways.set(el.id, { id: el.id, tags: el.tags ?? {}, pts });
    } else if (el.type === "node" && el.tags) {
      nodes.set(el.id, { id: el.id, tags: el.tags, lat: round(el.lat), lon: round(el.lon) });
    } else if (el.type === "relation") {
      let clipped = false;
      const members = (el.members ?? []).map((m) => {
        if (m.type === "way") {
          const { pts, missing } = flat(m.geometry);
          if (missing > 0 || !m.geometry) clipped = true;
          return { type: "way", ref: m.ref, role: m.role ?? "", pts };
        }
        if (m.type === "node") return { type: "node", ref: m.ref, role: m.role ?? "", lat: m.lat === undefined ? null : round(m.lat), lon: m.lon === undefined ? null : round(m.lon) };
        return { type: m.type, ref: m.ref, role: m.role ?? "" };
      });
      relations.set(el.id, { id: el.id, tags: el.tags ?? {}, clipped, members });
    }
  }
  const sorted = (m) => [...m.values()].sort((a, b) => a.id - b.id);
  const data = {
    source: "OpenStreetMap via Overpass API",
    licence: "ODbL 1.0, © OpenStreetMap contributors, https://www.openstreetmap.org/copyright",
    profile: meta.profile ?? "v1",
    osmBase: raw.osm3s?.timestamp_osm_base ?? null,
    extractedAt: meta.extractedAt ?? null,
    endpoint: meta.endpoint ?? null,
    bbox: BBOX,
    query: meta.query ?? null,
    format:
      "ways[].pts and relation member pts are flat lists: lat, lon, lat, lon ... in WGS84 degrees. " +
      "ids are OpenStreetMap ids. relations[].clipped is true when member geometry outside the bbox was left out.",
    ways: sorted(ways),
    nodes: sorted(nodes),
  };
  if ((meta.profile ?? "v1") !== "v1") data.relations = sorted(relations);
  return data;
}

async function download(query) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt++) {
    for (const url of ENDPOINTS) {
      try {
        console.log(`Requesting ${url} ...`);
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "openroad-fetch-osm/2.0" },
          body: "data=" + encodeURIComponent(query),
          signal: AbortSignal.timeout(360_000),
        });
        const text = await res.text();
        if (res.status === 400) {
          // A syntax error will not get better on another server.
          const err = new Error(`The server rejected the query (HTTP 400):\n${text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 600)}`);
          err.fatal = true;
          throw err;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        let json;
        try {
          json = JSON.parse(text);
        } catch {
          throw new Error("response was not JSON (server busy or timed out)");
        }
        // Overpass reports a runtime failure in "remark" and may still send partial data.
        if (json.remark) throw new Error(`server remark: ${json.remark}`);
        if (!Array.isArray(json.elements) || json.elements.length === 0) throw new Error("empty result");
        return { json, endpoint: url };
      } catch (err) {
        if (err.fatal) throw err;
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
  const args = process.argv.slice(2);
  const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const profileName = arg("--profile") ?? "v1";
  const profile = PROFILES[profileName];
  if (!profile) throw new Error(`Unknown profile "${profileName}". Use v1 or v2.`);
  if (args.includes("--print-query")) return console.log(profile.query);

  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const out = resolve(root, "data/osm", arg("--out") ?? profile.file);
  const exists = await access(out).then(() => true, () => false);
  if (exists && !args.includes("--force")) {
    throw new Error(`${out} already exists and was left untouched.\nUse --out <other-name.json> to write elsewhere, or --force to replace it.`);
  }

  const from = arg("--from");
  let query = profile.query;
  let result;
  if (from) result = { json: JSON.parse(await readFile(from, "utf8")), endpoint: `file:${from}` };
  else {
    try {
      result = await download(query);
    } catch (err) {
      if (!err.fatal || !profile.fallbackQuery) throw err;
      console.log(`${err.message}\nRetrying with the simpler relation output.`);
      query = profile.fallbackQuery;
      result = await download(query);
    }
  }
  const { json, endpoint } = result;
  const data = trim(json, { profile: profileName, query: from ? null : query, endpoint, extractedAt: new Date().toISOString() });
  const count = (key) => data.ways.filter((w) => key in w.tags).length;
  await mkdir(dirname(out), { recursive: true });
  const text = JSON.stringify(data);
  await writeFile(out, text + "\n");
  console.log(`Wrote ${out} (${(text.length / 1e6).toFixed(2)} MB), profile ${profileName}, extracted ${data.extractedAt}`);
  console.log(
    `ways ${data.ways.length}: highway ${count("highway")}, building ${count("building")}, building:part ${count("building:part")}, ` +
      `landuse ${count("landuse")}, leisure ${count("leisure")}; tagged nodes ${data.nodes.length}; ` +
      `relations ${data.relations?.length ?? "not requested"}; OSM base ${data.osmBase}`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
