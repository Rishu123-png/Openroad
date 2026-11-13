import { describe, expect, it } from "vitest";
import { GREATER_NOIDA_ORIGIN, LocalProjection } from "../src/game/geo/projection";

/** Great-circle distance on a sphere, as an independent cross-check. */
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(a));
}

describe("LocalProjection", () => {
  const p = new LocalProjection(GREATER_NOIDA_ORIGIN);

  it("puts the origin at zero", () => {
    const o = p.toLocal(GREATER_NOIDA_ORIGIN.lat, GREATER_NOIDA_ORIGIN.lon);
    expect(o.x).toBe(0);
    expect(o.z).toBe(0);
  });

  it("uses WGS84 scale at the latitude of Greater Noida", () => {
    expect(p.metresPerDegLat).toBeGreaterThan(110800);
    expect(p.metresPerDegLat).toBeLessThan(110860);
    expect(p.metresPerDegLon).toBeGreaterThan(97850);
    expect(p.metresPerDegLon).toBeLessThan(97990);
  });

  it("places north at +Z and east at +X", () => {
    // Alpha 1 metro station, OSM node 4165778689: north and slightly east of Pari Chowk.
    const a = p.toLocal(28.4710345, 77.5127373);
    expect(a.z).toBeGreaterThan(600);
    expect(a.x).toBeGreaterThan(100);
    expect(a.x).toBeLessThan(a.z);
  });

  it("agrees with great-circle distance to within 0.5 percent", () => {
    const lat = 28.4904964;
    const lon = 77.5093511; // Gamma 2 centre from OSM way 86834787
    const a = p.toLocal(lat, lon);
    const d = haversine(GREATER_NOIDA_ORIGIN.lat, GREATER_NOIDA_ORIGIN.lon, lat, lon);
    expect(Math.abs(Math.hypot(a.x, a.z) - d) / d).toBeLessThan(0.005);
  });

  it("round-trips", () => {
    const a = p.toLocal(28.457, 77.5002);
    const g = p.toGeo(a.x, a.z);
    expect(g.lat).toBeCloseTo(28.457, 9);
    expect(g.lon).toBeCloseTo(77.5002, 9);
  });
});
