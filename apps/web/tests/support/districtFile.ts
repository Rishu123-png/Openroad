import type { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { DistrictGame } from "../../src/game/engine/DistrictGame";
import { pointInPolygons } from "../../src/game/district/spawn";
import type { DistrictBuilding, DistrictData } from "../../src/game/district/types";
import { TRAFFIC, type TrafficCar, type TrafficModel } from "../../src/game/traffic/TrafficModel";
import { footprintHit } from "../../src/game/traffic/roadSafety";
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

export interface TrafficIncident {
  /** Index of the traffic vehicle. */
  car: number;
  frame: number;
  seconds: number;
  x: number;
  z: number;
  heading: number;
  length: number;
  width: number;
  /** True when the vehicle's centre is inside the footprint; false when only its body overlaps. */
  centreInside: boolean;
  buildingId: string;
  buildingCategory: string;
  buildingFromRelation: boolean;
  buildingBounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Metres from the vehicle's centre to the nearest wall of that building. Negative: the centre is that deep inside. */
  distance: number;
  roadId: string;
  roadClass: string;
  roadWidth: number;
  roadWidthStatus: string;
  segment: number;
  direction: 1 | -1;
  /** Metres between the vehicle and the lane line it is following. */
  offLane: number;
  cause: string;
}

export interface TrafficReport {
  problems: string[];
  placed: number;
  usableRoads: number;
  moved: number;
  /** Every sample where a vehicle's centre or body was inside a building (first 200). */
  incidents: TrafficIncident[];
  incidentCount: number;
  /** Vehicles with at least one incident. */
  vehiclesInBuildings: number[];
  /** What the traffic model decided not to use, and what it had to remove while driving. */
  safety: { roadsChecked: number; roadsAffected: number; roadsFullyExcluded: number; segmentsExcluded: number; metresExcluded: number; metresChecked: number; lanesNarrowed: number; removals: number; byReason: Record<string, number> };
  /** Readable lines for the test output. */
  lines: string[];
}

function edgeDistance(x: number, z: number, b: DistrictBuilding): number {
  let best = Infinity;
  for (const polygon of b.polygons) {
    for (const ring of [polygon.outer, ...polygon.holes]) {
      for (let i = 1; i < ring.length; i++) {
        const p = ring[i - 1]!, q = ring[i]!;
        const len2 = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
        const t = len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((x - p[0]) * (q[0] - p[0]) + (z - p[1]) * (q[1] - p[1])) / len2));
        best = Math.min(best, Math.hypot(p[0] + (q[0] - p[0]) * t - x, p[1] + (q[1] - p[1]) * t - z));
      }
    }
  }
  return best;
}

/**
 * Describes one vehicle that is in a building, and works out why, in this order:
 * the mapped centre line is in the building; the lane position is; the vehicle is
 * off its lane line (a turn); or only the body overlaps while the centre is clear.
 */
export function describeIncident(traffic: TrafficModel, buildings: { at(x: number, z: number): DistrictBuilding | null }, car: TrafficCar, index: number, frame: number, building: DistrictBuilding, centreInside: boolean): TrafficIncident {
  const road = traffic.roads[car.road]!;
  const a = road.points[car.from]!, b = road.points[car.from + car.dir]!;
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-6;
  const dx = (b[0] - a[0]) / length, dz = (b[1] - a[1]) / length;
  const t = Math.max(0, Math.min(length, (car.x - a[0]) * dx + (car.z - a[1]) * dz));
  const cx = a[0] + dx * t, cz = a[1] + dz * t; // nearest point of the mapped centre line
  const lateral = (car.x - cx) * -dz + (car.z - cz) * dx; // left of travel
  const segment = traffic.segmentOf(car);
  const lane = traffic.safety.offsets[car.road]?.[segment * 2 + (car.dir === 1 ? 0 : 1)] ?? 0;
  const offLane = Math.abs(lateral - lane);
  let cause: string;
  if (buildings.at(cx, cz)) cause = "A: the mapped road centre line is inside the building here";
  else if (buildings.at(cx - dz * lane, cz + dx * lane)) cause = `B: the lane position (${lane.toFixed(2)} m left of the centre line of a ${road.width} m ${road.widthStatus} road) is inside the building`;
  else if (centreInside) cause = `C: the vehicle is ${offLane.toFixed(2)} m off its lane line (turning or changing road) and that path crosses the building`;
  else cause = `D: centre clear (${offLane.toFixed(2)} m off its lane line), but the ${car.length} x ${car.width} m body overlaps the building`;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const polygon of building.polygons) for (const p of polygon.outer) {
    minX = Math.min(minX, p[0]);
    maxX = Math.max(maxX, p[0]);
    minZ = Math.min(minZ, p[1]);
    maxZ = Math.max(maxZ, p[1]);
  }
  const d = edgeDistance(car.x, car.z, building);
  return {
    car: index, frame, seconds: frame / 30, x: car.x, z: car.z, heading: car.heading, length: car.length, width: car.width, centreInside,
    buildingId: building.id, buildingCategory: building.category, buildingFromRelation: building.fromRelation, buildingBounds: { minX, maxX, minZ, maxZ }, distance: centreInside ? -d : d,
    roadId: road.id, roadClass: road.class, roadWidth: road.width, roadWidthStatus: road.widthStatus, segment, direction: car.dir, offLane, cause,
  };
}

