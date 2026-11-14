import { Random } from "../../utils/random";
import type { BuildingIndex } from "../district/BuildingIndex";
import type { DistrictData, DistrictRoad } from "../district/types";
import { TRAFFIC_CARS } from "../vehicle/models/carSpecs";
import { bodiesOverlap, compass, findJunctions, findNarrowRuns, movement, type Junction, type Movement, type NarrowRun } from "./junctions";
import { analyseRoads, footprintHit, footprintOutside, type RoadSafety } from "./roadSafety";

/**
 * Traffic settings. `count` is the default number of moving vehicles; the
 * graphics setting and the `?traffic=` address option override it.
 */
export const TRAFFIC = {
  count: 12,
  maxCount: 40,
  /** Road classes traffic uses. Service roads and tracks are left out: they are often unconnected stubs. */
  classes: ["trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link", "residential", "unclassified", "living_street"],
  /** Cruising speed in metres per second by road class. Anything else uses `defaultSpeed`. */
  speed: { trunk: 14, primary: 13, secondary: 12, tertiary: 10, residential: 7, unclassified: 7, living_street: 4 } as Record<string, number>,
  defaultSpeed: 8,
  junctionSpeed: 4,
  acceleration: 2.2,
  braking: 6,
  /** Vehicles keep left, as in India. */
  keepLeft: true,
  /** Looks this far ahead for a vehicle in its own lane. */
  lookAhead: 40,
  /** Speed allowed per metre of room beyond the gap, in 1/s. */
  followGain: 0.4,
  /** Bumper-to-bumper gap held behind a stopped vehicle, plus a car length. */
  gap: 7,
  laneHalfWidth: 1.5,
  /** New vehicles appear at least this far from the player and from each other. */
  spawnFromPlayer: 45,
  spawnFromOthers: 14,
  /** New vehicles appear at least this far outside a junction's conflict area. */
  spawnFromJunction: 10,
  /** A waiting vehicle stops with its front this far short of a junction's conflict area. */
  stopLineGap: 0.5,
  /** Within this distance of its stopping place a vehicle has arrived at the junction: it asks to enter, and its place in the order is fixed. */
  decisionDistance: 6,
  /** Deceleration, in m/s2, assumed when slowing for a junction ahead. */
  approachBraking: 2.5,
  /** Bumper-to-bumper gap held behind a stopped vehicle. */
  minGap: 2.5,
  /** Room kept between the side of a vehicle and anything beside its path. */
  sideClearance: 0.3,
  /** No vehicle is moved to where its body, widened by this on every side, would overlap another. */
  bodyMargin: 0.15,
  /** Clear road, beyond a vehicle's own length, that must be free past a junction before it enters. */
  exitRoom: 3,
  /** A vehicle stopped nose to nose with another for this long turns round. Each vehicle adds a little, so that one of a pair goes first. */
  headOnSeconds: 2.5,
  headOnStagger: 0.25,
  /** After turning round a vehicle does not turn round again for this long. */
  uTurnCooldown: 12,
  /**
   * A vehicle stopped this long looks for another way. At a junction it takes a different exit. Behind a stopped
   * vehicle or the player it turns round after twice this long, and waiting for a narrow road after three times.
   */
  replanSeconds: 15,
  /** A vehicle that has not moved for this long is taken out and re-enters elsewhere. The last resort. */
  stuckSeconds: 60,
  /** Shortest road, in metres, that traffic will use. */
  minRoadLength: 8,
  maxHopsPerStep: 6,
  /** A vehicle this far or less into a stretch has only just turned onto it. */
  turnLength: 10,
  seed: 2611,
} as const;

export interface TrafficCar {
  active: boolean;
  /** Index into the usable roads. */
  road: number;
  /** Index of the point the car is leaving. */
  from: number;
  dir: 1 | -1;
  /** Metres along the current segment. */
  along: number;
  x: number;
  z: number;
  heading: number;
  speed: number;
  /** Metres moved in the last update, for wheel rotation. */
  moved: number;
  /** Personal pace, around 1. */
  pace: number;
  stuck: number;
  /** Which model and colour to draw. */
  model: number;
  paint: number;
  /** Body size in metres, from the model. */
  length: number;
  width: number;
  /** Road and segment the car was on before its last turn, for recording an unsafe turn. -1 when none. */
  cameFromRoad: number;
  cameFromSegment: number;
  /** What it will do at the junction ahead, chosen when the junction first comes into view. `planNode` is -1 when there is none. */
  planNode: number;
  planInRoad: number;
  planInFrom: number;
  planInDir: number;
  /** 0 drive on to (planRoad, planFrom, planDir); 1 turn round; 2 the road ends. */
  planKind: number;
  planRoad: number;
  planFrom: number;
  planDir: 1 | -1;
  /** Junctions it holds a reservation at (indexes into `junctions`), with the arms it enters and leaves by, and whether it has passed the middle. */
  holds: number[];
  holdIn: number[];
  holdOut: number[];
  holdPassed: boolean[];
  /** The junction it is waiting to enter, or -1; when it arrived there (model time); and the arms it means to enter and leave by. */
  junction: number;
  arrivedAt: number;
  moveIn: number;
  moveOut: number;
  /** Why it is holding back this frame, or null. */
  yield: YieldReason | null;
  /** The vehicle it is holding back for: an index into `cars`, -2 for the player, -1 for none. */
  blockedBy: number;
  /** Seconds stopped nose to nose with another vehicle; seconds before it may turn round again; alternatives tried while stopped. */
  headOn: number;
  cooldown: number;
  replans: number;
  loggedYield: YieldReason | null;
  wasBlocked: boolean;
  /** The narrow stretch it has been let into but has not reached yet (-1 for none), and the end of it that it is heading for. */
  runGrant: number;
  runGrantEnd: number;
  /** The narrow stretch it is waiting to enter (-1 for none), the end it would head for, and since when. */
  runWait: number;
  runWaitEnd: number;
  runSince: number;
}

export type YieldReason = "narrow-road-occupied" | "junction-occupied" | "another-vehicle-has-priority" | "exit-not-clear" | "vehicle-ahead" | "oncoming-vehicle" | "player-ahead" | "vehicle-in-the-way";

/** Something that happened at a junction or between two vehicles. The newest 200 are kept in `events`. */
export interface TrafficEvent {
  /** Model time in seconds. */
  time: number;
  kind: "yield" | "enter" | "forced-entry" | "replan" | "u-turn" | "blocked-move" | "stuck-replaced";
  car: number;
  /** Junction id, or null away from junctions. */
  junction: string | null;
  /** Where the vehicle came from: "from the south on way/12". */
  approach: string | null;
  movement: Movement | null;
  reason: string;
  /** The other vehicle involved, -2 for the player, -1 for none. */
  other: number;
  /** Seconds the vehicle had been waiting. */
  waited: number;
}

/** What is happening at one junction now. */
export interface JunctionStatus {
  junction: string;
  x: number;
  z: number;
  holders: Array<{ car: number; approach: string; movement: Movement; passedMiddle: boolean }>;
  waiting: Array<{ car: number; approach: string; movement: Movement; waited: number; reason: YieldReason | null; behind: number }>;
}

/** A vehicle taken off the road because its body would otherwise have entered a building. */
export interface SafetyRemoval {
  car: number;
  roadId: string;
  segment: number;
  x: number;
  z: number;
  buildingId: string;
  /** Set when the car had just turned: that turn is not offered again. */
  turnFrom: { roadId: string; segment: number } | null;
}

interface Link {
  road: number;
  index: number;
}

function measured(road: DistrictRoad): number {
  let length = 0;
  for (let i = 1; i < road.points.length; i++) length += Math.hypot(road.points[i]![0] - road.points[i - 1]![0], road.points[i]![1] - road.points[i - 1]![1]);
  return length;
}

/** A road traffic can follow: finite points, a finite width, and long enough to drive along. */
function usable(road: DistrictRoad): boolean {
  if (!Array.isArray(road.points) || road.points.length < 2 || !Number.isFinite(road.width) || road.width <= 0) return false;
  for (const p of road.points) if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return false;
  return measured(road) >= TRAFFIC.minRoadLength;
}

const key = (p: readonly [number, number]): number => Math.round(p[0] * 10) * 1_000_003 + Math.round(p[1] * 10);

