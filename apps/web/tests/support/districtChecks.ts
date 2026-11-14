import { pointInPolygons, pointInRing } from "../../src/game/district/spawn";
import type { DistrictData, Point, Polygon } from "../../src/game/district/types";

/**
 * Structural checks on a district file. Used on the real Alpha 1 file when it
 * is present (tests/real) and, in the ordinary suite, on fixtures that are
 * sound and on fixtures broken on purpose, so the checks themselves are tested.
 *
 * Returns a list of problems; empty means the file passed.
 */
export interface CheckOptions {
  /** Slack for rounding at the district edge, in metres. */
  edge?: number;
  /** Stop listing after this many problems of one kind. */
  limit?: number;
}

function ringArea(ring: readonly Point[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j]![0] * ring[i]![1] - ring[i]![0] * ring[j]![1];
  return a / 2;
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const o = (p: Point, q: Point, r: Point): number => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

export function ringProblems(ring: readonly Point[], what: string): string[] {
  const out: string[] = [];
  if (!Array.isArray(ring) || ring.length < 4) return [`${what}: ring has ${ring?.length ?? 0} points, fewer than a closed triangle`];
  for (const p of ring) if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return [`${what}: a coordinate is not a finite number`];
  const first = ring[0]!, last = ring[ring.length - 1]!;
  if (first[0] !== last[0] || first[1] !== last[1]) out.push(`${what}: ring is not closed`);
  if (Math.abs(ringArea(ring)) < 0.01) out.push(`${what}: ring encloses no area`);
  // Self-crossing outlines cannot be roofed. Only checked on rings small enough for the quadratic test.
  if (ring.length <= 400) {
    outer: for (let i = 1; i < ring.length; i++) {
      for (let j = i + 2; j < ring.length; j++) {
        if (i === 1 && j === ring.length - 1) continue;
        if (segmentsCross(ring[i - 1]!, ring[i]!, ring[j - 1]!, ring[j]!)) {
          out.push(`${what}: outline crosses itself`);
          break outer;
        }
      }
    }
  }
  return out;
}

export function polygonProblems(polygon: Polygon, what: string): string[] {
  const out = ringProblems(polygon.outer, `${what} outer`);
  if (out.length) return out;
  const outerArea = Math.abs(ringArea(polygon.outer));
  let holes = 0;
  polygon.holes.forEach((hole, h) => {
    const problems = ringProblems(hole, `${what} courtyard ${h}`);
    out.push(...problems);
    if (problems.length) return;
    holes += Math.abs(ringArea(hole));
    // Every corner of a courtyard lies inside the outline (or on it, within rounding).
    const outside = hole.filter((p) => !pointInRing(p[0], p[1], polygon.outer) && !onRing(p, polygon.outer)).length;
    if (outside > 0) out.push(`${what} courtyard ${h}: ${outside} corners lie outside the outline`);
  });
  if (holes >= outerArea) out.push(`${what}: courtyards cover the whole footprint`);
  return out;
}

function onRing(p: Point, ring: readonly Point[], tolerance = 0.05): boolean {
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1]!, b = ring[i]!;
    const len2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
    const t = len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / len2));
    if (Math.hypot(a[0] + (b[0] - a[0]) * t - p[0], a[1] + (b[1] - a[1]) * t - p[1]) <= tolerance) return true;
  }
  return false;
}

