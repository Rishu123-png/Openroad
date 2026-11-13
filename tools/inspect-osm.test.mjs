// Run with: npm run test:tools
// The fixture is synthetic. Its shapes and names exist only to exercise the code.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ORIGIN, areaOf, audit, classifyBuilding, distToLine, findByTag, inPolygon, prepare, toXY, where } from "./inspect-osm.mjs";

const M_LAT = 110832, M_LON = 97921;
/** Rectangle as a closed flat lat/lon ring from metres relative to the origin. */
const rect = (x, y, w, h) => {
  const p = (px, py) => [ORIGIN.lat + py / M_LAT, ORIGIN.lon + px / M_LON];
  return [p(x, y), p(x + w, y), p(x + w, y + h), p(x, y + h), p(x, y)].flat();
};
const line = (...xy) => xy.flatMap(([x, y]) => [ORIGIN.lat + y / M_LAT, ORIGIN.lon + x / M_LON]);
const node = (id, x, y, tags) => ({ id, tags, lat: ORIGIN.lat + y / M_LAT, lon: ORIGIN.lon + x / M_LON });

const fixture = () => ({
  osmBase: "fixture", bbox: [28.445, 77.485, 28.5, 77.54],
  ways: [
    { id: 1, tags: { landuse: "residential", name: "Alpha 1" }, pts: rect(100, 500, 1000, 1000) },
    { id: 2, tags: { building: "yes" }, pts: rect(200, 600, 10, 12) },
    { id: 3, tags: { building: "apartments", "building:levels": "12", name: "Test Tower" }, pts: rect(400, 700, 30, 30) },
    { id: 4, tags: { building: "yes" }, pts: rect(600, 900, 25, 25) },
    { id: 5, tags: { building: "yes" }, pts: rect(-900, -900, 40, 40) },
    { id: 6, tags: { landuse: "education", name: "Test College" }, pts: rect(-1000, -1000, 400, 400) },
    { id: 7, tags: { building: "retail" }, pts: rect(2000, 0, 20, 10) },
    { id: 8, tags: { building: "yes" }, pts: rect(2000, 0, 20, 10) },
    { id: 9, tags: { building: "yes" }, pts: line([0, 0], [5, 0], [5, 5]) },
    { id: 10, tags: { highway: "primary", name: "Test Road", lanes: "3", oneway: "yes" }, pts: line([-400, 0], [400, 0]) },
    { id: 11, tags: { highway: "residential" }, pts: line([150, 600], [900, 600]) },
    { id: 12, tags: { highway: "secondary", junction: "roundabout", name: "Pari Chowk" }, pts: rect(-30, -30, 60, 60) },
    { id: 13, tags: { barrier: "wall" }, pts: line([100, 500], [1100, 500]) },
    { id: 14, tags: { landuse: "residential", name: "Test Society" }, pts: rect(380, 680, 100, 100) },
    { id: 15, tags: { railway: "station", name: "Knowledge Park II" }, pts: rect(-1100, -900, 60, 20) },
  ],
  nodes: [
    node(100, 150, 600, { barrier: "gate" }),
    node(101, 2005, 5, { shop: "supermarket", name: "Shop A" }),
    node(102, 2010, 8, { shop: "bakery" }),
    node(103, 2030, 20, { amenity: "bank", "addr:street": "Jagat Farm Road" }),
    node(104, -800, -800, { amenity: "college", name: "Test College" }),
  ],
});

test("geometry helpers", () => {
  const sq = toXY(rect(0, 0, 10, 20));
  assert.ok(Math.abs(areaOf(sq) - 200) < 0.01);
  assert.equal(inPolygon([5, 5], sq), true);
  assert.equal(inPolygon([15, 5], sq), false);
  assert.ok(Math.abs(distToLine([5, 30], sq) - 10) < 0.01);
  assert.equal(where([0, 500]), "500 m N");
  assert.equal(where([2000, 2000]), "2.8 km NE");
});

test("findByTag searches every tag, not only names", () => {
  const hits = findByTag(prepare(fixture()), /jagat/i);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].key, "addr:street");
});

test("classification separates tagged evidence from guesses", () => {
  const d = prepare(fixture());
  const zones = [
    { kind: "residential", xy: d.ways[0].xy, label: "landuse=residential" },
    { kind: "institutional", xy: d.ways[5].xy, label: "landuse=education" },
  ];
  const cls = (id) => classifyBuilding(d.ways.find((w) => w.id === id), { zones })[0];
  assert.match(cls(3), /^residential tower/);
  assert.match(cls(2), /^UNCONFIRMED: small/);
  assert.match(cls(4), /^UNCONFIRMED: large/);
  assert.equal(cls(5), "institutional");
  assert.equal(cls(7), "commercial");
  assert.match(cls(8), /^unclassified/);
});

