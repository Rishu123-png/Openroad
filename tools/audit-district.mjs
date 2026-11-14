#!/usr/bin/env node
/**
 * Read-only data-quality audit of a built district file.
 *
 *   node tools/audit-district.mjs [path/to/district.json]
 *
 * Prints what the file states (source), what was derived from tags, and what
 * is an estimate, so that rendering decisions can be based on the evidence
 * that exists. It writes nothing and changes nothing.
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const tally = (items, fn) => {
  const m = new Map();
  for (const it of items) for (const k of [fn(it)].flat()) if (k !== null && k !== undefined) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
};
const show = (pairs, limit = 14) => (pairs.length ? pairs.slice(0, limit).map(([k, n]) => `${k} ${n}`).join(", ") + (pairs.length > limit ? `, and ${pairs.length - limit} more` : "") : "none");
const inRing = (p, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
};
const inPolygons = (p, polygons) => polygons.some((poly) => inRing(p, poly.outer) && !poly.holes.some((h) => inRing(p, h)));
const lengthOf = (pts) => pts.slice(1).reduce((d, q, i) => d + Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]), 0);
const pct = (n, of) => (of ? `${n} (${((100 * n) / of).toFixed(1)} %)` : `${n}`);

/** Builds the audit as plain data; `format` turns it into text. */
export function auditDistrict(d) {
  const B = d.buildings ?? [], R = d.roads ?? [], A = d.areas ?? [];
  const carriage = R.filter((r) => r.kind === "road");
  const tagged = (key) => B.filter((b) => b.tags?.[key] !== undefined).length;
  const named = (items) => items.filter((i) => i.name ?? i.tags?.name).map((i) => i.name ?? i.tags.name);
  const landuse = A.filter((a) => a.tags?.landuse);
  const within = (areas) => B.filter((b) => areas.some((a) => inPolygons(b.centre, a.polygons))).length;
  const closedBarriers = (d.barriers?.lines ?? []).filter((l) => l.points.length > 3 && Math.hypot(l.points[0][0] - l.points.at(-1)[0], l.points[0][1] - l.points.at(-1)[1]) < 0.5);
  const pois = d.pois ?? [];
  const poisInBuildings = pois.filter((p) => B.some((b) => Math.abs(b.centre[0] - p.point[0]) < 150 && Math.abs(b.centre[1] - p.point[1]) < 150 && inPolygons(p.point, b.polygons))).length;
  return {
    file: { name: d.name, id: d.id, synthetic: Boolean(d.synthetic), builtAt: d.builtAt ?? null, attribution: d.attribution ?? null, licence: d.licence ?? null, osmBase: d.source?.osmBase ?? null, sourceFile: d.source?.file ?? null, sectorTags: d.sector?.tags ?? null, sectorArea: d.stats?.sector?.area ?? null, bounds: d.bounds, warnings: d.warnings ?? [] },
    buildings: {
      total: B.length, inSector: B.filter((b) => b.inSector).length, courtyards: B.filter((b) => b.polygons.some((p) => p.holes.length)).length,
      multiPart: B.filter((b) => b.polygons.length > 1).length, clipped: B.filter((b) => b.clipped).length,
      buildingTag: tally(B, (b) => b.tags?.building ?? "(none)"), category: tally(B, (b) => b.category), categoryRule: tally(B, (b) => b.categoryRule),
      heightStatus: tally(B, (b) => b.heightStatus), withHeightTag: tagged("height"), withLevels: tagged("building:levels"), levels: tally(B, (b) => b.tags?.["building:levels"]),
      withName: tagged("name"), withAddress: B.filter((b) => Object.keys(b.tags ?? {}).some((k) => k.startsWith("addr:"))).length,
      withRoofTag: B.filter((b) => Object.keys(b.tags ?? {}).some((k) => k.startsWith("roof:"))).length, withMaterialOrColour: B.filter((b) => b.tags?.["building:material"] || b.tags?.["building:colour"]).length,
      otherTagKeys: tally(B, (b) => Object.keys(b.tags ?? {}).filter((k) => !["building", "height", "building:levels", "name"].includes(k) && !k.startsWith("addr:"))),
      areaBands: tally(B, (b) => (b.area < 30 ? "under 30 m2" : b.area < 120 ? "30-120 m2" : b.area < 400 ? "120-400 m2" : b.area < 1500 ? "400-1500 m2" : "over 1500 m2")),
      names: named(B),
    },
    roads: {
      pieces: R.length, carriagewayPieces: carriage.length, carriagewayKm: carriage.reduce((s, r) => s + lengthOf(r.points), 0) / 1000,
      byClass: tally(R, (r) => r.class), widthStatus: tally(carriage, (r) => r.widthStatus), widthBasis: tally(carriage, (r) => r.widthBasis),
      withLanesTag: carriage.filter((r) => r.tags?.lanes).length, oneway: carriage.filter((r) => r.oneway).length, withSidewalkTag: tally(carriage, (r) => (r.sidewalk ? `sidewalk=${r.sidewalk}` : null)),
      withSurface: tally(carriage, (r) => (r.tags?.surface ? `surface=${r.tags.surface}` : null)), withLit: tally(carriage, (r) => (r.tags?.lit ? `lit=${r.tags.lit}` : null)),
      withMaxspeed: carriage.filter((r) => r.tags?.maxspeed).length, withAccess: tally(carriage, (r) => (r.tags?.access ? `access=${r.tags.access}` : null)),
      service: tally(R, (r) => (r.class === "service" ? `service=${r.tags?.service ?? "(untagged)"}` : null)),
      widthsByClass: tally(carriage, (r) => `${r.class} ${r.width} m`), elevated: R.filter((r) => r.elevated).length, tunnel: R.filter((r) => r.tunnel).length,
      names: [...new Set(named(R))].sort(), junctions3: (d.junctions ?? []).filter((j) => j.arms >= 3).length,
    },
    areas: {
      total: A.length, kind: tally(A, (a) => a.kind), landuse: tally(landuse, (a) => `landuse=${a.tags.landuse}`), leisure: tally(A, (a) => (a.tags?.leisure ? `leisure=${a.tags.leisure}` : null)),
      amenity: tally(A, (a) => (a.tags?.amenity ? `amenity=${a.tags.amenity}` : null)), residentialType: tally(A, (a) => (a.tags?.residential ? `residential=${a.tags.residential}` : null)),
      buildingsInLanduse: tally(landuse, (a) => `landuse=${a.tags.landuse}`).map(([k]) => [k, within(landuse.filter((a) => `landuse=${a.tags.landuse}` === k))]),
      buildingsInParking: within(A.filter((a) => a.kind === "parking")), names: named(A.filter((a) => a.kind !== "sector")),
    },
    barriers: {
      lines: d.barriers?.lines.length ?? 0, lineKind: tally(d.barriers?.lines ?? [], (l) => l.kind ?? "(none)"), lineMetres: (d.barriers?.lines ?? []).reduce((s, l) => s + lengthOf(l.points), 0),
      closedRings: closedBarriers.length, withHeight: (d.barriers?.lines ?? []).filter((l) => l.tags?.height).length,
      points: tally(d.barriers?.points ?? [], (p) => p.kind ?? "(none)"), namedPoints: named(d.barriers?.points ?? []),
    },
    rail: { lines: tally(d.rail?.lines ?? [], (l) => `${l.kind}${l.elevated ? " elevated" : ""}`), points: (d.rail?.points ?? []).map((p) => `${p.kind}: ${p.name ?? "(unnamed)"}`), areas: (d.rail?.areas ?? []).map((a) => a.name ?? a.tags?.railway ?? "(unnamed)") },
    furniture: { kind: tally(d.furniture ?? [], (f) => f.kind), crossings: tally(d.furniture ?? [], (f) => (f.tags?.highway === "crossing" ? `crossing=${f.tags.crossing ?? "(untagged)"}` : null)) },
    pois: { total: pois.length, kind: tally(pois, (p) => p.kind), named: pois.filter((p) => p.name).length, insideBuildings: poisInBuildings, names: pois.filter((p) => p.name).map((p) => `${p.name} [${p.kind}]`) },
  };
}

