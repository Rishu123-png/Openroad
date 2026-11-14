import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDistrict } from "../../src/game/district/loadDistrict";
import { spawnProblem } from "../../src/game/district/spawn";
import type { DistrictData } from "../../src/game/district/types";
import { TRAFFIC } from "../../src/game/traffic/TrafficModel";
import { checkDistrict, polygonProblems } from "../support/districtChecks";
import { nullEngine } from "../support/harness";
import { metadataProblems, nonFiniteValues, sectorProblems, trafficReport } from "../support/districtFile";

/**
 * REAL DATA integration tests for the Alpha 1 district.
 *
 *   npm run test:real
 *
 * They read the district file built on this machine from the OpenStreetMap
 * extract. That file is git-ignored and is not part of the repository, so on
 * a machine without it (CI, a fresh clone) every test here is SKIPPED and the
 * run says so. Nothing is substituted: a synthetic file in its place FAILS.
 *
 * Build the file with:  node tools/build-layers.mjs && node tools/build-district.mjs
 * Another location:     OPENROAD_DISTRICT=/path/to/alpha-1.json npm run test:real
 */
const FILE = resolve(process.env.OPENROAD_DISTRICT ?? resolve(import.meta.dirname, "../../public/regions/greater-noida/alpha-1.json"));
const present = existsSync(FILE);

if (!present) {
  console.log(
    [
      "",
      "================================================================================",
      " REAL ALPHA 1 TESTS: SKIPPED",
      ` The district file was not found at:`,
      `   ${FILE}`,
      " It is built locally from the OpenStreetMap extract and is git-ignored, so it is",
      " not available here. No real-data check ran and none is reported as passed.",
      " To run them: node tools/build-layers.mjs && node tools/build-district.mjs",
      "================================================================================",
      "",
    ].join("\n"),
  );
}

describe.skipIf(!present)("real Alpha 1 district file", () => {
  let raw: unknown;
  let district: DistrictData;
  const load = (): DistrictData => {
    if (!district) {
      raw = JSON.parse(readFileSync(FILE, "utf8"));
      district = parseDistrict(raw);
      const d = district, stats = (raw as { stats?: unknown }).stats;
      console.log(
        [
          "",
          "================================================================================",
          d.synthetic ? " REAL ALPHA 1 TESTS: the file at the real path is flagged SYNTHETIC. This run will FAIL and proves nothing about Alpha 1." : " REAL ALPHA 1 TESTS: RUNNING on real data",
          `   file        ${FILE} (${(statSync(FILE).size / 1e6).toFixed(2)} MB)`,
          `   source      ${JSON.stringify((raw as { source?: unknown }).source)}`,
          `   sector      ${d.sector.id} ${JSON.stringify(d.sector.tags)}`,
          `   bounds      ${JSON.stringify(d.bounds)}`,
          `   contents    ${d.buildings.length} buildings (${d.buildings.filter((b) => b.fromRelation).length} from relations, ${d.buildings.filter((b) => b.polygons.some((p) => p.holes.length)).length} with courtyards), ${d.roads.filter((r) => r.kind === "road").length} roads, ${d.roads.filter((r) => r.kind === "path").length} paths, ${d.junctions.length} junctions`,
          `   stats       ${JSON.stringify(stats)?.slice(0, 600)}`,
          "================================================================================",
          "",
        ].join("\n"),
      );
    }
    return district;
  };

  it("is the Alpha 1 district of Greater Noida, built from a recorded OpenStreetMap extract, not synthetic data", () => {
    load();
    expect(metadataProblems(raw, { real: true })).toEqual([]);
    expect(district.synthetic).toBe(false);
  });

  it("is cut around the mapped Alpha 1 sector, with a valid outline and buildings inside it", () => {
    const d = load();
    expect(d.sector.polygons.length).toBeGreaterThan(0);
    expect(d.sector.polygons.flatMap((p, i) => polygonProblems(p, `sector part ${i}`))).toEqual([]);
    expect(sectorProblems(d)).toEqual([]);
    // A residential sector of a planned city: between 5 hectares and 5 square kilometres. Outside that, the wrong object was picked.
    const area = d.sector.polygons.reduce((sum, p) => {
      let a = 0;
      for (let i = 0, j = p.outer.length - 1; i < p.outer.length; j = i++) a += p.outer[j]![0] * p.outer[i]![1] - p.outer[i]![0] * p.outer[j]![1];
      return sum + Math.abs(a / 2);
    }, 0);
    expect(area).toBeGreaterThan(50_000);
    expect(area).toBeLessThan(5_000_000);
  });

  it("holds only finite numbers", () => {
    load();
    expect(nonFiniteValues(raw)).toEqual([]);
  });

  it("has sound geometry: closed building outlines, valid courtyards, no duplicate ids, no relation also built as a way, roads with valid ends, nothing outside the region", () => {
    const d = load();
    expect(d.buildings.length).toBeGreaterThan(0);
    expect(d.roads.filter((r) => r.kind === "road").length).toBeGreaterThan(0);
    expect(checkDistrict(d, { limit: 10 })).toEqual([]);
    expect(new Set(d.buildings.map((b) => b.id)).size).toBe(d.buildings.length);
  });

  it("starts the player on a drivable road, outside every building", () => {
    const d = load();
    expect(spawnProblem(d)).toBeNull();
    const road = d.roads.find((r) => r.id === d.spawn.road);
    expect(road?.kind).toBe("road");
    expect(d.buildings.filter((b) => Math.hypot(b.centre[0] - d.spawn.x, b.centre[1] - d.spawn.z) < 200).length, "buildings within 200 m of the start").toBeGreaterThan(0);
  });

  it("builds in the game and carries the most traffic allowed on its real roads for a minute", () => {
    const d = load();
    const engine = nullEngine();
    try {
      const t0 = performance.now();
      const report = trafficReport(engine, d, 60);
      console.log(
        [
          "",
          ` REAL DATA traffic: ${report.placed} of ${TRAFFIC.maxCount} cars placed on ${report.usableRoads} usable roads; ${report.travelled} drove more than 10 m in 60 s of game time (${report.moved} ended more than 10 m from where they started); built and ran in ${((performance.now() - t0) / 1000).toFixed(1)} s`,
          ...report.lines.map((l) => ` REAL DATA ${l}`),
          "",
        ].join("\n"),
      );
      expect(report.problems).toEqual([]);
      expect(report.vehiclesInBuildings, "vehicles whose centre or body entered a building").toEqual([]);
      expect(report.vehiclesOutside, "vehicles whose centre or body left the district").toEqual([]);
      expect(report.vehiclesInCollisions, "vehicles whose body overlapped another vehicle's").toEqual([]);
      expect(report.safety.removals, "vehicles removed because no safe position existed").toBe(0);
      expect(report.travelled, "vehicles that drove more than 10 m").toBe(report.placed);
      expect(report.usableRoads).toBeGreaterThan(0);
      expect(report.placed).toBeGreaterThan(0);
      expect(report.placed).toBeLessThanOrEqual(TRAFFIC.maxCount);
      expect(report.moved).toBeGreaterThan(report.placed / 2);
    } finally {
      engine.dispose();
    }
  });
});
