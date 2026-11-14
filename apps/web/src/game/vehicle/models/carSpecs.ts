/**
 * Vehicle shapes, described by measured dimensions, a side profile, a body
 * section and a list of front and rear details.
 *
 * These are ORIGINAL MODELS BUILT IN CODE. Each is proportioned after a class
 * of vehicle common in Greater Noida, using published overall dimensions as a
 * scale reference. They are not manufacturer assets, carry no badges or brand
 * names and are not replicas. See docs/ASSETS.md.
 */
export type ProfileKey = readonly [t: number, y: number];
export type Rgb3 = readonly [number, number, number];

/** What a front or rear detail is made of. */
export type FaceKind = "dark" | "mesh" | "satin" | "paint" | "lamp" | "amber" | "plate" | "tail" | "lens" | "reflector";

/**
 * One detail on the front or rear face. `u` runs across the face from the
 * centre (0) to the corner (1); `v` runs up it from the floor (0) to the
 * bonnet or boot edge (1).
 */
export interface FaceItem {
  kind: FaceKind;
  u: readonly [number, number];
  /** Bottom and top at `u[0]`; a second pair gives the bottom and top at `u[1]`, for a slanted shape. */
  v: readonly [number, number] | readonly [number, number, number, number];
  /** Repeat on the other side. */
  mirror?: boolean;
  /** Metres in front of the panel. */
  proud?: number;
  /** Horizontal bars across the item. */
  bars?: number;
  barKind?: FaceKind;
  /** Split into this many upright slots with body colour between. */
  slots?: number;
  /** Draw as a disc of this radius (metres) centred in the item. */
  round?: number;
}

export interface FaceSpec {
  items: readonly FaceItem[];
  /** Metres of the body side, from the corner, that carry the lamp. */
  wrap: number;
  /** Which side panels carry it: 6 is the lower half of the lamp band, 7 the upper. */
  wrapSegs: readonly number[];
  /** Plan-view setback of the corners, metres. */
  bow: number;
  /** How far the face leans back above the bumper, metres per metre. */
  lean: number;
  /** Width at the very end, as a fraction of the body width. */
  endWidth: number;
  /** Length over which the corner is rounded, metres. */
  corner: number;
}

export type WheelStyle = "spoke" | "split" | "steel" | "turbine";

export interface CarSpec {
  id: string;
  name: string;
  /** Shown in the garage. */
  klass: string;
  category: "Hatchback" | "Sedan" | "SUV" | "Off-road";
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
  /** Metres at the back taken by something hung on the body (a spare wheel). The body is that much shorter. */
  rearExtra?: number;
  /** Roof line seen from the side: t runs from the rear of the body (0) to the front bumper (1). */
  top: readonly ProfileKey[];
  /** Bottom edge of the side windows. */
  belt: readonly ProfileKey[];
  /** Inward lean of the side glass, metres per metre of height. */
  tumblehome: number;
  rearGlass: readonly [number, number];
  windshield: readonly [number, number];
  sideWindows: readonly [number, number];
  /** Pillar positions inside the side windows. */
  pillars: readonly number[];
  /** Pillar width in metres. */
  pillarWidth: number;
  /** Pillars finished in black, so the side glass reads as one band. */
  blackPillars: boolean;
  /** Door shut lines. */
  doorLines: readonly number[];
  /** Unpainted sills and wheel-arch trim. */
  cladding: boolean;
  /** How far the wheel arches stand out from the body, metres. */
  flare: number;
  roofRails: boolean;
  /** Roof and pillars in black. */
  twoTone: boolean;
  /** A glass panel in the roof. */
  sunroof?: readonly [number, number];
  sideSteps: boolean;
  /** A spare wheel on the tailgate. */
  spare: boolean;
  front: FaceSpec;
  rear: FaceSpec;
  spokes: number;
  wheelStyle: WheelStyle;
  /** Used for the player when nothing else is chosen: linear RGB. */
  paint: Rgb3;
}

const WHITE: Rgb3 = [0.9, 0.9, 0.88], SILVER: Rgb3 = [0.55, 0.57, 0.6], GRAPHITE: Rgb3 = [0.16, 0.17, 0.19], BLACK: Rgb3 = [0.03, 0.03, 0.035];
const RED: Rgb3 = [0.42, 0.03, 0.03], BLUE: Rgb3 = [0.04, 0.09, 0.25], BRONZE: Rgb3 = [0.32, 0.22, 0.14];

