import type { DistrictData, Point, Polygon } from "./types";

export function pointInRing(x: number, z: number, ring: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export function pointInPolygons(x: number, z: number, polygons: readonly Polygon[]): boolean {
  for (const p of polygons) {
    if (pointInRing(x, z, p.outer) && !p.holes.some((h) => pointInRing(x, z, h))) return true;
  }
  return false;
}

/** The id of the building containing the point, or null. */
export function buildingAt(district: DistrictData, x: number, z: number): string | null {
  for (const b of district.buildings) {
    if (Math.abs(b.centre[0] - x) > 400 || Math.abs(b.centre[1] - z) > 400) continue;
    if (pointInPolygons(x, z, b.polygons)) return b.id;
  }
  return null;
}

/**
 * Checks the spawn point stored in the district file before the player is
 * placed. Returns a reason when it is unusable; the game then refuses to start
 * rather than put the vehicle inside a building or outside the district.
 */
export function spawnProblem(district: DistrictData): string | null {
  const { spawn, bounds } = district;
  if (!spawn || !Number.isFinite(spawn.x) || !Number.isFinite(spawn.z)) return "the district file has no spawn point";
  if (spawn.x <= bounds.minX || spawn.x >= bounds.maxX || spawn.z <= bounds.minZ || spawn.z >= bounds.maxZ) return "the spawn point lies outside the district";
  const inside = buildingAt(district, spawn.x, spawn.z);
  if (inside) return `the spawn point lies inside building ${inside}`;
  return null;
}
