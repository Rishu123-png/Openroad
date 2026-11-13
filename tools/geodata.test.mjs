// Run with: npm run test:tools
// Every fixture here is synthetic. Shapes, ids and names exist only to exercise the code.
import assert from "node:assert/strict";
import { test } from "node:test";
import { assertInside, convert, LAYER_NAMES } from "./build-layers.mjs";
import { clipLine, clipPolygon, clipRing, inside, ringArea } from "./geo/clip.mjs";
import { GREATER_NOIDA_ORIGIN, makeProjection } from "./geo/projection.mjs";
import { assembleRelation, joinRings } from "./geo/rings.mjs";
import { formatValidation, validateCoordinates } from "./geo/validate.mjs";
import { metrics } from "./inspect-osm.mjs";
import { renderCoverage } from "./render-coverage.mjs";

const proj = makeProjection();
const BBOX = [28.445, 77.485, 28.5, 77.54];
const R = { minX: 0, minZ: 0, maxX: 100, maxZ: 100 };
/** Metres to a flat lat/lon list, the way extracts store geometry. */
const ll = (...xz) => xz.flatMap(([x, z]) => { const g = proj.toGeo(x, z); return [Math.round(g.lat * 1e7) / 1e7, Math.round(g.lon * 1e7) / 1e7]; });
const box = (x, z, w, h) => [[x, z], [x + w, z], [x + w, z + h], [x, z + h], [x, z]];
const way = (id, tags, pts) => ({ id, tags, pts: ll(...pts) });
const node = (id, x, z, tags) => { const [lat, lon] = ll([x, z]); return { id, tags, lat, lon }; };

// ------------------------------------------------------------ projection

test("projection: origin, scale, axes and round trip", () => {
  assert.deepEqual(proj.toLocal(GREATER_NOIDA_ORIGIN.lat, GREATER_NOIDA_ORIGIN.lon), [0, 0]);
  assert.ok(proj.metresPerDegLat > 110800 && proj.metresPerDegLat < 110860);
  assert.ok(proj.metresPerDegLon > 97850 && proj.metresPerDegLon < 97990);
  const [x, z] = proj.toLocal(28.4710345, 77.5127373); // north-east of the origin
  assert.ok(x > 100 && z > 600);
  const g = proj.toGeo(1234.5, -987.25);
  assert.deepEqual(proj.toLocal(g.lat, g.lon), [1234.5, -987.25]);
  const r = proj.rect(BBOX);
  assert.ok(r.minX < 0 && r.minZ < 0 && r.maxX > 0 && r.maxZ > 0);
  assert.ok(Math.abs(r.maxX - r.minX - 5386) < 5 && Math.abs(r.maxZ - r.minZ - 6096) < 5);
});

test("projection matches the game module's formula", async () => {
  const src = await (await import("node:fs/promises")).readFile(new URL("../apps/web/src/game/geo/projection.ts", import.meta.url), "utf8");
  assert.match(src, /WGS84_A = 6378137/);
  assert.match(src, /WGS84_E2 = 0\.00669437999014/);
  assert.match(src, /lat: 28\.46526, lon: 77\.5113/);
});

// ------------------------------------------------------------ clipping

test("clipLine: inside, outside, crossing and re-entering", () => {
  const whole = clipLine([[10, 10], [50, 50], [90, 10]], R);
  assert.equal(whole.clipped, false);
  assert.deepEqual(whole.pieces.map((p) => p.points), [[[10, 10], [50, 50], [90, 10]]]);
  assert.equal(clipLine([[-50, -10], [-10, -50]], R).pieces.length, 0);

  const through = clipLine([[-50, 50], [150, 50]], R); // no vertex inside at all
  assert.deepEqual(through.pieces, [{ points: [[0, 50], [100, 50]], cutStart: true, cutEnd: true }]);

  // leaves through the east edge, comes back further north: two pieces, order kept
  const twice = clipLine([[50, 20], [150, 20], [150, 80], [50, 80]], R);
  assert.equal(twice.clipped, true);
  assert.deepEqual(twice.pieces, [
    { points: [[50, 20], [100, 20]], cutStart: false, cutEnd: true },
    { points: [[100, 80], [50, 80]], cutStart: true, cutEnd: false },
  ]);
  for (const p of twice.pieces) for (const q of p.points) assert.ok(inside(q, R));
});

test("clipLine keeps a road continuous through interior vertices", () => {
  const { pieces } = clipLine([[-20, 50], [20, 50], [40, 60], [60, 50], [120, 50]], R);
  assert.equal(pieces.length, 1);
  assert.deepEqual(pieces[0].points, [[0, 50], [20, 50], [40, 60], [60, 50], [100, 50]]);
});

