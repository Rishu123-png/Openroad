/**
 * Converts WGS84 latitude and longitude to local game-space metres.
 *
 * The projection is a local tangent plane at the region origin: one degree of
 * latitude and longitude is scaled by the WGS84 ellipsoid's radii of curvature
 * at the origin. Across a region 10 km wide the error against a true transverse
 * Mercator projection stays below about half a metre, which is finer than the
 * source data. Larger regions should be split into several origins or move to UTM.
 *
 * Game axes: +X is east, +Z is north, Y is up.
 */
export interface GeoOrigin {
  readonly lat: number;
  readonly lon: number;
}

export interface LocalPoint {
  readonly x: number;
  readonly z: number;
}

const WGS84_A = 6378137;
const WGS84_E2 = 0.00669437999014;
const RAD = Math.PI / 180;

export class LocalProjection {
  /** Metres per degree of longitude at the origin. */
  readonly metresPerDegLon: number;
  /** Metres per degree of latitude at the origin. */
  readonly metresPerDegLat: number;

  constructor(readonly origin: GeoOrigin) {
    const sin = Math.sin(origin.lat * RAD);
    const w = Math.sqrt(1 - WGS84_E2 * sin * sin);
    const primeVertical = WGS84_A / w;
    const meridional = (WGS84_A * (1 - WGS84_E2)) / (w * w * w);
    this.metresPerDegLon = primeVertical * Math.cos(origin.lat * RAD) * RAD;
    this.metresPerDegLat = meridional * RAD;
  }

  toLocal(lat: number, lon: number): LocalPoint {
    return {
      x: (lon - this.origin.lon) * this.metresPerDegLon,
      z: (lat - this.origin.lat) * this.metresPerDegLat,
    };
  }

  toGeo(x: number, z: number): GeoOrigin {
    return {
      lat: this.origin.lat + z / this.metresPerDegLat,
      lon: this.origin.lon + x / this.metresPerDegLon,
    };
  }
}

/**
 * Centre of the Pari Chowk roundabout, taken from the bounding boxes of
 * OpenStreetMap ways 63223327 and 753900885 (© OpenStreetMap contributors).
 */
export const GREATER_NOIDA_ORIGIN: GeoOrigin = { lat: 28.46526, lon: 77.5113 };
