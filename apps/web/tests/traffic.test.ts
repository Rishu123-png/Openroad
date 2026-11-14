import type { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BuildingIndex } from "../src/game/district/BuildingIndex";
import type { DistrictData, DistrictRoad, Point } from "../src/game/district/types";
import { TRAFFIC, TrafficModel, type TrafficCar } from "../src/game/traffic/TrafficModel";
import { TrafficView } from "../src/game/traffic/TrafficView";
import { CarFactory } from "../src/game/vehicle/models/CarVisual";
import { TRAFFIC_CARS } from "../src/game/vehicle/models/carSpecs";
import { testDistrict } from "./fixtures/district";
import { distanceToLine, nullEngine } from "./support/harness";

const FAR: readonly [number, number] = [9000, 9000]; // a player nowhere near

function road(id: string, points: Point[], over: Partial<DistrictRoad> = {}): DistrictRoad {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
  return {
    id, osm: { type: "way", id: Number(id.split("/")[1]) }, tags: {}, kind: "road", class: "residential", name: null, oneway: false, width: 6,
    widthStatus: "estimated", widthBasis: "default", sidewalk: null, elevated: false, tunnel: false, length, points, ...over,
  };
}

/** A district with only the given roads: no buildings, generous bounds. */
function roadsOnly(roads: DistrictRoad[], edit?: (d: DistrictData) => void): DistrictData {
  const d = testDistrict();
  d.buildings = [];
  d.roads = roads;
  d.junctions = [];
  d.bounds = { minX: -500, maxX: 500, minZ: -500, maxZ: 500 };
  edit?.(d);
  return d;
}

function model(district: DistrictData, count: number, seed?: number): TrafficModel {
  const traffic = new TrafficModel(district, new BuildingIndex(district.buildings), seed);
  traffic.setCount(count);
  return traffic;
}

function run(traffic: TrafficModel, seconds: number, each?: (cars: TrafficCar[], step: number) => void, player: readonly [number, number] = FAR): void {
  const steps = Math.round(seconds * 30);
  for (let i = 0; i < steps; i++) {
    traffic.update(1 / 30, player[0], player[1]);
    each?.(traffic.cars.filter((c) => c.active), i);
  }
}

/** Offset of a point from a road's centre line: positive to the left of travel in the direction of the points. */
function lateral(x: number, z: number, r: DistrictRoad): number {
  let best = Infinity, side = 0;
  for (let i = 1; i < r.points.length; i++) {
    const a = r.points[i - 1]!, b = r.points[i]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-9) continue;
    const dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len;
    const t = Math.max(0, Math.min(len, (x - a[0]) * dx + (z - a[1]) * dz));
    const d = Math.hypot(a[0] + dx * t - x, a[1] + dz * t - z);
    if (d < best) {
      best = d;
      side = -(x - a[0]) * dz + (z - a[1]) * dx; // left normal of (dx, dz) is (-dz, dx)
    }
  }
  return side;
}

