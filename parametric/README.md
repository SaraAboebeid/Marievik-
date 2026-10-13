# MVK parametric layout – Marievik

The Grasshopper definition (`MVK_parametric.gh`) takes a footprint and a use, then generates each floor plan: walls, doors, windows, slabs and rooms. It also calculates cost and embodied carbon for every element from a component database. The logic is plain Python in `mvk/`. You can edit it in VS Code, and Grasshopper picks up the changes the next time it recomputes.

```
Marievik+/parametric/
  MVK_parametric.gh        Grasshopper definition
  gh/mvk_building.py       code inside the "MVK Building" script component
  gh/build_definition.py   rebuilds the .gh from scratch (run in Rhino ScriptEditor)
  mvk/layout.py            layout engine (pure Python + shapely)
  mvk/use_profiles.json    one entry per use: zoning rules, dimensions, default component types
  mvk/components_db.csv    element catalogue: thickness, size, cost SEK/unit, GWP kgCO2e/unit  (MOCK values)
  outputs/                 quantities.csv + model.json (when Export = true)
```

## How a floor is generated
1. **Zoning.** For a deep plan, the engine builds a ring of rooms, a ring corridor and an inner zone (support/WC or an atrium). For a narrow plan it uses a central corridor. Open-plan uses get a core plus a support band around it.
2. **Rooms.** Partitions run perpendicular to the façade at the `unit_width` of the use. Corner rooms take up the remainder.
3. **Unit interiors.** Hotel rooms get a bathroom. Apartments get a bathroom and a bedroom wall.
4. **Doors.** One door per room on the corridor wall, one on the core and one on the support zone. The ground floor also gets the main entrance.
5. **Windows.** Placed per façade module from `wwr`, `window_module`, `sill` and `head`.
6. **Overrides** are applied last, then rooms are recomputed. If you remove a partition, the two rooms merge.

## Element ids
`F02-P-014`: floor 02, category P, number 014.
Wall categories: **E** exterior · **C** corridor · **S** support/atrium edge · **K** core · **P** partition · **I** inside a unit · **A** added by you.
Openings: `F02-D-…` doors, `F02-W-…` windows. Set *Show IDs* to true to see them in the viewport.

## Overrides (JSON panel)
Keys are `"*"` (all floors) or a floor (`"F02"`). Everything is optional.
```json
{
  "*":   {"wall_types": {"P": "IW_GLASS_PARTITION", "E": "EW_TIMBER_CLT_380"}},
  "F02": {
    "remove_walls": ["F02-P-004", "F02-P-005"],
    "add_walls":    [{"a": [95.0, -90.0], "b": [99.0, -96.0], "type": "IW_GYPSUM_STEEL_100"}],
    "doors": [
      {"wall": "F02-C-007", "pos": 0.8, "type": "D_INT_GLASS_1000"},
      {"wall": "F02-C-003", "remove": true},
      {"wall": "F02-P-010", "at": 1.2, "add": true}
    ],
    "windows": [
      {"wall": "F02-E-002", "wwr": 0.7, "type": "W_TRIPLE_TIMBER"},
      {"wall": "F02-E-005", "remove": true},
      {"wall": "all", "module": 1.8}
    ]
  }
}
```
* `wall_types` takes a wall id, a category letter (`E C S K P I A`) or `all`.
* For doors, `pos` is a fraction of the wall length (0–1) and `at` is metres from the wall start. The first door on a wall is moved unless you set `"add": true`. A door removes any window it overlaps.
* Simpler ways to make the same edits: list ids in the *Remove walls* panel, or draw lines in Rhino at the floor's level and set them in *Add walls*.

## Database (backend)
`components_db.csv` holds one row per component type, with `unit` set to m2, m or pcs. Walls are measured as net area (openings subtracted), windows in m², doors in pieces, and slabs by floor area minus atria. Replace the MOCK values with your real database: Boverket klimatdatabas, EPDs, cost indices. You can also point `load_db()` at an export from it. New uses can be added in `use_profiles.json` without changing any code.

