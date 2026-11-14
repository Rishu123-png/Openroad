import { describe, expect, it } from "vitest";
import { BuildingIndex } from "../src/game/district/BuildingIndex";
import type { DistrictBounds, DistrictData } from "../src/game/district/types";
import { analyseRoads, boundaryInset, footprintOutside, ROAD_SAFETY } from "../src/game/traffic/roadSafety";
import { TRAFFIC, TrafficModel } from "../src/game/traffic/TrafficModel";
import { TRAFFIC_CARS } from "../src/game/vehicle/models/carSpecs";
import { EDGE, EDGE_BOUNDS, edgeDistrict } from "./fixtures/edgeDistrict";
import { describeBoundaryIncident, trafficReport } from "./support/districtFile";
import { nullEngine } from "./support/harness";

/**
 * Traffic and the district boundary. Everything here is SYNTHETIC: a district
 * whose roads meet its edge in the ways real roads do. The real Alpha 1 file
 * is tested separately (npm run test:real).
 */
const PLAYER: readonly [number, number] = [200, 150];
const B: DistrictBounds = EDGE_BOUNDS;

function start(d: DistrictData, count = 40, seed?: number): TrafficModel {
  const traffic = new TrafficModel(d, new BuildingIndex(d.buildings), seed);
  traffic.setCount(count);
  return traffic;
}

interface Seen {
  bodyOut: number;
  centreOut: number;
  vehicles: Set<number>;
  /** Positions seen, per road id. */
  positions: Map<string, Array<readonly [number, number]>>;
  /** Frames in which a vehicle was placed (it was inactive, or it jumped). */
  placements: Array<readonly [number, number, number]>;
}
function drive(traffic: TrafficModel, seconds: number, bounds: DistrictBounds = B, dt = 1 / 30): Seen {
  const seen: Seen = { bodyOut: 0, centreOut: 0, vehicles: new Set(), positions: new Map(), placements: [] };
  const last = traffic.cars.map((c) => [c.x, c.z, c.active] as [number, number, boolean]);
  for (let t = 0; t < seconds; t += dt) {
    traffic.update(dt, PLAYER[0], PLAYER[1]);
    traffic.cars.forEach((c, i) => {
      const was = last[i] ?? (last[i] = [0, 0, false]);
      if (c.active) {
        if (!was[2] || Math.hypot(c.x - was[0], c.z - was[1]) > 3) seen.placements.push([c.x, c.z, c.heading]);
        if (c.x < bounds.minX || c.x > bounds.maxX || c.z < bounds.minZ || c.z > bounds.maxZ) seen.centreOut++;
        if (footprintOutside(bounds, c.x, c.z, c.heading, c.length, c.width)) {
          seen.bodyOut++;
          seen.vehicles.add(i);
        }
        const id = traffic.roads[c.road]!.id;
        if (!seen.positions.has(id)) seen.positions.set(id, []);
        seen.positions.get(id)!.push([c.x, c.z]);
      }
      was[0] = c.x;
      was[1] = c.z;
      was[2] = c.active;
    });
  }
  return seen;
}
const limit = (traffic: TrafficModel, id: string, segment: number, direction: 1 | -1): [number, number] => {
  const r = traffic.roads.findIndex((road) => road.id === id);
  const i = (segment * 2 + (direction === 1 ? 0 : 1)) * 2;
  return [traffic.safety.limits[r]![i]!, traffic.safety.limits[r]![i + 1]!];
};

