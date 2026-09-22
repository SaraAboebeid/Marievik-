import type { Bootstrap, EvalResult, Plan, Settings, StandardsSummary } from './types'

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`)
  return res.json() as Promise<T>
}

export const getBootstrap = () => json<Bootstrap>('/api/bootstrap')

export const evaluatePlan = (plan: Plan, settings: Settings) =>
  json<EvalResult>('/api/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan, settings }),
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
  json<{ ok: boolean; x?: number; y?: number; rot?: number; reason?: string }>('/api/place', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan, type, settings, anchor }),
  })

export const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
export const fmt1 = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 1 })
export const sek = (n: number) =>
  Math.abs(n) >= 1e6 ? `${fmt1(n / 1e6)} M` : fmt(n)
export const kg = (n: number) =>
  Math.abs(n) >= 1000 ? `${fmt1(n / 1000)} t` : `${fmt(n)} kg`
