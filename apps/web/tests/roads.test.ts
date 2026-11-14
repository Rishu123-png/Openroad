import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import type { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BuildingIndex } from "../src/game/district/BuildingIndex";
import { DISTRICT_ASSUMPTIONS } from "../src/game/district/createDistrictWorld";
import { DECORATION_RULES, placeDecorations } from "../src/game/district/decorations";
import { addDisc, addStrip, offsetLine } from "../src/game/district/roadGeometry";
import { addJunctionMarkings, addLaneMarkings, addSpeedBreaker, MARKING_RULES } from "../src/game/district/roadMarkings";
import { SegmentGrid } from "../src/game/district/SegmentGrid";
import { pointInPolygons } from "../src/game/district/spawn";
import type { DistrictData, DistrictJunction, DistrictRoad, Point } from "../src/game/district/types";
import { DistrictGame } from "../src/game/engine/DistrictGame";
import { GeometryBuffer } from "../src/game/geometry/GeometryBuffer";
import { testDistrict } from "./fixtures/district";
import { distanceToLine, keyboard, meshProblems, nullEngine, triangleAreas } from "./support/harness";

const NONE = new SegmentGrid(50);
const base = (): DistrictRoad => testDistrict().roads[0]!; // tertiary, 8 m, source width, along z = 0
const road = (over: Partial<DistrictRoad> = {}): DistrictRoad => ({ ...base(), ...over });

/** Quads of a buffer as [centreX, centreZ, lengthX, lengthZ]. */
function quads(g: GeometryBuffer): Array<{ x: number; z: number; sx: number; sz: number }> {
  const out = [];
  for (let i = 0; i < g.positions.length; i += 12) {
    const xs = [0, 3, 6, 9].map((k) => g.positions[i + k]!), zs = [2, 5, 8, 11].map((k) => g.positions[i + k]!);
    out.push({ x: (Math.min(...xs) + Math.max(...xs)) / 2, z: (Math.min(...zs) + Math.max(...zs)) / 2, sx: Math.max(...xs) - Math.min(...xs), sz: Math.max(...zs) - Math.min(...zs) });
  }
  return out;
}

describe("road surface geometry", () => {
  const BENDS: Array<[string, Point[]]> = [
    ["straight", [[0, 0], [100, 0]]],
    ["right angle", [[0, 0], [60, 0], [60, 60]]],
    ["gentle curve", Array.from({ length: 20 }, (_, i): Point => [i * 10, Math.sin(i / 3) * 12])],
    ["hairpin", [[0, 0], [80, 0], [0, 6]]],
    ["repeated point", [[0, 0], [40, 0], [40, 0], [80, 10]]],
    ["closed loop", [[0, 0], [50, 0], [50, 50], [0, 50], [0, 0]]],
  ];

  it("keeps the mapped centre line in the middle of the surface, at the stated width on straights", () => {
    for (const [name, points] of BENDS) {
      const width = 7;
      const left = offsetLine(points, width / 2), right = offsetLine(points, -width / 2);
      expect(left).toHaveLength(points.length);
      points.forEach((p, i) => {
        // The two edges are symmetric about the mapped point: its alignment is not shifted.
        expect((left[i]![0] + right[i]![0]) / 2, `${name} point ${i}`).toBeCloseTo(p[0], 9);
        expect((left[i]![1] + right[i]![1]) / 2, `${name} point ${i}`).toBeCloseTo(p[1], 9);
        const across = Math.hypot(left[i]![0] - right[i]![0], left[i]![1] - right[i]![1]);
        expect(across).toBeGreaterThanOrEqual(width - 1e-9); // never narrower than stated
        expect(across).toBeLessThanOrEqual(width * 2.5 + 1e-9); // and a sharp bend cannot throw a spike
      });
    }
    const straight = offsetLine([[0, 0], [100, 0]], 3.5);
    expect(straight).toEqual([[0, 3.5], [100, 3.5]]); // left of travel toward +X is +Z
  });

  it("builds one continuous strip: consecutive pieces share their edge, with no gap or overlap at a bend", () => {
    for (const [name, points] of BENDS) {
      const g = new GeometryBuffer();
      addStrip(g, points, 3.5, -3.5, 0.03, [1, 1, 1]);
      expect(meshProblems(name, g)).toEqual([]);
      expect(g.positions.length / 12).toBe(points.length - 1);
      for (let q = 1; q < points.length - 1; q++) {
        const previous = (q - 1) * 12, next = q * 12;
        // Quad corners are a(left start), b(left end), c(right end), d(right start): the end of one is the start of the next.
        expect([g.positions[previous + 3], g.positions[previous + 5]], `${name} left edge at point ${q}`).toEqual([g.positions[next], g.positions[next + 2]]);
        expect([g.positions[previous + 6], g.positions[previous + 8]], `${name} right edge at point ${q}`).toEqual([g.positions[next + 9], g.positions[next + 11]]);
      }
      for (let i = 1; i < g.positions.length; i += 3) expect(g.positions[i]).toBe(0.03);
      for (let i = 1; i < g.normals.length; i += 3) expect(g.normals[i]).toBe(1);
      // Texture coordinates are world metres, so two roads meeting at a junction line up.
      for (let v = 0; v < g.positions.length / 3; v++) expect([g.uvs[v * 2], g.uvs[v * 2 + 1]]).toEqual([g.positions[v * 3], g.positions[v * 3 + 2]]);
    }
  });

  it("covers the whole of a junction: the disc reaches every corner between the arms", () => {
    const g = new GeometryBuffer();
    addDisc(g, 10, -5, 4, 0.03, [1, 1, 1]);
    expect(meshProblems("disc", g)).toEqual([]);
    const area = triangleAreas(g.positions, g.indices).reduce((a, b) => a + b, 0);
    expect(area).toBeGreaterThan(Math.PI * 16 * 0.95); // a 14-sided polygon is within 5% of the circle
    expect(area).toBeLessThanOrEqual(Math.PI * 16);
    for (let i = 0; i < g.positions.length; i += 3) expect(Math.hypot(g.positions[i]! - 10, g.positions[i + 2]! + 5)).toBeCloseTo(4, 9);
  });
});

