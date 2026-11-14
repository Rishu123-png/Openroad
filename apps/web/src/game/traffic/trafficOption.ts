import { TRAFFIC } from "./TrafficModel";

/**
 * Reads the `?traffic=N` option. Returns undefined when it is absent or not a
 * whole number, so the graphics setting decides; otherwise N limited to
 * 0..TRAFFIC.maxCount.
 */
export function parseTrafficCount(search: string): number | undefined {
  const raw = new URLSearchParams(search).get("traffic");
  if (raw === null || !/^\s*\d{1,6}\s*$/.test(raw)) return undefined;
  return Math.min(TRAFFIC.maxCount, Number(raw));
}
