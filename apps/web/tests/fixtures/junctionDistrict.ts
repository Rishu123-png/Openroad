import type { DistrictData, DistrictRoad, Point } from "../../src/game/district/types";
import { testDistrict } from "./district";

/**
 * SYNTHETIC districts for junctions. Not real places. No buildings.
 *
 * crossroads(): two two-way streets 7 m wide crossing at (0, 0), each 400 m long.
 *
 *                 north (way/401, point 2)
 *                   |
 *   west ---------- + ---------- east      way/400: points 0 (west), 1 (middle), 2 (east)
 *                   |                      way/401: points 0 (south), 1 (middle), 2 (north)
 *                 south
 *
 * shapes(): one of each kind of point, to tell junctions from bends:
 *   a bend in one road, two roads joined end to end, a T, a crossroads, a dead end,
 *   and a road whose third arm is excluded from traffic by a building across it.
 */
export function junctionRoad(id: number, points: Point[], over: Partial<DistrictRoad> = {}): DistrictRoad {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
  return {
    id: `way/${id}`, osm: { type: "way", id }, tags: { highway: "residential" }, kind: "road", class: "residential", name: null, oneway: false, width: 7,
    widthStatus: "estimated", widthBasis: "class default", sidewalk: null, elevated: false, tunnel: false, length, points, ...over,
  };
}

export function junctionDistrict(roads: DistrictRoad[], size = 400): DistrictData {
  const base = testDistrict();
  return {
    ...base, id: "junctions", name: "Synthetic junctions",
    bounds: { minX: -size, maxX: size, minZ: -size, maxZ: size },
    sector: { id: "way/1", tags: { landuse: "residential", name: "Synthetic junctions" }, polygons: [{ outer: [[-size, -size], [size, -size], [size, size], [-size, size], [-size, -size]], holes: [] }] },
    buildings: [], roads, junctions: [], areas: [], barriers: { lines: [], points: [] }, rail: { lines: [], points: [] }, furniture: [], pois: [],
    spawn: { x: -150, z: 0, heading: Math.PI / 2, road: roads[0]!.id, roadName: null, roadClass: "residential" },
  };
}

export const CROSS = { eastWest: "way/400", northSouth: "way/401" } as const;

export function crossroads(over: Partial<DistrictRoad> = {}): DistrictData {
  return junctionDistrict([junctionRoad(400, [[-200, 0], [0, 0], [200, 0]], over), junctionRoad(401, [[0, -200], [0, 0], [0, 200]], over)]);
}

export const SHAPES = { bend: "way/410", joinA: "way/411", joinB: "way/412", stem: "way/413", cross: "way/414" } as const;

export function shapes(): DistrictData {
  return junctionDistrict([
    junctionRoad(410, [[-300, -200], [-200, -200], [-200, -100], [-100, -100], [0, -100], [100, -100]]), // bends at its 2nd and 3rd points
    junctionRoad(411, [[100, -100], [200, -100]]), // joined end to end with way/410 at (100, -100)
    junctionRoad(412, [[200, -100], [200, 0], [200, 100]]), // joined end to end with way/411 at (200, -100)
    junctionRoad(413, [[-100, -100], [-100, 100]]), // meets way/410 at one of its middle points: a T
    junctionRoad(414, [[0, -200], [0, -100], [0, 50]]), // crosses way/410 at (0, -100): a crossroads
  ]);
}

export const NARROW = { west: "way/440", lane: "way/441", east: "way/442", close: "way/443" } as const;

/**
 * narrowLane(): one straight street written as three roads joined end to end. The middle one, 120 m long from
 * x = -60 to x = 60, is 3.2 m wide: too narrow for two vehicles to pass. And a narrow cul-de-sac off the west part.
 */
export function narrowLane(): DistrictData {
  return junctionDistrict([
    junctionRoad(440, [[-250, 0], [-150, 0], [-60, 0]]),
    junctionRoad(441, [[-60, 0], [0, 0], [60, 0]], { width: 3.2 }),
    junctionRoad(442, [[60, 0], [250, 0]]),
    junctionRoad(443, [[-150, 0], [-150, 60], [-150, 120]], { width: 3.2 }), // a narrow close: a dead end
  ]);
}

/** ladder(): two ordinary streets 200 m apart joined by three narrow lanes, each 200 m long between two junctions. */
export function ladder(): DistrictData {
  return junctionDistrict([
    junctionRoad(450, [[-250, -100], [-100, -100], [0, -100], [100, -100], [250, -100]]),
    junctionRoad(451, [[-250, 100], [-100, 100], [0, 100], [100, 100], [250, 100]]),
    junctionRoad(452, [[-100, -100], [-100, 0], [-100, 100]], { width: 3.4 }),
    junctionRoad(453, [[0, -100], [0, 100]], { width: 3.4 }),
    junctionRoad(454, [[100, -100], [100, 100]], { width: 3.4 }),
  ]);
}