describe("road surfaces in the district", () => {
  let engine: NullEngine;
  let kb: ReturnType<typeof keyboard>;
  beforeEach(() => {
    engine = nullEngine();
    kb = keyboard();
  });
  afterEach(() => {
    kb.input.dispose();
    engine.dispose();
  });

  /** Every vertex of the meshes of one material layer, with its colour in the current data view. */
  function* vertices(game: DistrictGame, layer: string): Generator<{ x: number; y: number; z: number; colour: [number, number, number] }> {
    for (const mesh of game.scene.meshes.filter((m) => m.name.startsWith(`${layer}@`))) {
      const p = mesh.getVerticesData(VertexBuffer.PositionKind)!, c = mesh.getVerticesData(VertexBuffer.ColorKind)!;
      for (let v = 0; v < p.length / 3; v++) yield { x: p[v * 3]!, y: p[v * 3 + 1]!, z: p[v * 3 + 2]!, colour: [+c[v * 4]!.toFixed(2), +c[v * 4 + 1]!.toFixed(2), +c[v * 4 + 2]!.toFixed(2)] };
    }
  }
  const GREEN = [0.1, 0.65, 0.15], ORANGE = [0.9, 0.4, 0.05], MAGENTA = [0.9, 0.05, 0.7], CYAN = [0.05, 0.7, 0.8], BLUE = [0.1, 0.25, 0.85];

  it("draws each carriageway on its mapped line at its own width", () => {
    const district = testDistrict();
    const game = new DistrictGame({ engine, input: kb.input, district });
    // Asphalt away from the junction: the 8 m tertiary road spans z = -4..4, the 6 m residential x = -3..3.
    let eastWest = 0, northSouth = 0;
    for (const v of vertices(game, "asphalt")) {
      if (Math.hypot(v.x, v.z) < 6) continue; // the junction disc
      if (Math.abs(v.z) <= 4.001) eastWest = Math.max(eastWest, Math.abs(v.z));
      else northSouth = Math.max(northSouth, Math.abs(v.x));
      expect(Math.abs(v.z) <= 4.001 || Math.abs(v.x) <= 3.001, `asphalt at ${v.x}, ${v.z} is off both roads`).toBe(true);
    }
    expect(eastWest).toBeCloseTo(4, 6);
    expect(northSouth).toBeCloseTo(3, 6);
    // The drivable surface used for "on road" matches what is drawn.
    const { roadSurfaces } = game.world;
    expect(roadSurfaces.near(100, 3.9, 0)).toBe(true);
    expect(roadSurfaces.near(100, 4.2, 0)).toBe(false);
    expect(roadSurfaces.near(2.9, 60, 0)).toBe(true);
    expect(roadSurfaces.near(3.2, 60, 0)).toBe(false);
    // The junction is closed: nothing within its radius is off the surface.
    for (let a = 0; a < 16; a++) expect(roadSurfaces.near(Math.cos(a) * 3.9, Math.sin(a) * 3.9, 0)).toBe(true);
    let disc = 0;
    for (const v of vertices(game, "asphalt")) if (Math.abs(Math.hypot(v.x, v.z) - district.junctions[0]!.radius) < 1e-6) disc++;
    expect(disc).toBeGreaterThanOrEqual(14);
    game.dispose();
  });

  it("shows which widths are mapped and which are estimated, and marks everything generated as generated", () => {
    const district = testDistrict();
    district.furniture.push({ id: "node/70", osm: { type: "node", id: 70 }, tags: { traffic_calming: "bump" }, kind: "other", point: [0, 80] });
    const game = new DistrictGame({ engine, input: kb.input, district });
    game.world.debug.set(3);
    expect(game.world.debug.view.name).toBe("Data source");
    expect(game.world.debug.view.legend).toMatch(/orange = estimated width/);
    expect(game.world.debug.view.legend).toMatch(/magenta: generated/);

    const widthColours = { eastWest: new Set<string>(), northSouth: new Set<string>() };
    for (const v of vertices(game, "asphalt")) {
      if (Math.hypot(v.x, v.z) < 6) continue;
      (Math.abs(v.z) <= 4.001 ? widthColours.eastWest : widthColours.northSouth).add(String(v.colour));
    }
    expect([...widthColours.eastWest]).toEqual([String(GREEN)]); // width=8 is mapped
    expect([...widthColours.northSouth]).toEqual([String(ORANGE)]); // the residential width is a class default

    // Road paint, however it was placed, is never shown as mapped. The speed breaker is the exception: it is.
    let paint = 0, breaker = 0;
    for (const v of vertices(game, "roadPaint")) {
      if (Math.abs(v.z - 80) < 1 && Math.abs(v.x) < 3.1) {
        expect(v.colour).toEqual(CYAN);
        breaker++;
      } else {
        expect(v.colour, `paint at ${v.x}, ${v.z}`).toEqual(MAGENTA);
        paint++;
      }
    }
    expect(paint).toBeGreaterThan(40);
    expect(breaker).toBeGreaterThan(8);
    // Kerb grates are generated.
    for (const v of vertices(game, "grate")) expect(v.colour).toEqual(MAGENTA);

    // Pavers: the footpath of the road tagged sidewalk=both is mapped; the margin beside every road is generated.
    const seen = new Set<string>();
    for (const v of vertices(game, "pavers")) {
      if (Math.abs(v.x) > 20 && Math.abs(v.y - 0.15) < 1e-6) {
        expect(v.colour).toEqual(CYAN);
        seen.add("footpath");
      }
      if (Math.abs(v.x) > 20 && Math.abs(v.z) < 6 && v.y < 0.02) {
        expect(v.colour).toEqual(MAGENTA);
        seen.add("margin");
      }
    }
    expect([...seen].sort()).toEqual(["footpath", "margin"]);

    // Buildings: walls and roofs are OSM blue; what was added to them (parapet, door, balconies) is magenta.
    const byBuilding = { blue: 0, magenta: 0, other: 0 };
    for (const layer of ["plaster", "residential", "generic", "concrete"]) {
      for (const v of vertices(game, layer)) {
        if (v.y < 0.5 && !district.buildings.some((b) => pointInPolygons(v.x, v.z, b.polygons) || b.polygons.some((p) => distanceToLine(v.x, v.z, p.outer) < 0.2))) continue; // walls, rail piers
        if (!district.buildings.some((b) => b.polygons.some((p) => distanceToLine(v.x, v.z, p.outer) < 1.2 || pointInPolygons(v.x, v.z, [p])))) continue;
        if (String(v.colour) === String(BLUE)) byBuilding.blue++;
        else if (String(v.colour) === String(MAGENTA)) byBuilding.magenta++;
        else byBuilding.other++;
      }
    }
    expect(byBuilding.other).toBe(0);
    expect(byBuilding.blue).toBeGreaterThan(60);
    expect(byBuilding.magenta).toBeGreaterThan(60);
    // Apartment balconies (way/11, the L-shaped block) stand outside the footprint and are magenta.
    let balcony = 0;
    for (const v of vertices(game, "plaster")) {
      const l = district.buildings[1]!.polygons[0]!;
      if (v.y > 2 && v.y < 16 && !pointInPolygons(v.x, v.z, [l]) && distanceToLine(v.x, v.z, l.outer) > 0.3 && distanceToLine(v.x, v.z, l.outer) < 1.1) {
        expect(v.colour).toEqual(MAGENTA);
        balcony++;
      }
    }
    expect(balcony).toBeGreaterThan(16);

    // Instanced objects: generated and mapped ones use different templates and different debug materials.
    const materialOf = (prefix: string): Set<string> => new Set(game.scene.meshes.filter((m) => m.name.startsWith(prefix)).map((m) => (m as unknown as { sourceMesh: { material: { name: string } } }).sourceMesh.material.name));
    const generated = materialOf("generatedTree_"), mappedTrees = materialOf("mappedTree_");
    expect(generated.size).toBe(1);
    expect(mappedTrees.size).toBe(1);
    expect([...generated][0]).not.toBe([...mappedTrees][0]);
    expect(materialOf("generatedLamp_")).toEqual(generated);
    expect(materialOf("mappedLamp_")).toEqual(mappedTrees);
    game.dispose();
  });

  it("draws a speed breaker only where traffic calming is mapped, and counts it as mapped", () => {
    const plain = new DistrictGame({ engine, input: kb.input, district: testDistrict() });
    expect(plain.world.counts.mappedSpeedBreakers).toBeUndefined();
    expect(Object.keys(plain.world.counts).filter((k) => /speed|breaker|hump/i.test(k))).toEqual([]);
    plain.dispose();

    const district = testDistrict();
    district.furniture.push(
      { id: "node/70", osm: { type: "node", id: 70 }, tags: { traffic_calming: "hump" }, kind: "other", point: [0.5, 80] },
      { id: "node/71", osm: { type: "node", id: 71 }, tags: { traffic_calming: "bump" }, kind: "other", point: [90, 90] }, // mapped, but not on any road
      { id: "node/72", osm: { type: "node", id: 72 }, tags: { highway: "crossing" }, kind: "crossing", point: [50, 0] }, // not traffic calming
    );
    const game = new DistrictGame({ engine, input: kb.input, district });
    expect(game.world.counts.mappedSpeedBreakers).toBe(1);
    game.dispose();
  });
});

