/**
 * Coordinate validation for an extract. Reports; never changes the data.
 *
 * Two different things used to be mixed under one "INVALID coordinates" count:
 *   malformed  - a value that cannot be a coordinate (missing, not a number,
 *                latitude beyond +-90, longitude beyond +-180). A data fault.
 *   farReaching - a valid coordinate far from the region. Overpass returns the
 *                whole geometry of every way that touches the bbox, so a long
 *                power line, canal, railway or boundary legitimately has
 *                vertices tens of kilometres away. Not a fault; it is clipped.
 */
const summary = (tags) =>
  ["highway", "railway", "power", "waterway", "boundary", "landuse", "natural", "building", "barrier", "man_made"]
    .filter((k) => tags?.[k]).map((k) => `${k}=${tags[k]}`).join(" ") || (tags && Object.keys(tags).length ? Object.keys(tags)[0] : "untagged");

const bad = (lat, lon) => !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180;

export function validateCoordinates(data, { farDegrees = 0.5 } = {}) {
  const [S, W, N, E] = data.bbox;
  const far = (lat, lon) => lat < S - farDegrees || lat > N + farDegrees || lon < W - farDegrees || lon > E + farDegrees;
  /** The crude window the first validator used, kept so old reports can be matched. */
  const legacy = (lat, lon) => lat < 28 || lat > 29 || lon < 77 || lon > 78;
  const malformed = [], farReaching = [], legacyWindow = [];
  let nodesOutsideBbox = 0, oddLengthWays = 0;

  const scanWay = (type, id, tags, pts, via) => {
    if (pts.length % 2) { oddLengthWays++; malformed.push({ type, id, via, problem: "odd number of coordinate values", coordinate: null }); }
    let worst = null, firstLegacy = null, minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
    for (let i = 0; i + 1 < pts.length; i += 2) {
      const lat = pts[i], lon = pts[i + 1];
      if (bad(lat, lon)) { malformed.push({ type, id, via, problem: "not a valid coordinate", index: i / 2, coordinate: [lat, lon] }); continue; }
      minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat); minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
      if (!firstLegacy && legacy(lat, lon)) firstLegacy = { index: i / 2, coordinate: [lat, lon] };
      if (far(lat, lon)) {
        const km = Math.hypot((lat - (S + N) / 2) * 110.8, (lon - (W + E) / 2) * 97.9);
        if (!worst || km > worst.km) worst = { index: i / 2, coordinate: [lat, lon], km: Math.round(km) };
      }
    }
    const extent = { minLat, maxLat, minLon, maxLon };
    const entry = { type, id, via, tags: summary(tags), name: tags?.name ?? null, points: pts.length / 2, extent };
    if (worst) farReaching.push({ ...entry, farthest: worst });
    if (firstLegacy) legacyWindow.push({ ...entry, first: firstLegacy });
  };

  for (const w of data.ways) scanWay("way", w.id, w.tags, w.pts);
  for (const n of data.nodes) {
    if (bad(n.lat, n.lon)) malformed.push({ type: "node", id: n.id, problem: "not a valid coordinate", coordinate: [n.lat, n.lon] });
    else {
      if (n.lat < S || n.lat > N || n.lon < W || n.lon > E) nodesOutsideBbox++;
      if (legacy(n.lat, n.lon)) legacyWindow.push({ type: "node", id: n.id, tags: summary(n.tags), name: n.tags?.name ?? null, first: { coordinate: [n.lat, n.lon] } });
    }
  }
  for (const r of data.relations ?? [])
    for (const m of r.members ?? [])
      if (m.type === "way" && m.pts?.length) scanWay("relation member way", m.ref, r.tags, m.pts, `relation ${r.id}`);

  return { malformed, farReaching, legacyWindow, nodesOutsideBbox, oddLengthWays };
}

export function formatValidation(v) {
  const out = [];
  const c = (x) => (x ? `${x[0]}, ${x[1]}` : "n/a");
  out.push(`Malformed coordinates (data faults): ${v.malformed.length}`);
  for (const m of v.malformed.slice(0, 50)) out.push(`  ${m.type} ${m.id}${m.via ? ` in ${m.via}` : ""}: ${m.problem}${m.index !== undefined ? ` at point ${m.index}` : ""}, value ${c(m.coordinate)}`);
  out.push(`Elements with a point outside the old 28-29 N / 77-78 E window: ${v.legacyWindow.length}`);
  for (const f of v.legacyWindow.slice(0, 50)) {
    out.push(`  ${f.type} ${f.id}${f.via ? ` in ${f.via}` : ""} [${f.tags}]${f.name ? ` "${f.name}"` : ""}: first such point${f.first.index !== undefined ? ` #${f.first.index}` : ""} at ${c(f.first.coordinate)}` +
      (f.extent ? `; ${f.points} points spanning lat ${f.extent.minLat}..${f.extent.maxLat}, lon ${f.extent.minLon}..${f.extent.maxLon}` : ""));
    out.push(`    https://www.openstreetmap.org/${f.type === "node" ? "node" : "way"}/${f.id}`);
  }
  out.push(`Valid features reaching more than 0.5 degrees beyond the bbox (long ways; clipped by the pipeline): ${v.farReaching.length}`);
  for (const f of v.farReaching.slice(0, 50)) out.push(`  ${f.type} ${f.id}${f.via ? ` in ${f.via}` : ""} [${f.tags}]${f.name ? ` "${f.name}"` : ""}: farthest point ${c(f.farthest.coordinate)}, about ${f.farthest.km} km from the region centre`);
  out.push(`Tagged nodes outside the bbox: ${v.nodesOutsideBbox}`);
  out.push(
    v.malformed.length
      ? "Verdict: malformed values exist. They are left in the extract and skipped by the pipeline; review the ids above."
      : v.legacyWindow.length
        ? "Verdict: no malformed data. The old check counted valid points of long features as INVALID, which was a validator fault. Those features are legitimate and are clipped to the region."
        : "Verdict: all coordinates are valid and near the region.",
  );
  return out.join("\n");
}