test("clipRing and clipPolygon: area, validity, holes", () => {
  const half = clipRing(box(50, 20, 100, 40), R); // half of it sticks out east
  assert.equal(half.clipped, true);
  assert.ok(Math.abs(ringArea(half.ring) - 50 * 40) < 0.01);
  assert.deepEqual(half.ring[0], half.ring.at(-1));
  for (const p of half.ring) assert.ok(inside(p, R));
  assert.equal(clipRing(box(200, 200, 10, 10), R).ring, null);
  const untouched = clipRing(box(10, 10, 20, 20), R);
  assert.equal(untouched.clipped, false);
  assert.deepEqual(untouched.ring, box(10, 10, 20, 20));

  // courtyard inside, courtyard outside, courtyard cut by the boundary
  const p = clipPolygon(box(20, 20, 200, 60), [box(30, 30, 10, 10), box(150, 30, 10, 10), box(90, 50, 30, 10)], R);
  assert.equal(p.clipped, true);
  assert.equal(p.holes.length, 2);
  assert.ok(Math.abs(ringArea(p.holes[1]) - 100) < 0.01); // only the 10 m inside remains
  assert.equal(clipPolygon(box(300, 300, 5, 5), [], R), null);
  // a region corner inside a large polygon
  const big = clipRing(box(-500, -500, 550, 550), R);
  assert.ok(Math.abs(ringArea(big.ring) - 50 * 50) < 0.01);
});

// ------------------------------------------------------------ relations

test("joinRings joins ways in any order and direction", () => {
  const { rings, open } = joinRings([[[0, 0], [10, 0]], [[10, 10], [10, 0]], [[10, 10], [0, 10], [0, 0]]]);
  assert.equal(rings.length, 1);
  assert.equal(open.length, 0);
  assert.equal(ringArea(rings[0]), 100);
  assert.equal(joinRings([[[0, 0], [10, 0], [10, 10]]]).open.length, 1);
});

test("assembleRelation: outer and inner rings, courtyards assigned to the right outer", () => {
  const rel = { id: 1, tags: { type: "multipolygon", building: "yes" }, clipped: false, members: [
    { type: "way", ref: 10, role: "outer" }, { type: "way", ref: 11, role: "outer" }, { type: "way", ref: 12, role: "inner" },
    { type: "way", ref: 13, role: "outer" }, { type: "way", ref: 14, role: "inner" },
  ] };
  const lines = new Map([
    [10, [[0, 0], [100, 0], [100, 100]]], [11, [[100, 100], [0, 100], [0, 0]]], [12, box(40, 40, 20, 20)],
    [13, box(200, 0, 50, 50)], [14, box(210, 10, 5, 5)],
  ]);
  const a = assembleRelation(rel, lines, () => { throw new Error("not needed"); });
  assert.equal(a.incomplete, false);
  assert.equal(a.polygons.length, 2);
  const bigPoly = a.polygons.find((p) => ringArea(p.outer) === 10000);
  assert.equal(bigPoly.holes.length, 1);
  assert.equal(ringArea(bigPoly.holes[0]), 400);
  assert.equal(a.polygons.find((p) => ringArea(p.outer) === 2500).holes.length, 1);
});

test("assembleRelation: a missing member is reported, never bridged", () => {
  const rel = { id: 2, tags: { type: "multipolygon", building: "yes" }, clipped: false, members: [
    { type: "way", ref: 10, role: "outer" }, { type: "way", ref: 99, role: "outer", pts: [] },
  ] };
  const a = assembleRelation(rel, new Map([[10, [[0, 0], [100, 0], [100, 100]]]]), (pts) => proj.line(pts));
  assert.equal(a.incomplete, true);
  assert.deepEqual(a.missingMembers, [99]);
  assert.equal(a.polygons.length, 0);
  assert.deepEqual(a.openOutlines, [[[0, 0], [100, 0], [100, 100]]]); // exactly the source points
  assert.match(a.reasons.join("; "), /1 member way\(s\) have no geometry.*1 outer chain\(s\) do not close.*no closed outer ring/);
});

test("assembleRelation prefers the full way geometry over geometry cut inside the relation", () => {
  const rel = { id: 3, tags: { type: "multipolygon", landuse: "residential" }, clipped: true, members: [
    { type: "way", ref: 10, role: "outer", pts: ll([0, 0], [10, 0]) }, // cut copy
  ] };
  const a = assembleRelation(rel, new Map([[10, box(0, 0, 10, 10)]]), (pts) => proj.line(pts));
  assert.equal(a.incomplete, false);
  assert.equal(a.polygons.length, 1);
  const cutOnly = assembleRelation(rel, new Map(), (pts) => proj.line(pts));
  assert.equal(cutOnly.incomplete, true);
  assert.match(cutOnly.reasons.join(), /cut at the extract boundary/);
});