describe("lane markings", () => {
  it("are painted only on the listed classes, at or above the minimum width, and never in tunnels or on paths", () => {
    const painted = (over: Partial<DistrictRoad>): number => addLaneMarkings(new GeometryBuffer(), road(over), 0, NONE);
    for (const cls of ["trunk", "primary", "secondary", "tertiary"]) expect(painted({ class: cls }), cls).toBeGreaterThan(0);
    for (const cls of ["residential", "service", "unclassified", "living_street", "track", "footway", "trunk_link", ""]) expect(painted({ class: cls }), cls).toBe(0);
    expect(painted({ width: MARKING_RULES.minWidth })).toBeGreaterThan(0);
    expect(painted({ width: MARKING_RULES.minWidth - 0.01 })).toBe(0);
    expect(painted({ tunnel: true })).toBe(0);
    expect(painted({ kind: "path" })).toBe(0);
    expect(MARKING_RULES.classes).toEqual(["trunk", "primary", "secondary", "tertiary"]);
  });

  it("puts a broken centre line on a two-way road and none on a one-way road", () => {
    const g = new GeometryBuffer();
    addLaneMarkings(g, road({ class: "tertiary", width: 8, lanes: 2 }), 0, NONE);
    const dashes = quads(g);
    expect(dashes.length).toBeGreaterThan(30);
    for (const d of dashes) {
      expect(d.z).toBeCloseTo(0, 6); // on the centre line
      expect(d.sz).toBeCloseTo(MARKING_RULES.lineWidth, 6);
      expect(d.sx).toBeLessThanOrEqual(MARKING_RULES.dash + 1e-6);
    }
    // Dashes repeat at the documented pitch.
    const starts = dashes.map((d) => d.x - d.sx / 2).sort((a, b) => a - b);
    expect(starts[2]! - starts[1]!).toBeCloseTo(MARKING_RULES.dash + MARKING_RULES.gap, 6);

    const oneWay = new GeometryBuffer();
    addLaneMarkings(oneWay, road({ class: "tertiary", width: 8, oneway: true, lanes: 1 }), 0, NONE);
    expect(quads(oneWay)).toHaveLength(0); // one lane, one direction: nothing to divide
    const oneWayTwoLanes = new GeometryBuffer();
    addLaneMarkings(oneWayTwoLanes, road({ class: "tertiary", width: 8, oneway: true, lanes: 2 }), 0, NONE);
    expect(new Set(quads(oneWayTwoLanes).map((d) => +d.z.toFixed(3)))).toEqual(new Set([0])); // a lane divider, which here is the middle
  });

  it("divides lanes evenly from the lane count, with a solid centre line on four lanes and edge lines on main roads", () => {
    const g = new GeometryBuffer();
    addLaneMarkings(g, road({ class: "primary", width: 14, lanes: 4 }), 0, NONE);
    // Painted length at each offset from the centre line, as a share of the 300 m road.
    const cover = new Map<number, number>();
    for (const d of quads(g)) cover.set(+d.z.toFixed(3), (cover.get(+d.z.toFixed(3)) ?? 0) + d.sx / 300);
    expect([...cover.keys()].sort((a, b) => a - b)).toEqual([-6.7, -3.5, 0, 3.5, 6.7]); // edges, dividers, centre
    expect(cover.get(0)).toBeGreaterThan(0.98); // solid: two lanes each way
    expect(cover.get(6.7)).toBeGreaterThan(0.98); // solid edge line
    expect(cover.get(-6.7)).toBeGreaterThan(0.98);
    expect(cover.get(3.5)).toBeCloseTo(MARKING_RULES.dash / (MARKING_RULES.dash + MARKING_RULES.gap), 1); // dashed
    expect(cover.get(-3.5)).toBeCloseTo(cover.get(3.5)!, 6);
    // Tertiary roads get no edge line.
    const tertiary = new GeometryBuffer();
    addLaneMarkings(tertiary, road({ class: "tertiary", width: 14, lanes: 4 }), 0, NONE);
    expect(Math.max(...quads(tertiary).map((d) => Math.abs(d.z)))).toBeCloseTo(3.5, 6);
  });

  it("never paints outside the carriageway or lanes too narrow to be lanes, whatever lane count the data gives", () => {
    for (const lanes of [undefined, null, 0, -2, 1, 2, 3, 6, 40, 1000, Number.NaN, Infinity, 2.6]) {
      for (const width of [5.5, 7, 10.5, 21]) {
        for (const oneway of [false, true]) {
          const g = new GeometryBuffer();
          const made = addLaneMarkings(g, road({ class: "secondary", width, lanes: lanes as number, oneway }), 0, NONE);
          const label = `lanes ${String(lanes)}, width ${width}, oneway ${oneway}`;
          expect(meshProblems(label, g)).toEqual([]);
          expect(made, label).toBeLessThan(1500); // bounded: at most eight lines along 300 m
          const offsets = [...new Set(quads(g).map((d) => +d.z.toFixed(2)))].sort((a, b) => a - b);
          for (const z of offsets) expect(Math.abs(z), label).toBeLessThanOrEqual(width / 2);
          // Lines between the edge lines are at least a narrow lane apart.
          // A two-way road is divided down the middle: the same lines on both sides.
          if (!oneway) expect(offsets.map((z) => (z === 0 ? 0 : -z)).sort((a, b) => a - b), label).toEqual(offsets);
          const inner = offsets.filter((z) => Math.abs(z) < width / 2 - MARKING_RULES.edgeInset - 0.01);
          for (let i = 1; i < inner.length; i++) expect(inner[i]! - inner[i - 1]!, label).toBeGreaterThanOrEqual(MARKING_RULES.minLaneWidth - 0.01);
        }
      }
    }
  });

  it("follows a bend and stops short of junctions", () => {
    const bend = road({ points: [[-100, 0], [0, 0], [0, 100]], length: 200 });
    const g = new GeometryBuffer();
    addLaneMarkings(g, bend, 0, NONE);
    for (const d of quads(g)) expect(distanceToLine(d.x, d.z, bend.points)).toBeLessThan(0.07);
    const zones = new SegmentGrid(32, 1);
    zones.add(0, 0, 0, 0, 6.5);
    const clear = new GeometryBuffer();
    addLaneMarkings(clear, bend, 0, zones);
    expect(quads(clear).length).toBeLessThan(quads(g).length);
    for (let i = 0; i < clear.positions.length; i += 3) expect(Math.hypot(clear.positions[i]!, clear.positions[i + 2]!)).toBeGreaterThan(6.4);
  });
});