describe("the margin (synthetic)", () => {
  it("comes from the size of the largest vehicle, and covers every traffic vehicle at every heading", () => {
    const longest = Math.max(...TRAFFIC_CARS.map((c) => c.length)), widest = Math.max(...TRAFFIC_CARS.map((c) => c.width));
    expect(ROAD_SAFETY.vehicleHalfLength).toBeGreaterThanOrEqual(longest / 2);
    expect(ROAD_SAFETY.vehicleHalfWidth).toBeGreaterThanOrEqual(widest / 2);
    expect(boundaryInset()).toBeCloseTo(Math.hypot(ROAD_SAFETY.vehicleHalfLength, ROAD_SAFETY.vehicleHalfWidth) + ROAD_SAFETY.margin, 9);
    // A centre exactly on the inset line: no corner is outside, whichever way the vehicle faces.
    const inset = boundaryInset();
    for (const spec of TRAFFIC_CARS) {
      for (let h = 0; h < Math.PI * 2; h += Math.PI / 36) {
        expect(footprintOutside(B, B.maxX - inset, B.maxZ - inset, h, spec.length, spec.width)).toBeNull();
        expect(footprintOutside(B, B.minX + inset, B.minZ + inset, h, spec.length, spec.width)).toBeNull();
      }
    }
  });
});

describe("centre inside, body outside (synthetic)", () => {
  it("is detected: the centre-only check passes where the body check does not", () => {
    // 1.5 m inside the east edge, facing it: the centre is inside, the front 0.85 m is not.
    const out = footprintOutside(B, 398.5, 150, Math.PI / 2, 4.7, 1.86);
    expect(out).not.toBeNull();
    expect(out!.part).toMatch(/^front/);
    expect(out!.distance).toBeCloseTo(0.85, 6);
    expect(out!.x).toBeCloseTo(400.85, 6);
    // The same place, facing along the edge: only half the width reaches towards it, and that fits.
    expect(footprintOutside(B, 398.5, 150, 0, 4.7, 1.86)).toBeNull();
    // Reversing out: the rear is what crosses.
    expect(footprintOutside(B, 398.5, 150, -Math.PI / 2, 4.7, 1.86)!.part).toMatch(/^rear/);
    // Centre outside: reported as the centre when it is the only thing out, else as the part furthest out.
    expect(footprintOutside(B, 401, 150, Math.PI / 2, 4.7, 1.86)!.distance).toBeCloseTo(3.35, 6);
    expect(footprintOutside(B, 200, 150, 1, 4.7, 1.86)).toBeNull();
  });

  it("the report names the vehicle, the part, the distance, the road and whether the centre is out", () => {
    const d = edgeDistrict();
    const traffic = start(d, 1);
    traffic.update(0, ...PLAYER);
    const car = traffic.cars.find((c) => c.active)!;
    // Put the car where the old code let cars go: on the lane of `square` (traffic keeps left: eastbound is on the north side), nose over the east edge.
    const r = traffic.roads.findIndex((road) => road.id === EDGE.square);
    Object.assign(car, { road: r, from: 1, dir: 1, along: 48.5, x: 398.5, z: 151.75, heading: Math.PI / 2 });
    const it = describeBoundaryIncident(traffic, d.bounds, car, 0, 90, 60)!;
    expect(it).toMatchObject({ car: 0, frame: 90, seconds: 3, centreOutside: false, edge: "east", roadId: EDGE.square, segment: 1, direction: 1, length: car.length, width: car.width });
    expect(it.part).toMatch(/^front/);
    expect(it.distance).toBeCloseTo(398.5 + car.length / 2 - 400, 6);
    expect(it.next).toContain("on the district boundary");
    expect(it.cause).toMatch(/^B \(centre inside, body outside\) with A:/);
    // Centre out as well.
    Object.assign(car, { x: 400.4 });
    const centre = describeBoundaryIncident(traffic, d.bounds, car, 0, 91, 61)!;
    expect(centre.centreOutside).toBe(true);
    expect(centre.cause).toMatch(/^A:/);
    // Just placed there: that is a placement fault, whatever the road.
    expect(describeBoundaryIncident(traffic, d.bounds, car, 0, 91, 0)!.cause).toMatch(/^D:/);
    // Inside: nothing to report.
    Object.assign(car, { x: 380 });
    expect(describeBoundaryIncident(traffic, d.bounds, car, 0, 92, 62)).toBeNull();
  });
});

