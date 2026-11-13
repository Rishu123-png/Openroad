import type { Color } from "../geometry/GeometryBuffer";
import type { MaterialKey } from "../materials/MaterialLibrary";
import { FACADE } from "../materials/proceduralTextures";
import { CROSS_VERGE_OUTER, LAYOUT as L, scale, SIDES, srgb, VERGE_OUTER } from "./layout";
import { count, type WorldContext } from "./WorldContext";

const FLOOR = FACADE.floorHeight;
const BAY = FACADE.bayWidth;

const WALL_TINTS = [srgb(236, 226, 204), srgb(226, 228, 226), srgb(240, 218, 196), srgb(244, 240, 228), srgb(214, 220, 224), srgb(232, 214, 180)];
const ACCENTS = [srgb(168, 84, 58), srgb(196, 150, 70), srgb(92, 116, 124), srgb(124, 66, 60), srgb(84, 96, 82)];
const GLASS_TINTS: Color[] = [[0.96, 1, 1.03], [1, 1.02, 0.97], [1.06, 0.98, 0.88], [0.9, 0.95, 1], [0.82, 0.85, 0.88]];
const SIGN_COLOURS = [srgb(176, 44, 40), srgb(34, 84, 140), srgb(226, 176, 44), srgb(36, 110, 84), srgb(230, 230, 224), srgb(60, 60, 66), srgb(200, 98, 36)];
const ROOF = srgb(150, 146, 140);
const TANK = srgb(34, 34, 36);

/** Places boxes for one plot. `out` is the distance from the road centre line, `along` runs parallel to the road. */
class Plot {
  constructor(
    private readonly ctx: WorldContext,
    private readonly side: number,
    private readonly centre: number,
  ) {}

  x(out: number): number {
    return this.side * out;
  }

  z(along: number): number {
    return this.centre + along;
  }

  /** A box from `out0` to `out1` and `along0` to `along1`, standing on `y0`. */
  box(layer: MaterialKey, out0: number, out1: number, along0: number, along1: number, y0: number, height: number, color?: Color, top = false): void {
    const cx = this.x((out0 + out1) / 2);
    const cz = this.z((along0 + along1) / 2);
    this.ctx.batch.at(layer, cx, cz).box(cx, y0, cz, Math.abs(out1 - out0), height, Math.abs(along1 - along0), { color, top });
  }

  /** A flat roof with a parapet, and the usual rooftop clutter. */
  roof(out0: number, out1: number, along0: number, along1: number, y: number, wall: Color, tanks: number): void {
    const { ctx } = this;
    const cx = this.x((out0 + out1) / 2);
    const cz = this.z((along0 + along1) / 2);
    const b = ctx.batch.at("plaster", cx, cz);
    b.rectY(Math.min(this.x(out0), this.x(out1)), this.z(along0), Math.max(this.x(out0), this.x(out1)), this.z(along1), y, { color: ROOF });
    const t = 0.25;
    this.box("plaster", out0, out0 + t, along0, along1, y, 1, wall, true);
    this.box("plaster", out1 - t, out1, along0, along1, y, 1, wall, true);
    this.box("plaster", out0, out1, along0, along0 + t, y, 1, wall, true);
    this.box("plaster", out0, out1, along1 - t, along1, y, 1, wall, true);
    for (let i = 0; i < tanks; i++) {
      const o = ctx.random.range(out0 + 2, out1 - 2);
      const a = ctx.random.range(along0 + 2, along1 - 2);
      if (ctx.random.chance(0.7)) {
        b.box(this.x(o), y, this.z(a), 1.8, 0.6, 1.8, { color: ROOF });
        b.cylinder(this.x(o), y + 0.6, this.z(a), 1.5, 0.75, 0.7, 10, TANK);
      } else {
        // Stair or lift head room.
        b.box(this.x(o), y, this.z(a), 3, 2.6, 3.6, { color: scale(wall, 0.92) });
      }
    }
  }

  tree(kind: "broad" | "columnar" | "palm", out: number, along: number, size = 1): void {
    this.ctx.trees.push({ kind, x: this.x(out), z: this.z(along), y: 0.02, scale: size });
  }

