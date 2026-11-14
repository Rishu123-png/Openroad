import type { DistrictData, DistrictPoint } from "../../src/game/district/types";
import { testDistrict } from "./district";

/**
 * SYNTHETIC test district for the realism rules. Not a real place.
 *
 * The hand-written test district plus what the real Alpha 1 file is reported
 * to contain: gate points on roads, a lift gate, named points, a station, a
 * residential land-use area, private access, surface tags, and a through road
 * whose width and lane count are only class defaults.
 */
const node = (id: number, tags: Record<string, string>, point: [number, number], kind?: string): DistrictPoint => ({ id: `node/${id}`, osm: { type: "node", id }, tags, kind, name: tags.name ?? null, point });

export const GATE_ON_STREET: [number, number] = [0, -110];
export const LIFT_GATE: [number, number] = [100, 0];
export const WALL_GATE: [number, number] = [60, -80];
export const AVENUE_X = 135;

export function realismDistrict(): DistrictData {
  const d = testDistrict();
  d.roads[1]!.tags = { highway: "residential", access: "private", surface: "paved" };
  d.roads.push(
    { id: "way/23", osm: { type: "way", id: 23 }, tags: { highway: "secondary" }, kind: "road", class: "secondary", name: null, oneway: false, lanes: 4, width: 14, widthStatus: "estimated", widthBasis: "estimated lanes x 3.5 m", sidewalk: null, elevated: false, tunnel: false, length: 300, points: [[AVENUE_X, -150], [AVENUE_X, 150]] },
    { id: "way/24", osm: { type: "way", id: 24 }, tags: { highway: "service", surface: "unpaved", access: "permissive" }, kind: "road", class: "service", name: null, oneway: false, width: 3.5, widthStatus: "estimated", widthBasis: "estimated lanes x 3.5 m", sidewalk: null, elevated: false, tunnel: false, length: 40, points: [[-150, 110], [-110, 110]] },
  );
  d.barriers.points.push(
    node(42, { barrier: "gate", name: "Gate No. 4" }, GATE_ON_STREET, "gate"),
    node(43, { barrier: "lift_gate" }, LIFT_GATE, "lift_gate"),
    node(44, { barrier: "bollard" }, [0, 60], "bollard"),
  );
  d.areas.push({ id: "way/31", osm: { type: "way", id: 31 }, tags: { landuse: "residential", name: "Block A" }, kind: "other", name: "Block A", polygons: [{ outer: [[-140, 10], [120, 10], [120, 125], [-140, 125], [-140, 10]], holes: [] }] });
  d.rail.points.push(node(51, { railway: "station", name: "Alpha 1" }, [20, 131], "station"), node(52, { public_transport: "stop_position", name: "Alpha 1" }, [30, 130], "stop_position"));
  d.pois.push(
    node(70, { amenity: "bank", name: "Test Bank" }, [35, -40], "amenity=bank"),
    node(71, { place: "square", name: "Test Chowk" }, [0, 0], "place=square"),
    node(72, { shop: "bakery" }, [-100, 60], "shop=bakery"), // mapped but unnamed: no label
  );
  d.buildings[0]!.tags = { ...d.buildings[0]!.tags, name: "Test Bank" };
  d.buildings[2]!.tags = { ...d.buildings[2]!.tags, name: "Court House" };
  return d;
}
