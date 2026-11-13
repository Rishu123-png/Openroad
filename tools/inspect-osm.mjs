#!/usr/bin/env node
/**
 * Audits data/osm/greater-noida-corridor.json and prints a plain-text report.
 * Everything in the report is read from the file. Nothing is estimated except
 * where a line says so, and a feature that is absent here may still exist on
 * the ground: OpenStreetMap is incomplete.
 *
 *   node tools/inspect-osm.mjs                       full report
 *   node tools/inspect-osm.mjs --out report.txt      also write it to a file
 *   node tools/inspect-osm.mjs --find "galgotia"     list every feature with a tag value matching the pattern
 *   node tools/inspect-osm.mjs --file other.json     audit a different extract
 *
 * Data © OpenStreetMap contributors, ODbL 1.0.
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------- geometry

/** Centre of the Pari Chowk roundabout (OSM ways 63223327 and 753900885). */
export const ORIGIN = { lat: 28.46526, lon: 77.5113 };
const M_LAT = 110832;
const M_LON = 97921;

/** Flat [lat, lon, ...] to [[x east, y north], ...] in metres from ORIGIN. */
export const toXY = (pts) => {
  const out = [];
  for (let i = 0; i < pts.length; i += 2) out.push([(pts[i + 1] - ORIGIN.lon) * M_LON, (pts[i] - ORIGIN.lat) * M_LAT]);
  return out;
};
export const isClosed = (pts) => pts.length >= 8 && pts[0] === pts.at(-2) && pts[1] === pts.at(-1);
export const lengthOf = (xy) => {
  let d = 0;
  for (let i = 1; i < xy.length; i++) d += Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]);
  return d;
};
export const areaOf = (xy) => {
  let a = 0;
  for (let i = 0, j = xy.length - 1; i < xy.length; j = i++) a += xy[j][0] * xy[i][1] - xy[i][0] * xy[j][1];
  return Math.abs(a) / 2;
};
export const centreOf = (xy) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of xy) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return [(minX + maxX) / 2, (minY + maxY) / 2];
};
export const inPolygon = ([x, y], poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const distToSegment = ([px, py], [ax, ay], [bx, by]) => {
  const dx = bx - ax, dy = by - ay;
  const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
};
export const distToLine = (p, line) => {
  let d = Infinity;
  for (let i = 1; i < line.length; i++) d = Math.min(d, distToSegment(p, line[i - 1], line[i]));
  return d;
};
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
/** "1.2 km NE" relative to Pari Chowk. */
export const where = ([x, y]) => {
  const d = Math.hypot(x, y);
  const dir = COMPASS[Math.round(((Math.atan2(x, y) * 180) / Math.PI + 360) / 45) % 8];
  return d < 1000 ? `${Math.round(d)} m ${dir}` : `${(d / 1000).toFixed(1)} km ${dir}`;
};
const geo = ([x, y]) => `${(ORIGIN.lat + y / M_LAT).toFixed(5)}, ${(ORIGIN.lon + x / M_LON).toFixed(5)}`;

// ---------------------------------------------------------------- helpers

const tally = (items, fn) => {
  const m = new Map();
  for (const it of items) {
    const k = fn(it);
    if (k !== undefined && k !== null) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m].sort((a, b) => b[1] - a[1]);
};
const list = (pairs, max = 20) =>
  pairs.slice(0, max).map(([k, n]) => `${k} ${n}`).join(", ") + (pairs.length > max ? `, +${pairs.length - max} more kinds` : "") || "none";
const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : "n/a");
const km = (m) => (m / 1000).toFixed(1);
const NAME_KEYS = ["name", "name:en", "alt_name", "official_name", "short_name", "old_name", "loc_name"];
const nameOf = (t) => t.name ?? t["name:en"] ?? t.alt_name ?? t.official_name;
const kindOf = (t) => {
  for (const k of ["highway", "railway", "landuse", "leisure", "amenity", "shop", "building", "barrier", "natural", "place", "public_transport"])
    if (t[k]) return `${k}=${t[k]}`;
  return Object.keys(t)[0] ?? "untagged";
};
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
};

const SECTORS = [
  ["Alpha 1", /^alpha[\s-]*(1|i)$/i],
  ["Alpha 2", /^alpha[\s-]*(2|ii)$/i],
  ["Beta 1", /^beta[\s-]*(1|i)$/i],
  ["Beta 2", /^beta[\s-]*(2|ii)$/i],
  ["Gamma 1", /^gamma[\s-]*(1|i)$/i],
  ["Gamma 2", /^gamma[\s-]*(2|ii)$/i],
];
const MAJOR = new Set(["motorway", "trunk", "primary", "secondary", "tertiary", "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link"]);
const EDU = new Set(["college", "university", "school", "kindergarten", "research_institute", "library"]);
const INSTITUTIONAL_AMENITY = new Set([...EDU, "hospital", "clinic", "police", "fire_station", "townhall", "courthouse", "place_of_worship", "community_centre", "post_office", "public_building"]);
const INSTITUTIONAL_BUILDING = new Set(["school", "university", "college", "hospital", "public", "government", "civic", "kindergarten", "temple", "mosque", "church", "gurdwara"]);
const COMMERCIAL_BUILDING = new Set(["commercial", "retail", "office", "supermarket", "kiosk", "shop", "hotel", "mall"]);
const HOUSE_BUILDING = new Set(["house", "detached", "semidetached_house", "terrace", "bungalow", "residential"]);