/**
 * Moves vehicles along the mapped road centre lines.
 *
 * Each vehicle follows one road from point to point, keeping to the left of
 * the centre line (on the line itself on one-way roads). Where roads share a
 * point it may turn onto another, never against a mapped one-way. It slows
 * for junctions and for any vehicle ahead in its lane, including the player.
 *
 * Buildings: stretches of road that run through or too close to a mapped
 * building are not used (see roadSafety.ts; they stay on the map). Lanes are
 * moved toward the centre line where a building stands inside the estimated
 * road width. And no vehicle is ever moved to a position where its body
 * overlaps a building: it is held to its lane line, or failing that removed.
 * Nothing here draws anything, so it runs in tests.
 */
export class TrafficModel {
  readonly cars: TrafficCar[] = [];
  readonly roads: DistrictRoad[];
  private readonly links = new Map<number, Link[]>();
  private readonly lengths: number[];
  private totalLength: number;
  private readonly random: Random;
  private readonly bounds: DistrictData["bounds"];
  /** Which stretches of road traffic does not use, and why. Indexed like `roads`. */
  readonly safety: RoadSafety;
  /** Vehicles removed because no safe position was available, newest last (at most 200 kept). */
  readonly removals: SafetyRemoval[] = [];
  removalCount = 0;
  /** Turns found unsafe while driving: "road:segment>road:segment". */
  private readonly blockedTurns = new Set<string>();
  /** Points where three or more drivable road segments meet. Bends and joins are not junctions. */
  readonly junctions: Junction[];
  private readonly junctionAt: Map<number, number>;
  /** Stretches of two-way road too narrow to pass on. Traffic uses each in one direction at a time. */
  readonly narrowRuns: NarrowRun[];
  private readonly runOf: number[][];
  private readonly runTowards: number[][];
  /** Seconds of traffic simulated. Arrival order at junctions is measured on this clock. */
  time = 0;
  /** Recent yields, entries and recoveries, newest last. Read it when needed; nothing is printed. */
  readonly events: TrafficEvent[] = [];
  readonly junctionStats = { entries: 0, yields: 0, forcedEntries: 0, replans: 0, uTurns: 0, blockedMoves: 0, stuckReplacements: 0, longestWait: 0 };

  constructor(
    district: DistrictData,
    private readonly buildings: BuildingIndex,
    seed: number = TRAFFIC.seed,
  ) {
    this.random = new Random(seed);
    this.bounds = district.bounds;
    const candidates = district.roads.filter((r) => r.kind === "road" && !r.tunnel && !r.elevated && TRAFFIC.classes.includes(r.class as never) && usable(r));
    const all = analyseRoads(candidates, buildings, (road) => this.laneOffset(road), district.bounds);
    // Roads with no drivable stretch left are dropped from routing altogether. They are still in `safety.excluded`.
    const keep = candidates.map((_, r) => all.blocked[r]!.some((b) => !b));
    this.roads = candidates.filter((_, r) => keep[r]);
    this.safety = { ...all, blocked: all.blocked.filter((_, r) => keep[r]), offsets: all.offsets.filter((_, r) => keep[r]), limits: all.limits.filter((_, r) => keep[r]) };
    this.roads.forEach((road, r) => {
      road.points.forEach((p, index) => {
        const k = key(p);
        const list = this.links.get(k);
        if (list) list.push({ road: r, index });
        else this.links.set(k, [{ road: r, index }]);
      });
    });
    // Measured here rather than read from the file, so a wrong or missing length cannot skew where vehicles appear.
    // Only the stretches traffic may use count.
    this.lengths = this.roads.map((road, r) => {
      let length = 0;
      for (let i = 1; i < road.points.length; i++) if (!this.safety.blocked[r]![i - 1]) length += Math.max(0, this.safety.limits[r]![(i - 1) * 4 + 1]! - this.safety.limits[r]![(i - 1) * 4]!);
      return length;
    });
    this.totalLength = this.lengths.reduce((a, b) => a + b, 0);
    const widest = Math.max(...TRAFFIC_CARS.map((c) => c.width));
    const found = findJunctions(this.roads, this.links, this.safety.blocked, (r, segment) => (this.safety.offsets[r]?.[segment * 2] ?? 0) + (this.safety.offsets[r]?.[segment * 2 + 1] ?? 0), widest + TRAFFIC.sideClearance);
    this.junctions = found.junctions;
    this.junctionAt = found.byNode;
    const separation = (r: number, segment: number): number => (this.safety.offsets[r]?.[segment * 2] ?? 0) + (this.safety.offsets[r]?.[segment * 2 + 1] ?? 0);
    const narrow = findNarrowRuns(
      this.roads, this.links, this.junctionAt,
      (r, segment) => !this.roads[r]!.oneway && separation(r, segment) < widest + TRAFFIC.sideClearance,
      (r, segment) => !this.safety.blocked[r]![segment],
      (r, segment) => {
        const a = this.roads[r]!.points[segment]!, b = this.roads[r]!.points[segment + 1]!, length = Math.hypot(b[0] - a[0], b[1] - a[1]), l = this.safety.limits[r]!;
        return l[segment * 4]! > 1e-6 || l[segment * 4 + 1]! < length - 1e-6 || l[segment * 4 + 2]! > 1e-6 || l[segment * 4 + 3]! < length - 1e-6;
      },
    );
    this.narrowRuns = narrow.runs;
    this.runOf = narrow.runOf;
    this.runTowards = narrow.towards;
  }

  get activeCount(): number {
    let n = 0;
    for (const car of this.cars) if (car.active) n++;
    return n;
  }

  /** Sets how many vehicles exist. They are placed on the next update. */
  setCount(count: number): void {
    // Anything that is not a number means none, rather than an invalid array length.
    const n = this.roads.length === 0 || !Number.isFinite(count) ? 0 : Math.max(0, Math.min(TRAFFIC.maxCount, Math.floor(count)));
    while (this.cars.length < n) {
      const i = this.cars.length;
      const spec = TRAFFIC_CARS[i % TRAFFIC_CARS.length]!;
      this.cars.push({
        active: false, road: 0, from: 0, dir: 1, along: 0, x: 0, z: 0, heading: 0, speed: 0, moved: 0, pace: 0.85 + this.random.next() * 0.25, stuck: 0, model: i, paint: Math.floor(this.random.next() * 1000),
        length: spec.length, width: spec.width, cameFromRoad: -1, cameFromSegment: -1,
        planNode: -1, planInRoad: -1, planInFrom: -1, planInDir: 0, planKind: 0, planRoad: -1, planFrom: -1, planDir: 1,
        holds: [], holdIn: [], holdOut: [], holdPassed: [], junction: -1, arrivedAt: -1, moveIn: -1, moveOut: -1,
        yield: null, blockedBy: -1, headOn: 0, cooldown: 0, replans: 0, loggedYield: null, wasBlocked: false,
        runGrant: -1, runGrantEnd: 0, runWait: -1, runWaitEnd: 0, runSince: -1,
      });
    }
    for (let i = n; i < this.cars.length; i++) this.releaseAll(i, this.cars[i]!);
    this.cars.length = n;
  }

  private laneOffset(road: DistrictRoad): number {
    if (road.oneway) return 0;
    return Math.max(0, Math.min(road.width / 4, road.width / 2 - 1.1));
  }

  /** Where a car on this segment should be: the centre line shifted into its lane. */
  private target(car: TrafficCar, out: { x: number; z: number; dx: number; dz: number; length: number }): void {
    const road = this.roads[car.road]!;
    const a = road.points[car.from]!, b = road.points[car.from + car.dir]!;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-6;
    const dx = (b[0] - a[0]) / length, dz = (b[1] - a[1]) / length;
    // The lane position checked against the buildings for this stretch and direction.
    const segment = car.dir === 1 ? car.from : car.from - 1;
    const off = (this.safety.offsets[car.road]?.[segment * 2 + (car.dir === 1 ? 0 : 1)] ?? this.laneOffset(road)) * (TRAFFIC.keepLeft ? 1 : -1);
    out.x = a[0] + dx * car.along - dz * off;
    out.z = a[1] + dz * car.along + dx * off;
    out.dx = dx;
    out.dz = dz;
    out.length = length;
  }

  private readonly scratch = { x: 0, z: 0, dx: 0, dz: 0, length: 0 };

