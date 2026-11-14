/**
 * Building classification and height rules for the district builder.
 * Both are deterministic and use only the building's own OSM tags.
 * See docs/DISTRICT_RULES.md.
 */
export const CATEGORIES = ["house", "apartments", "commercial", "institutional", "industrial", "healthcare", "other", "unclassified"];

const set = (s) => new Set(s.split(" "));
const HEALTH_BUILDING = set("hospital clinic");
const HEALTH_AMENITY = set("hospital clinic doctors dentist nursing_home");
const INSTITUTION_BUILDING = set("school university college kindergarten public government civic temple mosque church gurdwara religious cathedral chapel shrine fire_station train_station transportation");
const INSTITUTION_AMENITY = set("school college university kindergarten library research_institute police fire_station townhall courthouse post_office community_centre place_of_worship public_building social_facility");
const INDUSTRIAL_BUILDING = set("industrial warehouse factory manufacture");
const COMMERCIAL_BUILDING = set("commercial retail office supermarket kiosk shop hotel mall");
const COMMERCIAL_AMENITY = set("bank restaurant fast_food cafe food_court bar pub fuel marketplace cinema atm pharmacy");
const APARTMENT_BUILDING = set("apartments dormitory");
const HOUSE_BUILDING = set("house detached semidetached_house terrace bungalow villa residential");
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

/**
 * First matching rule wins. Returns { category, rule } where rule names the
 * tag that decided it. A bare building=yes is "unclassified": it is never
 * promoted to apartments, houses or anything else.
 */
export function classifyBuilding(tags) {
  const b = tags.building;
  const hit = (category, rule) => ({ category, rule });
  if (HEALTH_BUILDING.has(b)) return hit("healthcare", `building=${b}`);
  if (HEALTH_AMENITY.has(tags.amenity)) return hit("healthcare", `amenity=${tags.amenity}`);
  if (tags.healthcare) return hit("healthcare", `healthcare=${tags.healthcare}`);
  if (INSTITUTION_BUILDING.has(b)) return hit("institutional", `building=${b}`);
  if (INSTITUTION_AMENITY.has(tags.amenity)) return hit("institutional", `amenity=${tags.amenity}`);
  if (INDUSTRIAL_BUILDING.has(b)) return hit("industrial", `building=${b}`);
  if (tags.man_made === "works") return hit("industrial", "man_made=works");
  if (COMMERCIAL_BUILDING.has(b)) return hit("commercial", `building=${b}`);
  if (tags.shop) return hit("commercial", `shop=${tags.shop}`);
  if (tags.office) return hit("commercial", `office=${tags.office}`);
  if (tags.tourism === "hotel" || tags.tourism === "guest_house") return hit("commercial", `tourism=${tags.tourism}`);
  if (COMMERCIAL_AMENITY.has(tags.amenity)) return hit("commercial", `amenity=${tags.amenity}`);
  if (APARTMENT_BUILDING.has(b)) return hit("apartments", `building=${b}`);
  if (b === "residential" && (num(tags["building:levels"]) ?? 0) >= 5) return hit("apartments", "building=residential with building:levels of 5 or more");
  if (HOUSE_BUILDING.has(b)) return hit("house", `building=${b}`);
  if (b && b !== "yes") return hit("other", `building=${b}`);
  return hit("unclassified", b === "yes" ? "building=yes with no other evidence" : "no building value");
}

/** Metres per storey when only building:levels is known. */
export const LEVEL_HEIGHT = 3.2;

/**
 * Conservative heights used only when the source has neither height nor
 * levels. Change them here; every building that uses one is marked estimated.
 */
export const ESTIMATED_HEIGHTS = {
  house: 7,
  apartments: 15,
  commercial: 9,
  institutional: 10,
  industrial: 8,
  healthcare: 10,
  other: 4,
  unclassified: 6.5,
  /** Any footprint smaller than this is treated as a hut, kiosk or shed. */
  smallFootprintArea: 30,
  smallFootprintHeight: 3,
  /** Deterministic spread so that estimated buildings are not all one height. */
  variation: 0.08,
};

function idNoise(id) {
  let h = 2166136261;
  for (const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 10000) / 10000; // 0..1
}

/**
 * @returns { height, heightStatus, heightBasis, levels }
 *   heightStatus: "source-height"  the height tag, as mapped
 *                 "source-levels"  building:levels x LEVEL_HEIGHT (levels are source, the storey height is assumed)
 *                 "estimated"      category default; not a real-world measurement
 */
export function buildingHeight(id, tags, category, footprintArea, config = ESTIMATED_HEIGHTS) {
  const height = num(tags.height);
  const levels = num(tags["building:levels"]);
  if (height !== null && height > 0) return { height, heightStatus: "source-height", heightBasis: `height=${tags.height}`, levels };
  if (levels !== null && levels > 0) return { height: Math.round(levels * LEVEL_HEIGHT * 10) / 10, heightStatus: "source-levels", heightBasis: `building:levels=${tags["building:levels"]} x ${LEVEL_HEIGHT} m`, levels };
  if (footprintArea < config.smallFootprintArea) return { height: config.smallFootprintHeight, heightStatus: "estimated", heightBasis: `footprint under ${config.smallFootprintArea} m2`, levels: null };
  const base = config[category] ?? config.unclassified;
  const spread = 1 + (idNoise(id) * 2 - 1) * config.variation;
  return { height: Math.round(base * spread * 10) / 10, heightStatus: "estimated", heightBasis: `default for ${category} (${base} m, varied by up to ${Math.round(config.variation * 100)}%)`, levels: null };
}

