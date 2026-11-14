import type { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { DistrictGame } from "../../src/game/engine/DistrictGame";
import { pointInPolygons } from "../../src/game/district/spawn";
import type { DistrictData } from "../../src/game/district/types";
import { TRAFFIC } from "../../src/game/traffic/TrafficModel";
import { keyboard, memory } from "./harness";

/**
 * Checks on a whole district file as written by tools/build-district.mjs:
 * who it says it is, and whether the game can use it. Shared by the real
 * Alpha 1 suite (tests/real) and by the ordinary suite, which runs them on
 * the tool's synthetic output so the checks are themselves tested.
 */
type Raw = Record<string, unknown>;
const record = (v: unknown): Raw => (v && typeof v === "object" ? (v as Raw) : {});

/** Paths of every number in the file that is NaN or infinite, and every null where a coordinate should be. */
export function nonFiniteValues(value: unknown, path = "", out: string[] = []): string[] {
  if (out.length >= 20) return out;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) out.push(path);
  } else if (Array.isArray(value)) {
    // JSON writes NaN and Infinity as null: a null inside a coordinate array is a number that was lost.
    const numeric = value.some((v) => typeof v === "number");
    value.forEach((v, i) => {
      if (v === null && numeric) out.push(`${path}[${i}] (null in a list of numbers)`);
      else nonFiniteValues(v, `${path}[${i}]`, out);
    });
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) nonFiniteValues(v, path ? `${path}.${k}` : k, out);
  }
  return out;
}

/**
 * Identity and source of the file. With `real`, the file must be the Alpha 1
 * district cut from an OpenStreetMap extract; invented data is a problem.
 */
export function metadataProblems(raw: unknown, expect: { real: boolean }): string[] {
  const d = record(raw), out: string[] = [];
  const source = record(d.source), sector = record(d.sector), tags = record(sector.tags), projection = record(d.projection), origin = record(projection.origin);
  if (d.kind !== "district" || d.formatVersion !== 1) out.push(`not a version 1 district file (kind ${String(d.kind)}, version ${String(d.formatVersion)})`);
  if (d.id !== "alpha-1") out.push(`id is ${String(d.id)}, expected alpha-1`);
  if (d.name !== "Alpha 1") out.push(`name is ${String(d.name)}, expected Alpha 1`);
  if (d.region !== "greater-noida") out.push(`region is ${String(d.region)}, expected greater-noida`);
  if (!/OpenStreetMap contributors/.test(String(d.attribution)) || !/ODbL/.test(String(d.attribution))) out.push("attribution does not credit OpenStreetMap contributors under ODbL");
  if (!/ODbL/.test(String(d.licence))) out.push("licence does not name ODbL");
  if (Number.isNaN(Date.parse(String(d.builtAt)))) out.push("builtAt is not a date");
  if (Number.isNaN(Date.parse(String(source.extractedAt)))) out.push("source.extractedAt is not a date");
  if (typeof source.profile !== "string" || !source.profile) out.push("source.profile is missing");

  // The sector is the mapped object the district was cut around, found by name.
  const names = ["name", "name:en", "alt_name", "official_name", "short_name"].map((k) => String(tags[k] ?? ""));
  if (!names.some((n) => /^alpha[\s-]*(1|i)$/i.test(n))) out.push(`the sector is named ${JSON.stringify(names.filter(Boolean))}, not Alpha 1`);
  const osm = record(sector.osm);
  if (!["way", "relation"].includes(String(osm.type)) || !Number.isInteger(osm.id) || (osm.id as number) <= 0) out.push("the sector has no OpenStreetMap way or relation id");
  if (sector.id !== `${String(osm.type)}/${String(osm.id)}`) out.push("the sector id does not match its OpenStreetMap reference");

  const lat = origin.lat as number, lon = origin.lon as number;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) out.push("the projection has no origin");
  // Greater Noida lies around 28.47 N, 77.50 E. A district anywhere else is not this one.
  else if (lat < 28.3 || lat > 28.65 || lon < 77.35 || lon > 77.7) out.push(`the projection origin ${lat}, ${lon} is not in Greater Noida`);

  const synthetic = d.synthetic === true || source.synthetic === true;
  if (d.synthetic !== Boolean(source.synthetic)) out.push("the synthetic flag disagrees with the source record");
  if (expect.real) {
    if (synthetic) out.push("the file is SYNTHETIC test data, not the real district");
    if (typeof source.file !== "string" || !source.file) out.push("source.file is missing: no record of the extract it was built from");
    if (typeof source.osmBase !== "string" || Number.isNaN(Date.parse(source.osmBase))) out.push("source.osmBase is missing: no record of the OpenStreetMap data timestamp");
  } else if (!synthetic) out.push("expected synthetic test data, but the file is not flagged synthetic");
  return out;
}