/** Adds metric geometry to every feature once. */
export function prepare(data) {
  const ways = data.ways.map((w) => {
    const xy = toXY(w.pts);
    const closed = isClosed(w.pts);
    return { ...w, xy, closed, c: centreOf(xy), len: lengthOf(xy), area: closed ? areaOf(xy) : 0 };
  });
  const nodes = data.nodes.map((n) => ({ ...n, c: toXY([n.lat, n.lon])[0] }));
  return { ...data, ways, nodes };
}

/** Every feature with any tag value matching `re`. */
export function findByTag(d, re, keys) {
  const hits = [];
  for (const f of [...d.ways, ...d.nodes]) {
    for (const [k, v] of Object.entries(f.tags)) {
      if (keys && !keys.some((p) => k === p || k.startsWith(p))) continue;
      if (re.test(String(v))) {
        hits.push({ f, key: k, value: v });
        break;
      }
    }
  }
  return hits;
}
const describe = (f) => `${f.pts ? "way" : "node"} ${f.id} ${kindOf(f.tags)}${nameOf(f.tags) ? ` "${nameOf(f.tags)}"` : ""}, ${where(f.c)} of Pari Chowk (${geo(f.c)})${f.area > 0 ? `, ${Math.round(f.area)} m2` : ""}`;
const nearestNamedRoad = (d, p, max = 150) => {
  let best, bd = max;
  for (const r of d.roads) {
    if (!r.tags.name || Math.hypot(r.c[0] - p[0], r.c[1] - p[1]) > r.len + max) continue;
    const dist = distToLine(p, r.xy);
    if (dist < bd) { bd = dist; best = r; }
  }
  return best ? `${best.tags.name} (${best.tags.highway}, ${Math.round(bd)} m away)` : "no named road within 150 m";
};
const sectorAt = (d, p) => d.sectors.find((s) => s.way && inPolygon(p, s.way.xy))?.label;

// ---------------------------------------------------------------- sections

function sectionDataset(d, out) {
  const [S, W, N, E] = d.bbox;
  out.push("OPENROAD GEODATA AUDIT");
  out.push("Source: OpenStreetMap via Overpass API. © OpenStreetMap contributors, ODbL 1.0.");
  out.push("Every figure below is read from the extract. Absence here does not prove absence on the ground.");
  out.push(`\n== 1. DATASET ==`);
  out.push(`OSM base ${d.osmBase}; bbox S ${S} W ${W} N ${N} E ${E} = ${km((E - W) * M_LON)} km east-west x ${km((N - S) * M_LAT)} km north-south`);
  out.push(`Ways ${d.ways.length}: roads ${d.roads.length}, buildings ${d.buildings.length}, landuse ${d.landuse.length}, leisure ${d.ways.filter((w) => w.tags.leisure).length}, railway ${d.ways.filter((w) => w.tags.railway).length}, barrier ${d.ways.filter((w) => w.tags.barrier).length}, natural ${d.ways.filter((w) => w.tags.natural).length}, amenity areas ${d.ways.filter((w) => w.tags.amenity).length}`);
  out.push(`Tagged nodes ${d.nodes.length}`);
  out.push("Relations are not in the extract, so multipolygon buildings, areas with holes and route relations are missing by design.");
}

function sectionIntegrity(d, out) {
  out.push(`\n== 2. INTEGRITY, DUPLICATES AND SUSPICIOUS DATA ==`);
  const ids = new Set();
  let dupIds = 0;
  for (const w of d.ways) { if (ids.has(w.id)) dupIds++; ids.add(w.id); }
  out.push(`Duplicate way ids: ${dupIds}`);
  const geomSeen = new Map();
  const dupGeom = [];
  for (const w of d.ways) {
    const key = w.pts.join(",");
    const rev = [];
    for (let i = w.pts.length - 2; i >= 0; i -= 2) rev.push(w.pts[i], w.pts[i + 1]);
    const other = geomSeen.get(key) ?? geomSeen.get(rev.join(","));
    if (other) dupGeom.push([other, w]); else geomSeen.set(key, w);
  }
  out.push(`Ways with identical geometry to another way: ${dupGeom.length}` + (dupGeom.length ? " (first 8: " + dupGeom.slice(0, 8).map(([a, b]) => `${a.id} ${kindOf(a.tags)} / ${b.id} ${kindOf(b.tags)}`).join("; ") + ")" : ""));
  const b = d.buildings;
  const open = b.filter((w) => !w.closed);
  out.push(`Buildings not closed (cannot be used as footprints): ${open.length}` + (open.length ? ` e.g. ${open.slice(0, 6).map((w) => w.id).join(", ")}` : ""));
  const tiny = b.filter((w) => w.closed && w.area < 6);
  const huge = b.filter((w) => w.area > 20000);
  out.push(`Buildings under 6 m2: ${tiny.length}; over 20,000 m2: ${huge.length}`);
  for (const w of huge.slice(0, 10)) out.push(`  large: ${describe(w)}`);
  // Buildings whose centres coincide within 1 m: stacked or duplicated outlines.
  const grid = new Map();
  let stacked = 0;
  for (const w of b) {
    const k = `${Math.round(w.c[0])},${Math.round(w.c[1])}`;
    if (grid.has(k) && Math.abs(grid.get(k).area - w.area) < 0.05 * w.area + 1) stacked++; else grid.set(k, w);
  }
  out.push(`Buildings sharing a centre and size with another building (likely duplicates): ${stacked}`);
  const [S, W, N, E] = d.bbox;
  const outside = d.ways.filter((w) => { for (let i = 0; i < w.pts.length; i += 2) if (w.pts[i] < S || w.pts[i] > N || w.pts[i + 1] < W || w.pts[i + 1] > E) return true; return false; });
  out.push(`Ways extending beyond the bbox (full geometry is kept; they need clipping): ${outside.length}, of which roads ${outside.filter((w) => w.tags.highway).length}, landuse ${outside.filter((w) => w.tags.landuse).length}`);
  const longStraight = d.roads.filter((r) => r.xy.length === 2 && r.len > 800);
  out.push(`Roads drawn as a single straight segment longer than 800 m (may be schematic): ${longStraight.length}` + (longStraight.length ? ` e.g. ${longStraight.slice(0, 5).map((r) => `${r.id} ${r.tags.highway} ${Math.round(r.len)} m`).join("; ")}` : ""));
  const flagged = d.ways.filter((w) => w.tags.fixme || w.tags.FIXME || w.tags.note);
  out.push(`Ways carrying fixme or note tags from mappers: ${flagged.length}`);
  for (const w of flagged.slice(0, 8)) out.push(`  ${w.id} ${kindOf(w.tags)}: ${w.tags.fixme ?? w.tags.FIXME ?? w.tags.note}`);
  const lifecycle = d.ways.filter((w) => ["construction", "proposed"].includes(w.tags.highway) || w.tags.building === "construction" || w.tags.landuse === "construction");
  out.push(`Features tagged as under construction or proposed (may be out of date either way): ${lifecycle.length}`);
  const sources = tally(d.ways.filter((w) => w.tags.source), (w) => w.tags.source);
  out.push(`Source tags on ways: ${list(sources, 8)}`);
}