  /** The segment a car is on: the index of its lower-numbered point. */
  segmentOf(car: TrafficCar): number {
    return car.dir === 1 ? car.from : car.from - 1;
  }

  /** True when a vehicle may not enter this stretch at its start, travelling in `dir` from point `from`. */
  private isBlocked(road: number, from: number, dir: 1 | -1): boolean {
    if (this.safety.blocked[road]?.[dir === 1 ? from : from - 1] === true) return true;
    // Its lane starts in the edge zone of the district: it can be driven further in, but not entered from here.
    return this.span(road, from, dir, this.spanOut)[0] > 1e-6;
  }

  private readonly spanOut: [number, number] = [0, 0];

  /**
   * The part of a stretch a vehicle may occupy, in metres from where it enters it travelling in `dir`:
   * the lane inside the district boundary with room for the whole vehicle.
   */
  private span(road: number, from: number, dir: 1 | -1, out: [number, number]): [number, number] {
    const segment = dir === 1 ? from : from - 1;
    const limits = this.safety.limits[road]!, i = (segment * 2 + (dir === 1 ? 0 : 1)) * 2;
    const lo = limits[i]!, hi = limits[i + 1]!;
    if (dir === 1) {
      out[0] = lo;
      out[1] = hi;
    } else {
      const a = this.roads[road]!.points[segment]!, b = this.roads[road]!.points[segment + 1]!;
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      out[0] = length - hi;
      out[1] = length - lo;
    }
    return out;
  }

  /**
   * Turns a vehicle round where it is, because its lane ahead leaves the district. It takes the opposite lane of
   * the same stretch, at the nearest point of that lane that is inside. False when there is no such lane.
   */
  private turnBack(car: TrafficCar): boolean {
    const road = this.roads[car.road]!;
    if (road.oneway) return false;
    const a = road.points[car.from]!, b = road.points[car.from + car.dir]!;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const far = car.from + car.dir;
    const back = this.span(car.road, far, -car.dir as 1 | -1, this.spanOut);
    if (back[1] - back[0] < 1e-6) return false;
    // It waits for room in the lane it turns into, as it would behind any vehicle.
    const u = car.along / (length || 1), cx = a[0] + (b[0] - a[0]) * u, cz = a[1] + (b[1] - a[1]) * u;
    const t = this.scratch;
    this.target(car, t);
    const mx = 2 * cx - t.x, mz = 2 * cz - t.z;
    for (const other of this.cars) {
      if (other === car || !other.active) continue;
      if (Math.hypot(other.x - mx, other.z - mz) < TRAFFIC.gap) {
        car.speed = 0;
        return true;
      }
    }
    car.cameFromRoad = car.road;
    car.cameFromSegment = this.segmentOf(car);
    car.along = Math.max(back[0], Math.min(back[1], length - car.along));
    car.from = far;
    car.dir = -car.dir as 1 | -1;
    this.turnedRound(car);
    return true;
  }

  private turnKey(fromRoad: number, fromSegment: number, toRoad: number, toSegment: number): string {
    return `${fromRoad}:${fromSegment}>${toRoad}:${toSegment}`;
  }

  /** What a car's body would overlap at a position: a building's id, "district-boundary", or null when it is clear. */
  private hit(car: TrafficCar, x: number, z: number, heading: number): string | null {
    if (footprintOutside(this.bounds, x, z, heading, car.length, car.width)) return "district-boundary";
    return footprintHit(this.buildings, x, z, heading, car.length, car.width)?.id ?? null;
  }

  private spawn(car: TrafficCar, playerX: number, playerZ: number): boolean {
    const T = TRAFFIC;
    for (let attempt = 0; attempt < 12; attempt++) {
      let pick = this.random.next() * this.totalLength;
      let r = 0;
      while (r < this.roads.length - 1 && pick > this.lengths[r]!) pick -= this.lengths[r++]!;
      const road = this.roads[r]!;
      if (this.totalLength <= 0) break;
      const dir: 1 | -1 = road.oneway || this.random.chance(0.5) ? 1 : -1;
      const segment = Math.floor(this.random.next() * (road.points.length - 1));
      car.road = r;
      car.dir = dir;
      car.from = dir === 1 ? segment : segment + 1;
      car.along = 0;
      if (this.safety.blocked[r]![dir === 1 ? car.from : car.from - 1]) continue; // a stretch traffic does not use
      const t = this.scratch;
      // Anywhere on the part of the lane that is inside the district with room for the vehicle.
      const [lo, hi] = this.span(r, car.from, dir, this.spanOut);
      if (hi - lo < 1e-6) continue;
      car.along = lo + this.random.next() * (hi - lo);
      this.target(car, t);
      if (Math.hypot(t.x - playerX, t.z - playerZ) < T.spawnFromPlayer) continue;
      if (this.hit(car, t.x, t.z, Math.atan2(t.dx, t.dz))) continue; // the whole body, not only the centre
      if (this.cars.some((o) => o !== car && o.active && Math.hypot(o.x - t.x, o.z - t.z) < T.spawnFromOthers)) continue;
      // Not on a stretch too narrow to pass on while another vehicle is using it.
      const R = this.runOf[r]![dir === 1 ? car.from : car.from - 1]!;
      if (R >= 0 && this.cars.some((o) => o !== car && o.active && (o.runGrant === R || this.runOf[o.road]![o.dir === 1 ? o.from : o.from - 1] === R))) continue;
      // Not in or at the mouth of a junction: it would be there without a reservation.
      if (this.junctions.some((j) => Math.hypot(j.x - t.x, j.z - t.z) < j.radius + T.spawnFromJunction)) continue;
      car.x = t.x;
      car.z = t.z;
      car.heading = Math.atan2(t.dx, t.dz);
      car.speed = 0;
      car.stuck = 0;
      car.moved = 0;
      this.resetState(car);
      car.active = true;
      return true;
    }
    car.active = false;
    return false;
  }

  private remove(index: number, car: TrafficCar, t: { x: number; z: number; dx: number; dz: number }): void {
    const segment = this.segmentOf(car);
    const obstacle = this.hit(car, t.x, t.z, Math.atan2(t.dx, t.dz)) ?? this.hit(car, car.x + (t.x - car.x) * 0.6, car.z + (t.z - car.z) * 0.6, car.heading) ?? "unknown";
    const atEdge = obstacle === "district-boundary";
    let turnFrom: SafetyRemoval["turnFrom"] = null;
    const road = this.roads[car.road]!;
    if (car.along < TRAFFIC.turnLength && car.cameFromRoad >= 0 && (car.cameFromRoad !== car.road || car.cameFromSegment !== segment)) {
      // It had only just turned onto this stretch: the turn is the problem.
      this.blockedTurns.add(this.turnKey(car.cameFromRoad, car.cameFromSegment, car.road, segment));
      turnFrom = { roadId: this.roads[car.cameFromRoad]!.id, segment: car.cameFromSegment };
    } else if (!this.safety.blocked[car.road]![segment]) {
      // Well along the stretch: the stretch itself is the problem. Traffic stops using it, and the record says so.
      this.safety.blocked[car.road]![segment] = true;
      const a = road.points[segment]!, b = road.points[segment + 1]!;
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      this.safety.excluded.push({ roadId: road.id, roadClass: road.class, segment, from: a, to: b, length, at: [car.x, car.z], reason: "vehicle-had-no-safe-position", buildingId: obstacle, buildingCategory: atEdge ? "boundary" : (this.buildings.at(t.x, t.z)?.category ?? "unknown") });
      this.safety.excludedLength += length;
      this.lengths[car.road] = Math.max(0, this.lengths[car.road]! - length);
      this.totalLength = this.lengths.reduce((x, y) => x + y, 0);
    }
    this.removalCount++;
    this.removals.push({ car: index, roadId: this.roads[car.road]!.id, segment, x: car.x, z: car.z, buildingId: obstacle, turnFrom });
    if (this.removals.length > 200) this.removals.shift();
    car.active = false;
    car.moved = 0;
    this.releaseAll(index, car);
  }

  // ---- Routes: what a vehicle does at the point ahead -------------------------------------------------------

  private readonly optRoad: number[] = [];
  private readonly optIndex: number[] = [];
  private readonly optDir: Array<1 | -1> = [];
  private optCount = 0;