## Limitations of this first version
* Quantities cover the envelope, partitions, openings and slabs. Load-bearing frame, foundations, roof build-up and MEP are not included yet.
* Wall junctions overlap slightly (about half a wall thickness), so wall areas are overstated by roughly 1–2 %.
* Footprints are straight-edged polygons. Curves are approximated as polylines.

## Link to the Marievik+ dashboard (added 2026-10-05)
* **Prices come from the Marievik+ catalogue** (`Marievik+\data\components\catalogue.json`, two folders up from `mvk/`). `components_db.csv` now only holds geometry and a `catalogue_id` link per type. Types without a link are priced from the CSV and flagged `mock_csv`.
* **Existing shell** (toggle, default on): facade, core, slabs and existing windows are *retained*, so they carry no new cost or carbon. Partitions, doors, floor and ceiling finishes, and changed windows are *new* and priced (capex = material + install; carbon = A1–A5; C1–C4 and D reported separately). An atrium cut into a retained slab shows as *not priced* until the catalogue has an entry for it.
* **Partition system** (value list): as profile / conventional stud / demountable / glazed. It switches every new wall type at once.
* **Export = true** also writes `Marievik+\runs\grasshopper\<Building id>.json`: every use × {conventional, demountable}, with plan geometry. Then run `python -m engine.build_web` in Marievik+ and republish. The dashboard prices the bill again with the engine's own `evaluate_bill`.
* Code: `mvk/pricing.py` (catalogue pricing), `mvk/export.py` (dashboard file).

## Marievik site (added 2026-10-05)
* `site/marievik_site.json` holds 13 buildings (B01–B13) with footprints and storey counts from OpenStreetMap (ODbL, © OpenStreetMap contributors), plus the streets. Coordinates are SWEREF 99 TM minus origin E 672400 / N 6578480 (metres). Names and today's use are assumptions from aerial photos; edit the file when real data arrives. Raw downloads: `site/osm_marievik_*.json`.
* **B01 is now the OSM outline of Marievik 27**, which has 7 storeys. The hand-traced footprint from the first session is hidden on the old `Buildings` layer.
* `site/bake_site.py` (run in Rhino's ScriptEditor) adds `Site::Footprints::Bxx` (curves with user text), `Site::Massing::Bxx` (one solid per storey) and `Site::Streets`. Running it again replaces the earlier bake.
* Grasshopper:
  * **Building** picks which building is laid out in detail; the others show as context massing.
  * *Current use (site data)* and *Floors = 0* take the values from the site file.
  * *Custom footprint* uses the Footprint curves instead.
  * *Export whole site* writes every building to Marievik+ (about 2 minutes).
* Mock-up plans for every building: `plans/Marievik_mock_plans.pdf` (rebuild with `python plans/make_mock_plans.py`).

## Facades, materials and roofs (added 2026-10-05)
* Each building in `site/marievik_site.json` has a `facade` entry: wall `material` (and a different `base_material` for the lowest `base_floors`), `window` = punched or ribbon, window `module`, `wwr`, `sill`, `head`, `balconies`, and `roof` (`shape` flat / setback, membrane light / dark, `parapet` height, `setback`, `features`: barrel_vault, plant, plant_u, skylight, pv, glass_roof, roof_garden). `materials` holds the RGB colour of each material key.
* **These are visual estimates** from the Google 3D aerial views (Street View could not be used). Correct them in the site file when you have photos, drawings or a survey. Grasshopper picks up the changes on the next recompute.
* In a conversion the existing facade decides the windows and the exterior wall type. A changed use no longer changes the windows, but the window overrides still apply.
* Grasshopper: the *Facade, materials & roof detail* toggle (shared settings) switches this on or off. New outputs: `facade` / `facade_col` (exterior walls coloured by material), `details` / `details_col` (parapets, roof membrane, plant rooms, skylights, PV, vaults, glass roof, balconies), `massing_col`. These are drawn by the three coloured previews.
* Code: `mvk/facade.py`. Its geometry descriptors (prism / box / vault) are plain data, so they can later go to IFC, CityGML or an energy model.
* Roof build-up, PV and balconies are drawn but **not priced yet**.
