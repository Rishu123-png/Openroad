import { describe, expect, it } from "vitest";
import { BuildingIndex } from "../src/game/district/BuildingIndex";
import type { DistrictData } from "../src/game/district/types";
import { bodiesOverlap, compass, movement } from "../src/game/traffic/junctions";
import { TRAFFIC, TrafficModel, type TrafficCar } from "../src/game/traffic/TrafficModel";
import { edgeDistrict } from "./fixtures/edgeDistrict";
import { hostileDistrict } from "./fixtures/hostileDistrict";
import { CROSS, crossroads, junctionDistrict, junctionRoad, ladder, NARROW, narrowLane, SHAPES, shapes } from "./fixtures/junctionDistrict";
import { trafficReport, vehicleCollisions } from "./support/districtFile";
import { nullEngine } from "./support/harness";

/**
 * Junctions and vehicles meeting vehicles. Everything here is SYNTHETIC and
 * scripted: vehicles are put at chosen places with chosen routes, so each
 * test runs the same way every time. The real Alpha 1 file is tested
 * separately (npm run test:real).
 */
const FAR: readonly [number, number] = [5000, 5000];
const DT = 1 / 30;

type Arm = "west" | "east" | "south" | "north";
/** Where a vehicle approaching the crossroads from each side is, and the exit that takes it out of each side. */
const APPROACH: Record<Arm, { road: string; from: number; dir: 1 | -1 }> = {
  west: { road: CROSS.eastWest, from: 0, dir: 1 },
  east: { road: CROSS.eastWest, from: 2, dir: -1 },
  south: { road: CROSS.northSouth, from: 0, dir: 1 },
  north: { road: CROSS.northSouth, from: 2, dir: -1 },
};
const EXIT: Record<Arm, { road: string; dir: 1 | -1 }> = {
  east: { road: CROSS.eastWest, dir: 1 },
  west: { road: CROSS.eastWest, dir: -1 },
  north: { road: CROSS.northSouth, dir: 1 },
  south: { road: CROSS.northSouth, dir: -1 },
};

function scripted(d: DistrictData, count: number): TrafficModel {
  const traffic = new TrafficModel(d, new BuildingIndex(d.buildings), 7);
  traffic.setCount(count);
  traffic.update(0, ...FAR);
  for (const car of traffic.cars) car.pace = 1;
  return traffic;
}
/** Puts vehicle `i` on an arm of the crossroads, `distance` metres from its middle, bound for the `to` arm. */
function approach(traffic: TrafficModel, i: number, arm: Arm, distance: number, to: Arm, speed = 7): TrafficCar {
  const a = APPROACH[arm];
  expect(traffic.place(i, a.road, a.from, a.dir, 200 - distance, speed)).toBe(true);
  expect(traffic.route(i, EXIT[to].road, EXIT[to].dir), `route from the ${arm} to the ${to}`).toBe(true);
  return traffic.cars[i]!;
}
interface Log {
  overlaps: number;
  /** Frame at which each vehicle's centre first came within 1.5 m of the middle of the crossroads... */
  crossed: Map<number, number>;
  /** ...and the hardest braking each vehicle did, in m/s2. */
  braking: Map<number, number>;
  /** Frames in which each vehicle was inside the conflict area without holding the junction. */
  trespass: number;
  /** The most vehicles holding the junction at once. */
  mostHolders: number;
  closest: number;
}
function run(traffic: TrafficModel, seconds: number, each?: (frame: number) => void): Log {
  const log: Log = { overlaps: 0, crossed: new Map(), braking: new Map(), trespass: 0, mostHolders: 0, closest: Infinity };
  const junction = traffic.junctions[0];
  for (let frame = 1; frame <= seconds / DT; frame++) {
    const before = traffic.cars.map((c) => c.speed);
    traffic.update(DT, ...FAR);
    log.overlaps += vehicleCollisions(traffic, frame).length;
    traffic.cars.forEach((c, i) => {
      if (!c.active) return;
      log.braking.set(i, Math.max(log.braking.get(i) ?? 0, (before[i]! - c.speed) / DT));
      if (!junction) return;
      const d = Math.hypot(c.x - junction.x, c.z - junction.z);
      if (d < 1.5 + 1.75 && !log.crossed.has(i)) log.crossed.set(i, frame);
      if (d < junction.radius - 0.5 && !junction.holders.includes(i)) log.trespass++;
      for (let j = i + 1; j < traffic.cars.length; j++) if (traffic.cars[j]!.active) log.closest = Math.min(log.closest, Math.hypot(c.x - traffic.cars[j]!.x, c.z - traffic.cars[j]!.z));
    });
    if (junction) log.mostHolders = Math.max(log.mostHolders, junction.holders.length);
    each?.(frame);
  }
  return log;
}

