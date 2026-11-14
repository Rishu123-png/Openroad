import { Random } from "../../utils/random";
import type { BuildingIndex } from "../district/BuildingIndex";
import type { DistrictData, DistrictRoad } from "../district/types";

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
 * Nothing here draws anything, so it runs in tests.
 */
export class TrafficModel {
  readonly cars: TrafficCar[] = [];
  readonly roads: DistrictRoad[];
  private readonly links = new Map<number, Link[]>();
  private readonly lengths: number[];
  private readonly totalLength: number;
  private readonly random: Random;
  private readonly bounds: DistrictData["bounds"];

  constructor(
    district: DistrictData,
    private readonly buildings: BuildingIndex,
    seed: number = TRAFFIC.seed,
  ) {
    this.random = new Random(seed);
    this.bounds = district.bounds;
    this.roads = district.roads.filter((r) => r.kind === "road" && !r.tunnel && !r.elevated && TRAFFIC.classes.includes(r.class as never) && usable(r));
    this.roads.forEach((road, r) => {
      road.points.forEach((p, index) => {
        const k = key(p);
        const list = this.links.get(k);
        if (list) list.push({ road: r, index });
        else this.links.set(k, [{ road: r, index }]);
      });
    });
    // Measured here rather than read from the file, so a wrong or missing length cannot skew where vehicles appear.
    this.lengths = this.roads.map((r) => measured(r));
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
      this.cars.push({ active: false, road: 0, from: 0, dir: 1, along: 0, x: 0, z: 0, heading: 0, speed: 0, moved: 0, pace: 0.85 + this.random.next() * 0.25, stuck: 0, model: i, paint: Math.floor(this.random.next() * 1000) });
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
    const off = this.laneOffset(road) * (TRAFFIC.keepLeft ? 1 : -1);
    out.x = a[0] + dx * car.along - dz * off;
    out.z = a[1] + dz * car.along + dx * off;
    out.dx = dx;
    out.dz = dz;
    out.length = length;
  }

  private readonly scratch = { x: 0, z: 0, dx: 0, dz: 0, length: 0 };

  private spawn(car: TrafficCar, playerX: number, playerZ: number): boolean {
    const T = TRAFFIC;
    for (let attempt = 0; attempt < 12; attempt++) {
      let pick = this.random.next() * this.totalLength;
      let r = 0;
      while (r < this.roads.length - 1 && pick > this.lengths[r]!) pick -= this.lengths[r++]!;
      const road = this.roads[r]!;
      const dir: 1 | -1 = road.oneway || this.random.chance(0.5) ? 1 : -1;
      const segment = Math.floor(this.random.next() * (road.points.length - 1));
      car.road = r;
      car.dir = dir;
      car.from = dir === 1 ? segment : segment + 1;
      car.along = 0;
      const t = this.scratch;
      this.target(car, t);
      car.along = this.random.next() * t.length;
      this.target(car, t);
      const b = this.bounds;
      if (t.x < b.minX + 4 || t.x > b.maxX - 4 || t.z < b.minZ + 4 || t.z > b.maxZ - 4) continue;
      if (Math.hypot(t.x - playerX, t.z - playerZ) < T.spawnFromPlayer) continue;
      if (this.buildings.at(t.x, t.z)) continue;
      if (this.cars.some((o) => o !== car && o.active && Math.hypot(o.x - t.x, o.z - t.z) < T.spawnFromOthers)) continue;
      car.x = t.x;
      car.z = t.z;
      car.heading = Math.atan2(t.dx, t.dz);
      car.speed = 0;
      car.stuck = 0;
      car.moved = 0;
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
    const canContinue = here + car.dir >= 0 && here + car.dir < road.points.length;
    for (const link of this.links.get(key(road.points[here]!)) ?? []) {
      const other = this.roads[link.road]!;
      for (const dir of [1, -1] as const) {
        if (dir === -1 && other.oneway) continue; // never against a mapped one-way
        const next = link.index + dir;
        if (next < 0 || next >= other.points.length) continue;
        if (link.road === car.road && link.index === here && dir === -car.dir) continue; // no U-turn
        if (link.road === car.road && link.index === here && dir === car.dir) continue; // added below as "straight on"
        options.push({ road: link.road, index: link.index, dir });
      }
    }
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
    if (!road.oneway) {
      // Dead end or the edge of the district: turn round.
      car.from = here;
      car.dir = -car.dir as 1 | -1;
      car.along = 0;
      return true;
    }
    return false;
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
      const k = 1 - Math.exp(-3.5 * dt);
      const px = car.x, pz = car.z;
      car.x += (t.x - car.x) * k;
      car.z += (t.z - car.z) * k;
      const mx = car.x - px, mz = car.z - pz;
      car.moved = Math.hypot(mx, mz);
      if (car.moved > 0.004) {
        let turn = Math.atan2(mx, mz) - car.heading;
        if (turn > Math.PI) turn -= Math.PI * 2;
        else if (turn < -Math.PI) turn += Math.PI * 2;
        car.heading += turn * (1 - Math.exp(-6 * dt));
        if (car.heading > Math.PI) car.heading -= Math.PI * 2;
        else if (car.heading < -Math.PI) car.heading += Math.PI * 2;
      }

      car.stuck = car.speed < 0.2 ? car.stuck + dt : 0;
      if (car.stuck > T.stuckSeconds && Math.hypot(car.x - playerX, car.z - playerZ) > 30) car.active = false;
    }
  }
}
