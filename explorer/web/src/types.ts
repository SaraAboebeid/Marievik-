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
  suppliers: Supplier[]
}

// ---------------------------------------------------------------- projects and their stakeholder profiles (data/projects)
export interface ProjectProfile {
  id: string; title: string; title_en: string; mandate: string; focus: string; risk: string
  timeline_kpis: string[]; needs_data: string[]; cavf_profile: string
}
export interface Project {
  id: string; name: string; city: string; owner: string; pilot_buildings: string[]
  profiles: ProjectProfile[]
  timeline: { start_year: number; years: number; decision_years: number[]; decision_years_source: string; max_changes: number }
}

// ---------------------------------------------------------------- key figures (explorer/figures.py)
export interface Figure { value: number | string; label: string; unit: string; status: KpiStatus; note?: string }
export interface Distribution { label: string; use: string; rows: { category: string; m2: number; share: number }[] }
export interface Figures {
  building: string; key: string
  figures: Record<'gfa_m2' | 'usable_m2' | 'occupancy' | 'capex_sek' | 'upfront_kgco2e' | 'utilization' | 'adaptability' | 'daylight_access', Figure>
  distribution: { ground: Distribution; typical: Distribution }
}

// ---------------------------------------------------------------- 10-year timeline (explorer/timeline.py)
export interface TimelineIssue { severity: 'blocker' | 'major' | 'info'; group: string; kind: string; text: string }
export interface TimelineState {
  key: string; settings: { ground_use: string; use: string }
  groups: Record<string, { use: string; label: string; catalogue_use: string; gfa_m2: number; persons: number
    fire_class: string; walk_m: number; walk_limit_m: number; units_without_window: number }>
  issues: TimelineIssue[]; assumptions: string[]; blocked: boolean
  people: number; people_hours: number; evening_share: number; uses_count: number
}
export interface TimelineEvent {
  year: number; from: string; to: string; walls_new_m2: number; walls_removed_m2: number; walls_changed_m2: number
  finish_m2: number; slab_opening_m2: number; capex_sek: number; co2_kg: number; months: number; floors_changed: number
}
export interface TimelineYear { year: number; state: string; event: TimelineEvent | null; kpi: Record<string, number> }
export interface TimelineSegment {
  id: string; label: string; segment: 1 | 2; summary?: string; events: TimelineEvent[]; years: TimelineYear[]
  highlight?: boolean; changes?: number
  steps?: { year: number; state: string; label: string }[]
  totals?: { walls_changed_m2: number; capex_sek: number; people_hours_10y: number }
}
export interface TimelineKpiMeta { label: string; unit: string; better: 'higher' | 'lower'; status: KpiStatus; note: string }
export interface Timeline {
  status: 'ready'; building: string; project: string; years: number[]; decision_years: number[]
  decision_years_source: string; today: string; states: Record<string, TimelineState>
  segments: TimelineSegment[]; kpis: Record<string, TimelineKpiMeta>
  assumptions: Record<string, { value: number; source: string }>; pathways_tested: number; states_tested: number
}
export type TimelineResponse = Timeline | { status: 'computing' | 'failed'; done: number; total: number; error?: string }

// ---------------------------------------------------------------- supplier product cards (data/components/suppliers)
export interface SupplierProduct {
  id: string; name: string; Rw_dB: number; fire_class: string; thickness_mm: number; max_height_m?: number
  capex_sek_m2: number; labour_demount_sek_m2: number; upfront_kgco2e_m2: number; c1c4_kgco2e_m2: number; d_kgco2e_m2: number
  reversibility: number; recovery_rate: number; fixing: string; service_life_years: number
  estimate: boolean; cost_provenance: string; carbon_provenance: string; notes: string
}
export interface Supplier {
  id: string; supplier: string; title: string; system: string; received: string; product: string
  strengths: string[]; open_questions: string[]; sources: Record<string, string>; confidential: boolean
  products: SupplierProduct[]
}
export interface SupplierSystemResult {
  system: string; wall_area_m2: number; walls_capex_sek: number; walls_upfront_kgco2e: number
  capex_sek: number; upfront_kgco2e: number; sound_below_m2: number; fire_below_m2: number
  too_tall: WallCheck['too_tall']; builds: { type: string; name: string; area_m2: number }[]
  strip_cost_sek: number; strip_kgco2e: number; recovered_m2: number; strip_unknown_m2: number; placeholder_share: number
}
export interface SupplierCompare { supplier: string; building: string; settings: Settings; systems: SupplierSystemResult[] }