describe("vehicle bodies (synthetic)", () => {
  it("overlap is tested on the whole rectangle, with the real size and heading", () => {
    const [l, w] = [4.7, 1.86];
    // Nose to tail in one lane: 4.7 m apart touches, further does not.
    expect(bodiesOverlap(0, 0, 0, l, w, 0, 4.6, 0, l, w)).toBe(true);
    expect(bodiesOverlap(0, 0, 0, l, w, 0, 4.8, 0, l, w)).toBe(false);
    // Side by side: 1.86 m apart touches.
    expect(bodiesOverlap(0, 0, 0, l, w, 1.8, 0, 0, l, w)).toBe(true);
    expect(bodiesOverlap(0, 0, 0, l, w, 1.9, 0, 0, l, w)).toBe(false);
    // Centres 3 m apart: clear when both face along the gap's side, not when one is turned across it.
    expect(bodiesOverlap(0, 0, 0, l, w, 3, 0, 0, l, w)).toBe(false);
    expect(bodiesOverlap(0, 0, 0, l, w, 3, 0, Math.PI / 2, l, w)).toBe(true);
    // A corner into a side: centres further apart than either half width, found only by the rectangle test.
    expect(bodiesOverlap(0, 0, 0, l, w, 2.2, 2.6, Math.PI / 4, l, w)).toBe(true);
    expect(bodiesOverlap(0, 0, 0, l, w, 3.6, 4.0, Math.PI / 4, l, w)).toBe(false);
    // The margin widens the first body on every side.
    expect(bodiesOverlap(0, 0, 0, l, w, 1.95, 0, 0, l, w, 0.15)).toBe(true);
    // It does not matter which is named first.
    for (const [x, z, h] of [[2.2, 2.6, 0.7], [1, 4, 2], [-2, 1, -1.2], [3.4, 0.2, 1.5]] as const) expect(bodiesOverlap(0, 0, 0.3, l, w, x, z, h, 3.86, 1.735)).toBe(bodiesOverlap(x, z, h, 3.86, 1.735, 0, 0, 0.3, l, w));
  });
});

describe("finding junctions (synthetic)", () => {
  it("a junction is a point where three or more drivable segments meet: bends, joins and dead ends are not", () => {
    const traffic = scripted(shapes(), 0);
    const at = traffic.junctions.map((j) => [j.x, j.z, j.arms.length]);
    // The T where way/413 meets way/410, and the crossroads of way/414 and way/410. Nothing else.
    expect(at.sort((p, q) => p[0]! - q[0]!)).toEqual([[-100, -100, 3], [0, -100, 4]]);
    // Not the bends of way/410 at (-200, -200) and (-200, -100), not the end-to-end joins at (100, -100) and (200, -100), not the dead ends.
    for (const [x, z] of [[-200, -200], [-200, -100], [100, -100], [200, -100], [-300, -200], [-100, 100], [200, 100]]) expect(traffic.junctions.some((j) => j.x === x && j.z === z)).toBe(false);
    const t = traffic.junctions.find((j) => j.x === -100)!;
    expect(t.id).toBe("junction@-100.0,-100.0");
    expect(t.arms.map((a) => [a.roadId, compass(a.bearing)]).sort()).toEqual([[SHAPES.bend, "east"], [SHAPES.bend, "west"], [SHAPES.stem, "north"]]);
    // The conflict area is the widest arm's half width and 1.5 m more, at least 4.5 m.
    expect(t.radius).toBe(5);
  });

  it("a segment excluded from traffic is not an arm, and a repeated point is not a junction", () => {
    const d = junctionDistrict([
      junctionRoad(420, [[-200, 0], [0, 0], [0, 0], [200, 0]]), // the middle point is written twice
      junctionRoad(421, [[0, 0], [0, 100], [0, 200]]),
    ]);
    expect(scripted(d, 0).junctions.map((j) => j.arms.length)).toEqual([3]);
    // The same, with a building across the side road's first segment: that segment is excluded, and the T is gone.
    const blocked = junctionDistrict([junctionRoad(420, [[-200, 0], [0, 0], [200, 0]]), junctionRoad(421, [[0, 0], [0, 100], [0, 200]])]);
    blocked.buildings = [{ ...hostileDistrict().buildings[0]!, id: "way/900", polygons: [{ outer: [[-10, 40], [10, 40], [10, 60], [-10, 60], [-10, 40]], holes: [] }], centre: [0, 50], area: 400 }];
    const traffic = scripted(blocked, 0);
    expect(traffic.safety.excluded.map((e) => [e.roadId, e.segment])).toEqual([["way/421", 0]]);
    expect(traffic.junctions).toEqual([]);
  });

  it("names the turn a vehicle makes, keeping left", () => {
    // Travelling east (bearing pi/2): north is a left turn, south a right turn.
    expect(movement(Math.PI / 2, Math.PI / 2)).toBe("straight");
    expect(movement(Math.PI / 2, 0)).toBe("left");
    expect(movement(Math.PI / 2, Math.PI)).toBe("right");
    expect(movement(Math.PI / 2, -Math.PI / 2)).toBe("u-turn");
    expect(movement(-3, 3)).toBe("straight"); // across the +/- pi seam
    expect([0, Math.PI / 2, Math.PI, -Math.PI / 2, Math.PI / 4].map(compass)).toEqual(["north", "east", "south", "west", "north-east"]);
  });

  it("no vehicle is placed in a junction or at its mouth", () => {
    const d = crossroads();
    for (const seed of [1, 2, 3, 4, 5]) {
      const traffic = new TrafficModel(d, new BuildingIndex([]), seed);
      traffic.setCount(40);
      traffic.update(0, ...FAR);
      for (const c of traffic.cars) if (c.active) expect(Math.hypot(c.x, c.z)).toBeGreaterThanOrEqual(5 + TRAFFIC.spawnFromJunction);
    }
  });
});