describe("a road crossing the boundary (synthetic)", () => {
  it("is used up to the margin and no further; the part beyond is recorded, the map is untouched", () => {
    const d = edgeDistrict();
    const before = JSON.stringify(d);
    const traffic = start(d);
    const inset = traffic.safety.boundaryInset;
    const offset = 7 / 4; // lane offset of a 7 m two-way road

    // `square` ends on the east edge: both lanes of its last segment stop `inset` short.
    for (const direction of [1, -1] as const) {
      expect(limit(traffic, EDGE.square, 1, direction)[0]).toBe(0);
      expect(limit(traffic, EDGE.square, 1, direction)[1]).toBeCloseTo(50 - inset, 9);
    }
    expect(limit(traffic, EDGE.square, 0, 1)).toEqual([0, 50]);
    expect(traffic.safety.trimmed.filter((t) => t.roadId === EDGE.square).map((t) => [t.segment, t.direction, t.from, t.segmentLength])).toEqual([[1, 1, 0, 50], [1, -1, 0, 50]]);

    // `beyond` leaves the district and returns: the segment wholly outside is excluded, with the reason.
    const beyond = traffic.safety.excluded.filter((e) => e.roadId === EDGE.beyond);
    expect(beyond.map((e) => [e.segment, e.reason, e.buildingId])).toEqual([[2, "lane-outside-district-boundary", "district-boundary"]]);
    // The segments that cross the edge are kept as far as the margin: 20 m of each is inside.
    expect(limit(traffic, EDGE.beyond, 0, 1)).toEqual([0, 130]);
    expect(limit(traffic, EDGE.beyond, 1, 1)[1]).toBeCloseTo(20 - inset, 9);
    expect(limit(traffic, EDGE.beyond, 3, 1)[0]).toBeCloseTo(30 + inset, 9);
    // `along` runs 2 m from the south edge: no lane fits there, so that stretch is excluded. Its other two are kept.
    expect(traffic.safety.excluded.filter((e) => e.roadId === EDGE.along).map((e) => e.segment)).toEqual([1]);
    // `near` runs 4 m from the west edge: its centre line fits and so does the inner lane, the outer lane does not.
    expect(4).toBeGreaterThan(inset);
    expect(4 - offset).toBeLessThan(inset);
    expect(traffic.safety.excluded.filter((e) => e.roadId === EDGE.near).map((e) => e.segment)).toEqual([2]);
    expect(traffic.safety.excluded.every((e) => e.reason === "lane-outside-district-boundary")).toBe(true);

    const seen = drive(traffic, 60);
    expect(seen.centreOut).toBe(0);
    expect(seen.bodyOut).toBe(0);
    // Vehicles do drive `square` towards the edge, and stop short of it by the margin.
    const xs = seen.positions.get(EDGE.square)!.map((p) => p[0]);
    expect(Math.max(...xs)).toBeGreaterThan(B.maxX - inset - 3);
    expect(Math.max(...xs)).toBeLessThanOrEqual(B.maxX - inset + 1e-9);
    // And the excluded stretches are not driven.
    expect((seen.positions.get(EDGE.along) ?? []).filter((p) => p[1] < 2.5 + offset && p[0] > 70 && p[0] < 330)).toEqual([]);
    expect((seen.positions.get(EDGE.beyond) ?? []).filter((p) => p[1] > B.maxZ - inset + 1e-9)).toEqual([]);

    // Nothing in the district was changed: not the boundary, not the roads.
    expect(JSON.stringify(d)).toBe(before);
    expect(d.bounds).toEqual(EDGE_BOUNDS);
    expect(traffic.removalCount).toBe(0);
  });

  it("before the fix the same district put vehicles outside: a centre-only check on the lane finds them", () => {
    // What the old model did: drive each lane to the end of the mapped road. Checked here from the geometry alone.
    const d = edgeDistrict();
    const unbounded = analyseRoads(d.roads, new BuildingIndex([]), () => 1.75);
    const bounded = analyseRoads(d.roads, new BuildingIndex([]), () => 1.75, d.bounds);
    expect(unbounded.excluded).toEqual([]);
    expect(unbounded.trimmed).toEqual([]);
    expect(bounded.excluded.length).toBeGreaterThan(0);
    expect(bounded.trimmed.length).toBeGreaterThan(0);
    // A vehicle at the mapped end of `square`, as the old model allowed, is outside by half its length.
    expect(footprintOutside(d.bounds, 400, 148.25, Math.PI / 2, 4.7, 1.86)!.distance).toBeCloseTo(2.35, 6);
  });

  it("a road at a slant to the edge is cut where the lane, not the centre line, reaches the margin", () => {
    const traffic = start(edgeDistrict());
    const inset = traffic.safety.boundaryInset;
    const [, outward] = limit(traffic, EDGE.slant, 2, 1), [, inward] = limit(traffic, EDGE.slant, 2, -1);
    const length = Math.hypot(400 - 373.2, 265.47 - 250);
    // The two lanes are on opposite sides of the centre line, so at a slant they reach the margin at different places.
    // Along a road at 30 degrees the margin is inset / cos(30) of road, and the lanes sit 1.75 * tan(30) either side of that.
    const cut = length - inset / Math.cos(Math.PI / 6), shift = 1.75 * Math.tan(Math.PI / 6);
    expect(Math.min(outward, inward)).toBeCloseTo(cut - shift, 1);
    expect(Math.max(outward, inward)).toBeCloseTo(cut + shift, 1);
    const seen = drive(traffic, 60);
    expect(seen.bodyOut).toBe(0);
    expect(Math.max(...seen.positions.get(EDGE.slant)!.map((p) => p[0]))).toBeLessThanOrEqual(B.maxX - inset + 1e-9);
  });
});