/**
 * EVIDENCE FROM SURROUNDINGS. Used only for buildings whose own tags say
 * nothing (category "unclassified"). Two rules, both recorded on the building:
 *
 *   1. A mapped point of interest lies inside the footprint and names a use.
 *      If several lie inside and disagree, nothing is inferred.
 *   2. The building's centre lies inside a mapped education land-use area.
 *
 * A residential land-use area is NOT evidence of what a building is: it is
 * kept as context only, and the building stays unclassified.
 * Footprint size is never used to decide a category.
 */
const POI_COMMERCIAL_AMENITY = new Set(["bank", "restaurant", "fast_food", "cafe", "pharmacy", "bar", "pub", "food_court", "marketplace", "fuel", "cinema", "bureau_de_change"]);
const POI_INSTITUTIONAL_AMENITY = new Set(["school", "college", "university", "kindergarten", "place_of_worship", "community_centre", "library", "police", "post_office", "townhall", "fire_station", "courthouse"]);
const POI_HEALTH_AMENITY = new Set(["hospital", "clinic", "doctors", "dentist"]);
const EDUCATION_LANDUSE = new Set(["school", "college", "university", "education"]);

/** The use a point of interest states, or null when its tags state none we recognise. */
export function poiCategory(tags) {
  if (tags.healthcare || POI_HEALTH_AMENITY.has(tags.amenity)) return { category: "healthcare", tag: tags.healthcare ? `healthcare=${tags.healthcare}` : `amenity=${tags.amenity}` };
  if (POI_INSTITUTIONAL_AMENITY.has(tags.amenity)) return { category: "institutional", tag: `amenity=${tags.amenity}` };
  if (tags.shop) return { category: "commercial", tag: `shop=${tags.shop}` };
  if (tags.office) return { category: "commercial", tag: `office=${tags.office}` };
  if (POI_COMMERCIAL_AMENITY.has(tags.amenity)) return { category: "commercial", tag: `amenity=${tags.amenity}` };
  return null;
}

/**
 * @param poisInside  points of interest inside the footprint: [{ id, tags }]
 * @param areasAround mapped areas containing the building's centre: [{ id, tags }]
 * @returns { category, rule, evidence } or null when nothing can be inferred.
 */
export function inferCategory(poisInside, areasAround) {
  const stated = poisInside.map((p) => ({ id: p.id, ...poiCategory(p.tags) })).filter((p) => p.category);
  const kinds = new Set(stated.map((p) => p.category));
  if (kinds.size === 1) {
    const p = stated[0];
    return { category: p.category, rule: `inferred: point of interest ${p.id} (${p.tag}) lies inside the footprint`, evidence: stated.map((s) => s.id) };
  }
  if (kinds.size > 1) return null; // conflicting uses: leave it unclassified
  const school = areasAround.find((a) => EDUCATION_LANDUSE.has(a.tags.landuse) || ["school", "college", "university"].includes(a.tags.amenity));
  if (school) return { category: "institutional", rule: `inferred: centre lies inside ${school.tags.landuse ? `landuse=${school.tags.landuse}` : `amenity=${school.tags.amenity}`} area ${school.id}`, evidence: [school.id] };
  return null;
}

/**
 * Height bands for buildings of unknown use. Each is a low-rise guess in
 * metres, picked by a hash of the id so that it never changes between builds.
 * The footprint band only narrows the guess (a 40 m2 footprint is not given
 * 13 m); it does not decide what the building is. NOT a measurement and not a
 * mapped floor count.
 */
export const GENERIC_HEIGHT_BANDS = [
  { below: 80, heights: [3.4, 3.4, 6.6] },
  { below: 250, heights: [6.6, 6.6, 6.6, 9.8, 9.8, 3.4] },
  { below: 600, heights: [6.6, 9.8, 9.8, 13] },
  { below: 1500, heights: [6.6, 9.8, 13] },
  { below: Infinity, heights: [6.6, 9.8] },
];

export function genericHeight(id, footprintArea, config = ESTIMATED_HEIGHTS) {
  if (footprintArea < config.smallFootprintArea) return { height: config.smallFootprintHeight, heightStatus: "estimated", heightBasis: `footprint under ${config.smallFootprintArea} m2`, levels: null };
  const band = GENERIC_HEIGHT_BANDS.find((b) => footprintArea < b.below);
  const height = band.heights[Math.floor(idNoise(`${id}h`) * band.heights.length) % band.heights.length];
  return { height, heightStatus: "estimated", heightBasis: `generic low-rise estimate for a footprint ${band.below === Infinity ? "of 1500 m2 or more" : `under ${band.below} m2`}, picked by id from ${[...new Set(band.heights)].join("/")} m; not measured`, levels: null };
}
