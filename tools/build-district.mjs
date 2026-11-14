#!/usr/bin/env node
/**
 * Cuts one playable district out of the region layers and writes the file the
 * game loads.
 *
 *   node tools/build-layers.mjs
 *   node tools/build-district.mjs                 Alpha 1 -> apps/web/public/regions/greater-noida/alpha-1.json
 *   node tools/build-district.mjs --buffer 200    metres of surroundings kept around the sector
 *
 * The sector outline is found in the data by name. If it cannot be found the
 * script stops and says why; it never falls back to another area.
 *
 * Data © OpenStreetMap contributors, ODbL 1.0. The output is a derivative
 * database and stays under ODbL.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { clipLine, clipPolygon, inside, pointInRing, ringArea } from "./geo/clip.mjs";
import { buildingHeight, CATEGORIES, classifyBuilding, ESTIMATED_HEIGHTS } from "./district/classify.mjs";

export const SECTORS = { "alpha-1": { label: "Alpha 1", pattern: /^alpha[\s-]*(1|i)$/i } };
const NAME_KEYS = ["name", "name:en", "alt_name", "official_name", "short_name"];
const GREEN = { leisure: new Set(["park", "garden", "pitch", "playground", "golf_course", "nature_reserve", "recreation_ground"]), landuse: new Set(["grass", "forest", "meadow", "village_green", "recreation_ground", "orchard", "greenfield", "farmland", "allotments"]), natural: new Set(["wood", "scrub", "grassland", "heath"]) };
const r2 = (v) => Math.round(v * 100) / 100;
const centreOf = (pts) => { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const [x, z] of pts) { a = Math.min(a, x); c = Math.max(c, x); b = Math.min(b, z); d = Math.max(d, z); } return [r2((a + c) / 2), r2((b + d) / 2)]; };
const lengthOf = (p) => { let d = 0; for (let i = 1; i < p.length; i++) d += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); return d; };
const distToSegment = ([px, pz], [ax, az], [bx, bz]) => { const dx = bx - ax, dz = bz - az; const t = dx || dz ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz))) : 0; return Math.hypot(px - ax - t * dx, pz - az - t * dz); };
const inPolygons = (p, polygons) => polygons.some((poly) => pointInRing(p, poly.outer) && !poly.holes.some((h) => pointInRing(p, h)));

export class DistrictError extends Error {}

/** Finds the sector outline by name. Throws DistrictError with the exact limitation otherwise. */
export function findSector(areas, sector) {
  const named = areas.filter((a) => a.geometry?.polygons && NAME_KEYS.some((k) => sector.pattern.test(a.tags[k] ?? "")));
  const residential = named.filter((a) => a.tags.landuse === "residential");
  const pick = (residential.length ? residential : named).sort((a, b) => b.derived.area - a.derived.area);
  if (pick.length === 0) {
    const others = [...new Set(areas.filter((a) => a.tags.landuse === "residential" && a.tags.name).map((a) => a.tags.name))].sort();
    throw new DistrictError(
      `No area named "${sector.label}" exists in the areas layer, so the sector cannot be isolated from this data.\n` +
        `Named residential areas that do exist (${others.length}): ${others.slice(0, 60).join(", ") || "none"}`,
    );
  }
  return { feature: pick[0], candidates: pick.map((a) => ({ id: a.id, landuse: a.tags.landuse ?? null, area: a.derived.area })) };
}

/**
 * @param manifest region manifest from build-layers
 * @param layers   { roads, buildings, buildingParts, areas, barriers, pois, rail, furniture }
 * @param options  { sector: key of SECTORS, buffer: metres, heights: override of ESTIMATED_HEIGHTS }
 */