describe("1 and 3. conflicting directions: one vehicle yields (synthetic)", () => {
  it("the first to arrive crosses; the other slows, stops short of the conflict area and waits", () => {
    const traffic = scripted(crossroads(), 2);
    const a = approach(traffic, 0, "west", 40, "east");
    const b = approach(traffic, 1, "south", 55, "north");
    const junction = traffic.junctions[0]!;
    let bNearest = Infinity, bSlowest = Infinity, sawWaiting = false;
    const log = run(traffic, 30, () => {
      if (junction.holders.includes(0) && !junction.holders.includes(1)) {
        // While A holds the junction, B's front stays out of the conflict area.
        bNearest = Math.min(bNearest, Math.hypot(b.x, b.z) - b.length / 2);
        bSlowest = Math.min(bSlowest, b.speed);
        const status = traffic.junctionStatus()[0]!;
        expect(status.holders.map((h) => [h.car, h.approach, h.movement])).toEqual([[0, `from the west on ${CROSS.eastWest}`, "straight"]]);
        if (status.waiting.length > 0 && status.waiting[0]!.reason !== null) {
          sawWaiting = true;
          expect(status.waiting[0]).toMatchObject({ car: 1, approach: `from the south on ${CROSS.northSouth}`, movement: "straight", reason: "junction-occupied", behind: 0 });
          expect(status.waiting[0]!.waited).toBeGreaterThanOrEqual(0);
        }
      }
    });
    expect(log.overlaps).toBe(0);
    expect(log.trespass).toBe(0);
    expect(log.mostHolders).toBe(1);
    // A first, then B.
    expect(log.crossed.get(0)!).toBeLessThan(log.crossed.get(1)!);
    expect(bNearest).toBeGreaterThan(junction.radius);
    expect(bSlowest).toBeLessThan(3); // it did slow for A
    expect(sawWaiting).toBe(true);
    // B slowed without an emergency stop, and the body check never had to refuse a move.
    expect(log.braking.get(1)!).toBeLessThanOrEqual(TRAFFIC.braking + 1e-6);
    expect(traffic.junctionStats.blockedMoves).toBe(0);
    expect(traffic.junctionStats.forcedEntries).toBe(0);
    // Both carried on, out of the far side.
    expect(a.x).toBeGreaterThan(20);
    expect(b.z).toBeGreaterThan(20);
    // The record says who gave way to whom, where, and why.
    const gaveWay = traffic.events.find((e) => e.kind === "yield")!;
    expect(gaveWay).toMatchObject({ car: 1, junction: "junction@0.0,0.0", approach: `from the south on ${CROSS.northSouth}`, movement: "straight", reason: "junction-occupied", other: 0 });
  });

  it("holds for every pair of conflicting approaches and turns", () => {
    const arms: Arm[] = ["west", "north", "east", "south"];
    let cases = 0;
    for (const from0 of arms) for (const to0 of arms) for (const from1 of arms) for (const to1 of arms) {
      if (from0 === to0 || from1 === to1 || from0 >= from1) continue; // no U-turns, each pair of approaches once
      const traffic = scripted(crossroads(), 2);
      approach(traffic, 0, from0, 42, to0);
      approach(traffic, 1, from1, 45, to1);
      const log = run(traffic, 25);
      const label = `${from0}>${to0} with ${from1}>${to1}`;
      expect(log.overlaps, label).toBe(0);
      expect(log.trespass, label).toBe(0);
      expect(log.crossed.size, label).toBe(2);
      expect(traffic.junctionStats.blockedMoves, label).toBe(0);
      expect(traffic.junctionStats.stuckReplacements, label).toBe(0);
      // Only the two directions of one straight route may be in the junction together.
      const across: Record<Arm, Arm> = { west: "east", east: "west", north: "south", south: "north" };
      const together = from0 === to1 && from1 === to0 && to0 === across[from0];
      expect(log.mostHolders, label).toBe(together ? 2 : 1);
      cases++;
    }
    expect(cases).toBe(54);
  });
});

describe("2. arriving at about the same time (synthetic)", () => {
  const order = (first: Arm, firstAt: number, second: Arm, secondAt: number): number[] => {
    const traffic = scripted(crossroads(), 2);
    // The same size, so that both stop the same distance from the middle.
    for (const car of traffic.cars) Object.assign(car, { length: 4.33, width: 1.79 });
    approach(traffic, 0, first, firstAt, first === "west" ? "east" : first === "east" ? "west" : first === "south" ? "north" : "south", 4);
    approach(traffic, 1, second, secondAt, second === "west" ? "east" : second === "east" ? "west" : second === "south" ? "north" : "south", 4);
    const log = run(traffic, 30);
    expect(log.overlaps).toBe(0);
    expect(log.trespass).toBe(0);
    expect(log.crossed.size).toBe(2);
    return [...log.crossed].sort((p, q) => p[1] - q[1]).map(([car]) => car);
  };

  it("an exact tie goes to the same vehicle every time: the approach that comes first clockwise from west", () => {
    // Same distance, same speed, same size of step: they arrive in the same frame.
    expect(order("south", 30, "west", 30)).toEqual([1, 0]); // west before south
    expect(order("west", 30, "south", 30)).toEqual([0, 1]); // and it is the approach that decides, not the vehicle number
    expect(order("north", 30, "east", 30)).toEqual([0, 1]); // north before east
    expect(order("east", 30, "north", 30)).toEqual([1, 0]);
    expect(order("south", 30, "west", 30)).toEqual(order("south", 30, "west", 30)); // repeatable
  });

  it("a head start of half a metre decides it the other way", () => {
    expect(order("south", 29.5, "west", 30)).toEqual([0, 1]);
    expect(order("south", 30, "west", 29.5)).toEqual([1, 0]);
  });
});