/** Colours offered in the garage, linear RGB. */
export const PLAYER_PAINTS: ReadonlyArray<{ name: string; color: Rgb3 }> = [
  { name: "Pearl white", color: WHITE }, { name: "Silver", color: SILVER }, { name: "Graphite", color: GRAPHITE }, { name: "Black", color: BLACK },
  { name: "Red", color: RED }, { name: "Blue", color: BLUE }, { name: "Bronze", color: BRONZE },
];

export const COMPACT_SUV: CarSpec = {
  id: "compact-suv",
  name: "Compact SUV",
  klass: "Compact SUV · 5 seats",
  category: "SUV",
  basis: "Generic model built in code, proportioned after the Hyundai Creta class (about 4.33 m × 1.79 m × 1.64 m). Not a manufacturer asset.",
  length: 4.33, width: 1.79, height: 1.635, wheelbase: 2.61, frontOverhang: 0.86, clearance: 0.19, wheelRadius: 0.345, tyreWidth: 0.215,
  top: [[0, 0.98], [0.03, 1.27], [0.11, 1.545], [0.22, 1.615], [0.42, 1.635], [0.575, 1.6], [0.6, 1.57], [0.765, 1.09], [0.79, 1.065], [0.93, 1.02], [0.975, 0.97], [1, 0.86]],
  belt: [[0, 0.96], [0.08, 1.17], [0.3, 1.125], [0.75, 1.085], [0.8, 1.05], [1, 0.82]],
  tumblehome: 0.26,
  rearGlass: [0.036, 0.105], windshield: [0.608, 0.76], sideWindows: [0.14, 0.735], pillars: [0.215, 0.44], pillarWidth: 0.1, blackPillars: true,
  doorLines: [0.215, 0.44, 0.672],
  cladding: true, flare: 0.03, roofRails: true, twoTone: false, sunroof: [0.4, 0.56], sideSteps: false, spare: false,
  front: {
    bow: 0.17, lean: 0.1, endWidth: 0.9, corner: 0.26, wrap: 0.15, wrapSegs: [7],
    items: [
      { kind: "dark", u: [-1, 1], v: [0, 0.3] },
      { kind: "satin", u: [-0.5, 0.5], v: [0.03, 0.15], proud: 0.012 },
      { kind: "mesh", u: [-0.58, 0.58], v: [0.34, 0.9], bars: 5, barKind: "dark" },
      { kind: "plate", u: [-0.27, 0.27], v: [0.38, 0.57], proud: 0.016 },
      { kind: "dark", u: [0.6, 0.93], v: [0.33, 0.62], mirror: true },
      { kind: "lamp", u: [0.64, 0.9], v: [0.38, 0.58], mirror: true, proud: 0.012 },
      { kind: "lamp", u: [0.6, 1], v: [0.77, 0.86, 0.8, 0.93], mirror: true, proud: 0.008 },
    ],
  },
  rear: {
    bow: 0.13, lean: 0.06, endWidth: 0.92, corner: 0.22, wrap: 0.13, wrapSegs: [7],
    items: [
      { kind: "dark", u: [-1, 1], v: [0, 0.27] },
      { kind: "satin", u: [-0.42, 0.42], v: [0.03, 0.13], proud: 0.012 },
      { kind: "reflector", u: [0.62, 0.9], v: [0.17, 0.22], mirror: true, proud: 0.012 },
      { kind: "plate", u: [-0.27, 0.27], v: [0.42, 0.58], proud: 0.014 },
      { kind: "tail", u: [0.56, 1], v: [0.72, 0.92, 0.76, 0.93], mirror: true },
      { kind: "tail", u: [-0.56, 0.56], v: [0.83, 0.88] },
      { kind: "lens", u: [0.6, 0.86], v: [0.64, 0.7], mirror: true },
    ],
  },
  spokes: 5, wheelStyle: "split", paint: SILVER,
};

