#!/usr/bin/env node
/**
 * Compares two OSM extracts made by tools/fetch-osm.mjs.
 *
 *   node tools/compare-osm.mjs                         baseline against v2
 *   node tools/compare-osm.mjs a.json b.json
 *   node tools/compare-osm.mjs --out data/osm/comparison-report.txt
 *
 * Data © OpenStreetMap contributors, ODbL 1.0.
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { metrics } from "./inspect-osm.mjs";

const mainKey = (t) => ["highway", "building", "building:part", "landuse", "leisure", "amenity", "shop", "office", "barrier", "railway", "natural", "entrance", "man_made", "power", "place", "tourism", "healthcare", "craft"].find((k) => t[k]) ?? (Object.keys(t).length ? "other tags" : "untagged");
const tally = (items) => {
  const m = new Map();
  for (const it of items) m.set(mainKey(it.tags), (m.get(mainKey(it.tags)) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ") || "none";
};

export function compare(a, b, nameA = "A", nameB = "B") {
  const out = [];
  out.push("OPENROAD EXTRACT COMPARISON");
  out.push("Source: OpenStreetMap via Overpass API. © OpenStreetMap contributors, ODbL 1.0.");
  for (const [n, d] of [[nameA, a], [nameB, b]])
    out.push(`${n}: profile ${d.profile ?? "v1"}, OSM base ${d.osmBase}, extracted ${d.extractedAt ?? "not recorded"}, bbox ${d.bbox.join(", ")}`);
  if (a.bbox.join() !== b.bbox.join()) out.push("WARNING: the two extracts cover different boundaries, so counts are not directly comparable.");
  if (a.osmBase !== b.osmBase) out.push("Note: the OSM snapshots differ, so some differences are edits made by mappers between the two downloads, not effects of the wider query.");

  const ma = metrics(a), mb = new Map(metrics(b));
  const w = Math.max(...ma.map(([k]) => k.length));
  out.push(`\n${"metric".padEnd(w)} | ${nameA.padStart(12)} | ${nameB.padStart(12)} | change`);
  const regressions = [];
  for (const [k, va] of ma) {
    const vb = mb.get(k);
    const delta = typeof va === "number" && typeof vb === "number" ? Math.round((vb - va) * 10) / 10 : "";
    out.push(`${k.padEnd(w)} | ${String(va).padStart(12)} | ${String(vb).padStart(12)} | ${delta === "" ? "" : delta > 0 ? `+${delta}` : delta}`);
    if (typeof delta === "number") {
      if (k.startsWith("INVALID") ? delta > 0 : delta < 0) regressions.push(`${k}: ${va} -> ${vb}`);
    }
  }

  for (const kind of ["ways", "nodes"]) {
    const ia = new Map(a[kind].map((x) => [x.id, x])), ib = new Map(b[kind].map((x) => [x.id, x]));
    const lost = [...ia.values()].filter((x) => !ib.has(x.id));
    const gained = [...ib.values()].filter((x) => !ia.has(x.id));
    let retagged = 0, moved = 0;
    for (const [id, x] of ia) {
      const y = ib.get(id);
      if (!y) continue;
      if (JSON.stringify(x.tags) !== JSON.stringify(y.tags)) retagged++;
      if (kind === "ways" ? x.pts.join() !== y.pts.join() : x.lat !== y.lat || x.lon !== y.lon) moved++;
    }
    out.push(`\n${kind}: in both ${ia.size - lost.length}; only in ${nameB} ${gained.length}; only in ${nameA} ${lost.length}; same id with different tags ${retagged}, different geometry ${moved}`);
    out.push(`  only in ${nameB}, by main tag: ${tally(gained)}`);
    if (lost.length) {
      out.push(`  only in ${nameA}, by main tag: ${tally(lost)}`);
      out.push(`  first ids only in ${nameA}: ${lost.slice(0, 15).map((x) => x.id).join(", ")}`);
    }
  }

  out.push("\nVERDICT");
  if (regressions.length === 0) out.push(`- No metric got worse from ${nameA} to ${nameB}.`);
  else for (const r of regressions) out.push(`- Worse or lower in ${nameB}: ${r}`);
  out.push("- A higher count means more of what OSM holds was downloaded. It does not mean OSM gained real-world coverage.");
  return out.join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf("--out");
  const outFile = outIndex >= 0 ? args.splice(outIndex, 2)[1] : undefined;
  const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../data/osm");
  const fa = args[0] ?? resolve(dir, "greater-noida-corridor.json");
  const fb = args[1] ?? resolve(dir, "greater-noida-corridor-v2.json");
  try {
    const [a, b] = await Promise.all([fa, fb].map(async (f) => JSON.parse(await readFile(f, "utf8"))));
    const text = compare(a, b, "baseline", "v2");
    console.log(text);
    if (outFile) await writeFile(outFile, text + "\n");
  } catch (err) {
    console.error(`Cannot compare: ${err.message}`);
    process.exit(1);
  }
}
