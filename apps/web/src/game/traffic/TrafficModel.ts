import { Random } from "../../utils/random";
import type { BuildingIndex } from "../district/BuildingIndex";
import type { DistrictData, DistrictRoad } from "../district/types";
import { TRAFFIC_CARS } from "../vehicle/models/carSpecs";
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
  /** A vehicle that has not moved for this long is taken out and re-enters elsewhere. */
  stuckSeconds: 8,
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
      });
    }
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
      car.x = t.x;
      car.z = t.z;
      car.heading = Math.atan2(t.dx, t.dz);
      car.speed = 0;
      car.stuck = 0;
      car.moved = 0;
      car.cameFromRoad = -1;
      car.cameFromSegment = -1;
      car.active = true;
      return true;
    }
    car.active = false;
    return false;
  }

  /** Chooses what happens at the point the car has just reached. Returns false when it must leave the map. */
  private advance(car: TrafficCar): boolean {
    const road = this.roads[car.road]!;
    const here = car.from + car.dir;
    const options: Array<{ road: number; index: number; dir: 1 | -1 }> = [];
    const canContinue = here + car.dir >= 0 && here + car.dir < road.points.length && !this.isBlocked(car.road, here, car.dir);
    const leaving = this.segmentOf(car);
    for (const link of this.links.get(key(road.points[here]!)) ?? []) {
      const other = this.roads[link.road]!;
      for (const dir of [1, -1] as const) {
        if (dir === -1 && other.oneway) continue; // never against a mapped one-way
        const next = link.index + dir;
        if (next < 0 || next >= other.points.length) continue;
        if (this.isBlocked(link.road, link.index, dir)) continue; // runs through or against a building
        if (this.blockedTurns.has(this.turnKey(car.road, leaving, link.road, dir === 1 ? link.index : link.index - 1))) continue;
        if (link.road === car.road && link.index === here && dir === -car.dir) continue; // no U-turn
        if (link.road === car.road && link.index === here && dir === car.dir) continue; // added below as "straight on"
        options.push({ road: link.road, index: link.index, dir });
      }
    }
    car.cameFromRoad = car.road;
    car.cameFromSegment = leaving;
    if (canContinue && (options.length === 0 || this.random.chance(0.6))) {
      car.from = here;
      car.along = 0;
      return true;
    }
    if (options.length > 0) {
      const o = options[Math.floor(this.random.next() * options.length)]!;
      car.road = o.road;
      car.from = o.index;
      car.dir = o.dir;
      car.along = 0;
      return true;
    }
    if (!road.oneway && !this.isBlocked(car.road, here, -car.dir as 1 | -1)) {
      // Dead end: turn round.
      car.from = here;
      car.dir = -car.dir as 1 | -1;
      car.along = 0;
      return true;
    }
    // A one-way road ends, or the lane back starts outside the district: the vehicle leaves and re-enters elsewhere.
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
  }

  private isJunction(car: TrafficCar): boolean {
    const road = this.roads[car.road]!;
    return (this.links.get(key(road.points[car.from + car.dir]!))?.length ?? 0) > 1;
  }

  update(deltaSeconds: number, playerX: number, playerZ: number): void {
    const T = TRAFFIC;
    const dt = Math.min(deltaSeconds, 0.1);
    const t = this.scratch;
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i]!;
      if (!car.active && !this.spawn(car, playerX, playerZ)) continue;
      if (dt <= 0) continue;
      const road = this.roads[car.road]!;
      this.target(car, t);

      let wanted = (T.speed[road.class] ?? T.defaultSpeed) * car.pace;
      if (t.length - car.along < 9 && this.isJunction(car)) wanted = Math.min(wanted, T.junctionSpeed);
      // Where the lane ahead leaves the district, the vehicle slows and turns back before the edge.
      const limit = this.span(car.road, car.from, car.dir, this.spanOut)[1];
      const edgeAhead = limit < t.length - 1e-6;
      if (edgeAhead && limit - car.along < 9) wanted = Math.min(wanted, T.junctionSpeed);

      // Slow for whatever is ahead in this lane: other traffic and the player.
      const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
      for (let j = -1; j < this.cars.length; j++) {
        let ox: number, oz: number;
        if (j === -1) {
          ox = playerX;
          oz = playerZ;
        } else {
          const other = this.cars[j]!;
          if (j === i || !other.active) continue;
          ox = other.x;
          oz = other.z;
        }
        const dx = ox - car.x, dz = oz - car.z;
        const ahead = dx * fx + dz * fz;
        if (ahead <= 0 || ahead > T.lookAhead) continue;
        if (Math.abs(dx * fz - dz * fx) > T.laneHalfWidth) continue;
        // Speed in proportion to the room left. The factor keeps the braking this asks for within T.braking at any traffic speed.
        wanted = Math.min(wanted, Math.max(0, (ahead - T.gap) * T.followGain));
      }

      if (car.speed < wanted) car.speed = Math.min(wanted, car.speed + T.acceleration * dt);
      else car.speed = Math.max(wanted, car.speed - T.braking * dt);

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
        continue;
      }
      this.target(car, t);

      // Ease toward the lane position, so lane changes at junctions are curves rather than jumps.
      // The eased path cuts the inside of a corner. Where that would put the body into a building, the car
      // is held closer to its lane line, and finally on it, facing along it. The lane line has been checked.
      const k = 1 - Math.exp(-3.5 * dt);
      const px = car.x, pz = car.z, ph = car.heading;
      let placed = false;
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
        car.x = nx;
        car.z = nz;
        car.heading = heading;
        car.moved = Math.hypot(mx, mz);
        placed = true;
        break;
      }
      if (!placed) {
        // Nowhere safe: a wall corner too close to the turn for this vehicle. Take it off the road without
        // moving it, and do not offer that turn again.
        this.remove(i, car, t);
        continue;
      }

      car.stuck = car.speed < 0.2 ? car.stuck + dt : 0;
      if (car.stuck > T.stuckSeconds && Math.hypot(car.x - playerX, car.z - playerZ) > 30) car.active = false;
    }
  }
}
