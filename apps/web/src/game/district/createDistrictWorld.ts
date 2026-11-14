import { Color3 } from "@babylonjs/core/Maths/math.color";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import "@babylonjs/core/Meshes/instancedMesh"; // registers Mesh.createInstance()
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { GeometryBuffer, type Color } from "../geometry/GeometryBuffer";
import { createMaterialLibrary, type MaterialKey, type MaterialLibrary } from "../materials/MaterialLibrary";
import { streetLight } from "../world/furniture";
import { srgb } from "../world/layout";
import { broadTree, columnarTree } from "../world/vegetation";
import { CarFactory, type CarVisual } from "../vehicle/models/CarVisual";
import { TRAFFIC_CARS, TRAFFIC_PAINTS } from "../vehicle/models/carSpecs";
import { BuildingIndex } from "./BuildingIndex";
import { addBuildingDetails, planAppearance } from "./buildingAppearance";
import { BUILDING_LAYERS, dressBuilding, usableHeight } from "./buildingGeometry";
import { GATE_RULES, isGate, planGates, type GatePlan } from "./gates";
import { collectLabels, type NameLabel } from "./labels";
import { buildingProvenance, isUnpaved, roadKey, roadProvenance, type WorldProvenance } from "./provenance";
import { planVerges, VERGE_RULES, type VergeRun } from "./streetDetail";
import { addJunctionMarkings, addLaneMarkings, addSpeedBreaker, MARKING_RULES, paintedLanes } from "./roadMarkings";
import { DebugViews, type DebugTints, type TintRange } from "./DebugViews";
import { placeDecorations, type Decoration } from "./decorations";
import { addDisc, addStrip, offsetLine } from "./roadGeometry";
import { SegmentGrid } from "./SegmentGrid";
import type { BuildingCategory, DistrictData, HeightStatus, WidthStatus } from "./types";

/** Side of the square tiles that static geometry is merged into, in metres. */
const TILE = 250;

/** Heights of flat surfaces above the ground, in metres. Materials also carry a depth offset, so these can stay small. */
const Y = { green: 0.012, shoulder: 0.015, path: 0.02, road: 0.03, paint: 0.036, sidewalk: 0.15 } as const;

/**
 * Assumptions the map data does not settle. Each is used only where noted
 * and is listed in docs/DISTRICT_RULES.md.
 */
export const DISTRICT_ASSUMPTIONS = {
  /** Height of a wall, fence or hedge without a height tag. */
  barrierHeight: { wall: 1.8, fence: 1.5, hedge: 1.2, retaining_wall: 1.2, city_wall: 2.5 } as Record<string, number>,
  /** Opening left in a mapped wall at a mapped gate, and wherever a mapped road crosses it. */
  gateGap: 2.5,
  /** Width of a footpath drawn beside a road tagged sidewalk=both/left/right/yes. */
  sidewalkWidth: 1.8,
  /** Deck height of rail tagged as a bridge. OSM gives no height: this is an ESTIMATE, not a measurement. */
  viaductHeight: 9,
  railWidth: 3.2,
  /** Generated form of the viaduct on the mapped line: deck, side walls, rails, pier heads. */
  viaduct: { deckWidth: 4.4, deckDepth: 0.9, wallHeight: 1, gauge: 1.435, pierHead: 3.4 },
  /** Generic canopy drawn over the mapped line at a mapped station point. Its size and form are not from the map. */
  station: { length: 70, width: 11, roofAbove: 5.2, within: 60 },
  /** Spacing of the generated piers under elevated rail. */
  pierSpacing: 30,
  /** Paved margin drawn beside a carriageway: wider on the main roads. */
  shoulder: { main: 1.2, minor: 0.5 },
  mainClasses: ["trunk", "primary", "secondary", "tertiary"] as readonly string[],
} as const;

const DEBUG_CATEGORY: Record<BuildingCategory, Color> = {
  house: [0.9, 0.75, 0.1],
  apartments: [0.95, 0.4, 0.05],
  commercial: [0.1, 0.3, 0.9],
  institutional: [0.5, 0.15, 0.8],
  industrial: [0.4, 0.22, 0.08],
  healthcare: [0.85, 0.05, 0.05],
  other: [0.05, 0.6, 0.55],
  unclassified: [0.6, 0.6, 0.6],
};
const DEBUG_HEIGHT: Record<HeightStatus, Color> = { "source-height": [0.1, 0.7, 0.15], "source-levels": [0.9, 0.8, 0.1], estimated: [0.85, 0.08, 0.05] };
const DEBUG_WIDTH: Record<WidthStatus, Color> = { "source-width": [0.1, 0.65, 0.15], "source-lanes": [0.85, 0.75, 0.1], estimated: [0.9, 0.4, 0.05] };
const OSM_BLUE: Color = [0.1, 0.25, 0.85];
const MAPPED_CYAN: Color = [0.05, 0.7, 0.8];
const GENERATED_MAGENTA: Color = [0.9, 0.05, 0.7];
const DARK: Color = [0.16, 0.16, 0.16];
const GREEN_AREA: Color = [0.25, 0.5, 0.25];

const mapped = (c: Color = MAPPED_CYAN): DebugTints => [c === MAPPED_CYAN ? [0.42, 0.42, 0.42] : c, c === MAPPED_CYAN ? [0.42, 0.42, 0.42] : c, MAPPED_CYAN];