/** Buildings flagged as inside the sector are inside its outline; the rest are in the surrounding buffer. */
export function sectorProblems(d: DistrictData): string[] {
  const out: string[] = [];
  let mismatched = 0, inside = 0;
  for (const b of d.buildings) {
    const within = pointInPolygons(b.centre[0], b.centre[1], d.sector.polygons);
    if (within) inside++;
    if (within !== b.inSector) mismatched++;
  }
  if (mismatched > 0) out.push(`${mismatched} buildings have an inSector flag that disagrees with the sector outline`);
  if (d.buildings.length > 0 && inside === 0) out.push("no building lies inside the sector outline");
  if (!pointInPolygons(d.spawn.x, d.spawn.z, d.sector.polygons)) out.push("the spawn point is not inside the sector");
  return out;
}

export interface TrafficReport {
  problems: string[];
  placed: number;
  usableRoads: number;
  moved: number;
}

/** Starts the game on the district with the most traffic allowed and drives the traffic for `seconds` of game time. */
export function trafficReport(engine: NullEngine, d: DistrictData, seconds = 60): TrafficReport {
  const kb = keyboard();
  const game = new DistrictGame({ engine, input: kb.input, district: d, settings: memory(), trafficCount: TRAFFIC.maxCount });
  const problems: string[] = [];
  const tally = new Map<string, number>();
  const report = (kind: string): void => void tally.set(kind, (tally.get(kind) ?? 0) + 1);
  try {
    const px = game.vehicle.x, pz = game.vehicle.z;
    if (game.world.buildingIndex.at(px, pz)) problems.push("the player starts inside a building");
    if (!game.vehicle.onRoad) problems.push("the player does not start on a road");
    game.traffic.update(0, px, pz); // placement only
    const cars = game.traffic.cars;
    for (const c of cars) {
      if (!c.active) continue;
      if (Math.hypot(c.x - px, c.z - pz) < TRAFFIC.spawnFromPlayer) report("cars placed too close to the player");
    }
    const startAt = cars.map((c) => [c.x, c.z] as const);
    const b = d.bounds;
    for (let frame = 0; frame < seconds * 30; frame++) {
      game.traffic.update(1 / 30, px, pz);
      if (frame % 10 !== 0) continue;
      for (const c of cars) {
        if (!c.active) continue;
        if (![c.x, c.z, c.heading, c.speed].every(Number.isFinite)) report("car samples with a value that is not finite");
        else {
          if (c.x < b.minX || c.x > b.maxX || c.z < b.minZ || c.z > b.maxZ) report("car samples outside the district");
          if (game.world.buildingIndex.at(c.x, c.z)) report("car samples inside a building");
          if (!game.world.roadSurfaces.near(c.x, c.z, 1)) report("car samples off every mapped carriageway");
        }
      }
    }
    for (const [kind, n] of tally) problems.push(`${n} ${kind}`);
    const placed = game.traffic.activeCount;
    const moved = cars.filter((c, i) => c.active && Math.hypot(c.x - startAt[i]![0], c.z - startAt[i]![1]) > 10).length;
    return { problems, placed, usableRoads: game.traffic.roads.length, moved };
  } finally {
    game.dispose();
    kb.input.dispose();
  }
}
