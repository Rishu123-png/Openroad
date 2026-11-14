// All data in this file is SYNTHETIC (tools/fixtures/synthetic-extract.mjs).
// These tests prove the rules and the code paths; they say nothing about the real map.
import assert from "node:assert/strict";
import { test } from "node:test";
import { convert } from "./build-layers.mjs";
import { buildDistrict, DistrictError, findSpawn, SECTORS } from "./build-district.mjs";
import { buildingHeight, classifyBuilding, ESTIMATED_HEIGHTS, LEVEL_HEIGHT } from "./district/classify.mjs";
import { syntheticExtract } from "./fixtures/synthetic-extract.mjs";
import { pointInRing, ringArea } from "./geo/clip.mjs";

const build = (options = {}) => { const { manifest, layers } = convert(syntheticExtract(), {}); return { district: buildDistrict(manifest, layers, { builtAt: "t", ...options }), layers, manifest }; };

test("classification follows the documented tag rules", () => {
  const c = (tags) => classifyBuilding(tags).category;
  assert.equal(c({ building: "yes" }), "unclassified");
  assert.equal(c({ building: "yes", "building:levels": "12" }), "unclassified", "tall building=yes is still not called apartments");
  assert.equal(c({ building: "house" }), "house");
  assert.equal(c({ building: "residential" }), "house");
  assert.equal(c({ building: "residential", "building:levels": "7" }), "apartments");
  assert.equal(c({ building: "apartments" }), "apartments");
  assert.equal(c({ building: "retail" }), "commercial");
  assert.equal(c({ building: "yes", shop: "bakery" }), "commercial");
  assert.equal(c({ building: "school" }), "institutional");
  assert.equal(c({ building: "yes", amenity: "place_of_worship" }), "institutional");
  assert.equal(c({ building: "warehouse" }), "industrial");
  assert.equal(c({ building: "yes", amenity: "hospital" }), "healthcare");
  assert.equal(c({ building: "apartments", amenity: "clinic" }), "healthcare", "healthcare evidence wins");
  assert.equal(c({ building: "garage" }), "other");
  assert.match(classifyBuilding({ building: "yes", shop: "bakery" }).rule, /shop=bakery/);
  assert.deepEqual(classifyBuilding({ building: "yes" }), classifyBuilding({ building: "yes" }), "deterministic");
});

test("height: source height, then levels, then a labelled estimate", () => {
  assert.deepEqual(buildingHeight("way/1", { height: "21" }, "commercial", 900), { height: 21, heightStatus: "source-height", heightBasis: "height=21", levels: null });
  const lv = buildingHeight("way/1", { "building:levels": "3" }, "house", 200);
  assert.equal(lv.heightStatus, "source-levels");
  assert.equal(lv.height, Math.round(3 * LEVEL_HEIGHT * 10) / 10);
  const est = buildingHeight("way/1", {}, "house", 200);
  assert.equal(est.heightStatus, "estimated");
  assert.ok(Math.abs(est.height - ESTIMATED_HEIGHTS.house) <= ESTIMATED_HEIGHTS.house * ESTIMATED_HEIGHTS.variation + 0.05);
  assert.deepEqual(est, buildingHeight("way/1", {}, "house", 200), "same id gives the same estimate");
  assert.equal(buildingHeight("way/1", {}, "unclassified", 12).height, ESTIMATED_HEIGHTS.smallFootprintHeight);
  assert.equal(buildingHeight("way/1", { height: "abc" }, "house", 200).heightStatus, "estimated", "unreadable height is not used");
  assert.equal(buildingHeight("way/1", {}, "house", 200, { ...ESTIMATED_HEIGHTS, house: 20, variation: 0 }).height, 20, "defaults are configurable");
});

test("the sector is found by name and the district is the sector plus the buffer", () => {
  const { district } = build({ buffer: 100 });
  assert.equal(district.sector.id, "way/1");
  assert.equal(district.synthetic, true);
  assert.deepEqual(district.bounds, { minX: 100, maxX: 900, minZ: 200, maxZ: 880 });
  assert.equal(district.projection.origin.lat, 28.46526);
});