  /**
   * Lists the turns open to a vehicle arriving at the far end of (road, from, dir), into optRoad/optIndex/optDir.
   * Returns whether it can also carry straight on along its own road.
   */
  private options(road: number, from: number, dir: 1 | -1): boolean {
    const r = this.roads[road]!;
    const here = from + dir;
    const leaving = dir === 1 ? from : from - 1;
    this.optCount = 0;
    for (const link of this.links.get(key(r.points[here]!)) ?? []) {
      const other = this.roads[link.road]!;
      for (const d of [1, -1] as const) {
        if (d === -1 && other.oneway) continue; // never against a mapped one-way
        const next = link.index + d;
        if (next < 0 || next >= other.points.length) continue;
        if (this.isBlocked(link.road, link.index, d)) continue; // runs through or against a building, or starts at the district's edge
        if (this.blockedTurns.has(this.turnKey(road, leaving, link.road, d === 1 ? link.index : link.index - 1))) continue;
        if (link.road === road && link.index === here && d === -dir) continue; // no U-turn
        if (link.road === road && link.index === here && d === dir) continue; // "straight on", returned separately
        const n = this.optCount++;
        this.optRoad[n] = link.road;
        this.optIndex[n] = link.index;
        this.optDir[n] = d;
      }
    }
    return here + dir >= 0 && here + dir < r.points.length && !this.isBlocked(road, here, dir);
  }

  private canTurnRound(road: number, from: number, dir: 1 | -1): boolean {
    return !this.roads[road]!.oneway && !this.isBlocked(road, from + dir, -dir as 1 | -1);
  }

  /**
   * Chooses what the vehicle does at the junction at the far end of (road, from, dir), and remembers it.
   * `avoid` leaves out the choice it has now, for a vehicle looking for another way. Returns false when
   * there is nothing else to choose (the plan is then unchanged).
   */
  private choose(car: TrafficCar, road: number, from: number, dir: 1 | -1, avoid: boolean): boolean {
    const here = from + dir;
    const hadKind = car.planKind, hadRoad = car.planRoad, hadFrom = car.planFrom, hadDir = car.planDir;
    const same = (r: number, f: number, d: number): boolean => avoid && hadKind === 0 && hadRoad === r && hadFrom === f && hadDir === d;
    let canContinue = this.options(road, from, dir);
    if (canContinue && same(road, here, dir)) canContinue = false;
    let n = 0;
    for (let i = 0; i < this.optCount; i++) {
      if (same(this.optRoad[i]!, this.optIndex[i]!, this.optDir[i]!)) continue;
      this.optRoad[n] = this.optRoad[i]!;
      this.optIndex[n] = this.optIndex[i]!;
      this.optDir[n] = this.optDir[i]!;
      n++;
    }
    let kind = 0, toRoad = road, toFrom = here, toDir: 1 | -1 = dir;
    if (canContinue && (n === 0 || this.random.chance(0.6))) {
      // straight on, as set
    } else if (n > 0) {
      const o = Math.floor(this.random.next() * n);
      toRoad = this.optRoad[o]!;
      toFrom = this.optIndex[o]!;
      toDir = this.optDir[o]!;
    } else if (this.canTurnRound(road, from, dir) && !(avoid && hadKind === 1)) {
      kind = 1;
      toDir = -dir as 1 | -1;
    } else if (avoid) {
      return false;
    } else {
      kind = 2; // a one-way road ends, or the lane back starts outside the district
    }
    car.planNode = key(this.roads[road]!.points[here]!);
    car.planInRoad = road;
    car.planInFrom = from;
    car.planInDir = dir;
    car.planKind = kind;
    car.planRoad = toRoad;
    car.planFrom = toFrom;
    car.planDir = toDir;
    return true;
  }

  /** True when the vehicle's plan is for this approach and can still be driven. */
  private planHolds(car: TrafficCar, road: number, from: number, dir: 1 | -1): boolean {
    const here = from + dir;
    if (car.planNode !== key(this.roads[road]!.points[here]!) || car.planInRoad !== road || car.planInFrom !== from || car.planInDir !== dir) return false;
    if (car.planKind === 1) return this.canTurnRound(road, from, dir);
    if (car.planKind === 2) return !this.canTurnRound(road, from, dir);
    const next = car.planFrom + car.planDir, to = this.roads[car.planRoad];
    if (!to || next < 0 || next >= to.points.length || this.isBlocked(car.planRoad, car.planFrom, car.planDir)) return false;
    if (car.planRoad === road && car.planFrom === here && car.planDir === dir) return true;
    return !this.blockedTurns.has(this.turnKey(road, dir === 1 ? from : from - 1, car.planRoad, car.planDir === 1 ? car.planFrom : car.planFrom - 1));
  }

  private readonly step = { kind: 0, road: 0, from: 0, dir: 1 as 1 | -1 };

  /**
   * What the vehicle does at the far end of (road, from, dir), written to `step`. At a junction it is the
   * vehicle's plan, chosen at random the first time and kept. Anywhere else there is only one way on.
   */
  private next(car: TrafficCar, road: number, from: number, dir: 1 | -1, atJunction: boolean): void {
    const out = this.step, here = from + dir;
    if (atJunction) {
      if (!this.planHolds(car, road, from, dir)) this.choose(car, road, from, dir, false);
      out.kind = car.planKind;
      out.road = car.planRoad;
      out.from = car.planFrom;
      out.dir = car.planDir;
      return;
    }
    out.kind = 0;
    out.road = road;
    out.from = here;
    out.dir = dir;
    if (this.options(road, from, dir)) return; // the road carries on
    if (this.optCount > 0) {
      // Two roads joined end to end.
      out.road = this.optRoad[0]!;
      out.from = this.optIndex[0]!;
      out.dir = this.optDir[0]!;
    } else if (this.canTurnRound(road, from, dir)) {
      out.kind = 1; // dead end
      out.dir = -dir as 1 | -1;
    } else out.kind = 2;
  }

  /** Moves the car onto what follows the point it has just reached. Returns false when it must leave the map. */
  private advance(car: TrafficCar): boolean {
    const road = car.road, from = car.from, dir = car.dir;
    const j = this.junctionAt.get(key(this.roads[road]!.points[from + dir]!)) ?? -1;
    this.next(car, road, from, dir, j >= 0);
    const step = this.step;
    if (step.kind === 2) return false;
    if (j >= 0) {
      const h = car.holds.indexOf(j);
      if (h >= 0) car.holdPassed[h] = true;
    }
    car.cameFromRoad = road;
    car.cameFromSegment = dir === 1 ? from : from - 1;
    car.road = step.road;
    car.from = step.from;
    car.dir = step.dir;
    car.along = 0;
    if (step.kind === 1) car.cooldown = TRAFFIC.uTurnCooldown;
    return true;
  }

  // ---- The path ahead ----------------------------------------------------------------------------------------

  /** The lane line ahead of a vehicle, as straight pieces, with the first junction on it. Rebuilt for each vehicle each frame. */
  private readonly path = {
    n: 0, x: [] as number[], z: [] as number[], dx: [] as number[], dz: [] as number[], len: [] as number[], s: [] as number[],
    /** The first junction ahead (index into `junctions`) or -1; metres to its middle; the arms the vehicle enters and leaves by; and what it does there. */
    junction: -1, junctionS: 0, inArm: -1, outArm: -1, kind: 0,
    /** The first narrow stretch the path enters (index into `narrowRuns`) or -1; metres to where it starts; and the end of it the vehicle would head for. */
    run: -1, runS: 0, runEnd: 0,
  };

  private armIndex(junction: number, road: number, index: number, dir: number): number {
    const arms = this.junctions[junction]!.arms;
    for (let a = 0; a < arms.length; a++) if (arms[a]!.road === road && arms[a]!.index === index && arms[a]!.dir === dir) return a;
    return -1;
  }