const f1 = (v: number): string => v.toFixed(1);

/**
 * Starts the game on the district with the most traffic allowed and drives the traffic for `seconds` of game time.
 * Every vehicle is checked on every frame: its centre and its whole body against every building footprint.
 */
export function trafficReport(engine: NullEngine, d: DistrictData, seconds = 60): TrafficReport {
  const kb = keyboard();
  const game = new DistrictGame({ engine, input: kb.input, district: d, settings: memory(), trafficCount: TRAFFIC.maxCount });
  const problems: string[] = [];
  const tally = new Map<string, number>();
  const report = (kind: string): void => void tally.set(kind, (tally.get(kind) ?? 0) + 1);
  const incidents: TrafficIncident[] = [];
  const offenders = new Set<number>();
  let incidentCount = 0;
  try {
    const px = game.vehicle.x, pz = game.vehicle.z;
    const traffic = game.traffic, index = game.world.buildingIndex;
    if (index.at(px, pz)) problems.push("the player starts inside a building");
    if (!game.vehicle.onRoad) problems.push("the player does not start on a road");
    traffic.update(0, px, pz); // placement only
    const cars = traffic.cars;
    for (const c of cars) {
      if (!c.active) continue;
      if (Math.hypot(c.x - px, c.z - pz) < TRAFFIC.spawnFromPlayer) report("cars placed too close to the player");
    }
    const startAt = cars.map((c) => [c.x, c.z] as const);
    const b = d.bounds;
    for (let frame = 0; frame <= seconds * 30; frame++) {
      if (frame > 0) traffic.update(1 / 30, px, pz);
      for (let i = 0; i < cars.length; i++) {
        const c = cars[i]!;
        if (!c.active) continue;
        if (![c.x, c.z, c.heading, c.speed].every(Number.isFinite)) {
          report("car samples with a value that is not finite");
          continue;
        }
        if (c.x < b.minX || c.x > b.maxX || c.z < b.minZ || c.z > b.maxZ) report("car samples outside the district");
        if (!game.world.roadSurfaces.near(c.x, c.z, 1)) report("car samples off every mapped carriageway");
        const centre = index.at(c.x, c.z);
        const body = centre ?? footprintHit(index, c.x, c.z, c.heading, c.length, c.width);
        if (centre) report("car samples inside a building");
        if (body) {
          if (!centre) report("car samples with the body overlapping a building");
          incidentCount++;
          offenders.add(i);
          if (incidents.length < 200) incidents.push(describeIncident(traffic, index, c, i, frame, body, Boolean(centre)));
        }
      }
    }
    for (const [kind, n] of tally) problems.push(`${n} ${kind}`);
    const placed = traffic.activeCount;
    const moved = cars.filter((c, i) => c.active && Math.hypot(c.x - startAt[i]![0], c.z - startAt[i]![1]) > 10).length;

    const s = traffic.safety;
    const byReason: Record<string, number> = {};
    for (const e of s.excluded) byReason[e.reason] = (byReason[e.reason] ?? 0) + 1;
    const affected = new Set(s.excluded.map((e) => e.roadId));
    const safety = {
      roadsChecked: traffic.roads.length + s.roadsFullyExcluded, roadsAffected: affected.size, roadsFullyExcluded: s.roadsFullyExcluded, segmentsExcluded: s.excluded.length,
      metresExcluded: Math.round(s.excludedLength), metresChecked: Math.round(s.checkedLength), lanesNarrowed: s.narrowed.length, removals: traffic.removalCount, byReason,
    };
    const lines: string[] = [];
    lines.push(`roads checked for traffic: ${safety.roadsChecked}; unsafe roads found: ${safety.roadsAffected} (${safety.segmentsExcluded} segments, ${safety.metresExcluded} m of ${safety.metresChecked} m)`);
    lines.push(`  excluded from traffic routing, still drawn: ${safety.roadsAffected} roads in part, of which ${safety.roadsFullyExcluded} entirely; reasons ${JSON.stringify(byReason)}`);
    lines.push(`  lanes moved toward the centre line because a building stands inside the road width: ${safety.lanesNarrowed} segment-directions on ${new Set(s.narrowed.map((n) => n.roadId)).size} roads`);
    for (const e of s.excluded.slice(0, 25)) lines.push(`  unsafe: ${e.roadId} (${e.roadClass}) segment ${e.segment} [${f1(e.from[0])}, ${f1(e.from[1])}] to [${f1(e.to[0])}, ${f1(e.to[1])}], ${f1(e.length)} m: ${e.reason}, ${e.buildingId} (${e.buildingCategory}) at [${f1(e.at[0])}, ${f1(e.at[1])}]`);
    if (s.excluded.length > 25) lines.push(`  ... and ${s.excluded.length - 25} more unsafe segments`);
    lines.push(`vehicles tested: ${placed}; frames checked: ${seconds * 30 + 1}; vehicles removed while driving because no safe position existed: ${safety.removals}`);
    for (const r of traffic.removals.slice(0, 10)) lines.push(`  removed: vehicle ${r.car} on ${r.roadId} segment ${r.segment} at [${f1(r.x)}, ${f1(r.z)}], building ${r.buildingId}${r.turnFrom ? `, after turning from ${r.turnFrom.roadId} segment ${r.turnFrom.segment} (turn not used again)` : ""}`);
    lines.push(`building intersections: ${incidentCount} samples from ${offenders.size} different vehicles${offenders.size ? ` (vehicles ${[...offenders].sort((x, y) => x - y).join(", ")})` : ""}`);
    const causes: Record<string, number> = {};
    for (const it of incidents) causes[it.cause[0]!] = (causes[it.cause[0]!] ?? 0) + 1;
    if (incidents.length) lines.push(`  by cause (A centre line in building, B lane position, C turning path, D body only): ${JSON.stringify(causes)}`);
    for (const it of incidents.slice(0, 40)) {
      const bb = it.buildingBounds;
      lines.push(
        `  vehicle ${it.car} at ${it.seconds.toFixed(2)} s (frame ${it.frame}): centre [${it.x.toFixed(2)}, ${it.z.toFixed(2)}], heading ${it.heading.toFixed(2)} rad, ${it.length} x ${it.width} m; ` +
          `building ${it.buildingId} (${it.buildingCategory}${it.buildingFromRelation ? ", relation" : ""}) x ${f1(bb.minX)}..${f1(bb.maxX)} z ${f1(bb.minZ)}..${f1(bb.maxZ)}, ${it.distance < 0 ? `${(-it.distance).toFixed(2)} m inside` : `wall ${it.distance.toFixed(2)} m from centre`}; ` +
          `road ${it.roadId} (${it.roadClass}, ${it.roadWidth} m ${it.roadWidthStatus}) segment ${it.segment} direction ${it.direction}; ${it.cause}`,
      );
    }
    if (incidents.length > 40) lines.push(`  ... and ${incidentCount - 40} more samples`);
    return { problems, placed, usableRoads: traffic.roads.length, moved, incidents, incidentCount, vehiclesInBuildings: [...offenders], safety, lines };
  } finally {
    game.dispose();
    kb.input.dispose();
  }
}