describe("a turn near the boundary (synthetic)", () => {
  it("turning round at the edge keeps the whole body inside, at every frame of the turn", () => {
    const d = edgeDistrict();
    const zs: number[] = [];
    for (const seed of [1, 2, 3]) {
      const traffic = start(d, 40, seed);
      const seen = drive(traffic, 60);
      expect(seen.bodyOut, `seed ${seed}`).toBe(0);
      zs.push(...(seen.positions.get(EDGE.square) ?? []).filter((p) => p[0] > 390).map((p) => p[1]));
    }
    // Vehicles reach the end of `square` on both lanes: they turned round there, across the road.
    expect(Math.min(...zs)).toBeLessThan(149);
    expect(Math.max(...zs)).toBeGreaterThan(151);
  });

  it("a bend 3.5 m from the corner of the district is not driven, and the road is entered only where it is safe", () => {
    const traffic = start(edgeDistrict());
    const inset = traffic.safety.boundaryInset;
    // `corner` runs north to z 296.5, east to x 396.5, then south: its centre line is inside, by 3.5 m.
    // The outer lane of each stretch near the edge does not fit, so those stretches are excluded.
    const excluded = traffic.safety.excluded.filter((e) => e.roadId === EDGE.corner).map((e) => e.segment);
    expect(excluded).toEqual([1, 2]);
    const seen = drive(traffic, 60);
    expect(seen.bodyOut).toBe(0);
    for (const [x, z] of seen.positions.get(EDGE.corner) ?? []) {
      expect(x).toBeLessThanOrEqual(B.maxX - inset + 1e-9);
      expect(z).toBeLessThanOrEqual(B.maxZ - inset + 1e-9);
    }
  });

  it("holds at low frame rates, where each step of a turn is large", () => {
    const traffic = start(edgeDistrict());
    const seen = drive(traffic, 60, B, 1 / 8);
    expect(seen.bodyOut).toBe(0);
    expect(seen.centreOut).toBe(0);
  });
});