describe("junction markings", () => {
  const roads = (): DistrictRoad[] => [
    road({ id: "way/20", class: "secondary", width: 10, points: [[-150, 0], [0, 0], [150, 0]] }),
    road({ id: "way/21", class: "tertiary", width: 7, points: [[0, -150], [0, 0], [0, 150]] }),
    road({ id: "way/23", class: "residential", width: 6, points: [[0, 0], [100, 100]] }),
  ];
  const junction = (over: Partial<DistrictJunction> = {}): DistrictJunction => ({ point: [0, 0], arms: 5, radius: 5, roads: ["way/20", "way/21", "way/23"], ...over });

  it("gives each marked arm a stop line, and crossings only to the larger roads", () => {
    const g = new GeometryBuffer();
    const [stops, crossings] = addJunctionMarkings(g, junction(), roads(), 0);
    expect(stops).toBe(4); // four arms of the two marked roads; the residential arm has none
    expect(crossings).toBe(2); // the two secondary arms
    expect(meshProblems("junction", g)).toEqual([]);
    // Nothing is painted on the residential arm (the diagonal).
    for (const q of quads(g)) expect(Math.min(Math.abs(q.x), Math.abs(q.z)), `paint at ${q.x}, ${q.z}`).toBeLessThan(5.01);
  });

  it("places them consistently: same distance on every arm, across the approaching half only, clear of the junction", () => {
    const g = new GeometryBuffer();
    addJunctionMarkings(g, junction(), roads(), 0);
    const all = quads(g);
    // Stop lines are the long thin bars; crossing stripes are 0.5 x 3.
    const stopLines = all.filter((q) => Math.min(q.sx, q.sz) < MARKING_RULES.stopLineWidth + 0.01 && Math.max(q.sx, q.sz) > 2);
    expect(stopLines).toHaveLength(4);
    const tertiaryStops = stopLines.filter((q) => Math.abs(q.x) < 4).map((q) => Math.abs(q.z));
    const secondaryStops = stopLines.filter((q) => Math.abs(q.z) < 5.5 && Math.abs(q.x) > 4).map((q) => Math.abs(q.x));
    expect(tertiaryStops).toHaveLength(2);
    expect(tertiaryStops[0]).toBeCloseTo(tertiaryStops[1]!, 9); // the same on opposite arms
    expect(tertiaryStops[0]).toBeCloseTo(5 + 1.2, 6); // just outside the junction
    expect(secondaryStops[0]).toBeCloseTo(secondaryStops[1]!, 9);
    expect(secondaryStops[0]).toBeCloseTo(5 + 1.2 + MARKING_RULES.crossingLength + 1, 6); // behind the crossing
    for (const q of stopLines) {
      // Left-hand traffic: the bar covers the left half of the road as seen driving toward the junction.
      // North arm (z > 0), driving south: left is +X... expressed generally, the bar lies on one side of the centre line only.
      const across = Math.abs(q.x) < 4 ? q.x : q.z, span = Math.abs(q.x) < 4 ? q.sx : q.sz;
      expect(Math.abs(across) - span / 2).toBeGreaterThanOrEqual(0.09);
      const approachFromPositive = Math.abs(q.x) < 4 ? q.z > 0 : q.x > 0;
      const expectedSide = Math.abs(q.x) < 4 ? (approachFromPositive ? 1 : -1) : approachFromPositive ? -1 : 1;
      expect(Math.sign(across), `stop line at ${q.x.toFixed(1)}, ${q.z.toFixed(1)} is on the wrong side`).toBe(expectedSide);
    }
    // Crossing stripes: within the carriageway, parallel to travel, between the junction and the stop line.
    const stripes = all.filter((q) => !stopLines.includes(q));
    expect(stripes.length).toBeGreaterThan(10);
    for (const q of stripes) {
      expect(Math.abs(q.z)).toBeLessThanOrEqual(5);
      expect(q.sx).toBeCloseTo(MARKING_RULES.crossingLength, 6);
      expect(q.sz).toBeCloseTo(MARKING_RULES.crossingStripe, 6);
      expect(Math.abs(q.x) - q.sx / 2).toBeGreaterThanOrEqual(5 + 1.2 - 1e-6);
      expect(Math.abs(q.x) + q.sx / 2).toBeLessThan(secondaryStops[0]!);
    }
  });

  it("marks nothing at a mere joint, on short arms, or where no marked road meets", () => {
    expect(addJunctionMarkings(new GeometryBuffer(), junction({ arms: 2 }), roads(), 0)).toEqual([0, 0]);
    expect(addJunctionMarkings(new GeometryBuffer(), junction({ point: [300, 300] }), roads(), 0)).toEqual([0, 0]);
    const stubby = [road({ id: "way/20", class: "secondary", width: 10, points: [[-8, 0], [0, 0], [8, 0]] }), road({ id: "way/21", class: "secondary", width: 10, points: [[0, 0], [0, 9]] })];
    expect(addJunctionMarkings(new GeometryBuffer(), junction({ arms: 3 }), stubby, 0)).toEqual([0, 0]); // no room: better none than a line in the wrong place
    const minor = [road({ id: "a", class: "residential", points: [[-90, 0], [0, 0], [90, 0]] }), road({ id: "b", class: "residential", points: [[0, 0], [0, 90]] })];
    expect(addJunctionMarkings(new GeometryBuffer(), junction({ arms: 3 }), minor, 0)).toEqual([0, 0]);
  });

  it("gives a one-way road a full-width stop line where it arrives and none where it leaves", () => {
    const oneWay = [road({ id: "way/20", class: "tertiary", width: 8, oneway: true, points: [[-150, 0], [0, 0], [150, 0]] }), road({ id: "way/21", class: "tertiary", width: 8, points: [[0, 0], [0, 150]] })];
    const g = new GeometryBuffer();
    const [stops] = addJunctionMarkings(g, junction({ arms: 3, radius: 4 }), oneWay, 0);
    expect(stops).toBe(2); // the arriving arm of the one-way road, and the side road
    const bars = quads(g).filter((q) => Math.abs(q.z) < 4.01 && Math.abs(q.x) > 4);
    expect(bars).toHaveLength(1);
    expect(bars[0]!.x).toBeLessThan(0); // on the west arm, where traffic arrives
    expect(bars[0]!.sz).toBeCloseTo(8 - 0.6, 6); // both lanes travel the same way
  });
});