function sectionRoads(d, out) {
  out.push(`\n== 3. ROADS ==`);
  out.push("class | ways | km | named (by length) | lanes tag | oneway tag | width tag | maxspeed | surface");
  const classes = tally(d.roads, (r) => r.tags.highway).map(([k]) => k);
  for (const c of classes) {
    const rs = d.roads.filter((r) => r.tags.highway === c);
    const total = rs.reduce((s, r) => s + r.len, 0);
    const named = rs.filter((r) => r.tags.name).reduce((s, r) => s + r.len, 0);
    const has = (k) => pct(rs.filter((r) => r.tags[k] !== undefined).length, rs.length);
    out.push(`${c} | ${rs.length} | ${km(total)} | ${pct(named, total)} | ${has("lanes")} | ${has("oneway")} | ${has("width")} | ${has("maxspeed")} | ${has("surface")}`);
  }
  out.push(`Lanes values: ${list(tally(d.roads, (r) => r.tags.lanes))}`);
  out.push(`Bridges ${d.roads.filter((r) => r.tags.bridge).length}, tunnels ${d.roads.filter((r) => r.tags.tunnel).length}, layer-tagged ${d.roads.filter((r) => r.tags.layer).length}`);
  out.push(`Service road subtypes: ${list(tally(d.roads.filter((r) => r.tags.highway === "service"), (r) => r.tags.service ?? "(untyped)"))}`);
  out.push(`Private or restricted access roads (access=private/no/permissive/customers): ${d.roads.filter((r) => ["private", "no", "permissive", "customers", "residents"].includes(r.tags.access)).length}`);
  out.push(`Separately mapped footways ${d.roads.filter((r) => ["footway", "path", "pedestrian", "steps"].includes(r.tags.highway)).length}; roads with a sidewalk tag ${d.roads.filter((r) => r.tags.sidewalk).length}; cycleways ${d.roads.filter((r) => r.tags.highway === "cycleway").length}`);
  out.push("  (Medians are not a tag: a divided road shows up as two parallel one-way ways.)");
  const hn = (v) => d.nodes.filter((n) => n.tags.highway === v).length;
  out.push(`Nodes: traffic signals ${hn("traffic_signals")}, crossings ${hn("crossing")}, bus stops ${hn("bus_stop")}`);

  const rounds = d.roads.filter((r) => r.tags.junction === "roundabout" || r.tags.junction === "circular");
  out.push(`\nRoundabout ways ${rounds.length}:`);
  for (const r of rounds.slice(0, 40)) {
    const xs = r.xy.map((p) => p[0]), ys = r.xy.map((p) => p[1]);
    out.push(`  way ${r.id} ${r.tags.highway}${r.tags.name ? ` "${r.tags.name}"` : " (unnamed)"}, ${where(r.c)}, extent ${Math.round(Math.max(...xs) - Math.min(...xs))} x ${Math.round(Math.max(...ys) - Math.min(...ys))} m${r.closed ? "" : ", partial ring"}`);
  }

  const byName = new Map();
  for (const r of d.roads) {
    if (!r.tags.name) continue;
    const e = byName.get(r.tags.name) ?? { len: 0, classes: new Set(), ways: 0, ref: r.tags.ref };
    e.len += r.len; e.ways++; e.classes.add(r.tags.highway);
    byName.set(r.tags.name, e);
  }
  const names = [...byName].sort((a, b) => b[1].len - a[1].len);
  out.push(`\nDistinct road names ${names.length}. Longest 40 (length counts both carriageways where mapped separately):`);
  for (const [n, e] of names.slice(0, 40)) out.push(`  ${n}: ${km(e.len)} km in ${e.ways} ways, ${[...e.classes].join("/")}${e.ref ? `, ref ${e.ref}` : ""}`);
  const refs = tally(d.roads.filter((r) => r.tags.ref), (r) => r.tags.ref);
  out.push(`Road refs: ${list(refs, 15)}`);

  const near = d.roads.filter((r) => MAJOR.has(r.tags.highway) && distToLine([0, 0], r.xy) < 500);
  out.push(`\nMajor roads within 500 m of Pari Chowk (${near.length} ways):`);
  for (const [k, n] of tally(near, (r) => `${r.tags.name ?? "(unnamed)"} [${r.tags.highway}${r.tags.oneway === "yes" ? ", one-way" : ""}${r.tags.lanes ? `, lanes ${r.tags.lanes}` : ""}]`)) out.push(`  ${k}: ${n} ways`);
}

