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