describe("speed breakers", () => {
  it("need a road within its own width of the mapped point", () => {
    const roads = testDistrict().roads;
    expect(addSpeedBreaker(new GeometryBuffer(), 60, 1, roads, 0)).toBe(true);
    expect(addSpeedBreaker(new GeometryBuffer(), 60, 7.9, roads, 0)).toBe(true);
    expect(addSpeedBreaker(new GeometryBuffer(), 90, 90, roads, 0)).toBe(false);
    expect(addSpeedBreaker(new GeometryBuffer(), 60, 1, [], 0)).toBe(false);
    expect(addSpeedBreaker(new GeometryBuffer(), 20, 100, roads.filter((r) => r.kind === "path"), 0)).toBe(false); // never on a footway
  });

  it("span the carriageway squarely, on the road rather than at the mapped point's offset", () => {
    const g = new GeometryBuffer();
    addSpeedBreaker(g, 60, 2.5, testDistrict().roads, 0.04);
    let minZ = Infinity, maxZ = -Infinity, minX = Infinity, maxX = -Infinity;
    for (let i = 0; i < g.positions.length; i += 3) {
      minX = Math.min(minX, g.positions[i]!);
      maxX = Math.max(maxX, g.positions[i]!);
      minZ = Math.min(minZ, g.positions[i + 2]!);
      maxZ = Math.max(maxZ, g.positions[i + 2]!);
      expect(g.positions[i + 1]).toBe(0.04);
    }
    expect([minZ, maxZ].map((v) => +v.toFixed(6))).toEqual([-4, 4]); // kerb to kerb, centred on the road
    expect((minX + maxX) / 2).toBeCloseTo(60, 6);
    expect(maxX - minX).toBeCloseTo(0.9, 6);
    // Bands alternate between two colours so it reads as a hump, not a stop line.
    const colours = new Set<string>();
    for (let i = 0; i < g.colors.length; i += g.colors.length / (g.positions.length / 3)) colours.add([g.colors[i], g.colors[i + 1], g.colors[i + 2]].join());
    expect(colours.size).toBe(2);
  });
});

