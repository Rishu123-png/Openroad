import type { SegmentGrid } from "../district/SegmentGrid";
import type { DistrictBounds } from "../district/types";

export interface VehicleInput {
  accelerate: boolean;
  brake: boolean;
  left: boolean;
  right: boolean;
  handbrake: boolean;
}

export const VEHICLE = {
  wheelbase: 2.6,
  /** Two circles, front and rear, stand in for the body in collisions. */
  collisionRadius: 1.0,
  collisionOffset: 1.25,
  /** Speed at which the engine gives nothing more; drag makes the real top speed about 64 km/h. */
  maxSpeed: 25,
  maxReverse: 6,
  acceleration: 6,
  braking: 14,
  handbrake: 18,
  rolling: 0.5,
  drag: 0.004,
  /** Extra slowing per (m/s) when no mapped road is under the vehicle. */
  offRoadDrag: 0.55,
  steerAtRest: 0.55,
  steerAtSpeed: 0.1,
  steerRate: 2.6,
  /** Speed kept when scraping a wall. */
  scrapeSpeed: 3,
} as const;

/**
 * Arcade vehicle movement: a kinematic bicycle model on flat ground. This is
 * deliberately not a physics engine; it has no suspension, tyres or mass.
 *
 * It knows nothing about rendering, so it runs in tests.
 */
export class VehicleModel {
  x = 0;
  z = 0;
  /** Radians clockwise from north (+Z). */
  heading = 0;
  /** Metres per second; negative in reverse. */
  speed = 0;
  steer = 0;
  onRoad = true;
  /** True while the driver is slowing the vehicle: brake lights. */
  braking = false;
  /** Set from the chosen vehicle. */
  wheelbase: number = VEHICLE.wheelbase;
  collisionOffset: number = VEHICLE.collisionOffset;

  constructor(
    private readonly bounds: DistrictBounds,
    private readonly obstacles: SegmentGrid,
    private readonly roads: SegmentGrid,
  ) {}

  place(x: number, z: number, heading: number): void {
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.speed = 0;
    this.steer = 0;
  }

  get speedKmh(): number {
    return Math.abs(this.speed) * 3.6;
  }

  update(input: VehicleInput, deltaSeconds: number): void {
    let remaining = Math.min(deltaSeconds, 0.1);
    // Short steps keep the collision circles from passing through a wall.
    while (remaining > 1e-5) {
      const dt = Math.min(remaining, 1 / 60);
      this.step(input, dt);
      remaining -= dt;
    }
  }

  /**
   * Keeps the vehicle out of a circle, such as another car. Returns true on contact.
   */
  pushAway(x: number, z: number, radius: number): boolean {
    const dx = this.x - x, dz = this.z - z;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius || d2 < 1e-9) return false;
    const d = Math.sqrt(d2);
    this.x += (dx / d) * (radius - d);
    this.z += (dz / d) * (radius - d);
    this.speed = Math.max(-VEHICLE.scrapeSpeed, Math.min(VEHICLE.scrapeSpeed, this.speed));
    return true;
  }

  private step(input: VehicleInput, dt: number): void {
    const V = VEHICLE;
    const drive = (input.accelerate ? 1 : 0) - (input.brake ? 1 : 0);
    let v = this.speed;

    const slowing = drive !== 0 && Math.sign(v) === -drive && Math.abs(v) > 0.3;
    this.braking = input.handbrake || slowing;
    if (input.handbrake) v = approach(v, 0, V.handbrake * dt);
    else if (slowing) v = approach(v, 0, V.braking * dt);
    else if (drive > 0) v += V.acceleration * (1 - Math.max(0, v) / V.maxSpeed) * dt;
    else if (drive < 0) v -= V.acceleration * 0.7 * (1 - Math.max(0, -v) / V.maxReverse) * dt;

    this.onRoad = this.roads.near(this.x, this.z, 0.5);
    const resist = V.rolling + V.drag * v * v + (this.onRoad ? 0 : V.offRoadDrag * Math.abs(v));
    v = approach(v, 0, resist * dt);

    const steerInput = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const limit = V.steerAtRest + (V.steerAtSpeed - V.steerAtRest) * Math.min(1, Math.abs(v) / V.maxSpeed);
    this.steer = approach(this.steer, steerInput * limit, V.steerRate * dt);

    this.heading += (v / this.wheelbase) * Math.tan(this.steer) * dt;
    if (this.heading > Math.PI) this.heading -= Math.PI * 2;
    else if (this.heading < -Math.PI) this.heading += Math.PI * 2;

    const sin = Math.sin(this.heading), cos = Math.cos(this.heading);
    let x = this.x + sin * v * dt;
    let z = this.z + cos * v * dt;

    // Buildings and walls: push each circle out and move the body with it.
    let hit = false;
    for (let side = -1; side <= 1; side += 2) {
      const cx = x + sin * this.collisionOffset * side, cz = z + cos * this.collisionOffset * side;
      if (this.obstacles.pushOut(cx, cz, V.collisionRadius)) {
        x += this.obstacles.outX - cx;
        z += this.obstacles.outZ - cz;
        hit = true;
      }
    }
    // The edge of the district is a hard limit.
    const margin = 3;
    const b = this.bounds;
    const bx = Math.max(b.minX + margin, Math.min(b.maxX - margin, x));
    const bz = Math.max(b.minZ + margin, Math.min(b.maxZ - margin, z));
    if (bx !== x || bz !== z) hit = true;
    if (hit) v = Math.max(-V.scrapeSpeed, Math.min(V.scrapeSpeed, v));

    this.x = bx;
    this.z = bz;
    this.speed = v;
  }
}

export function approach(value: number, target: number, step: number): number {
  if (value < target) return Math.min(target, value + step);
  return Math.max(target, value - step);
}
