import type {
  BuildingPayload, Capabilities, ComfortResult, DaylightResult, Figures, FloorPayload, KpiResult, Methods, ParametricCell,
  ParametricPayload, Project, Settings, SitePayload, UrbanContext, UrbanSummary, SupplierCompare, TimelineResponse,
} from './types'
import type { CompareRow, Occupancy, Params, StudioMeta, StudioPayload, YearKpi, YearOverride } from './studio/engine'
import type { FloorTenancy } from './studio/tenancy'
import type { CompareCardRow, DistrictMeta, DistrictResult, EvacResult, LayerData } from './layers'

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, body === undefined ? undefined : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`
    try { msg = (await res.json()).detail ?? msg } catch { /* keep status */ }
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

export const api = {
  site: () => call<SitePayload>('/api/site'),
  context: () => call<UrbanContext>('/api/context'),
  urban: () => call<UrbanSummary>('/api/urban'),
  building: (id: string, settings: Partial<Settings>) => call<BuildingPayload>(`/api/building/${id}`, { settings }),
  floor: (id: string, index: number, settings: Partial<Settings>) =>
    call<FloorPayload>(`/api/floor/${id}/${index}`, { settings }),
  daylight: (building: string, floor: number, settings: Partial<Settings>, context: Record<string, Partial<Settings>>) =>
    call<DaylightResult>('/api/analysis/daylight', { building, floor, settings, context }),
  comfort: (building: string, floor: number, settings: Partial<Settings>, context: Record<string, Partial<Settings>>, unit?: string) =>
    call<ComfortResult>('/api/analysis/comfort', { building, floor, settings, context, unit }),
  full: (building: string, floor: number, settings: Partial<Settings>, context: Record<string, Partial<Settings>>) =>
    call<{ job: string; status: string }>('/api/analysis/full', { building, floor, settings, context }),
  job: (id: string) => call<{ status: string; error?: string; result?: FullResult }>(`/api/jobs/${id}`),
  capabilities: () => call<Capabilities>('/api/capabilities'),
  models: () => call<{ models: { name: string; url: string; bytes: number }[] }>('/api/models'),
  methods: () => call<Methods>('/api/methods'),
  kpis: (id: string, settings: Partial<Settings>) => call<KpiResult>(`/api/kpis/${id}`, { settings }),
  parametric: (id: string, settings: Partial<Settings>, floor: number) =>
    call<ParametricPayload>(`/api/parametric/${id}`, { settings, floor }),
  cell: (id: string, settings: Partial<Settings>) => call<ParametricCell>(`/api/parametric/${id}/cell`, { settings }),
  supplierCompare: (sid: string, id: string, settings: Partial<Settings>) =>
    call<SupplierCompare>(`/api/supplier/${sid}/compare/${id}`, { settings }),
  project: (pid: string) => call<Project>(`/api/project/${pid}`),
  figures: (id: string, settings: Partial<Settings>) => call<Figures>(`/api/figures/${id}`, { settings }),
  timeline: (id: string, project: string, floor?: number) =>
    call<TimelineResponse>(`/api/timeline/${id}`, { project, floor: floor ?? null }),
  /** One floor at a given use, every other floor untouched — the 3D view behind the floor timeline. */
  floorUse: (id: string, index: number, use: string) => call<FloorPayload>(`/api/floor/${id}/${index}/use/${use}`, {}),
  // floor studio (explorer/studio): furnished layouts, checks, capacity search, year-by-year KPIs, tenancy
  studioMeta: () => call<StudioMeta>('/api/studio/layouts'),
  studioFloor: (id: string, floor: number, layout: string, params: Params) => call<StudioPayload>(`/api/studio/${id}/${floor}`, { layout, params }),
  studioSeries: (id: string, floor: number, layouts: string[], years: number[], params: Params, overrides: (YearOverride | null)[]) =>
    call<{ years: YearKpi[] }>(`/api/studio/${id}/${floor}/series`, { layouts, years, params, overrides }),
  studioMaximise: (id: string, floor: number, layout: string, params: Params) =>
    call<{ layout: string; params: Params; tried: number; before: { people: number; seats: number; allOk: boolean }; after: { people: number; seats: number; allOk: boolean; failed: string[] } }>(
      `/api/studio/${id}/${floor}/maximise`, { layout, params }),
  studioCompare: (id: string, floor: number, layout: string, params: Params) =>
    call<{ today: string; rows: CompareRow[] }>(`/api/studio/${id}/${floor}/compare`, { layout, params }),
  studioOccupancy: (id: string, floor: number, layout: string, params: Params, opts: { days?: number; attendance?: number | null; demand?: number }) =>
    call<Occupancy>(`/api/studio/${id}/${floor}/occupancy`, { layout, params, ...opts }),
  studioEvacuation: (id: string, floor: number, layout: string, params: Params, people?: number | null) =>
    call<{ job: string; status: string }>(`/api/studio/${id}/${floor}/evacuation`, { layout, params, people: people ?? null }),
  evacJob: (job: string) => call<{ status: string; error?: string; result?: EvacResult }>(`/api/jobs/${job}`),
  layers: (studio: Record<number, string>, params: Record<number, Params>) => call<LayerData>('/api/layers', { studio, params }),
  districtMeta: () => call<DistrictMeta>('/api/district/meta'),
  districtRun: (cards: string[], runs = 20) => call<{ strategy: DistrictResult; baseline: DistrictResult }>('/api/district/run', { cards, runs }),
  districtCompare: (runs = 10) => call<{ rows: CompareCardRow[]; runs: number }>('/api/district/compare', { runs }),
  tenancy: (project: string, building: string, floors: { floor: number; gfa: number }[]) =>
    call<{ floors: FloorTenancy[] }>('/api/tenancy', { project, building, floors }),
}

export interface FullResult {
  id: string
  method: string
  rooms?: number
  apertures?: number
  error?: string
  comfort?: { ok: boolean; error?: string; units?: ComfortResult['units'] }
  daylight?: { ok: boolean; error?: string; units?: DaylightResult['units'] }
}

// ------------------------------------------------------------------ formatting
const nf0 = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 0 })
const nf1 = new Intl.NumberFormat('sv-SE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
export const fmt = (v: number | undefined | null) => (v === undefined || v === null || Number.isNaN(v) ? '–' : nf0.format(v))
export const fmt1 = (v: number | undefined | null) => (v === undefined || v === null || Number.isNaN(v) ? '–' : nf1.format(v))
export const msek = (v: number) => `${nf1.format(v / 1e6)} MSEK`
export const tco2 = (v: number) => `${nf0.format(v / 1000)} t CO₂e`
export const pct = (v: number | undefined) => (v === undefined ? '–' : `${nf0.format(v * 100)} %`)

export const USE_LABEL: Record<string, string> = {
  site: 'Current use (site data)',
  office_cellular: 'Office – cellular',
  office_open: 'Office – open plan',
  residential: 'Residential',
  hotel: 'Hotel',
  school: 'School',
  retail: 'Retail',
  restaurant_cafe: 'Restaurant / café',
  same: 'Same as upper floors',
}
export const SYSTEM_LABEL: Record<string, string> = {
  as_profile: 'As in use profile',
  conventional: 'Conventional stud',
  demountable: 'Demountable',
  glass: 'Glazed',
  smartax: 'Smartax (supplier)',
}
/** Series colours per partition system: conventional, demountable, glazed, then supplier systems. */
export const SYSTEM_COLOR: Record<string, string> = {
  conventional: 'var(--color-c2)', demountable: 'var(--color-c3)', glass: 'var(--color-c1)',
  as_profile: 'var(--color-c5)', smartax: 'var(--color-c6)',
}
export const WINDOW_LABEL: Record<string, string> = {
  existing: 'Keep existing (double, fixed)',
  triple_timber: 'New triple, timber, openable',
  triple_alu_wood: 'New triple, alu-clad timber, openable',
}