describe("4. proceeding once the junction is clear (synthetic)", () => {
  it("the waiting vehicle enters as soon as the other has left, and the wait is recorded", () => {
    const traffic = scripted(crossroads(), 2);
    approach(traffic, 0, "west", 30, "east");
    const b = approach(traffic, 1, "south", 34, "north");
    const junction = traffic.junctions[0]!;
    let released = -1, entered = -1;
    const log = run(traffic, 30, (frame) => {
      if (released < 0 && log_crossed(traffic, 0) && !junction.holders.includes(0)) released = frame;
      if (entered < 0 && junction.holders.includes(1)) entered = frame;
    });
    function log_crossed(t: TrafficModel, i: number): boolean {
      return t.cars[i]!.x > 0;
    }
    expect(log.overlaps).toBe(0);
    expect(released).toBeGreaterThan(0);
    // B is granted the junction no earlier than A gives it up, and within a second of that.
    expect(entered).toBeGreaterThanOrEqual(released);
    expect((entered - released) * DT).toBeLessThan(1);
    const enter = traffic.events.find((e) => e.kind === "enter" && e.car === 1)!;
    expect(enter.waited).toBeGreaterThan(0.5);
    expect(enter.junction).toBe(junction.id);
    expect(traffic.junctionStats.longestWait).toBeCloseTo(enter.waited, 6);
    expect(b.z).toBeGreaterThan(20);
    expect(junction.holders).toEqual([]); // and it is given up again
    expect(traffic.junctionStatus()).toEqual([]);
  });
});

describe("5. turning across another vehicle's path (synthetic)", () => {
  it("a right turn across oncoming traffic waits for it; the two never share the junction", () => {
    const traffic = scripted(crossroads(), 2);
    // Keeping left, a right turn crosses the lane of traffic coming the other way.
    const turning = approach(traffic, 0, "west", 44, "south");
    const oncoming = approach(traffic, 1, "east", 40, "west");
    const log = run(traffic, 30);
    expect(log.overlaps).toBe(0);
    expect(log.trespass).toBe(0);
    expect(log.mostHolders).toBe(1);
    expect(log.crossed.get(1)!).toBeLessThan(log.crossed.get(0)!);
    expect(traffic.events.find((e) => e.kind === "yield")).toMatchObject({ car: 0, movement: "right", approach: `from the west on ${CROSS.eastWest}`, other: 1 });
    expect(turning.z).toBeLessThan(-20); // it made its turn, southwards
    expect(Math.abs(turning.x)).toBeLessThan(3);
    expect(oncoming.x).toBeLessThan(-20);
    expect(traffic.junctionStats.blockedMoves).toBe(0);
  });

  it("two vehicles turning right from opposite sides take turns", () => {
    const traffic = scripted(crossroads(), 2);
    approach(traffic, 0, "west", 40, "south");
    approach(traffic, 1, "east", 40, "north");
    const log = run(traffic, 30);
    expect(log.overlaps).toBe(0);
    expect(log.mostHolders).toBe(1);
    expect(log.crossed.size).toBe(2);
  });

  it("straight on in opposite directions does not conflict: both cross together, each in its own lane", () => {
    const traffic = scripted(crossroads(), 2);
    approach(traffic, 0, "west", 40, "east");
    approach(traffic, 1, "east", 40, "west");
    const log = run(traffic, 20);
    expect(log.overlaps).toBe(0);
    expect(log.mostHolders).toBe(2);
    expect(traffic.junctionStats.yields).toBe(0);
    expect(Math.abs(log.crossed.get(0)! - log.crossed.get(1)!)).toBeLessThan(5);
    expect(log.closest).toBeGreaterThan(3); // a lane apart as they pass
  });

  it("on roads too narrow to pass on, the same two take turns instead", () => {
    const traffic = scripted(crossroads({ width: 3.6 }), 2);
    expect(traffic.junctions[0]!.arms.every((a) => !a.wide)).toBe(true);
    approach(traffic, 0, "west", 40, "north");
    approach(traffic, 1, "north", 44, "west");
    const log = run(traffic, 30);
    expect(log.overlaps).toBe(0);
    expect(log.mostHolders).toBe(1);
  });
});

