export interface Shell {
  width_mm: number
  depth_mm: number
  ceiling_mm: number
  external_wall_thickness_mm: number
  structural_walls: WallSeg[]
  windows: { x1: number; y1: number; x2: number; y2: number; sill_mm: number; head_mm: number }[]
  entry: { x: number; y: number }
  drainage_stack: { x: number; y: number }
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
}

export interface Plan {
  shell: Shell
  walls: Wall[]
  doors: Door[]
  furniture: FurnitureItem[]
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

export interface Bootstrap {
  shell: Shell
  configurations: Record<string, Configuration>
  wall_types: WallType[]
  furniture: FurnitureSpec[]
  user_groups: UserGroup[]
  uses: { id: string; label: string }[]
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
}

export interface StandardsActivity {
  id: string
  label: string
  depth_mm: number
  width_mm: number
  basis: string
  source_ref: string[]
  cited: boolean
}

export interface StandardsSummary {
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
}

export type Tool = 'select' | 'wall' | 'door'
export type Selection =
  | { kind: 'furniture'; id: string }
  | { kind: 'wall'; id: string }
  | { kind: 'door'; id: string }
  | null