  /** A boundary wall along the plot front with a gap for the gate. */
  wall(out: number, along0: number, along1: number, height: number, color: Color, gateAt: number, gateWidth: number): void {
    const cap = scale(color, 0.7);
    const run = (a0: number, a1: number): void => {
      if (a1 - a0 < 0.5) return;
      this.box("plaster", out, out + 0.23, a0, a1, 0, height, color, true);
      this.box("plaster", out - 0.04, out + 0.27, a0, a1, height, 0.1, cap, true);
    };
    run(along0, gateAt - gateWidth / 2);
    run(gateAt + gateWidth / 2, along1);
    for (const s of SIDES) {
      const a = gateAt + (s * gateWidth) / 2;
      this.box("plaster", out - 0.15, out + 0.4, a - 0.3, a + 0.3, 0, height + 0.5, cap, true);
    }
  }
}

/** Shops at street level under two to five floors of offices. */
function commercialBlock(ctx: WorldContext, side: number, centre: number, width: number): void {
  const { random } = ctx;
  const p = new Plot(ctx, side, centre);
  const front = 30 + random.int(0, 2) * 2;
  const depth = BAY * random.int(6, 8);
  const floors = random.int(2, 5);
  const upper: MaterialKey = random.chance(0.6) ? "ribbon" : random.chance(0.5) ? "glass" : "residential";
  const tint = upper === "glass" ? random.pick(GLASS_TINTS) : random.pick(WALL_TINTS);
  const a0 = -width / 2;
  const a1 = width / 2;
  const top = 4 + floors * FLOOR;

  p.box("concrete", front - 1.6, front, a0, a1, 0, 0.3, undefined, true); // entrance plinth
  p.box("shopfront", front, front + depth, a0, a1, 0, 4);
  p.box(upper, front, front + depth, a0, a1, 4, floors * FLOOR, tint);
  p.roof(front, front + depth, a0, a1, top, upper === "glass" ? srgb(196, 198, 200) : tint, random.int(2, 4));

  // Awning slab and a row of blank signboards, one per shop.
  p.box("plaster", front - 1.3, front, a0, a1, 3.55, 0.14, srgb(190, 186, 178), true);
  for (let a = a0; a < a1 - 0.1; ) {
    const w = Math.min(BAY * random.int(1, 3), a1 - a);
    p.box("metal", front - 1.42, front - 1.3, a + 0.12, a + w - 0.12, 3.0, 1.05, random.pick(SIGN_COLOURS), true);
    a += w;
  }

  // Parking bays on the apron.
  for (let a = a0 + 1; a < a1 - 1; a += 2.6) {
    const x0 = p.x(VERGE_OUTER + 1);
    const x1 = p.x(VERGE_OUTER + 6);
    ctx.batch.at("roadPaint", x0, p.z(a)).rectY(Math.min(x0, x1), p.z(a) - 0.06, Math.max(x0, x1), p.z(a) + 0.06, 0.03, { color: [0.8, 0.8, 0.8] });
  }
  count(ctx, "buildings");
}

/** A glass office tower on a wider podium. */
function officeTower(ctx: WorldContext, side: number, centre: number, width: number): void {
  const { random } = ctx;
  const p = new Plot(ctx, side, centre);
  const front = 32 + random.int(0, 3) * 2;
  const podiumDepth = BAY * 9;
  const a0 = -width / 2;
  const a1 = width / 2;
  const glassTint = random.pick(GLASS_TINTS);
  const stone = random.pick(WALL_TINTS);
  const podium: MaterialKey = random.chance(0.5) ? "glass" : "ribbon";

  p.box("shopfront", front, front + podiumDepth, a0, a1, 0, 4);
  p.box(podium, front, front + podiumDepth, a0, a1, 4, FLOOR * 2, podium === "glass" ? glassTint : stone);
  const podiumTop = 4 + FLOOR * 2;
  p.roof(front, front + podiumDepth, a0, a1, podiumTop, stone, 1);

  const floors = random.int(9, 19);
  const inset = BAY * random.int(1, 2);
  const t0 = a0 + inset;
  const t1 = a1 - inset;
  const tFront = front + BAY;
  const tBack = tFront + BAY * 6;
  const height = floors * FLOOR;
  p.box("glass", tFront, tBack, t0, t1, podiumTop, height, glassTint);
  // Solid service core on one end, taller than the glass.
  const coreEnd = random.pick(SIDES);
  const c0 = coreEnd < 0 ? t0 - 0.4 : t1 - 4.5;
  p.box("plaster", tFront + 1.5, tBack - 1.5, c0, c0 + 4.9, podiumTop, height + 3.5, stone, true);
  p.roof(tFront, tBack, t0, t1, podiumTop + height, srgb(190, 194, 198), 2);
  if (random.chance(0.6)) {
    // Louvred plant enclosure.
    p.box("metal", tFront + 3, tBack - 3, t0 + 4, t1 - 4, podiumTop + height, 2.8, srgb(150, 154, 158), true);
  }
  for (const a of [a0 + 3, a1 - 3]) p.tree("palm", VERGE_OUTER + 4, a);
  count(ctx, "buildings");
}