describe("traffic placement", () => {
  it("appears only on mapped carriageways of the listed classes", () => {
    const district = roadsOnly([
      road("way/1", [[-200, 0], [200, 0]], { class: "tertiary", width: 8 }),
      road("way/2", [[0, -200], [0, 200]], { class: "service" }),
      road("way/3", [[-200, 80], [200, 80]], { kind: "path", class: "footway", width: 2 }),
      road("way/4", [[-200, 160], [200, 160]], { class: "residential", tunnel: true }),
      road("way/5", [[-200, -160], [200, -160]], { class: "primary", elevated: true }),
      road("way/6", [[-200, -80], [200, -80]], { class: "track" }),
    ]);
    const traffic = model(district, 20);
    expect(traffic.roads.map((r) => r.id)).toEqual(["way/1"]);
    run(traffic, 30, (cars) => {
      for (const car of cars) expect(Math.abs(car.z), "off the only usable road").toBeLessThanOrEqual(4.01);
    });
    expect(traffic.activeCount).toBeGreaterThan(3);
  });

  it("never places a vehicle in a building, even one mapped across the road", () => {
    const district = testDistrict();
    // A building drawn over the east arm of the tertiary road (a mapping error traffic must survive).
    district.buildings.push({ ...district.buildings[0]!, id: "way/99", osm: { type: "way", id: 99 }, polygons: [{ outer: [[60, -10], [140, -10], [140, 10], [60, 10], [60, -10]], holes: [] }], centre: [100, 0] });
    const index = new BuildingIndex(district.buildings);
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const traffic = model(district, 30, seed);
      traffic.update(0, ...FAR); // dt 0: placement only, so every active car is exactly where it was spawned
      const placed = traffic.cars.filter((c) => c.active);
      expect(placed.length).toBeGreaterThan(5);
      for (const car of placed) expect(index.at(car.x, car.z), `seed ${seed} spawned in a building`).toBeNull();
    }
  });

  it("keeps every new vehicle outside the player's exclusion radius and apart from the others", () => {
    const district = roadsOnly([road("way/1", [[-400, 0], [400, 0]], { class: "secondary", width: 10 })]);
    for (const player of [[0, 0], [-250, 3], [390, -2]] as const) {
      for (const seed of [11, 12, 13]) {
        const traffic = model(district, 40, seed);
        traffic.update(0, player[0], player[1]);
        const placed = traffic.cars.filter((c) => c.active);
        expect(placed.length).toBeGreaterThan(10);
        for (const car of placed) expect(Math.hypot(car.x - player[0], car.z - player[1])).toBeGreaterThanOrEqual(TRAFFIC.spawnFromPlayer);
        for (let i = 0; i < placed.length; i++) {
          for (let j = i + 1; j < placed.length; j++) expect(Math.hypot(placed[i]!.x - placed[j]!.x, placed[i]!.z - placed[j]!.z)).toBeGreaterThanOrEqual(TRAFFIC.spawnFromOthers);
        }
      }
    }
    // A district entirely inside the radius gets no traffic at all rather than a car on top of the player.
    const tiny = roadsOnly([road("way/1", [[-20, 0], [20, 0]])]);
    const none = model(tiny, 10);
    run(none, 5, undefined, [0, 0]);
    expect(none.activeCount).toBe(0);
  });

  it("stays inside the district: at spawn and for as long as it drives", () => {
    const district = roadsOnly(
      [road("way/1", [[-150, 0], [150, 0]], { class: "tertiary", width: 8 }), road("way/2", [[0, -150], [0, 150]]), road("way/3", [[-150, 147], [150, 147]])],
      (d) => (d.bounds = { minX: -150, maxX: 150, minZ: -150, maxZ: 150 }),
    );
    const traffic = model(district, 25);
    traffic.update(0, ...FAR);
    // A vehicle's centre stays half a body diagonal plus a margin inside the edge, so no corner can cross it.
    const inside = 150 - traffic.safety.boundaryInset;
    expect(inside).toBeLessThan(147.5);
    for (const car of traffic.cars.filter((c) => c.active)) {
      // way/3 runs 3 m from the northern edge: nothing may be placed there.
      expect(Math.max(Math.abs(car.x), Math.abs(car.z))).toBeLessThanOrEqual(inside + 1e-9);
    }
    let furthest = 0;
    run(traffic, 90, (cars) => {
      for (const car of cars) furthest = Math.max(furthest, Math.abs(car.x), Math.abs(car.z));
    });
    // Roads run to the edge at +/-150. Vehicles turn back before it, body and all.
    expect(furthest).toBeLessThanOrEqual(inside + 1e-9);
    expect(furthest).toBeGreaterThan(inside - 3); // and they do drive out to it
    expect(traffic.safety.excluded.map((e) => [e.roadId, e.reason])).toEqual([["way/3", "lane-outside-district-boundary"]]);
  });

  it("never exceeds 40 vehicles, whatever is asked for", () => {
    const district = roadsOnly([road("way/1", [[-450, 0], [450, 0]], { class: "primary", width: 14 }), road("way/2", [[0, -450], [0, 450]], { class: "primary", width: 14 })]);
    const traffic = model(district, 0);
    for (const asked of [41, 400, 1e9, Number.MAX_SAFE_INTEGER, Infinity]) {
      traffic.setCount(asked);
      expect(traffic.cars.length, `asked for ${asked}`).toBeLessThanOrEqual(TRAFFIC.maxCount);
    }
    traffic.setCount(40);
    let most = 0;
    run(traffic, 30, (cars) => (most = Math.max(most, cars.length)));
    expect(most).toBeGreaterThan(30); // there is room for them here
    expect(most).toBeLessThanOrEqual(40);
    for (const bad of [-1, Number.NaN, -Infinity]) {
      traffic.setCount(bad);
      expect(traffic.cars).toHaveLength(0);
    }
    traffic.update(1 / 30, ...FAR); // and an empty model still updates
  });

  it("is repeatable for a seed and different for another", () => {
    const snapshot = (seed: number): string => {
      const traffic = model(testDistrict(), 8, seed);
      run(traffic, 20);
      return traffic.cars.map((c) => `${c.x.toFixed(3)},${c.z.toFixed(3)},${c.model}`).join(";");
    };
    expect(snapshot(5)).toBe(snapshot(5));
    expect(snapshot(5)).not.toBe(snapshot(6));
  });
});