function sectionSectors(d, out) {
  out.push(`\n== 4. THE SIX RESIDENTIAL SECTORS ==`);
  for (const s of d.sectors) {
    if (!s.way) { out.push(`\n${s.label}: no named land-use polygon found`); continue; }
    const poly = s.way.xy;
    const inside = (f) => inPolygon(f.c, poly);
    const bs = d.buildings.filter(inside);
    const footprint = bs.reduce((a, b) => a + b.area, 0);
    out.push(`\n${s.label}: way ${s.way.id} landuse=${s.way.tags.landuse}, ${(s.way.area / 1e6).toFixed(2)} km2, centre ${where(s.way.c)}`);
    out.push(`  Buildings ${bs.length} (${Math.round(bs.length / (s.way.area / 1e6))} per km2), footprints cover ${pct(footprint, s.way.area)} of the sector; types: ${list(tally(bs, (b) => b.tags.building), 6)}`);
    out.push(`  Buildings with levels or height ${bs.filter((b) => b.tags["building:levels"] || b.tags.height).length}, with a name ${bs.filter((b) => nameOf(b.tags)).length}`);
    const rin = d.roads.filter((r) => r.xy.filter((p) => inPolygon(p, poly)).length > r.xy.length / 2);
    out.push(`  Roads inside: ${list(tally(rin, (r) => r.tags.highway), 8)}; ${km(rin.reduce((a, r) => a + r.len, 0))} km; named ${pct(rin.filter((r) => r.tags.name).length, rin.length)} of ways`);
    const border = d.roads.filter((r) => MAJOR.has(r.tags.highway) && !rin.includes(r) && r.xy.some((p) => distToLine(p, poly) < 45));
    out.push(`  Major roads along or touching the boundary (within 45 m): ${list(tally(border, (r) => `${r.tags.name ?? "(unnamed)"} [${r.tags.highway}]`), 10)}`);
    const parks = d.ways.filter((w) => (w.tags.leisure || w.tags.landuse === "grass" || w.tags.natural === "wood") && inside(w));
    out.push(`  Parks and green areas ${parks.length}, ${pct(parks.reduce((a, p) => a + p.area, 0), s.way.area)} of the sector; kinds: ${list(tally(parks, (p) => kindOf(p.tags)), 5)}`);
    const sub = d.landuse.filter((l) => l !== s.way && inside(l));
    out.push(`  Other land use inside: ${list(tally(sub, (l) => `${l.tags.landuse}${l.tags.name ? ` "${l.tags.name}"` : ""}`), 10)}`);
    const nn = d.nodes.filter(inside);
    out.push(`  Nodes: gates ${nn.filter((n) => n.tags.barrier).length}, shops ${nn.filter((n) => n.tags.shop).length}, amenities ${nn.filter((n) => n.tags.amenity).length}; barrier ways ${d.ways.filter((w) => w.tags.barrier && inside(w)).length}`);
  }
}