export const COMPACT_SEDAN: CarSpec = {
  id: "compact-sedan",
  name: "Compact sedan",
  klass: "Sub-4-metre sedan · 5 seats",
  category: "Sedan",
  basis: "Generic model built in code, proportioned after the Maruti Suzuki Dzire class (about 4.00 m × 1.735 m × 1.52 m). Not a manufacturer asset.",
  length: 3.995, width: 1.735, height: 1.515, wheelbase: 2.45, frontOverhang: 0.8, clearance: 0.163, wheelRadius: 0.3, tyreWidth: 0.185,
  top: [[0, 0.86], [0.018, 0.985], [0.1, 1.03], [0.155, 1.05], [0.3, 1.46], [0.44, 1.515], [0.56, 1.49], [0.585, 1.465], [0.755, 1.01], [0.78, 0.985], [0.93, 0.9], [0.98, 0.83], [1, 0.72]],
  belt: [[0, 0.84], [0.15, 1.02], [0.5, 1.0], [0.76, 0.965], [1, 0.68]],
  tumblehome: 0.36,
  rearGlass: [0.165, 0.295], windshield: [0.592, 0.75], sideWindows: [0.21, 0.725], pillars: [0.46], pillarWidth: 0.09, blackPillars: true,
  doorLines: [0.262, 0.46, 0.662],
  cladding: false, flare: 0.012, roofRails: false, twoTone: false, sideSteps: false, spare: false,
  front: {
    bow: 0.2, lean: 0.16, endWidth: 0.88, corner: 0.3, wrap: 0.2, wrapSegs: [7],
    items: [
      { kind: "dark", u: [-0.72, 0.72], v: [0.03, 0.2] },
      { kind: "lens", u: [0.76, 0.9], v: [0.07, 0.17], mirror: true, proud: 0.01 },
      { kind: "satin", u: [-0.55, 0.55], v: [0.3, 0.76] },
      { kind: "mesh", u: [-0.52, 0.52], v: [0.33, 0.73], bars: 4, barKind: "satin", proud: 0.009 },
      { kind: "plate", u: [-0.29, 0.29], v: [0.36, 0.56], proud: 0.02 },
      { kind: "lamp", u: [0.58, 1], v: [0.7, 0.9, 0.78, 0.95], mirror: true },
    ],
  },
  rear: {
    bow: 0.15, lean: 0.1, endWidth: 0.9, corner: 0.26, wrap: 0.16, wrapSegs: [7],
    items: [
      { kind: "dark", u: [-0.8, 0.8], v: [0.02, 0.16] },
      { kind: "reflector", u: [0.64, 0.9], v: [0.2, 0.25], mirror: true, proud: 0.012 },
      { kind: "plate", u: [-0.29, 0.29], v: [0.4, 0.58], proud: 0.014 },
      { kind: "satin", u: [-0.5, 0.5], v: [0.8, 0.84], proud: 0.012 },
      { kind: "tail", u: [0.5, 1], v: [0.72, 0.93, 0.8, 0.95], mirror: true },
      { kind: "lens", u: [0.5, 0.66], v: [0.72, 0.79], mirror: true, proud: 0.01 },
    ],
  },
  spokes: 8, wheelStyle: "turbine", paint: RED,
};

/** Tall, sharp-edged hatchback with a full-length glass roof. */
export const HATCHBACK: CarSpec = {
  id: "hatchback",
  name: "Sport hatchback",
  klass: "Hatchback · glass roof · 5 seats",
  category: "Hatchback",
  basis: "Generic model built in code, proportioned after the Hyundai i20 class, built slightly shorter (3.86 m × 1.735 m × 1.52 m). Not a manufacturer asset.",
  length: 3.86, width: 1.735, height: 1.52, wheelbase: 2.45, frontOverhang: 0.78, clearance: 0.165, wheelRadius: 0.3, tyreWidth: 0.185,
  top: [[0, 0.95], [0.025, 1.22], [0.085, 1.45], [0.14, 1.495], [0.3, 1.516], [0.46, 1.52], [0.575, 1.49], [0.6, 1.465], [0.775, 1.01], [0.8, 0.985], [0.94, 0.9], [0.98, 0.84], [1, 0.72]],
  belt: [[0, 0.93], [0.08, 1.1], [0.25, 1.045], [0.6, 1.0], [0.77, 0.965], [1, 0.68]],
  tumblehome: 0.33,
  rearGlass: [0.028, 0.082], windshield: [0.607, 0.768], sideWindows: [0.125, 0.74], pillars: [0.44], pillarWidth: 0.09, blackPillars: true,
  doorLines: [0.225, 0.44, 0.67],
  cladding: false, flare: 0.014, roofRails: false, twoTone: false, sunroof: [0.16, 0.57], sideSteps: false, spare: false,
  front: {
    bow: 0.2, lean: 0.18, endWidth: 0.88, corner: 0.3, wrap: 0.22, wrapSegs: [7],
    items: [
      { kind: "mesh", u: [-0.66, 0.66], v: [0.06, 0.6, 0.06, 0.42], bars: 5, barKind: "dark" },
      { kind: "plate", u: [-0.29, 0.29], v: [0.3, 0.5], proud: 0.018 },
      { kind: "dark", u: [0.72, 0.96], v: [0.1, 0.36, 0.16, 0.3], mirror: true },
      { kind: "lens", u: [0.76, 0.9], v: [0.17, 0.27], mirror: true, proud: 0.011 },
      { kind: "dark", u: [-0.5, 0.5], v: [0.68, 0.74] },
      { kind: "lamp", u: [0.5, 1], v: [0.68, 0.84, 0.8, 0.96], mirror: true },
    ],
  },
  rear: {
    bow: 0.15, lean: 0.1, endWidth: 0.9, corner: 0.26, wrap: 0.17, wrapSegs: [6, 7],
    items: [
      { kind: "dark", u: [-1, 1], v: [0, 0.22] },
      { kind: "reflector", u: [0.6, 0.9], v: [0.26, 0.31], mirror: true, proud: 0.012 },
      { kind: "plate", u: [-0.29, 0.29], v: [0.34, 0.52], proud: 0.014 },
      { kind: "tail", u: [0.62, 1], v: [0.58, 0.94, 0.6, 0.95], mirror: true },
      { kind: "tail", u: [-0.62, 0.62], v: [0.8, 0.84] },
      { kind: "dark", u: [-0.62, 0.62], v: [0.84, 0.93] },
    ],
  },
  spokes: 5, wheelStyle: "spoke", paint: BLUE,
};