describe("traffic movement", () => {
  it("follows the centre line of a winding road, on the left of its direction of travel", () => {
    const winding: Point[] = [];
    for (let i = 0; i <= 40; i++) winding.push([-400 + i * 20, Math.sin(i / 4) * 60]);
    const r = road("way/1", winding, { class: "tertiary", width: 8 });
    const traffic = model(roadsOnly([r]), 6);
    let samples = 0, worst = 0;
    run(traffic, 120, (cars, step) => {
      if (step < 90) return; // let them settle into lane after spawning
      for (const car of cars) {
        if (car.x < -340 || car.x > 340) continue; // turning round at the ends, where it crosses to the other side
        const off = lateral(car.x, car.z, r);
        // dir 1 travels with the points; left of travel is then positive. Its lane is a quarter-width from the centre.
        const signed = off * car.dir;
        worst = Math.max(worst, Math.abs(signed - 2));
        samples++;
        expect(distanceToLine(car.x, car.z, r.points)).toBeLessThanOrEqual(r.width / 2);
      }
    });
    expect(samples).toBeGreaterThan(1000);
    expect(worst, "furthest from the lane centre").toBeLessThan(1.6); // corners are cut slightly, never by a lane
  });

  it("drives the centre line itself on a one-way road, and only forwards", () => {
    const r = road("way/1", [[-400, 0], [-100, 0], [100, 40], [400, 40]], { oneway: true, class: "secondary", width: 7 });
    const traffic = model(roadsOnly([r]), 8);
    let samples = 0;
    run(traffic, 80, (cars, step) => {
      for (const car of cars) {
        expect(car.dir).toBe(1);
        if (step > 60 && car.speed > 1) {
          samples++;
          expect(Math.sin(car.heading), "heading east").toBeGreaterThan(0.8);
          expect(distanceToLine(car.x, car.z, r.points)).toBeLessThan(0.9);
        }
      }
    });
    expect(samples).toBeGreaterThan(200);
  });

  it("never turns against a one-way road at a junction, and leaves the map at a one-way dead end", () => {
    // East-west two-way street; a one-way street arrives from the south and stops at it.
    const main = road("way/1", [[-300, 0], [0, 0], [300, 0]], { class: "tertiary", width: 8 });
    const feeder = road("way/2", [[0, -300], [0, 0]], { oneway: true });
    const traffic = model(roadsOnly([main, feeder]), 12);
    let onFeeder = 0;
    run(traffic, 180, (cars) => {
      for (const car of cars) {
        if (traffic.roads[car.road]!.id !== "way/2") continue;
        onFeeder++;
        expect(car.dir, "driving the feeder backwards").toBe(1);
      }
    });
    expect(onFeeder).toBeGreaterThan(100);

    // A one-way road that simply ends: vehicles are removed there, not turned round against the arrows.
    const stub = road("way/3", [[-200, 0], [200, 0]], { oneway: true });
    const lonely = model(roadsOnly([stub]), 4);
    let reachedEnd = 0;
    run(lonely, 120, (cars) => {
      for (const car of cars) {
        expect(car.dir).toBe(1);
        if (car.x > 190) reachedEnd++;
      }
    });
    expect(reachedEnd).toBeGreaterThan(0);
  });

  it("turns round at the dead end of a two-way road and comes back on the other side", () => {
    const r = road("way/1", [[-120, 0], [120, 0]], { width: 6 });
    const traffic = model(roadsOnly([r]), 1);
    const sides = new Set<number>(), dirs = new Set<number>();
    run(traffic, 150, (cars) => {
      for (const car of cars) {
        dirs.add(car.dir);
        if (Math.abs(car.x) < 60 && car.speed > 2) sides.add(Math.sign(Math.round(car.z * 2)));
        expect(Math.abs(car.x)).toBeLessThanOrEqual(121);
      }
    });
    expect([...dirs].sort()).toEqual([-1, 1]);
    expect([...sides].sort()).toEqual([-1, 1]); // each direction keeps to its own side
  });

  it("slows for a junction and picks speed up again after it", () => {
    const main = road("way/1", [[-300, 0], [0, 0], [300, 0]], { class: "tertiary", width: 8 });
    const cross = road("way/2", [[0, -300], [0, 0], [0, 300]], { class: "tertiary", width: 8 });
    const traffic = model(roadsOnly([main, cross]), 5);
    let fastNear = 0, fastAway = 0, slowNear = 0;
    run(traffic, 240, (cars, step) => {
      if (step < 150) return;
      for (const car of cars) {
        const d = Math.hypot(car.x, car.z);
        if (d < 3.5) {
          fastNear = Math.max(fastNear, car.speed);
          slowNear++;
        } else if (d > 80) fastAway = Math.max(fastAway, car.speed);
      }
    });
    expect(slowNear).toBeGreaterThan(5); // cars did pass through the junction
    // Through the junction itself it is well under cruising speed (it is already pulling away as it leaves).
    expect(fastNear).toBeLessThanOrEqual(TRAFFIC.junctionSpeed + 2.5);
    expect(fastNear).toBeLessThan(TRAFFIC.speed.tertiary! * 0.7);
    expect(fastAway).toBeGreaterThan(TRAFFIC.speed.tertiary! * 0.8);
    expect(fastAway).toBeLessThanOrEqual(TRAFFIC.speed.tertiary! * 1.1 + 0.01);
  });

  it("slows behind a slower vehicle and behind the player instead of driving through them", () => {
    const r = road("way/1", [[-450, 0], [450, 0]], { oneway: true, class: "secondary", width: 7 });
    const traffic = model(roadsOnly([r]), 2);
    traffic.update(0, ...FAR);
    const [lead, follower] = traffic.cars as [TrafficCar, TrafficCar];
    // Put them in a known arrangement: a crawling car 40 m ahead of a normal one.
    Object.assign(lead, { active: true, road: 0, from: 0, dir: 1, along: 240, x: -210, z: 0, heading: Math.PI / 2, speed: 2, pace: 0.2 });
    Object.assign(follower, { active: true, road: 0, from: 0, dir: 1, along: 200, x: -250, z: 0, heading: Math.PI / 2, speed: 11, pace: 1.05 });
    let closest = Infinity, followerTop = 0;
    run(traffic, 25, (_cars, step) => {
      if (!lead.active || !follower.active) return;
      closest = Math.min(closest, lead.x - follower.x);
      if (step > 300) followerTop = Math.max(followerTop, follower.speed);
    });
    expect(closest, "gap to the car in front").toBeGreaterThan(4.6); // more than a car length: no overlap
    expect(followerTop).toBeLessThan(TRAFFIC.speed.secondary! * 0.2 + 1.5); // it has matched the slow car

    // The player parked in the lane: the car stops short and waits.
    const solo = model(roadsOnly([r]), 1);
    solo.update(0, ...FAR);
    const car = solo.cars[0]!;
    Object.assign(car, { active: true, road: 0, from: 0, dir: 1, along: 150, x: -300, z: 0, heading: Math.PI / 2, speed: 10 });
    let nearest = Infinity;
    for (let i = 0; i < 30 * 30 && car.active; i++) {
      solo.update(1 / 30, -200, 0.4);
      nearest = Math.min(nearest, Math.hypot(car.x + 200, car.z - 0.4));
    }
    expect(nearest).toBeGreaterThan(4.5);
    expect(nearest).toBeLessThan(TRAFFIC.gap + 2);
    // A player beside the road (not in the lane) is not braked for.
    const passing = model(roadsOnly([r]), 1);
    passing.update(0, ...FAR);
    const p = passing.cars[0]!;
    Object.assign(p, { active: true, road: 0, from: 0, dir: 1, along: 150, x: -300, z: 0, heading: Math.PI / 2, speed: 10 });
    for (let i = 0; i < 30 * 20; i++) passing.update(1 / 30, -200, 6);
    expect(p.x).toBeGreaterThan(-190);
  });

  it("moves smoothly: no jumps in position or heading between frames, at any frame rate", () => {
    for (const fps of [20, 30, 60, 144]) {
      const traffic = model(testDistrict(), 6, 3);
      const last = new Map<TrafficCar, { x: number; z: number; heading: number }>();
      let worstStep = 0, worstTurn = 0;
      for (let i = 0; i < fps * 40; i++) {
        traffic.update(1 / fps, ...FAR);
        for (const car of traffic.cars) {
          const before = last.get(car);
          if (car.active && before) {
            worstStep = Math.max(worstStep, Math.hypot(car.x - before.x, car.z - before.z) * fps);
            let turn = Math.abs(car.heading - before.heading);
            if (turn > Math.PI) turn = Math.PI * 2 - turn;
            worstTurn = Math.max(worstTurn, turn * fps);
          }
          if (car.active) last.set(car, { x: car.x, z: car.z, heading: car.heading });
          else last.delete(car); // a respawn is a new car, not a jump
        }
      }
      expect(worstStep, `${fps} fps: metres per second between frames`).toBeLessThan(TRAFFIC.speed.tertiary! * 1.1 + 8);
      // Headings ease toward the new direction; an instant U-turn would be pi * fps (63 rad/s at 20 fps).
      expect(worstTurn, `${fps} fps: radians per second`).toBeLessThan(6 * Math.PI + 0.5);
    }
    // A long stall (a background tab) is treated as one short step, not a leap down the road.
    const traffic = model(testDistrict(), 4, 3);
    run(traffic, 10);
    const before = traffic.cars.map((c) => [c.x, c.z]);
    traffic.update(30, ...FAR);
    traffic.cars.forEach((c, i) => {
      if (c.active) expect(Math.hypot(c.x - before[i]![0]!, c.z - before[i]![1]!)).toBeLessThan(2);
    });
  });
});

