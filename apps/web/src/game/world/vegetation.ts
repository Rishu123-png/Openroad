import type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import "@babylonjs/core/Meshes/instancedMesh"; // registers Mesh.createInstance()
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Random } from "../../utils/random";
import { type Color, GeometryBuffer } from "../geometry/GeometryBuffer";
import { CROSS_FOOTPATH_OUTER, FOOTPATH_OUTER, LAYOUT as L, scale, SIDES, srgb } from "./layout";
import { count, type TreeKind, type WorldContext } from "./WorldContext";

const BARK = srgb(84, 70, 58);
const PALM_BARK = srgb(138, 126, 110);

function crownColour(low: Color, high: Color): (height: number, noise: number) => Color {
  return (height, noise) => {
    // Darker underneath and inside, lighter where the sun reaches.
    const light = 0.62 + height * 0.6 + (noise - 0.5) * 0.22;
    const t = Math.min(1, Math.max(0, height * 1.1));
    return [
      (low[0] + (high[0] - low[0]) * t) * light,
      (low[1] + (high[1] - low[1]) * t) * light,
      (low[2] + (high[2] - low[2]) * t) * light,
    ];
  };
}

/** A spreading shade tree such as neem or peepal. Each seed gives a different silhouette. */
function broadTree(seed: number, detail: number): GeometryBuffer {
  const r = new Random(seed);
  const g = new GeometryBuffer();
  const trunk = r.range(2.8, 3.8);
  g.cylinder(0, 0, 0, trunk, 0.26, 0.18, detail < 1 ? 5 : 8, BARK, { cap: false, lean: [r.range(-0.2, 0.2), r.range(-0.2, 0.2)] });
  const colour = crownColour(srgb(58, 92, 44), srgb(122 + r.range(-12, 14), 156 + r.range(-10, 10), 72));
  const lobes = detail < 1 ? 3 : r.int(5, 7);
  for (let i = 0; i < lobes; i++) {
    const a = (i / lobes) * Math.PI * 2 + r.range(-0.4, 0.4);
    const d = i === 0 ? 0 : r.range(1.2, 2.3);
    const size = i === 0 ? r.range(2.4, 3) : r.range(1.6, 2.4);
    const cx = Math.cos(a) * d;
    const cz = Math.sin(a) * d;
    const cy = trunk + 1.6 + (i === 0 ? 1.1 : r.range(-0.4, 0.9));
    if (detail >= 1 && i > 0) g.beam([0, trunk - 0.3, 0], [cx * 0.7, cy - 0.6, cz * 0.7], 0.13, BARK);
    g.blob(cx, cy, cz, size, size * r.range(0.72, 0.9), size, seed * 13 + i, colour, detail);
  }
  return g;
}

/** A tall narrow evergreen, like the ashoka trees planted along Indian boundary walls. */
function columnarTree(seed: number, detail: number): GeometryBuffer {
  const r = new Random(seed);
  const g = new GeometryBuffer();
  g.cylinder(0, 0, 0, 1.6, 0.12, 0.1, 6, BARK, { cap: false });
  const colour = crownColour(srgb(40, 74, 40), srgb(84, 128, 62));
  const tiers = detail < 1 ? 2 : 4;
  const height = r.range(6.5, 8.5);
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const y = 1.6 + t * (height - 2.4);
    const radius = 1.05 - t * 0.5;
    g.blob(r.range(-0.1, 0.1), y, r.range(-0.1, 0.1), radius, (height / tiers) * 0.75, radius, seed * 7 + i, colour, detail);
  }
  return g;
}

/** A royal palm: smooth grey trunk, green crown shaft and drooping fronds. */
function palmTree(seed: number, detail: number): GeometryBuffer {
  const r = new Random(seed);
  const g = new GeometryBuffer();
  const height = r.range(7.5, 10);
  const lean: [number, number] = [r.range(-0.5, 0.5), r.range(-0.5, 0.5)];
  g.cylinder(0, 0, 0, height, 0.27, 0.17, detail < 1 ? 5 : 9, PALM_BARK, { cap: false, lean });
  g.cylinder(lean[0], height, lean[1], 1.1, 0.19, 0.11, 7, srgb(96, 128, 62), { cap: false });
  const top = height + 1;
  const fronds = detail < 1 ? 7 : 13;
  const segments = detail < 1 ? 2 : 4;
  const leaf = srgb(96, 138, 62);
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2 + r.range(-0.2, 0.2);
    const length = r.range(2.8, 3.6);
    const rise = r.range(0.2, 1.1);
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const px = -dz;
    const pz = dx;
    let prev: [number, number, number] = [lean[0], top, lean[1]];
    let prevWidth = 0.28;
    for (let s = 1; s <= segments; s++) {
      const t = s / segments;
      // Fronds rise, then arc over and hang.
      const y = top + rise * Math.sin(t * Math.PI * 0.8) * 1.3 - t * t * 1.9;
      const next: [number, number, number] = [lean[0] + dx * length * t, y, lean[1] + dz * length * t];
      const width = 0.42 * (1 - t * 0.85) + 0.05;
      const shade = scale(leaf, 0.75 + t * 0.45);
      g.quad(
        [
          [prev[0] - px * prevWidth, prev[1], prev[2] - pz * prevWidth],
          [prev[0] + px * prevWidth, prev[1], prev[2] + pz * prevWidth],
          [next[0] + px * width, next[1], next[2] + pz * width],
          [next[0] - px * width, next[1], next[2] - pz * width],
        ],
        [0, 1, 0],
        [0, 0, 0.6, 0, 0.6, 1, 0, 1],
        shade,
      );
      prev = next;
      prevWidth = width;
    }
  }
  return g;
}