// ------------------------------------------------------------ validation (regression for "INVALID coordinates ... 0 -> 1")

const longWayData = () => ({
  bbox: BBOX, osmBase: "fixture", profile: "v2",
  // A power line that crosses the district and runs on to latitude 27.5, as Overpass returns it.
  ways: [{ id: 777, tags: { power: "line", name: "Synthetic line" }, pts: [28.49, 77.5, 28.46, 77.5, 27.5, 77.6] }, way(778, { highway: "residential" }, [[0, 0], [50, 0]])],
  nodes: [node(1, 10, 10, { shop: "bakery" })],
  relations: [],
});

test("a long valid way is not malformed data; the old window check was the fault", () => {
  const v = validateCoordinates(longWayData());
  assert.equal(v.malformed.length, 0);
  assert.equal(v.legacyWindow.length, 1);
  assert.deepEqual([v.legacyWindow[0].type, v.legacyWindow[0].id, v.legacyWindow[0].first.coordinate], ["way", 777, [27.5, 77.6]]);
  assert.equal(v.farReaching.length, 1);
  const text = formatValidation(v);
  assert.match(text, /way 777 \[power=line\] "Synthetic line": first such point #2 at 27\.5, 77\.6/);
  assert.match(text, /no malformed data\. The old check counted valid points of long features as INVALID, which was a validator fault/);
  const m = new Map(metrics(longWayData()));
  assert.equal(m.get("INVALID malformed coordinates"), 0);
  assert.equal(m.get("elements with a point outside 28-29 N, 77-78 E (legitimate if long)"), 1);
  assert.ok(![...m.keys()].includes("INVALID coordinates outside 28-29 N, 77-78 E"));
});

test("truly malformed coordinates are reported with type, id and value, and the source is left untouched", () => {
  const data = longWayData();
  data.ways.push({ id: 900, tags: { highway: "service" }, pts: [28.46, 77.51, null, 77.51, 28.47, 277.5] });
  data.nodes.push({ id: 901, tags: { amenity: "bank" }, lat: Number.NaN, lon: 77.5 });
  const before = JSON.stringify(data);
  const v = validateCoordinates(data);
  assert.deepEqual(v.malformed.map((m) => [m.type, m.id]), [["way", 900], ["way", 900], ["node", 901]]);
  assert.deepEqual(v.malformed[1].coordinate, [28.47, 277.5]);
  const { manifest, layers } = convert(data);
  assert.equal(JSON.stringify(data), before);
  assert.deepEqual(manifest.issues.malformedSkipped, ["way/900", "node/901"]);
  assert.ok(!layers.roads.some((r) => r.osm.id === 900));
  assert.match(formatValidation(v), /malformed values exist\. They are left in the extract and skipped/);
});

// ------------------------------------------------------------ pipeline

const region = proj.rect(BBOX);
const E = region.maxX; // east edge in metres
const pipelineData = () => ({
  bbox: BBOX, osmBase: "fixture", profile: "v2", extractedAt: "2026-01-01T00:00:00Z", endpoint: "test", query: "q",
  ways: [
    way(1, { highway: "primary", name: "Synthetic Road", lanes: "3", oneway: "yes" }, [[E - 200, 0], [E + 300, 0]]),
    way(2, { highway: "residential" }, [[0, 100], [300, 100]]),
    way(3, { highway: "footway" }, [[0, 120], [50, 120]]),
    way(4, { highway: "secondary", junction: "roundabout" }, box(-20, -20, 40, 40)),
    way(10, { building: "yes", "building:levels": "4" }, box(100, 200, 20, 20)),
    way(11, { building: "apartments", height: "45" }, box(E - 10, 300, 40, 20)),
    way(12, { building: "yes" }, [[0, 0], [5, 0], [5, 5]]),
    way(13, { building: "yes" }, box(E + 500, 0, 20, 20)),
    way(20, {}, [[400, 400], [500, 400], [500, 500]]),
    way(21, {}, [[500, 500], [400, 500], [400, 400]]),
    way(22, {}, box(430, 430, 40, 40)),
    way(23, { building: "university", name: "Old Style Block" }, box(600, 400, 60, 60)),
    way(24, {}, box(620, 420, 20, 20)),
    way(30, { landuse: "residential", name: "Alpha 1" }, box(50, 150, 800, 500)),
    way(31, { leisure: "park" }, box(E - 100, 1000, 400, 100)),
    way(40, { barrier: "wall" }, [[50, 150], [850, 150]]),
    way(50, { railway: "subway" }, [[-3000, -500], [3000, -500]]),
    way(51, { shop: "supermarket", building: "retail", name: "Synthetic Mart" }, box(200, 200, 30, 20)),
  ],
  nodes: [
    node(100, 60, 150, { barrier: "gate" }), node(101, 105, 200, { entrance: "main" }), node(102, 0, 30, { highway: "street_lamp" }),
    node(103, 210, 230, { shop: "bakery", name: "Synthetic Bakery" }), node(104, 0, -500, { railway: "station", name: "Synthetic Station" }),
    node(105, E + 50, 0, { shop: "outside" }), node(106, 300, 300, { amenity: "college", name: "Synthetic College" }),
  ],
  relations: [
    { id: 500, tags: { type: "multipolygon", building: "commercial", name: "Courtyard Block" }, clipped: false, members: [
      { type: "way", ref: 20, role: "outer", pts: [] }, { type: "way", ref: 21, role: "outer", pts: [] }, { type: "way", ref: 22, role: "inner", pts: [] } ] },
    { id: 501, tags: { type: "multipolygon" }, clipped: false, members: [{ type: "way", ref: 23, role: "outer", pts: [] }, { type: "way", ref: 24, role: "inner", pts: [] }] },
    { id: 502, tags: { type: "multipolygon", building: "yes" }, clipped: true, members: [{ type: "way", ref: 20, role: "outer", pts: [] }, { type: "way", ref: 9999, role: "outer", pts: [] }] },
  ],
});

test("pipeline: layers, provenance and attribution", () => {
  const { manifest, layers } = convert(pipelineData(), { builtAt: "t" });
  assert.deepEqual(Object.keys(layers), LAYER_NAMES);
  assert.match(manifest.attribution, /© OpenStreetMap contributors, ODbL 1\.0/);
  assert.equal(manifest.projection.name, "local-tangent-wgs84");
  assert.deepEqual(manifest.source, { file: null, profile: "v2", osmBase: "fixture", extractedAt: "2026-01-01T00:00:00Z", endpoint: "test", query: "q" });
  for (const name of LAYER_NAMES.filter((n) => n !== "coverage")) for (const f of layers[name]) {
    assert.match(f.id, /^(way|node|relation)\/\d+$/);
    assert.ok(f.tags && typeof f.osm.id === "number");
  }
  assert.ok(assertInside(layers, manifest.bounds));
});

test("pipeline: roads are clipped, keep continuity flags, and separate source from estimates", () => {
  const { layers } = convert(pipelineData());
  const main = layers.roads.find((r) => r.osm.id === 1);
  assert.equal(main.clipped, true);
  assert.deepEqual(main.continuesBeyondRegion, { start: false, end: true });
  assert.equal(main.geometry.points.at(-1)[0], E);
  assert.ok(Math.abs(main.derived.length - 200) < 0.1);
  assert.deepEqual([main.source.lanes, main.source.oneway, main.source.width], [3, true, null]);
  assert.deepEqual(main.estimated.width, { value: 10.5, basis: "lanes tag x 3.5 m" });
  const street = layers.roads.find((r) => r.osm.id === 2);
  assert.equal(street.source.lanes, null);
  assert.match(street.estimated.lanes.basis, /default for highway=residential/);
  assert.equal(layers.roads.find((r) => r.osm.id === 3).kind, "path");
  const rb = layers.roads.find((r) => r.osm.id === 4);
  assert.equal(rb.source.oneway, null);
  assert.equal(rb.estimated.oneway.value, true);
  assert.equal(rb.derived.closedLoop, true);
});

test("pipeline: building footprints, relation footprints and no duplicates", () => {
  const { manifest, layers } = convert(pipelineData());
  const ids = layers.buildings.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids.sort(), ["relation/500", "relation/501", "relation/502", "way/10", "way/11", "way/51"]);

  const rel = layers.buildings.find((b) => b.id === "relation/500");
  assert.equal(rel.tags.name, "Courtyard Block");
  assert.equal(rel.geometry.polygons[0].holes.length, 1);
  assert.ok(Math.abs(rel.derived.area - (10000 - 1600)) < 2);
  assert.deepEqual(rel.members, [{ way: 20, role: "outer" }, { way: 21, role: "outer" }, { way: 22, role: "inner" }]);
  assert.equal(rel.incomplete, false);

  // old-style relation: tags live on the outer way; the way must not also appear as a footprint
  const old = layers.buildings.find((b) => b.id === "relation/501");
  assert.equal(old.tags.building, "university");
  assert.equal(old.tagsFrom, "way/23");
  assert.equal(old.geometry.polygons[0].holes.length, 1);
  assert.ok(!ids.includes("way/23"));
  assert.deepEqual(manifest.issues.waysReplacedByRelation.first, [{ way: "way/23", relation: "relation/501" }]);

  // missing member: kept as the source lines only, flagged, with no area
  const broken = layers.buildings.find((b) => b.id === "relation/502");
  assert.equal(broken.incomplete, true);
  assert.equal(broken.geometry.type, "open-outline");
  assert.equal(broken.derived, null);
  assert.deepEqual(broken.missingMembers, [9999]);
  assert.equal(manifest.detail.buildings.openOutlineOnly, 1);

  assert.deepEqual(layers.buildings.find((b) => b.id === "way/10").estimated.height, { value: 12.8, basis: "building:levels x 3.2 m" });
  const tower = layers.buildings.find((b) => b.id === "way/11");
  assert.equal(tower.source.height, 45);
  assert.deepEqual(tower.estimated, {});
  assert.equal(tower.clipped, true);
  assert.ok(Math.abs(tower.derived.area - 10 * 20) < 0.5);
  assert.equal(layers.buildings.find((b) => b.id === "way/51").estimated.height.value, null);
  assert.deepEqual(manifest.issues.unclosedBuildings, { count: 1, first: ["way/12"] });
  assert.equal(manifest.issues.outsideRegion.ways, 1); // way 13
});

