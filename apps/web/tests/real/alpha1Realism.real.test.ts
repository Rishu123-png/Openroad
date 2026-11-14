import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDistrict } from "../../src/game/district/loadDistrict";
import { DistrictGame } from "../../src/game/engine/DistrictGame";
import { keyboard, nullEngine } from "../support/harness";
import { realismCheck } from "../support/realism";

/**
 * REAL DATA checks of the Alpha 1 reconstruction (M004).
 *
 *   npm run test:real
 *
 * Reads the district file built on this machine. On a machine without it the
 * test is SKIPPED (the notice is printed by alpha1.real.test.ts) and nothing
 * is reported as passed. Every expectation is derived from the file itself:
 * footprints, courtyards, heights, widths, access, gates and names must all
 * appear in the built world exactly as the file gives them.
 */
const FILE = resolve(process.env.OPENROAD_DISTRICT ?? resolve(import.meta.dirname, "../../public/regions/greater-noida/alpha-1.json"));

describe.skipIf(!existsSync(FILE))("real Alpha 1 reconstruction", () => {
  it("renders every mapped footprint, road, gate and name as the file gives them, and adds nothing on a road", () => {
    const district = parseDistrict(JSON.parse(readFileSync(FILE, "utf8")));
    const engine = nullEngine();
    const kb = keyboard();
    const t0 = performance.now();
    const game = new DistrictGame({ engine, input: kb.input, district });
    const buildMs = performance.now() - t0;
    const { problems, report } = realismCheck(game, district, buildMs);
    console.log(["", "================================================================================", ` ALPHA 1 RECONSTRUCTION (${district.synthetic ? "SYNTHETIC FILE: says nothing about Alpha 1" : "real data"})`, ...report, "================================================================================", ""].join("\n"));
    expect(problems).toEqual([]);
    // Loading the same file again gives the same world.
    const again = new DistrictGame({ engine, input: kb.input, district: parseDistrict(JSON.parse(readFileSync(FILE, "utf8"))) });
    expect(again.world.counts).toEqual(game.world.counts);
    expect([...again.world.provenance.buildings.values()].map((b) => b.appearance.rule)).toEqual([...game.world.provenance.buildings.values()].map((b) => b.appearance.rule));
    game.dispose();
    again.dispose();
    kb.input.dispose();
    engine.dispose();
  });
});