/** Low, wide hatchback with a sloping tail. */
export const PREMIUM_HATCH: CarSpec = {
  id: "premium-hatch",
  name: "Premium hatchback",
  klass: "Premium hatchback · 5 seats",
  category: "Hatchback",
  basis: "Generic model built in code, proportioned after the Maruti Suzuki Baleno class (about 3.99 m × 1.745 m × 1.50 m). Not a manufacturer asset.",
  length: 3.99, width: 1.745, height: 1.5, wheelbase: 2.52, frontOverhang: 0.8, clearance: 0.17, wheelRadius: 0.305, tyreWidth: 0.195,
  top: [[0, 0.9], [0.03, 1.1], [0.14, 1.36], [0.24, 1.47], [0.4, 1.5], [0.55, 1.475], [0.585, 1.44], [0.76, 0.98], [0.785, 0.955], [0.93, 0.87], [0.98, 0.8], [1, 0.7]],
  belt: [[0, 0.88], [0.1, 1.06], [0.3, 1.02], [0.6, 0.985], [0.76, 0.94], [1, 0.66]],
  tumblehome: 0.38,
  rearGlass: [0.04, 0.145], windshield: [0.592, 0.752], sideWindows: [0.15, 0.725], pillars: [0.445], pillarWidth: 0.09, blackPillars: true,
  doorLines: [0.24, 0.445, 0.66],
  cladding: false, flare: 0.012, roofRails: false, twoTone: false, sideSteps: false, spare: false,
  front: {
    bow: 0.22, lean: 0.2, endWidth: 0.86, corner: 0.32, wrap: 0.18, wrapSegs: [7],
    items: [
      { kind: "dark", u: [-0.8, 0.8], v: [0.03, 0.22, 0.03, 0.14] },
      { kind: "lens", u: [0.74, 0.88], v: [0.2, 0.3], mirror: true, proud: 0.01 },
      { kind: "mesh", u: [-0.5, 0.5], v: [0.42, 0.74], bars: 3, barKind: "dark" },
      { kind: "satin", u: [-0.56, 0.56], v: [0.74, 0.79], proud: 0.012 },
      { kind: "plate", u: [-0.29, 0.29], v: [0.24, 0.42], proud: 0.016 },
      { kind: "lamp", u: [0.54, 1], v: [0.62, 0.8, 0.74, 0.94], mirror: true },
    ],
  },
  rear: {
    bow: 0.18, lean: 0.14, endWidth: 0.88, corner: 0.28, wrap: 0.12, wrapSegs: [7],
    items: [
      { kind: "dark", u: [-0.85, 0.85], v: [0.02, 0.2] },
      { kind: "reflector", u: [0.62, 0.9], v: [0.24, 0.29], mirror: true, proud: 0.012 },
      { kind: "plate", u: [-0.29, 0.29], v: [0.4, 0.58], proud: 0.014 },
      { kind: "satin", u: [-0.45, 0.45], v: [0.84, 0.88], proud: 0.012 },
      { kind: "tail", u: [0.45, 1], v: [0.78, 0.92, 0.74, 0.95], mirror: true },
    ],
  },
  spokes: 10, wheelStyle: "turbine", paint: GRAPHITE,
};

