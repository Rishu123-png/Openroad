#!/usr/bin/env node
/**
 * Converts an OSM extract into game-ready layers in local metres.
 *
 *   node tools/build-layers.mjs                       v2 extract -> data/region/greater-noida/
 *   node tools/build-layers.mjs --file x.json --out dir
 *
 * Steps: validate coordinates -> project to metres -> assemble relations ->
 * clip to the region rectangle -> write one JSON file per layer + manifest.
 * Source data is never edited; features that cannot be used are counted and
 * listed in the manifest.
 *
 * Every feature keeps its OSM id and all tags. Values under "source" come
 * straight from tags, "derived" is measured from the source geometry, and
 * "estimated" is filled in by a stated rule and is NOT source data.
 *
 * Data © OpenStreetMap contributors, ODbL 1.0. The layers are a derivative
 * database and stay under ODbL.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { clipLine, clipPolygon, clipRing, inside, ringArea } from "./geo/clip.mjs";
import { GREATER_NOIDA_ORIGIN, makeProjection } from "./geo/projection.mjs";
import { assembleRelation } from "./geo/rings.mjs";
import { validateCoordinates } from "./geo/validate.mjs";

export const LAYER_NAMES = ["roads", "buildings", "buildingParts", "areas", "barriers", "pois", "rail", "furniture", "coverage"];
const ATTRIBUTION = "© OpenStreetMap contributors, ODbL 1.0, https://www.openstreetmap.org/copyright";

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const isRing = (line) => line.length >= 4 && line[0][0] === line.at(-1)[0] && line[0][1] === line.at(-1)[1];
const centre = (pts) => {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const [x, z] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  return [Math.round((minX + maxX) * 50) / 100, Math.round((minZ + maxZ) * 50) / 100];
};
const lineLength = (pts) => { let d = 0; for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return d; };

const PATH_CLASSES = new Set(["footway", "path", "pedestrian", "steps", "cycleway", "bridleway", "corridor", "track"]);
const LIFECYCLE = new Set(["construction", "proposed", "planned", "abandoned", "razed"]);
/** Estimated lanes for the whole way when no lanes tag exists: [one-way, two-way]. */
const DEFAULT_LANES = { motorway: [3, 6], trunk: [3, 6], primary: [3, 4], secondary: [2, 4], tertiary: [2, 2], unclassified: [1, 2], residential: [1, 2], living_street: [1, 1], service: [1, 1] };
const PATH_WIDTH = { footway: 2, path: 1.5, pedestrian: 4, steps: 2, cycleway: 2, bridleway: 2, corridor: 2, track: 3 };
const COMMERCIAL_AMENITY = new Set(["marketplace", "bank", "restaurant", "fast_food", "cafe", "atm", "pharmacy", "fuel", "food_court", "bar", "cinema"]);
const POI_KEYS = ["shop", "amenity", "office", "craft", "tourism", "healthcare", "leisure", "place"];
const AREA_KEYS = ["landuse", "leisure", "natural", "amenity", "place", "boundary"];

function roadProps(tags) {
  const cls = tags.highway.replace(/_link$/, "");
  const oneway = tags.oneway === "yes" || tags.oneway === "-1" || tags.oneway === "1" ? true : tags.oneway === "no" ? false : null;
  const source = {
    class: tags.highway, name: tags.name ?? null, ref: tags.ref ?? null, lanes: num(tags.lanes), oneway, width: num(tags.width),
    maxspeed: tags.maxspeed ?? null, surface: tags.surface ?? null, junction: tags.junction ?? null, service: tags.service ?? null,
    access: tags.access ?? null, bridge: tags.bridge ?? null, tunnel: tags.tunnel ?? null, layer: num(tags.layer), sidewalk: tags.sidewalk ?? null, lit: tags.lit ?? null,
  };
  const estimated = {};
  const impliedOneway = oneway ?? (tags.junction === "roundabout" || tags.highway === "motorway" ? true : null);
  if (oneway === null && impliedOneway !== null) estimated.oneway = { value: true, basis: "OSM convention: roundabouts and motorways are one-way unless tagged otherwise" };
  if (source.width === null) {
    if (PATH_CLASSES.has(cls)) estimated.width = { value: PATH_WIDTH[cls], basis: `default for highway=${cls}` };
    else if (source.lanes !== null) estimated.width = { value: Math.round(source.lanes * 35) / 10, basis: "lanes tag x 3.5 m" };
    else {
      const d = DEFAULT_LANES[cls] ?? [1, 2];
      const lanes = d[impliedOneway ? 0 : 1];
      estimated.lanes = { value: lanes, basis: `default for highway=${cls}, ${impliedOneway ? "one-way" : "two-way"}` };
      estimated.width = { value: lanes * 3.5, basis: "estimated lanes x 3.5 m" };
    }
  }
  const kind = LIFECYCLE.has(tags.highway) ? "not-built" : PATH_CLASSES.has(cls) ? "path" : "road";
  return { kind, source, estimated };
}

