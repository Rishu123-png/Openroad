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
import { broadTree } from "../world/vegetation";
import { BuildingIndex } from "./BuildingIndex";
import { extrudeFootprint } from "./buildingGeometry";
import { DebugViews, type DebugTints, type TintRange } from "./DebugViews";
import { placeDecorations, type Decoration } from "./decorations";
import { addDisc, addStrip } from "./roadGeometry";
import { SegmentGrid } from "./SegmentGrid";
import type { BuildingCategory, DistrictData, HeightStatus, WidthStatus } from "./types";

/** Side of the square tiles that static geometry is merged into, in metres. */
const TILE = 250;

/** Heights of flat surfaces above the ground, in metres. Materials also carry a depth offset, so these can stay small. */
const Y = { green: 0.01, path: 0.02, road: 0.03, sidewalk: 0.15 } as const;

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
  /** Deck height of rail tagged as a bridge. OSM gives no height. */
  viaductHeight: 9,
  railWidth: 3.2,
  /** Spacing of the generated piers under elevated rail. */
  pierSpacing: 30,
} as const;

/** Muted wall colours by category. They tell categories apart; they are not the colours of the real buildings. */
const WALL: Record<BuildingCategory, Color> = {
  house: srgb(226, 216, 196),
  apartments: srgb(214, 206, 198),
  commercial: srgb(196, 204, 212),
  institutional: srgb(222, 202, 176),
  industrial: srgb(184, 188, 192),
  healthcare: srgb(232, 232, 228),
  other: srgb(196, 190, 180),
  unclassified: srgb(208, 204, 196),
};

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

export interface DistrictWorld {
  materials: MaterialLibrary;
  shadowCasters: AbstractMesh[];
  /** Named counts for tests and the overlay. `generated*` entries are decoration, not map data. */
  counts: Record<string, number>;
  /** Building walls and mapped barriers, for collision. */
  obstacles: SegmentGrid;
  /** Carriageways and paths, for "is the vehicle on a mapped road". */
  roadSurfaces: SegmentGrid;
  buildingIndex: BuildingIndex;
  decorations: Decoration[];
  debug: DebugViews;
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
  const obstacles = new SegmentGrid(32, 4);
  const roadSurfaces = new SegmentGrid(32, 4);
  const carriageways = new SegmentGrid(32, 4);
  const buildingIndex = new BuildingIndex(district.buildings);

  // ---- ground: unmapped land is one plain surface, extended past the edge so the horizon is not a cliff
  draw(at("concrete", b.minX, b.minZ), null, (g) => g.rectY(b.minX - 600, b.minZ - 600, b.maxX + 600, b.maxZ + 600, 0, { color: srgb(196, 184, 160) }));

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
    const shade = road.class === "service" ? 1.12 : 1;
    draw(at("asphalt", first[0], first[1]), [DARK, DARK, DEBUG_WIDTH[road.widthStatus]], (g) => addStrip(g, road.points, half, -half, Y.road, [shade, shade, shade]));
    add("roads");
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

  // ---- buildings: one extrusion per mapped footprint
  for (const building of district.buildings) {
    const base = WALL[building.category];
    const k = 0.94 + idNoise(building.id) * 0.1; // slight variation so neighbours differ
    const wall: Color = [base[0] * k, base[1] * k, base[2] * k];
    const roof: Color = [wall[0] * 0.62, wall[1] * 0.62, wall[2] * 0.62];
    draw(at("plaster", building.centre[0], building.centre[1]), [DEBUG_CATEGORY[building.category], DEBUG_HEIGHT[building.heightStatus], OSM_BLUE], (g) =>
      extrudeFootprint(g, building.polygons, 0, building.height, wall, roof),
    );
    for (const polygon of building.polygons) {
      for (const ring of [polygon.outer, ...polygon.holes]) {
        for (let i = 1; i < ring.length; i++) obstacles.add(ring[i - 1]![0], ring[i - 1]![1], ring[i]![0], ring[i]![1], 0);
      }
    }
    add("buildings");
    add(`buildings:${building.category}`);
    add(`height:${building.heightStatus}`);
  }

  // ---- mapped barriers: walls with an opening at each mapped gate and wherever a mapped road passes through
  const gates = district.barriers.points;
  const A = DISTRICT_ASSUMPTIONS;
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
  for (const gate of gates) {
    draw(at("metal", gate.point[0], gate.point[1]), mapped(), (g) => g.box(gate.point[0], 0, gate.point[1], 0.3, 1.6, 0.3, { color: srgb(90, 92, 96) }));
    add("mappedGates");
  }

  // ---- rail: the mapped line; deck height and piers of elevated sections are assumptions
  for (const line of district.rail.lines) {
    const y = line.elevated ? A.viaductHeight : 0.2;
    const first = line.points[0]!;
    draw(at("concrete", first[0], first[1]), mapped(), (g) => {
      addStrip(g, line.points, A.railWidth / 2, -A.railWidth / 2, y, [0.8, 0.8, 0.8]);
      if (line.elevated) addStrip(g, line.points, -A.railWidth / 2, A.railWidth / 2, y - 0.9, [0.6, 0.6, 0.6]);
    });
    add("railLines");
    if (!line.elevated) continue;
    let next = A.pierSpacing / 2, travelled = 0;
    for (let i = 1; i < line.points.length; i++) {
      const p = line.points[i - 1]!, q = line.points[i]!;
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      for (; next <= travelled + len; next += A.pierSpacing) {
        const t = (next - travelled) / len;
        const x = p[0] + (q[0] - p[0]) * t, z = p[1] + (q[1] - p[1]) * t;
        if (carriageways.near(x, z, 1)) continue;
        draw(at("concrete", x, z), [DARK, DARK, GENERATED_MAGENTA], (g) => g.cylinder(x, 0, z, y - 0.9, 0.8, 0.8, 8, [0.75, 0.75, 0.75], { cap: false }));
        obstacles.add(x, z, x, z, 0.8);
        add("generatedRailPiers");
      }
      travelled += len;
    }
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
    inst.scaling.setAll(scale);
    inst.isPickable = false;
    inst.freezeWorldMatrix();
    if (castsShadow) casters.push(inst);
  };
  const treeSeeds = [101, 102, 103];
  const trees = (prefix: string, debugMaterial: PBRMaterial): Mesh[] => treeSeeds.map((s) => template(`${prefix}Tree${s}`, broadTree(s, 1), broadTree(s, 0.5), materials.foliage, debugMaterial, 620));
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
  decorations.forEach((d, i) => {
    if (d.kind === "tree") {
      instance(generatedTrees[i % generatedTrees.length]!, `generatedTree_${i}`, d.x, d.z, d.yaw, d.scale, true);
      add("generatedTrees");
    } else {
      instance(generatedLamp, `generatedLamp_${i}`, d.x, d.z, d.yaw, d.scale, false);
      add("generatedLights");
    }
  });

  // ---- meshes
  const castsShadow = new Set<MaterialKey>(["plaster"]);
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

  // The sector outline, shown only in the "Data source" view.
  const outline = new GeometryBuffer();
  for (const polygon of district.sector.polygons) addStrip(outline, polygon.outer, 1, -1, 0.4, [1, 1, 1]);
  if (!outline.isEmpty) {
    const mesh = outline.toMesh("sectorOutline", scene);
    mesh.material = glow("debugSector", [0.95, 0.85, 0.1]);
    debug.addDebugOnly(mesh);
  }

  return { materials, shadowCasters: casters, counts, obstacles, roadSurfaces, buildingIndex, decorations, debug };
}
