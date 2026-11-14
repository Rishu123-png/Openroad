import type { BuildingAppearance } from "./buildingAppearance";
import type { BuildingCategory, DistrictBuilding, DistrictRoad, HeightStatus, OsmRef, WidthStatus } from "./types";

/**
 * PROVENANCE. Where each thing on screen comes from.
 *
 *   source      taken directly from the map: geometry, a tag, a name
 *   inferred    derived from mapped data by a documented rule
 *   estimated   an approximate size or position the map does not give
 *   decorative  added for looks only; marks no real object
 *
 * Storing an estimate in a field does not make it a fact. A class says how
 * the value was obtained and nothing about how accurate it is.
 */
export type ProvenanceClass = "source" | "inferred" | "estimated" | "decorative";
export const PROVENANCE_CLASSES: readonly ProvenanceClass[] = ["source", "inferred", "estimated", "decorative"];

export interface BuildingProvenance {
  id: string;
  osm: OsmRef;
  /** The outline is always the mapped one. `clipped` marks outlines cut at the district edge. */
  footprint: { class: "source"; clipped: boolean; courtyards: number };
  category: { value: BuildingCategory; class: "source" | "inferred" | "none"; rule: string; evidence: string[] };
  /** True when the use is unknown. Such a building is a neutral stand-in on the mapped outline. */
  genericReconstruction: boolean;
  height: { value: number; class: ProvenanceClass; status: HeightStatus; basis: string };
  appearance: { class: "decorative"; rule: string; roofObjects: number };
  /** Land use mapped around the building. Context only: it decides nothing about the building. */
  context: string | null;
  name: { value: string; class: "source" } | null;
}

export interface RoadProvenance {
  id: string;
  piece: string;
  osm: OsmRef;
  geometry: { class: "source" };
  roadClass: { value: string; class: "source" };
  oneway: boolean;
  /** The access tag exactly as mapped, or null when the way has none. Never changed. */
  access: { value: string; class: "source" } | null;
  width: { value: number; class: ProvenanceClass; status: WidthStatus; basis: string };
  surface: { value: string; class: "source" | "estimated"; basis: string };
  markings: { class: "decorative"; rule: string; pieces: number };
}

export interface FeatureProvenance {
  kind: string;
  /** Map id the feature rests on, when it has one. */
  source: string | null;
  position: ProvenanceClass | null;
  form: ProvenanceClass;
  rule: string;
  x?: number;
  z?: number;
}

export interface WorldProvenance {
  buildings: Map<string, BuildingProvenance>;
  /** Keyed by `${road.id}#${road.piece}`. */
  roads: Map<string, RoadProvenance>;
  features: FeatureProvenance[];
}

/** Category status, also for district files written before the field existed. */
export function categoryClass(building: DistrictBuilding): "source" | "inferred" | "none" {
  if (building.category === "unclassified") return "none";
  if (building.categoryStatus === "source" || building.categoryStatus === "inferred") return building.categoryStatus;
  return building.categoryRule.startsWith("inferred:") ? "inferred" : "source";
}

/** A height tag is source. Levels are mapped but the storey height is assumed, so the height is inferred. Anything else is an estimate. */
export function heightClass(status: HeightStatus): ProvenanceClass {
  return status === "source-height" ? "source" : status === "source-levels" ? "inferred" : "estimated";
}

export function widthClass(status: WidthStatus): ProvenanceClass {
  return status === "source-width" ? "source" : status === "source-lanes" ? "inferred" : "estimated";
}

export function buildingProvenance(building: DistrictBuilding, look: BuildingAppearance): BuildingProvenance {
  const name = building.tags?.name;
  return {
    id: building.id,
    osm: building.osm,
    footprint: { class: "source", clipped: Boolean(building.clipped), courtyards: building.polygons.reduce((n, p) => n + p.holes.length, 0) },
    category: { value: building.category, class: categoryClass(building), rule: building.categoryRule, evidence: building.evidence ?? [] },
    genericReconstruction: look.genericReconstruction,
    height: { value: building.height, class: heightClass(building.heightStatus), status: building.heightStatus, basis: building.heightBasis },
    appearance: { class: "decorative", rule: look.rule, roofObjects: look.roofObjects.length },
    context: building.context?.landuse ?? null,
    name: name ? { value: name, class: "source" } : null,
  };
}