function buildingProps(tags) {
  const levels = num(tags["building:levels"]), height = num(tags.height);
  const source = {
    building: tags.building ?? tags["building:part"] ?? null, name: tags.name ?? null, levels, height, minHeight: num(tags.min_height), minLevel: num(tags["building:min_level"]),
    roofShape: tags["roof:shape"] ?? null, material: tags["building:material"] ?? null, colour: tags["building:colour"] ?? null,
    amenity: tags.amenity ?? null, shop: tags.shop ?? null, office: tags.office ?? null,
  };
  const estimated = height !== null ? {} : levels !== null
    ? { height: { value: Math.round(levels * 32) / 10, basis: "building:levels x 3.2 m" } }
    : { height: { value: null, basis: "no height or levels in the source; the generator must choose and label it as an estimate" } };
  return { source, estimated };
}

/**
 * @param data extract written by tools/fetch-osm.mjs
 * @param options { origin, bbox: [s, w, n, e] } - bbox defaults to the extract's own
 */
export function convert(data, options = {}) {
  const proj = makeProjection(options.origin ?? GREATER_NOIDA_ORIGIN);
  const bbox = options.bbox ?? data.bbox;
  const rect = proj.rect(bbox);
  const validation = validateCoordinates(data);
  const badWay = new Set(validation.malformed.filter((m) => m.type === "way").map((m) => m.id));
  const badNode = new Set(validation.malformed.filter((m) => m.type === "node").map((m) => m.id));

  const layers = Object.fromEntries(LAYER_NAMES.map((n) => [n, []]));
  const issues = { malformedSkipped: [], unclosedBuildings: [], unclosedAreas: 0, outsideRegion: { ways: 0, nodes: 0, relations: 0 }, incompleteRelations: [], waysReplacedByRelation: [], relationsWithoutPolygonTags: 0 };
  const base = (type, id, tags, extra = {}) => ({ id: `${type}/${id}`, osm: { type, id }, tags, ...extra });

  const wayLines = new Map();
  for (const w of data.ways) {
    if (badWay.has(w.id)) { issues.malformedSkipped.push(`way/${w.id}`); continue; }
    wayLines.set(w.id, proj.line(w.pts));
  }
  const wayById = new Map(data.ways.map((w) => [w.id, w]));

  // ---- relations first, so member ways are not exported a second time
  const claimed = new Set();
  const polygonFeature = (feature, polygons, layerProps) => {
    const kept = [];
    let clipped = false;
    for (const p of polygons) {
      const c = clipPolygon(p.outer, p.holes, rect);
      if (!c) continue;
      clipped ||= c.clipped;
      kept.push({ outer: c.outer, holes: c.holes });
    }
    if (!kept.length) return null;
    const area = kept.reduce((a, p) => a + ringArea(p.outer) - p.holes.reduce((h, r) => h + ringArea(r), 0), 0);
    return { ...feature, clipped, ...layerProps, derived: { area: Math.round(area * 10) / 10, centre: centre(kept.flatMap((p) => p.outer)) }, geometry: { type: "polygons", polygons: kept } };
  };

  for (const r of data.relations ?? []) {
    if (r.tags.type !== "multipolygon" && !r.tags.building && r.tags.type !== "boundary" && r.tags.type !== "site") continue;
    if (r.tags.type === "site") continue; // a site groups features; it has no outline of its own
    const asm = assembleRelation(r, wayLines, (pts) => proj.line(pts));
    // Old-style multipolygon: the tags sit on the single outer way.
    let tags = r.tags, tagsFrom = null;
    const outers = r.members.filter((m) => m.type === "way" && m.role !== "inner");
    const hasOwn = r.tags.building || AREA_KEYS.some((k) => r.tags[k]);
    if (!hasOwn && outers.length === 1 && wayById.has(outers[0].ref)) {
      const w = wayById.get(outers[0].ref);
      if (w.tags.building || AREA_KEYS.some((k) => w.tags[k])) { tags = { ...w.tags }; tagsFrom = `way/${w.id}`; }
    }
    const isBuilding = Boolean(tags.building);
    const isArea = !isBuilding && AREA_KEYS.some((k) => tags[k]);
    if (!isBuilding && !isArea) { issues.relationsWithoutPolygonTags++; continue; }
    const feature = base("relation", r.id, tags, {
      relationTags: r.tags, tagsFrom, members: r.members.filter((m) => m.type === "way").map((m) => ({ way: m.ref, role: m.role || "outer" })),
      incomplete: asm.incomplete, incompleteReasons: asm.reasons, missingMembers: asm.missingMembers,
    });
    if (asm.incomplete) issues.incompleteRelations.push({ id: `relation/${r.id}`, reasons: asm.reasons });
    const f = polygonFeature(feature, asm.polygons, isBuilding ? buildingProps(tags) : { category: AREA_KEYS.find((k) => tags[k]), source: { name: tags.name ?? null } });
    if (!f) {
      if (asm.polygons.length) issues.outsideRegion.relations++;
      // No closed outline: keep the open chains as lines only, clearly marked.
      const lines = asm.openOutlines.flatMap((l) => clipLine(l, rect).pieces.map((p) => p.points));
      if (lines.length && isBuilding) layers.buildings.push({ ...feature, clipped: true, ...buildingProps(tags), derived: null, geometry: { type: "open-outline", lines } });
      continue;
    }
    if (asm.openOutlines.length) f.openOutlines = asm.openOutlines.flatMap((l) => clipLine(l, rect).pieces.map((p) => p.points));
    layers[isBuilding ? "buildings" : "areas"].push(f);
    // Outer member ways that only repeat this outline must not appear again as ordinary footprints.
    for (const m of outers) {
      const w = wayById.get(m.ref);
      if (!w) continue;
      const repeats = isBuilding ? Boolean(w.tags.building) || tagsFrom === `way/${w.id}` : tagsFrom === `way/${w.id}`;
      if (repeats) { claimed.add(w.id); issues.waysReplacedByRelation.push({ way: `way/${w.id}`, relation: `relation/${r.id}` }); }
    }
  }

  // ---- ways
  for (const w of data.ways) {
    const line = wayLines.get(w.id);
    if (!line) continue;
    const t = w.tags;
    let used = false, anyInside = false; // anyInside also covers ways already accounted for under another issue
    const ring = isRing(line);

    if (t.highway) {
      used = true;
      const { pieces, clipped } = clipLine(line, rect);
      pieces.forEach((p, i) => layers.roads.push(base("way", w.id, t, {
        part: pieces.length > 1 ? i : null, parts: pieces.length, clipped, continuesBeyondRegion: { start: p.cutStart, end: p.cutEnd },
        ...roadProps(t), derived: { length: Math.round(lineLength(p.points) * 10) / 10, closedLoop: isRing(p.points) }, geometry: { type: "line", points: p.points },
      })));
      anyInside ||= pieces.length > 0;
    }
    if (t.railway) {
      used = true;
      if (ring && ["station", "platform"].includes(t.railway)) {
        const f = polygonFeature(base("way", w.id, t), [{ outer: line, holes: [] }], { source: { railway: t.railway, name: t.name ?? null, station: t.station ?? null } });
        if (f) { layers.rail.push(f); anyInside = true; }
      } else {
        const { pieces, clipped } = clipLine(line, rect);
        pieces.forEach((p, i) => layers.rail.push(base("way", w.id, t, { part: pieces.length > 1 ? i : null, clipped, source: { railway: t.railway, name: t.name ?? null, bridge: t.bridge ?? null, layer: num(t.layer) }, geometry: { type: "line", points: p.points } })));
        anyInside ||= pieces.length > 0;
      }
    }
    if (t.barrier) {
      used = true;
      const { pieces, clipped } = clipLine(line, rect);
      pieces.forEach((p, i) => layers.barriers.push(base("way", w.id, t, { part: pieces.length > 1 ? i : null, clipped, source: { barrier: t.barrier, height: num(t.height) }, derived: { length: Math.round(lineLength(p.points) * 10) / 10 }, geometry: { type: "line", points: p.points } })));
      anyInside ||= pieces.length > 0;
    }
    if (t.building || t["building:part"]) {
      used = true;
      if (claimed.has(w.id)) anyInside = true;
      else if (!ring) { issues.unclosedBuildings.push(`way/${w.id}`); anyInside = true; }
      else {
        const f = polygonFeature(base("way", w.id, t), [{ outer: line, holes: [] }], buildingProps(t));
        if (f) { layers[t.building ? "buildings" : "buildingParts"].push(f); anyInside = true; }
      }
    } else if (AREA_KEYS.some((k) => t[k]) && !t.highway && !t.barrier && !(t.railway && !t.landuse)) {
      used = true;
      if (claimed.has(w.id)) anyInside = true;
      else if (!ring) { issues.unclosedAreas++; anyInside = true; }
      else {
        const f = polygonFeature(base("way", w.id, t), [{ outer: line, holes: [] }], { category: AREA_KEYS.find((k) => t[k]), source: { name: t.name ?? null } });
        if (f) { layers.areas.push(f); anyInside = true; }
      }
    }
    // A shop, office or similar mapped as an outline also becomes a point of interest at its centre.
    const poiKey = ["shop", "office", "craft", "tourism", "healthcare", "amenity"].find((k) => t[k]);
    if (poiKey && ring) {
      const c = clipRing(line, rect);
      if (c.ring) layers.pois.push(base("way", w.id, t, { from: "outline centre", category: poiKey, commercial: Boolean(t.shop || t.office || t.craft || COMMERCIAL_AMENITY.has(t.amenity)), source: { name: t.name ?? null, kind: t[poiKey] }, geometry: { type: "point", point: centre(c.ring) } }));
    }
    if (used && !anyInside) issues.outsideRegion.ways++;
  }

  // ---- nodes: each goes to exactly one layer
  for (const n of data.nodes) {
    if (badNode.has(n.id)) { issues.malformedSkipped.push(`node/${n.id}`); continue; }
    const p = proj.toLocal(n.lat, n.lon);
    if (!inside(p, rect)) { issues.outsideRegion.nodes++; continue; }
    const t = n.tags;
    const f = base("node", n.id, t, { geometry: { type: "point", point: p } });
    if (t.barrier || t.entrance) layers.barriers.push({ ...f, source: { barrier: t.barrier ?? null, entrance: t.entrance ?? null, access: t.access ?? null, name: t.name ?? null } });
    else if (t.railway || t.public_transport) layers.rail.push({ ...f, source: { railway: t.railway ?? null, publicTransport: t.public_transport ?? null, name: t.name ?? null } });
    else if (t.highway || t.traffic_calming || t.man_made || t.power || t.emergency || t.advertising || t.natural === "tree" || ["bench", "waste_basket"].includes(t.amenity))
      layers.furniture.push({ ...f, source: { kind: t.highway ?? t.traffic_calming ?? t.man_made ?? t.power ?? t.emergency ?? t.advertising ?? t.natural ?? t.amenity, name: t.name ?? null } });
    else {
      const key = POI_KEYS.find((k) => t[k]) ?? (t.name ? "name" : "other");
      layers.pois.push({ ...f, from: "node", category: key, commercial: Boolean(t.shop || t.office || t.craft || COMMERCIAL_AMENITY.has(t.amenity)), source: { name: t.name ?? null, kind: t[key] ?? null } });
    }
  }

  layers.coverage = coverageGrid(layers, rect, options.cell ?? 250);
  assertInside(layers, rect);

  const manifest = {
    formatVersion: 1,
    region: options.region ?? "greater-noida",
    attribution: ATTRIBUTION,
    licence: "ODbL-1.0 (derivative database of OpenStreetMap)",
    source: { file: options.sourceFile ?? null, profile: data.profile ?? "v1", osmBase: data.osmBase ?? null, extractedAt: data.extractedAt ?? null, endpoint: data.endpoint ?? null, query: data.query ?? null },
    builtAt: options.builtAt ?? new Date().toISOString(),
    projection: { name: proj.name, origin: proj.origin, metresPerDegLat: proj.metresPerDegLat, metresPerDegLon: proj.metresPerDegLon, axes: "+x east, +z north, metres from the origin" },
    bbox,
    bounds: rect,
    propertyClasses: {
      tags: "all OSM tags, unchanged", source: "values read from tags", derived: "measured from source geometry after projection and clipping",
      estimated: "filled in by the stated rule; not source data", clipped: "geometry was cut at the region boundary", incomplete: "relation outline could not be fully assembled; nothing was added to close it",
    },
    counts: Object.fromEntries(LAYER_NAMES.map((n) => [n, layers[n].length])),
    detail: {
      roads: { road: layers.roads.filter((r) => r.kind === "road").length, path: layers.roads.filter((r) => r.kind === "path").length, notBuilt: layers.roads.filter((r) => r.kind === "not-built").length, clippedPieces: layers.roads.filter((r) => r.clipped).length },
      buildings: { fromWays: layers.buildings.filter((b) => b.osm.type === "way").length, fromRelations: layers.buildings.filter((b) => b.osm.type === "relation").length, withCourtyards: layers.buildings.filter((b) => b.geometry.polygons?.some((p) => p.holes.length)).length, incomplete: layers.buildings.filter((b) => b.incomplete).length, openOutlineOnly: layers.buildings.filter((b) => b.geometry.type === "open-outline").length, clipped: layers.buildings.filter((b) => b.clipped).length, heightFromSource: layers.buildings.filter((b) => b.source.height !== null).length, heightFromLevels: layers.buildings.filter((b) => b.source.height === null && b.source.levels !== null).length, heightUnknown: layers.buildings.filter((b) => b.source.height === null && b.source.levels === null).length },
      coverage: Object.fromEntries(["footprints", "streets-without-footprints", "sparse", "nothing-mapped"].map((s) => [s, layers.coverage.filter((c) => c.status === s).length])),
    },
    validation: { malformed: validation.malformed, farReaching: validation.farReaching.map((f) => ({ type: f.type, id: f.id, tags: f.tags, farthest: f.farthest })), nodesOutsideBbox: validation.nodesOutsideBbox },
    issues: { ...issues, unclosedBuildings: { count: issues.unclosedBuildings.length, first: issues.unclosedBuildings.slice(0, 50) }, waysReplacedByRelation: { count: issues.waysReplacedByRelation.length, first: issues.waysReplacedByRelation.slice(0, 50) } },
  };
  return { manifest, layers };
}