test("a missing sector stops the build and names the limitation", () => {
  const { manifest, layers } = convert(syntheticExtract(), {});
  layers.areas = layers.areas.filter((a) => a.tags.name !== "Alpha 1");
  assert.throws(() => buildDistrict(manifest, layers), (e) => e instanceof DistrictError && /No area named "Alpha 1"/.test(e.message));
  assert.ok(SECTORS["alpha-1"].pattern.test("Alpha-I") && !SECTORS["alpha-1"].pattern.test("Alpha 2") && !SECTORS["alpha-1"].pattern.test("Alpha 1 Commercial Belt"));
});

test("every feature lies inside the district bounds", () => {
  const { district: d } = build();
  const ok = ([x, z]) => x >= d.bounds.minX - 0.01 && x <= d.bounds.maxX + 0.01 && z >= d.bounds.minZ - 0.01 && z <= d.bounds.maxZ + 0.01;
  for (const b of d.buildings) for (const p of b.polygons) assert.ok(p.outer.every(ok), b.id);
  for (const r of d.roads) assert.ok(r.points.every(ok), r.id);
  for (const l of d.rail.lines) assert.ok(l.points.every(ok));
  for (const f of d.furniture) assert.ok(ok(f.point));
  assert.ok(d.roads.some((r) => r.continuesBeyond.start && r.continuesBeyond.end), "avenues are cut at the district edge and flagged");
});

test("footprints are preserved exactly, with id, tags and provenance", () => {
  const { district: d, layers } = build();
  for (const b of d.buildings) {
    const src = layers.buildings.find((f) => f.id === b.id);
    assert.deepEqual(b.polygons, src.geometry.polygons.map((p) => ({ outer: p.outer, holes: p.holes })), b.id);
    assert.deepEqual(b.tags, src.tags);
    assert.ok(b.categoryRule && b.heightBasis && ["source-height", "source-levels", "estimated"].includes(b.heightStatus));
  }
  const L = d.buildings.find((b) => b.polygons[0].outer.length === 7);
  assert.ok(L, "the L-shaped footprint keeps its seven points");
  assert.ok(Math.abs(ringArea(L.polygons[0].outer) - (40 * 14 + 15 * 22)) < 3);
});

test("relation footprints keep their courtyard and replace the tagged outer way", () => {
  const { district: d } = build();
  const rel = d.buildings.filter((b) => b.fromRelation);
  assert.equal(rel.length, 1);
  assert.equal(rel[0].polygons[0].holes.length, 1);
  assert.equal(rel[0].category, "apartments");
  assert.equal(rel[0].heightStatus, "source-levels");
  assert.ok(Math.abs(rel[0].area - (60 * 44 - 24 * 16)) < 5);
  const ids = d.buildings.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length, "no building id twice");
  const centre = rel[0].centre;
  assert.equal(d.buildings.filter((b) => b.polygons.some((p) => pointInRing([centre[0] - 25, centre[1]], p.outer))).length, 1, "one footprint at the relation's position");
});

test("unclosed outlines are reported and not built", () => {
  const { district: d } = build();
  assert.equal(d.stats.buildings.unclosedWaysInRegion, 1);
  assert.equal(d.stats.buildings.total, 167);
  assert.equal(d.stats.roads.notBuiltSkipped, 1);
});

test("roads keep class and width provenance; junctions come from shared points", () => {
  const { district: d } = build();
  const status = (cls) => [...new Set(d.roads.filter((r) => r.class === cls).map((r) => r.widthStatus))];
  assert.deepEqual(status("tertiary"), ["source-width"]);
  assert.deepEqual(status("secondary"), ["source-lanes"]);
  assert.deepEqual(status("residential"), ["estimated"]);
  assert.equal(d.roads.find((r) => r.class === "tertiary").width, 9);
  assert.equal(d.stats.junctions.intersections, 25);
  assert.equal(d.junctions.filter((j) => j.arms === 4).length, 13);
  assert.equal(d.junctions.filter((j) => j.arms === 3).length, 12);
  assert.equal(d.roads.filter((r) => r.kind === "path").length, 1);
  assert.equal(d.rail.lines[0].elevated, true);
});