function sectionTargets(d, out) {
  out.push(`\n== 5. PLACES NOT FOUND BY SIMPLE NAME SEARCH ==`);

  out.push(`\n-- 5a. Knowledge Park I --`);
  const kp = findByTag(d, /knowledge\s*park|\bk\.?\s?p\.?[\s-]*(1|i|2|ii|3|iii)\b/i);
  const kpGroups = tally(kp, (h) => String(h.value).match(/knowledge\s*park[\s-]*([ivx\d]+)?/i)?.[0]?.replace(/\s+/g, " ").trim() ?? String(h.value));
  out.push(`Features with "Knowledge Park" or "KP n" in any tag value: ${kp.length}. By wording: ${list(kpGroups, 12)}`);
  const kp1 = kp.filter((h) => /knowledge\s*park[\s-]*(1|i)(?![\dvix])|\bk\.?\s?p\.?[\s-]*(1|i)\b/i.test(String(h.value)));
  out.push(`Of those, referring to Knowledge Park I / 1: ${kp1.length}`);
  for (const h of kp1.slice(0, 25)) out.push(`  ${describe(h.f)} [${h.key}=${h.value}]`);
  if (kp1.length === 0) out.push("  None. The area cannot be located from names or address tags in this extract.");
  const addr = tally([...d.ways, ...d.nodes].filter((f) => Object.keys(f.tags).some((k) => k.startsWith("addr:") || k === "is_in")), (f) => f.tags["addr:suburb"] ?? f.tags["addr:place"] ?? f.tags["addr:district"] ?? f.tags["addr:city"] ?? f.tags.is_in);
  out.push(`Address locality values in use: ${list(addr, 15)}`);
  const edu = d.ways.filter((w) => EDU.has(w.tags.amenity) || w.tags.landuse === "education" || ["university", "college", "school"].includes(w.tags.building));
  const eduNodes = d.nodes.filter((n) => EDU.has(n.tags.amenity));
  out.push(`Education features (context for where the institutional belt lies): ${edu.length} areas or buildings, ${eduNodes.length} nodes`);
  for (const f of [...edu].sort((a, b) => b.area - a.area).slice(0, 40)) out.push(`  ${describe(f)}`);
  for (const f of eduNodes.slice(0, 20)) out.push(`  ${describe(f)}`);
  out.push(`Education features by direction from Pari Chowk: ${list(tally([...edu, ...eduNodes], (f) => where(f.c).split(" ").at(-1)))}`);
  const inst = d.landuse.filter((l) => ["education", "institutional", "commercial", "industrial", "retail"].includes(l.tags.landuse));
  out.push(`Non-residential land-use polygons (${inst.length}):`);
  for (const l of inst.sort((a, b) => b.area - a.area).slice(0, 30)) out.push(`  ${describe(l)}`);

  out.push(`\n-- 5b. Jagat Farm --`);
  const jf = findByTag(d, /jagat/i);
  out.push(`Features with "jagat" in any tag value: ${jf.length}`);
  for (const h of jf.slice(0, 25)) out.push(`  ${describe(h.f)} [${h.key}=${h.value}]; sector: ${sectorAt(d, h.f.c) ?? "none of the six"}; road: ${nearestNamedRoad(d, h.f.c)}`);
  const commercial = [...d.ways, ...d.nodes].filter((f) => f.tags.shop || COMMERCIAL_BUILDING.has(f.tags.building) || ["commercial", "retail"].includes(f.tags.landuse) || ["marketplace", "bank", "restaurant", "fast_food", "cafe", "atm", "pharmacy", "fuel"].includes(f.tags.amenity));
  out.push(`Shop, commercial-building, market-amenity and commercial-landuse features in the whole extract: ${commercial.length}`);
  out.push(`  shop values: ${list(tally(commercial, (f) => f.tags.shop), 12)}`);
  // Clusters on a 200 m grid. These are counts of mapped features, not market boundaries.
  const cells = new Map();
  for (const f of commercial) {
    const k = `${Math.floor(f.c[0] / 200)},${Math.floor(f.c[1] / 200)}`;
    (cells.get(k) ?? cells.set(k, []).get(k)).push(f);
  }
  const clusters = [...cells.values()].filter((c) => c.length >= 3).sort((a, b) => b.length - a.length);
  out.push(`200 m grid cells holding 3 or more such features: ${clusters.length}. These show where mappers recorded commerce; they are not market outlines.`);
  for (const c of clusters.slice(0, 15)) {
    const mid = [c.reduce((s, f) => s + f.c[0], 0) / c.length, c.reduce((s, f) => s + f.c[1], 0) / c.length];
    const names = c.map((f) => nameOf(f.tags)).filter(Boolean);
    out.push(`  ${c.length} features ${where(mid)} (${geo(mid)}); sector: ${sectorAt(d, mid) ?? "none of the six"}; road: ${nearestNamedRoad(d, mid)}; buildings within 150 m: ${d.buildings.filter((b) => Math.hypot(b.c[0] - mid[0], b.c[1] - mid[1]) < 150).length}; names: ${names.slice(0, 6).join(" | ") || "none tagged"}`);
  }
  if (jf.length === 0) out.push("  No feature is named Jagat Farm, so its position cannot be taken from this extract. A person who knows the market must identify it (for example by OSM id or coordinates) before it is used.");

  out.push(`\n-- 5c. Knowledge Park II: station versus area --`);
  const transit = [...d.ways, ...d.nodes].filter((f) => f.tags.railway || f.tags.public_transport || f.tags.station);
  out.push(`Railway and transit features: ${list(tally(transit, (f) => kindOf(f.tags)), 12)}`);
  const stations = transit.filter((f) => ["station", "stop", "halt"].includes(f.tags.railway) || f.tags.public_transport === "station");
  out.push(`Named stations and stops: ${[...new Set(stations.map((s) => nameOf(s.tags)).filter(Boolean))].join(", ") || "none"}`);
  const kp2 = kp.filter((h) => /knowledge\s*park[\s-]*(2|ii)(?![\dvix])|\bk\.?\s?p\.?[\s-]*(2|ii)\b/i.test(String(h.value)));
  const isTransit = (f) => f.tags.railway || f.tags.public_transport || f.tags.highway === "bus_stop";
  out.push(`Features referring to Knowledge Park II / 2: ${kp2.length}; transit (station, platform, bus stop) ${kp2.filter((h) => isTransit(h.f)).length}; anything else ${kp2.filter((h) => !isTransit(h.f)).length}`);
  for (const h of kp2.slice(0, 20)) out.push(`  ${describe(h.f)} [${h.key}=${h.value}]`);
  const st = kp2.map((h) => h.f).find((f) => f.tags.railway === "station" || f.tags.public_transport === "station") ?? kp2[0]?.f;
  if (st) {
    const near = (f, r) => Math.hypot(f.c[0] - st.c[0], f.c[1] - st.c[1]) < r;
    out.push(`Within 1 km of the Knowledge Park II station (${where(st.c)}):`);
    out.push(`  buildings ${d.buildings.filter((b) => near(b, 1000)).length}; land use: ${list(tally(d.landuse.filter((l) => near(l, 1000)), (l) => `${l.tags.landuse}${l.tags.name ? ` "${l.tags.name}"` : ""}`), 10)}`);
    for (const f of [...edu, ...eduNodes].filter((f) => near(f, 1000)).slice(0, 15)) out.push(`  education: ${describe(f)}`);
    const namedB = d.buildings.filter((b) => near(b, 1000) && nameOf(b.tags));
    out.push(`  named buildings: ${namedB.slice(0, 15).map((b) => `"${nameOf(b.tags)}" (${b.tags.building}, ${Math.round(b.area)} m2)`).join("; ") || "none"}`);
  } else out.push("  No Knowledge Park II station found in the extract.");
  out.push("  A station name marks the stop only. No area outline for Knowledge Park II is implied unless a polygon is listed above.");
}

