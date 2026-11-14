import type { DistrictBuilding, DistrictData, DistrictRoad, Point } from "../../src/game/district/types";
import { testDistrict } from "./district";

/**
 * SYNTHETIC grid district for stability tests. Not a real place.
 *
 * `blocks` x `blocks` city blocks of 60 m, streets between them, and
 * `perBlock` x `perBlock` buildings on each block. Every value is fixed by
 * the arguments, so two calls give identical districts.
 */
export function largeDistrict(blocks = 5, perBlock = 4): DistrictData {
  const pitch = 70, street = 10, size = blocks * pitch;
  const base = testDistrict();
  const categories = ["house", "apartments", "commercial", "unclassified", "institutional"] as const;
  const buildings: DistrictBuilding[] = [];
  let id = 1000;
  for (let bx = 0; bx < blocks; bx++) {
    for (let bz = 0; bz < blocks; bz++) {
      const x0 = bx * pitch + street / 2 + 3, z0 = bz * pitch + street / 2 + 3, cell = (pitch - street - 6) / perBlock;
      for (let i = 0; i < perBlock; i++) {
        for (let j = 0; j < perBlock; j++) {
          const x = x0 + i * cell + 1, z = z0 + j * cell + 1, w = cell - 2;
          const category = categories[(bx + bz * 2 + i + j * 3) % categories.length]!;
          const outer: Point[] = [[x, z], [x + w, z], [x + w, z + w], [x, z + w], [x, z]];
          buildings.push({
            id: `way/${id}`, osm: { type: "way", id }, tags: { building: "yes" }, category, categoryRule: "synthetic", height: 6 + ((i * 7 + j * 3 + bx) % 5) * 3.2,
            heightStatus: (["source-height", "source-levels", "estimated"] as const)[(i + j) % 3]!, heightBasis: "synthetic", polygons: [{ outer, holes: [] }], area: w * w,
            centre: [x + w / 2, z + w / 2], inSector: true, clipped: false, fromRelation: false,
          });
          id++;
        }
      }
    }
  }
  const roads: DistrictRoad[] = [];
  const junctions: DistrictData["junctions"] = [];
  for (let k = 0; k <= blocks; k++) {
    const line: Point[] = [];
    for (let m = 0; m <= blocks; m++) line.push([m * pitch, k * pitch]);
    const main = k === 0 || k === blocks;
    const common = { tags: { highway: main ? "secondary" : "residential" }, kind: "road" as const, class: main ? "secondary" : "residential", name: null, oneway: false, width: main ? 10 : 7, widthStatus: "estimated" as const, widthBasis: "synthetic", sidewalk: null, elevated: false, tunnel: false, length: size };
    roads.push({ id: `way/${100 + k}`, osm: { type: "way", id: 100 + k }, ...common, points: line });
    roads.push({ id: `way/${200 + k}`, osm: { type: "way", id: 200 + k }, ...common, points: line.map(([x, z]) => [z, x] as Point) });
    for (let m = 0; m <= blocks; m++) {
      const corner = (k === 0 || k === blocks) && (m === 0 || m === blocks), edge = k === 0 || k === blocks || m === 0 || m === blocks;
      junctions.push({ point: [m * pitch, k * pitch], arms: corner ? 2 : edge ? 3 : 4, radius: 5, roads: [`way/${100 + k}`, `way/${200 + m}`] });
    }
  }
  return {
    ...base, id: "large", name: "Synthetic grid",
    bounds: { minX: -20, maxX: size + 20, minZ: -20, maxZ: size + 20 },
    sector: { id: "way/1", tags: { landuse: "residential", name: "Synthetic grid" }, polygons: [{ outer: [[-10, -10], [size + 10, -10], [size + 10, size + 10], [-10, size + 10], [-10, -10]], holes: [] }] },
    buildings, roads, junctions, areas: [], barriers: { lines: [], points: [] }, rail: { lines: [], points: [] }, furniture: [], pois: [],
    spawn: { x: pitch * 2, z: pitch * 2 + 20, heading: 0, road: "way/202", roadName: null, roadClass: "residential" },
  };
}