test("the spawn point is on a road, inside the sector and clear of buildings", () => {
  const { district: d } = build();
  const s = d.spawn;
  assert.ok(s.x > d.bounds.minX && s.x < d.bounds.maxX && s.z > d.bounds.minZ && s.z < d.bounds.maxZ);
  assert.ok(d.sector.polygons.some((p) => pointInRing([s.x, s.z], p.outer)));
  assert.ok(!d.buildings.some((b) => b.polygons.some((p) => pointInRing([s.x, s.z], p.outer))));
  const road = d.roads.find((r) => r.id === s.road);
  assert.ok(road.points.some((p, i) => i > 0 && Math.abs((p[0] + road.points[i - 1][0]) / 2 - s.x) < 0.01 && Math.abs((p[1] + road.points[i - 1][1]) / 2 - s.z) < 0.01));
  // A building dropped onto the best segment moves the spawn elsewhere.
  const blocker = { centre: [s.x, s.z], polygons: [{ outer: [[s.x - 5, s.z - 5], [s.x + 5, s.z - 5], [s.x + 5, s.z + 5], [s.x - 5, s.z + 5], [s.x - 5, s.z - 5]], holes: [] }] };
  const moved = findSpawn(d.roads, [...d.buildings, blocker], d.bounds, () => true, [s.x, s.z]);
  assert.ok(Math.hypot(moved.x - s.x, moved.z - s.z) > 8);
  assert.throws(() => findSpawn([], d.buildings, d.bounds, () => true, [0, 0]), DistrictError);
});

// ---- evidence from surroundings (M004)
test("a category is inferred only from a point of interest inside the footprint or an education area around it", async () => {
  const { inferCategory, poiCategory } = await import("./district/classify.mjs");
  assert.deepEqual(poiCategory({ amenity: "bank", name: "A Bank" }), { category: "commercial", tag: "amenity=bank" });
  assert.deepEqual(poiCategory({ shop: "bakery" }), { category: "commercial", tag: "shop=bakery" });
  assert.deepEqual(poiCategory({ amenity: "hospital" }), { category: "healthcare", tag: "amenity=hospital" });
  assert.deepEqual(poiCategory({ amenity: "school" }), { category: "institutional", tag: "amenity=school" });
  assert.equal(poiCategory({ name: "Somewhere" }), null, "a name alone states no use");
  assert.equal(poiCategory({ amenity: "bench" }), null);
  assert.equal(poiCategory({ place: "square", name: "A Chowk" }), null);

  const bank = inferCategory([{ id: "node/1", tags: { amenity: "bank" } }], []);
  assert.equal(bank.category, "commercial");
  assert.match(bank.rule, /^inferred: point of interest node\/1 \(amenity=bank\) lies inside the footprint$/);
  assert.deepEqual(bank.evidence, ["node/1"]);
  assert.equal(inferCategory([{ id: "node/1", tags: { amenity: "bank" } }, { id: "node/2", tags: { amenity: "clinic" } }], []), null, "conflicting uses: nothing is inferred");
  const school = inferCategory([], [{ id: "way/9", tags: { landuse: "school" } }]);
  assert.equal(school.category, "institutional");
  assert.match(school.rule, /^inferred: centre lies inside landuse=school area way\/9$/);
  // Residential land use is context and never a category; neither is an unnamed, unrecognised point.
  assert.equal(inferCategory([], [{ id: "way/8", tags: { landuse: "residential" } }]), null);
  assert.equal(inferCategory([{ id: "node/3", tags: { name: "Somewhere" } }], [{ id: "way/8", tags: { landuse: "residential" } }]), null);
});