/** Evidence-based building classes. A building gets the first class whose evidence it has. */
export function classifyBuilding(b, ctx) {
  const t = b.tags;
  const levels = num(t["building:levels"]);
  const height = num(t.height);
  if (INSTITUTIONAL_BUILDING.has(t.building) || INSTITUTIONAL_AMENITY.has(t.amenity)) return ["institutional", "own tag"];
  if (COMMERCIAL_BUILDING.has(t.building) || t.shop || t.office) return ["commercial", "own tag"];
  if (t.building === "apartments") return ["residential tower or apartment block", "building=apartments"];
  if ((levels !== undefined && levels >= 5) || (height !== undefined && height >= 15)) return ["tall building (use unknown)", "levels or height tag"];
  if (["industrial", "warehouse", "factory"].includes(t.building)) return ["industrial", "own tag"];
  const zone = ctx.zones.find((z) => inPolygon(b.c, z.xy));
  if (zone?.kind === "institutional") return ["institutional", `inside ${zone.label}`];
  if (zone?.kind === "commercial") return ["commercial", `inside ${zone.label}`];
  if (HOUSE_BUILDING.has(t.building)) return ["house or low-rise residential", "own tag"];
  if (zone?.kind === "residential" && b.area >= 400) return ["UNCONFIRMED: large footprint in residential land (tower, block or other)", "size and land use only"];
  if (zone?.kind === "residential") return ["UNCONFIRMED: small footprint in residential land (probably a house)", "size and land use only"];
  return ["unclassified (building=yes, no supporting evidence)", "none"];
}