// ---------------------------------------------------------------- parametric view (the dashboard's Grasshopper view, live)
export interface PlanGeometry {
  index: number; use: string; wall_h: number
  walls: { id: string; cat: string; type: string; a: XY; b: XY; t: number }[]
  openings: { wall: string; kind: 'door' | 'window'; s0: number; s1: number; new: boolean }[]
  rooms: { id: string; name: string; area: number; poly: XY[]; label: XY }[]
  footprint: XY[]; voids: XY[][]
}
export interface BillLine {
  id: string; name: string; supplier: string; layer: string; unit: string; qty: number
  capex_sek: number; upfront_kgco2e: number; verified: boolean
}
export interface ParametricPayload {
  building: string; key: string; settings: Settings; floor: number
  floors: { index: number; use: string; use_label: string; added: boolean }[]
  plan: PlanGeometry
  kpi: BuildingKpi & { nfa_m2: number; unit_name: string; partition_run_m: number; partition_density: number; doors: number }
  bill: BillLine[]; unpriced: Record<string, number>; mock_priced_rows: number
}
export interface ParametricCell { upfront_kgco2e_per_m2: number; capex_sek_per_m2: number; walls_ok: boolean }

export interface Blocker { kind: string; text: string; severity: string }

// ---------------------------------------------------------------- CAVF KPIs (explorer/kpis.py)
export type KpiStatus = 'computed' | 'partial' | 'placeholder'
export interface KpiValue { value: number | string | null; display: string; status: KpiStatus; note: string }
export interface KpiResult { building: string; key: string; kpis: Record<string, KpiValue> }
export interface KpiDef {
  name: string; group: string; scale: string; formula: string; definitions: string; meaning: string
  status: string; notes: string; source: string; explorer: string
}
export interface ProfileDef { name: string; scale: string; kpis: string[]; provisional?: boolean }
export interface CatalogueComponent {
  id: string; name: string; supplier: string; layer: string; unit: string; service_life_years: number
  reversibility: number; recovery_rate: number
  cost_sek: { material: number; labour_install: number; labour_demount?: number; provenance: string }
  carbon_kgco2e: { A1A3: number; A4: number; A5: number; C1C4: number; D: number; provenance: string }
}
export interface Methods {
  kpis: Record<string, KpiDef>
  profiles: Record<string, ProfileDef>
  scenarios: {
    scenarios: { id: string; name: string; meaning: string; driver: string }[]
    years: number[]; rules: string[]; symbols: string
    example: { note: string; columns: string[]; rows: (string | number)[][]; worked: string[] }
  }
  data: {
    catalogue: { meta: Record<string, string>; file: string; components: CatalogueComponent[] }
    study_period: { start_year: number; length_years: number; discount_rate_real: number; carbon_discounting: boolean; carbon_discounting_note: string; file: string }
    placeholders: Record<string, { value: number | string; unit: string; basis: string } | Record<string, string> | string>
  }
}

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
  walls: WallCheck
  blockers: Blocker[]
}

/** New walls against the use profiles' indicative sound and fire requirements (mvk.layout.check_requirements). */
export interface WallCheck {
  checked_m2: number
  unknown_m2: number
  sound_below_m2: number
  fire_below_m2: number
  shortfalls: { use: string; category: string; type: string; area_m2: number; required: string; has: string; sound_ok: boolean; fire_ok: boolean }[]
  too_tall: { type: string; max_height_m: number; wall_h: number; floors: number[] }[]
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