export function buildDistrict(manifest, layers, options = {}) {
  const key = options.sector ?? "alpha-1";
  const sectorDef = SECTORS[key];
  if (!sectorDef) throw new DistrictError(`Unknown sector "${key}".`);
  const buffer = options.buffer ?? 150;
  const heights = { ...ESTIMATED_HEIGHTS, ...(options.heights ?? {}) };
  const { feature: sector, candidates } = findSector(layers.areas, sectorDef);
  const warnings = [];
  if (candidates.length > 1) warnings.push(`${candidates.length} areas are named ${sectorDef.label}; the largest (${sector.id}) was used.`);
  if (sector.clipped) warnings.push(`The ${sectorDef.label} outline is cut by the region boundary.`);
  if (sector.incomplete) warnings.push(`The ${sectorDef.label} outline is incomplete: ${sector.incompleteReasons.join("; ")}`);

  const sectorPolys = sector.geometry.polygons;
  const all = sectorPolys.flatMap((p) => p.outer);
  const R = manifest.bounds;
  const rect = {
    minX: Math.max(R.minX, Math.min(...all.map((p) => p[0])) - buffer), maxX: Math.min(R.maxX, Math.max(...all.map((p) => p[0])) + buffer),
    minZ: Math.max(R.minZ, Math.min(...all.map((p) => p[1])) - buffer), maxZ: Math.min(R.maxZ, Math.max(...all.map((p) => p[1])) + buffer),
  };
  const inSector = (p) => inPolygons(p, sectorPolys);
  const clipPolys = (polygons) => { let clipped = false; const out = []; for (const p of polygons) { const c = clipPolygon(p.outer, p.holes, rect); if (c) { out.push({ outer: c.outer, holes: c.holes }); clipped ||= c.clipped; } } return { polygons: out, clipped }; };
  const polyArea = (polygons) => polygons.reduce((a, p) => a + ringArea(p.outer) - p.holes.reduce((h, r) => h + ringArea(r), 0), 0);

  // ---- buildings
  const buildings = [], skipped = { openOutline: [], outside: 0 };
  const seen = new Set();
  for (const b of layers.buildings) {
    if (b.geometry.type !== "polygons") {
      if (b.geometry.lines?.some((l) => l.some((p) => inside(p, rect)))) skipped.openOutline.push(b.id);
      continue;
    }
    const c = clipPolys(b.geometry.polygons);
    if (!c.polygons.length) { skipped.outside++; continue; }
    if (seen.has(b.id)) throw new DistrictError(`Building ${b.id} appears twice in the buildings layer.`);
    seen.add(b.id);
    const area = r2(polyArea(c.polygons));
    const { category, rule } = classifyBuilding(b.tags);
    const centre = centreOf(c.polygons.flatMap((p) => p.outer));
    buildings.push({
      id: b.id, osm: b.osm, tags: b.tags, category, categoryRule: rule,
      ...buildingHeight(b.id, b.tags, category, area, heights),
      polygons: c.polygons, area, centre, inSector: inSector(centre),
      clipped: Boolean(b.clipped || c.clipped), incomplete: Boolean(b.incomplete), fromRelation: b.osm.type === "relation",
    });
  }

  // ---- roads
  const roads = [];
  let notBuilt = 0;
  for (const r of layers.roads) {
    if (r.kind === "not-built") { if (r.geometry.points.some((p) => inside(p, rect))) notBuilt++; continue; }
    const { pieces } = clipLine(r.geometry.points, rect);
    pieces.forEach((piece, i) => {
      const s = r.source;
      const width = s.width ?? r.estimated?.width?.value ?? 3.5;
      roads.push({
        id: r.id, osm: r.osm, piece: `${r.part ?? 0}.${i}`, tags: r.tags, kind: r.kind, class: s.class, name: s.name,
        oneway: s.oneway ?? r.estimated?.oneway?.value ?? false, lanes: s.lanes ?? r.estimated?.lanes?.value ?? null,
        width, widthStatus: s.width !== null ? "source-width" : s.lanes !== null ? "source-lanes" : "estimated",
        widthBasis: s.width !== null ? `width=${s.width}` : (r.estimated?.width?.basis ?? "default"),
        sidewalk: s.sidewalk, elevated: Boolean(s.bridge && s.bridge !== "no") || (s.layer ?? 0) > 0, tunnel: Boolean(s.tunnel && s.tunnel !== "no"),
        continuesBeyond: { start: piece.cutStart || (i === 0 && r.continuesBeyondRegion?.start), end: piece.cutEnd || (i === pieces.length - 1 && r.continuesBeyondRegion?.end) },
        length: r2(lengthOf(piece.points)), points: piece.points.map((p) => [r2(p[0]), r2(p[1])]),
      });
    });
  }

  // ---- junctions: points shared by two or more carriageway pieces
  const nodes = new Map();
  roads.forEach((road, index) => {
    if (road.kind !== "road") return;
    road.points.forEach((p, i) => {
      const k = `${Math.round(p[0] * 10)},${Math.round(p[1] * 10)}`;
      const n = nodes.get(k) ?? nodes.set(k, { point: p, arms: 0, roads: new Set(), width: 0 }).get(k);
      const loop = road.points.length > 2 && road.points[0][0] === road.points.at(-1)[0] && road.points[0][1] === road.points.at(-1)[1];
      if (loop && i === road.points.length - 1) return;
      n.arms += i === 0 || i === road.points.length - 1 ? (loop ? 2 : 1) : 2;
      n.roads.add(index);
      n.width = Math.max(n.width, road.width);
    });
  });
  const junctions = [...nodes.values()].filter((n) => n.roads.size >= 2).map((n) => ({ point: n.point, arms: n.arms, roads: [...n.roads].map((i) => roads[i].id), radius: r2(n.width / 2) }));

  // ---- areas, barriers, rail, points
  const areas = [];
  for (const a of layers.areas) {
    if (!a.geometry.polygons) continue;
    const c = clipPolys(a.geometry.polygons);
    if (!c.polygons.length) continue;
    const t = a.tags;
    const kind = a.id === sector.id ? "sector" : GREEN.leisure.has(t.leisure) || GREEN.landuse.has(t.landuse) || GREEN.natural.has(t.natural) ? "green" : t.natural === "water" || t.landuse === "reservoir" || t.leisure === "swimming_pool" ? "water" : t.amenity === "parking" ? "parking" : "other";
    areas.push({ id: a.id, osm: a.osm, tags: t, kind, name: t.name ?? null, polygons: c.polygons, area: r2(polyArea(c.polygons)), clipped: Boolean(a.clipped || c.clipped) });
  }
  const lines = (layer) => layer.filter((f) => f.geometry.points).flatMap((f) => clipLine(f.geometry.points, rect).pieces.map((p) => ({ id: f.id, osm: f.osm, tags: f.tags, points: p.points.map((q) => [r2(q[0]), r2(q[1])]) })));
  const points = (layer) => layer.filter((f) => f.geometry.point && inside(f.geometry.point, rect)).map((f) => ({ id: f.id, osm: f.osm, tags: f.tags, point: f.geometry.point }));
  const barriers = { lines: lines(layers.barriers).map((l) => ({ ...l, kind: l.tags.barrier })), points: points(layers.barriers).map((p) => ({ ...p, kind: p.tags.barrier ?? `entrance:${p.tags.entrance}` })) };
  const rail = {
    lines: lines(layers.rail).map((l) => ({ ...l, kind: l.tags.railway, elevated: Boolean(l.tags.bridge && l.tags.bridge !== "no") || parseFloat(l.tags.layer) > 0 })),
    points: points(layers.rail).map((p) => ({ ...p, kind: p.tags.railway ?? p.tags.public_transport, name: p.tags.name ?? null })),
    areas: layers.rail.filter((f) => f.geometry.polygons).map((f) => ({ id: f.id, osm: f.osm, tags: f.tags, name: f.tags.name ?? null, ...clipPolys(f.geometry.polygons) })).filter((f) => f.polygons.length),
  };
  const furniture = points(layers.furniture).map((p) => ({ ...p, kind: p.tags.highway ?? p.tags.natural ?? p.tags.man_made ?? p.tags.power ?? p.tags.amenity ?? "other" }));
  const pois = points(layers.pois).map((p) => ({ ...p, name: p.tags.name ?? null, kind: ["shop", "amenity", "office", "craft", "tourism", "healthcare", "leisure", "place"].map((k) => (p.tags[k] ? `${k}=${p.tags[k]}` : null)).find(Boolean) ?? "named" }));

  const spawn = findSpawn(roads, buildings, rect, inSector, centreOf(all));

  const tally = (items, fn) => { const m = {}; for (const it of items) m[fn(it)] = (m[fn(it)] ?? 0) + 1; return m; };
  const carriage = roads.filter((r) => r.kind === "road");
  const stats = {
    sector: { id: sector.id, name: sector.tags.name, area: r2(polyArea(sectorPolys)), tags: sector.tags },
    regionMetres: { width: r2(rect.maxX - rect.minX), depth: r2(rect.maxZ - rect.minZ) },
    buildings: {
      total: buildings.length, insideSector: buildings.filter((b) => b.inSector).length, fromRelations: buildings.filter((b) => b.fromRelation).length,
      withCourtyards: buildings.filter((b) => b.polygons.some((p) => p.holes.length)).length, clipped: buildings.filter((b) => b.clipped).length,
      byCategory: Object.fromEntries(CATEGORIES.map((c) => [c, buildings.filter((b) => b.category === c).length])),
      byCategoryInsideSector: Object.fromEntries(CATEGORIES.map((c) => [c, buildings.filter((b) => b.category === c && b.inSector).length])),
      byHeightStatus: { "source-height": 0, "source-levels": 0, estimated: 0, ...tally(buildings, (b) => b.heightStatus) },
      skippedOpenOutline: skipped.openOutline,
      /** Region-wide: unclosed building ways never reach the layers, so they cannot be placed in a district. */
      unclosedWaysInRegion: manifest.issues?.unclosedBuildings?.count ?? null,
    },
    roads: {
      pieces: roads.length, osmWays: new Set(roads.map((r) => r.id)).size, carriagewayPieces: carriage.length, pathPieces: roads.length - carriage.length, notBuiltSkipped: notBuilt,
      carriagewayKm: r2(carriage.reduce((a, r) => a + r.length, 0) / 1000), byClass: tally(roads, (r) => r.class), byWidthStatus: tally(carriage, (r) => r.widthStatus),
      named: [...new Set(roads.map((r) => r.name).filter(Boolean))].sort(), leavingDistrict: roads.filter((r) => r.continuesBeyond.start || r.continuesBeyond.end).length,
    },
    junctions: { total: junctions.length, intersections: junctions.filter((j) => j.arms >= 3).length, joints: junctions.filter((j) => j.arms < 3).length },
    areas: tally(areas, (a) => a.kind), barriers: { lines: barriers.lines.length, points: tally(barriers.points, (p) => p.kind) },
    rail: { lines: rail.lines.length, stations: rail.points.filter((p) => p.kind === "station").map((p) => p.name) },
    furniture: tally(furniture, (f) => f.kind), pois: pois.length,
  };

  return {
    formatVersion: 1, kind: "district", id: key, name: sector.tags.name ?? sectorDef.label, region: manifest.region,
    synthetic: Boolean(manifest.source?.synthetic),
    attribution: manifest.attribution, licence: manifest.licence, source: manifest.source, builtAt: options.builtAt ?? new Date().toISOString(),
    projection: manifest.projection, bounds: rect, buffer,
    notes: {
      geometry: "Positions and outlines of buildings, roads, areas, barriers, rail and points come from OpenStreetMap.",
      heights: "heightStatus 'estimated' is a category default, not a measurement. 'source-levels' multiplies mapped levels by an assumed storey height.",
      widths: "widthStatus 'estimated' is a default for the road class.",
      estimatedHeights: heights,
    },
    warnings, sector: { id: sector.id, osm: sector.osm, tags: sector.tags, polygons: clipPolys(sectorPolys).polygons },
    buildings, roads, junctions, areas, barriers, rail, furniture, pois, spawn, stats,
  };
}