/** Upright three-door with flat panels, round lamps and a spare wheel on the tailgate. */
export const OFFROAD_SUV: CarSpec = {
  id: "offroad-suv",
  name: "Off-road SUV",
  klass: "Off-road SUV · 3 doors · 4 seats",
  category: "Off-road",
  basis: "Generic model built in code, proportioned after the Mahindra Thar class (about 3.99 m × 1.82 m × 1.85 m). Not a manufacturer asset.",
  length: 3.985, width: 1.82, height: 1.85, wheelbase: 2.45, frontOverhang: 0.72, clearance: 0.226, wheelRadius: 0.385, tyreWidth: 0.255, rearExtra: 0.31,
  top: [[0, 1.2], [0.006, 1.24], [0.02, 1.79], [0.1, 1.84], [0.4, 1.85], [0.535, 1.835], [0.56, 1.8], [0.655, 1.3], [0.675, 1.275], [0.9, 1.215], [0.985, 1.19], [1, 1.14]],
  belt: [[0, 1.18], [0.3, 1.25], [0.66, 1.25], [0.7, 1.19], [1, 1.1]],
  tumblehome: 0.1,
  rearGlass: [0.007, 0.019], windshield: [0.566, 0.652], sideWindows: [0.05, 0.635], pillars: [0.335], pillarWidth: 0.12, blackPillars: false,
  doorLines: [0.34, 0.6],
  cladding: true, flare: 0.075, roofRails: false, twoTone: false, sideSteps: true, spare: true,
  front: {
    bow: 0.05, lean: 0.02, endWidth: 0.95, corner: 0.1, wrap: 0, wrapSegs: [],
    items: [
      { kind: "dark", u: [-1, 1], v: [0, 0.38] },
      { kind: "satin", u: [-0.3, 0.3], v: [0.04, 0.16], proud: 0.012 },
      { kind: "plate", u: [-0.27, 0.27], v: [0.2, 0.34], proud: 0.016 },
      { kind: "mesh", u: [-0.42, 0.42], v: [0.5, 0.9], slots: 7 },
      { kind: "lamp", u: [0.5, 0.82], v: [0.52, 0.9], mirror: true, round: 0.105 },
      { kind: "amber", u: [0.86, 0.98], v: [0.6, 0.76], mirror: true, proud: 0.012 },
      { kind: "lens", u: [0.62, 0.8], v: [0.22, 0.32], mirror: true, round: 0.05 },
    ],
  },
  rear: {
    bow: 0.03, lean: 0, endWidth: 0.97, corner: 0.08, wrap: 0, wrapSegs: [],
    items: [
      { kind: "dark", u: [-1, 1], v: [0, 0.3] },
      { kind: "plate", u: [0.3, 0.72], v: [0.34, 0.45], proud: 0.014 },
      { kind: "tail", u: [0.8, 0.97], v: [0.46, 0.84], mirror: true, proud: 0.014 },
      { kind: "reflector", u: [0.66, 0.92], v: [0.12, 0.17], mirror: true, proud: 0.012 },
    ],
  },
  spokes: 6, wheelStyle: "steel", paint: BLACK,
};

