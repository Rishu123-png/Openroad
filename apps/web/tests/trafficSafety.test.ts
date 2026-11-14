import { describe, expect, it } from "vitest";
import { BuildingIndex } from "../src/game/district/BuildingIndex";
import { DistrictGame } from "../src/game/engine/DistrictGame";
import type { DistrictBuilding, DistrictData, Point } from "../src/game/district/types";
import { analyseRoads, footprintHit, laneClearance, ROAD_SAFETY } from "../src/game/traffic/roadSafety";
import { TRAFFIC, TrafficModel, type TrafficCar } from "../src/game/traffic/TrafficModel";
import { TRAFFIC_CARS } from "../src/game/vehicle/models/carSpecs";
import { HOSTILE, hostileDistrict } from "./fixtures/hostileDistrict";
import { describeIncident, trafficReport } from "./support/districtFile";
import { keyboard, memory, nullEngine } from "./support/harness";

/**
 * Traffic and buildings. Everything here is SYNTHETIC: a district written to
 * contain the conflicts between mapped roads and mapped buildings that real
 * data has. The real Alpha 1 file is tested separately (npm run test:real).
 */
const PLAYER: readonly [number, number] = [200, 0];
const box = (x0: number, z0: number, x1: number, z1: number): Point[] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]];

function start(d: DistrictData, count = 40, seed?: number): { traffic: TrafficModel; index: BuildingIndex } {
  const index = new BuildingIndex(d.buildings);
  const traffic = new TrafficModel(d, index, seed);
  traffic.setCount(count);
  return { traffic, index };
}

interface Seen {
  bodyHits: number;
  centreHits: number;
  onBlocked: number;
  /** Road ids with the z (or x) positions cars were seen at. */
  positions: Map<string, Array<readonly [number, number]>>;
}
function drive(traffic: TrafficModel, index: BuildingIndex, seconds: number, dt = 1 / 30): Seen {
  const seen: Seen = { bodyHits: 0, centreHits: 0, onBlocked: 0, positions: new Map() };
  for (let t = 0; t < seconds; t += dt) {
    traffic.update(dt, PLAYER[0], PLAYER[1]);
    for (const c of traffic.cars) {
      if (!c.active) continue;
      if (index.at(c.x, c.z)) seen.centreHits++;
      if (footprintHit(index, c.x, c.z, c.heading, c.length, c.width)) seen.bodyHits++;
      if (traffic.safety.blocked[c.road]![traffic.segmentOf(c)]) seen.onBlocked++;
      const id = traffic.roads[c.road]!.id;
      const list = seen.positions.get(id) ?? [];
      if (list.length < 20000) list.push([c.x, c.z]);
      seen.positions.set(id, list);
    }
  }
  return seen;
}

describe("vehicle footprint against building footprints", () => {
  const wall: DistrictBuilding = hostileDistrict().buildings[0]!; // gatehouse x 70..90, z 180..188
  const index = new BuildingIndex([wall]);
  const car = TRAFFIC_CARS[3]!; // the largest, 4.70 x 1.86

  it("sees a body that overlaps a wall although its centre is clear", () => {
    // Nose 0.35 m into the south face: centre 2 m short of it.
    expect(index.at(80, 178)).toBeNull();
    expect(footprintHit(index, 80, 178, 0, car.length, car.width)?.id).toBe(wall.id);
    // Stopped with the nose 0.15 m short: clear.
    expect(footprintHit(index, 80, 177.5, 0, car.length, car.width)).toBeNull();
  });

  it("uses the vehicle's heading: the same centre is clear lengthways and hits sideways", () => {
    // 1.2 m west of the west face (x 70). Facing north the side is 0.27 m clear; facing east the nose is 1.15 m inside.
    expect(footprintHit(index, 68.8, 184, 0, car.length, car.width)).toBeNull();
    expect(footprintHit(index, 68.8, 184, Math.PI / 2, car.length, car.width)?.id).toBe(wall.id);
    // Facing west, the tail is in it just the same.
    expect(footprintHit(index, 68.8, 184, -Math.PI / 2, car.length, car.width)?.id).toBe(wall.id);
    // A corner clipped diagonally.
    expect(footprintHit(index, 68.6, 178.6, Math.PI / 4, car.length, car.width)?.id).toBe(wall.id);
  });

  it("uses each vehicle's own size", () => {
    const hatch = TRAFFIC_CARS[1]!; // 3.86 m long
    expect(hatch.length).toBeLessThan(car.length);
    // Centre 2.2 m short of the wall: the long car's nose (2.35 m) is in, the short car's (1.93 m) is not.
    expect(footprintHit(index, 80, 177.8, 0, car.length, car.width)?.id).toBe(wall.id);
    expect(footprintHit(index, 80, 177.8, 0, hatch.length, hatch.width)).toBeNull();
  });

  it("treats a courtyard as open ground and its ranges as walls, for a relation building", () => {
    const court = hostileDistrict().buildings.find((b) => b.id === HOSTILE.courtBuilding)!; // x 15..65, z 175..225, yard 25..55 x 185..215
    const yard = new BuildingIndex([court]);
    expect(court.fromRelation).toBe(true);
    expect(footprintHit(yard, 40, 200, 0.7, car.length, car.width)).toBeNull(); // parked in the middle of the yard
    expect(footprintHit(yard, 40, 187, 0, car.length, car.width)?.id).toBe(court.id); // tail through the south range
    expect(footprintHit(yard, 20, 200, 0, car.length, car.width)?.id).toBe(court.id); // inside the west range
    expect(footprintHit(yard, 10, 200, 0, car.length, car.width)).toBeNull(); // outside the block
  });
});