describe("spawn and respawn near the edge (synthetic)", () => {
  it("every placement, first or later, has the whole body inside", () => {
    const d = edgeDistrict();
    let placements = 0;
    for (const seed of [11, 12, 13, 14]) {
      const traffic = start(d, 40, seed);
      const seen = drive(traffic, 30);
      placements += seen.placements.length;
      for (const [x, z, heading] of seen.placements) expect(footprintOutside(B, x, z, heading, 4.7, 1.86), `seed ${seed} at ${x.toFixed(1)}, ${z.toFixed(1)}`).toBeNull();
      expect(seen.bodyOut, `seed ${seed}`).toBe(0);
    }
    // More placements than vehicles: some were re-placed (the one-way road ends at the edge).
    expect(placements).toBeGreaterThan(4 * TRAFFIC.maxCount);
  });

  it("a district whose only roads hug the edge places vehicles only where they fit", () => {
    const d = edgeDistrict();
    // One road 2 m inside the south edge (no lane fits) and one down the middle.
    d.roads = d.roads.filter((r) => r.id === EDGE.along || r.id === EDGE.spine);
    const traffic = start(d, 20);
    const seen = drive(traffic, 30);
    expect(traffic.activeCount).toBe(20);
    expect(seen.bodyOut).toBe(0);
    for (const [, z] of seen.placements) expect(z).toBeGreaterThan(traffic.safety.boundaryInset - 1e-9);
  });
});

describe("no safe continuation (synthetic)", () => {
  it("a one-way road that ends on the edge: vehicles stop being shown before it, and are placed again elsewhere", () => {
    const d = edgeDistrict();
    const traffic = start(d);
    const inset = traffic.safety.boundaryInset;
    const seen = drive(traffic, 90);
    const onOneway = seen.positions.get(EDGE.oneway) ?? [];
    expect(onOneway.length).toBeGreaterThan(0);
    // It is driven towards the west edge, to the margin and not past it.
    expect(Math.min(...onOneway.map((p) => p[0]))).toBeLessThan(inset + 6);
    expect(Math.min(...onOneway.map((p) => p[0]))).toBeGreaterThanOrEqual(inset - 1e-9);
    expect(seen.bodyOut).toBe(0);
    // The count is kept up: the vehicle is placed again somewhere safe.
    expect(traffic.activeCount).toBe(40);
  });

  it("a district with no road inside the margin has no traffic, and says why", () => {
    const d = edgeDistrict();
    d.roads = d.roads.filter((r) => r.id === EDGE.along).map((r) => ({ ...r, points: [[60, 2], [340, 2]] as [number, number][] }));
    const traffic = start(d);
    const seen = drive(traffic, 5);
    expect(traffic.activeCount).toBe(0);
    expect(seen.bodyOut).toBe(0);
    expect(traffic.roads.length).toBe(0);
    expect(traffic.safety.excluded.map((e) => e.reason)).toEqual(["lane-outside-district-boundary"]);
    expect(traffic.safety.roadsFullyExcluded).toBe(1);
  });

  it("a vehicle forced to the edge is removed where it stands rather than driven out", () => {
    const d = edgeDistrict();
    const traffic = start(d, 40, 5);
    traffic.update(0, ...PLAYER);
    // Take the limits away from `square`, as if the analysis had missed it: the per-move body check is what is left.
    const r = traffic.roads.findIndex((road) => road.id === EDGE.square);
    traffic.safety.limits[r] = traffic.safety.limits[r]!.map((v, i) => (i % 2 === 1 ? 50 : v));
    const seen = drive(traffic, 90);
    expect(seen.bodyOut).toBe(0);
    expect(seen.centreOut).toBe(0);
    expect(traffic.removalCount).toBeGreaterThan(0);
    expect(traffic.removals.every((x) => x.buildingId === "district-boundary")).toBe(true);
    expect(traffic.removals.every((x) => x.roadId === EDGE.square)).toBe(true);
  });
});

