import type { DistrictBuilding, DistrictData, DistrictRoad, Point } from "../../src/game/district/types";
import { testDistrict } from "./district";

/**
 * SYNTHETIC district built to be hostile to traffic. Not a real place.
 *
 * It contains, on purpose, each way a mapped road and a mapped building can
 * conflict, as they do in real OpenStreetMap data:
 *
 *   gate      a gatehouse mapped across a road: the centre line runs through it
 *   lane      a lane 7 m wide by estimate, with walls 2.2 m either side of its centre line
 *   squeeze   an alley with walls 1 m either side of its centre line: no vehicle fits
 *   corner    a right-angle bend with a building on the inside of the corner
 *   court     a courtyard block (as a multipolygon relation gives it) with a road
 *             through its archway and across the courtyard
 *   clear     ordinary streets with nothing near them
 *
 * A ring road joins them so traffic reaches every part.
 */
const box = (x0: number, z0: number, x1: number, z1: number): Point[] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]];

function building(id: number, outer: Point[], holes: Point[][] = [], relation = false): DistrictBuilding {
  const xs = outer.map((p) => p[0]), zs = outer.map((p) => p[1]);
  const area = (r: Point[]): number => Math.abs(r.reduce((a, p, i) => a + (i ? r[i - 1]![0] * p[1] - p[0] * r[i - 1]![1] : 0), 0) / 2);
  return {
    id: `${relation ? "relation" : "way"}/${id}`, osm: { type: relation ? "relation" : "way", id }, tags: { building: "yes" }, category: "unclassified", categoryRule: "synthetic",
    height: 7, heightStatus: "estimated", heightBasis: "synthetic", polygons: [{ outer, holes }], area: area(outer) - holes.reduce((a, h) => a + area(h), 0),
    centre: [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2], inSector: true, clipped: false, fromRelation: relation,
  };
}

function road(id: number, points: Point[], over: Partial<DistrictRoad> = {}): DistrictRoad {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
  return {
    id: `way/${id}`, osm: { type: "way", id }, tags: { highway: "residential" }, kind: "road", class: "residential", name: null, oneway: false, width: 7,
    widthStatus: "estimated", widthBasis: "class default", sidewalk: null, elevated: false, tunnel: false, length, points, ...over,
  };
}

export const HOSTILE = {
  gate: "way/101", gateBuilding: "way/201",
  lane: "way/102", laneBuildings: ["way/202", "way/203"],
  squeeze: "way/103", squeezeBuildings: ["way/204", "way/205"],
  corner: "way/104", cornerBuilding: "way/206",
  court: "way/105", courtBuilding: "relation/207",
  clear: ["way/100", "way/106"],
} as const;

export function hostileDistrict(): DistrictData {
  const base = testDistrict();
  const roads: DistrictRoad[] = [
    // Ring, 400 m square, with a point wherever a street meets it.
    road(100, [[0, 0], [80, 0], [160, 0], [240, 0], [320, 0], [400, 0], [400, 200], [400, 400], [320, 400], [240, 400], [160, 400], [80, 400], [0, 400], [0, 200], [0, 0]], { width: 9 }),
    // Streets across the ring, south to north.
    road(101, [[80, 0], [80, 100], [80, 200], [80, 300], [80, 400]]), // gate at z 180..200
    road(102, [[160, 0], [160, 100], [160, 200], [160, 300], [160, 400]]), // walled lane z 120..280
    road(103, [[240, 0], [240, 100], [240, 200], [240, 300], [240, 400]], { width: 6 }), // squeeze z 150..250
    // A bend: north from the ring, then east to the ring's east side.
    road(104, [[320, 0], [320, 200], [400, 200]]),
    // Through the courtyard block, west side to the middle street.
    road(105, [[0, 200], [20, 200], [40, 200], [60, 200], [80, 200]]),
    road(106, [[320, 400], [320, 300], [320, 200]]),
  ];
  const buildings: DistrictBuilding[] = [
    building(201, box(70, 180, 90, 188)), // gatehouse across way/101
    building(202, box(140, 120, 157.8, 280)), // west wall of the lane: 2.2 m from the centre line
    building(203, box(162.2, 120, 180, 280)), // east wall
    building(204, box(225, 150, 239, 250)), // 1 m from the centre line
    building(205, box(241, 150, 255, 250)),
    building(206, box(322.2, 150, 370, 197.8)), // inside of the bend, 2.2 m from both legs
    // Courtyard block around x 15..65, z 175..225, courtyard x 25..55. The road enters through the west and east ranges.
    building(207, box(15, 175, 65, 225), [box(25, 185, 55, 215)], true),
    // Ordinary buildings well clear of everything.
    building(208, box(100, 40, 130, 70)),
    building(209, box(270, 300, 300, 340)),
  ];
  return {
    ...base, id: "hostile", name: "Synthetic hostile",
    bounds: { minX: -40, maxX: 440, minZ: -40, maxZ: 440 },
    sector: { id: "way/1", tags: { landuse: "residential", name: "Synthetic hostile" }, polygons: [{ outer: box(-20, -20, 420, 420), holes: [] }] },
    buildings, roads,
    junctions: [],
    areas: [], barriers: { lines: [], points: [] }, rail: { lines: [], points: [] }, furniture: [], pois: [],
    spawn: { x: 200, z: 0, heading: Math.PI / 2, road: "way/100", roadName: null, roadClass: "residential" },
  };
}
