/**
 * Builds polygons from the member ways of a multipolygon relation.
 * Nothing is invented: a chain of ways that does not close is reported as
 * open and is never closed artificially.
 */
import { pointInRing, ringArea } from "./clip.mjs";

const same = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.05;

/** Joins lines end to end. Returns { rings, open } where open holds unclosed chains. */
export function joinRings(lines) {
  const chains = lines.filter((l) => l.length >= 2).map((l) => l.slice());
  const rings = [], open = [];
  while (chains.length) {
    let cur = chains.pop();
    for (let grew = true; grew && !(cur.length > 2 && same(cur[0], cur.at(-1))); ) {
      grew = false;
      for (let i = 0; i < chains.length; i++) {
        const c = chains[i];
        if (same(cur.at(-1), c[0])) cur = cur.concat(c.slice(1));
        else if (same(cur.at(-1), c.at(-1))) cur = cur.concat(c.slice(0, -1).reverse());
        else if (same(cur[0], c.at(-1))) cur = c.concat(cur.slice(1));
        else if (same(cur[0], c[0])) cur = c.slice().reverse().concat(cur.slice(1));
        else continue;
        chains.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (cur.length >= 4 && same(cur[0], cur.at(-1))) {
      cur[cur.length - 1] = cur[0];
      rings.push(cur);
    } else open.push(cur);
  }
  return { rings, open };
}

/**
 * @param relation  { id, tags, clipped, members: [{ type, ref, role, pts }] }
 * @param wayLines  Map of way id -> projected line, for ways present in the extract (full geometry)
 * @param project   (flat lat/lon list) -> projected line, used for member geometry not in wayLines
 * @returns {
 *   polygons: [{ outer, holes }],   closed outlines with their courtyards
 *   openOutlines: [line],           chains that do not close (kept as lines only)
 *   missingMembers: [way ids],      members with no geometry in the extract
 *   orphanHoles: number,            inner rings not inside any outer ring
 *   incomplete: boolean, reasons: [string]
 * }
 */
export function assembleRelation(relation, wayLines, project) {
  const outerLines = [], innerLines = [], missingMembers = [], reasons = [];
  let partial = 0;
  for (const m of relation.members ?? []) {
    if (m.type !== "way") continue;
    let line = wayLines.get(m.ref);
    if (!line && m.pts && m.pts.length >= 4) {
      line = project(m.pts);
      // Geometry carried only inside the relation was cut at the extract boundary.
      if (relation.clipped) partial++;
    }
    if (!line) { missingMembers.push(m.ref); continue; }
    (m.role === "inner" ? innerLines : outerLines).push(line);
  }
  const outer = joinRings(outerLines);
  const inner = joinRings(innerLines);
  const polygons = outer.rings.map((ring) => ({ outer: ring, holes: [] }));
  let orphanHoles = 0;
  for (const hole of inner.rings) {
    const host = polygons
      .filter((p) => pointInRing(hole[0], p.outer) || pointInRing(hole[Math.floor(hole.length / 2)], p.outer))
      .sort((a, b) => ringArea(a.outer) - ringArea(b.outer))[0];
    if (host) host.holes.push(hole);
    else orphanHoles++;
  }
  if (missingMembers.length) reasons.push(`${missingMembers.length} member way(s) have no geometry in the extract`);
  if (outer.open.length) reasons.push(`${outer.open.length} outer chain(s) do not close`);
  if (inner.open.length) reasons.push(`${inner.open.length} inner chain(s) do not close`);
  if (partial) reasons.push(`${partial} member way(s) carry geometry cut at the extract boundary`);
  if (orphanHoles) reasons.push(`${orphanHoles} inner ring(s) lie outside every outer ring`);
  if (polygons.length === 0) reasons.push("no closed outer ring");
  return { polygons, openOutlines: [...outer.open, ...inner.open], missingMembers, orphanHoles, incomplete: reasons.length > 0, reasons };
}