  private buildPath(car: TrafficCar): void {
    const P = this.path, T = TRAFFIC;
    P.n = 0;
    P.junction = -1;
    P.inArm = -1;
    P.outArm = -1;
    P.kind = 0;
    P.run = -1;
    let road = car.road, from = car.from, dir = car.dir, along = car.along, s = 0;
    let inRun = this.runOf[road]![dir === 1 ? from : from - 1]!;
    while (s < T.lookAhead && P.n < 16) {
      const r = this.roads[road]!;
      const a = r.points[from]!, b = r.points[from + dir]!;
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-6;
      const dx = (b[0] - a[0]) / length, dz = (b[1] - a[1]) / length;
      const segment = dir === 1 ? from : from - 1;
      const off = (this.safety.offsets[road]?.[segment * 2 + (dir === 1 ? 0 : 1)] ?? this.laneOffset(r)) * (T.keepLeft ? 1 : -1);
      const limit = this.span(road, from, dir, this.spanOut)[1];
      const run = Math.max(0, Math.min(length, limit) - along);
      const i = P.n++;
      P.x[i] = a[0] + dx * along - dz * off;
      P.z[i] = a[1] + dz * along + dx * off;
      P.dx[i] = dx;
      P.dz[i] = dz;
      P.len[i] = run;
      P.s[i] = s;
      if (i > 0 && length > 0.05) {
        const R = this.runOf[road]![segment]!;
        if (R >= 0 && R !== inRun && P.run < 0) {
          P.run = R;
          P.runS = s;
          P.runEnd = this.runTowards[road]![segment * 2 + (dir === 1 ? 0 : 1)]!;
        }
        inRun = R;
      }
      s += run;
      if (limit < length - 1e-6) break; // the lane leaves the district: the vehicle turns back there
      const here = from + dir;
      const j = this.junctionAt.get(key(r.points[here]!)) ?? -1;
      if (j >= 0) {
        if (P.junction >= 0) break; // the junction after next is considered once the next is behind
        P.junction = j;
        P.junctionS = s;
        P.inArm = this.armIndex(j, road, here, -dir);
      }
      this.next(car, road, from, dir, j >= 0);
      const step = this.step;
      if (j >= 0) {
        P.kind = step.kind;
        P.outArm = step.kind === 0 ? this.armIndex(j, step.road, step.from, step.dir) : step.kind === 1 ? P.inArm : -1;
      }
      if (step.kind !== 0) break;
      road = step.road;
      from = step.from;
      dir = step.dir;
      along = 0;
    }
  }

  /** The nearest thing on the path: who (-1 nobody, -2 the player), how far along the path its centre is, how much of it reaches back toward the vehicle, and whether it faces the vehicle. */
  private readonly ahead = { index: -1, s: 0, reach: 0, headOn: false };

  private scan(self: number, car: TrafficCar, playerX: number, playerZ: number): void {
    const P = this.path, T = TRAFFIC, A = this.ahead;
    A.index = -1;
    A.s = Infinity;
    A.reach = 0;
    A.headOn = false;
    const far = (T.lookAhead + 12) * (T.lookAhead + 12);
    for (let j = -1; j < this.cars.length; j++) {
      let ox: number, oz: number, ol = 4.6, ow = 2.2, ofx = 0, ofz = 0;
      const known = j !== -1 || this.playerBody !== null;
      if (j === -1) {
        ox = playerX;
        oz = playerZ;
        if (this.playerBody) {
          ol = this.playerBody.length;
          ow = this.playerBody.width;
          ofx = Math.sin(this.playerBody.heading);
          ofz = Math.cos(this.playerBody.heading);
        }
      } else {
        const other = this.cars[j]!;
        if (j === self || !other.active) continue;
        ox = other.x;
        oz = other.z;
        ol = other.length;
        ow = other.width;
        ofx = Math.sin(other.heading);
        ofz = Math.cos(other.heading);
      }
      if ((ox - car.x) * (ox - car.x) + (oz - car.z) * (oz - car.z) > far) continue;
      for (let p = 0; p < P.n; p++) {
        const dx = P.dx[p]!, dz = P.dz[p]!;
        const rx = ox - P.x[p]!, rz = oz - P.z[p]!;
        const t = rx * dx + rz * dz;
        if (p === 0 && t <= 0) continue; // beside or behind
        const tc = Math.max(0, Math.min(P.len[p]!, t));
        const d = Math.hypot(rx - dx * tc, rz - dz * tc);
        // How far the other body reaches across the path and along it. A player whose heading is not known is taken to face along the path.
        const c = known ? Math.abs(ofx * dx + ofz * dz) : 1, sn = known ? Math.abs(ofx * dz - ofz * dx) : 0;
        const across = (ow / 2) * c + (ol / 2) * sn, reach = (ol / 2) * c + (ow / 2) * sn;
        if (d > car.width / 2 + across + T.sideClearance) continue;
        const at = P.s[p]! + tc;
        if (at < A.s) {
          A.index = j === -1 ? -2 : j;
          A.s = at;
          A.reach = reach;
          A.headOn = j !== -1 && ofx * dx + ofz * dz < -0.5; // the player is never asked to give way
        }
        break;
      }
    }
  }

  /** The index of a vehicle whose body the car's body would overlap at this position; -2 for the player's; -1 for none. */
  private overlapping(self: number, car: TrafficCar, x: number, z: number, heading: number, margin: number): number {
    const p = this.playerBody;
    // The player may drive into a vehicle; a vehicle already touching the player is free to move, or it could never get away.
    if (p && bodiesOverlap(x, z, heading, car.length, car.width, this.playerX, this.playerZ, p.heading, p.length, p.width, margin) && !bodiesOverlap(car.x, car.z, car.heading, car.length, car.width, this.playerX, this.playerZ, p.heading, p.length, p.width, margin)) return -2;
    for (let j = 0; j < this.cars.length; j++) {
      const o = this.cars[j]!;
      if (j === self || !o.active) continue;
      if (bodiesOverlap(x, z, heading, car.length, car.width, o.x, o.z, o.heading, o.length, o.width, margin)) return j;
    }
    return -1;
  }

  // ---- Junctions: reservations and priority ------------------------------------------------------------------

  /**
   * True when two movements through a junction cannot be made at the same time. Each is (arm entered by, arm left by).
   * Two may share the junction only when they come in by the same arm (they follow one another), or when they are
   * the two directions of one straight route on roads wide enough to pass on. Everything else conflicts.
   */
  private conflicts(junction: Junction, inA: number, outA: number, inB: number, outB: number): boolean {
    if (inA >= 0 && inA === inB) return false;
    if (inA < 0 || inB < 0 || outA < 0 || outB < 0) return true;
    if (inA === outB && outA === inB && inA !== outA) {
      // Straight on both ways: a turn, even the same turn made in opposite directions, crosses the other lane.
      const a = junction.arms[inA]!, b = junction.arms[outA]!;
      return !(a.wide && b.wide && movement(a.bearing + Math.PI, b.bearing) === "straight");
    }
    return true;
  }

  private blocker = -1;
  private playerX = 0;
  private playerZ = 0;
  private playerBody: { heading: number; length: number; width: number } | null = null;

  /**
   * The vehicle that keeps the car out of narrow stretch `R`, which it would drive toward end `end`; or -1 when it may enter.
   * It may not while a vehicle in the stretch is coming the other way (in a stretch with one way in: while anything is in it),
   * nor ahead of a vehicle that has waited longer at the other end.
   */
  private runBlocker(self: number, car: TrafficCar, R: number, end: number): number {
    const run = this.narrowRuns[R]!;
    for (let o = 0; o < this.cars.length; o++) {
      const other = this.cars[o]!;
      if (o === self || !other.active) continue;
      const segment = other.dir === 1 ? other.from : other.from - 1;
      let heading = -1;
      if (this.runOf[other.road]![segment] === R) heading = this.runTowards[other.road]![segment * 2 + (other.dir === 1 ? 0 : 1)]!;
      else if (other.runGrant === R) heading = other.runGrantEnd;
      if (heading >= 0) {
        if (run.exclusive || heading !== end) return o;
      } else if (other.runWait === R && (run.exclusive || other.runWaitEnd !== end) && (other.runSince < car.runSince || (other.runSince === car.runSince && o < self))) return o;
    }
    return -1;
  }

  /** Asks to enter the narrow stretch the path leads into. True when the car may; `blocker` is otherwise the vehicle it waits for. */
  private tryRun(self: number, car: TrafficCar): boolean {
    const P = this.path;
    if (car.runWait !== P.run || car.runWaitEnd !== P.runEnd) {
      car.runWait = P.run;
      car.runWaitEnd = P.runEnd;
      car.runSince = this.time;
    }
    const o = this.runBlocker(self, car, P.run, P.runEnd);
    if (o >= 0) {
      this.blocker = o;
      return false;
    }
    car.runGrant = P.run;
    car.runGrantEnd = P.runEnd;
    car.runWait = -1;
    return true;
  }