test("pipeline: areas, barriers, points and rail land in the right layers and nothing leaks", () => {
  const { manifest, layers } = convert(pipelineData());
  assert.deepEqual(layers.areas.map((a) => a.id).sort(), ["way/30", "way/31"]);
  const park = layers.areas.find((a) => a.id === "way/31");
  assert.equal(park.clipped, true);
  assert.ok(Math.abs(park.derived.area - 100 * 100) < 1);
  assert.deepEqual(layers.barriers.map((b) => b.id).sort(), ["node/100", "node/101", "way/40"]);
  assert.deepEqual(layers.furniture.map((f) => f.id), ["node/102"]);
  assert.deepEqual(layers.rail.map((r) => r.id).sort(), ["node/104", "way/50"]);
  const rail = layers.rail.find((r) => r.id === "way/50");
  assert.deepEqual(rail.geometry.points.map((p) => p[0]), [region.minX, region.maxX]);
  assert.deepEqual(layers.pois.map((p) => p.id).sort(), ["node/103", "node/106", "way/51"]);
  assert.equal(layers.pois.find((p) => p.id === "way/51").commercial, true);
  assert.equal(layers.pois.find((p) => p.id === "node/106").commercial, false);
  assert.equal(manifest.issues.outsideRegion.nodes, 1); // node 105
  const statuses = new Set(layers.coverage.map((c) => c.status));
  assert.ok(statuses.has("nothing-mapped") && statuses.has("sparse"));
  assert.equal(layers.coverage.length, Math.ceil((region.maxX - region.minX) / 250) * Math.ceil((region.maxZ - region.minZ) / 250));
});