/** A gated housing society: two or three matching apartment towers behind a boundary wall. */
function housingSociety(ctx: WorldContext, side: number, centre: number, width: number): void {
  const { random } = ctx;
  const p = new Plot(ctx, side, centre);
  const wall = random.pick(WALL_TINTS);
  const accent = random.pick(ACCENTS);
  const towers = width > 72 ? 3 : 2;
  const towerWidth = BAY * 6;
  const depth = BAY * 5;
  const baseFloors = random.int(11, 20);
  const front = 42 + random.int(0, 3) * 2;
  const pitch = width / towers;

  p.wall(VERGE_OUTER + 0.8, -width / 2, width / 2, 1.7, wall, 0, 7);
  // Guard cabin beside the gate.
  p.box("plaster", VERGE_OUTER + 1.6, VERGE_OUTER + 4.2, 4.2, 6.8, 0, 2.7, scale(wall, 0.95), true);
  // Lawn between wall and towers.
  const lx0 = p.x(VERGE_OUTER + 5);
  const lx1 = p.x(front - 3);
  for (const s of SIDES) {
    const z0 = p.z(s < 0 ? -width / 2 + 1 : 5);
    const z1 = p.z(s < 0 ? -5 : width / 2 - 1);
    ctx.batch.at("grass", (lx0 + lx1) / 2, (z0 + z1) / 2).rectY(Math.min(lx0, lx1), z0, Math.max(lx0, lx1), z1, 0.04, { cell: 4, tint: (x, z) => {
      const n = 0.8 + ((Math.sin(x * 0.7) + Math.cos(z * 0.9)) * 0.06);
      return [n * 0.8, n, n * 0.8];
    } });
  }

  for (let i = 0; i < towers; i++) {
    const mid = -width / 2 + pitch * (i + 0.5);
    const floors = baseFloors + random.int(-1, 2);
    const height = floors * FLOOR;
    const t0 = mid - towerWidth / 2;
    const t1 = mid + towerWidth / 2;
    p.box("residential", front, front + depth, t0, t1, 0, height, wall);
    // Projecting stair and lift shaft in the accent colour, rising above the roof.
    p.box("plaster", front - 0.5, front + depth + 0.5, mid - 1.5, mid + 1.5, 0, height + 3.2, accent, true);
    p.roof(front, front + depth, t0, t1, height, wall, 2);
    // Balconies: a slab and a solid parapet on every floor, either side of the shaft.
    for (let f = 1; f < floors; f++) {
      for (const s of SIDES) {
        const b0 = mid + s * 2.3;
        const b1 = mid + s * 7.4;
        p.box("plaster", front - 1.25, front, Math.min(b0, b1), Math.max(b0, b1), f * FLOOR - 0.12, 0.12, scale(wall, 0.85), true);
        p.box("plaster", front - 1.25, front - 1.15, Math.min(b0, b1), Math.max(b0, b1), f * FLOOR, 1, f % 4 === 0 ? accent : wall, true);
      }
    }
    p.tree("broad", front - 8, mid - pitch / 2 + 2, 0.9);
    p.tree(random.chance(0.5) ? "columnar" : "broad", front - 12, mid + 4, 1);
    count(ctx, "buildings");
  }
  // Ashoka trees along the inside of the wall.
  for (let a = -width / 2 + 2; a < width / 2 - 1; a += 3.4) {
    if (Math.abs(a) > 6) p.tree("columnar", VERGE_OUTER + 2.6, a, 0.85 + random.next() * 0.3);
  }
}

/** A terrace of two- and three-storey houses, each painted differently. */
function houseRow(ctx: WorldContext, side: number, centre: number, width: number): void {
  const { random } = ctx;
  const p = new Plot(ctx, side, centre);
  const front = 29;
  const houses = Math.round(width / (BAY * 3));
  const houseWidth = width / houses;
  for (let i = 0; i < houses; i++) {
    const a0 = -width / 2 + i * houseWidth;
    const a1 = a0 + houseWidth - 0.05;
    const floors = random.int(2, 3);
    const depth = BAY * random.int(4, 5);
    const setback = random.int(0, 1) * 1.5;
    const wall = random.pick(WALL_TINTS);
    p.box("residential", front + setback, front + setback + depth, a0, a1, 0, floors * FLOOR, wall);
    p.roof(front + setback, front + setback + depth, a0, a1, floors * FLOOR, wall, 1);
    // Front balcony and porch slab.
    p.box("plaster", front + setback - 1.4, front + setback, a0 + 0.4, a1 - 0.4, FLOOR - 0.12, 0.14, scale(wall, 0.85), true);
    p.box("plaster", front + setback - 1.4, front + setback - 1.3, a0 + 0.4, a1 - 0.4, FLOOR, 0.95, random.chance(0.4) ? random.pick(ACCENTS) : wall, true);
    p.wall(VERGE_OUTER + 2.2, a0, a1, 1.5, scale(wall, 0.96), a0 + houseWidth * 0.3, 3);
    if (random.chance(0.45)) p.tree(random.chance(0.6) ? "broad" : "columnar", VERGE_OUTER + 4.4, a0 + houseWidth * 0.72, 0.6);
    count(ctx, "buildings");
  }
}

