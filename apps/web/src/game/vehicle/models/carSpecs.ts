/**
 * Vehicle shapes, described by a few measured dimensions and a side profile.
 *
 * These are ORIGINAL GENERIC MODELS built in code. Two are proportioned after
 * a vehicle class using published overall dimensions as a scale reference;
 * they are not manufacturer assets, carry no badges and are not replicas.
 */
export type ProfileKey = readonly [t: number, y: number];

export interface CarSpec {
  id: string;
  name: string;
  /** Shown in the garage. */
  klass: string;
  /** What the proportions are based on. */
  basis: string;
  /** Metres. */
  length: number;
  width: number;
  height: number;
  wheelbase: number;
  /** Front axle to front bumper. */
  frontOverhang: number;
  clearance: number;
  wheelRadius: number;
  tyreWidth: number;
  /** Roof line seen from the side: t runs from the rear bumper (0) to the front bumper (1). */
  top: readonly ProfileKey[];
  /** Bottom edge of the side windows. */
  belt: readonly ProfileKey[];
  rearGlass: readonly [number, number];
  windshield: readonly [number, number];
  sideWindows: readonly [number, number];
  /** Pillar positions inside the side windows. */
  pillars: readonly number[];
  /** Door shut lines. */
  doorLines: readonly number[];
  /** Unpainted lower body and wheel-arch trim. */
  cladding: boolean;
  roofRails: boolean;
  /** A light strip joining the tail lamps. */
  lightBar: boolean;
  spokes: number;
  /** Used for the player when nothing else is chosen: linear RGB. */
  paint: readonly [number, number, number];
}

export const COMPACT_SUV: CarSpec = {
  id: "compact-suv",
  name: "Compact SUV",
  klass: "Compact SUV · 5 seats",
  basis: "Generic model, proportioned after the Hyundai Creta class (about 4.33 m × 1.79 m). Not a manufacturer asset.",
  length: 4.33, width: 1.79, height: 1.635, wheelbase: 2.61, frontOverhang: 0.86, clearance: 0.19, wheelRadius: 0.345, tyreWidth: 0.215,
  top: [[0, 0.99], [0.022, 1.34], [0.07, 1.57], [0.2, 1.622], [0.45, 1.635], [0.6, 1.6], [0.775, 1.07], [0.8, 1.05], [0.93, 1.0], [0.985, 0.92], [1, 0.8]],
  belt: [[0, 0.97], [0.3, 1.0], [0.78, 0.97], [1, 0.78]],
  rearGlass: [0.018, 0.075], windshield: [0.605, 0.775], sideWindows: [0.1, 0.735], pillars: [0.19, 0.435], doorLines: [0.2, 0.435, 0.665],
  cladding: true, roofRails: true, lightBar: true, spokes: 5, paint: [0.55, 0.57, 0.6],
};

export const COMPACT_SEDAN: CarSpec = {
  id: "compact-sedan",
  name: "Compact sedan",
  klass: "Sub-4-metre sedan · 5 seats",
  basis: "Generic model, proportioned after the Maruti Suzuki Dzire class (about 4.00 m × 1.735 m). Not a manufacturer asset.",
  length: 3.995, width: 1.735, height: 1.515, wheelbase: 2.45, frontOverhang: 0.8, clearance: 0.163, wheelRadius: 0.3, tyreWidth: 0.185,
  top: [[0, 0.84], [0.02, 0.965], [0.12, 1.0], [0.16, 1.02], [0.31, 1.465], [0.45, 1.515], [0.575, 1.48], [0.755, 1.0], [0.78, 0.985], [0.93, 0.9], [0.985, 0.82], [1, 0.7]],
  belt: [[0, 0.84], [0.15, 0.93], [0.5, 0.93], [0.76, 0.9], [1, 0.68]],
  rearGlass: [0.165, 0.305], windshield: [0.58, 0.755], sideWindows: [0.2, 0.72], pillars: [0.27, 0.46], doorLines: [0.255, 0.46, 0.66],
  cladding: false, roofRails: false, lightBar: false, spokes: 8, paint: [0.42, 0.03, 0.03],
};