export function format(a) {
  const L = [];
  const f = a.file, b = a.buildings, r = a.roads;
  L.push(`DISTRICT DATA AUDIT: ${f.name} (${f.id})${f.synthetic ? "  ** SYNTHETIC TEST DATA, not the real district **" : ""}`);
  L.push(`Source: ${f.sourceFile ?? "not stated"}; OSM base ${f.osmBase ?? "not stated"}; built ${f.builtAt ?? "?"}`);
  L.push(`Attribution: ${f.attribution ?? "MISSING"}; licence: ${typeof f.licence === "string" ? f.licence : JSON.stringify(f.licence) ?? "MISSING"}`);
  L.push(`Sector tags: ${JSON.stringify(f.sectorTags)}; area ${f.sectorArea ?? "?"} m2; bounds ${JSON.stringify(f.bounds)}`);
  for (const w of f.warnings) L.push(`WARNING in file: ${w}`);
  L.push("", "BUILDINGS");
  L.push(`  total ${b.total}; inside sector ${pct(b.inSector, b.total)}; with courtyards ${b.courtyards}; multi-part ${b.multiPart}; cut at edge ${b.clipped}`);
  L.push(`  building= tag: ${show(b.buildingTag)}`);
  L.push(`  category: ${show(b.category)}`);
  L.push(`  category decided by: ${show(b.categoryRule)}`);
  L.push(`  height status: ${show(b.heightStatus)}`);
  L.push(`  height tag ${pct(b.withHeightTag, b.total)}; building:levels ${pct(b.withLevels, b.total)}; levels values: ${show(b.levels)}`);
  L.push(`  name ${pct(b.withName, b.total)}; addr:* ${pct(b.withAddress, b.total)}; roof:* ${b.withRoofTag}; material/colour ${b.withMaterialOrColour}`);
  L.push(`  other tag keys: ${show(b.otherTagKeys, 20)}`);
  L.push(`  footprint area: ${show(b.areaBands)}`);
  L.push(`  named buildings (${b.names.length}): ${b.names.slice(0, 60).join("; ") || "none"}`);
  L.push("", "ROADS");
  L.push(`  pieces ${r.pieces}; carriageway ${r.carriagewayPieces} pieces, ${r.carriagewayKm.toFixed(2)} km; junctions (3+ arms) ${r.junctions3}; elevated ${r.elevated}; tunnel ${r.tunnel}`);
  L.push(`  class: ${show(r.byClass)}`);
  L.push(`  width status: ${show(r.widthStatus)}`);
  L.push(`  width basis: ${show(r.widthBasis)}`);
  L.push(`  width by class: ${show(r.widthsByClass, 24)}`);
  L.push(`  lanes tag ${pct(r.withLanesTag, r.carriagewayPieces)}; one-way ${r.oneway}; maxspeed ${r.withMaxspeed}`);
  L.push(`  sidewalk: ${show(r.withSidewalkTag)}; surface: ${show(r.withSurface)}; lit: ${show(r.withLit)}; access: ${show(r.withAccess)}`);
  L.push(`  service roads: ${show(r.service)}`);
  L.push(`  named roads (${r.names.length}): ${r.names.join("; ") || "none"}`);
  L.push("", "AREAS");
  L.push(`  total ${a.areas.total}; kind: ${show(a.areas.kind)}`);
  L.push(`  landuse: ${show(a.areas.landuse)}; leisure: ${show(a.areas.leisure)}; amenity: ${show(a.areas.amenity)}; residential=: ${show(a.areas.residentialType)}`);
  L.push(`  buildings whose centre lies in a landuse area: ${show(a.areas.buildingsInLanduse)}; in a mapped parking area: ${a.areas.buildingsInParking}`);
  L.push(`  named areas (${a.areas.names.length}): ${a.areas.names.slice(0, 60).join("; ") || "none"}`);
  L.push("", "BARRIERS AND ENTRANCES");
  L.push(`  lines ${a.barriers.lines} (${a.barriers.lineMetres.toFixed(0)} m): ${show(a.barriers.lineKind)}; closed rings ${a.barriers.closedRings}; with height tag ${a.barriers.withHeight}`);
  L.push(`  points: ${show(a.barriers.points)}; named: ${a.barriers.namedPoints.join("; ") || "none"}`);
  L.push("", "RAIL / METRO");
  L.push(`  lines: ${show(a.rail.lines)}; points: ${a.rail.points.join("; ") || "none"}; areas: ${a.rail.areas.join("; ") || "none"}`);
  L.push("", "STREET OBJECTS (mapped points)");
  L.push(`  ${show(a.furniture.kind, 20)}`);
  L.push(`  mapped crossings: ${show(a.furniture.crossings)}`);
  L.push("", "POINTS OF INTEREST");
  L.push(`  total ${a.pois.total}; named ${a.pois.named}; inside a building footprint ${a.pois.insideBuildings}`);
  L.push(`  kind: ${show(a.pois.kind, 24)}`);
  L.push(`  names (${a.pois.names.length}): ${a.pois.names.slice(0, 80).join("; ") || "none"}`);
  return L.join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const path = resolve(process.argv[2] ?? process.env.OPENROAD_DISTRICT ?? resolve(root, "apps/web/public/regions/greater-noida/alpha-1.json"));
  try {
    const audit = auditDistrict(JSON.parse(await readFile(path, "utf8")));
    console.log(process.argv.includes("--json") ? JSON.stringify(audit, null, 1) : `${path}\n${format(audit)}`);
  } catch (err) {
    console.error(err.code === "ENOENT" ? `No district file at ${path}. Build it first (node tools/build-district.mjs), or pass a path.` : `audit-district failed: ${err.stack}`);
    process.exit(1);
  }
}
