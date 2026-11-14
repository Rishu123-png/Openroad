import type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import "@babylonjs/core/Meshes/instancedMesh"; // registers Mesh.createInstance()
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { GeometryBuffer } from "../geometry/GeometryBuffer";
import { CROSS_FOOTPATH_INNER, FOOTPATH_INNER, FOOTPATH_OUTER, LAYOUT as L, SIDES, srgb } from "./layout";
import { count, type WorldContext } from "./WorldContext";

const GALVANISED = srgb(150, 154, 158);
const DARK = srgb(34, 36, 40);
const SIGNAL_YELLOW = srgb(222, 172, 30);

/** A 9 m lamp post with two arms, as used on divided roads. Arms reach along X, over both carriageways. */
export function streetLight(): GeometryBuffer {
  const g = new GeometryBuffer();
  g.box(0, 0, 0, 0.5, 0.35, 0.5, { color: srgb(120, 120, 116) });
  g.cylinder(0, 0.35, 0, 8.6, 0.11, 0.065, 8, GALVANISED);
  for (const s of SIDES) {
    g.beam([0, 8.7, 0], [s * 1.1, 9.35, 0], 0.07, GALVANISED);
    g.beam([s * 1.1, 9.35, 0], [s * 2.3, 9.55, 0], 0.07, GALVANISED);
    g.box(s * 2.65, 9.47, 0, 0.9, 0.13, 0.3, { color: srgb(196, 198, 200), bottom: true });
  }
  return g;
}

/** A signal mast: the arm reaches along +X and the lamps face -Z, toward approaching traffic. */
function trafficSignal(): GeometryBuffer {
  const g = new GeometryBuffer();
  g.cylinder(0, 0, 0, 6.3, 0.12, 0.09, 8, GALVANISED);
  g.beam([0, 6.1, 0], [6.2, 6.4, 0], 0.11, GALVANISED);
  const head = (x: number, y: number): void => {
    g.box(x, y, -0.02, 0.38, 1.08, 0.24, { color: SIGNAL_YELLOW, bottom: true });
    const lamps = [srgb(96, 18, 14), srgb(96, 70, 10), srgb(60, 235, 120)];
    lamps.forEach((color, i) => {
      const cy = y + 0.9 - i * 0.34;
      g.quad([[x - 0.11, cy - 0.11, -0.145], [x + 0.11, cy - 0.11, -0.145], [x + 0.11, cy + 0.11, -0.145], [x - 0.11, cy + 0.11, -0.145]], [0, 0, -1], [0, 0, 0.2, 0, 0.2, 0.2, 0, 0.2], color);
      // Visor above each lamp.
      g.box(x, cy + 0.12, -0.24, 0.26, 0.02, 0.2, { color: DARK, bottom: true });
    });
  };
  head(0.32, 2.7);
  head(3.4, 5.2);
  head(5.9, 5.25);
  return g;
}

