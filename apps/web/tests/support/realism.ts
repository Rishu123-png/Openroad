import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { GATE_RULES } from "../../src/game/district/gates";
import { summariseProvenance, roadKey, widthClass, heightClass } from "../../src/game/district/provenance";
import { SegmentGrid } from "../../src/game/district/SegmentGrid";
import { pointInPolygons } from "../../src/game/district/spawn";
import type { DistrictData } from "../../src/game/district/types";
import type { DistrictGame } from "../../src/game/engine/DistrictGame";

const BUILDING_PREFIXES = ["plaster@", "residential@", "generic@", "ribbon@", "shopfront@", "concrete@"];
const ROAD_PREFIXES = ["asphalt@", "pavers@", "roadPaint@", "grate@"];

/**
 * Checks a built district against its own file: everything mapped is there
 * once and unchanged, and nothing added stands on a road or claims to be
 * mapped. Every expectation is derived from the file given, so the same
 * checks run on a synthetic district and on the real one.
 *
 * @returns problems (empty when all hold) and report lines of measured values
 */
export function realismCheck(game: DistrictGame, district: DistrictData, buildMs: number): { problems: string[]; report: string[] } {
  const problems: string[] = [];
  const { provenance, counts, gates, verges, labels, decorations } = game.world;
  const fail = (text: string): void => void (problems.length < 60 && problems.push(text));

  // ---- buildings: one record and one roof per footprint, courtyards open
  if (provenance.buildings.size !== district.buildings.length) fail(`${provenance.buildings.size} building records for ${district.buildings.length} footprints`);
  if (counts.buildings !== district.buildings.length) fail(`${counts.buildings} buildings built for ${district.buildings.length} footprints`);
  for (const b of district.buildings) {
    const p = provenance.buildings.get(b.id);
    if (!p) {
      fail(`no provenance record for ${b.id}`);
      continue;
    }
    if (p.footprint.class !== "source") fail(`${b.id}: footprint not recorded as source`);
    if (p.height.value !== b.height || p.height.class !== heightClass(b.heightStatus)) fail(`${b.id}: height provenance does not match the file`);
    if (p.genericReconstruction !== (b.category === "unclassified")) fail(`${b.id}: generic-reconstruction flag wrong for category ${b.category}`);
    if (p.category.value !== b.category || p.category.rule !== b.categoryRule) fail(`${b.id}: category record does not match the file`);
    if (p.footprint.courtyards !== b.polygons.reduce((n, q) => n + q.holes.length, 0)) fail(`${b.id}: courtyard count differs`);
  }
  const heights = new Set(district.buildings.map((b) => b.height));
  let roof = 0;
  for (const mesh of game.scene.meshes) {
    if (!mesh.name.startsWith("concrete@")) continue;
    const p = mesh.getVerticesData(VertexBuffer.PositionKind)!, n = mesh.getVerticesData(VertexBuffer.NormalKind)!, idx = mesh.getIndices()!;
    for (let i = 0; i < idx.length; i += 3) {
      const [u, v, w] = [idx[i]!, idx[i + 1]!, idx[i + 2]!];
      if (n[u * 3 + 1]! < 0.99 || !heights.has(p[u * 3 + 1]!)) continue;
      const cx = (p[u * 3]! + p[v * 3]! + p[w * 3]!) / 3, cz = (p[u * 3 + 2]! + p[v * 3 + 2]! + p[w * 3 + 2]!) / 3;
      if (game.world.buildingIndex.at(cx, cz) === null) continue; // viaduct and station decks at the same height
      roof += Math.abs((p[v * 3]! - p[u * 3]!) * (p[w * 3 + 2]! - p[u * 3 + 2]!) - (p[w * 3]! - p[u * 3]!) * (p[v * 3 + 2]! - p[u * 3 + 2]!)) / 2;
    }
  }
  const footprintArea = district.buildings.reduce((s, b) => s + b.area, 0);
  // Overlapping mapped footprints can double-count a few triangles either way; a duplicated or missing building would be far outside this.
  if (Math.abs(roof - footprintArea) > Math.max(5, footprintArea * 0.01)) fail(`roof area ${roof.toFixed(1)} m2 differs from footprint area ${footprintArea.toFixed(1)} m2`);
  let courtyards = 0;
  for (const b of district.buildings) for (const poly of b.polygons) for (const hole of poly.holes) {
    courtyards++;
    const x = hole.slice(0, -1).reduce((s, q) => s + q[0], 0) / (hole.length - 1), z = hole.slice(0, -1).reduce((s, q) => s + q[1], 0) / (hole.length - 1);
    if (pointInPolygons(x, z, [{ outer: hole, holes: [] }]) && pointInPolygons(x, z, b.polygons)) fail(`${b.id}: courtyard is filled at ${x.toFixed(1)},${z.toFixed(1)}`);
  }

  // ---- roads: provenance equals the file; access untouched
  const carriage = new SegmentGrid(32, 4);
  for (const r of district.roads) if (r.kind === "road") for (let i = 1; i < r.points.length; i++) carriage.add(r.points[i - 1]![0], r.points[i - 1]![1], r.points[i]![0], r.points[i]![1], r.width / 2);
  if (provenance.roads.size !== new Set(district.roads.map(roadKey)).size) fail(`${provenance.roads.size} road records for ${district.roads.length} road pieces`);
  for (const r of district.roads) {
    const p = provenance.roads.get(roadKey(r));
    if (!p) {
      fail(`no provenance record for road ${roadKey(r)}`);
      continue;
    }
    if (p.width.class !== widthClass(r.widthStatus) || p.width.value !== r.width) fail(`${r.id}: width provenance does not match the file`);
    if ((p.access?.value ?? null) !== (r.tags?.access ?? null)) fail(`${r.id}: access ${p.access?.value} differs from the mapped ${r.tags?.access}`);
    if ((p.surface.class === "source") !== Boolean(r.tags?.surface)) fail(`${r.id}: surface provenance wrong`);
    if (p.markings.pieces > 0 && (r.class === "residential" || r.class === "service" || r.class === "living_street")) fail(`${r.id}: paint on a ${r.class} road`);
  }

  // ---- gates: exactly the mapped ones, where mapped, off the carriageway
  const mappedGates = district.barriers.points.filter((p) => GATE_RULES.kinds.includes(p.kind ?? p.tags?.barrier ?? ""));
  if (gates.length !== mappedGates.length) fail(`${gates.length} gates for ${mappedGates.length} mapped gate points`);
  gates.forEach((g, i) => {
    const m = mappedGates[i];
    if (!m || m.id !== g.id || m.point[0] !== g.x || m.point[1] !== g.z) fail(`gate ${g.id} is not at its mapped point`);
    if ((g.name ?? null) !== (m?.tags?.name ?? null)) fail(`gate ${g.id}: name "${g.name}" is not the mapped name`);
    for (const p of g.pillars) if (carriage.near(p.x, p.z, 0.2)) fail(`gate ${g.id}: pillar on a carriageway at ${p.x.toFixed(1)},${p.z.toFixed(1)}`);
  });
  if (district.barriers.lines.length === 0 && (counts.barrierSegments ?? 0) !== 0) fail(`${counts.barrierSegments} wall segments drawn although no barrier line is mapped`);

  // ---- nothing added stands on a carriageway
  for (const run of verges) for (const p of run.points) {
    const i = Math.max(1, run.points.indexOf(p));
    const a = run.points[i - 1]!, b = run.points[i]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const off = (run.inner + 0.75) * run.side;
    if (carriage.near(p[0] - ((b[1] - a[1]) / len) * off, p[1] + ((b[0] - a[0]) / len) * off, 0.5)) fail(`verge beside ${run.road} on a carriageway near ${p[0].toFixed(1)},${p[1].toFixed(1)}`);
  }
  for (const f of provenance.features) if (f.kind === "viaduct-pier" && carriage.near(f.x!, f.z!, 0.5)) fail(`viaduct pier on a carriageway at ${f.x},${f.z}`);
  for (const d of decorations) if (d.kind !== "grate" && carriage.near(d.x, d.z, 0)) fail(`${d.kind} on a carriageway at ${d.x.toFixed(1)},${d.z.toFixed(1)}`);
  for (const d of decorations) if (d.kind !== "grate" && game.world.buildingIndex.at(d.x, d.z) !== null) fail(`${d.kind} inside a building at ${d.x.toFixed(1)},${d.z.toFixed(1)}`);

  // ---- names: each label is a mapped name at a mapped feature
  const names = new Map<string, string>();
  for (const f of [...district.pois, ...district.rail.points, ...district.barriers.points, ...district.buildings, ...district.areas]) if (f.tags?.name) names.set(f.id, f.tags.name);
  for (const p of [...district.pois, ...district.rail.points]) if (p.name && !names.has(p.id)) names.set(p.id, p.name);
  for (const l of labels) if (names.get(l.source)?.trim() !== l.text) fail(`label "${l.text}" is not the mapped name of ${l.source}`);

  // ---- measured values
  const s = summariseProvenance(provenance);
  const meshes = game.scene.meshes;
  const count = (prefixes: string[]): number => meshes.filter((m) => prefixes.some((p) => m.name.startsWith(p))).length;
  let vertices = 0, triangles = 0;
  for (const m of meshes) {
    if ((m as { isAnInstance?: boolean }).isAnInstance) continue;
    vertices += m.getTotalVertices();
    triangles += m.getTotalIndices() / 3;
  }
  const report = [
    `   buildings   ${s.buildings.total} footprints from source; category ${JSON.stringify(s.buildings.category)}; generic reconstructions ${s.buildings.genericReconstructions}; height ${JSON.stringify(s.buildings.height)}; named ${s.buildings.named}; courtyards ${courtyards}`,
    `   roads       ${s.roads.total} pieces; width ${JSON.stringify(s.roads.width)}; surface ${JSON.stringify(s.roads.surface)}; access ${JSON.stringify(s.roads.access)}; one-way ${s.roads.oneway}; with generated paint ${s.roads.withMarkings}`,
    `   gates       ${gates.length} mapped gate points: ${gates.filter((g) => g.pillars.length > 0).length} drawn across a mapped road, ${gates.filter((g) => g.road === null).length} not on a road; named ${JSON.stringify(gates.filter((g) => g.name).map((g) => g.name))}; wall segments ${counts.barrierSegments ?? 0}`,
    `   labels      ${labels.length}: ${JSON.stringify(labels.map((l) => `${l.text} [${l.kind}]`))}`,
    `   features    by form ${JSON.stringify(s.featuresByForm)}; ${JSON.stringify(s.features)}`,
    `   generated   ${JSON.stringify(Object.fromEntries(Object.entries(counts).filter(([k]) => k.startsWith("generated"))))}`,
    `   measured    world built in ${buildMs.toFixed(0)} ms (headless, no GPU upload); meshes: ${count(BUILDING_PREFIXES)} building-layer, ${count(ROAD_PREFIXES)} road-layer, ${meshes.length} total (${meshes.filter((m) => (m as { isAnInstance?: boolean }).isAnInstance).length} instances); materials ${game.scene.materials.length}; textures ${game.scene.textures.length}; ${(vertices / 1000).toFixed(0)}k vertices, ${(triangles / 1000).toFixed(0)}k triangles in unique geometry`,
  ];
  return { problems, report };
}