/** Free-standing towers set back behind the street, giving the district depth. */
function backTower(ctx: WorldContext, x: number, z: number): void {
  const { random } = ctx;
  const p = new Plot(ctx, Math.sign(x), z);
  const out = Math.abs(x);
  const glassy = random.chance(0.3);
  const w = BAY * random.int(5, 8);
  const d = BAY * random.int(4, 6);
  const floors = random.int(12, 28);
  const tint = glassy ? random.pick(GLASS_TINTS) : random.pick(WALL_TINTS);
  // Paved plinth, so the tower does not stand directly on open land.
  const px0 = p.x(out - 7);
  const px1 = p.x(out + d + 5);
  ctx.batch.at("concrete", (px0 + px1) / 2, z).rectY(Math.min(px0, px1), z - w / 2 - 6, Math.max(px0, px1), z + w / 2 + 6, 0.02, { color: [0.85, 0.85, 0.85] });
  p.box(glassy ? "glass" : "residential", out, out + d, -w / 2, w / 2, 0, floors * FLOOR, tint);
  p.box("plaster", out + 1, out + d - 1, -1.6, 1.6, 0, floors * FLOOR + 3, glassy ? srgb(200, 202, 204) : random.pick(ACCENTS), true);
  p.roof(out, out + d, -w / 2, w / 2, floors * FLOOR, glassy ? srgb(190, 194, 198) : tint, 1);
  count(ctx, "buildings");
}

export function buildBuildings(ctx: WorldContext): void {
  const { random } = ctx;
  const kinds = [commercialBlock, commercialBlock, officeTower, housingSociety, houseRow] as const;

  for (const side of SIDES) {
    for (const dir of SIDES) {
      // Street-front plots, marching away from the junction.
      let d = CROSS_VERGE_OUTER + 6;
      let previous: unknown = null;
      while (d < L.detailHalfLength - 30) {
        let kind = random.pick(kinds);
        if (kind === previous) kind = random.pick(kinds); // discourage repeats
        previous = kind;
        const width =
          kind === housingSociety ? BAY * random.int(20, 28) : kind === officeTower ? BAY * random.int(10, 14) : kind === houseRow ? BAY * 3 * random.int(3, 5) : BAY * random.int(7, 13);
        kind(ctx, side, dir * (d + width / 2), width);
        d += width + random.range(6, 14);
      }
      // Towers behind the street front.
      for (let z = 40; z < L.detailHalfLength + 60; z += random.range(42, 75)) {
        backTower(ctx, side * random.range(96, 150), dir * z);
        if (random.chance(0.5)) backTower(ctx, side * random.range(190, 260), dir * (z + random.range(-15, 15)));
      }
    }
  }

  // Distant skyline: plain towers in one mesh per material. Haze does the rest.
  for (let i = 0; i < 170; i++) {
    const angle = random.range(0, Math.PI * 2);
    const radius = random.range(330, 1150);
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    if (Math.abs(x) < 80 + Math.abs(z) * 0.14 || (Math.abs(z) < 60 && Math.abs(x) < L.crossHalfLength + 40)) continue; // keep the road vistas open
    const glassy = random.chance(0.25);
    const layer: MaterialKey = glassy ? "glass" : "residential";
    const w = BAY * random.int(6, 12);
    const d = BAY * random.int(5, 9);
    const h = FLOOR * random.int(8, 34);
    const tint = glassy ? random.pick(GLASS_TINTS) : random.pick(WALL_TINTS);
    ctx.batch.at(layer, x, z, "skyline").box(x, 0, z, w, h, d, { color: tint, yaw: random.pick([0, 0, 0.35, -0.5]), topColor: ROOF });
    count(ctx, "skylineTowers");
  }
}
