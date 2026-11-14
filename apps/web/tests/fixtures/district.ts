import type { DistrictBuilding, DistrictData, Point, Polygon } from "../../src/game/district/types";

/**
 * SYNTHETIC test district, written by hand. Not a real place.
 *
 * Two streets cross at (0, 0). Buildings stand in the corners: a square
 * house, an L-shaped block, and a courtyard block as a relation would give it.
 */
const box = (x: number, z: number, w: number, d: number): Point[] => [[x, z], [x + w, z], [x + w, z + d], [x, z + d], [x, z]];

function areaOf(polygons: Polygon[]): number {
  const ring = (r: readonly Point[]): number => {
    let a = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j]![0] * r[i]![1] - r[i]![0] * r[j]![1];
    return Math.abs(a / 2);
  };
  return polygons.reduce((sum, p) => sum + ring(p.outer) - p.holes.reduce((h, r) => h + ring(r), 0), 0);
}

function building(id: string, polygons: Polygon[], extra: Partial<DistrictBuilding> = {}): DistrictBuilding {
  const pts = polygons.flatMap((p) => p.outer);
  const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
  return {
    id, osm: { type: id.startsWith("relation") ? "relation" : "way", id: Number(id.split("/")[1]) }, tags: { building: "yes" },
    category: "unclassified", categoryRule: "building=yes with no other evidence", height: 6.5, heightStatus: "estimated", heightBasis: "default for unclassified",
    polygons, area: areaOf(polygons), centre: [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2], inSector: true, clipped: false, fromRelation: id.startsWith("relation"),
    ...extra,
  };
}

export const L_SHAPE: Point[] = [[20, 20], [60, 20], [60, 34], [35, 34], [35, 56], [20, 56], [20, 20]];
export const COURT_OUTER = box(-80, 20, 60, 44);
export const COURT_HOLE = box(-62, 34, 24, 16);

export function testDistrict(): DistrictData {
  return {
    formatVersion: 1, kind: "district", id: "test", name: "Synthetic test", region: "test", synthetic: true, attribution: "synthetic",
    bounds: { minX: -150, maxX: 150, minZ: -150, maxZ: 150 },
    sector: { id: "way/1", tags: { landuse: "residential", name: "Alpha 1" }, polygons: [{ outer: box(-120, -120, 240, 240), holes: [] }] },
    buildings: [
      building("way/10", [{ outer: box(20, -60, 30, 40), holes: [] }], { category: "house", tags: { building: "house" }, height: 7.5, heightStatus: "source-height", heightBasis: "height=7.5" }),
      building("way/11", [{ outer: L_SHAPE, holes: [] }], { category: "apartments", tags: { building: "apartments", "building:levels": "5" }, height: 16, heightStatus: "source-levels", heightBasis: "building:levels=5 x 3.2 m" }),
      building("relation/12", [{ outer: COURT_OUTER, holes: [COURT_HOLE] }]),
    ],
    roads: [
      { id: "way/20", osm: { type: "way", id: 20 }, tags: { highway: "tertiary" }, kind: "road", class: "tertiary", name: null, oneway: false, width: 8, widthStatus: "source-width", widthBasis: "width=8", sidewalk: "both", elevated: false, tunnel: false, length: 300, points: [[-150, 0], [0, 0], [150, 0]] },
      { id: "way/21", osm: { type: "way", id: 21 }, tags: { highway: "residential" }, kind: "road", class: "residential", name: null, oneway: false, width: 6, widthStatus: "estimated", widthBasis: "default", sidewalk: null, elevated: false, tunnel: false, length: 300, points: [[0, -150], [0, 0], [0, 150]] },
      { id: "way/22", osm: { type: "way", id: 22 }, tags: { highway: "footway" }, kind: "path", class: "footway", name: null, oneway: false, width: 2, widthStatus: "estimated", widthBasis: "default", sidewalk: null, elevated: false, tunnel: false, length: 40, points: [[0, 100], [40, 100]] },
    ],
    junctions: [{ point: [0, 0], arms: 4, radius: 4, roads: ["way/20", "way/21"] }],
    areas: [{ id: "way/30", osm: { type: "way", id: 30 }, tags: { leisure: "park" }, kind: "green", name: null, polygons: [{ outer: box(-130, -130, 90, 90), holes: [] }] }],
    barriers: {
      // Crosses the residential street at (0, -80); a gate is mapped at (60, -80).
      lines: [{ id: "way/40", osm: { type: "way", id: 40 }, tags: { barrier: "wall" }, kind: "wall", points: [[-30, -80], [100, -80]] }],
      points: [{ id: "node/41", osm: { type: "node", id: 41 }, tags: { barrier: "gate" }, kind: "gate", point: [60, -80] }],
    },
    rail: { lines: [{ id: "way/50", osm: { type: "way", id: 50 }, tags: { railway: "subway", bridge: "yes" }, kind: "subway", elevated: true, points: [[-150, 130], [150, 130]] }], points: [] },
    furniture: [
      { id: "node/60", osm: { type: "node", id: 60 }, tags: { highway: "street_lamp" }, kind: "street_lamp", point: [10, 70] },
      { id: "node/61", osm: { type: "node", id: 61 }, tags: { natural: "tree" }, kind: "tree", point: [-100, -100] },
    ],
    pois: [],
    spawn: { x: 0, z: -40, heading: 0, road: "way/21", roadName: null, roadClass: "residential" },
  };
}