  /** True when the narrow stretch ahead starts so soon after the junction ahead that the car could not wait between them. */
  private runStartsAtJunction(car: TrafficCar): boolean {
    const P = this.path, T = TRAFFIC;
    if (P.run < 0 || P.junction < 0 || car.runGrant === P.run || P.runS < P.junctionS - 1e-6) return false;
    return P.runS - P.junctionS < this.junctions[P.junction]!.radius + car.length * 1.5 + T.exitRoom + T.stopLineGap;
  }

  /**
   * Asks for a reservation at junction `J` for the car, whose path has just been built and scanned.
   * Returns null when it is granted, or the reason it is not. `blocker` is then the vehicle it gives way to.
   */
  private tryEnter(self: number, car: TrafficCar, J: number): YieldReason | null {
    const junction = this.junctions[J]!, P = this.path, A = this.ahead, T = TRAFFIC;
    this.blocker = -1;
    // Already inside the conflict area (two junctions closer together than a vehicle can stop between): it is
    // let through, and the body check and the following rule keep it from other vehicles.
    if (Math.hypot(car.x - junction.x, car.z - junction.z) < junction.radius + car.length / 2 - 0.2) {
      this.grant(self, car, J, true);
      return null;
    }
    // 1. Nobody on a conflicting movement holds the junction.
    for (const h of junction.holders) {
      const holder = this.cars[h]!, at = holder.holds.indexOf(J);
      if (h === self || at < 0) continue;
      if (this.conflicts(junction, P.inArm, P.outArm, holder.holdIn[at]!, holder.holdOut[at]!)) {
        this.blocker = h;
        return "junction-occupied";
      }
    }
    // 2. Nobody on a conflicting movement arrived first. A vehicle that cannot go because its exit is full does not hold others up.
    for (let o = 0; o < this.cars.length; o++) {
      const other = this.cars[o]!;
      if (o === self || !other.active || other.junction !== J || other.yield === "exit-not-clear" || other.yield === "vehicle-ahead" || other.yield === "narrow-road-occupied" || other.yield === "player-ahead") continue;
      if (!this.conflicts(junction, P.inArm, P.outArm, other.moveIn, other.moveOut)) continue;
      const first = other.arrivedAt !== car.arrivedAt ? other.arrivedAt < car.arrivedAt : other.moveIn !== P.inArm ? other.moveIn < P.inArm : o < self;
      if (first) {
        this.blocker = o;
        return "another-vehicle-has-priority";
      }
    }
    // 3. Its own path is clear to the far side, with room to leave the junction completely.
    if (A.index !== -1) {
      if (A.s - A.reach < P.junctionS - junction.radius) {
        this.blocker = A.index;
        return A.index === -2 ? "player-ahead" : "vehicle-ahead";
      }
      if (A.s - A.reach < P.junctionS + junction.radius + car.length + T.exitRoom) {
        this.blocker = A.index;
        return "exit-not-clear";
      }
    }
    // 4. Where the exit is a road too narrow to pass on, nothing is coming the other way along it.
    if (this.runStartsAtJunction(car) && !this.tryRun(self, car)) return "narrow-road-occupied";
    this.grant(self, car, J, false);
    return null;
  }

  private grant(self: number, car: TrafficCar, J: number, forced: boolean): void {
    const junction = this.junctions[J]!, P = this.path;
    const waited = car.arrivedAt >= 0 ? this.time - car.arrivedAt : 0;
    car.holds.push(J);
    car.holdIn.push(P.inArm);
    car.holdOut.push(P.outArm);
    car.holdPassed.push(false);
    junction.holders.push(self);
    car.junction = -1;
    car.arrivedAt = -1;
    this.junctionStats.entries++;
    if (forced) this.junctionStats.forcedEntries++;
    this.junctionStats.longestWait = Math.max(this.junctionStats.longestWait, waited);
    if (forced || car.loggedYield) this.note(forced ? "forced-entry" : "enter", self, J, P.inArm, P.outArm, forced ? "already inside the junction: let through under the body check" : "the junction is clear", -1, waited);
  }

  private releaseAt(self: number, car: TrafficCar, h: number): void {
    const holders = this.junctions[car.holds[h]!]?.holders;
    const at = holders ? holders.indexOf(self) : -1;
    if (at >= 0) holders!.splice(at, 1);
    car.holds.splice(h, 1);
    car.holdIn.splice(h, 1);
    car.holdOut.splice(h, 1);
    car.holdPassed.splice(h, 1);
  }

  /** Gives up everything a vehicle holds or waits for. Called whenever it leaves the road. */
  private releaseAll(self: number, car: TrafficCar): void {
    while (car.holds.length > 0) this.releaseAt(self, car, car.holds.length - 1);
    car.junction = -1;
    car.arrivedAt = -1;
  }

  /** Releases the junctions the vehicle's body has left. */
  private releasePassed(self: number, car: TrafficCar): void {
    for (let h = car.holds.length - 1; h >= 0; h--) {
      const junction = this.junctions[car.holds[h]!]!;
      // A reservation for a junction that is no longer ahead (the vehicle turned round, or was moved) lapses once it is clear.
      if (!car.holdPassed[h] && this.path.junction !== car.holds[h]) car.holdPassed[h] = true;
      if (car.holdPassed[h] && Math.hypot(car.x - junction.x, car.z - junction.z) > junction.radius + car.length / 2 + 0.3) this.releaseAt(self, car, h);
    }
  }

  private resetState(car: TrafficCar): void {
    car.cameFromRoad = -1;
    car.cameFromSegment = -1;
    car.planNode = -1;
    car.junction = -1;
    car.arrivedAt = -1;
    car.moveIn = -1;
    car.moveOut = -1;
    car.yield = null;
    car.blockedBy = -1;
    car.headOn = 0;
    car.cooldown = 0;
    car.replans = 0;
    car.loggedYield = null;
    car.wasBlocked = false;
    car.runGrant = -1;
    car.runWait = -1;
    car.runSince = -1;
  }

  /** After a vehicle has reversed its direction: its plan and its place in any queue no longer apply. */
  private turnedRound(car: TrafficCar): void {
    car.planNode = -1;
    car.junction = -1;
    car.arrivedAt = -1;
    car.runGrant = -1;
    car.runWait = -1;
    car.cooldown = TRAFFIC.uTurnCooldown;
    for (let h = 0; h < car.holds.length; h++) car.holdPassed[h] = true;
  }

  /**
   * Turns a vehicle round where it stands, into the opposite lane of the same stretch, when that lane exists,
   * is inside the district, clear of buildings and clear of other vehicles. Used to get out of a blockage.
   */
  private uTurn(self: number, car: TrafficCar): boolean {
    const road = this.roads[car.road]!;
    if (road.oneway) return false;
    const a = road.points[car.from]!, b = road.points[car.from + car.dir]!;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const far = car.from + car.dir, from = car.from, dir = car.dir, along = car.along;
    const back = this.span(car.road, far, -dir as 1 | -1, this.spanOut);
    if (back[1] - back[0] < 1e-6) return false;
    car.along = Math.max(back[0], Math.min(back[1], length - along));
    car.from = far;
    car.dir = -dir as 1 | -1;
    const t = this.scratch;
    this.target(car, t);
    const heading = Math.atan2(t.dx, t.dz);
    let clear = !this.hit(car, t.x, t.z, heading) && this.overlapping(self, car, t.x, t.z, heading, 0.5) === -1;
    // Not into the path of a vehicle already moving along that lane.
    for (let j = 0; clear && j < this.cars.length; j++) {
      const o = this.cars[j]!;
      if (j !== self && o.active && o.speed > 1 && Math.hypot(o.x - t.x, o.z - t.z) < 18) clear = false;
    }
    if (!clear) {
      car.along = along;
      car.from = from;
      car.dir = dir;
      return false;
    }
    car.cameFromRoad = -1;
    car.cameFromSegment = -1;
    this.turnedRound(car);
    return true;
  }

  private describeArm(J: number, arm: number): string | null {
    const a = this.junctions[J]?.arms[arm];
    return a ? `from the ${compass(a.bearing)} on ${a.roadId}` : null;
  }