describe("which roads traffic may use", () => {
  const d = hostileDistrict();
  const { traffic } = start(d);
  const safety = traffic.safety;
  const excludedOn = (id: string) => safety.excluded.filter((e) => e.roadId === id);

  it("excludes the stretch of a road whose centre line runs through a building, and only that stretch", () => {
    const gate = excludedOn(HOSTILE.gate);
    expect(gate).toHaveLength(1);
    expect(gate[0]).toMatchObject({ segment: 1, reason: "centre-line-inside-building", buildingId: HOSTILE.gateBuilding, from: [80, 100], to: [80, 200], roadClass: "residential" });
    expect(gate[0]!.at[1]).toBeGreaterThanOrEqual(180);
    expect(gate[0]!.at[1]).toBeLessThanOrEqual(188);
    const r = traffic.roads.findIndex((x) => x.id === HOSTILE.gate);
    expect(safety.blocked[r]).toEqual([false, true, false, false]);
  });

  it("excludes an alley no vehicle fits through, naming the building that is too close", () => {
    const squeeze = excludedOn(HOSTILE.squeeze);
    expect(squeeze.map((e) => e.segment)).toEqual([1, 2]); // z 100..300 covers the walls at 150..250
    for (const e of squeeze) {
      expect(e.reason).toBe("building-within-vehicle-width-of-centre-line");
      expect(HOSTILE.squeezeBuildings).toContain(e.buildingId);
    }
  });

  it("keeps a walled lane open by moving both lanes toward the centre line, and records it", () => {
    expect(excludedOn(HOSTILE.lane)).toEqual([]);
    const narrowed = safety.narrowed.filter((n) => n.roadId === HOSTILE.lane);
    // Segments 1 and 2 (z 100..300) pass the walls at z 120..280, in both directions.
    expect(narrowed.map((n) => [n.segment, n.direction])).toEqual([[1, 1], [1, -1], [2, 1], [2, -1]]);
    for (const n of narrowed) {
      expect(n.wantedOffset).toBe(1.75); // a quarter of the estimated 7 m
      expect(n.usedOffset).toBe(0.875);
      // The lane line plus half a vehicle and the margin stays short of the wall 2.2 m out.
      expect(n.usedOffset + laneClearance()).toBeLessThan(2.2);
      expect(HOSTILE.laneBuildings).toContain(n.buildingId);
    }
    // Away from the walls the lane is where it would be anyway.
    const r = traffic.roads.findIndex((x) => x.id === HOSTILE.lane);
    expect(safety.offsets[r]!.slice(0, 2)).toEqual([1.75, 1.75]);
  });

  it("narrows only the lane on the building's side at a corner", () => {
    const narrowed = safety.narrowed.filter((n) => n.roadId === HOSTILE.corner);
    // The building is east of the north-going leg (right of travel = direction -1's left) and south of the east-going leg.
    expect(narrowed.map((n) => [n.segment, n.direction])).toEqual([[0, -1], [1, -1]]);
    expect(excludedOn(HOSTILE.corner)).toEqual([]);
  });

  it("drops a road that runs through the ranges of a courtyard block, and still knows why", () => {
    expect(traffic.roads.map((r) => r.id)).not.toContain(HOSTILE.court);
    expect(excludedOn(HOSTILE.court).map((e) => [e.segment, e.reason, e.buildingId])).toEqual([
      [0, "centre-line-inside-building", HOSTILE.courtBuilding], [1, "centre-line-inside-building", HOSTILE.courtBuilding],
      [2, "centre-line-inside-building", HOSTILE.courtBuilding], [3, "centre-line-inside-building", HOSTILE.courtBuilding],
    ]);
    expect(safety.roadsFullyExcluded).toBe(1);
  });

  it("does not exclude a road that lies wholly inside a courtyard, or one beside a building with room to pass", () => {
    const court = d.buildings.find((b) => b.id === HOSTILE.courtBuilding)!;
    const inside = { ...d.roads[0]!, id: "way/900", points: [[28, 200], [52, 200]] as Point[], width: 4 };
    const beside = { ...d.roads[0]!, id: "way/901", points: [[0, 228], [80, 228]] as Point[], width: 4 }; // 3 m north of the block
    const result = analyseRoads([inside, beside], new BuildingIndex([court]), () => 1);
    expect(result.excluded).toEqual([]);
    expect(result.blocked).toEqual([[false], [false]]);
    expect(result.narrowed).toEqual([]);
    expect(result.offsets).toEqual([[1, 1], [1, 1]]);
  });

  it("leaves clear streets alone and adds the figures up", () => {
    for (const id of HOSTILE.clear) {
      expect(excludedOn(id)).toEqual([]);
      expect(safety.narrowed.filter((n) => n.roadId === id)).toEqual([]);
    }
    expect(safety.roadsAffected).toBe(3); // gate, squeeze, court
    expect(safety.excluded).toHaveLength(7);
    expect(safety.excludedLength).toBeCloseTo(100 + 200 + 80, 6);
    expect(safety.checkedLength).toBeCloseTo(1600 + 400 * 3 + 280 + 80 + 200, 6);
  });

  it("does not change the map: excluded roads are still in the district and still drawn", () => {
    const before = JSON.stringify(hostileDistrict().roads);
    expect(JSON.stringify(d.roads)).toBe(before);
    const engine = nullEngine(), kb = keyboard();
    const game = new DistrictGame({ engine, input: kb.input, district: hostileDistrict(), settings: memory(), trafficCount: 0 });
    expect(game.world.counts.roads).toBe(7);
    expect(game.world.roadSurfaces.near(80, 184, 0)).toBe(true); // under the gatehouse
    expect(game.world.roadSurfaces.near(240, 200, 0)).toBe(true); // the alley
    expect(game.world.roadSurfaces.near(40, 200, 0)).toBe(true); // the courtyard road
    expect(game.traffic.safety.excluded).toHaveLength(7); // the game's own traffic made the same decision
    game.dispose();
    kb.input.dispose();
    engine.dispose();
  });

  it("finds a wall corner that pokes into a road between two mapped points", () => {
    // A building whose corner reaches 0.6 m past the centre line of a single long segment, 37 m along it.
    const corner = { ...d.buildings[0]!, id: "way/950", polygons: [{ outer: box(-10, 37, 0.6, 37.4), holes: [] }] };
    const long = { ...d.roads[0]!, id: "way/951", points: [[0, 0], [0, 300]] as Point[] };
    const result = analyseRoads([long], new BuildingIndex([corner]), () => 1.75);
    // 0.4 m thick: thinner than the 0.5 m check spacing would catch if the spacing were not along the whole line.
    expect(ROAD_SAFETY.step).toBeLessThanOrEqual(0.5);
    expect(result.excluded.map((e) => e.buildingId)).toEqual(["way/950"]);
  });
});