export const roadKey = (road: DistrictRoad): string => `${road.id}#${(road as { piece?: string }).piece ?? "0"}`;

/** Surface as mapped, or "assumed paved" when the way has no surface tag. */
export function roadSurface(road: DistrictRoad): RoadProvenance["surface"] {
  const tag = road.tags?.surface;
  if (tag) return { value: tag, class: "source", basis: `surface=${tag}` };
  return { value: "paved", class: "estimated", basis: "no surface tag: drawn as asphalt" };
}

const UNPAVED = new Set(["unpaved", "dirt", "earth", "ground", "gravel", "fine_gravel", "compacted", "sand", "mud", "grass"]);
/** True only when the mapped surface tag says the road is not sealed. */
export const isUnpaved = (road: DistrictRoad): boolean => UNPAVED.has(road.tags?.surface ?? "");

export function roadProvenance(road: DistrictRoad, markingRule: string, markingPieces: number): RoadProvenance {
  const access = road.tags?.access;
  return {
    id: road.id,
    piece: (road as { piece?: string }).piece ?? "0",
    osm: road.osm,
    geometry: { class: "source" },
    roadClass: { value: road.class, class: "source" },
    oneway: Boolean(road.oneway),
    access: access ? { value: access, class: "source" } : null,
    width: { value: road.width, class: widthClass(road.widthStatus), status: road.widthStatus, basis: road.widthBasis },
    surface: roadSurface(road),
    markings: { class: "decorative", rule: markingRule, pieces: markingPieces },
  };
}

export interface ProvenanceSummary {
  buildings: { total: number; footprintsFromSource: number; genericReconstructions: number; category: Record<string, number>; height: Record<ProvenanceClass, number>; named: number };
  roads: { total: number; width: Record<ProvenanceClass, number>; surface: Record<string, number>; withAccessTag: number; access: Record<string, number>; oneway: number; withMarkings: number };
  features: Record<string, number>;
  featuresByForm: Record<ProvenanceClass, number>;
}

const zero = (): Record<ProvenanceClass, number> => ({ source: 0, inferred: 0, estimated: 0, decorative: 0 });

export function summariseProvenance(p: WorldProvenance): ProvenanceSummary {
  const s: ProvenanceSummary = {
    buildings: { total: 0, footprintsFromSource: 0, genericReconstructions: 0, category: { source: 0, inferred: 0, none: 0 }, height: zero(), named: 0 },
    roads: { total: 0, width: zero(), surface: {}, withAccessTag: 0, access: {}, oneway: 0, withMarkings: 0 },
    features: {},
    featuresByForm: zero(),
  };
  for (const b of p.buildings.values()) {
    s.buildings.total++;
    if (b.footprint.class === "source") s.buildings.footprintsFromSource++;
    if (b.genericReconstruction) s.buildings.genericReconstructions++;
    s.buildings.category[b.category.class] = (s.buildings.category[b.category.class] ?? 0) + 1;
    s.buildings.height[b.height.class]++;
    if (b.name) s.buildings.named++;
  }
  for (const r of p.roads.values()) {
    s.roads.total++;
    s.roads.width[r.width.class]++;
    const surface = `${r.surface.class}:${r.surface.value}`;
    s.roads.surface[surface] = (s.roads.surface[surface] ?? 0) + 1;
    if (r.access) {
      s.roads.withAccessTag++;
      s.roads.access[r.access.value] = (s.roads.access[r.access.value] ?? 0) + 1;
    }
    if (r.oneway) s.roads.oneway++;
    if (r.markings.pieces > 0) s.roads.withMarkings++;
  }
  for (const f of p.features) {
    s.features[f.kind] = (s.features[f.kind] ?? 0) + 1;
    s.featuresByForm[f.form]++;
  }
  return s;
}
