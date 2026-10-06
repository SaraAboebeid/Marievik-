// Shapes returned by explorer/server.py. Plan coordinates are metres, x east, y north (SWEREF 99 TM
// minus the site origin); z is up. The viewer maps them to three.js as (x, z, -y).

export type XY = [number, number]
export type Ring = XY[]

export interface Settings {
  ground_use: string
  use: string
  partition_system: string
  windows: string
  added_floors: number
  added_use: string
  facade: boolean
}

export interface Facade {
  material: string
  base_material?: string
  base_floors?: number
  window?: string
  balconies?: boolean
  roof?: { shape?: string; features?: { kind: string }[] }
  notes?: string
}

export interface SiteBuilding {
  id: string
  name: string
  levels: number
  current_use: string
  ground_use?: string
  role?: string
  footprint: Ring
  holes: Ring[]
  facade?: Facade
  height_m?: number
}

export interface SitePayload {
  location: { name: string; lat: number; lon: number; tz: number; epw: string }
  materials: Record<string, [number, number, number]>
  roads: { kind: string; name?: string; pts: XY[] }[]
  uses: Record<string, string>
  systems: string[]
  windows: string[]
  max_added: number
  defaults: Settings
  buildings: SiteBuilding[]
  provenance: string
}

export interface Blocker { kind: string; text: string; severity: string }

export interface BuildingKpi {
  gfa_m2: number
  nfa_m2: number
  net_to_gross: number
  units: number
  unit_types: Record<string, number>
  unit_area_mean_m2: number
  floors: number
  existing_floors: number
  added_floors: number
  added_gfa_m2: number
  height_m: number
  capex_sek: number
  upfront_kgco2e: number
  upfront_kgco2e_per_m2: number
  capex_sek_per_m2: number
  added_capex_sek: number
  added_upfront_kgco2e: number
  c1c4_kgco2e: number
  d_credit_kgco2e: number
  retained_share: number
  window_floor_ratio: number
  partition_area_m2: number
  placeholder_share: number
  mock_priced_rows: number
  blockers: Blocker[]
}

export type Detail =
  | { k: 'prism'; rings: Ring[]; z0: number; z1: number; m: string }
  | { k: 'box'; o: XY; u: XY; s: XY; t: XY; z: XY; m: string }
  | { k: 'vault'; o: XY; u: XY; length: number; width: number; z0: number; rise: number; m: string }

export interface BuildingFloor {
  index: number
  z: number
  height: number
  slab_t: number
  use: string
  use_label: string
  added: boolean
  rings: Ring[]
  material: string
  units: number
}

export interface BuildingPayload {
  id: string
  name: string
  key: string
  settings: Settings
  floors: BuildingFloor[]
  // [ax, ay, bx, by, z0, z1, isDoor, isNew] on the outside face
  windows: number[][]
  details: Detail[]
  height: number
  kpi: BuildingKpi
}

export interface Unit {
  id: string
  name: string
  kind: 'unit' | 'common'
  area: number
  poly: Ring
  holes: Ring[]
  label: XY
  rooms: string[]
  windows: string[]
  glazing_m2: number
  wfr: number
  facade_m: number
  orientation: string | null
}

export interface FloorPayload {
  building: string
  index: number
  z: number
  base: number
  height: number
  wall_h: number
  use: string
  use_label: string
  added: boolean
  rings: Ring[]
  voids: Ring[][]
  walls: { id: string; cat: string; type: string; t: number; a: XY; b: XY }[]
  // [ax, ay, ux, uy, s0, s1, z0, z1, t, catIndex]  catIndex into "ECSKPIA"
  pieces: number[][]
  openings: { id: string; wall: string; kind: string; type: string; new: boolean; a: XY; b: XY; z0: number; z1: number; t: number }[]
  rooms: { id: string; name: string; area: number; poly: Ring; label: XY }[]
  units: Unit[]
  kpi: {
    gfa_m2: number; units: number; unit_types: Record<string, number>; usable_m2: number; efficiency: number
    capex_sek: number; upfront_kgco2e: number; no_window_units: number; low_wfr_units: number
  }
}

export interface UnitDaylight {
  points: [number, number, number][]
  mean: number; median?: number; min?: number; max?: number
  area_300: number; area_100: number; pass_en17037: boolean
  irc?: number; obstruction_deg?: number; glazing_m2?: number
  name?: string; area?: number
}

export interface DaylightResult {
  building: string
  floor: number
  method: 'quick' | 'ladybug_tools'
  units: Record<string, UnitDaylight>
  summary: { mean_df: number; median_df?: number; area_300: number; area_100: number; units_pass: number; units: number; sensors: number }
  note?: string
}

export interface UnitComfort {
  name: string; area: number; orientation?: string | null
  comfortable_pct: number; overheating_pct: number; too_cold_pct: number
  hours_above_26: number; hours_above_27: number; max_op: number
  heating_kwh_m2: number; cooling_kwh_m2: number
  monthly?: { month: number; mean: number; max: number; min: number }[]
  hot_week?: { start_day: number; op: number[]; out: number[]; upper: number[]; lower: number[]; comfort: number[] }
}

export interface ComfortResult {
  building: string
  floor: number
  method: 'quick' | 'ladybug_tools'
  units: Record<string, UnitComfort>
  summary: Partial<{ comfortable_pct: number; overheating_pct: number; too_cold_pct: number; heating_kwh_m2: number; cooling_kwh_m2: number; units: number; max_op: number }>
  envelope?: string
  note?: string
}

export interface Capabilities {
  sim_python: string | null
  honeybee: boolean
  energyplus: string | null
  radiance: string | null
  recipes?: boolean
  error?: string
}

export type Level =
  | { kind: 'site' }
  | { kind: 'building'; building: string }
  | { kind: 'floor'; building: string; floor: number }
  | { kind: 'unit'; building: string; floor: number; unit: string }

export interface SavedScenario {
  id: string
  name: string
  created: string
  scenarios: Record<string, Settings>
  kpi: { gfa_m2: number; units: number; capex_sek: number; upfront_kgco2e: number; added_gfa_m2: number }
  analysis?: { building: string; floor: number; mean_df?: number; area_300?: number; comfortable_pct?: number; overheating_pct?: number }
}
