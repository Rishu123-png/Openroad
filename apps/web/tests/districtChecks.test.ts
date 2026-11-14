import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseDistrict } from "../src/game/district/loadDistrict";
import { spawnProblem } from "../src/game/district/spawn";
import type { DistrictData, Point } from "../src/game/district/types";
import { TRAFFIC } from "../src/game/traffic/TrafficModel";
import { testDistrict } from "./fixtures/district";
import { checkDistrict, polygonProblems, ringProblems } from "./support/districtChecks";
import { metadataProblems, nonFiniteValues, sectorProblems, trafficReport } from "./support/districtFile";
import { nullEngine } from "./support/harness";

/**
 * The district checks are what the real-data suite relies on, and that suite
 * cannot run where the real file is absent. So the checks are tested here:
 * they must pass sound data and must catch each fault they claim to catch.
 * Everything in this file is SYNTHETIC.
 */
const kinds = (problems: string[]): string[] => [...new Set(problems.map((p) => p.split(":")[0]!))].sort();
const broken = (change: (d: DistrictData) => void): string[] => {
  const d = structuredClone(testDistrict());
  change(d);
  return kinds(checkDistrict(d));
};
const square = (x: number, z: number, s: number): Point[] => [[x, z], [x + s, z], [x + s, z + s], [x, z + s], [x, z]];