/** 250 m cells describing what is mapped, so unmapped land is never mistaken for empty land. */
export function coverageGrid(layers, rect, cell = 250) {
  const cols = Math.ceil((rect.maxX - rect.minX) / cell), rows = Math.ceil((rect.maxZ - rect.minZ) / cell);
  const grid = Array.from({ length: rows * cols }, (_, i) => ({ col: i % cols, row: Math.floor(i / cols), buildings: 0, localStreetMetres: 0, roadMetres: 0, other: 0 }));
  const at = ([x, z]) => grid[Math.min(rows - 1, Math.max(0, Math.floor((z - rect.minZ) / cell))) * cols + Math.min(cols - 1, Math.max(0, Math.floor((x - rect.minX) / cell)))];
  for (const b of layers.buildings) if (b.derived) at(b.derived.centre).buildings++;
  for (const r of layers.roads) {
    if (r.kind !== "road") continue;
    const local = ["residential", "living_street", "unclassified", "service"].includes(r.source.class);
    const p = r.geometry.points;
    for (let i = 1; i < p.length; i++) {
      const len = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
      const c = at([(p[i][0] + p[i - 1][0]) / 2, (p[i][1] + p[i - 1][1]) / 2]);
      c.roadMetres += len;
      if (local) c.localStreetMetres += len;
    }
  }
  for (const name of ["areas", "pois", "barriers", "rail", "furniture"]) for (const f of layers[name]) at(f.geometry.point ?? f.derived?.centre ?? f.geometry.points?.[0] ?? [rect.minX, rect.minZ]).other++;
  return grid.map((c) => ({
    id: `cell/${c.col}_${c.row}`, col: c.col, row: c.row,
    bounds: { minX: rect.minX + c.col * cell, minZ: rect.minZ + c.row * cell, maxX: Math.min(rect.maxX, rect.minX + (c.col + 1) * cell), maxZ: Math.min(rect.maxZ, rect.minZ + (c.row + 1) * cell) },
    buildings: c.buildings, localStreetMetres: Math.round(c.localStreetMetres), roadMetres: Math.round(c.roadMetres),
    status: c.buildings >= 3 ? "footprints" : c.localStreetMetres >= cell ? "streets-without-footprints" : c.buildings + c.roadMetres + c.other > 0 ? "sparse" : "nothing-mapped",
  }));
}