test("assertInside rejects geometry outside the region", () => {
  const { manifest, layers } = convert(pipelineData());
  layers.roads[0].geometry.points.push([manifest.bounds.maxX + 5, 0]);
  assert.throws(() => assertInside(layers, manifest.bounds), /leaks outside the region/);
});

test("a smaller region can be cut from the same extract", () => {
  const { manifest, layers } = convert(pipelineData(), { bbox: [28.463, 77.509, 28.468, 77.514] });
  assert.ok(manifest.bounds.maxX - manifest.bounds.minX < 500);
  assert.ok(assertInside(layers, manifest.bounds));
  assert.ok(!layers.buildings.some((b) => b.id === "relation/500"));
});

test("coverage view contains every layer, the attribution and no invented shapes", () => {
  const { manifest, layers } = convert(pipelineData());
  const html = renderCoverage(manifest, layers);
  for (const id of ["coverage", "areas", "sectors", "rail", "roads", "buildings", "relations", "barriers", "gates", "pois", "furniture"]) assert.ok(html.includes(`id="layer-${id}"`), id);
  assert.match(html, /© OpenStreetMap contributors, ODbL 1\.0/);
  assert.match(html, />Alpha 1<\/text>/);
  assert.match(html, /relation\/502[^<]*INCOMPLETE/);
  const footprints = html.split('id="layer-buildings"')[1].split("</g>")[0].match(/<path /g).length;
  assert.equal(footprints, layers.buildings.filter((b) => b.osm.type === "way").length);
});