describe("district checks on hand-written fixtures", () => {
  it("pass the sound fixture", () => {
    expect(checkDistrict(testDistrict())).toEqual([]);
  });

  it("catch faulty outlines: open, flat, self-crossing, too few points, non-finite", () => {
    expect(ringProblems(square(0, 0, 10), "r")).toEqual([]);
    expect(ringProblems(square(0, 0, 10).slice(0, 4), "r").join()).toMatch(/not closed/);
    expect(ringProblems([[0, 0], [5, 0], [10, 0], [0, 0]], "r").join()).toMatch(/no area/);
    expect(ringProblems([[0, 0], [10, 10], [10, 0], [0, 10], [0, 0]], "r").join()).toMatch(/crosses itself/); // a bow tie
    expect(ringProblems([[0, 0], [1, 1], [0, 0]], "r").join()).toMatch(/fewer than/);
    expect(ringProblems([[0, 0], [10, 0], [10, Number.NaN], [0, 10], [0, 0]], "r").join()).toMatch(/not a finite/);
  });

  it("catch faulty courtyards: outside the outline, or swallowing the whole footprint", () => {
    expect(polygonProblems({ outer: square(0, 0, 20), holes: [square(5, 5, 8)] }, "b")).toEqual([]);
    expect(polygonProblems({ outer: square(0, 0, 20), holes: [square(15, 15, 8)] }, "b").join()).toMatch(/corners lie outside/);
    expect(polygonProblems({ outer: square(0, 0, 20), holes: [square(40, 40, 5)] }, "b").join()).toMatch(/5 corners lie outside/) // the closing point is counted;
    expect(polygonProblems({ outer: square(0, 0, 20), holes: [square(0, 0, 20)] }, "b").join()).toMatch(/cover the whole footprint/);
    // A courtyard touching the outer wall is still valid.
    expect(polygonProblems({ outer: square(0, 0, 20), holes: [square(0, 5, 8)] }, "b")).toEqual([]);
  });

  it("catch each building fault by name", () => {
    expect(broken((d) => d.buildings.push(structuredClone(d.buildings[0]!)))).toEqual(["duplicate-building"]);
    expect(broken((d) => void (d.buildings[0]!.osm.id = 999))).toEqual(["building-id"]);
    expect(broken((d) => void (d.buildings[2]!.fromRelation = false))).toEqual(["building-relation-flag"]);
    expect(broken((d) => void (d.buildings[0]!.height = Number.NaN))).toEqual(["building-height"]);
    expect(broken((d) => void (d.buildings[0]!.height = -3))).toEqual(["building-height"]);
    expect(broken((d) => void ((d.buildings[0]!.heightStatus as string) = "guessed"))).toEqual(["building-height-status"]);
    expect(broken((d) => void (d.buildings[0]!.area = 0))).toEqual(["building-area"]);
    expect(broken((d) => void (d.buildings[0]!.polygons = []))).toEqual(["building-geometry"]);
    expect(broken((d) => void (d.buildings[0]!.polygons[0]!.outer = square(140, 140, 30)))).toEqual(["building-outside"]);
    expect(broken((d) => void (d.buildings[0]!.polygons[0]!.outer[1] = [Number.POSITIVE_INFINITY, 0]))).toContain("building-geometry");
  });

  it("catch a multipolygon's outer way built a second time as a building of its own", () => {
    const problems = (() => {
      const d = structuredClone(testDistrict());
      const relation = d.buildings[2]!;
      d.buildings.push({ ...structuredClone(relation), id: "way/77", osm: { type: "way", id: 77 }, fromRelation: false, polygons: [{ outer: structuredClone(relation.polygons[0]!.outer), holes: [] }] });
      return checkDistrict(d);
    })();
    expect(problems).toEqual(["relation-duplicated: relation/12 is also built as way/77"]);
    // A different building that merely stands beside the relation is not a duplicate.
    expect(broken((d) => d.buildings.push({ ...structuredClone(d.buildings[0]!), id: "way/78", osm: { type: "way", id: 78 }, polygons: [{ outer: square(-80, 70, 20), holes: [] }], centre: [-70, 80] }))).toEqual([]);
  });

  it("catch each road, junction and spawn fault by name", () => {
    expect(broken((d) => void (d.roads[0]!.points = [[0, 0]]))).toEqual(["road-geometry"]);
    expect(broken((d) => void (d.roads[0]!.points[0] = [Number.NaN, 0]))).toContain("road-geometry");
    expect(broken((d) => void (d.roads[0]!.points[0] = [-400, 0]))).toEqual(["road-length", "road-outside"]);
    expect(broken((d) => void (d.roads[0]!.width = 0))).toEqual(["road-width"]);
    expect(broken((d) => void (d.roads[0]!.width = 500))).toEqual(["road-width"]);
    expect(broken((d) => void ((d.roads[0]!.widthStatus as string) = "measured"))).toEqual(["road-width-status"]);
    expect(broken((d) => void (d.roads[0]!.length = 5))).toEqual(["road-length"]);
    expect(broken((d) => void (d.junctions[0]!.roads = ["way/20", "way/404"]))).toEqual(["junction"]);
    expect(broken((d) => void (d.junctions[0]!.point = [33, 33]))).toEqual(["junction"]); // not on its roads
    expect(broken((d) => void (d.junctions[0]!.radius = 0))).toEqual(["junction"]);
    expect(broken((d) => void (d.spawn = { ...d.spawn, x: 35, z: -40 }))).toEqual(["spawn"]); // inside the house
    expect(broken((d) => void (d.spawn = { ...d.spawn, x: 12, z: -40 }))).toEqual(["spawn"]); // on the verge, off the carriageway
    expect(broken((d) => void (d.spawn = { ...d.spawn, road: "way/22" }))).toEqual(["spawn"]); // a footway
    expect(broken((d) => void (d.spawn = { ...d.spawn, x: Number.NaN }))).toEqual(["spawn"]);
    expect(broken((d) => void (d.spawn = { ...d.spawn, z: 400 }))).toEqual(["spawn"]);
  });

  it("catch anything that escapes the region, and a broken sector", () => {
    expect(broken((d) => void (d.furniture[0]!.point = [900, 0]))).toEqual(["point-outside"]);
    expect(broken((d) => void (d.barriers.lines[0]!.points[1] = [151, -80]))).toEqual(["line-outside"]);
    expect(broken((d) => void (d.areas[0]!.polygons[0]!.outer[0] = [-200, -200]))).toEqual(["area-outside"]);
    expect(broken((d) => void (d.sector.polygons = []))).toEqual(["sector"]);
    expect(broken((d) => void (d.sector.polygons[0]!.outer = square(100, 100, 200)))).toEqual(["sector"]);
    expect(broken((d) => void (d.bounds.maxX = d.bounds.minX))).toEqual(["bounds"]);
    // Rounding at the edge is allowed; a real excursion is not.
    expect(broken((d) => void (d.furniture[0]!.point = [150.04, 0]))).toEqual([]);
    expect(broken((d) => void (d.furniture[0]!.point = [150.2, 0]))).toEqual(["point-outside"]);
  });

  it("summarise repeated faults rather than list thousands", () => {
    const d = structuredClone(testDistrict());
    for (let i = 0; i < 50; i++) d.furniture.push({ ...d.furniture[0]!, id: `node/${900 + i}`, point: [999, 999] });
    const problems = checkDistrict(d, { limit: 3 });
    expect(problems).toHaveLength(4);
    expect(problems[3]).toBe("point-outside: and 47 more");
  });

  it("find lost numbers anywhere in a file, including NaN written to JSON as null", () => {
    expect(nonFiniteValues(testDistrict())).toEqual([]);
    expect(nonFiniteValues({ a: { b: [1, Number.NaN] }, c: Number.POSITIVE_INFINITY })).toEqual(["a.b[1]", "c"]);
    expect(nonFiniteValues(JSON.parse(JSON.stringify({ roads: [{ points: [[1, Number.NaN]] }], name: null })))).toEqual(["roads[0].points[0][1] (null in a list of numbers)"]);
  });
});

