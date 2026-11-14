import type { DistrictData } from "./types";

export class DistrictUnavailableError extends Error {}

/** Where the district files are served from. They are built locally and are not part of the repository. */
export function districtUrl(base: string, region: string, id: string): string {
  return `${base}regions/${region}/${id}.json`;
}

/** Checks that a parsed file is a district this version of the game understands. */
export function parseDistrict(value: unknown): DistrictData {
  const d = value as Partial<DistrictData> | null;
  if (!d || d.kind !== "district") throw new DistrictUnavailableError("The file is not an OPENROAD district.");
  if (d.formatVersion !== 1) throw new DistrictUnavailableError(`District format ${String(d.formatVersion)} is not supported by this version.`);
  for (const key of ["bounds", "sector", "buildings", "roads", "junctions", "areas", "barriers", "rail", "furniture", "spawn", "attribution"] as const) {
    if (d[key] === undefined || d[key] === null) throw new DistrictUnavailableError(`The district file has no "${key}" section. Rebuild it with tools/build-district.mjs.`);
  }
  return d as DistrictData;
}

export async function loadDistrict(url: string, fetcher: typeof fetch = fetch): Promise<DistrictData> {
  let response: Response;
  try {
    response = await fetcher(url);
  } catch {
    throw new DistrictUnavailableError(`The district file could not be downloaded from ${url}.`);
  }
  // A development server answers unknown paths with the HTML page, so check the type as well as the status.
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok || !type.includes("json")) {
    throw new DistrictUnavailableError(
      `No district data at ${url}. It is built on your machine from the OpenStreetMap extract: run "node tools/build-layers.mjs" and then "node tools/build-district.mjs", and reload.`,
    );
  }
  return parseDistrict(await response.json());
}