function shrub(seed: number, flowering: boolean): GeometryBuffer {
  const r = new Random(seed);
  const g = new GeometryBuffer();
  const green = crownColour(srgb(52, 88, 42), srgb(116, 152, 68));
  const bloom = crownColour(srgb(60, 80, 40), flowering && seed % 2 === 0 ? srgb(214, 70, 132) : srgb(232, 150, 52));
  for (let i = 0; i < 3; i++) {
    const size = r.range(0.45, 0.7);
    g.blob(r.range(-0.4, 0.4), size * 0.8, (i - 1) * 0.55, size, size * 0.85, size, seed * 5 + i, flowering && i !== 1 ? bloom : green, 0.7);
  }
  return g;
}

interface Variant {
  mesh: Mesh;
  castsShadow: boolean;
}

/** Turns the collected planting spots into instances of a few shared meshes. */
export function plantVegetation(ctx: WorldContext): { casters: Array<Mesh | InstancedMesh> } {
  const { scene, materials, random } = ctx;

  const make = (name: string, near: GeometryBuffer, far: GeometryBuffer | null, lodAt: number, hideAt: number, castsShadow: boolean): Variant => {
    const mesh = near.toMesh(name, scene);
    mesh.material = materials.foliage;
    mesh.isVisible = false; // template only; instances are drawn
    // Crowns are shaded by their vertex colours; sampling the shadow map on
    // such bumpy shapes only adds speckle and cost.
    mesh.receiveShadows = false;
    if (far) {
      const low = far.toMesh(`${name}_far`, scene);
      low.material = materials.foliage;
      low.isVisible = false;
      mesh.addLODLevel(lodAt, low);
    }
    mesh.addLODLevel(hideAt, null);
    return { mesh, castsShadow };
  };

  const variants: Record<TreeKind, Variant[]> = {
    broad: [1, 2, 3, 4].map((s) => make(`treeBroad${s}`, broadTree(100 + s, 1), broadTree(100 + s, 0.5), 150, 620, true)),
    columnar: [1, 2].map((s) => make(`treeColumnar${s}`, columnarTree(200 + s, 1), columnarTree(200 + s, 0.5), 150, 620, true)),
    palm: [1, 2, 3].map((s) => make(`treePalm${s}`, palmTree(300 + s, 1), palmTree(300 + s, 0.5), 150, 620, true)),
    shrub: [1, 2].map((s) => make(`shrub${s}`, shrub(400 + s, false), null, 0, 240, false)),
    flowering: [1, 2].map((s) => make(`shrubFlowering${s}`, shrub(500 + s, true), null, 0, 240, false)),
  };

  // Avenue trees on the verges of both roads.
  for (const sx of SIDES) {
    for (const sz of SIDES) {
      for (let d = CROSS_FOOTPATH_OUTER + 5; d < L.detailHalfLength; d += random.range(8.5, 14)) {
        const roll = random.next();
        ctx.trees.push({
          kind: roll < 0.72 ? "broad" : roll < 0.86 ? "palm" : "columnar",
          x: sx * (FOOTPATH_OUTER + random.range(2, 4.2)),
          z: sz * d,
          y: L.kerbHeight - 0.03,
          scale: random.range(0.8, 1.25),
        });
      }
      for (let d = FOOTPATH_OUTER + 9; d < L.crossHalfLength - 10; d += random.range(10, 17)) {
        ctx.trees.push({ kind: random.chance(0.8) ? "broad" : "palm", x: sx * d, z: sz * (CROSS_FOOTPATH_OUTER + random.range(2, 4)), y: L.kerbHeight - 0.03, scale: random.range(0.8, 1.2) });
      }
      // Scattered trees on open land behind the plots.
      for (let i = 0; i < 26; i++) {
        ctx.trees.push({ kind: "broad", x: sx * random.range(66, 300), z: sz * random.range(24, L.detailHalfLength), scale: random.range(0.9, 1.5) });
      }
    }
  }

  // Median planting: a hedge of shrubs, flowering every so often, with palms between the lamp posts.
  for (const sz of SIDES) {
    for (let d = L.medianGap + 3; d < L.detailHalfLength; d += 1.9) {
      const kind: TreeKind = Math.floor(d / 11) % 3 === 0 ? "flowering" : "shrub";
      ctx.trees.push({ kind, x: random.range(-0.25, 0.25), z: sz * d, y: L.medianHeight - 0.02, scale: random.range(0.8, 1.2) });
    }
    for (let d = L.medianGap + 22; d < L.detailHalfLength; d += 36) {
      ctx.trees.push({ kind: "palm", x: 0, z: sz * d, y: L.medianHeight - 0.02, scale: random.range(0.85, 1.05) });
    }
  }

  const casters: Array<Mesh | InstancedMesh> = [];
  for (const [index, spot] of ctx.trees.entries()) {
    const variant = random.pick(variants[spot.kind]);
    const instance = variant.mesh.createInstance(`${spot.kind}_${index}`);
    const size = spot.scale ?? 1;
    instance.position.set(spot.x, spot.y ?? 0, spot.z);
    instance.rotation.y = random.range(0, Math.PI * 2);
    // Uneven scaling makes instances of one mesh read as different trees.
    instance.scaling.set(size * random.range(0.9, 1.1), size * random.range(0.88, 1.15), size * random.range(0.9, 1.1));
    instance.isPickable = false;
    instance.freezeWorldMatrix();
    if (variant.castsShadow) casters.push(instance);
    count(ctx, spot.kind === "shrub" || spot.kind === "flowering" ? "shrubs" : "trees");
  }
  return { casters };
}
