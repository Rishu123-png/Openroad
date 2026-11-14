import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import type { Settings } from "../../src/game/engine/DistrictGame";
import { KeyboardInput } from "../../src/input/KeyboardInput";

export function nullEngine(): NullEngine {
  return new NullEngine({ renderWidth: 320, renderHeight: 180, textureSize: 64, deterministicLockstep: true, lockstepMaxSteps: 4 });
}

/** A keyboard the test presses, and a count of the listeners the game left on it. */
export function keyboard() {
  const target = new EventTarget();
  let listening = 0;
  const add = target.addEventListener.bind(target), remove = target.removeEventListener.bind(target);
  target.addEventListener = (...args: Parameters<EventTarget["addEventListener"]>) => (listening++, add(...args));
  target.removeEventListener = (...args: Parameters<EventTarget["removeEventListener"]>) => (listening--, remove(...args));
  const input = new KeyboardInput(target);
  const send = (type: string, code: string): void => {
    const e = new Event(type, { cancelable: true }) as Event & { code: string; repeat: boolean };
    e.code = code;
    e.repeat = false;
    target.dispatchEvent(e);
  };
  return {
    input,
    target,
    down: (code: string) => send("keydown", code),
    up: (code: string) => send("keyup", code),
    press: (code: string) => (send("keydown", code), send("keyup", code)),
    get listening() {
      return listening;
    },
  };
}

/** Stands in for localStorage. */
export function memory(initial: Record<string, string> = {}): Settings & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
}

/** Area of a triangle list's triangles, smallest first is what callers usually want. */
export function triangleAreas(positions: ArrayLike<number>, indices: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]! * 3, b = indices[i + 1]! * 3, c = indices[i + 2]! * 3;
    const ux = positions[b]! - positions[a]!, uy = positions[b + 1]! - positions[a + 1]!, uz = positions[b + 2]! - positions[a + 2]!;
    const vx = positions[c]! - positions[a]!, vy = positions[c + 1]! - positions[a + 1]!, vz = positions[c + 2]! - positions[a + 2]!;
    out.push(Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2);
  }
  return out;
}

/** Problems with a triangle mesh: non-finite numbers, indices out of range, unnormalised normals. Empty when sound. */
export function meshProblems(name: string, part: { positions: ArrayLike<number>; normals: ArrayLike<number>; indices: ArrayLike<number>; colors?: ArrayLike<number>; uvs?: ArrayLike<number> }): string[] {
  const problems: string[] = [];
  const vertices = part.positions.length / 3;
  if (!Number.isInteger(vertices)) problems.push(`${name}: positions are not triples`);
  if (part.normals.length !== part.positions.length) problems.push(`${name}: ${part.normals.length / 3} normals for ${vertices} vertices`);
  if (part.indices.length % 3 !== 0) problems.push(`${name}: indices are not triples`);
  for (const [label, list] of [["position", part.positions], ["normal", part.normals], ["colour", part.colors ?? []], ["uv", part.uvs ?? []]] as const) {
    for (let i = 0; i < list.length; i++) {
      if (!Number.isFinite(list[i])) {
        problems.push(`${name}: ${label} ${i} is ${String(list[i])}`);
        break;
      }
    }
  }
  for (let i = 0; i < part.indices.length; i++) {
    const v = part.indices[i]!;
    if (!Number.isInteger(v) || v < 0 || v >= vertices) {
      problems.push(`${name}: index ${i} is ${v} of ${vertices}`);
      break;
    }
  }
  for (let i = 0; i < part.normals.length; i += 3) {
    const l = Math.hypot(part.normals[i]!, part.normals[i + 1]!, part.normals[i + 2]!);
    if (Math.abs(l - 1) > 0.02) {
      problems.push(`${name}: normal ${i / 3} has length ${l.toFixed(3)}`);
      break;
    }
  }
  return problems;
}

/** Shortest distance from a point to a polyline. */
export function distanceToLine(x: number, z: number, points: ReadonlyArray<readonly [number, number]>): number {
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    const len2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
    const t = len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * (b[0] - a[0]) + (z - a[1]) * (b[1] - a[1])) / len2));
    best = Math.min(best, Math.hypot(a[0] + (b[0] - a[0]) * t - x, a[1] + (b[1] - a[1]) * t - z));
  }
  return best;
}