describe("generated decoration", () => {
  function place(district: DistrictData) {
    const obstacles = new SegmentGrid(), roadSurfaces = new SegmentGrid();
    for (const b of district.buildings) for (const p of b.polygons) for (const ring of [p.outer, ...p.holes]) for (let i = 1; i < ring.length; i++) obstacles.add(ring[i - 1]![0], ring[i - 1]![1], ring[i]![0], ring[i]![1], 0);
    for (const r of district.roads) for (let i = 1; i < r.points.length; i++) roadSurfaces.add(r.points[i - 1]![0], r.points[i - 1]![1], r.points[i]![0], r.points[i]![1], r.width / 2);
    return placeDecorations(district, obstacles, roadSurfaces, new BuildingIndex(district.buildings));
  }
  /** A larger street grid than the fixture, so every rule fires many times. */
  function grid(): DistrictData {
    const d = testDistrict();
    d.bounds = { minX: -600, maxX: 600, minZ: -600, maxZ: 600 };
    d.roads = [];
    for (let i = -2; i <= 2; i++) {
      d.roads.push(road({ id: `way/${100 + i}`, class: i === 0 ? "secondary" : "residential", width: i === 0 ? 10 : 6, sidewalk: i === 0 ? "both" : null, points: [[-600, i * 200], [600, i * 200]], length: 1200 }));
      d.roads.push(road({ id: `way/${200 + i}`, class: "residential", width: 5, sidewalk: null, points: [[i * 200, -600], [i * 200, 600]], length: 1200 }));
    }
    d.roads.push(road({ id: "way/300", kind: "path", class: "footway", width: 2, points: [[-590, 100], [590, 100]], length: 1180 }));
    d.areas = [{ ...d.areas[0]!, polygons: [{ outer: [[220, 220], [380, 220], [380, 380], [220, 380], [220, 220]], holes: [] }] }];
    d.furniture = [];
    return d;
  }

  it("labels every item as generated, by a named rule, and never as a mapped object", () => {
    const items = place(grid());
    expect(items.length).toBeGreaterThan(150);
    const rules = new Set<string>();
    for (const item of items) {
      expect(item.generated).toBe(true);
      expect(item).not.toHaveProperty("osm");
      expect(item).not.toHaveProperty("id");
      expect(item).not.toHaveProperty("tags");
      rules.add(`${item.kind}:${item.rule}`);
      expect([item.x, item.z, item.yaw, item.scale].every(Number.isFinite)).toBe(true);
    }
    expect([...rules].sort()).toEqual(["grate:kerb-grate", "parkedCar:parked-car", "streetLight:roadside-light", "tree:park-tree", "tree:roadside-tree"]);
    expect(place(grid())).toEqual(items); // the same every time
  });

  it("parks cars beside the carriageway, never on it, on a footpath, in a building or outside the district", () => {
    const d = grid();
    d.buildings = [{ ...d.buildings[0]!, polygons: [{ outer: [[-180, 4.5], [-20, 4.5], [-20, 30], [-180, 30], [-180, 4.5]], holes: [] }], centre: [-100, 17] }]; // a frontage 1.5 m from a 6 m... the secondary road's edge
    const items = place(d);
    const parked = items.filter((i) => i.kind === "parkedCar");
    expect(parked.length).toBeGreaterThan(10);
    expect(parked.length).toBeLessThanOrEqual(DECORATION_RULES.parkedLimit);
    const index = new BuildingIndex(d.buildings);
    for (const car of parked) {
      // The whole car (about 4.4 x 1.8 m), not just its centre, is clear of every road and path surface.
      const sin = Math.sin(car.yaw), cos = Math.cos(car.yaw);
      for (const along of [-2.2, -1.1, 0, 1.1, 2.2]) {
        for (const across of [-0.9, 0, 0.9]) {
          const x = car.x + sin * along + cos * across, z = car.z + cos * along - sin * across;
          for (const r of d.roads) expect(distanceToLine(x, z, r.points), `parked car at ${car.x.toFixed(1)}, ${car.z.toFixed(1)} overlaps ${r.id}`).toBeGreaterThanOrEqual(r.width / 2);
          expect(index.at(x, z)).toBeNull();
          expect(Math.abs(x) < 600 && Math.abs(z) < 600).toBe(true);
        }
      }
      // Parked along the road, not across it.
      const nearest = d.roads.filter((r) => r.kind === "road").sort((a, b) => distanceToLine(car.x, car.z, a.points) - distanceToLine(car.x, car.z, b.points))[0]!;
      const alongX = nearest.points[0]![1] === nearest.points[1]![1];
      expect(Math.abs(alongX ? Math.sin(car.yaw) : Math.cos(car.yaw))).toBeCloseTo(1, 6);
      expect(DECORATION_RULES.parkedClasses as readonly string[]).toContain(nearest.class);
      // Close enough to that road to read as parked on it.
      expect(distanceToLine(car.x, car.z, nearest.points) - nearest.width / 2).toBeLessThan(2.5);
    }
    // No two parked cars overlap.
    for (let i = 0; i < parked.length; i++) for (let j = i + 1; j < parked.length; j++) expect(Math.hypot(parked[i]!.x - parked[j]!.x, parked[i]!.z - parked[j]!.z)).toBeGreaterThan(4.4);
  });

  it("keeps trees and lights off roads and paths, out of buildings, and inside the district", () => {
    const d = grid();
    d.buildings = [{ ...d.buildings[0]!, polygons: [{ outer: [[20, 8], [180, 8], [180, 60], [20, 60], [20, 8]], holes: [] }], centre: [100, 34] }];
    const items = place(d);
    const index = new BuildingIndex(d.buildings);
    const parked = items.filter((i) => i.kind === "parkedCar");
    for (const item of items) {
      if (item.kind !== "tree" && item.kind !== "streetLight") continue;
      for (const r of d.roads) expect(distanceToLine(item.x, item.z, r.points), `${item.rule} on ${r.id}`).toBeGreaterThanOrEqual(r.width / 2 + DECORATION_RULES.roadClearance - 1e-6);
      expect(index.at(item.x, item.z)).toBeNull();
      expect(distanceToLine(item.x, item.z, d.buildings[0]!.polygons[0]!.outer)).toBeGreaterThanOrEqual(DECORATION_RULES.buildingClearance - 1e-6);
      expect(Math.abs(item.x)).toBeLessThan(599);
      expect(Math.abs(item.z)).toBeLessThan(599);
      for (const car of parked) expect(Math.hypot(car.x - item.x, car.z - item.z), "a tree or light through a parked car").toBeGreaterThan(0.9);
    }
    // Park trees are in the mapped park; roadside ones are beside a road of a listed class.
    for (const tree of items.filter((i) => i.rule === "park-tree")) expect(pointInPolygons(tree.x, tree.z, d.areas[0]!.polygons)).toBe(true);
    for (const tree of items.filter((i) => i.rule === "roadside-tree")) {
      const edge = Math.min(...d.roads.filter((r) => r.kind === "road").map((r) => distanceToLine(tree.x, tree.z, r.points) - r.width / 2));
      expect(edge).toBeLessThan(DECORATION_RULES.treeSetback + 1.2 + 1.8 + 1e-6);
    }
    // Lights only on the main road; none on residential streets.
    const lights = items.filter((i) => i.kind === "streetLight");
    expect(lights.length).toBeGreaterThan(10);
    for (const light of lights) expect(Math.abs(light.z)).toBeLessThan(5 + 1.8 + DECORATION_RULES.lightSetback + 1e-6);
    expect(DECORATION_RULES.lightClasses as readonly string[]).not.toContain("residential");
  });

  it("drops a generated light near a mapped lamp, and respects the limits", () => {
    const d = grid();
    const baseline = place(d).filter((i) => i.kind === "streetLight");
    const victim = baseline[3]!;
    d.furniture = [{ id: "node/1", osm: { type: "node", id: 1 }, tags: { highway: "street_lamp" }, kind: "street_lamp", point: [victim.x + 3, victim.z] }];
    const lights = place(d).filter((i) => i.kind === "streetLight");
    expect(lights.some((l) => Math.hypot(l.x - victim.x, l.z - victim.z) < DECORATION_RULES.lightNearMapped)).toBe(false);
    expect(lights.length).toBeLessThan(baseline.length);

    const big = grid();
    big.areas = [{ ...big.areas[0]!, polygons: [{ outer: [[-590, -590], [590, -590], [590, 590], [-590, 590], [-590, -590]], holes: [] }] }];
    const all = place(big);
    expect(all.filter((i) => i.rule === "park-tree").length).toBeLessThanOrEqual(DECORATION_RULES.parkTreeLimit);
    expect(all.filter((i) => i.kind === "parkedCar").length).toBeLessThanOrEqual(DECORATION_RULES.parkedLimit);
  });

  it("puts grates at the kerb of lit roads only, inside the carriageway edge", () => {
    const d = grid();
    const grates = place(d).filter((i) => i.kind === "grate");
    expect(grates.length).toBeGreaterThan(20);
    for (const grate of grates) expect(Math.abs(Math.abs(grate.z) - (5 - 0.35))).toBeLessThan(1e-6); // 35 cm in from the edge of the 10 m road
    expect(DISTRICT_ASSUMPTIONS.shoulder.main).toBeGreaterThan(DISTRICT_ASSUMPTIONS.shoulder.minor);
  });
});