test("buildings of unknown use get a labelled generic height that depends on the id, never a category", async () => {
  const { genericHeight, GENERIC_HEIGHT_BANDS } = await import("./district/classify.mjs");
  for (const area of [45, 120, 400, 900, 5000]) {
    const band = GENERIC_HEIGHT_BANDS.find((b) => area < b.below);
    const seen = new Set();
    for (let i = 0; i < 200; i++) {
      const h = genericHeight(`way/${i}`, area);
      assert.equal(h.heightStatus, "estimated");
      assert.equal(h.levels, null, "no floor count is invented");
      assert.match(h.heightBasis, /generic low-rise estimate.*not measured/);
      assert.ok(band.heights.includes(h.height));
      assert.deepEqual(genericHeight(`way/${i}`, area), h, "the same id always gives the same height");
      seen.add(h.height);
    }
    assert.equal(seen.size, new Set(band.heights).size, "heights vary between buildings");
  }
  assert.equal(genericHeight("way/1", 12).height, ESTIMATED_HEIGHTS.smallFootprintHeight);
});

test("the district records category status, context and evidence for every building", () => {
  const { district } = build();
  const residentialContext = district.buildings.filter((b) => b.context.landuse === "residential");
  assert.ok(residentialContext.length > 100);
  for (const b of district.buildings) {
    assert.ok(["source", "inferred", "none"].includes(b.categoryStatus));
    assert.equal(b.categoryStatus === "none", b.category === "unclassified");
    assert.ok(Array.isArray(b.evidence));
    if (b.categoryStatus === "inferred") assert.match(b.categoryRule, /^inferred: /);
    if (b.category === "unclassified" && b.heightStatus === "estimated") assert.match(b.heightBasis, /generic low-rise estimate|footprint under/);
  }
  // Standing in a residential area does not classify a building: the unknown ones stay unknown.
  const unknown = residentialContext.filter((b) => b.tags.building === "yes" && !b.tags.amenity && !b.tags.shop);
  assert.ok(unknown.length > 20);
  assert.ok(unknown.every((b) => b.category === "unclassified" || b.categoryStatus === "inferred"));
  assert.ok(unknown.filter((b) => b.category === "unclassified").length > 20);
  const s = district.stats.buildings.byCategoryStatus;
  assert.equal(s.source + s.inferred + s.none, district.buildings.length);
  // Footprints and source heights are untouched by the evidence pass.
  const plain = buildDistrict(build().manifest, build().layers, { builtAt: "t" });
  assert.deepEqual(plain.buildings.map((b) => b.polygons), district.buildings.map((b) => b.polygons));
  for (const b of district.buildings) if (b.heightStatus !== "estimated") assert.ok(/^(height|building:levels)=/.test(b.heightBasis));
});

test("a building of unknown use with a shop point inside it is inferred commercial, with the rule recorded", () => {
  const { manifest, layers } = convert(syntheticExtract(), {});
  const target = layers.buildings.find((b) => b.geometry.type === "polygons" && b.tags.building === "yes" && !b.tags.amenity && !b.tags.shop && b.derived?.centre);
  assert.ok(target, "the synthetic extract has a plain building");
  const pt = target.derived.centre;
  layers.pois.push({ id: "node/999001", osm: { type: "node", id: 999001 }, tags: { shop: "bakery", name: "Test Bakery" }, geometry: { type: "point", point: pt }, source: { name: "Test Bakery", kind: "bakery" } });
  const district = buildDistrict(manifest, layers, { builtAt: "t" });
  const b = district.buildings.find((x) => x.id === target.id);
  if (b.evidence.length) {
    assert.equal(b.category, "commercial");
    assert.equal(b.categoryStatus, "inferred");
    assert.ok(b.evidence.includes("node/999001"));
    assert.equal(b.tags.building, "yes", "the source tags are not rewritten");
  } else assert.fail(`the point at ${pt} was not found inside ${target.id}`);
});
