import type { DistrictData, DistrictRoad, Point } from "../../src/game/district/types";
import { testDistrict } from "./district";

/**
 * SYNTHETIC district for the district boundary. Not a real place.
 *
 * Bounds x 0..400, z 0..300. Roads are cut at the boundary, as
 * tools/build-district.mjs cuts real roads, and meet it in each awkward way:
 *
 *   square    meets the east edge at a right angle and ends on it
 *   slant     meets the north edge at 30 degrees and ends on it
 *   along     runs parallel to the south edge, 2 m inside it
 *   near      runs parallel to the west edge, 4 m inside it: the centre line fits, the outer lane does not
 *   corner    turns a right angle 3.5 m from the north-east corner
 *   oneway    a one-way road that ends on the west edge
 *   beyond    has a point outside the bounds (a file that was not cut properly)
 *   spine     an ordinary street joining them, well inside
 *
 * There are no buildings: nothing here is about buildings.
 */
function road(id: number, points: Point[], over: Partial<DistrictRoad> = {}): DistrictRoad {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
  return {
    id: `way/${id}`, osm: { type: "way", id }, tags: { highway: "residential" }, kind: "road", class: "residential", name: null, oneway: false, width: 7,
    widthStatus: "estimated", widthBasis: "class default", sidewalk: null, elevated: false, tunnel: false, length, points, ...over,
  };
}

export const EDGE = { spine: "way/300", square: "way/301", slant: "way/302", along: "way/303", near: "way/304", corner: "way/305", oneway: "way/306", beyond: "way/307" } as const;
export const EDGE_BOUNDS = { minX: 0, maxX: 400, minZ: 0, maxZ: 300 } as const;

export function edgeDistrict(): DistrictData {
  const base = testDistrict();
  const roads: DistrictRoad[] = [
    road(300, [[60, 150], [100, 150], [200, 150], [300, 150], [340, 150]]),
    road(301, [[300, 150], [350, 150], [400, 150]]), // ends on the east edge
    road(302, [[200, 150], [286.6, 200], [373.2, 250], [400, 265.47]]), // 30 degrees to the x axis, ends on the east edge at a slant
    road(303, [[60, 150], [60, 2], [340, 2], [340, 150]]), // its middle stretch is 2 m from the south edge
    road(304, [[100, 150], [100, 250], [4, 250], [4, 60], [60, 60], [60, 150]]), // the stretch at x = 4 is 4 m from the west edge
    road(305, [[340, 150], [340, 296.5], [396.5, 296.5], [396.5, 200], [340, 200]]), // bends 3.5 m from the north-east corner
    road(306, [[100, 150], [100, 100], [0, 100]], { oneway: true }), // one-way, out through the west edge
    road(307, [[200, 150], [200, 280], [200, 330], [260, 330], [260, 280], [300, 150]]), // leaves the district and comes back
  ];
  return {
    ...base, id: "edge", name: "Synthetic edge",
    bounds: { ...EDGE_BOUNDS },
    sector: { id: "way/1", tags: { landuse: "residential", name: "Synthetic edge" }, polygons: [{ outer: [[40, 40], [360, 40], [360, 260], [40, 260], [40, 40]], holes: [] }] },
    buildings: [], roads, junctions: [], areas: [], barriers: { lines: [], points: [] }, rail: { lines: [], points: [] }, furniture: [], pois: [],
    spawn: { x: 200, z: 150, heading: Math.PI / 2, road: "way/300", roadName: null, roadClass: "residential" },
  };
}