test("audit report covers every section and flags problems", () => {
  const text = audit(fixture());
  for (let i = 1; i <= 8; i++) assert.match(text, new RegExp(`== ${i}\\. `));
  assert.match(text, /© OpenStreetMap contributors, ODbL 1\.0/);
  assert.match(text, /Ways with identical geometry to another way: 1/);
  assert.match(text, /Buildings not closed[^:]*: 1/);
  assert.match(text, /Alpha 1: way 1 landuse=residential, 1\.00 km2/);
  assert.match(text, /Beta 1: no named land-use polygon found/);
  assert.match(text, /Features with "jagat" in any tag value: 1/);
  assert.match(text, /referring to Knowledge Park I \/ 1: 0/);
  assert.match(text, /Features referring to Knowledge Park II \/ 2: 1; transit[^;]*1; anything else 0/);
  assert.match(text, /"Test Society" way 14/);
  assert.match(text, /way 12 secondary "Pari Chowk"/);
  assert.match(text, /Gates lying on a mapped road[^:]*: 1 of 1/);
  assert.match(text, /Knowledge Park I: not present under that name/);
});

test("audit handles a dataset of the real size quickly", () => {
  const data = fixture();
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 9300; i++) data.ways.push({ id: 1000 + i, tags: { building: "yes" }, pts: rect(rnd() * 5000 - 2500, rnd() * 5600 - 2200, 8 + rnd() * 20, 8 + rnd() * 20) });
  for (let i = 0; i < 3300; i++) { const x = rnd() * 5000 - 2500, y = rnd() * 5600 - 2200; data.ways.push({ id: 20000 + i, tags: { highway: "residential" }, pts: line([x, y], [x + 60, y + 10], [x + 120, y + 40]) }); }
  const t = Date.now();
  audit(data);
  assert.ok(Date.now() - t < 20000);
});

// ---- v2: relations, trimming and comparison --------------------------------
import { mkdtemp, readFile as read, writeFile as write } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PROFILES, trim } from "./fetch-osm.mjs";
import { compare } from "./compare-osm.mjs";
import { assembleRings, metrics } from "./inspect-osm.mjs";

const geomOf = (pts) => { const g = []; for (let i = 0; i < pts.length; i += 2) g.push({ lat: pts[i], lon: pts[i + 1] }); return g; };
/** Raw Overpass-style response: one building split into two member ways, with a courtyard. */
const rawV2 = () => {
  const f = fixture();
  const elements = [
    ...f.ways.map((w) => ({ type: "way", id: w.id, tags: w.tags, geometry: geomOf(w.pts) })),
    ...f.nodes.map((n) => ({ type: "node", id: n.id, lat: n.lat, lon: n.lon, tags: n.tags })),
    { type: "way", id: 50, tags: { "building:part": "yes", height: "40" }, geometry: geomOf(rect(400, 700, 10, 10)) },
    { type: "way", id: 51, geometry: geomOf(line([3000, 0], [3100, 0], [3100, 100])) },
    { type: "node", id: 200, lat: ORIGIN.lat, lon: ORIGIN.lon + 0.001, tags: { highway: "street_lamp" } },
    { type: "node", id: 201, lat: ORIGIN.lat, lon: ORIGIN.lon + 0.002, tags: { barrier: "bollard" } },
    { type: "node", id: 202, lat: ORIGIN.lat, lon: ORIGIN.lon + 0.003, tags: { entrance: "main" } },
    { type: "node", id: 203, lat: ORIGIN.lat + 0.0001, lon: ORIGIN.lon + 0.0323, tags: { shop: "clothes", name: "Shop near Jagat tag" } },
    { type: "relation", id: 900, tags: { type: "multipolygon", building: "university", name: "Test Block" }, members: [
      { type: "way", ref: 51, role: "outer", geometry: geomOf(line([3000, 0], [3100, 0], [3100, 100])) },
      { type: "way", ref: 52, role: "outer", geometry: geomOf(line([3100, 100], [3000, 100], [3000, 0])) },
      { type: "way", ref: 53, role: "inner", geometry: geomOf(rect(3040, 40, 20, 20)) },
    ] },
    { type: "relation", id: 901, tags: { type: "boundary", boundary: "administrative", admin_level: "8", name: "Test Ward" }, members: [
      { type: "way", ref: 60, role: "outer", geometry: [{ lat: ORIGIN.lat, lon: ORIGIN.lon }, null, { lat: ORIGIN.lat + 0.01, lon: ORIGIN.lon }] },
    ] },
    // The same way listed twice, as Overpass does when it matches two statements.
    { type: "way", id: 2, tags: { building: "yes" }, geometry: geomOf(rect(200, 600, 10, 12)) },
  ];
  return { osm3s: { timestamp_osm_base: "fixture-2" }, elements };
};