describe("coordinates at the district's edges (synthetic)", () => {
  it("bounds, roads and vehicles are in the same metres: moving the whole district moves every result with it", () => {
    const base = edgeDistrict();
    const shifted = edgeDistrict();
    const [sx, sz] = [-1234.5, 987.25]; // negative and fractional, like a district away from its origin
    shifted.bounds = { minX: B.minX + sx, maxX: B.maxX + sx, minZ: B.minZ + sz, maxZ: B.maxZ + sz };
    shifted.roads = shifted.roads.map((r) => ({ ...r, points: r.points.map(([x, z]) => [x + sx, z + sz] as [number, number]) }));
    const index = new BuildingIndex([]);
    const a = analyseRoads(base.roads, index, () => 1.75, base.bounds), b = analyseRoads(shifted.roads, index, () => 1.75, shifted.bounds);
    expect(b.excluded.map((e) => [e.roadId, e.segment, e.reason])).toEqual(a.excluded.map((e) => [e.roadId, e.segment, e.reason]));
    expect(b.limits.length).toBe(a.limits.length);
    a.limits.forEach((row, r) => row.forEach((v, i) => expect(b.limits[r]![i]).toBeCloseTo(v, 6)));
  });

  it("heading 0 faces +z and heading pi/2 faces +x, for the body as for the lane", () => {
    // Facing +x at the east edge: the front crosses. Facing +z there: nothing does.
    expect(footprintOutside(B, 399, 150, Math.PI / 2, 4, 1.8)!.x).toBeCloseTo(401, 9);
    expect(footprintOutside(B, 399, 150, 0, 4, 1.8)).toBeNull();
    // Facing +z at the north edge: the front crosses, by the same amount.
    expect(footprintOutside(B, 200, 299, 0, 4, 1.8)!.z).toBeCloseTo(301, 9);
    expect(footprintOutside(B, 200, 299, Math.PI / 2, 4, 1.8)).toBeNull();
    // The model's own headings agree: a vehicle driving `square` eastwards has heading pi/2 and its lane is south of the centre line.
    const traffic = start(edgeDistrict());
    const seen: number[] = [];
    for (let i = 0; i < 900; i++) {
      traffic.update(1 / 30, ...PLAYER);
      for (const c of traffic.cars) if (c.active && traffic.roads[c.road]!.id === EDGE.square && c.dir === 1 && c.along > 15 && c.along < 30) seen.push(c.heading, c.z);
    }
    expect(seen.length).toBeGreaterThan(0);
    for (let i = 0; i < seen.length; i += 2) {
      expect(Math.sin(seen[i]!)).toBeGreaterThan(0.95);
      expect(Math.abs(seen[i + 1]! - 150)).toBeGreaterThan(1);
    }
  });

  it("each of the four edges is enforced, and a vehicle exactly on the margin is inside", () => {
    const inset = boundaryInset();
    for (const [x, z] of [[B.minX + inset, 150], [B.maxX - inset, 150], [200, B.minZ + inset], [200, B.maxZ - inset]] as const) {
      for (const h of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.7]) expect(footprintOutside(B, x, z, h, 4.7, 1.86)).toBeNull();
    }
    expect(footprintOutside(B, B.minX + 1, 150, -Math.PI / 2, 4.7, 1.86)).not.toBeNull();
    expect(footprintOutside(B, B.maxX - 1, 150, Math.PI / 2, 4.7, 1.86)).not.toBeNull();
    expect(footprintOutside(B, 200, B.minZ + 1, Math.PI, 4.7, 1.86)).not.toBeNull();
    expect(footprintOutside(B, 200, B.maxZ - 1, 0, 4.7, 1.86)).not.toBeNull();
  });
});

describe("the whole check, as the real-data suite runs it (synthetic)", () => {
  it("40 vehicles for 60 s: none outside, none in a building, all drive more than 10 m", () => {
    const engine = nullEngine();
    try {
      const d = edgeDistrict();
      const report = trafficReport(engine, d, 60);
      expect(report.problems).toEqual([]);
      expect(report.placed).toBe(TRAFFIC.maxCount);
      expect(report.travelled).toBe(TRAFFIC.maxCount);
      expect(report.boundaryIncidentCount).toBe(0);
      expect(report.vehiclesOutside).toEqual([]);
      expect(report.vehiclesCentreOutside).toEqual([]);
      expect(report.vehiclesInBuildings).toEqual([]);
      expect(report.safety.removals).toBe(0);
      expect(report.safety.lanesTrimmedAtBoundary).toBeGreaterThan(0);
      expect(report.lines.join("\n")).toContain("outside the district: 0 samples from 0 different vehicles");
      expect(d.bounds).toEqual(EDGE_BOUNDS);
    } finally {
      engine.dispose();
    }
  });
});