describe("6. several vehicles waiting (synthetic)", () => {
  it("one from every side at once, with a second behind each: all eight cross, in order of arrival, none removed", () => {
    const traffic = scripted(crossroads(), 8);
    const arms: Arm[] = ["west", "south", "east", "north"];
    const exits: Arm[] = ["east", "west", "south", "east"]; // straight, left... a mixture, with two crossing turns
    arms.forEach((arm, n) => {
      approach(traffic, n, arm, 30 + n * 3, exits[n]!);
      approach(traffic, n + 4, arm, 45 + n * 3, exits[(n + 1) % 4] === arm ? exits[n]! : exits[(n + 1) % 4]!);
    });
    const log = run(traffic, 55); // long enough for all eight, not long enough for any to come back
    expect(log.overlaps).toBe(0);
    expect(log.trespass).toBe(0);
    expect(log.crossed.size).toBe(8);
    // The front four went in the order they arrived; each second vehicle went after the one in front of it.
    const sequence = [...log.crossed].sort((p, q) => p[1] - q[1]).map(([car]) => car);
    expect(sequence.filter((c) => c < 4)).toEqual([0, 1, 2, 3]);
    for (let n = 0; n < 4; n++) expect(log.crossed.get(n)!).toBeLessThan(log.crossed.get(n + 4)!);
    // Nobody waited anything like the time allowed, and nobody had to be rescued.
    expect(traffic.junctionStats.longestWait).toBeLessThan(TRAFFIC.stuckSeconds);
    expect(traffic.junctionStats).toMatchObject({ stuckReplacements: 0, forcedEntries: 0, blockedMoves: 0 });
    expect(traffic.removalCount).toBe(0);
    expect(traffic.cars.every((c) => c.active)).toBe(true);
    expect(traffic.junctions[0]!.holders).toEqual([]);
  });

  it("a crossroads kept busy from all four sides for five minutes never locks", () => {
    const d = crossroads();
    const traffic = new TrafficModel(d, new BuildingIndex([]), 3);
    traffic.setCount(24); // 1,600 m of lane: a vehicle every 67 m
    let overlaps = 0, entriesAtHalf = 0;
    for (let frame = 1; frame <= 300 / DT; frame++) {
      traffic.update(DT, ...FAR);
      overlaps += vehicleCollisions(traffic, frame).length;
      if (frame === 150 / DT) entriesAtHalf = traffic.junctionStats.entries;
    }
    expect(overlaps).toBe(0);
    // It kept flowing in the second half as in the first.
    expect(entriesAtHalf).toBeGreaterThan(20);
    expect(traffic.junctionStats.entries - entriesAtHalf).toBeGreaterThan(20);
    expect(traffic.junctionStats.stuckReplacements).toBe(0);
    expect(traffic.removalCount).toBe(0);
    expect(traffic.activeCount).toBe(24);
  });
});

describe("7. following through a junction (synthetic)", () => {
  it("three in a line cross one after another, keeping their distance, some turning off", () => {
    const traffic = scripted(crossroads(), 3);
    approach(traffic, 0, "west", 30, "east");
    approach(traffic, 1, "west", 42, "north");
    approach(traffic, 2, "west", 54, "east");
    const log = run(traffic, 40);
    expect(log.overlaps).toBe(0);
    expect(log.trespass).toBe(0);
    expect([...log.crossed].sort((p, q) => p[1] - q[1]).map(([car]) => car)).toEqual([0, 1, 2]);
    // Never closer than a car's length and a little: no bumper touches.
    expect(log.closest).toBeGreaterThan(4.9);
    expect(traffic.junctionStats.blockedMoves).toBe(0);
    for (const braking of log.braking.values()) expect(braking).toBeLessThanOrEqual(TRAFFIC.braking + 1e-6);
    expect(traffic.cars[1]!.z).toBeGreaterThan(20); // the middle one turned north
    expect(traffic.cars[2]!.x).toBeGreaterThan(20);
  });

  it("a queue behind a stopped vehicle stops without touching, each a gap behind the next", () => {
    const traffic = scripted(crossroads(), 4);
    const lead = approach(traffic, 0, "west", 120, "east", 0);
    lead.pace = 0; // broken down, well before the junction
    for (let n = 1; n < 4; n++) approach(traffic, n, "west", 120 + n * 14, "east");
    const log = run(traffic, 9);
    expect(log.overlaps).toBe(0);
    const xs = traffic.cars.map((c) => c.x);
    for (let n = 1; n < 4; n++) {
      const gap = xs[n - 1]! - xs[n]! - (traffic.cars[n - 1]!.length + traffic.cars[n]!.length) / 2;
      expect(gap).toBeGreaterThan(TRAFFIC.minGap - 0.01);
      expect(gap).toBeLessThan(TRAFFIC.minGap + 3.5); // still closing up, ever more slowly
    }
    expect(traffic.cars[1]!.yield).toBe("vehicle-ahead");
    expect(traffic.cars[1]!.blockedBy).toBe(0);
    for (const braking of log.braking.values()) expect(braking).toBeLessThanOrEqual(TRAFFIC.braking + 1e-6);
  });
});

