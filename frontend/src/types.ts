export interface Window {
  id?: string
  x1: number
  y1: number
  x2: number
  y2: number
  sill_mm: number
  head_mm: number
  glazing?: 'existing' | 'upgraded'
  door?: boolean
}

export interface Shell {
  width_mm: number
  depth_mm: number
  ceiling_mm: number
  external_wall_thickness_mm: number
  facade_y_mm?: number
  outline?: [number, number][]
  structural_walls: WallSeg[]
  windows: Window[]
  entry: { x: number; y: number }
  drainage_stack: { x: number; y: number }
  wet?: { x0: number; y0: number; x1: number; y1: number }
  fixed_walls?: string[]
  location?: string
  facade_azimuth_deg?: number
}

export interface WallSeg {
  x1: number
  y1: number
  x2: number
  y2: number
  thickness?: number
}

export interface Wall extends WallSeg {
  id: string
  component: string
  fixed?: boolean
  wet?: boolean
}

export interface Door {
  id: string
  wall_id: string
  t: number
  clear_mm: number
}

export interface FurnitureItem {
  id: string
  type: string
  x: number
  y: number
  rot: number
  product?: string
  fixed?: boolean
}

export interface Plan {
  shell: Shell
  walls: Wall[]
  doors: Door[]
  furniture: FurnitureItem[]
  works?: { component: string; quantity: number; source?: string }[]
}

export interface WallType {
  id: string
  name: string
  short: string
  layer: string
  rw: number
  fire: string
  reversibility: number
  recovery_rate: number
  service_life: number
  cost_m2: number
  demount_m2: number
  carbon_m2: number
  notes: string
}

export interface FurnitureSpec {
  id: string
  name: string
  category: string
  w: number
  d: number
  h: number
  clearance_front_mm: number
  clearance_side_mm?: number
  cost_sek: number
  carbon_kgco2e: number
  service_life_years: number
  reversibility: number
  recovery_rate: number
  is_space_reservation?: boolean
  storage_m3?: number
  seats?: number
  sleeps?: number
  notes?: string
}

export interface Product {
  id: string
  type: string
  strategy: string
  name: string
  supplier: string
  cost_sek: number
  carbon_kgco2e: number
  service_life_years: number
  recovery_rate: number
  functionality: number
  functionality_note: string
}

export interface UserGroup {
  id: string
  label: string
  turning_circle: number
  passage_width: number
  door_clear: number
  notes: string
}

export interface Configuration {
  label: string
  use: string
  occupants: number
  user_group: string
  description: string
  walls: Wall[]
  doors: Door[]
  furniture: FurnitureItem[]
}

export interface ShellEntry {
  label: string
  shell: Shell
  configurations: Record<string, Configuration>
  meta: Record<string, string>
}

export interface ParameterMeta {
  label: string
  unit: string
  values: (number | string)[]
}

export interface Criterion {
  label: string
  unit: string
  sense: number
}

export interface Bootstrap {
  shell: Shell
  configurations: Record<string, Configuration>
  wall_types: WallType[]
  furniture: FurnitureSpec[]
  user_groups: UserGroup[]
  uses: { id: string; label: string }[]
  briefs: { id: string; label: string; target_area_m2: number;
    densities: { occupants: number; user_group: string; label: string }[] }[]
  shells: Record<string, ShellEntry>
  default_shell: string
  products: Product[]
  product_strategies: Record<string, string>
  partition_specs: Record<string, { label: string; component: string; note: string }>
  parameters: Record<string, ParameterMeta>
  stakeholders: Record<string, { label: string; w: Record<string, number> }>
  criteria: Record<string, Criterion>
  provenance: string
}

export interface SocialMetric {
  name: string
  score: number
  band: 'good' | 'acceptable' | 'poor' | 'failing'
  detail: string
  hard_fail: boolean
}

export interface RoomInfo {
  index: number
  area_m2: number
  kind: string
  daylight: boolean
  depth_mm: number
  turn_mm: number
  reachable: boolean
  window_m: number
  centroid: [number, number]
}

export interface Issue {
  severity: 'blocker' | 'major' | 'minor'
  title: string
  detail: string
}

export interface BlockedItem {
  id: string
  type: string
  name: string
  severity: string
  blocked_fraction: number
  detail: string
}

export type Criteria = Partial<Record<'lcc' | 'carbon' | 'comfort' | 'usability' | 'functionality', number>>