export function buildFurniture(ctx: WorldContext): { casters: Array<Mesh | InstancedMesh> } {
  const { scene, materials, batch, random } = ctx;
  const casters: Array<Mesh | InstancedMesh> = [];

  const template = (name: string, geometry: GeometryBuffer, hideAt: number): Mesh => {
    const mesh = geometry.toMesh(name, scene);
    mesh.material = materials.metal;
    mesh.isVisible = false;
    mesh.addLODLevel(hideAt, null);
    return mesh;
  };
  const place = (mesh: Mesh, name: string, x: number, y: number, z: number, yaw = 0): void => {
    const instance = mesh.createInstance(name);
    instance.position.set(x, y, z);
    instance.rotation.y = yaw;
    instance.isPickable = false;
    instance.freezeWorldMatrix();
    casters.push(instance);
  };

  // Lamp posts down the median.
  const light = template("streetLight", streetLight(), 700);
  for (const sz of SIDES) {
    for (let d = L.medianGap + 4; d < L.detailHalfLength + 120; d += 36) {
      place(light, `streetLight_${sz}_${d}`, 0, L.medianHeight - 0.02, sz * d);
      count(ctx, "streetLights");
    }
  }
  // Single-sided lighting on the cross road reuses the same post, set back on the footpath.
  for (const sx of SIDES) {
    for (let d = 40; d < L.crossHalfLength; d += 40) {
      place(light, `crossLight_${sx}_${d}`, sx * d, L.kerbHeight, CROSS_FOOTPATH_INNER + 0.5, Math.PI / 2);
      count(ctx, "streetLights");
    }
  }

  // One signal mast per approach, on the left kerb at the stop line.
  const signal = template("trafficSignal", trafficSignal(), 500);
  const stopZ = L.crossHalfWidth + 4.8;
  const stopX = L.roadEdge + 4.7;
  place(signal, "signal_north", -(L.roadEdge + 0.8), L.kerbHeight, -stopZ, 0);
  place(signal, "signal_south", L.roadEdge + 0.8, L.kerbHeight, stopZ, Math.PI);
  place(signal, "signal_east", -stopX, L.kerbHeight, L.crossHalfWidth + 0.8, Math.PI / 2);
  place(signal, "signal_west", stopX, L.kerbHeight, -(L.crossHalfWidth + 0.8), -Math.PI / 2);
  count(ctx, "signals", 4);

  const sign = (x: number, y: number, z: number, yaw: number, which: 0 | 1): void => {
    batch.at("metal", x, z).cylinder(x, y, z, 2.5, 0.035, 0.035, 6, GALVANISED);
    const nz = Math.cos(yaw) * 0.045;
    batch.at("signs", x, z).disc([x, y + 2.25, z + nz], yaw, 0.3, which === 0 ? [0, 0, 0.5, 1] : [0.5, 0, 1, 1]);
    count(ctx, "signs");
  };
  // "Keep left" on each median nose, facing traffic leaving the junction.
  sign(0, L.medianHeight, L.medianGap + 1.2, Math.PI, 0);
  sign(0, L.medianHeight, -(L.medianGap + 1.2), 0, 0);
  // "No parking" along the footpaths, facing oncoming traffic on that side.
  for (const sx of SIDES) {
    for (const sz of SIDES) {
      for (let d = 46; d < L.detailHalfLength; d += 95) sign(sx * (FOOTPATH_INNER + 0.35), L.kerbHeight, sz * d, sx < 0 ? Math.PI : 0, 1);
    }
  }

  const metal = (x: number, z: number): GeometryBuffer => batch.at("metal", x, z);

  for (const sx of SIDES) {
    for (const sz of SIDES) {
      // Pedestrian guard rail along the kerb on each approach.
      const x = sx * (FOOTPATH_INNER + 0.12);
      const from = L.crossHalfWidth + 4.5;
      for (let d = from; d < from + 26; d += 2) {
        const g = metal(x, sz * d);
        g.beam([x, L.kerbHeight, sz * d], [x, L.kerbHeight + 1.05, sz * d], 0.06, GALVANISED);
        if (d + 2 < from + 26) {
          for (const h of [0.55, 1.02]) g.beam([x, L.kerbHeight + h, sz * d], [x, L.kerbHeight + h, sz * (d + 2)], 0.045, GALVANISED);
        }
      }
      // Bollards around the corner.
      for (let i = 0; i < 4; i++) {
        const bx = sx * (FOOTPATH_INNER + 0.3 + i * 0.75);
        const bz = sz * (CROSS_FOOTPATH_INNER + 0.3);
        metal(bx, bz).cylinder(bx, L.kerbHeight, bz, 0.85, 0.075, 0.075, 8, DARK, { topColor: SIGNAL_YELLOW });
      }
      // Twin litter bins and a utility cabinet here and there.
      for (let d = 34; d < L.detailHalfLength; d += random.range(60, 110)) {
        const px = sx * (FOOTPATH_OUTER - 0.45);
        const pz = sz * d;
        metal(px, pz).box(px, L.kerbHeight, pz - 0.28, 0.4, 0.75, 0.4, { color: srgb(40, 110, 70) });
        metal(px, pz).box(px, L.kerbHeight, pz + 0.28, 0.4, 0.75, 0.4, { color: srgb(36, 84, 150) });
        const cz = pz + random.range(12, 30);
        metal(px, cz).box(sx * (FOOTPATH_OUTER + 0.7), L.kerbHeight, cz, 0.5, 1.35, 1, { color: srgb(92, 112, 100) });
        count(ctx, "bins");
      }
    }
  }

  // Bus shelters on the kerbside of the footpath, one per direction.
  for (const sx of SIDES) {
    const cz = -sx * 78;
    const x0 = sx * (FOOTPATH_INNER + 1.1);
    const g = metal(x0, cz);
    const back = sx * (FOOTPATH_INNER + 2.1);
    for (const dz of [-3, 0, 3]) g.beam([back, L.kerbHeight, cz + dz], [back, L.kerbHeight + 2.55, cz + dz], 0.09, DARK);
    g.box(sx * (FOOTPATH_INNER + 1.35), L.kerbHeight + 2.5, cz, 2, 0.1, 6.6, { color: srgb(52, 88, 122), bottom: true });
    g.box(back + sx * 0.03, L.kerbHeight + 0.5, cz, 0.05, 1.6, 6, { color: srgb(206, 212, 214) });
    g.box(sx * (FOOTPATH_INNER + 1.75), L.kerbHeight + 0.42, cz, 0.4, 0.06, 4.4, { color: srgb(120, 96, 70), bottom: true });
    count(ctx, "busShelters");
  }

  return { casters };
}