function sectionBuildings(d, out) {
  out.push(`\n== 6. BUILDINGS ==`);
  const b = d.buildings.filter((w) => w.closed);
  out.push(`Closed footprints ${b.length}. building= values: ${list(tally(b, (w) => w.tags.building), 20)}`);
  out.push(`With building:levels ${b.filter((w) => w.tags["building:levels"]).length} (${pct(b.filter((w) => w.tags["building:levels"]).length, b.length)}); with height ${b.filter((w) => w.tags.height).length}; with name ${b.filter((w) => nameOf(w.tags)).length}; with addr:* ${b.filter((w) => Object.keys(w.tags).some((k) => k.startsWith("addr:"))).length}`);
  out.push(`Levels values: ${list(tally(b, (w) => w.tags["building:levels"]).sort((x, y) => num(x[0]) - num(y[0])), 30)}`);
  out.push("Heights are therefore unknown for every building without those tags; any height used later is an estimate.");
  const buckets = [[0, 25], [25, 60], [60, 120], [120, 250], [250, 500], [500, 1000], [1000, 2500], [2500, 10000], [10000, Infinity]];
  out.push("Footprint area: " + buckets.map(([lo, hi]) => `${lo}-${hi === Infinity ? "up" : hi} m2: ${b.filter((w) => w.area >= lo && w.area < hi).length}`).join("; "));
  const areas = b.map((w) => w.area).sort((x, y) => x - y);
  const q = (p) => Math.round(areas[Math.floor(p * (areas.length - 1))] ?? 0);
  out.push(`Area median ${q(0.5)} m2, 10th percentile ${q(0.1)}, 90th ${q(0.9)}, largest ${q(1)}`);
  const verts = tally(b, (w) => { const n = w.xy.length - 1; return n === 4 ? "4 corners" : n <= 6 ? "5-6" : n <= 12 ? "7-12" : "13 or more"; });
  out.push(`Outline complexity: ${list(verts)}`);
  const compact = b.filter((w) => w.len > 0 && (4 * Math.PI * w.area) / (w.len * w.len) < 0.35).length;
  out.push(`Long or irregular outlines (compactness under 0.35, e.g. row blocks, L and U shapes): ${compact}`);

  const zones = [];
  for (const l of d.landuse.filter((w) => w.closed)) {
    const k = l.tags.landuse;
    const kind = k === "residential" ? "residential" : ["commercial", "retail"].includes(k) ? "commercial" : ["education", "institutional"].includes(k) ? "institutional" : null;
    if (kind) zones.push({ kind, xy: l.xy, area: l.area, label: `landuse=${k}${l.tags.name ? ` "${l.tags.name}"` : ""}` });
  }
  for (const a of d.ways.filter((w) => w.closed && !w.tags.building && INSTITUTIONAL_AMENITY.has(w.tags.amenity)))
    zones.push({ kind: "institutional", xy: a.xy, area: a.area, label: `amenity=${a.tags.amenity}${a.tags.name ? ` "${a.tags.name}"` : ""}` });
  zones.sort((x, y) => x.area - y.area); // smallest enclosing zone wins
  const classes = new Map();
  for (const w of b) {
    const [cls, why] = classifyBuilding(w, { zones });
    const e = classes.get(cls) ?? { n: 0, area: 0, why: new Map(), items: [] };
    e.n++; e.area += w.area; e.why.set(why.startsWith("inside") ? "inside a tagged area" : why, (e.why.get(why.startsWith("inside") ? "inside a tagged area" : why) ?? 0) + 1); e.items.push(w);
    classes.set(cls, e);
  }
  out.push("\nClassification by evidence (first matching rule; UNCONFIRMED rows are guesses from size and land use and must not be presented as fact):");
  for (const [cls, e] of [...classes].sort((x, y) => y[1].n - x[1].n))
    out.push(`  ${cls}: ${e.n} (${pct(e.n, b.length)}), median ${Math.round(e.items.map((w) => w.area).sort((x, y) => x - y)[Math.floor(e.items.length / 2)])} m2; evidence: ${list([...e.why].sort((x, y) => y[1] - x[1]), 4)}`);
  for (const cls of ["residential tower or apartment block", "tall building (use unknown)", "commercial", "institutional"]) {
    const e = classes.get(cls);
    if (!e) continue;
    const named = e.items.filter((w) => nameOf(w.tags)).sort((x, y) => y.area - x.area);
    out.push(`  Named ${cls} (${named.length}): ${named.slice(0, 25).map((w) => `"${nameOf(w.tags)}" ${where(w.c)}`).join("; ") || "none"}`);
  }

  // Distribution on a 500 m grid, north at the top.
  const [S, W, N, E] = d.bbox;
  const x0 = (W - ORIGIN.lon) * M_LON, y0 = (S - ORIGIN.lat) * M_LAT;
  const cols = Math.ceil(((E - W) * M_LON) / 500), rows = Math.ceil(((N - S) * M_LAT) / 500);
  const cell = (f) => [Math.floor((f.c[0] - x0) / 500), Math.floor((f.c[1] - y0) / 500)];
  const bg = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const rg = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (const w of b) { const [cx, cy] = cell(w); if (bg[cy]?.[cx] !== undefined) bg[cy][cx]++; }
  for (const r of d.roads) if (["residential", "living_street", "service", "unclassified"].includes(r.tags.highway)) { const [cx, cy] = cell(r); if (rg[cy]?.[cx] !== undefined) rg[cy][cx] += r.len; }
  out.push(`\nBuildings per 500 m cell (north at top, west at left; P marks the Pari Chowk cell; "!" marks cells with over 1 km of local streets but fewer than 5 buildings, where footprints are probably unmapped):`);
  const [pcx, pcy] = [Math.floor(-x0 / 500), Math.floor(-y0 / 500)];
  let unmapped = 0, empty = 0;
  for (let r = rows - 1; r >= 0; r--) {
    out.push("  " + bg[r].map((n, c) => {
      const flag = rg[r][c] > 1000 && n < 5;
      if (flag) unmapped++;
      if (n === 0) empty++;
      return (String(n) + (flag ? "!" : r === pcy && c === pcx ? "P" : "")).padStart(5);
    }).join(""));
  }
  out.push(`Cells: ${rows * cols}; with no building ${empty}; flagged as streets without footprints ${unmapped}`);
}

function sectionSociety(d, out) {
  out.push(`\n== 7. BARRIERS, GATES, ENTRANCES AND OTHER DETAIL ==`);
  const bw = d.ways.filter((w) => w.tags.barrier);
  out.push(`Barrier ways ${bw.length}: ` + (tally(bw, (w) => w.tags.barrier).map(([k, n]) => `${k} ${n} (${km(bw.filter((w) => w.tags.barrier === k).reduce((s, w) => s + w.len, 0))} km)`).join(", ") || "none"));
  out.push(`Barrier nodes: ${list(tally(d.nodes, (n) => n.tags.barrier))}`);
  out.push(`Entrance nodes: ${list(tally(d.nodes, (n) => n.tags.entrance))}`);
  out.push("  The extract only requested barrier=gate nodes, plus nodes tagged place, amenity, shop, station, tree, signals, bus stop or crossing. Lift gates, bollards and entrance=* nodes were not requested, so zero here means not downloaded.");
  const gates = d.nodes.filter((n) => n.tags.barrier);
  out.push(`Gates by sector: ${list(tally(gates, (n) => sectorAt(d, n.c) ?? "outside the six sectors"))}`);
  const gateOnRoad = gates.filter((g) => d.roads.some((r) => Math.hypot(r.c[0] - g.c[0], r.c[1] - g.c[1]) < r.len + 5 && distToLine(g.c, r.xy) < 3)).length;
  out.push(`Gates lying on a mapped road (usable as real entrance positions): ${gateOnRoad} of ${gates.length}`);
  out.push(`Amenity nodes: ${list(tally(d.nodes, (n) => n.tags.amenity), 25)}`);
  out.push(`Shop nodes: ${list(tally(d.nodes, (n) => n.tags.shop), 20)}`);
  out.push(`Place nodes: ${d.nodes.filter((n) => n.tags.place).map((n) => `${n.tags.name ?? "(unnamed)"} [${n.tags.place}] ${where(n.c)}`).join("; ") || "none"}`);
  out.push(`Tree nodes ${d.nodes.filter((n) => n.tags.natural === "tree").length}; tree rows ${d.ways.filter((w) => w.tags.natural === "tree_row").length}; nodes with a name ${d.nodes.filter((n) => nameOf(n.tags)).length}`);
  const soc = d.ways.filter((w) => w.closed && nameOf(w.tags) && !d.sectors.some((s) => s.way === w) && (w.tags.landuse === "residential" || w.tags.residential || w.tags.place));
  out.push(`\nNamed residential areas other than the six sectors (${soc.length}). Names are as mapped in OSM; whether each is a gated society is not stated by the data unless a tag says so:`);
  for (const w of soc.sort((a, b) => b.area - a.area).slice(0, 40)) {
    const bs = d.buildings.filter((b) => inPolygon(b.c, w.xy));
    const g = gates.filter((n) => inPolygon(n.c, w.xy) || distToLine(n.c, w.xy) < 15).length;
    const wall = bw.filter((x) => x.xy.some((p) => distToLine(p, w.xy) < 10)).length;
    out.push(`  "${nameOf(w.tags)}" way ${w.id}${w.tags.residential ? ` residential=${w.tags.residential}` : ""}, ${(w.area / 1e4).toFixed(1)} ha, ${where(w.c)}; buildings ${bs.length} (apartments ${bs.filter((b) => b.tags.building === "apartments").length}); gates ${g}; barrier ways on outline ${wall}; inside sector: ${sectorAt(d, w.c) ?? "none of the six"}`);
  }
  const leisure = d.ways.filter((w) => w.tags.leisure);
  out.push(`Leisure areas: ${list(tally(leisure, (w) => w.tags.leisure))}; named ${leisure.filter((w) => nameOf(w.tags)).length}`);
  out.push(`Parking areas (amenity=parking) ${d.ways.filter((w) => w.tags.amenity === "parking").length}; water ${d.ways.filter((w) => w.tags.natural === "water").length}`);
}