/** Long, tall seven-seater on a truck-like stance. */
export const LARGE_SUV: CarSpec = {
  id: "large-suv",
  name: "Seven-seat SUV",
  klass: "Large SUV · 7 seats",
  category: "SUV",
  basis: "Generic model built in code, proportioned after the Toyota Fortuner class, built slightly shorter (4.70 m × 1.86 m × 1.80 m). Not a manufacturer asset.",
  length: 4.7, width: 1.86, height: 1.8, wheelbase: 2.75, frontOverhang: 0.93, clearance: 0.215, wheelRadius: 0.38, tyreWidth: 0.245,
  top: [[0, 1.1], [0.016, 1.46], [0.06, 1.72], [0.3, 1.785], [0.48, 1.8], [0.605, 1.77], [0.63, 1.74], [0.76, 1.24], [0.785, 1.215], [0.93, 1.16], [0.978, 1.1], [1, 0.96]],
  belt: [[0, 1.08], [0.08, 1.36], [0.2, 1.31], [0.34, 1.25], [0.76, 1.22], [0.8, 1.19], [1, 0.92]],
  tumblehome: 0.22,
  rearGlass: [0.018, 0.058], windshield: [0.638, 0.755], sideWindows: [0.085, 0.73], pillars: [0.275, 0.46], pillarWidth: 0.1, blackPillars: true,
  doorLines: [0.285, 0.46, 0.672],
  cladding: true, flare: 0.04, roofRails: true, twoTone: false, sideSteps: true, spare: false,
  front: {
    bow: 0.18, lean: 0.07, endWidth: 0.9, corner: 0.28, wrap: 0.2, wrapSegs: [7],
    items: [
      { kind: "dark", u: [-1, 1], v: [0, 0.24] },
      { kind: "satin", u: [-0.55, 0.55], v: [0.02, 0.14], proud: 0.012 },
      { kind: "lens", u: [0.7, 0.86], v: [0.26, 0.36], mirror: true, proud: 0.01 },
      { kind: "satin", u: [-0.6, 0.6], v: [0.4, 0.95, 0.5, 0.95] },
      { kind: "mesh", u: [-0.54, 0.54], v: [0.45, 0.9, 0.54, 0.9], bars: 3, barKind: "satin", proud: 0.009 },
      { kind: "plate", u: [-0.25, 0.25], v: [0.27, 0.42], proud: 0.016 },
      { kind: "lamp", u: [0.62, 1], v: [0.76, 0.93, 0.82, 0.96], mirror: true },
    ],
  },
  rear: {
    bow: 0.12, lean: 0.04, endWidth: 0.93, corner: 0.2, wrap: 0.16, wrapSegs: [7],
    items: [
      { kind: "dark", u: [-1, 1], v: [0, 0.24] },
      { kind: "satin", u: [-0.5, 0.5], v: [0.03, 0.12], proud: 0.012 },
      { kind: "reflector", u: [0.64, 0.92], v: [0.15, 0.2], mirror: true, proud: 0.012 },
      { kind: "plate", u: [-0.25, 0.25], v: [0.44, 0.58], proud: 0.014 },
      { kind: "satin", u: [-0.52, 0.52], v: [0.74, 0.8], proud: 0.012 },
      { kind: "tail", u: [0.52, 1], v: [0.7, 0.9, 0.78, 0.94], mirror: true },
      { kind: "lens", u: [0.52, 0.7], v: [0.7, 0.76], mirror: true, proud: 0.01 },
    ],
  },
  spokes: 6, wheelStyle: "split", paint: WHITE,
};

/** Vehicles the player can choose. The first is the default. */
export const PLAYER_CARS: readonly CarSpec[] = [COMPACT_SUV, COMPACT_SEDAN, PREMIUM_HATCH, OFFROAD_SUV, LARGE_SUV, HATCHBACK];
/** Vehicles used for traffic and parked cars. */
export const TRAFFIC_CARS: readonly CarSpec[] = [COMPACT_SEDAN, HATCHBACK, COMPACT_SUV, LARGE_SUV, PREMIUM_HATCH, OFFROAD_SUV];
export const ALL_CARS: readonly CarSpec[] = [COMPACT_SUV, COMPACT_SEDAN, HATCHBACK, LARGE_SUV, PREMIUM_HATCH, OFFROAD_SUV];

/** Size of the shape that stands in for a vehicle in collisions. It is separate from the drawn model. */
export interface CollisionBody {
  length: number;
  width: number;
  height: number;
  wheelbase: number;
  /** Two circles of this radius, one towards each end. */
  radius: number;
  /** Distance of each circle's centre from the middle of the vehicle. */
  offset: number;
}

export function collisionBody(spec: CarSpec): CollisionBody {
  const radius = spec.width / 2 + 0.07;
  return { length: spec.length, width: spec.width, height: spec.height, wheelbase: spec.wheelbase, radius, offset: spec.length / 2 + 0.05 - radius };
}

/** Common Indian car colours, linear RGB. Whites and silvers dominate real traffic. */
export const TRAFFIC_PAINTS: ReadonlyArray<Rgb3> = [WHITE, WHITE, SILVER, SILVER, GRAPHITE, BLACK, [0.36, 0.03, 0.03], BLUE, BRONZE];

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
