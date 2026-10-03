import type {
  Bootstrap, EvalResult, Job, Plan, ScenarioState, Settings, StandardsSummary, SweepResult, ThermalResult,
} from './types'

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    let detail = ''
    try { detail = (await res.json()).detail ?? '' } catch { /* not json */ }
    throw new Error(`${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`)
  }
  return res.json() as Promise<T>
}

const post = <T,>(url: string, body: unknown) =>
  json<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

export const getBootstrap = () => json<Bootstrap>('/api/bootstrap')

/** Evaluator KPIs plus the five optimiser criteria, window works costed. */
export const scorePlan = (plan: Plan, settings: Settings) =>
  post<EvalResult>('/api/score', { plan, settings })

export const simulateThermal = (plan: Plan, settings: Settings) =>
  post<ThermalResult>('/api/thermal', { plan, settings })

export const sweep = (
  plan: Plan, settings: Settings, parameter: string,
  opts: { values?: (number | string)[]; wall_id?: string; thermal?: boolean } = {},
) => post<SweepResult>('/api/sweep', { plan, settings, parameter, ...opts })

export const startOptimise = (shell_id: string, uses: string[], quick: boolean, azimuth?: number) =>
  post<{ job: string }>('/api/optimise', { shell_id, uses, quick, azimuth })

export const getScenarios = (shellId: string) => json<ScenarioState>(`/api/scenarios/${shellId}`)
export const refreshScenarios = (shellId: string) =>
  post<{ status: string }>(`/api/scenarios/${shellId}/refresh`, {})

export const getJob =(id: string, since = 0) => json<Job>(`/api/jobs/${id}?since=${since}`)

export const arrange = (plan: Plan, settings: Settings, variants = 1) =>
  post<{ variants: { furniture: Plan['furniture']; score: number }[] }>('/api/arrange', {
    plan, settings, variants, iterations: 5000,
  })

export const getStandards = (userGroup: string) =>
  json<StandardsSummary>(`/api/standards/${userGroup}`)

/** Ask the engine where a new item fits. It knows where the free floor is. */
export const findPlacement = (
  plan: Plan,
  type: string,
  settings: Settings,
  anchor?: [number, number],
) =>
  post<{ ok: boolean; x?: number; y?: number; rot?: number; reason?: string }>('/api/place', {
    plan, type, settings, anchor,
  })

export const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
export const fmt1 = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 1 })
export const sek = (n: number) =>
  Math.abs(n) >= 1e6 ? `${fmt1(n / 1e6)} M` : fmt(n)
export const kg = (n: number) =>
  Math.abs(n) >= 1000 ? `${fmt1(n / 1000)} t` : `${fmt(n)} kg`