/**
 * The district file as the pipeline writes it, from the tool's SYNTHETIC
 * extract. This exercises the same checks the real-data suite uses, on a file
 * of the same format. It says nothing about the real Alpha 1 data.
 */
describe("district file written by tools/build-district.mjs --synthetic (SYNTHETIC, not Alpha 1 data)", () => {
  let dir: string, raw: unknown, district: DistrictData;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "openroad-district-"));
    const out = join(dir, "synthetic.json");
    const run = spawnSync(process.execPath, [resolve(import.meta.dirname, "../../../tools/build-district.mjs"), "--synthetic", "--out", out], { encoding: "utf8" });
    if (run.status !== 0) throw new Error(`build-district failed: ${run.stderr || run.stdout}`);
    raw = JSON.parse(readFileSync(out, "utf8"));
    district = parseDistrict(raw);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("passes every structural check the real suite applies", () => {
    expect(district.buildings.length).toBeGreaterThan(100);
    expect(checkDistrict(district)).toEqual([]);
    expect(nonFiniteValues(raw)).toEqual([]);
    expect(sectorProblems(district)).toEqual([]);
    expect(spawnProblem(district)).toBeNull();
    // It includes the cases the checks exist for.
    expect(district.buildings.some((b) => b.fromRelation && b.polygons.some((p) => p.holes.length > 0))).toBe(true);
  });

  it("is labelled synthetic, and can never be accepted as the real district", () => {
    expect(district.synthetic).toBe(true);
    expect(metadataProblems(raw, { real: false })).toEqual([]);
    const asReal = metadataProblems(raw, { real: true });
    expect(asReal).toContain("the file is SYNTHETIC test data, not the real district");
    expect(asReal.join()).toMatch(/source\.file is missing/);
    expect(asReal.join()).toMatch(/source\.osmBase is missing/);
  });

  it("rejects a file for another place, or one that has lost its credit or its sector name", () => {
    const change = (f: (d: Record<string, any>) => void): string => {
      const copy = structuredClone(raw) as Record<string, any>;
      f(copy);
      return metadataProblems(copy, { real: false }).join("; ");
    };
    expect(change((d) => void (d.name = "Beta 2"))).toMatch(/name is Beta 2/);
    expect(change((d) => void (d.sector.tags.name = "Gamma 1"))).toMatch(/not Alpha 1/);
    expect(change((d) => void (d.projection.origin = { lat: 19.07, lon: 72.87 }))).toMatch(/not in Greater Noida/);
    expect(change((d) => void (d.attribution = "map data"))).toMatch(/does not credit OpenStreetMap/);
    expect(change((d) => void (d.sector.osm = { type: "node", id: 0 }))).toMatch(/no OpenStreetMap way or relation id/);
    expect(change((d) => void (d.synthetic = false))).toMatch(/disagrees with the source record/);
    expect(change((d) => void (d.formatVersion = 2))).toMatch(/not a version 1/);
  });

  it("carries the most traffic allowed for a minute: every car on a carriageway, out of buildings, inside the district", () => {
    const engine = nullEngine();
    try {
      const report = trafficReport(engine, district, 60);
      expect(report.problems).toEqual([]);
      expect(report.placed).toBe(TRAFFIC.maxCount);
      expect(report.moved).toBeGreaterThan(TRAFFIC.maxCount / 2);
    } finally {
      engine.dispose();
    }
  });

  it("reports no traffic where there is nowhere to put it, rather than forcing cars onto the map", () => {
    const d = structuredClone(district);
    // Only a 40 m stub of the spawn road is left: every point of it is nearer the player than traffic may appear.
    const stub = d.roads.find((r) => r.id === d.spawn.road)!;
    stub.points = [[d.spawn.x, d.spawn.z - 20], [d.spawn.x, d.spawn.z + 20]];
    stub.length = 40;
    d.roads = [stub];
    d.junctions = [];
    expect(checkDistrict(d)).toEqual([]);
    const engine = nullEngine();
    try {
      const report = trafficReport(engine, d, 10);
      expect(report.placed).toBe(0);
      expect(report.moved).toBe(0);
      expect(report.problems).toEqual([]);
    } finally {
      engine.dispose();
    }
  });
});
