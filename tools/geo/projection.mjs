/**
 * WGS84 degrees to local metres. Same maths as
 * apps/web/src/game/geo/projection.ts: a tangent plane at the region origin,
 * scaled by the ellipsoid's radii of curvature there. +x east, +z north.
 */
const A = 6378137;
const E2 = 0.00669437999014;
const RAD = Math.PI / 180;

/** Centre of the Pari Chowk roundabout (OSM ways 63223327 and 753900885). */
export const GREATER_NOIDA_ORIGIN = { lat: 28.46526, lon: 77.5113 };

export function makeProjection(origin = GREATER_NOIDA_ORIGIN) {
  const sin = Math.sin(origin.lat * RAD);
  const w = Math.sqrt(1 - E2 * sin * sin);
  const mLon = (A / w) * Math.cos(origin.lat * RAD) * RAD;
  const mLat = ((A * (1 - E2)) / (w * w * w)) * RAD;
  const r2 = (v) => Math.round(v * 100) / 100;
  return {
    name: "local-tangent-wgs84",
    origin,
    metresPerDegLat: mLat,
    metresPerDegLon: mLon,
    /** [x, z] in metres, rounded to the centimetre. */
    toLocal: (lat, lon) => [r2((lon - origin.lon) * mLon), r2((lat - origin.lat) * mLat)],
    toGeo: (x, z) => ({ lat: origin.lat + z / mLat, lon: origin.lon + x / mLon }),
    /** Flat [lat, lon, ...] to [[x, z], ...]. */
    line(pts) {
      const out = [];
      for (let i = 0; i + 1 < pts.length; i += 2) out.push(this.toLocal(pts[i], pts[i + 1]));
      return out;
    },
    /** south, west, north, east to a rectangle in metres. */
    rect([s, w2, n, e]) {
      const [minX, minZ] = this.toLocal(s, w2);
      const [maxX, maxZ] = this.toLocal(n, e);
      return { minX, minZ, maxX, maxZ };
    },
  };
}