describe("traffic driving among buildings", () => {
  it("never puts a vehicle's centre or body in a building, over ten minutes, several seeds and frame rates", () => {
    let total = 0;
    for (const [seed, dt] of [[1, 1 / 30], [2, 1 / 30], [3, 1 / 60], [4, 1 / 12], [5, 1 / 144]] as const) {
      const { traffic, index } = start(hostileDistrict(), 40, seed);
      const seen = drive(traffic, index, dt < 0.01 ? 60 : 150, dt);
      expect(seen.centreHits, `seed ${seed}`).toBe(0);
      expect(seen.bodyHits, `seed ${seed}`).toBe(0);
      expect(traffic.activeCount).toBe(40);
      total += [...seen.positions.values()].reduce((a, l) => a + l.length, 0);
    }
    expect(total).toBeGreaterThan(100_000); // the cars were there to be checked
  });

  it("never routes a vehicle onto an excluded stretch: it turns off or turns round before it", () => {
    const { traffic, index } = start(hostileDistrict(), 40, 7);
    const seen = drive(traffic, index, 300);
    expect(seen.onBlocked).toBe(0);
    // The gate road is used on both sides of the gate, and never between z 100 and 200.
    const gate = seen.positions.get(HOSTILE.gate)!;
    expect(gate.some(([, z]) => z < 95)).toBe(true);
    expect(gate.some(([, z]) => z > 205)).toBe(true);
    expect(gate.filter(([, z]) => z > 102 && z < 198)).toEqual([]);
    // The alley: its open ends are used, its walled middle is not.
    const squeeze = seen.positions.get(HOSTILE.squeeze)!;
    expect(squeeze.length).toBeGreaterThan(0);
    expect(squeeze.filter(([, z]) => z > 102 && z < 298)).toEqual([]);
    // The courtyard road carries nothing.
    expect(seen.positions.has(HOSTILE.court)).toBe(false);
  });

  it("drives the walled lane between the walls, both ways, each vehicle clear of both", () => {
    const { traffic, index } = start(hostileDistrict(), 40, 11);
    const seen = drive(traffic, index, 300);
    const between = seen.positions.get(HOSTILE.lane)!.filter(([, z]) => z > 130 && z < 270);
    expect(between.length).toBeGreaterThan(200);
    const xs = between.map(([x]) => x);
    // Walls at 157.8 and 162.2; the widest vehicle's side is 0.93 m from its centre.
    expect(Math.min(...xs) - 0.93).toBeGreaterThan(157.8);
    expect(Math.max(...xs) + 0.93).toBeLessThan(162.2);
    // Two lanes are still kept: traffic each way is on its own side of the centre line.
    expect(xs.some((x) => x < 159.5)).toBe(true);
    expect(xs.some((x) => x > 160.5)).toBe(true);
    expect(seen.bodyHits).toBe(0);
  });

  it("takes a bend with a building on the inside without clipping it, in both directions", () => {
    const { traffic, index } = start(hostileDistrict(), 40, 13);
    const seen = drive(traffic, index, 400);
    const bend = seen.positions.get(HOSTILE.corner)!;
    // Within 12 m of the corner at (320, 200), on each leg.
    const near = bend.filter(([x, z]) => Math.hypot(x - 320, z - 200) < 12);
    expect(near.filter(([x, z]) => z < 196 && x < 322).length).toBeGreaterThan(20); // the north-south leg
    expect(near.filter(([x, z]) => x > 324 && z > 198).length).toBeGreaterThan(20); // the east-west leg
    expect(seen.bodyHits).toBe(0);
    // No sample is inside the building's corner region (x > 322.2 and z < 197.8), body included.
    for (const [x, z] of near) expect(x > 322.2 && z < 197.8, `centre at ${x.toFixed(2)}, ${z.toFixed(2)}`).toBe(false);
  });

  it("as a last resort removes a vehicle where it stands rather than move it into a wall, records it, and stops using that turn", () => {
    // A side road with a wall along its west side. The analysis moves the lane to the centre line, which is safe.
    const d = hostileDistrict();
    d.buildings = [{ ...d.buildings[0]!, id: "way/960", polygons: [{ outer: box(-30, 10, -1.2, 60), holes: [] }] }];
    const main = { ...d.roads[0]!, id: "way/961", width: 7, points: [[-200, 0], [-100, 0], [0, 0], [100, 0], [200, 0]] as Point[] };
    const side = { ...d.roads[0]!, id: "way/962", width: 4, points: [[0, 0], [0, 100], [0, 200]] as Point[] };
    d.roads = [main, side];
    const safe = start(d, 30, 3);
    const r = safe.traffic.roads.findIndex((x) => x.id === "way/962");
    expect(safe.traffic.safety.offsets[r]![0]).toBe(0);
    const ok = drive(safe.traffic, safe.index, 300);
    expect(ok.bodyHits).toBe(0);
    expect(safe.traffic.removalCount).toBe(0); // the analysis was enough; nothing had to be removed
    expect(ok.positions.get("way/962")!.some(([, z]) => z > 15 && z < 55)).toBe(true); // and the side road is in use past the wall

    // Now pretend the analysis missed the wall: the northbound lane line is put 2 m west, inside it.
    const { traffic, index } = start(d, 30, 3);
    traffic.safety.offsets[r]![0] = 2;
    const seen = drive(traffic, index, 600);
    expect(seen.centreHits).toBe(0);
    expect(seen.bodyHits).toBe(0); // still never in the wall
    expect(traffic.removalCount).toBeGreaterThan(0);
    for (const removal of traffic.removals) {
      expect(removal).toMatchObject({ roadId: "way/962", segment: 0, buildingId: "way/960" });
      expect(footprintHit(index, removal.x, removal.z, 0, 1, 1)).toBeNull(); // taken off where it stood, outside the wall
    }
    // A vehicle stopped just after turning in blames the turn; one stopped well along blames the stretch,
    // which is then excluded like any other unsafe stretch and recorded with its own reason.
    const turned = traffic.removals.filter((x) => x.turnFrom);
    for (const removal of turned) expect(removal.turnFrom!.roadId).toBe("way/961");
    const learned = traffic.safety.excluded.filter((e) => e.reason === "vehicle-had-no-safe-position");
    expect(learned.length + turned.length).toBeGreaterThan(0);
    for (const e of learned) expect(e).toMatchObject({ roadId: "way/962", segment: 0, buildingId: "way/960" });
    // It does not keep happening: at most the two turns onto that lane, and the stretch once.
    expect(traffic.removalCount).toBeLessThanOrEqual(4);
    const after = traffic.removalCount;
    const later = drive(traffic, index, 300);
    expect(traffic.removalCount).toBe(after);
    expect(later.bodyHits).toBe(0);
    expect(traffic.activeCount).toBe(30);
  });

  it("places new vehicles with their whole body clear, not only their centre", () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const { traffic, index } = start(hostileDistrict(), 40, seed);
      traffic.update(0, PLAYER[0], PLAYER[1]);
      for (const c of traffic.cars.filter((x) => x.active)) {
        expect(footprintHit(index, c.x, c.z, c.heading, c.length, c.width), `seed ${seed}`).toBeNull();
        expect(traffic.safety.blocked[c.road]![traffic.segmentOf(c)]).toBe(false);
      }
    }
  });

  it("gives every vehicle the size of the model drawn for it", () => {
    const { traffic } = start(hostileDistrict(), 8);
    traffic.cars.forEach((c, i) => {
      const spec = TRAFFIC_CARS[c.model % TRAFFIC_CARS.length]!;
      expect([c.length, c.width], `car ${i}`).toEqual([spec.length, spec.width]);
    });
    expect(Math.max(...TRAFFIC_CARS.map((s) => s.width)) / 2).toBeCloseTo(ROAD_SAFETY.vehicleHalfWidth, 6); // the clearance is for the widest
  });
});