describe("traffic on awkward road data", () => {
  it("ignores roads it cannot follow: too short, broken coordinates, no width", () => {
    const bad = [
      road("way/1", [[0, 0], [0, 0]]),
      road("way/2", [[5, 5]]),
      road("way/3", [[0, 0], [Number.NaN, 4], [50, 50]]),
      road("way/4", [[0, 0], [Infinity, 0]]),
      road("way/5", [[0, 0], [3, 0], [6, 0]]), // 6 m: shorter than a car needs
      road("way/6", [[0, 0], [100, 0]], { width: Number.NaN }),
      road("way/7", [[0, 0], [100, 0]], { width: 0 }),
      { ...road("way/8", [[0, 0], [100, 0]]), points: undefined as unknown as Point[] },
    ];
    const traffic = model(roadsOnly(bad), 10);
    expect(traffic.roads).toHaveLength(0);
    expect(traffic.cars).toHaveLength(0);
    run(traffic, 2);
    expect(traffic.activeCount).toBe(0);
    // One sound road among them still gets traffic, and nothing ends up at a non-finite position.
    const mixed = model(roadsOnly([...bad, road("way/9", [[-300, 100], [300, 100]])]), 10);
    expect(mixed.roads.map((r) => r.id)).toEqual(["way/9"]);
    run(mixed, 30, (cars) => {
      for (const car of cars) expect([car.x, car.z, car.heading, car.speed].every(Number.isFinite)).toBe(true);
    });
    expect(mixed.activeCount).toBeGreaterThan(0);
  });

  it("copes with a wrong stated length, repeated points and very short segments", () => {
    const points: Point[] = [[-300, 0], [-300, 0], [-100, 0], [-100, 0.001], [-99.9, 0.001], [-99.8, 0], [100, 0], [100, 0], [300, 0]];
    const r = { ...road("way/1", points, { class: "tertiary", width: 8 }), length: Number.NaN };
    const traffic = model(roadsOnly([r, { ...road("way/2", [[0, -300], [0, 300]]), length: -5 }]), 8);
    let moved = 0;
    const started = Date.now();
    run(traffic, 120, (cars) => {
      for (const car of cars) {
        expect([car.x, car.z, car.heading, car.speed, car.along].every(Number.isFinite)).toBe(true);
        if (car.speed > 3) moved++;
      }
    });
    expect(moved).toBeGreaterThan(500);
    expect(Date.now() - started, "an update must not spin on tiny segments").toBeLessThan(5000);
    // Both roads carried traffic: the missing length did not starve one of them.
    const used = new Set<string>();
    run(traffic, 60, (cars) => cars.forEach((c) => used.add(traffic.roads[c.road]!.id)));
    expect([...used].sort()).toEqual(["way/1", "way/2"]);
  });

  it("handles a narrow lane, a dead-end stub, a closed loop and roads that do not connect", () => {
    const loop: Point[] = [];
    for (let i = 0; i <= 24; i++) loop.push([200 + Math.cos((i / 24) * Math.PI * 2) * 60, 200 + Math.sin((i / 24) * Math.PI * 2) * 60]);
    loop[24] = loop[0]!;
    const roads = [
      road("way/1", [[-300, 0], [300, 0]], { width: 2.8, class: "living_street" }), // narrower than two lanes
      road("way/2", [[-300, -200], [-280, -200], [-260, -200]]), // a 40 m stub joined to nothing
      road("way/3", loop, { oneway: true }),
      road("way/4", [[-100, 300], [100, 300]]), // an island
      road("way/5", [[0, 0], [0, 12]]), // a short spur off way/1 that way/1 has no point at: disconnected intersection
    ];
    const traffic = model(roadsOnly(roads), 16);
    const seen = new Set<string>();
    run(traffic, 200, (cars) => {
      for (const car of cars) {
        const r = traffic.roads[car.road]!;
        seen.add(r.id);
        expect([car.x, car.z].every(Number.isFinite)).toBe(true);
        // Always on the surface of the road it says it is on.
        expect(distanceToLine(car.x, car.z, r.points), `${r.id}`).toBeLessThanOrEqual(r.width / 2 + 0.6);
        if (r.id === "way/1") expect(Math.abs(car.z)).toBeLessThanOrEqual(1.4 + 0.01); // within a 2.8 m lane
        if (r.id === "way/3") expect(car.dir).toBe(1);
      }
    });
    expect(seen.has("way/1") && seen.has("way/3") && seen.has("way/4")).toBe(true);
    // A car on the closed one-way loop keeps going round; it is not removed at the join.
    const round = model(roadsOnly([roads[2]!]), 1);
    let active = 0;
    run(round, 200, (cars) => (active += cars.length));
    expect(active).toBeGreaterThan(200 * 30 * 0.9);
  });

  it("gives up on a vehicle that is stuck, and replaces it", () => {
    const r = road("way/1", [[-400, 0], [400, 0]], { oneway: true });
    const traffic = model(roadsOnly([r]), 1);
    traffic.update(0, ...FAR);
    const car = traffic.cars[0]!;
    Object.assign(car, { active: true, road: 0, from: 0, dir: 1, along: 100, x: -300, z: 0, heading: Math.PI / 2, speed: 0, pace: 0 }); // pace 0: it will never move
    let wentInactive = false;
    for (let i = 0; i < 30 * (TRAFFIC.stuckSeconds + 2); i++) {
      traffic.update(1 / 30, ...FAR);
      if (car.x !== -300) wentInactive = true;
    }
    expect(wentInactive, "the stuck car was respawned elsewhere").toBe(true);
  });
});