/**
 * A point on a mapped street, clear of every building and inside the district.
 * Prefers ordinary streets inside the sector, close to its middle.
 */
export function findSpawn(roads, buildings, rect, inSector, middle, clearance = 3) {
  const clear = (p) => p[0] > rect.minX + 5 && p[0] < rect.maxX - 5 && p[1] > rect.minZ + 5 && p[1] < rect.maxZ - 5 &&
    !buildings.some((b) => Math.hypot(b.centre[0] - p[0], b.centre[1] - p[1]) < 120 && (inPolygons(p, b.polygons) || b.polygons.some((poly) => poly.outer.some((q, i) => i > 0 && distToSegment(p, poly.outer[i - 1], q) < clearance))));
  const rank = { residential: 0, tertiary: 0, unclassified: 1, living_street: 1, secondary: 2, service: 3, primary: 4 };
  let best = null;
  for (const r of roads) {
    if (r.kind !== "road" || r.tunnel || r.elevated) continue;
    for (let i = 1; i < r.points.length; i++) {
      const a = r.points[i - 1], b = r.points[i];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 6) continue;
      const p = [r2((a[0] + b[0]) / 2), r2((a[1] + b[1]) / 2)];
      const score = (rank[r.class] ?? 5) * 400 + (inSector(p) ? 0 : 2000) + Math.hypot(p[0] - middle[0], p[1] - middle[1]);
      if ((!best || score < best.score) && clear(p)) best = { score, x: p[0], z: p[1], heading: r2(Math.atan2(b[0] - a[0], b[1] - a[1])), road: r.id, roadName: r.name, roadClass: r.class };
    }
  }
  if (!best) throw new DistrictError("No mapped road segment inside the district is clear of buildings, so the player cannot be placed on a road.");
  delete best.score;
  return best;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const dir = resolve(arg("--dir") ?? resolve(root, "data/region/greater-noida"));
  const sectorKey = arg("--sector") ?? "alpha-1";
  try {
    let manifest, layers = {};
    if (args.includes("--synthetic")) {
      // Invented test data, written to synthetic.json so it can never be mistaken for the real district.
      const { convert } = await import("./build-layers.mjs");
      const { syntheticExtract } = await import("./fixtures/synthetic-extract.mjs");
      ({ manifest, layers } = convert(syntheticExtract(), {}));
    } else {
      manifest = JSON.parse(await readFile(resolve(dir, "manifest.json"), "utf8"));
      for (const name of ["roads", "buildings", "buildingParts", "areas", "barriers", "pois", "rail", "furniture"]) layers[name] = JSON.parse(await readFile(resolve(dir, `${name}.json`), "utf8")).features;
    }
    const district = buildDistrict(manifest, layers, { sector: sectorKey, buffer: arg("--buffer") ? Number(arg("--buffer")) : undefined });
    const out = resolve(arg("--out") ?? resolve(root, `apps/web/public/regions/${manifest.region}/${args.includes("--synthetic") ? "synthetic" : sectorKey}.json`));
    await mkdir(dirname(out), { recursive: true });
    const text = JSON.stringify(district);
    await writeFile(out, text + "\n");
    const s = district.stats;
    console.log(`${district.synthetic ? "SYNTHETIC TEST DATA. " : ""}Wrote ${out} (${(text.length / 1e6).toFixed(2)} MB)`);
    console.log(`Sector: ${s.sector.id} "${s.sector.name}" ${JSON.stringify(s.sector.tags)}, ${(s.sector.area / 1e6).toFixed(3)} km2`);
    console.log(`District: ${s.regionMetres.width} m x ${s.regionMetres.depth} m (sector plus ${district.buffer} m)`);
    console.log(`Buildings: ${s.buildings.total} (${s.buildings.insideSector} inside the sector outline; ${s.buildings.fromRelations} from relations; ${s.buildings.withCourtyards} with courtyards; ${s.buildings.clipped} cut at the edge)`);
    console.log(`  by category: ${JSON.stringify(s.buildings.byCategory)}`);
    console.log(`  inside sector by category: ${JSON.stringify(s.buildings.byCategoryInsideSector)}`);
    console.log(`  height: ${JSON.stringify(s.buildings.byHeightStatus)}`);
    if (s.buildings.unclosedWaysInRegion) console.log(`  ${s.buildings.unclosedWaysInRegion} unclosed building ways in the whole region were not exported by build-layers and are not built`);
    if (s.buildings.skippedOpenOutline.length) console.log(`  not built (incomplete outline): ${s.buildings.skippedOpenOutline.join(", ")}`);
    console.log(`Roads: ${s.roads.osmWays} OSM ways in ${s.roads.pieces} pieces; carriageway ${s.roads.carriagewayKm} km in ${s.roads.carriagewayPieces} pieces; paths ${s.roads.pathPieces}; not-built skipped ${s.roads.notBuiltSkipped}`);
    console.log(`  by class: ${JSON.stringify(s.roads.byClass)}`);
    console.log(`  width: ${JSON.stringify(s.roads.byWidthStatus)}`);
    console.log(`  named roads (${s.roads.named.length}): ${s.roads.named.join(", ") || "none"}`);
    console.log(`Junctions: ${s.junctions.intersections} intersections (3 or more arms), ${s.junctions.joints} joints between ways`);
    console.log(`Areas: ${JSON.stringify(s.areas)}; barriers: ${s.barriers.lines} lines, points ${JSON.stringify(s.barriers.points)}`);
    console.log(`Rail: ${s.rail.lines} lines, stations ${JSON.stringify(s.rail.stations)}; furniture ${JSON.stringify(s.furniture)}; points of interest ${s.pois}`);
    console.log(`Spawn: (${district.spawn.x}, ${district.spawn.z}) on ${district.spawn.road} ${district.spawn.roadName ? `"${district.spawn.roadName}" ` : ""}[${district.spawn.roadClass}]`);
    for (const w of district.warnings) console.log(`WARNING: ${w}`);
    console.log("Next: npm run dev, then open the app.");
  } catch (err) {
    console.error(err instanceof DistrictError ? `Cannot build the district:\n${err.message}` : `build-district failed: ${err.stack}`);
    process.exit(1);
  }
}