  private movementAt(J: number, inArm: number, outArm: number): Movement {
    const arms = this.junctions[J]?.arms;
    const a = arms?.[inArm], b = arms?.[outArm];
    if (!a || !b) return "ends";
    if (inArm === outArm) return "u-turn";
    return movement(a.bearing + Math.PI, b.bearing);
  }

  private note(kind: TrafficEvent["kind"], car: number, J: number, inArm: number, outArm: number, reason: string, other: number, waited: number): void {
    this.events.push({ time: this.time, kind, car, junction: J >= 0 ? this.junctions[J]!.id : null, approach: J >= 0 ? this.describeArm(J, inArm) : null, movement: J >= 0 ? this.movementAt(J, inArm, outArm) : null, reason, other, waited });
    if (this.events.length > 200) this.events.shift();
  }

  /** What is happening at each junction that has a vehicle in it or waiting for it. */
  junctionStatus(): JunctionStatus[] {
    const out: JunctionStatus[] = [];
    this.junctions.forEach((junction, J) => {
      const holders = junction.holders.map((h) => {
        const car = this.cars[h]!, at = car.holds.indexOf(J);
        return { car: h, approach: this.describeArm(J, car.holdIn[at]!) ?? "unknown", movement: this.movementAt(J, car.holdIn[at]!, car.holdOut[at]!), passedMiddle: car.holdPassed[at] === true };
      });
      const waiting: JunctionStatus["waiting"] = [];
      this.cars.forEach((car, c) => {
        if (car.active && car.junction === J) waiting.push({ car: c, approach: this.describeArm(J, car.moveIn) ?? "unknown", movement: this.movementAt(J, car.moveIn, car.moveOut), waited: this.time - car.arrivedAt, reason: car.yield, behind: car.blockedBy });
      });
      waiting.sort((p, q) => q.waited - p.waited || p.car - q.car);
      if (holders.length > 0 || waiting.length > 0) out.push({ junction: junction.id, x: junction.x, z: junction.z, holders, waiting });
    });
    return out;
  }

  /**
   * Puts a vehicle at a place on a road: `along` metres from point `from` of the road, travelling in `dir`.
   * For tests and tools that script traffic. Returns false when the road is not one traffic uses.
   */
  place(index: number, roadId: string, from: number, dir: 1 | -1, along: number, speed = 0): boolean {
    const car = this.cars[index], r = this.roads.findIndex((road) => road.id === roadId);
    if (!car || r < 0 || from + dir < 0 || from + dir >= this.roads[r]!.points.length) return false;
    this.releaseAll(index, car);
    this.resetState(car);
    car.road = r;
    car.from = from;
    car.dir = dir;
    car.along = along;
    const t = this.scratch;
    this.target(car, t);
    car.x = t.x;
    car.z = t.z;
    car.heading = Math.atan2(t.dx, t.dz);
    car.speed = speed;
    car.stuck = 0;
    car.moved = 0;
    car.active = true;
    return true;
  }

  /**
   * Sets what a vehicle will do at the junction ahead of it: leave along `roadId` in direction `dir`.
   * For tests and tools that script traffic. Returns false when that is not a turn traffic may make there.
   */
  route(index: number, roadId: string, dir: 1 | -1): boolean {
    const car = this.cars[index];
    if (!car?.active) return false;
    let road = car.road, from = car.from, d = car.dir;
    for (let hops = 0; hops < 32; hops++) {
      const here = from + d, node = key(this.roads[road]!.points[here]!);
      if (this.junctionAt.has(node)) {
        const canContinue = this.options(road, from, d);
        const to = this.roads.findIndex((r) => r.id === roadId);
        let toFrom = -1;
        if (canContinue && to === road && dir === d) toFrom = here;
        for (let o = 0; toFrom < 0 && o < this.optCount; o++) if (this.optRoad[o] === to && this.optDir[o] === dir) toFrom = this.optIndex[o]!;
        if (toFrom < 0) return false;
        Object.assign(car, { planNode: node, planInRoad: road, planInFrom: from, planInDir: d, planKind: 0, planRoad: to, planFrom: toFrom, planDir: dir });
        return true;
      }
      this.next(car, road, from, d, false);
      if (this.step.kind !== 0) return false;
      road = this.step.road;
      from = this.step.from;
      d = this.step.dir;
    }
    return false;
  }

  // ---- Movement ----------------------------------------------------------------------------------------------

  /**
   * Moves every vehicle by one step. `player` is the player's car, when its heading and size are known: traffic
   * then treats it as a body like any other. Without it the player is a point with a car's length ahead and behind.
   */
  update(deltaSeconds: number, playerX: number, playerZ: number, player?: { heading: number; length: number; width: number }): void {
    const T = TRAFFIC;
    this.playerX = playerX;
    this.playerZ = playerZ;
    this.playerBody = player && Number.isFinite(player.heading) && player.length > 0 && player.width > 0 ? player : null;
    const dt = Math.min(deltaSeconds, 0.1);
    const t = this.scratch, P = this.path, A = this.ahead;
    if (dt > 0) this.time += dt;
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i]!;
      if (!car.active) {
        this.releaseAll(i, car);
        if (!this.spawn(car, playerX, playerZ)) continue;
      }
      if (dt <= 0) continue;
      const road = this.roads[car.road]!;
      this.target(car, t);
      this.buildPath(car);
      this.releasePassed(i, car);
      this.scan(i, car, playerX, playerZ);

      let wanted = (T.speed[road.class] ?? T.defaultSpeed) * car.pace;
      // Where the lane ahead leaves the district, the vehicle slows and turns back before the edge.
      const limit = this.span(car.road, car.from, car.dir, this.spanOut)[1];
      const edgeAhead = limit < t.length - 1e-6;
      if (edgeAhead && limit - car.along < 9) wanted = Math.min(wanted, T.junctionSpeed);

      // The junction ahead: slow for it, and enter only with a reservation.
      let reason: YieldReason | null = null, other = -1;
      const J = P.junction;
      if (J >= 0 && car.holds.indexOf(J) < 0) {
        const junction = this.junctions[J]!;
        const room = P.junctionS - (junction.radius + car.length / 2 + T.stopLineGap);
        wanted = Math.min(wanted, Math.sqrt(T.junctionSpeed * T.junctionSpeed + 2 * T.approachBraking * Math.max(0, room - 2)));
        if (room <= T.decisionDistance) {
          const arriving = car.junction !== J;
          if (arriving) {
            car.junction = J;
            car.arrivedAt = this.time;
          }
          car.moveIn = P.inArm;
          car.moveOut = P.outArm;
          // It asks from the frame after it arrives, so that vehicles arriving in the same frame are put in
          // order by their approach and not by which of them happens to be updated first.
          reason = arriving ? null : this.tryEnter(i, car, J);
          if (reason !== null) {
            other = this.blocker;
            wanted = Math.min(wanted, Math.max(0, room * T.followGain));
            if (car.loggedYield !== reason) {
              car.loggedYield = reason;
              this.junctionStats.yields++;
              this.note("yield", i, J, P.inArm, P.outArm, reason, other, this.time - car.arrivedAt);
            }
          }
        } else if (car.junction !== -1) {
          car.junction = -1;
          car.arrivedAt = -1;
        }
      } else if (car.junction !== -1) {
        car.junction = -1;
        car.arrivedAt = -1;
      }
      if (car.holds.length > 0) wanted = Math.min(wanted, T.junctionSpeed);

      // A road ahead too narrow to pass on: wait before it, where there is still room, until nothing is coming.
      if (car.runGrant >= 0 && (car.runGrant !== P.run || this.runOf[car.road]![this.segmentOf(car)] === car.runGrant)) car.runGrant = -1; // reached, or no longer ahead
      if (P.run >= 0 && car.runGrant !== P.run && (J < 0 || P.runS < P.junctionS - 1e-6)) {
        const room = P.runS - car.length / 2 - T.stopLineGap;
        wanted = Math.min(wanted, Math.sqrt(T.junctionSpeed * T.junctionSpeed + 2 * T.approachBraking * Math.max(0, room - 2)));
        if (room <= T.decisionDistance && !this.tryRun(i, car)) {
          wanted = Math.min(wanted, Math.max(0, room * T.followGain));
          if (reason === null) {
            reason = "narrow-road-occupied";
            other = this.blocker;
            if (car.loggedYield !== reason) {
              car.loggedYield = reason;
              this.junctionStats.yields++;
              this.note("yield", i, -1, -1, -1, `${reason}: ${this.narrowRuns[P.run]!.id} on ${this.narrowRuns[P.run]!.roadIds.join(", ")}`, other, 0);
            }
          }
        } else if (room > T.decisionDistance) car.runWait = -1;
      } else if (car.runWait >= 0 && !(reason === "narrow-road-occupied")) car.runWait = -1;
      if (reason === null) car.loggedYield = null;

