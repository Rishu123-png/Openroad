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