function idNoise(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

/** What the generated paint on a road rests on. Paint is never mapped. */
function markingRule(road: { kind: string; class: string; width: number; oneway: boolean; tags?: Record<string, string> }): string {
  const M = MARKING_RULES;
  if (road.kind !== "road" || !M.classes.includes(road.class as never)) return `none: ${road.kind === "road" ? road.class : "path"} roads are not marked`;
  if (road.width < M.minWidth) return `none: narrower than ${M.minWidth} m`;
  return `${road.oneway ? "edge lines only" : "centre line"} by class and width${road.tags?.lanes ? `; lane lines from lanes=${road.tags.lanes}` : "; no lane lines, because the lane count is not mapped"}`;
}

export interface DistrictWorld {
  materials: MaterialLibrary;
  shadowCasters: AbstractMesh[];
  /** Named counts for tests and the overlay. `generated*` entries are decoration, not map data. */
  counts: Record<string, number>;
  /** Shared vehicle meshes and materials. */
  cars: CarFactory;
  /** Building walls and mapped barriers, for collision. */
  obstacles: SegmentGrid;
  /** Carriageways and paths, for "is the vehicle on a mapped road". */
  roadSurfaces: SegmentGrid;
  buildingIndex: BuildingIndex;
  decorations: Decoration[];
  debug: DebugViews;
  /** Where every rendered building, road and added feature comes from. */
  provenance: WorldProvenance;
  /** Names the map gives, at their mapped positions. */
  labels: NameLabel[];
  /** One entry per mapped gate point. */
  gates: GatePlan[];
  /** Generated kerbed verges. */
  verges: VergeRun[];
}

interface Batch {
  layer: MaterialKey;
  buffer: GeometryBuffer;
  ranges: TintRange[];
}

/**
 * Builds the 3D district from a district file.
 *
 * From the map: every building footprint, road centre line, area outline,
 * barrier, rail line and point object. Estimated: building heights and road
 * widths where the file says so. Generated: the trees and lights from
 * decorations.ts and the piers under elevated rail.
 */
export function createDistrictWorld(scene: Scene, district: DistrictData): DistrictWorld {
  const materials = createMaterialLibrary(scene);
  // Flat layers sit millimetres apart; the depth offset keeps the upper one in front at any distance.
  materials.grass.zOffset = -1;
  materials.pavers.zOffset = -2;
  materials.asphalt.zOffset = -3;
  materials.roadPaint.zOffset = -5;
  materials.grate.zOffset = -5;

  const counts: Record<string, number> = {};
  const add = (name: string, by = 1): void => void (counts[name] = (counts[name] ?? 0) + by);
  const batches = new Map<string, Batch>();
  const at = (layer: MaterialKey, x: number, z: number): Batch => {
    const key = `${layer}@${Math.floor(x / TILE)}_${Math.floor(z / TILE)}`;
    let batch = batches.get(key);
    if (!batch) batches.set(key, (batch = { layer, buffer: new GeometryBuffer(), ranges: [] }));
    return batch;
  };
  const draw = (batch: Batch, tints: DebugTints | null, fn: (g: GeometryBuffer) => void): void => {
    const start = batch.buffer.vertexCount;
    fn(batch.buffer);
    if (tints) batch.ranges.push({ start, count: batch.buffer.vertexCount - start, tints });
  };

  const b = district.bounds;
  const provenance: WorldProvenance = { buildings: new Map(), roads: new Map(), features: [] };
  const obstacles = new SegmentGrid(32, 4);
  const roadSurfaces = new SegmentGrid(32, 4);
  const carriageways = new SegmentGrid(32, 4);
  const buildingIndex = new BuildingIndex(district.buildings);

  // ---- ground: unmapped land is one plain surface, extended past the edge so the horizon is not a cliff
  // Dry, dusty ground with gentle variation, so open land is not one flat colour.
  const groundBuffer = new GeometryBuffer();
  groundBuffer.rectY(b.minX - 600, b.minZ - 600, b.maxX + 600, b.maxZ + 600, 0, {
    cell: 40,
    tint: (x, z) => {
      const k = 0.9 + 0.2 * (0.5 + 0.5 * Math.sin(x * 0.011 + Math.sin(z * 0.007) * 2) * Math.cos(z * 0.013));
      return [1.34 * k, 1.02 * k, 1.12 * k]; // dry, dusty earth with thin cover: unmapped land is not shown as a lawn
    },
  });
  // Its own material: the same texture as grass, but without the depth offset the mapped green areas use to sit on top of it.
  const groundMaterial = materials.grass.clone("groundMaterial");
  groundMaterial.zOffset = 0;

  // ---- mapped areas
  for (const area of district.areas) {
    if (area.kind !== "green" && area.kind !== "water") continue;
    const first = area.polygons[0]!.outer[0]!;
    const layer: MaterialKey = area.kind === "green" ? "grass" : "metal";
    const color: Color = area.kind === "green" ? [1, 1, 1] : srgb(70, 110, 140);
    draw(at(layer, first[0], first[1]), mapped(area.kind === "green" ? GREEN_AREA : color), (g) => {
      for (const p of area.polygons) g.polygonY(p.outer, p.holes, Y.green, color);
    });
    add(area.kind === "green" ? "greenAreas" : "waterAreas");
  }

  // ---- roads and paths
  const A = DISTRICT_ASSUMPTIONS;
  const junctionZones = new SegmentGrid(32, 1);
  for (const j of district.junctions) if (j.arms >= 3) junctionZones.add(j.point[0], j.point[1], j.point[0], j.point[1], j.radius + 2.5);
  for (const road of district.roads) {
    for (let i = 1; i < road.points.length; i++) {
      const p = road.points[i - 1]!, q = road.points[i]!;
      roadSurfaces.add(p[0], p[1], q[0], q[1], road.width / 2);
      if (road.kind === "road") carriageways.add(p[0], p[1], q[0], q[1], road.width / 2);
    }
    const first = road.points[0]!;
    const half = road.width / 2;
    if (road.kind === "path") {
      draw(at("pavers", first[0], first[1]), [DARK, DARK, DEBUG_WIDTH[road.widthStatus]], (g) => addStrip(g, road.points, half, -half, Y.path, [0.92, 0.9, 0.86]));
      add("paths");
      continue;
    }
    // Subtle variation between roads: resurfaced at different times.
    const shade = (road.class === "service" ? 1.12 : 1) * (0.92 + idNoise(road.id) * 0.14);
    // Only a mapped surface tag makes a road unsealed: it is then drawn as bare earth with no paved margin.
    const unpaved = isUnpaved(road);
    const tone: Color = unpaved ? [2.5 * shade, 2.05 * shade, 1.5 * shade] : [shade, shade, shade];
    draw(at("asphalt", first[0], first[1]), [DARK, DARK, DEBUG_WIDTH[road.widthStatus]], (g) => addStrip(g, road.points, half, -half, Y.road, tone));
    add("roads");
    if (unpaved) {
      add("unpavedRoads");
      continue;
    }
    // Road edge: a paved margin under the asphalt. Generated; its width is a rule, not data.
    const margin = A.mainClasses.includes(road.class) ? A.shoulder.main : A.shoulder.minor;
    draw(at("pavers", first[0], first[1]), [DARK, DARK, GENERATED_MAGENTA], (g) => addStrip(g, road.points, half + margin, -half - margin, Y.shoulder, [0.66, 0.63, 0.6]));
    // Footpaths only where the road itself is tagged as having them.
    const w = DISTRICT_ASSUMPTIONS.sidewalkWidth;
    const left = road.sidewalk === "both" || road.sidewalk === "left" || road.sidewalk === "yes";
    const right = road.sidewalk === "both" || road.sidewalk === "right" || road.sidewalk === "yes";
    if (left || right) {
      draw(at("pavers", first[0], first[1]), mapped(), (g) => {
        if (left) addStrip(g, road.points, half + w, half, Y.sidewalk, [1, 1, 1]);
        if (right) addStrip(g, road.points, -half, -half - w, Y.sidewalk, [1, 1, 1]);
      });
      add("sidewalkRoads");
    }
  }
  for (const j of district.junctions) {
    draw(at("asphalt", j.point[0], j.point[1]), [DARK, DARK, [0.5, 0.5, 0.5]], (g) => addDisc(g, j.point[0], j.point[1], j.radius, Y.road, [1, 1, 1]));
    add(j.arms >= 3 ? "intersections" : "roadJoints");
  }

  // ---- generated road markings (roadMarkings.ts): by rule from class and lane count, never from mapped paint
  for (const road of district.roads) {
    const first = road.points[0]!;
    let pieces = 0;
    draw(at("roadPaint", first[0], first[1]), [DARK, DARK, GENERATED_MAGENTA], (g) => add("generatedLaneLines", (pieces = addLaneMarkings(g, paintedLanes(road), Y.paint, junctionZones))));
    provenance.roads.set(roadKey(road), roadProvenance(road, markingRule(road), pieces));
  }
  for (const j of district.junctions) {
    draw(at("roadPaint", j.point[0], j.point[1]), [DARK, DARK, GENERATED_MAGENTA], (g) => {
      const [stops, crossings] = addJunctionMarkings(g, j, district.roads, Y.paint);
      add("generatedStopLines", stops);
      add("generatedCrossings", crossings);
      if (stops + crossings > 0) provenance.features.push({ kind: "junction-markings", source: null, position: "decorative", form: "decorative", rule: `stop lines (${stops}) and zebra crossings (${crossings}) by rule at a junction of ${j.arms} arms; no crossing is mapped`, x: j.point[0], z: j.point[1] });
    });
  }

  // ---- buildings: one extrusion per mapped footprint
  for (const building of district.buildings) {
    // Colour, wall pattern and roof objects are generated from the building's id: the same on every load.
    const look = planAppearance(building);
    const { wall, roof } = look;
    const tints: DebugTints = [DEBUG_CATEGORY[building.category], DEBUG_HEIGHT[building.heightStatus], OSM_BLUE];
    const [cx, cz] = building.centre;
    // Walls and roof are the mapped footprint; the parapet, door and balconies are generated and are tinted as such.
    const generatedTints: DebugTints = [tints[0], tints[1], GENERATED_MAGENTA];
    const open = new Map<MaterialKey, { batch: Batch; start: number; generated: boolean }>();
    const close = (layer: MaterialKey): void => {
      const o = open.get(layer);
      if (o && o.batch.buffer.vertexCount > o.start) o.batch.ranges.push({ start: o.start, count: o.batch.buffer.vertexCount - o.start, tints: o.generated ? generatedTints : tints });
      open.delete(layer);
    };
    const into = (layer: MaterialKey, generated = false): GeometryBuffer => {
      const batch = at(layer, cx, cz);
      const o = open.get(layer);
      if (!o || o.generated !== generated) {
        close(layer);
        open.set(layer, { batch, start: batch.buffer.vertexCount, generated });
      }
      return batch.buffer;
    };
    const balconies = dressBuilding(into, building, wall, roof, look.wallRow);
    const details = addBuildingDetails(into, building, look);
    for (const layer of BUILDING_LAYERS) close(layer);
    add("generatedBalconies", balconies);
    add("generatedFacadeBands", details.bands);
    add("generatedRoofTanks", details.tanks);
    add("generatedStairHeads", details.stairHeads);
    if (look.genericReconstruction) add("genericReconstructions");
    provenance.buildings.set(building.id, buildingProvenance(building, look));
    for (const polygon of building.polygons) {
      for (const ring of [polygon.outer, ...polygon.holes]) {
        for (let i = 1; i < ring.length; i++) obstacles.add(ring[i - 1]![0], ring[i - 1]![1], ring[i]![0], ring[i]![1], 0);
      }
    }
    add("buildings");
    add(`buildings:${building.category}`);
    add(`height:${building.heightStatus}`);
    if (usableHeight(building.height) !== building.height) add("heightsUnusable");
  }

  // ---- mapped barriers: walls with an opening at each mapped gate and wherever a mapped road passes through
  const gates = district.barriers.points;
  for (const line of district.barriers.lines) {
    const kind = line.kind ?? "";
    const defaultHeight = A.barrierHeight[kind];
    if (defaultHeight === undefined) continue; // kerbs, bollard rows and the like are not drawn
    const tagged = parseFloat(line.tags.height ?? "");
    const height = Number.isFinite(tagged) && tagged > 0 ? tagged : defaultHeight;
    const color = kind === "hedge" ? srgb(70, 110, 60) : kind === "fence" ? srgb(120, 124, 128) : srgb(200, 196, 188);
    for (let i = 1; i < line.points.length; i++) {
      const p = line.points[i - 1]!, q = line.points[i]!;
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < 0.05) continue;
      const steps = Math.max(1, Math.ceil(len / 2));
      const nx = -(q[1] - p[1]) / len, nz = (q[0] - p[0]) / len;
      for (let s = 0; s < steps; s++) {
        const ax = p[0] + ((q[0] - p[0]) * s) / steps, az = p[1] + ((q[1] - p[1]) * s) / steps;
        const bx = p[0] + ((q[0] - p[0]) * (s + 1)) / steps, bz = p[1] + ((q[1] - p[1]) * (s + 1)) / steps;
        const mx = (ax + bx) / 2, mz = (az + bz) / 2;
        if (carriageways.near(mx, mz, 0.3) || gates.some((gate) => Math.hypot(gate.point[0] - mx, gate.point[1] - mz) < A.gateGap)) {
          add("barrierOpenings");
          continue;
        }
        draw(at("plaster", mx, mz), mapped(), (g) => {
          g.wall(ax, az, bx, bz, 0, height, nx, nz, color);
          g.wall(bx, bz, ax, az, 0, height, -nx, -nz, color);
        });
        obstacles.add(ax, az, bx, bz, 0.1);
        add("barrierSegments");
      }
    }
  }
  const inBounds = (x: number, z: number, m = 1): boolean => x > b.minX + m && x < b.maxX - m && z > b.minZ + m && z < b.maxZ - m;
  // Gates: the mapped point decides where; the model is generic and stands open, clear of the carriageway.
  const gatePlans = planGates(district, (x, z) => inBounds(x, z) && !roadSurfaces.near(x, z, 0.3) && buildingIndex.at(x, z) === null && !obstacles.near(x, z, 0.3));
  const gatePlanById = new Map(gatePlans.map((plan) => [plan.id, plan]));
  for (const gate of gates) {
    const plan = isGate(gate) ? gatePlanById.get(gate.id) : undefined;
    add("mappedGates");
    if (!plan || plan.pillars.length === 0) {
      if (carriageways.near(gate.point[0], gate.point[1], 0)) {
        // A post in the middle of a mapped road would stand in the traffic: the point is kept in the records and not drawn.
        add("barrierPointsOnRoadNotDrawn");
        provenance.features.push({ kind: "gate", source: gate.id, position: "source", form: "decorative", rule: `mapped ${gate.kind ?? "barrier"} point on a carriageway: recorded, not drawn`, x: gate.point[0], z: gate.point[1] });
        continue;
      }
      draw(at("metal", gate.point[0], gate.point[1]), mapped(), (g) => g.box(gate.point[0], 0, gate.point[1], 0.3, 1.6, 0.3, { color: srgb(90, 92, 96) }));
      provenance.features.push({ kind: "gate", source: gate.id, position: "source", form: "decorative", rule: "post at the mapped point (not on a mapped road)", x: gate.point[0], z: gate.point[1] });
      continue;
    }
    const G = GATE_RULES;
    const yaw = Math.atan2(plan.dx, plan.dz) - Math.PI / 2;
    const lift = plan.kind === "lift_gate";
    for (const pillar of plan.pillars) {
      draw(at("plaster", pillar.x, pillar.z), [DARK, DARK, GENERATED_MAGENTA], (g) => {
        if (lift) g.box(pillar.x, 0, pillar.z, 0.4, 1.1, 0.4, { yaw, color: srgb(214, 190, 60) });
        else {
          g.box(pillar.x, 0, pillar.z, G.pillarSize, G.pillarHeight, G.pillarSize, { yaw, color: srgb(206, 198, 184) });
          g.box(pillar.x, G.pillarHeight, pillar.z, G.pillarSize + 0.16, 0.14, G.pillarSize + 0.16, { yaw, color: srgb(150, 144, 134) });
        }
      });
      obstacles.add(pillar.x, pillar.z, pillar.x, pillar.z, G.pillarSize / 2);
      draw(at("metal", pillar.x, pillar.z), [DARK, DARK, GENERATED_MAGENTA], (g) => {
        if (lift) {
          // The boom stands raised beside its post: the road stays open.
          if (pillar.side === 1) g.box(pillar.x + plan.dx * 0.3, 1.0, pillar.z + plan.dz * 0.3, 0.1, Math.min(plan.half * 2, 4.5), 0.1, { yaw, color: srgb(230, 230, 226) });
          return;
        }
        // The leaf is swung back along the road, outside the carriageway edge.
        const leaf = Math.min(G.maxLeaf, Math.max(1, plan.half * 0.95));
        const along = pillar.side * (G.pillarSize / 2 + leaf / 2);
        const lx = pillar.x + plan.dx * along, lz = pillar.z + plan.dz * along;
        const ex = pillar.x + plan.dx * along * 2, ez = pillar.z + plan.dz * along * 2;
        if (roadSurfaces.near(ex, ez, 0.1) || buildingIndex.at(ex, ez) !== null) return;
        g.box(lx, 0.15, lz, leaf, G.leafHeight, 0.06, { yaw, color: srgb(52, 56, 62) });
      });
      add("generatedGatePillars");
    }
    add("gatesOnRoads");
    provenance.features.push({ kind: "gate", source: gate.id, position: "source", form: "decorative", rule: `generic open ${lift ? "lift gate" : "gate"} across mapped road ${plan.road}; ${plan.pillars.length} pillar(s) outside the carriageway`, x: plan.x, z: plan.z });
  }

  // ---- generated kerbed verges beside the through roads (streetDetail.ts)
  const verges = planVerges(district, (x, z, r) => inBounds(x, z, r + 0.5) && !roadSurfaces.near(x, z, r) && buildingIndex.at(x, z) === null && !obstacles.near(x, z, r));
  for (const run of verges) {
    const V = VERGE_RULES;
    const first = run.points[0]!;
    draw(at("concrete", first[0], first[1]), [DARK, DARK, GENERATED_MAGENTA], (g) => {
      if (run.side === 1) addStrip(g, run.points, run.inner + V.width, run.inner, V.height, [0.9, 0.89, 0.86]);
      else addStrip(g, run.points, -run.inner, -run.inner - V.width, V.height, [0.9, 0.89, 0.86]);
    });
    draw(at("concrete", first[0], first[1]), [DARK, DARK, GENERATED_MAGENTA], (g) => {
      for (const edge of [run.inner, run.inner + V.width]) {
        const line = offsetLine(run.points, edge * run.side);
        for (let i = 1; i < line.length; i++) {
          const p = line[i - 1]!, q = line[i]!;
          const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
          if (len < 0.01) continue;
          const nx = -(q[1] - p[1]) / len, nz = (q[0] - p[0]) / len;
          g.wall(p[0], p[1], q[0], q[1], 0, V.height, nx, nz, [0.8, 0.79, 0.76]);
          g.wall(q[0], q[1], p[0], p[1], 0, V.height, -nx, -nz, [0.8, 0.79, 0.76]);
        }
      }
    });
    add("generatedVerges");
    provenance.features.push({ kind: "verge", source: run.road, position: "decorative", form: "decorative", rule: `kerbed paved verge beside ${run.road}; no kerb or footpath is mapped`, x: first[0], z: first[1] });
  }

  // ---- rail: the line is mapped; the deck height is an estimate; side walls, rails, piers and pier heads are generated
  const W = A.viaduct;
  const sideWalls = (g: GeometryBuffer, points: ReadonlyArray<readonly [number, number]>, offset: number, y0: number, y1: number, color: Color): void => {
    const line = offsetLine(points, offset);
    for (let i = 1; i < line.length; i++) {
      const p = line[i - 1]!, q = line[i]!;
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < 0.01) continue;
      const nx = -(q[1] - p[1]) / len, nz = (q[0] - p[0]) / len;
      g.wall(p[0], p[1], q[0], q[1], y0, y1, nx, nz, color);
      g.wall(q[0], q[1], p[0], p[1], y0, y1, -nx, -nz, color);
    }
  };
  for (const line of district.rail.lines) {
    const y = line.elevated ? A.viaductHeight : 0.2;
    const first = line.points[0]!;
    if (!line.elevated) {
      draw(at("concrete", first[0], first[1]), mapped(), (g) => addStrip(g, line.points, A.railWidth / 2, -A.railWidth / 2, y, [0.8, 0.8, 0.8]));
      add("railLines");
      provenance.features.push({ kind: "rail-line", source: line.id, position: "source", form: "estimated", rule: `mapped line at ground level; bed width ${A.railWidth} m assumed`, x: first[0], z: first[1] });
      continue;
    }
    const hw = W.deckWidth / 2;
    draw(at("concrete", first[0], first[1]), mapped(), (g) => {
      addStrip(g, line.points, hw, -hw, y, [0.8, 0.8, 0.8]);
      addStrip(g, line.points, -hw, hw, y - W.deckDepth, [0.6, 0.6, 0.6]);
    });
    draw(at("concrete", first[0], first[1]), [DARK, DARK, GENERATED_MAGENTA], (g) => {
      for (const side of [1, -1]) {
        sideWalls(g, line.points, side * hw, y - W.deckDepth, y + W.wallHeight, [0.74, 0.74, 0.73]);
        sideWalls(g, line.points, side * (hw - 0.2), y, y + W.wallHeight, [0.7, 0.7, 0.69]);
      }
      addStrip(g, line.points, hw, hw - 0.2, y + W.wallHeight, [0.78, 0.78, 0.77]);
      addStrip(g, line.points, -hw + 0.2, -hw, y + W.wallHeight, [0.78, 0.78, 0.77]);
    });
    draw(at("metal", first[0], first[1]), [DARK, DARK, GENERATED_MAGENTA], (g) => {
      for (const side of [1, -1]) addStrip(g, line.points, side * (W.gauge / 2) + 0.05, side * (W.gauge / 2) - 0.05, y + 0.1, [0.32, 0.3, 0.29]);
    });
    add("railLines");
    provenance.features.push({ kind: "viaduct", source: line.id, position: "source", form: "estimated", rule: `mapped elevated line; deck height ${A.viaductHeight} m is an estimate (the map gives none); deck width, side walls and rails are generated`, x: first[0], z: first[1] });
    let next = A.pierSpacing / 2, travelled = 0;
    for (let i = 1; i < line.points.length; i++) {
      const p = line.points[i - 1]!, q = line.points[i]!;
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      for (; next <= travelled + len; next += A.pierSpacing) {
        const t = (next - travelled) / len;
        const x = p[0] + (q[0] - p[0]) * t, z = p[1] + (q[1] - p[1]) * t;
        if (carriageways.near(x, z, 1)) continue;
        const yaw = Math.atan2(q[0] - p[0], q[1] - p[1]);
        draw(at("concrete", x, z), [DARK, DARK, GENERATED_MAGENTA], (g) => {
          g.cylinder(x, 0, z, y - W.deckDepth - 0.8, 0.8, 0.8, 8, [0.75, 0.75, 0.75], { cap: false });
          g.box(x, y - W.deckDepth - 0.8, z, W.pierHead, 0.8, 1.5, { yaw, color: [0.72, 0.72, 0.71], bottom: true });
        });
        obstacles.add(x, z, x, z, 0.8);
        add("generatedRailPiers");
        provenance.features.push({ kind: "viaduct-pier", source: line.id, position: "decorative", form: "decorative", rule: `pier every ${A.pierSpacing} m under the mapped line, left out over carriageways; real pier positions are not mapped`, x, z });
      }
      travelled += len;
    }
  }

  // ---- stations: a generic canopy over the mapped line at each mapped station point
  const S = A.station;
  const stationPoints = district.rail.points.filter((p) => p.kind === "station" || p.tags?.railway === "station" || p.tags?.public_transport === "station");
  const stops = stationPoints.length ? stationPoints : district.rail.points.filter((p) => p.name ?? p.tags?.name);
  const builtStations: Array<[number, number]> = [];
  for (const stop of stops) {
    const [sx, sz] = stop.point;
    if (builtStations.some(([x, z]) => Math.hypot(x - sx, z - sz) < 150)) continue;
    let best: number = S.within, hit: { line: (typeof district.rail.lines)[number]; i: number; t: number } | null = null;
    for (const line of district.rail.lines) {
      if (!line.elevated) continue;
      for (let i = 1; i < line.points.length; i++) {
        const p = line.points[i - 1]!, q = line.points[i]!;
        const ex = q[0] - p[0], ez = q[1] - p[1];
        const len2 = ex * ex + ez * ez;
        if (len2 < 1e-6) continue;
        const t = Math.max(0, Math.min(1, ((sx - p[0]) * ex + (sz - p[1]) * ez) / len2));
        const d = Math.hypot(sx - p[0] - t * ex, sz - p[1] - t * ez);
        if (d < best) [best, hit] = [d, { line, i, t }];
      }
    }
    if (!hit) continue;
    // The stretch of the mapped line within half the canopy length of the station point.
    const pts = hit.line.points;
    const at0: [number, number] = [pts[hit.i - 1]![0] + (pts[hit.i]![0] - pts[hit.i - 1]![0]) * hit.t, pts[hit.i - 1]![1] + (pts[hit.i]![1] - pts[hit.i - 1]![1]) * hit.t];
    const walk = (from: number, step: 1 | -1): Array<[number, number]> => {
      const out: Array<[number, number]> = [];
      let left = S.length / 2, prev = at0;
      for (let k = from; k >= 0 && k < pts.length && left > 0; k += step) {
        const q = pts[k]!;
        const d = Math.hypot(q[0] - prev[0], q[1] - prev[1]);
        if (d < 1e-6) continue;
        const f = Math.min(1, left / d);
        const pt: [number, number] = [prev[0] + (q[0] - prev[0]) * f, prev[1] + (q[1] - prev[1]) * f];
        out.push(pt);
        left -= d * f;
        prev = pt;
      }
      return out;
    };
    const run = [...walk(hit.i - 1, -1).reverse(), at0, ...walk(hit.i, 1)].filter((p) => inBounds(p[0], p[1], 0));
    if (run.length < 2) continue;
    const y = A.viaductHeight, hw = W.deckWidth / 2, half = S.width / 2;
    draw(at("concrete", at0[0], at0[1]), [DARK, DARK, GENERATED_MAGENTA], (g) => {
      for (const side of [1, -1]) {
        // Platform beside the deck, and its outer wall up to the roof.
        if (side === 1) {
          addStrip(g, run, half, hw, y + 0.9, [0.82, 0.81, 0.78]);
          addStrip(g, run, hw, half, y - W.deckDepth, [0.6, 0.6, 0.6]);
        } else {
          addStrip(g, run, -hw, -half, y + 0.9, [0.82, 0.81, 0.78]);
          addStrip(g, run, -half, -hw, y - W.deckDepth, [0.6, 0.6, 0.6]);
        }
        sideWalls(g, run, side * half, y - W.deckDepth, y + 2, [0.76, 0.77, 0.79]);
      }
      addStrip(g, run, half + 0.6, -half - 0.6, y + S.roofAbove, [0.6, 0.63, 0.67]);
      addStrip(g, run, -half - 0.6, half + 0.6, y + S.roofAbove - 0.25, [0.5, 0.52, 0.55]);
    });
    draw(at("metal", at0[0], at0[1]), [DARK, DARK, GENERATED_MAGENTA], (g) => {
      const edges = [offsetLine(run, half - 0.3), offsetLine(run, -half + 0.3)];
      for (const edge of edges) for (const p of edge) g.box(p[0], y + 0.9, p[1], 0.3, S.roofAbove - 1.15, 0.3, { color: [0.55, 0.57, 0.6], top: false });
    });
    builtStations.push([sx, sz]);
    add("generatedStationCanopies");
    provenance.features.push({ kind: "station", source: stop.id, position: "source", form: "decorative", rule: `generic ${S.length} m canopy on the mapped line nearest the mapped station point; no station outline is mapped, so its size and form are not real`, x: sx, z: sz });
  }

  // ---- mapped point objects with a generic model: the position is mapped, the look is not
  const flat = new PBRMaterial("debugFlat", scene);
  flat.metallic = 0;
  flat.roughness = 1;
  flat.unlit = true; // pure key colours: lighting and sky reflection would wash them out
  const glow = (name: string, c: Color): PBRMaterial => {
    const m = new PBRMaterial(name, scene);
    m.albedoColor = Color3.Black();
    m.emissiveColor = new Color3(c[0], c[1], c[2]);
    m.metallic = 0;
    m.roughness = 1;
    m.backFaceCulling = false;
    return m;
  };
  const debugMapped = glow("debugMapped", MAPPED_CYAN);
  const debugGenerated = glow("debugGenerated", GENERATED_MAGENTA);
  const debug = new DebugViews(flat);
  const casters: AbstractMesh[] = [];

  const template = (name: string, near: GeometryBuffer, far: GeometryBuffer | null, material: PBRMaterial, debugMaterial: PBRMaterial, hideAt: number): Mesh => {
    const mesh = near.toMesh(name, scene);
    mesh.material = material;
    mesh.isVisible = false; // template only; its instances are drawn
    mesh.receiveShadows = false;
    debug.addSwapped(mesh, debugMaterial);
    if (far) {
      const low = far.toMesh(`${name}_far`, scene);
      low.material = material;
      low.isVisible = false;
      mesh.addLODLevel(150, low);
      debug.addSwapped(low, debugMaterial);
    }
    mesh.addLODLevel(hideAt, null);
    return mesh;
  };
  const instance = (mesh: Mesh, name: string, x: number, z: number, yaw: number, scale: number, castsShadow: boolean): void => {
    const inst = mesh.createInstance(name);
    inst.position.set(x, 0, z);
    inst.rotation.y = yaw;
    // Trees: narrower or wider and shorter or taller by a hash of the name, so no two look alike.
    const vary = mesh.material === materials.foliage ? 0.86 + idNoise(name) * 0.28 : 1;
    inst.scaling.set(scale * vary, scale * (2 - vary) * (mesh.material === materials.foliage ? 0.92 : 1), scale * vary);
    inst.isPickable = false;
    inst.freezeWorldMatrix();
    if (castsShadow) casters.push(inst);
  };
  // Five shade trees and one columnar tree; instances are scaled unevenly so repeats are hard to spot.
  const treeSeeds = [101, 102, 103, 104, 105];
  const trees = (prefix: string, debugMaterial: PBRMaterial): Mesh[] => [
    ...treeSeeds.map((s) => template(`${prefix}Tree${s}`, broadTree(s, 1), broadTree(s, 0.5), materials.foliage, debugMaterial, 620)),
    template(`${prefix}Tree201`, columnarTree(201, 1), columnarTree(201, 0.5), materials.foliage, debugMaterial, 620),
  ];
  const mappedTrees = trees("mapped", debugMapped);
  const generatedTrees = trees("generated", debugGenerated);
  const mappedLamp = template("mappedLamp", streetLight(), null, materials.metal, debugMapped, 400);
  const generatedLamp = template("generatedLamp", streetLight(), null, materials.metal, debugGenerated, 400);

  district.furniture.forEach((item, i) => {
    const [x, z] = item.point;
    if (item.kind === "tree") {
      instance(mappedTrees[i % mappedTrees.length]!, `mappedTree_${i}`, x, z, idNoise(item.id) * 6.28, 0.85 + idNoise(item.id) * 0.3, true);
      add("mappedTrees");
    } else if (item.kind === "street_lamp") {
      instance(mappedLamp, `mappedLamp_${i}`, x, z, 0, 1, false);
      add("mappedLamps");
    } else if (item.kind === "traffic_signals") {
      draw(at("metal", x, z), mapped(), (g) => {
        g.cylinder(x, 0, z, 3.2, 0.08, 0.07, 6, srgb(60, 62, 66));
        g.box(x, 3.2, z, 0.34, 0.9, 0.3, { color: srgb(30, 30, 32) });
      });
      add("mappedSignals");
    } else add("mappedFurnitureNotDrawn");
  });

  // ---- generated decoration (see decorations.ts)
  const decorations = placeDecorations(district, obstacles, roadSurfaces, buildingIndex);
  const cars = new CarFactory(scene);
  const parkedCars: CarVisual[] = [];
  decorations.forEach((d, i) => {
    if (d.kind === "tree") {
      // Street trees are kept modest: about 6 to 9 m, the size of a maturing neem.
      instance(generatedTrees[i % generatedTrees.length]!, `generatedTree_${i}`, d.x, d.z, d.yaw, d.scale * 0.82, true);
      add("generatedTrees");
    } else if (d.kind === "streetLight") {
      instance(generatedLamp, `generatedLamp_${i}`, d.x, d.z, d.yaw, d.scale, false);
      add("generatedLights");
    } else if (d.kind === "grate") {
      draw(at("grate", d.x, d.z), [DARK, DARK, GENERATED_MAGENTA], (g) => {
        const s = Math.sin(d.yaw) * 0.3, c = Math.cos(d.yaw) * 0.3;
        g.quad([[d.x - s - c, Y.paint, d.z - c + s], [d.x + s - c, Y.paint, d.z + c + s], [d.x + s + c, Y.paint, d.z + c - s], [d.x - s + c, Y.paint, d.z - c - s]], [0, 1, 0], [0, 0, 0.6, 0, 0.6, 0.6, 0, 0.6]);
      });
      add("generatedGrates");
    } else {
      const v = d.variant ?? 0;
      const car = cars.create(TRAFFIC_CARS[v % TRAFFIC_CARS.length]!, `parkedCar_${i}`, TRAFFIC_PAINTS[(v >> 2) % TRAFFIC_PAINTS.length]!);
      car.place(d.x, 0.02, d.z, d.yaw);
      for (const mesh of car.root.getChildMeshes()) {
        mesh.computeWorldMatrix(true);
        mesh.freezeWorldMatrix();
      }
      parkedCars.push(car);
      add("generatedParkedCars");
    }
  });

  // Mapped traffic calming: a painted hump across the nearest road. None are invented.
  for (const item of district.furniture) {
    if (!item.tags.traffic_calming) continue;
    draw(at("roadPaint", item.point[0], item.point[1]), mapped(), (g) => {
      if (addSpeedBreaker(g, item.point[0], item.point[1], district.roads, Y.paint + 0.004)) add("mappedSpeedBreakers");
    });
  }

  // ---- meshes
  const castsShadow = new Set<MaterialKey>(["plaster", "residential", "generic", "ribbon", "shopfront"]);
  for (const [key, batch] of batches) {
    if (batch.buffer.isEmpty) continue;
    const mesh = batch.buffer.toMesh(key, scene);
    mesh.material = materials[batch.layer];
    mesh.receiveShadows = true;
    mesh.freezeWorldMatrix();
    mesh.doNotSyncBoundingInfo = true;
    debug.addBatched(mesh, batch.ranges);
    if (castsShadow.has(batch.layer)) casters.push(mesh);
    add("staticMeshes");
  }

  const ground = groundBuffer.toMesh("ground", scene);
  ground.material = groundMaterial;
  ground.receiveShadows = true;
  ground.freezeWorldMatrix();
  debug.addBatched(ground, []);
  counts.parkedCars = parkedCars.length;

  // The sector outline, shown only in the "Data source" view.
  const outline = new GeometryBuffer();
  for (const polygon of district.sector.polygons) addStrip(outline, polygon.outer, 1, -1, 0.4, [1, 1, 1]);
  if (!outline.isEmpty) {
    const mesh = outline.toMesh("sectorOutline", scene);
    mesh.material = glow("debugSector", [0.95, 0.85, 0.1]);
    debug.addDebugOnly(mesh);
  }

  // ---- provenance of the remaining rendered features
  for (const area of district.areas) if (area.kind === "green" || area.kind === "water") provenance.features.push({ kind: `area:${area.kind}`, source: area.id, position: "source", form: "source", rule: "mapped outline, drawn flat" });
  district.furniture.forEach((item) => provenance.features.push({ kind: `mapped:${item.kind ?? "object"}`, source: item.id, position: "source", form: "decorative", rule: "mapped point; generic model", x: item.point[0], z: item.point[1] }));
  for (const d of decorations) provenance.features.push({ kind: `decoration:${d.kind}`, source: null, position: "decorative", form: "decorative", rule: d.rule, x: d.x, z: d.z });
  const labels = collectLabels(district, A.viaductHeight);
  for (const label of labels) provenance.features.push({ kind: `label:${label.kind}`, source: label.source, position: "source", form: "source", rule: "name and position as mapped", x: label.x, z: label.z });
  add("nameLabels", labels.length);

  return { materials, cars, shadowCasters: casters, counts, obstacles, roadSurfaces, buildingIndex, decorations, debug, provenance, labels, gates: gatePlans, verges };
}