      // Slow for whatever is ahead on its path: other traffic and the player. Speed in proportion to the room left;
      // the factor keeps the braking this asks for within T.braking at any traffic speed.
      let headOn = false;
      if (A.index !== -1) {
        const v = Math.max(0, (A.s - car.length / 2 - A.reach - T.minGap) * T.followGain);
        if (v < wanted) {
          wanted = v;
          if (v < 0.5) {
            headOn = A.headOn;
            if (reason === null) {
              reason = A.index === -2 ? "player-ahead" : A.headOn ? "oncoming-vehicle" : "vehicle-ahead";
              other = A.index;
            }
          }
        }
      }
      car.yield = reason;
      car.blockedBy = other;

      if (car.speed < wanted) car.speed = Math.min(wanted, car.speed + T.acceleration * dt);
      else car.speed = Math.max(wanted, car.speed - T.braking * dt);

      // The state to go back to if another vehicle turns out to be in the way.
      const wasRoad = car.road, wasFrom = car.from, wasDir = car.dir, wasAlong = car.along, wasCameRoad = car.cameFromRoad, wasCameSegment = car.cameFromSegment, wasCooldown = car.cooldown;
      const wasPassed = car.holds.length > 0 ? car.holdPassed.slice() : null;

      car.along += car.speed * dt;
      let alive = true;
      if (edgeAhead && car.along >= limit) {
        car.along = limit;
        alive = this.turnBack(car);
        if (alive) this.target(car, t);
      }
      // A vehicle passes at most a few points in one step; more means segments too short to drive on.
      let hops = 0;
      while (alive && car.along >= t.length) {
        if (++hops > TRAFFIC.maxHopsPerStep) {
          alive = false;
          break;
        }
        const extra = car.along - t.length;
        alive = this.advance(car);
        if (alive) {
          car.along = extra;
          this.target(car, t);
        }
      }
      if (!alive) {
        car.active = false;
        this.releaseAll(i, car);
        continue;
      }
      this.target(car, t);

      // Ease toward the lane position, so lane changes at junctions are curves rather than jumps.
      // The eased path cuts the inside of a corner. Where that would put the body into a building, the car
      // is held closer to its lane line, and finally on it, facing along it. The lane line has been checked.
      // And it is never moved to where its body would overlap another vehicle's: it stays where it is instead.
      const k = 1 - Math.exp(-3.5 * dt);
      const px = car.x, pz = car.z, ph = car.heading;
      let placed = false, inTheWay = -1;
      for (let pass = 0; pass < 2 && !placed; pass++) {
        for (const pull of [k, 0.6, 1]) {
          if (pull < k) continue;
          const nx = px + (t.x - px) * pull, nz = pz + (t.z - pz) * pull;
          const mx = nx - px, mz = nz - pz;
          let heading = ph;
          if (pull === 1) heading = Math.atan2(t.dx, t.dz);
          else if (Math.hypot(mx, mz) > 0.004) {
            let turn = Math.atan2(mx, mz) - ph;
            if (turn > Math.PI) turn -= Math.PI * 2;
            else if (turn < -Math.PI) turn += Math.PI * 2;
            heading = ph + turn * (1 - Math.exp(-6 * dt));
            if (heading > Math.PI) heading -= Math.PI * 2;
            else if (heading < -Math.PI) heading += Math.PI * 2;
          }
          if (this.hit(car, nx, nz, heading)) continue;
          const o = this.overlapping(i, car, nx, nz, heading, T.bodyMargin);
          if (o !== -1) {
            inTheWay = o;
            continue;
          }
          car.x = nx;
          car.z = nz;
          car.heading = heading;
          car.moved = Math.hypot(mx, mz);
          placed = true;
          break;
        }
        if (placed || inTheWay === -1 || pass === 1) break;
        // Another vehicle is in the way. Go back to where it was on the road, stopped, and only settle toward that.
        car.road = wasRoad;
        car.from = wasFrom;
        car.dir = wasDir;
        car.along = wasAlong;
        car.cameFromRoad = wasCameRoad;
        car.cameFromSegment = wasCameSegment;
        car.cooldown = wasCooldown;
        if (wasPassed) for (let h = 0; h < car.holdPassed.length && h < wasPassed.length; h++) car.holdPassed[h] = wasPassed[h]!;
        car.speed = 0;
        this.target(car, t);
      }
      if (!placed && inTheWay === -1) {
        // Nowhere safe: a wall corner too close to the turn for this vehicle. Take it off the road without
        // moving it, and do not offer that turn again.
        this.remove(i, car, t);
        continue;
      }
      if (inTheWay !== -1) {
        if (!placed) car.moved = 0;
        const o = inTheWay >= 0 ? this.cars[inTheWay]! : null;
        headOn = o !== null && Math.sin(car.heading) * Math.sin(o.heading) + Math.cos(car.heading) * Math.cos(o.heading) < -0.5;
        if (car.yield === null) car.yield = "vehicle-in-the-way";
        car.blockedBy = inTheWay;
        if (!car.wasBlocked) {
          car.wasBlocked = true;
          this.junctionStats.blockedMoves++;
          this.note("blocked-move", i, -1, -1, -1, `its next position would overlap ${inTheWay === -2 ? "the player" : `vehicle ${inTheWay}`}: it stays where it is`, inTheWay, car.stuck);
        }
      } else car.wasBlocked = false;

      // Waiting, and what a vehicle does when it has waited too long.
      car.cooldown = Math.max(0, car.cooldown - dt);
      const stopped = car.speed < 0.2;
      car.stuck = stopped ? car.stuck + dt : 0;
      if (!stopped) car.replans = 0;
      car.headOn = stopped && headOn && car.blockedBy >= 0 ? car.headOn + dt : 0;
      if (car.headOn > T.headOnSeconds + (i % 8) * T.headOnStagger && car.cooldown <= 0) {
        // Nose to nose with another vehicle, on a road too narrow to pass: one of the two turns round.
        const facing = car.blockedBy, waited = car.stuck;
        car.headOn = 0;
        if (this.uTurn(i, car)) {
          this.junctionStats.uTurns++;
          this.note("u-turn", i, -1, -1, -1, `nose to nose with vehicle ${facing} with no room to pass: turned round`, facing, waited);
        } else car.cooldown = 2;
      } else if (car.stuck > T.replanSeconds * (car.replans + 1)) {
        car.replans++;
        if (car.junction >= 0 && car.planNode !== -1) {
          // Still waiting at a junction: take a different exit if there is one. Its place in the order is kept.
          const J2 = car.junction, was = car.yield ?? "waiting";
          if (this.choose(car, car.planInRoad, car.planInFrom, car.planInDir as 1 | -1, true)) {
            this.junctionStats.replans++;
            this.note("replan", i, J2, car.moveIn, car.moveOut, `waited ${car.stuck.toFixed(0)} s (${was}): chose another exit`, car.blockedBy, car.stuck);
          }
        } else if (car.blockedBy !== -1 && car.cooldown <= 0 && car.replans >= (car.yield === "narrow-road-occupied" ? 3 : 2)) {
          const behind = car.blockedBy, waited = car.stuck;
          if (this.uTurn(i, car)) {
            this.junctionStats.uTurns++;
            this.note("u-turn", i, -1, -1, -1, `stopped ${waited.toFixed(0)} s behind ${behind === -2 ? "the player" : `vehicle ${behind}`}: turned round`, behind, waited);
          }
        }
      }
      if (car.stuck > T.stuckSeconds && Math.hypot(car.x - playerX, car.z - playerZ) > 30) {
        this.junctionStats.stuckReplacements++;
        this.note("stuck-replaced", i, car.junction, car.moveIn, car.moveOut, `not moved for ${T.stuckSeconds} s (${car.yield ?? "no reason recorded"}): taken out, to re-enter elsewhere`, car.blockedBy, car.stuck);
        car.active = false;
        this.releaseAll(i, car);
      }
    }
  }
}