test("v2 query keeps everything v1 asked for and adds the new classes", () => {
  const q1 = PROFILES.v1.query, q2 = PROFILES.v2.query;
  for (const line of q1.split("\n").filter((l) => /^\s+way\[/.test(l))) assert.ok(q2.includes(line.trim()), `v2 lost ${line.trim()}`);
  for (const needle of ['way["building:part"]', "relation[type=multipolygon]", "node[entrance]", "node[barrier];", "node[highway];", "way(r.rels)", "node[office]"]) assert.ok(q2.includes(needle), needle);
  assert.equal(q1.match(/bbox:([^\]]+)/)[1], q2.match(/bbox:([^\]]+)/)[1]);
  assert.notEqual(PROFILES.v1.file, PROFILES.v2.file);
});

test("trim keeps ids, tags, roles and relation members, and removes repeated elements", () => {
  const d = trim(rawV2(), { profile: "v2", query: "q", endpoint: "e", extractedAt: "2026-01-01T00:00:00Z" });
  assert.equal(d.profile, "v2");
  assert.equal(d.extractedAt, "2026-01-01T00:00:00Z");
  assert.match(d.licence, /ODbL 1\.0, © OpenStreetMap contributors/);
  assert.equal(d.ways.filter((w) => w.id === 2).length, 1);
  assert.deepEqual(d.ways.find((w) => w.id === 51).tags, {});
  const r = d.relations.find((x) => x.id === 900);
  assert.deepEqual(r.members.map((m) => [m.ref, m.role]), [[51, "outer"], [52, "outer"], [53, "inner"]]);
  assert.equal(r.clipped, false);
  assert.equal(d.relations.find((x) => x.id === 901).clipped, true);
  assert.equal(trim(rawV2(), { profile: "v1" }).relations, undefined);
});

test("rings are assembled from several member ways", () => {
  const d = trim(rawV2(), { profile: "v2" });
  const r = d.relations.find((x) => x.id === 900);
  const outer = assembleRings(r.members.filter((m) => m.role === "outer"));
  assert.equal(outer.rings.length, 1);
  assert.equal(outer.open, 0);
  assert.ok(Math.abs(areaOf(outer.rings[0]) - 10000) < 20);
  assert.equal(assembleRings([r.members[0]]).open, 1);
});

test("audit and metrics report relations, parts and street furniture", () => {
  const d = trim(rawV2(), { profile: "v2" });
  const text = audit(d);
  assert.match(text, /== 9\. RELATIONS/);
  assert.match(text, /Outline assembly: closed 1; cut at the bbox 1; not closing although complete 0/);
  assert.match(text, /With inner rings[^:]*: 1/);
  assert.match(text, /Building parts 1: with height 1/);
  assert.match(text, /street lamps 1/);
  const m = new Map(metrics(d));
  assert.equal(m.get("relations"), 2);
  assert.equal(m.get("building relations with a usable outline"), 1);
  assert.equal(m.get("bollards"), 1);
  assert.equal(m.get("INVALID duplicate way ids"), 0);
  assert.equal(new Map(metrics(fixture())).get("relations"), "not requested");
});

test("comparison shows gains, flags losses and keeps attribution", () => {
  const a = fixture();
  const b = trim(rawV2(), { profile: "v2" });
  const text = compare(a, b, "baseline", "v2");
  assert.match(text, /© OpenStreetMap contributors, ODbL 1\.0/);
  assert.match(text, /street lamps\s+\|\s+0 \|\s+1 \| \+1/);
  assert.match(text, /ways: in both 15; only in v2 2; only in baseline 0/);
  assert.match(text, /No metric got worse/);
  b.ways = b.ways.filter((w) => w.id !== 10);
  assert.match(compare(a, b, "baseline", "v2"), /Worse or lower in v2: road ways: 3 -> 2/);
});

test("fetch script refuses to overwrite an existing extract", async () => {
  const run = promisify(execFile);
  const dir = await mkdtemp(join(tmpdir(), "openroad-"));
  const rawFile = join(dir, "raw.json"), outFile = join(dir, "out.json");
  await write(rawFile, JSON.stringify(rawV2()));
  const script = new URL("./fetch-osm.mjs", import.meta.url).pathname;
  await run("node", [script, "--profile", "v2", "--from", rawFile, "--out", outFile]);
  const first = await read(outFile, "utf8");
  assert.equal(JSON.parse(first).relations.length, 2);
  await assert.rejects(run("node", [script, "--profile", "v2", "--from", rawFile, "--out", outFile]), /already exists and was left untouched/);
  assert.equal(await read(outFile, "utf8"), first);
});