describe("when the map leaves traffic nowhere to go", () => {
  it("runs with no traffic when every road is unsafe, and says which roads and why", () => {
    const d = hostileDistrict();
    d.roads = d.roads.filter((r) => r.id === HOSTILE.court);
    const { traffic } = start(d, 40);
    expect(traffic.roads).toEqual([]);
    expect(traffic.cars).toHaveLength(0);
    expect(() => {
      for (let i = 0; i < 100; i++) traffic.update(1 / 30, 0, 0);
    }).not.toThrow();
    expect(traffic.activeCount).toBe(0);
    expect(traffic.safety.excluded).toHaveLength(4);
    expect(traffic.safety.roadsFullyExcluded).toBe(1);
    traffic.setCount(40);
    expect(traffic.cars).toHaveLength(0);
  });

  it("keeps traffic on the one safe stretch when the rest of a road is unsafe", () => {
    const d = hostileDistrict();
    // One road, 300 m, with a building across each end stretch: only the middle 100 m is usable, and it leads nowhere.
    d.roads = [{ ...d.roads[0]!, id: "way/970", points: [[0, 1000], [100, 1000], [200, 1000], [300, 1000]] as Point[], width: 7 }];
    d.buildings = [{ ...d.buildings[0]!, id: "way/971", polygons: [{ outer: box(40, 990, 60, 1010), holes: [] }, { outer: box(240, 990, 260, 1010), holes: [] }] }];
    d.bounds = { minX: -100, maxX: 400, minZ: 900, maxZ: 1100 };
    const { traffic, index } = start(d, 6);
    const seen = drive(traffic, index, 240);
    expect(traffic.safety.blocked).toEqual([[true, false, true]]);
    expect(traffic.activeCount).toBeGreaterThan(0);
    expect(seen.bodyHits).toBe(0);
    expect(seen.onBlocked).toBe(0);
    const xs = seen.positions.get("way/970")!.map(([x]) => x);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(99);
    expect(Math.max(...xs)).toBeLessThanOrEqual(201);
    // They keep moving: turning round at each end rather than stopping for good.
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(80);
  });
});