/** Throws if any coordinate in any layer lies outside the region. */
export function assertInside(layers, rect, tolerance = 0.011) {
  const r = { minX: rect.minX - tolerance, minZ: rect.minZ - tolerance, maxX: rect.maxX + tolerance, maxZ: rect.maxZ + tolerance };
  const check = (p, id) => { if (!inside(p, r)) throw new Error(`Geometry of ${id} leaks outside the region at ${p}`); };
  for (const name of LAYER_NAMES) {
    if (name === "coverage") continue;
    for (const f of layers[name]) {
      const g = f.geometry;
      if (g.point) check(g.point, f.id);
      for (const p of g.points ?? []) check(p, f.id);
      for (const l of [...(g.lines ?? []), ...(f.openOutlines ?? [])]) for (const p of l) check(p, f.id);
      for (const poly of g.polygons ?? []) for (const ring of [poly.outer, ...poly.holes]) for (const p of ring) check(p, f.id);
    }
  }
  return true;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const file = resolve(arg("--file") ?? resolve(root, "data/osm/greater-noida-corridor-v2.json"));
  const outDir = resolve(arg("--out") ?? resolve(root, "data/region/greater-noida"));
  try {
    const data = JSON.parse(await readFile(file, "utf8"));
    const { manifest, layers } = convert(data, { sourceFile: file.split(/[\\/]/).pop() });
    await mkdir(outDir, { recursive: true });
    manifest.files = {};
    for (const name of LAYER_NAMES) {
      const text = JSON.stringify({ layer: name, attribution: ATTRIBUTION, features: layers[name] });
      await writeFile(resolve(outDir, `${name}.json`), text + "\n");
      manifest.files[name] = { path: `${name}.json`, bytes: text.length + 1 };
    }
    await writeFile(resolve(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    console.log(`Wrote ${LAYER_NAMES.length} layers and manifest.json to ${outDir}`);
    console.log(`Region ${Math.round(manifest.bounds.maxX - manifest.bounds.minX)} m x ${Math.round(manifest.bounds.maxZ - manifest.bounds.minZ)} m, origin ${manifest.projection.origin.lat}, ${manifest.projection.origin.lon}`);
    console.log("Counts:", JSON.stringify(manifest.counts));
    console.log("Roads:", JSON.stringify(manifest.detail.roads));
    console.log("Buildings:", JSON.stringify(manifest.detail.buildings));
    console.log("Coverage cells:", JSON.stringify(manifest.detail.coverage));
    const i = manifest.issues;
    console.log(`Issues: malformed skipped ${i.malformedSkipped.length}; unclosed buildings ${i.unclosedBuildings.count}; unclosed areas ${i.unclosedAreas}; incomplete relations ${i.incompleteRelations.length}; ways replaced by their relation ${i.waysReplacedByRelation.count}; entirely outside region: ways ${i.outsideRegion.ways}, nodes ${i.outsideRegion.nodes}, relations ${i.outsideRegion.relations}`);
    console.log(`Validation: malformed ${manifest.validation.malformed.length}; long features reaching far beyond the bbox ${manifest.validation.farReaching.length} (clipped)`);
    console.log("No coordinate lies outside the region (checked).");
  } catch (err) {
    console.error(`build-layers failed: ${err.message}`);
    process.exit(1);
  }
}
