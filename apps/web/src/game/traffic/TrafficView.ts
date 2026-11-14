import type { CarFactory, CarVisual } from "../vehicle/models/CarVisual";
import { TRAFFIC_CARS, TRAFFIC_PAINTS } from "../vehicle/models/carSpecs";
import type { TrafficModel } from "./TrafficModel";

/** Draws the vehicles of a TrafficModel. Cars are created once and reused. */
export class TrafficView {
  private readonly visuals: CarVisual[] = [];

  constructor(
    private readonly model: TrafficModel,
    private readonly factory: CarFactory,
    private readonly rideHeight: number,
  ) {}

  update(): void {
    const cars = this.model.cars;
    while (this.visuals.length < cars.length) {
      const car = cars[this.visuals.length]!;
      const spec = TRAFFIC_CARS[car.model % TRAFFIC_CARS.length]!;
      this.visuals.push(this.factory.create(spec, `traffic_${this.visuals.length}`, TRAFFIC_PAINTS[car.paint % TRAFFIC_PAINTS.length]!));
    }
    for (let i = 0; i < this.visuals.length; i++) {
      const visual = this.visuals[i]!;
      const car = cars[i];
      const shown = car !== undefined && car.active;
      if (visual.root.isEnabled() !== shown) visual.setEnabled(shown);
      if (shown) visual.place(car.x, this.rideHeight, car.z, car.heading, car.moved);
    }
  }
}