export function checkDistrict(d: DistrictData, options: CheckOptions = {}): string[] {
  const edge = options.edge ?? 0.05, limit = options.limit ?? 5;
  const problems: string[] = [];
  const tally = new Map<string, number>();
  const report = (kind: string, text: string): void => {
    const n = (tally.get(kind) ?? 0) + 1;
    tally.set(kind, n);
    if (n <= limit) problems.push(`${kind}: ${text}`);
  };
  const b = d.bounds;
  if (![b.minX, b.maxX, b.minZ, b.maxZ].every(Number.isFinite) || b.maxX <= b.minX || b.maxZ <= b.minZ) return ["bounds: not a finite rectangle"];
  const inBounds = (p: Point): boolean => p[0] >= b.minX - edge && p[0] <= b.maxX + edge && p[1] >= b.minZ - edge && p[1] <= b.maxZ + edge;
  const finite = (p: Point | undefined): boolean => Boolean(p) && Number.isFinite(p![0]) && Number.isFinite(p![1]);

  // ---- buildings
  const ids = new Set<string>();
  for (const building of d.buildings) {
    if (ids.has(building.id)) report("duplicate-building", building.id);
    ids.add(building.id);
    if (building.id !== `${building.osm.type}/${building.osm.id}`) report("building-id", `${building.id} does not match its OSM reference`);
    if (building.fromRelation !== (building.osm.type === "relation")) report("building-relation-flag", building.id);
    if (!Number.isFinite(building.height) || building.height <= 0) report("building-height", `${building.id} has height ${String(building.height)}`);
    if (!["source-height", "source-levels", "estimated"].includes(building.heightStatus)) report("building-height-status", `${building.id}: ${String(building.heightStatus)}`);
    if (!Number.isFinite(building.area) || building.area <= 0) report("building-area", `${building.id} has area ${String(building.area)}`);
    if (!finite(building.centre) || !inBounds(building.centre)) report("building-outside", `${building.id} centre lies outside the district`);
    if (building.polygons.length === 0) report("building-geometry", `${building.id} has no outline`);
    building.polygons.forEach((polygon, i) => {
      for (const text of polygonProblems(polygon, `${building.id} part ${i}`)) report("building-geometry", text);
      for (const ring of [polygon.outer, ...polygon.holes]) if (ring.some((p) => finite(p) && !inBounds(p))) report("building-outside", `${building.id} has corners outside the district`);
    });
  }
  // A relation's outer way must not also be built as a building of its own.
  const relations = d.buildings.filter((x) => x.fromRelation);
  const ways = d.buildings.filter((x) => !x.fromRelation);
  for (const relation of relations) {
    for (const polygon of relation.polygons) {
      const outerArea = Math.abs(ringArea(polygon.outer));
      for (const way of ways) {
        if (Math.abs(way.centre[0] - relation.centre[0]) > 2 || Math.abs(way.centre[1] - relation.centre[1]) > 2) continue;
        const same = way.polygons.some((p) => p.outer.length === polygon.outer.length && Math.abs(Math.abs(ringArea(p.outer)) - outerArea) < 0.5 && p.outer.every((q) => polygon.outer.some((r) => Math.abs(r[0] - q[0]) < 0.02 && Math.abs(r[1] - q[1]) < 0.02)));
        if (same) report("relation-duplicated", `${relation.id} is also built as ${way.id}`);
      }
    }
  }

  // ---- roads
  for (const road of d.roads) {
    if (!Array.isArray(road.points) || road.points.length < 2) {
      report("road-geometry", `${road.id} has fewer than two points`);
      continue;
    }
    if (!road.points.every(finite)) {
      report("road-geometry", `${road.id} has a coordinate that is not a finite number`);
      continue;
    }
    if (!road.points.every(inBounds)) report("road-outside", `${road.id} leaves the district`);
    if (!Number.isFinite(road.width) || road.width <= 0 || road.width > 80) report("road-width", `${road.id} has width ${String(road.width)}`);
    if (!["source-width", "source-lanes", "estimated"].includes(road.widthStatus)) report("road-width-status", `${road.id}: ${String(road.widthStatus)}`);
    let length = 0;
    for (let i = 1; i < road.points.length; i++) length += Math.hypot(road.points[i]![0] - road.points[i - 1]![0], road.points[i]![1] - road.points[i - 1]![1]);
    if (length < 0.01) report("road-geometry", `${road.id} has no length`);
    if (Number.isFinite(road.length) && Math.abs(road.length - length) > Math.max(0.5, length * 0.01)) report("road-length", `${road.id} states ${road.length} m but measures ${length.toFixed(2)} m`);
    if (road.kind !== "road" && road.kind !== "path") report("road-kind", `${road.id}: ${String(road.kind)}`);
  }
  const roadIds = new Set(d.roads.map((r) => r.id));
  for (const junction of d.junctions) {
    if (!finite(junction.point) || !inBounds(junction.point)) report("junction", "a junction lies outside the district");
    if (!Number.isFinite(junction.radius) || junction.radius <= 0) report("junction", "a junction has no radius");
    for (const id of junction.roads) if (!roadIds.has(id)) report("junction", `a junction names road ${id}, which is not in the file`);
    // A junction is a point that its roads actually pass through.
    const touching = d.roads.filter((r) => junction.roads.includes(r.id) && r.points.some((p) => Math.abs(p[0] - junction.point[0]) < 0.11 && Math.abs(p[1] - junction.point[1]) < 0.11));
    if (new Set(touching.map((r) => r.id)).size < Math.min(1, junction.roads.length)) report("junction", "a junction is not on any of its roads");
  }

  // ---- everything else stays inside the district
  for (const area of d.areas) for (const polygon of area.polygons) if (!polygon.outer.every((p) => finite(p) && inBounds(p))) report("area-outside", area.id);
  for (const line of [...d.barriers.lines, ...d.rail.lines]) if (!line.points.every((p) => finite(p) && inBounds(p))) report("line-outside", line.id);
  for (const point of [...d.barriers.points, ...d.rail.points, ...d.furniture, ...d.pois]) if (!finite(point.point) || !inBounds(point.point)) report("point-outside", point.id);

  // ---- sector
  if (d.sector.polygons.length === 0) report("sector", "the sector has no outline");
  d.sector.polygons.forEach((polygon, i) => {
    for (const text of polygonProblems(polygon, `sector part ${i}`)) report("sector", text);
    if (!polygon.outer.every(inBounds)) report("sector", "the sector outline leaves the district");
  });

  // ---- spawn
  const s = d.spawn;
  if (!s || ![s.x, s.z, s.heading].every(Number.isFinite)) report("spawn", "the spawn point is missing or not finite");
  else {
    if (!inBounds([s.x, s.z])) report("spawn", "the spawn point lies outside the district");
    const inside = d.buildings.find((x) => pointInPolygons(s.x, s.z, x.polygons));
    if (inside) report("spawn", `the spawn point lies inside building ${inside.id}`);
    const road = d.roads.find((r) => r.id === s.road && r.kind === "road");
    if (!road) report("spawn", `the spawn road ${s.road} is not a carriageway in the file`);
    else {
      let best = Infinity;
      for (const r of d.roads.filter((x) => x.id === s.road && x.kind === "road")) {
        for (let i = 1; i < r.points.length; i++) {
          const a = r.points[i - 1]!, c = r.points[i]!;
          const len2 = (c[0] - a[0]) ** 2 + (c[1] - a[1]) ** 2;
          const t = len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((s.x - a[0]) * (c[0] - a[0]) + (s.z - a[1]) * (c[1] - a[1])) / len2));
          best = Math.min(best, Math.hypot(a[0] + (c[0] - a[0]) * t - s.x, a[1] + (c[1] - a[1]) * t - s.z) - r.width / 2);
        }
      }
      if (best > 0.05) report("spawn", `the spawn point is ${best.toFixed(2)} m off the surface of its road`);
    }
  }

  for (const [kind, n] of tally) if (n > limit) problems.push(`${kind}: and ${n - limit} more`);
  return problems;
}