describe("8. the exit of a junction (synthetic)", () => {
  it("a vehicle does not enter until there is room for all of it beyond the junction; others are not held up meanwhile", () => {
    const traffic = scripted(crossroads(), 3);
    const junction = traffic.junctions[0]!;
    // A vehicle stopped just past the junction on the eastbound side.
    const stopped = traffic.cars[2]!;
    traffic.place(2, CROSS.eastWest, 1, 1, 9);
    stopped.pace = 0;
    const a = approach(traffic, 0, "west", 30, "east");
    const b = approach(traffic, 1, "south", 36, "north");
    let aNearest = Infinity;
    const first = run(traffic, 12, () => {
      aNearest = Math.min(aNearest, Math.hypot(a.x, a.z) - a.length / 2);
    });
    expect(first.overlaps).toBe(0);
    // A is waiting outside the conflict area, with the reason; it never went in to sit across the junction.
    expect(aNearest).toBeGreaterThan(junction.radius);
    expect(a.yield).toBe("exit-not-clear");
    expect(a.blockedBy).toBe(2);
    expect(junction.holders.includes(0)).toBe(false);
    expect(traffic.events.some((e) => e.kind === "yield" && e.car === 0 && e.reason === "exit-not-clear")).toBe(true);
    // B, who arrived later and crosses A's path, was not made to wait behind A.
    expect(first.crossed.has(1)).toBe(true);
    expect(b.z).toBeGreaterThan(5);

    // The stopped vehicle moves off: A follows through.
    stopped.pace = 1;
    const second = run(traffic, 15);
    expect(second.overlaps).toBe(0);
    expect(a.x).toBeGreaterThan(20);
    expect(second.closest).toBeGreaterThan(4.9);
    expect(traffic.junctionStats).toMatchObject({ stuckReplacements: 0, blockedMoves: 0, replans: 0 });
  });

  it("two vehicles bound for the same exit from different sides go one at a time and do not meet in it", () => {
    const traffic = scripted(crossroads(), 2);
    approach(traffic, 0, "west", 40, "north"); // left turn
    approach(traffic, 1, "east", 41, "north"); // right turn, into the same lane
    const log = run(traffic, 30);
    expect(log.overlaps).toBe(0);
    expect(log.mostHolders).toBe(1);
    expect(log.crossed.size).toBe(2);
    expect(log.closest).toBeGreaterThan(4.9);
    expect(traffic.cars.every((c) => c.z > 20)).toBe(true);
  });
});

describe("9. a junction that stays blocked (synthetic)", () => {
  it("a vehicle whose exit stays full takes another exit after waiting, and is not removed", () => {
    const traffic = scripted(crossroads(), 2);
    const stopped = traffic.cars[1]!;
    traffic.place(1, CROSS.eastWest, 1, 1, 9);
    stopped.pace = 0;
    const a = approach(traffic, 0, "west", 30, "east");
    let wasRemoved = false;
    const log = run(traffic, TRAFFIC.replanSeconds + 17, () => {
      if (!a.active) wasRemoved = true;
    });
    expect(log.overlaps).toBe(0);
    expect(log.trespass).toBe(0);
    expect(wasRemoved).toBe(false);
    const replan = traffic.events.find((e) => e.kind === "replan")!;
    expect(replan).toMatchObject({ car: 0, junction: "junction@0.0,0.0", approach: `from the west on ${CROSS.eastWest}` });
    expect(replan.waited).toBeGreaterThanOrEqual(TRAFFIC.replanSeconds);
    expect(replan.reason).toContain("exit-not-clear");
    // It left by the north or the south arm instead.
    expect(Math.abs(a.z)).toBeGreaterThan(15);
    expect(Math.abs(a.x)).toBeLessThan(3);
    expect(traffic.junctionStats).toMatchObject({ replans: 1, stuckReplacements: 0, blockedMoves: 0 });
  });

  it("a vehicle broken down in the middle of the junction: the rest wait outside it, then go when it is cleared away", () => {
    const traffic = scripted(crossroads(), 3);
    const junction = traffic.junctions[0]!;
    const broken = approach(traffic, 0, "west", 16, "east", 4);
    const b = approach(traffic, 1, "south", 40, "north");
    const c = approach(traffic, 2, "east", 44, "south");
    let stalled = false, nearest = Infinity, replaced = -1;
    const log = run(traffic, TRAFFIC.stuckSeconds + 30, (frame) => {
      if (!stalled && Math.hypot(broken.x, broken.z) < 2.5) {
        broken.pace = 0; // it stops dead in the middle
        stalled = true;
      }
      if (stalled && replaced < 0) {
        if (Math.hypot(broken.x, broken.z) > 20) replaced = frame;
        else for (const w of [b, c]) nearest = Math.min(nearest, Math.hypot(w.x, w.z) - w.length / 2);
      }
    });
    expect(stalled).toBe(true);
    expect(log.overlaps).toBe(0);
    // Until it was cleared, neither of the others put its nose into the junction.
    expect(nearest).toBeGreaterThan(junction.radius);
    // The broken-down vehicle itself is what the time limit takes away: the last resort, and it is recorded.
    expect(replaced).toBeGreaterThan(0);
    const out = traffic.events.find((e) => e.kind === "stuck-replaced")!;
    expect(out.car).toBe(0);
    expect(traffic.junctionStats.stuckReplacements).toBe(1);
    // The waiting vehicles were never taken out, and both got across afterwards.
    expect(traffic.events.filter((e) => e.kind === "stuck-replaced").map((e) => e.car)).toEqual([0]);
    expect(log.crossed.has(1)).toBe(true);
    expect(log.crossed.has(2)).toBe(true);
    expect(traffic.removalCount).toBe(0);
  });

  it("two vehicles nose to nose on a road too narrow to pass on: they stop apart, one turns round, both drive on", () => {
    const d = junctionDistrict([junctionRoad(430, [[-200, 0], [200, 0]], { width: 3.2 })]);
    const traffic = scripted(d, 2);
    expect(traffic.junctions).toEqual([]);
    traffic.place(0, "way/430", 0, 1, 150, 5);
    traffic.place(1, "way/430", 1, -1, 150, 5);
    const [a, b] = traffic.cars as [TrafficCar, TrafficCar];
    let closest = Infinity;
    const log = run(traffic, 14, () => (closest = Math.min(closest, Math.abs(a.x - b.x))));
    expect(log.overlaps).toBe(0);
    expect(closest - (a.length + b.length) / 2).toBeGreaterThan(1.5); // bumpers never nearer than this
    const turned = traffic.events.filter((e) => e.kind === "u-turn");
    expect(turned.map((e) => e.car)).toEqual([0]); // the lower-numbered vehicle, every time
    expect(turned[0]!.reason).toContain("nose to nose with vehicle 1");
    // Both now travel west, one behind the other, and both are moving.
    expect(a.dir).toBe(-1);
    expect(b.dir).toBe(-1);
    expect(a.speed).toBeGreaterThan(1);
    expect(b.speed).toBeGreaterThan(1);
    expect(traffic.junctionStats.stuckReplacements).toBe(0);
    for (const braking of log.braking.values()) expect(braking).toBeLessThanOrEqual(TRAFFIC.braking + 1e-6);
  });
});