function sectionGaps(d, out) {
  out.push(`\n== 8. COVERAGE GAPS FOUND AUTOMATICALLY ==`);
  const g = [];
  for (const s of d.sectors) {
    if (!s.way) { g.push(`${s.label}: no outline in the extract.`); continue; }
    const bs = d.buildings.filter((b) => inPolygon(b.c, s.way.xy));
    const cover = bs.reduce((a, b) => a + b.area, 0) / s.way.area;
    if (cover < 0.08) g.push(`${s.label}: footprints cover only ${Math.round(cover * 100)}% of the sector (${bs.length} buildings); most plots are probably unmapped.`);
  }
  const b = d.buildings;
  g.push(`${pct(b.filter((w) => w.tags.building === "yes").length, b.length)} of buildings are tagged only building=yes, so their use is unknown.`);
  g.push(`${pct(b.filter((w) => w.tags["building:levels"] || w.tags.height).length, b.length)} of buildings have a levels or height tag.`);
  const major = d.roads.filter((r) => MAJOR.has(r.tags.highway));
  g.push(`${pct(major.filter((r) => r.tags.lanes).length, major.length)} of major road ways have a lanes tag; ${pct(major.filter((r) => r.tags.name).length, major.length)} have a name.`);
  const local = d.roads.filter((r) => ["residential", "living_street", "unclassified"].includes(r.tags.highway));
  g.push(`${pct(local.filter((r) => r.tags.name).length, local.length)} of local street ways have a name.`);
  if (!findByTag(d, /jagat/i).length) g.push("Jagat Farm: not present under that name.");
  if (!findByTag(d, /knowledge\s*park[\s-]*(1|i)(?![\dvix])/i).length) g.push("Knowledge Park I: not present under that name.");
  if (!d.landuse.some((l) => /knowledge\s*park[\s-]*(2|ii)(?![\dvix])/i.test(nameOf(l.tags) ?? ""))) g.push("Knowledge Park II: no area outline with that name (station only, if listed in 5c).");
  g.push("Relations, entrance nodes, lift gates, bollards, street lamps and building parts were not downloaded.");
  for (const line of g) out.push(`- ${line}`);
}

export function audit(raw) {
  const d = prepare(raw);
  d.roads = d.ways.filter((w) => w.tags.highway);
  d.buildings = d.ways.filter((w) => w.tags.building);
  d.landuse = d.ways.filter((w) => w.tags.landuse);
  d.sectors = SECTORS.map(([label, re]) => ({
    label,
    way: d.ways.filter((w) => w.closed && w.tags.landuse && NAME_KEYS.some((k) => re.test(w.tags[k] ?? ""))).sort((a, b) => b.area - a.area)[0],
  }));
  const out = [];
  for (const section of [sectionDataset, sectionIntegrity, sectionRoads, sectionSectors, sectionTargets, sectionBuildings, sectionSociety, sectionGaps]) section(d, out);
  return out.join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const file = arg("--file") ?? resolve(root, "data/osm/greater-noida-corridor.json");
  let raw;
  try {
    raw = JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    console.error(`Cannot read ${file}: ${err.message}\nRun "node tools/fetch-osm.mjs" first.`);
    process.exit(1);
  }
  if (arg("--find")) {
    const hits = findByTag(prepare(raw), new RegExp(arg("--find"), "i"));
    console.log(`${hits.length} features match /${arg("--find")}/i`);
    for (const h of hits.slice(0, 200)) console.log(`${describe(h.f)} [${h.key}=${h.value}]`);
  } else {
    const text = audit(raw);
    console.log(text);
    if (arg("--out")) {
      await writeFile(arg("--out"), text + "\n");
      console.error(`\nReport written to ${arg("--out")}`);
    }
  }
}
