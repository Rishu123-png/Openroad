/**
 * The district file written by tools/build-district.mjs.
 * Coordinates are [x, z] in metres from the region origin (+X east, +Z north).
 */
export type Point = readonly [number, number];
export interface Polygon {
  outer: Point[];
  holes: Point[][];
}
export interface OsmRef {
  type: "way" | "relation" | "node";
  id: number;
}
export type Tags = Record<string, string>;

export const BUILDING_CATEGORIES = ["house", "apartments", "commercial", "institutional", "industrial", "healthcare", "other", "unclassified"] as const;
export type BuildingCategory = (typeof BUILDING_CATEGORIES)[number];
/** "estimated" heights are category defaults, not measurements. */
export type HeightStatus = "source-height" | "source-levels" | "estimated";
export type WidthStatus = "source-width" | "source-lanes" | "estimated";

export interface DistrictBuilding {
  id: string;
  osm: OsmRef;
  tags: Tags;
  category: BuildingCategory;
  categoryRule: string;
  height: number;
  heightStatus: HeightStatus;
  heightBasis: string;
  polygons: Polygon[];
  area: number;
  centre: Point;
  inSector: boolean;
  clipped: boolean;
  fromRelation: boolean;
}

export interface DistrictRoad {
  id: string;
  osm: OsmRef;
  tags: Tags;
  kind: "road" | "path";
  class: string;
  name: string | null;
  oneway: boolean;
  width: number;
  widthStatus: WidthStatus;
  widthBasis: string;
  sidewalk: string | null;
  elevated: boolean;
  tunnel: boolean;
  length: number;
  points: Point[];
}

export interface DistrictJunction {
  point: Point;
  arms: number;
  radius: number;
  roads: string[];
}

export interface DistrictArea {
  id: string;
  osm: OsmRef;
  tags: Tags;
  kind: "sector" | "green" | "water" | "parking" | "other";
  name: string | null;
  polygons: Polygon[];
}

export interface DistrictLine {
  id: string;
  osm: OsmRef;
  tags: Tags;
  kind?: string;
  elevated?: boolean;
  points: Point[];
}

export interface DistrictPoint {
  id: string;
  osm: OsmRef;
  tags: Tags;
  kind?: string;
  name?: string | null;
  point: Point;
}

export interface DistrictSpawn {
  x: number;
  z: number;
  /** Radians clockwise from north (+Z). */
  heading: number;
  road: string;
  roadName: string | null;
  roadClass: string;
}

export interface DistrictBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface DistrictData {
  formatVersion: 1;
  kind: "district";
  id: string;
  name: string;
  region: string;
  /** True for invented test data. The game shows a banner. */
  synthetic: boolean;
  attribution: string;
  bounds: DistrictBounds;
  sector: { id: string; tags: Tags; polygons: Polygon[] };
  buildings: DistrictBuilding[];
  roads: DistrictRoad[];
  junctions: DistrictJunction[];
  areas: DistrictArea[];
  barriers: { lines: DistrictLine[]; points: DistrictPoint[] };
  rail: { lines: DistrictLine[]; points: DistrictPoint[] };
  furniture: DistrictPoint[];
  pois: DistrictPoint[];
  spawn: DistrictSpawn;
}