export const HATCHBACK: CarSpec = {
  id: "hatchback",
  name: "Hatchback",
  klass: "Hatchback",
  basis: "Generic model.",
  length: 3.86, width: 1.735, height: 1.52, wheelbase: 2.45, frontOverhang: 0.78, clearance: 0.165, wheelRadius: 0.3, tyreWidth: 0.185,
  top: [[0, 0.92], [0.03, 1.25], [0.1, 1.465], [0.3, 1.512], [0.48, 1.52], [0.6, 1.48], [0.775, 1.0], [0.8, 0.985], [0.94, 0.9], [0.985, 0.82], [1, 0.7]],
  belt: [[0, 0.9], [0.4, 0.93], [0.77, 0.9], [1, 0.68]],
  rearGlass: [0.03, 0.1], windshield: [0.605, 0.775], sideWindows: [0.12, 0.735], pillars: [0.2, 0.44], doorLines: [0.21, 0.44, 0.665],
  cladding: false, roofRails: false, lightBar: false, spokes: 6, paint: [0.7, 0.7, 0.68],
};

export const LARGE_SUV: CarSpec = {
  id: "large-suv",
  name: "Large SUV",
  klass: "Large SUV",
  basis: "Generic model.",
  length: 4.7, width: 1.86, height: 1.8, wheelbase: 2.75, frontOverhang: 0.93, clearance: 0.21, wheelRadius: 0.37, tyreWidth: 0.235,
  top: [[0, 1.08], [0.018, 1.5], [0.06, 1.74], [0.3, 1.79], [0.5, 1.8], [0.63, 1.76], [0.76, 1.2], [0.785, 1.17], [0.93, 1.12], [0.985, 1.03], [1, 0.88]],
  belt: [[0, 1.08], [0.4, 1.1], [0.76, 1.08], [1, 0.85]],
  rearGlass: [0.015, 0.062], windshield: [0.635, 0.76], sideWindows: [0.085, 0.725], pillars: [0.17, 0.3, 0.46], doorLines: [0.3, 0.46, 0.67],
  cladding: true, roofRails: true, lightBar: false, spokes: 6, paint: [0.9, 0.9, 0.88],
};

/** Vehicles the player can choose. */
export const PLAYER_CARS: readonly CarSpec[] = [COMPACT_SUV, COMPACT_SEDAN];
/** Vehicles used for traffic and parked cars. */
export const TRAFFIC_CARS: readonly CarSpec[] = [COMPACT_SEDAN, HATCHBACK, COMPACT_SUV, LARGE_SUV];
export const ALL_CARS: readonly CarSpec[] = [COMPACT_SUV, COMPACT_SEDAN, HATCHBACK, LARGE_SUV];

/** Common Indian car colours, linear RGB. Whites and silvers dominate real traffic. */
export const TRAFFIC_PAINTS: ReadonlyArray<readonly [number, number, number]> = [
  [0.9, 0.9, 0.88], [0.9, 0.9, 0.88], [0.55, 0.57, 0.6], [0.55, 0.57, 0.6], [0.16, 0.17, 0.19], [0.03, 0.03, 0.035], [0.36, 0.03, 0.03], [0.04, 0.09, 0.25], [0.32, 0.22, 0.14],
];

/** Catmull-Rom through profile keys, so a silhouette has no corners where keys meet. */
export function profileAt(keys: readonly ProfileKey[], t: number): number {
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1]![0]) i++;
  const p1 = keys[i]!, p2 = keys[i + 1]!;
  const p0 = keys[Math.max(0, i - 1)]!, p3 = keys[Math.min(keys.length - 1, i + 2)]!;
  const u = Math.max(0, Math.min(1, (t - p1[0]) / (p2[0] - p1[0])));
  // Tangents use the real spacing of the keys, and are limited so the curve cannot overshoot.
  const slope = (a: ProfileKey, b: ProfileKey): number => (b[1] - a[1]) / Math.max(1e-6, b[0] - a[0]);
  const d = slope(p1, p2);
  const limit = (m: number): number => (m * d <= 0 ? 0 : Math.sign(d) * Math.min(Math.abs(m), 3 * Math.abs(d)));
  const m1 = limit(i === 0 ? d : slope(p0, p2)) * (p2[0] - p1[0]);
  const m2 = limit(i + 2 > keys.length - 1 ? d : slope(p1, p3)) * (p2[0] - p1[0]);
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * p1[1] + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * p2[1] + (u3 - u2) * m2;
}