describe("roads too narrow to pass on (synthetic)", () => {
  it("are found from the lane positions, joined across bends and joins, and ended by junctions", () => {
    const traffic = scripted(narrowLane(), 0);
    expect(traffic.junctions.map((j) => j.id)).toEqual(["junction@-150.0,0.0"]);
    const runs = traffic.narrowRuns.map((r) => ({ roads: r.roadIds, length: r.length, ends: r.ends, exclusive: r.exclusive }));
    expect(runs).toEqual([
      // The lane: both its segments are one stretch, open at both ends, so it is used one direction at a time.
      { roads: [NARROW.lane], length: 120, ends: [[-60, 0], [60, 0]], exclusive: false },
      // The close: it starts at the junction and ends in a dead end, so one vehicle at a time.
      { roads: [NARROW.close], length: 120, ends: [[-150, 0], [-150, 120]], exclusive: true },
    ]);
    // An ordinary 7 m street has none.
    expect(scripted(crossroads(), 0).narrowRuns).toEqual([]);
    // Three lanes between two streets: each from junction to junction.
    expect(scripted(ladder(), 0).narrowRuns.map((r) => [r.length, r.exclusive])).toEqual([[200, false], [200, false], [200, false]]);
  });

  it("two vehicles from opposite ends: the second waits where the road is still wide, then goes; neither turns round", () => {
    const traffic = scripted(narrowLane(), 2);
    traffic.place(0, NARROW.west, 1, 1, 60, 6); // 30 m west of the lane, eastbound
    traffic.place(1, NARROW.east, 1, -1, 140, 6); // 50 m east of it, westbound
    const [a, b] = traffic.cars as [TrafficCar, TrafficCar];
    let bFurthest = Infinity, sawReason = false, togetherInLane = 0;
    const log = run(traffic, 45, () => {
      if (a.x < 60 && b.x > 60) bFurthest = Math.min(bFurthest, b.x - b.length / 2); // while A has not come out
      if (b.yield === "narrow-road-occupied" && b.blockedBy === 0) sawReason = true;
      if (Math.abs(a.x) < 55 && Math.abs(b.x) < 55) togetherInLane++;
    });
    expect(log.overlaps).toBe(0);
    expect(togetherInLane).toBe(0);
    expect(bFurthest).toBeGreaterThan(60); // B's nose stayed out of the lane
    expect(sawReason).toBe(true);
    expect(traffic.events.some((e) => e.kind === "yield" && e.car === 1 && e.reason.startsWith("narrow-road-occupied: narrow/0"))).toBe(true);
    expect(traffic.junctionStats).toMatchObject({ uTurns: 0, stuckReplacements: 0, blockedMoves: 0 });
    // Both got through: A is east of the lane, B west of it.
    expect(a.x).toBeGreaterThan(60);
    expect(b.x).toBeLessThan(-60);
    for (const braking of log.braking.values()) expect(braking).toBeLessThanOrEqual(TRAFFIC.braking + 1e-6);
  });

  it("vehicles going the same way follow each other through; the one waiting at the far end goes after them, before any latecomer", () => {
    const traffic = scripted(narrowLane(), 4);
    traffic.place(0, NARROW.west, 1, 1, 70, 6); // eastbound, first
    traffic.place(1, NARROW.west, 1, 1, 58, 6); // eastbound, right behind
    traffic.place(2, NARROW.east, 1, -1, 90, 6); // westbound, 100 m from the lane: arrives while the two are in it
    traffic.place(3, NARROW.west, 0, 1, 80, 6); // eastbound, further back: arrives after the westbound one has started waiting
    expect(traffic.route(3, NARROW.west, 1)).toBe(true); // straight on past the close
    const cars = traffic.cars;
    const entered = new Map<number, number>();
    const log = run(traffic, 80, (frame) => {
      cars.forEach((c, i) => {
        if (!entered.has(i) && Math.abs(c.x) < 50 && Math.abs(c.z) < 3) entered.set(i, frame);
      });
    });
    expect(log.overlaps).toBe(0);
    expect([...entered].sort((p, q) => p[1] - q[1]).map(([car]) => car)).toEqual([0, 1, 2, 3]);
    // The latecomer was at the lane, waiting, before the westbound vehicle went in: it was made to wait its turn.
    const waits = traffic.events.filter((e) => e.kind === "yield" && e.reason.startsWith("narrow-road-occupied"));
    expect(waits.map((e) => [e.car, e.other])).toEqual([[2, 0], [3, 2]]);
    expect(waits[1]!.time).toBeLessThan(entered.get(2)! * DT);
    expect(traffic.junctionStats).toMatchObject({ uTurns: 0, stuckReplacements: 0 });
  });

  it("a narrow close takes one vehicle at a time: the next waits in the street until the first has come back out", () => {
    const traffic = scripted(narrowLane(), 2);
    // Both westbound on the street toward the junction with the close, both turning into it.
    traffic.place(0, NARROW.west, 2, -1, 60, 5);
    expect(traffic.route(0, NARROW.close, 1)).toBe(true);
    traffic.place(1, NARROW.west, 2, -1, 40, 5);
    expect(traffic.route(1, NARROW.close, 1)).toBe(true);
    const [a, b] = traffic.cars as [TrafficCar, TrafficCar];
    let bothIn = 0, aWentIn = false, bWaited = false;
    const log = run(traffic, 14, () => {
      const inClose = (c: TrafficCar): boolean => c.z > 8 && Math.abs(c.x + 150) < 4;
      if (inClose(a)) aWentIn = true;
      if (inClose(a) && inClose(b)) bothIn++;
      if (b.yield === "narrow-road-occupied") bWaited = true;
    });
    expect(log.overlaps).toBe(0);
    expect(aWentIn).toBe(true);
    expect(bothIn).toBe(0);
    expect(bWaited).toBe(true);
    expect(traffic.junctions[0]!.holders.includes(1)).toBe(false); // waiting outside the junction, not in it
  });
});