describe("traffic visuals", () => {
  let engine: NullEngine;
  beforeEach(() => {
    engine = nullEngine();
  });
  afterEach(() => engine.dispose());

  it("draws one car per vehicle, reuses them, hides inactive ones, and frees them with the scene", () => {
    const scene = new Scene(engine);
    const factory = new CarFactory(scene);
    const traffic = model(testDistrict(), 10);
    const view = new TrafficView(traffic, factory, 0.03);
    const cars = (): number => scene.transformNodes.filter((n) => n.name.startsWith("traffic_")).length;
    run(traffic, 5, () => view.update());
    expect(cars()).toBe(10);
    // Each visual stands where its vehicle is, on the road surface, facing its heading.
    traffic.cars.forEach((car, i) => {
      const node = scene.getTransformNodeByName(`traffic_${i}`)!;
      expect(node.isEnabled()).toBe(car.active);
      if (!car.active) return;
      expect([node.position.x, node.position.y, node.position.z]).toEqual([car.x, 0.03, car.z]);
      expect(node.rotation.y).toBe(car.heading);
    });
    // The four traffic models all appear when there are at least four vehicles.
    const bodies = new Set(scene.meshes.filter((m) => /^traffic_\d+:paint$/.test(m.name)).map((m) => m.getTotalVertices()));
    expect(bodies.size).toBe(TRAFFIC_CARS.length);

    const meshes = scene.meshes.length, materials = scene.materials.length;
    run(traffic, 60, () => view.update());
    expect(cars()).toBe(10); // a minute of respawns created nothing new
    expect(scene.meshes.length).toBe(meshes);
    expect(scene.materials.length).toBe(materials);

    traffic.setCount(3);
    view.update();
    const shown = scene.transformNodes.filter((n) => n.name.startsWith("traffic_") && n.isEnabled()).length;
    expect(shown).toBeLessThanOrEqual(3);
    traffic.setCount(10);
    run(traffic, 3, () => view.update());
    expect(cars()).toBe(10); // the hidden ones were reused, not rebuilt

    scene.dispose();
    expect(scene.meshes).toHaveLength(0);
    expect(scene.materials).toHaveLength(0);
    expect(engine.scenes).toHaveLength(0);
  });

  it("turns the wheels of moving traffic and not of waiting traffic", () => {
    const scene = new Scene(engine);
    const r = road("way/1", [[-400, 0], [400, 0]], { oneway: true });
    const traffic = model(roadsOnly([r]), 1);
    const view = new TrafficView(traffic, new CarFactory(scene), 0.03);
    run(traffic, 10, () => view.update());
    const wheel = scene.getMeshByName("traffic_0:wheel2")!;
    const a = wheel.rotation.x;
    run(traffic, 1, () => view.update());
    expect(wheel.rotation.x).not.toBe(a);
    const car = traffic.cars[0]!;
    car.pace = 0;
    run(traffic, 4, () => view.update()); // brakes to a stop
    const b = wheel.rotation.x;
    run(traffic, 1, () => view.update());
    expect(wheel.rotation.x).toBeCloseTo(b, 3);
  });
});