describe("one coordinate system", () => {
  it("roads, buildings, traffic and the drawn world all use the district file's x and z, unswapped and unmirrored", () => {
    const d = hostileDistrict();
    const engine = nullEngine(), kb = keyboard();
    const game = new DistrictGame({ engine, input: kb.input, district: d, settings: memory(), trafficCount: 40 });
    const { buildingIndex, roadSurfaces } = game.world;
    // The fixture is not symmetric about x = z: a building at x 100..130, z 40..70 and none at x 40..70, z 100..130.
    expect(buildingIndex.at(115, 55)?.id).toBe("way/208");
    expect(buildingIndex.at(55, 115)).toBeNull();
    expect(buildingIndex.at(115, -55)).toBeNull();
    expect(buildingIndex.at(-115, 55)).toBeNull();
    // A road at x 320, z 0..200 and none at z 320, x 100..200.
    expect(roadSurfaces.near(320, 100, 0)).toBe(true);
    expect(roadSurfaces.near(100, 320, 0)).toBe(false);
    // The drawn buildings stand where the file says: the wall mesh spans the same box as the footprints.
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const mesh of game.scene.meshes) {
      if (!mesh.name.startsWith("plaster@") && !mesh.name.startsWith("concrete@")) continue;
      mesh.computeWorldMatrix(true);
      const box3 = mesh.getBoundingInfo().boundingBox;
      minX = Math.min(minX, box3.minimumWorld.x);
      maxX = Math.max(maxX, box3.maximumWorld.x);
      minZ = Math.min(minZ, box3.minimumWorld.z);
      maxZ = Math.max(maxZ, box3.maximumWorld.z);
    }
    const xs = d.buildings.flatMap((b) => b.polygons[0]!.outer.map((p) => p[0])), zs = d.buildings.flatMap((b) => b.polygons[0]!.outer.map((p) => p[1]));
    expect(minX).toBeGreaterThan(Math.min(...xs) - 1);
    expect(maxX).toBeLessThan(Math.max(...xs) + 1);
    expect(minZ).toBeGreaterThan(Math.min(...zs) - 1);
    expect(maxZ).toBeLessThan(Math.max(...zs) + 1);
    // Traffic drives on the drawn roads and is drawn where the model has it.
    engine.getDeltaTime = () => 1000 / 30;
    for (let i = 0; i < 300; i++) game.renderFrame();
    const cars = game.traffic.cars.filter((c) => c.active);
    expect(cars.length).toBe(40);
    for (const c of cars) expect(roadSurfaces.near(c.x, c.z, 0.5), `car at ${c.x.toFixed(1)}, ${c.z.toFixed(1)}`).toBe(true);
    const drawn = game.scene.transformNodes.filter((n) => /^traffic_\d+$/.test(n.name) && n.isEnabled());
    expect(drawn.length).toBe(40);
    for (const node of drawn) {
      const c = game.traffic.cars[Number(node.name.split("_")[1])]!;
      expect([node.position.x, node.position.z]).toEqual([c.x, c.z]);
      expect(node.rotation.y).toBeCloseTo(c.heading, 9);
    }
    game.dispose();
    kb.input.dispose();
    engine.dispose();
  });
});