describe("whole districts, every vehicle against every other, every frame (synthetic)", () => {
  const cases: Array<[string, () => DistrictData, readonly [number, number]]> = [
    ["crossroads", () => crossroads(), FAR],
    ["narrow lanes between two streets", ladder, FAR],
    ["a narrow lane in a street", narrowLane, FAR],
    ["one of each shape", shapes, FAR],
    ["roads among buildings", hostileDistrict, [200, 0]],
    ["roads at the district's edge", edgeDistrict, [200, 150]],
  ];
  for (const [name, make, player] of cases) {
    it(`${name}: 40 vehicles for 2 minutes with three seeds, and no two bodies ever overlap`, () => {
      for (const seed of [1, 2, 3]) {
        const d = make();
        const traffic = new TrafficModel(d, new BuildingIndex(d.buildings), seed);
        traffic.setCount(40);
        let overlaps = 0, first = "";
        for (let frame = 1; frame <= 120 / DT; frame++) {
          traffic.update(DT, ...player);
          const hits = vehicleCollisions(traffic, frame);
          if (hits.length && !first) first = JSON.stringify(hits[0]);
          overlaps += hits.length;
        }
        expect(overlaps, `seed ${seed}: ${first}`).toBe(0);
        expect(traffic.removalCount, `seed ${seed}`).toBe(0);
        expect(traffic.activeCount, `seed ${seed}`).toBe(40);
        // Not by standing still: the traffic kept moving through its junctions.
        expect(traffic.junctionStats.entries, `seed ${seed}`).toBeGreaterThan(10);
        expect(traffic.junctionStats.stuckReplacements, `seed ${seed}`).toBeLessThanOrEqual(2);
      }
    });
  }

  it("holds at a low frame rate too", () => {
    for (const make of [() => crossroads(), hostileDistrict]) {
      const d = make();
      const traffic = new TrafficModel(d, new BuildingIndex(d.buildings), 9);
      traffic.setCount(40);
      let overlaps = 0;
      for (let frame = 1; frame <= 120 * 8; frame++) {
        traffic.update(1 / 8, 200, 0);
        overlaps += vehicleCollisions(traffic, frame).length;
      }
      expect(overlaps).toBe(0);
    }
  });

  it("the report used on real data counts collisions and junction activity, and finds none wrong here", () => {
    const engine = nullEngine();
    try {
      const report = trafficReport(engine, crossroads(), 60);
      expect(report.problems).toEqual([]);
      expect(report.collisionCount).toBe(0);
      expect(report.vehiclesInCollisions).toEqual([]);
      expect(report.junctions.count).toBe(1);
      expect(report.junctions.entries).toBeGreaterThan(5);
      expect(report.placed).toBe(TRAFFIC.maxCount);
      expect(report.lines.join("\n")).toContain("vehicle collisions: 0 frame-pairs from 0 different vehicles");
    } finally {
      engine.dispose();
    }
  });

  it("the report does find a collision when there is one", () => {
    const traffic = scripted(crossroads(), 2);
    traffic.place(0, CROSS.eastWest, 0, 1, 100);
    traffic.place(1, CROSS.eastWest, 0, 1, 103); // 3 m behind bumper to bumper is impossible: the bodies overlap
    const hits = vehicleCollisions(traffic, 12);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.cars.map((c) => c.car)).toEqual([0, 1]);
    expect(hits[0]).toMatchObject({ frame: 12, junction: "junction@0.0,0.0" });
    expect(hits[0]!.junctionDistance).toBeCloseTo(Math.hypot(98.5, 1.75), 1);
  });
});
