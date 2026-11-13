#!/usr/bin/env node
/**
 * Draws the converted layers as a 2D map for checking coverage by eye.
 *
 *   node tools/build-layers.mjs
 *   node tools/render-coverage.mjs            -> data/region/greater-noida/coverage.html
 *
 * Open the HTML file in a browser: tick layers on and off, scroll to zoom,
 * drag to pan, hover a shape to see its OSM id. Only source geometry is drawn.
 * Cells marked as missing coverage are left empty; nothing is filled in.
 *
 * Data © OpenStreetMap contributors, ODbL 1.0.
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
// SVG y grows downward; north (+z) must be up, so z is negated.
const pt = ([x, z]) => `${x},${-z}`;
const path = (ring) => `M${ring.map(pt).join("L")}Z`;
const polyPath = (g) => (g.polygons ?? []).map((p) => [p.outer, ...p.holes].map(path).join("")).join("");
const SECTOR = /^(alpha|beta|gamma|delta|omega|omicron|zeta|eta|mu|chi|phi|pi|sigma|xu|rho|tau|swarn|sector)\b/i;
const ROAD_STYLE = { motorway: ["#c0392b", 14], trunk: ["#d35400", 12], primary: ["#e67e22", 10], secondary: ["#f1c40f", 8], tertiary: ["#7f8c8d", 6], residential: ["#95a5a6", 3.5], unclassified: ["#95a5a6", 3.5], living_street: ["#95a5a6", 3], service: ["#bdc3c7", 2] };

export function renderCoverage(manifest, layers) {
  const b = manifest.bounds;
  const W = b.maxX - b.minX, H = b.maxZ - b.minZ;
  const g = [];
  const group = (id, label, body, on = true) => g.push({ id, label, on, body });
  const title = (f, extra = "") => `<title>${esc(f.id)}${f.tags?.name ? ` "${esc(f.tags.name)}"` : ""}${extra ? ` ${esc(extra)}` : ""}</title>`;

  const cov = { "streets-without-footprints": "#e74c3c", "nothing-mapped": "#8e44ad", sparse: "#f39c12" };
  group("coverage", "Missing coverage (red: streets but no footprints; purple: nothing mapped; orange: sparse)",
    layers.coverage.filter((c) => cov[c.status]).map((c) => `<rect x="${c.bounds.minX}" y="${-c.bounds.maxZ}" width="${c.bounds.maxX - c.bounds.minX}" height="${c.bounds.maxZ - c.bounds.minZ}" fill="${cov[c.status]}" fill-opacity="0.22"><title>${c.id}: ${c.status}; buildings ${c.buildings}; local streets ${c.localStreetMetres} m</title></rect>`).join(""));

  const areaFill = (f) => f.tags.landuse === "residential" ? "#ecf0f1" : ["commercial", "retail"].includes(f.tags.landuse) ? "#fadbd8" : f.tags.landuse === "industrial" ? "#e8daef" : f.tags.landuse === "education" || ["college", "university", "school"].includes(f.tags.amenity) ? "#d6eaf8" : f.tags.leisure || ["grass", "forest", "meadow"].includes(f.tags.landuse) || f.tags.natural === "wood" ? "#d5f5e3" : f.tags.natural === "water" ? "#aed6f1" : "#f4f6f7";
  const areas = layers.areas.filter((f) => f.geometry.polygons).sort((x, y) => y.derived.area - x.derived.area);
  group("areas", "Land use and leisure areas", areas.map((f) => `<path d="${polyPath(f.geometry)}" fill="${areaFill(f)}" fill-rule="evenodd" stroke="#b2babb" stroke-width="0.6">${title(f, Object.entries(f.tags).filter(([k]) => ["landuse", "leisure", "natural", "amenity"].includes(k)).map(([k, v]) => `${k}=${v}`).join(" "))}</path>`).join(""));

  const sectors = areas.filter((f) => f.tags.landuse === "residential" && f.tags.name && SECTOR.test(f.tags.name));
  group("sectors", "Sector boundaries (named residential land use)", sectors.map((f) => `<path d="${polyPath(f.geometry)}" fill="none" stroke="#1f618d" stroke-width="5" stroke-dasharray="18 10">${title(f)}</path><text x="${f.derived.centre[0]}" y="${-f.derived.centre[1]}" font-size="60" text-anchor="middle" fill="#1f618d" font-weight="bold">${esc(f.tags.name)}</text>`).join(""));

  group("rail", "Railway and metro", layers.rail.map((f) => f.geometry.points ? `<polyline points="${f.geometry.points.map(pt).join(" ")}" fill="none" stroke="#6c3483" stroke-width="5" stroke-dasharray="14 7">${title(f, `railway=${f.tags.railway}`)}</polyline>` : f.geometry.polygons ? `<path d="${polyPath(f.geometry)}" fill="#bb8fce" stroke="#6c3483" stroke-width="1">${title(f)}</path>` : `<rect x="${f.geometry.point[0] - 9}" y="${-f.geometry.point[1] - 9}" width="18" height="18" fill="#6c3483">${title(f)}</rect>`).join(""));

  const roads = layers.roads.slice().sort((x, y) => (ROAD_STYLE[x.source.class.replace(/_link$/, "")]?.[1] ?? 1) - (ROAD_STYLE[y.source.class.replace(/_link$/, "")]?.[1] ?? 1));
  group("roads", "Roads (colour and width by class; dashed = footways and paths)", roads.map((f) => {
    const [colour, width] = ROAD_STYLE[f.source.class.replace(/_link$/, "")] ?? ["#aab7b8", 1.5];
    return `<polyline points="${f.geometry.points.map(pt).join(" ")}" fill="none" stroke="${f.kind === "not-built" ? "#e8b4b8" : colour}" stroke-width="${f.kind === "path" ? 1.2 : width}" ${f.kind === "path" ? 'stroke-dasharray="4 3"' : ""} stroke-linecap="round">${title(f, `${f.source.class}${f.source.lanes ? ` lanes ${f.source.lanes}` : ""}${f.clipped ? " (clipped)" : ""}`)}</polyline>`;
  }).join(""));

  const wayB = layers.buildings.filter((f) => f.osm.type === "way");
  const relB = layers.buildings.filter((f) => f.osm.type === "relation");
  group("buildings", "Building footprints (ways)", wayB.map((f) => `<path d="${polyPath(f.geometry)}" fill="#566573" stroke="#212f3c" stroke-width="0.3">${title(f, `building=${f.tags.building}${f.source.levels ? ` levels ${f.source.levels}` : ""}`)}</path>`).join(""));
  group("relations", "Relation footprints (blue; red outline = incomplete, drawn as source lines only)", relB.map((f) => f.geometry.polygons
    ? `<path d="${polyPath(f.geometry)}" fill="#2e86c1" fill-rule="evenodd" stroke="${f.incomplete ? "#e74c3c" : "#1b4f72"}" stroke-width="${f.incomplete ? 2 : 0.6}">${title(f, f.incomplete ? `INCOMPLETE: ${f.incompleteReasons.join("; ")}` : "")}</path>${(f.openOutlines ?? []).map((l) => `<polyline points="${l.map(pt).join(" ")}" fill="none" stroke="#e74c3c" stroke-width="2"/>`).join("")}`
    : f.geometry.lines.map((l) => `<polyline points="${l.map(pt).join(" ")}" fill="none" stroke="#e74c3c" stroke-width="2">${title(f, `INCOMPLETE: ${f.incompleteReasons.join("; ")}`)}</polyline>`).join("")).join(""));
  group("parts", "Building parts", layers.buildingParts.map((f) => `<path d="${polyPath(f.geometry)}" fill="none" stroke="#af7ac5" stroke-width="0.8">${title(f)}</path>`).join(""), false);

  group("barriers", "Walls and fences", layers.barriers.filter((f) => f.geometry.points).map((f) => `<polyline points="${f.geometry.points.map(pt).join(" ")}" fill="none" stroke="#784212" stroke-width="1.2">${title(f, `barrier=${f.tags.barrier}`)}</polyline>`).join(""));
  group("gates", "Gates and entrances", layers.barriers.filter((f) => f.geometry.point).map((f) => `<circle cx="${f.geometry.point[0]}" cy="${-f.geometry.point[1]}" r="7" fill="#f39c12" stroke="#000" stroke-width="1">${title(f, f.tags.barrier ? `barrier=${f.tags.barrier}` : `entrance=${f.tags.entrance}`)}</circle>`).join(""));
  group("pois", "Points of interest (green = commercial, blue = other)", layers.pois.map((f) => `<circle cx="${f.geometry.point[0]}" cy="${-f.geometry.point[1]}" r="5" fill="${f.commercial ? "#27ae60" : "#3498db"}" stroke="#fff" stroke-width="0.8">${title(f, `${f.category}=${f.source.kind ?? ""}`)}</circle>`).join(""));
  group("furniture", "Street furniture (lamps, signals, crossings, bus stops)", layers.furniture.map((f) => `<circle cx="${f.geometry.point[0]}" cy="${-f.geometry.point[1]}" r="3.5" fill="#f7dc6f" stroke="#7d6608" stroke-width="0.6">${title(f, f.source.kind)}</circle>`).join(""), false);

  const c = manifest.counts, d = manifest.detail;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>OPENROAD coverage: ${esc(manifest.region)}</title>
<style>body{margin:0;font:13px system-ui,sans-serif;display:flex;height:100vh}aside{width:330px;padding:12px;overflow:auto;background:#fafafa;border-right:1px solid #ccc}svg{flex:1;background:#fff;cursor:grab}label{display:block;margin:4px 0}h1{font-size:16px;margin:0 0 8px}p{margin:6px 0;color:#444}</style></head><body>
<aside><h1>Coverage: ${esc(manifest.region)}</h1>
<p>${Math.round(W)} m east-west by ${Math.round(H)} m north-south. North is up. Origin (0, 0) is at ${manifest.projection.origin.lat}, ${manifest.projection.origin.lon}.</p>
${g.map((x) => `<label><input type="checkbox" data-layer="${x.id}" ${x.on ? "checked" : ""}> ${esc(x.label)}</label>`).join("")}
<p>Roads ${c.roads} pieces (${d.roads.clippedPieces} clipped). Buildings ${c.buildings}: ${d.buildings.fromWays} ways, ${d.buildings.fromRelations} relations, ${d.buildings.incomplete} incomplete. Height known from source for ${d.buildings.heightFromSource}, from levels for ${d.buildings.heightFromLevels}, unknown for ${d.buildings.heightUnknown}.</p>
<p>Coverage cells: ${Object.entries(d.coverage).map(([k, v]) => `${k} ${v}`).join(", ")}. A cell with nothing mapped may be open land or may simply be unmapped; the data cannot tell which.</p>
<p>Source: ${esc(manifest.source.file ?? "")}, profile ${esc(manifest.source.profile)}, OSM snapshot ${esc(manifest.source.osmBase ?? "")}.</p>
<p><b>${esc(manifest.attribution)}</b></p></aside>
<svg id="map" viewBox="${b.minX} ${-b.maxZ} ${W} ${H}" preserveAspectRatio="xMidYMid meet">
<rect x="${b.minX}" y="${-b.maxZ}" width="${W}" height="${H}" fill="none" stroke="#000" stroke-width="4"/>
${g.map((x) => `<g id="layer-${x.id}" ${x.on ? "" : 'style="display:none"'}>${x.body}</g>`).join("\n")}
<circle cx="0" cy="0" r="12" fill="none" stroke="#c0392b" stroke-width="3"><title>Origin: Pari Chowk</title></circle>
</svg>
<script>
for (const box of document.querySelectorAll("input[data-layer]")) box.onchange = () => { document.getElementById("layer-" + box.dataset.layer).style.display = box.checked ? "" : "none"; };
const svg = document.getElementById("map"); let vb = svg.getAttribute("viewBox").split(" ").map(Number), drag = null;
const set = () => svg.setAttribute("viewBox", vb.join(" "));
svg.onwheel = (e) => { e.preventDefault(); const k = e.deltaY > 0 ? 1.2 : 1 / 1.2, r = svg.getBoundingClientRect(); const px = vb[0] + ((e.clientX - r.left) / r.width) * vb[2], py = vb[1] + ((e.clientY - r.top) / r.height) * vb[3]; vb = [px - (px - vb[0]) * k, py - (py - vb[1]) * k, vb[2] * k, vb[3] * k]; set(); };
svg.onmousedown = (e) => { drag = [e.clientX, e.clientY]; }; window.onmouseup = () => { drag = null; };
svg.onmousemove = (e) => { if (!drag) return; const r = svg.getBoundingClientRect(), s = Math.max(vb[2] / r.width, vb[3] / r.height); vb[0] -= (e.clientX - drag[0]) * s; vb[1] -= (e.clientY - drag[1]) * s; drag = [e.clientX, e.clientY]; set(); };
</script></body></html>`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const dir = resolve(arg("--dir") ?? resolve(dirname(fileURLToPath(import.meta.url)), "../data/region/greater-noida"));
  try {
    const manifest = JSON.parse(await readFile(resolve(dir, "manifest.json"), "utf8"));
    const layers = {};
    for (const name of Object.keys(manifest.counts)) layers[name] = JSON.parse(await readFile(resolve(dir, `${name}.json`), "utf8")).features;
    const out = resolve(arg("--out") ?? resolve(dir, "coverage.html"));
    const html = renderCoverage(manifest, layers);
    await writeFile(out, html);
    console.log(`Wrote ${out} (${(html.length / 1e6).toFixed(1)} MB). Open it in a browser.`);
  } catch (err) {
    console.error(`render-coverage failed: ${err.message}\nRun "node tools/build-layers.mjs" first.`);
    process.exit(1);
  }
}
