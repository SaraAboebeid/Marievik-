// Types for the explorer's layers (movement, fire escape, capacity), the JuPedSim evacuation and the
// 10-year district model. Server side: explorer/layers.py, explorer/studio/evacuation.py, explorer/district.py.

export type Layer = 'none' | 'amenities' | 'movement' | 'fire' | 'capacity' | 'vacancy' | 'tenancy' | 'flexibility' | 'seasons'

/** Which lenses make sense at each scale (the rest show greyed out in the lens picker). */
export const LAYERS_AT: Record<'urban' | 'district' | 'building', Layer[]> = {
  urban: ['none', 'amenities', 'seasons', 'capacity'],
  district: ['none', 'capacity', 'vacancy', 'tenancy', 'seasons'],
  building: ['none', 'movement', 'fire', 'capacity', 'vacancy', 'tenancy', 'flexibility'],
}
export const LAYER_ORDER: Layer[] = ['none', 'amenities', 'seasons', 'movement', 'fire', 'capacity', 'vacancy', 'tenancy', 'flexibility']

export interface LayerFloor {
  floor: number; source: 'plan' | 'estimate' | 'mock'; layout: string | null   // mock: capacity invented until the building has plans
  planned: number; legalMax: number; checksOk: boolean | null; failed: string[]
  peak: number; personHours: number | null
  escape_m: number | null; escapeLimit: number; evac_s: number | null
}
export interface LayerBuilding { id: string; name: string; kind: string; c: [number, number]; floors: LayerFloor[]; peak: number; stationTrips: number; vacancyToday: number }
export interface LayerData { buildings: LayerBuilding[]; station: { name: string; xy: [number, number] }; note: string }

export interface EvacResult {
  layout: string; floor: number; people: number; requested: number; stuck: number; errors: string[]
  total: number | null; p50: number | null; p90: number | null; walkOnly: number | null; hand: number
  exits: { id: string; w: number; people: number; first: number | null; last: number | null; flow: number | null }[]
  frames: { dt: number; n: number; agents: number; xy_dm: string }
  heat: { cell: number; nx: number; ny: number; max: number; density_x10: string }
  engine: string; seconds: number; note: string
}

export interface Band { mean: number[]; p10: number[]; p90: number[] }
export interface DistrictBuilding {
  id: string; name: string; kind: string; vacancy: number[]; noi_msek: number[]; people: number[]; attract: number[]; co2_t: number[]
  transit: number; water: number
}
export interface DistrictTotals {
  value_msek: number; value_p10: number; value_p90: number; carbon_t: number; co2_emb_t: number
  vacancy_end: number; people_end: number; evening_end: number; kg_per_person_year: number
}
export interface DistrictResult {
  cards: string[]; runs: number; years: number[]
  district: Record<'vacancy' | 'rent_msek' | 'noi_msek' | 'capex_msek' | 'co2_op_t' | 'co2_emb_t' | 'people' | 'evening' | 'lettings' | 'lost' | 'conversions', Band>
  totals: DistrictTotals
  demand: Record<string, { label: string; won: number; lost: number }>
  mix_end_m2: Record<string, number>
  buildings: DistrictBuilding[]
  urban: { station_trips_per_day: number[]; street_evening_people: number[]; capture_share: number; station: string; note: string }
  note: string
}
export interface StrategyCard { id: string; label: string; card: 'B' | 'U' | 'S'; text: string }
export interface DistrictMeta { strategies: StrategyCard[]; tenants: Record<string, string>; years: number; start_year: number; status: string }
export interface CompareCardRow extends DistrictTotals { id: string; label: string; card: 'B' | 'U' | 'S' | null }

/** Evacuation playback: frame f -> positions (m), NaN where the person is already out. */
export function evacFrames(r: EvacResult): Float32Array[] {
  const raw = Uint8Array.from(atob(r.frames.xy_dm), (c) => c.charCodeAt(0))
  const a = new Int16Array(raw.buffer)
  const n = r.frames.agents, out: Float32Array[] = []
  for (let f = 0; f < r.frames.n; f++) {
    const fr = new Float32Array(n * 2)
    for (let i = 0; i < n * 2; i++) { const v = a[f * n * 2 + i]; fr[i] = v === -32768 ? NaN : v / 10 }
    out.push(fr)
  }
  return out
}

export function evacDensity(r: EvacResult): Float32Array {
  const raw = Uint8Array.from(atob(r.heat.density_x10), (c) => c.charCodeAt(0))
  return Float32Array.from(raw, (v) => v / 10)
}

/** Green → amber → red for a share where 1 is the limit. */
export function riskColour(v: number): string {
  if (!isFinite(v)) return '#9a978e'
  if (v < 0.6) return '#03b05f'
  if (v < 0.85) return '#9fcf4a'
  if (v <= 1) return '#f5c443'
  if (v <= 1.15) return '#fd876e'
  return '#d8342b'
}
/** Pale → deep blue for how busy (0..1). */
export function busyColour(v: number): string {
  const t = Math.max(0, Math.min(1, v))
  const a = [236, 233, 224], b = [5, 40, 202]
  return `rgb(${a.map((x, i) => Math.round(x + (b[i] - x) * t)).join(',')})`
}