describe("the whole-district traffic check used on real data (here on SYNTHETIC data)", () => {
  it("passes the hostile district with every safety check on, and reports what was excluded", () => {
    const engine = nullEngine();
    try {
      const report = trafficReport(engine, hostileDistrict(), 60);
      expect(report.problems).toEqual([]);
      expect(report.vehiclesInBuildings).toEqual([]);
      expect(report.incidentCount).toBe(0);
      expect(report.placed).toBe(TRAFFIC.maxCount);
      expect(report.moved).toBeGreaterThan(30);
      expect(report.safety).toMatchObject({ roadsChecked: 7, roadsAffected: 3, roadsFullyExcluded: 1, segmentsExcluded: 7, metresExcluded: 380, byReason: { "centre-line-inside-building": 5, "building-within-vehicle-width-of-centre-line": 2 } });
      expect(report.lines.join("\n")).toMatch(/unsafe: way\/101 \(residential\) segment 1 .* centre-line-inside-building, way\/201/);
      expect(report.lines.join("\n")).toMatch(/building intersections: 0 samples from 0 different vehicles/);
    } finally {
      engine.dispose();
    }
  });

  it("names the vehicle, time, position, size, building, road and cause when a vehicle is in a building", () => {
    const d = hostileDistrict();
    const { traffic, index } = start(d, 1);
    traffic.update(0, PLAYER[0], PLAYER[1]);
    const car = traffic.cars[0]!;
    const place = (roadId: string, from: number, dir: 1 | -1, x: number, z: number, heading: number): TrafficCar => Object.assign(car, { road: traffic.roads.findIndex((r) => r.id === roadId), from, dir, x, z, heading });
    const gatehouse = d.buildings.find((b) => b.id === HOSTILE.gateBuilding)!;

    // A: on a centre line that runs through the building.
    let it1 = describeIncident(traffic, index, place(HOSTILE.gate, 1, 1, 80, 184, 0), 0, 90, gatehouse, true);
    expect(it1).toMatchObject({ car: 0, frame: 90, seconds: 3, x: 80, z: 184, heading: 0, length: car.length, width: car.width, centreInside: true, buildingId: "way/201", buildingCategory: "unclassified", buildingFromRelation: false, roadId: "way/101", roadClass: "residential", roadWidth: 7, roadWidthStatus: "estimated", segment: 1, direction: 1 });
    expect(it1.buildingBounds).toEqual({ minX: 70, maxX: 90, minZ: 180, maxZ: 188 });
    expect(it1.distance).toBeCloseTo(-4, 6); // 4 m from the nearest face, inside
    expect(it1.cause).toMatch(/^A: the mapped road centre line is inside the building/);

    // B: centre line clear, lane position inside. The east wall of the alley is 1 m from the line; a 1.5 m lane offset is in it.
    const east = d.buildings.find((b) => b.id === "way/205")!;
    const r = traffic.roads.findIndex((x) => x.id === HOSTILE.squeeze);
    traffic.safety.offsets[r]![1 * 2 + 1] = 1.5; // as the lane would be without the safety analysis (direction -1, left of travel is east)
    it1 = describeIncident(traffic, index, place(HOSTILE.squeeze, 2, -1, 241.5, 180, Math.PI), 0, 1, east, true);
    expect(it1.cause).toMatch(/^B: the lane position \(1\.50 m left of the centre line of a 6 m estimated road\) is inside the building/);
    expect(it1.direction).toBe(-1);

    // C: centre line and lane clear, the vehicle is off its lane (cutting the bend) and inside the corner building.
    const corner = d.buildings.find((b) => b.id === HOSTILE.cornerBuilding)!;
    it1 = describeIncident(traffic, index, place(HOSTILE.corner, 1, 1, 324, 196, 0.8), 0, 1, corner, true);
    expect(it1.cause).toMatch(/^C: the vehicle is \d\.\d\d m off its lane line/);
    expect(it1.offLane).toBeGreaterThan(3);

    // D: centre outside, body overlapping.
    it1 = describeIncident(traffic, index, place(HOSTILE.gate, 1, 1, 80, 178, 0), 0, 1, gatehouse, false);
    expect(it1.cause).toMatch(/^D: centre clear .* body overlaps the building/);
    expect(it1.distance).toBeCloseTo(2, 6);
    expect(it1.centreInside).toBe(false);
  });
});