export interface EvalResult {
  area_m2: number
  free_floor_m2: number
  furnished_m2: number
  wall_length_m: number
  years: number
  financial: {
    capex: number
    capex_m2: number
    opex_annual: number
    opex_npv: number
    replacement_npv: number
    residual_npv: number
    lcc: number
    lcc_m2: number
  }
  environmental: {
    upfront: number
    a1a3: number
    b4: number
    c1c4: number
    embodied: number
    operational: number
    total: number
    total_m2: number
    embodied_share: number
    d_credit: number
  }
  social: SocialMetric[]
  social_mean: number
  rooms: RoomInfo[]
  issues: Issue[]
  blocked: BlockedItem[]
  turning: { max_mm: number; required_mm: number; coverage: number }
  clearance_grid: { step_mm: number; cols: number; rows: number; values: number[] }
  criteria?: Criteria
  functionality_detail?: Record<string, number>
  works?: { component: string; quantity: number }[]
}

export interface ThermalRoom {
  space: string
  label: string
  kind: string
  area_m2: number
  comfort_pct: number
  hot_pct: number
  cold_pct: number
  hours_over_26: number
  max_c: number
  zones: [number, number, number, number][]
}

export interface ThermalResult {
  ok: boolean
  error?: string
  comfort?: number
  comfort_pct?: number
  hot_pct?: number
  cold_pct?: number
  worst_room?: string
  worst_hours_over_26?: number
  worst_max_c?: number
  heating_kwh_m2?: number
  cooling_kwh_m2?: number
  rooms?: ThermalRoom[]
  seconds?: number
}

export interface SweepFrame {
  value: number | string
  skipped?: string
  plan?: Plan
  settings?: Settings
  criteria?: Criteria
  kpis?: { capex: number; lcc: number; carbon_upfront: number; carbon_total: number; issues: number }
  thermal?: ThermalResult
}

export interface SweepResult {
  parameter: string
  meta: ParameterMeta
  frames: SweepFrame[]
  least_regret: number | null
  thermal: boolean
}

export interface OptionResult {
  id: string
  use: string
  description: string
  occupants: number
  user_group: string
  window: string
  partition: string
  products: string
  lcc_per_person: number
  carbon_per_person: number
  m2_per_person: number
  comfort: number
  usability: number
  functionality: number
  plan: Plan
  regret?: { max_regret: number; worst_for: string; regret: Record<string, number> }
  thermal?: ThermalResult
}

export interface OptimiseResult {
  shell_id: string
  uses: Record<string, {
    brief: { id: string; label: string }
    options: OptionResult[]
    recommended?: string
    stats: Record<string, unknown>
  }>
  adaptability?: {
    by_start_use: Record<string, { robust: string }>
    candidates: Record<string, Record<string, { description: string; partition: string }>>
  }
  elapsed_s: number
}

export interface ScenarioState {
  status: 'running' | 'ready' | 'failed'
  log: string[]
  elapsed_s: number
  result?: OptimiseResult
}

export interface Job {
  id: string
  status: 'running' | 'done' | 'failed'
  log: string[]
  log_length: number
  elapsed_s: number
  result?: OptimiseResult
  report?: string
}

export interface StandardsActivity {
  id: string
  label: string
  depth_mm: number
  width_mm: number
  basis: string
  source_ref: string[]
  citations: { raw: string; short: string; full: string; page: string; resolved: boolean }[]
  neufert_ref: string
  note?: string
  cited: boolean
}

export interface StandardsHeight {
  id: string
  label: string
  value_mm: number
  basis: string
  is_maximum: boolean
  source_ref: string[]
  neufert_ref: string
  note?: string
  warning?: string
}

export interface StandardsSummary {
  heights: StandardsHeight[]
  layout_standards: Record<string, Record<string, number | string | string[]>>
  user_group: string
  label: string
  posture: string
  envelope: Record<string, unknown>
  turning_circle_mm: number
  turning_basis: string
  turning_source: string[]
  reach_band_mm: [number, number] | null
  max_sill_for_view_mm: number
  sill_basis: string
  activities: StandardsActivity[]
  uncited_count: number
  coverage: {
    records: number
    cited: number
    cited_share: number
    neufert_verified: number
    neufert_share: number
    uncited: string[]
  }
}

export interface Settings {
  use: string
  user_group: string
  occupants: number
  years: number
  shell_id?: string
  azimuth?: number
  heating_kwh_m2?: number
  cooling_kwh_m2?: number
  comfort?: number
}

export type Tool = 'select' | 'wall' | 'door' | 'window'
export type Selection =
  | { kind: 'furniture'; id: string }
  | { kind: 'wall'; id: string }
  | { kind: 'door'; id: string }
  | { kind: 'window'; index: number }
  | null
