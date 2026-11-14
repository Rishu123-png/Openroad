# Assets, licences and provenance

## Vehicles

**No vehicle model file is shipped, downloaded or loaded.** All six vehicles are
original geometry generated in code at run time by
`apps/web/src/game/vehicle/models/carGeometry.ts` from the figures in
`apps/web/src/game/vehicle/models/carSpecs.ts`. They are part of this
repository's own source and are covered by the repository's licence.

| Garage name | id | Proportioned after (class, for scale only) | Length × width × height (m) | Wheelbase (m) |
| --- | --- | --- | --- | --- |
| Compact SUV | `compact-suv` | Hyundai Creta class | 4.33 × 1.79 × 1.635 | 2.61 |
| Compact sedan | `compact-sedan` | Maruti Suzuki Dzire class | 3.995 × 1.735 × 1.515 | 2.45 |
| Premium hatchback | `premium-hatch` | Maruti Suzuki Baleno class | 3.99 × 1.745 × 1.50 | 2.52 |
| Off-road SUV | `offroad-suv` | Mahindra Thar class | 3.985 × 1.82 × 1.85 | 2.45 |
| Seven-seat SUV | `large-suv` | Toyota Fortuner class, built shorter | 4.70 × 1.86 × 1.80 | 2.75 |
| Sport hatchback | `hatchback` | Hyundai i20 class, built shorter | 3.86 × 1.735 × 1.52 | 2.45 |

What "proportioned after" means, and does not mean:

- Published overall dimensions of a class of vehicle were used as a scale
  reference, so the cars are the right size beside roads and buildings.
- The shapes are generic. They are not copies of any manufacturer's design,
  were not traced or converted from any manufacturer or third-party model,
  and carry no badge, logo, brand name or model name.
- The two SUVs marked "built shorter" are deliberately not the reference
  vehicle's length: the traffic and boundary safety checks were written for a
  longest vehicle of 4.70 m and a shortest hatchback of 3.86 m, and those
  figures were kept.
- Makers' names appear only in the note under each vehicle ("proportioned
  after the … class … Not a manufacturer asset") and in this file.

### Why not licensed GLB/GLTF models

Licensed models were the first choice. None was used, because none could be
verified from the build environment: it can reach only GitHub and the npm and
PyPI registries, and searches there found no realistic model of these vehicle
classes with a licence that could be confirmed. Nothing was taken from model
sites, and nothing unlicensed or scraped was added. If properly licensed
models are supplied later, add each one here with its source URL, author,
licence, date obtained and any changes made, and keep the licence text beside
the file.

### Vehicle thumbnails

The garage's side-view pictures are SVG drawings generated at run time by
`carThumbnail.ts` from the same profile figures as the 3D model. No image
files are involved.

## Textures

Every texture (asphalt, pavers, concrete, plaster, facades, foliage, sky) is
generated in code by `apps/web/src/game/materials/proceduralTextures.ts`. No
image files are shipped or downloaded.

## Map data

District geometry comes from OpenStreetMap, © OpenStreetMap contributors,
under the Open Database Licence (ODbL). See `docs/DISTRICT_RULES.md`. District
files and OSM extracts are built locally and are not committed.
