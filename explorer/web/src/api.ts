import type {
  BuildingPayload, Capabilities, ComfortResult, DaylightResult, FloorPayload, Settings, SitePayload,
} from './types'

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
  same: 'Same as upper floors',
}
export const SYSTEM_LABEL: Record<string, string> = {
  as_profile: 'As in use profile',
  conventional: 'Conventional stud',
  demountable: 'Demountable',
  glass: 'Glazed',
}
export const WINDOW_LABEL: Record<string, string> = {
  existing: 'Keep existing (double, fixed)',
  triple_timber: 'New triple, timber, openable',
  triple_alu_wood: 'New triple, alu-clad timber, openable',
}
