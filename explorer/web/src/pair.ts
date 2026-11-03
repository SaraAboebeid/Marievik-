// Two projects in one window (?project=marievik&pair=lindangen). The left project is the whole explorer - header,
// bars, KPI strip, bottom bar - with its 3D view in the left half. The right project runs in a frame over the right
// half (?embed=follow): its own model and panels, no bars of its own. Everything the bars change (scale, lens, sun,
// view, the seasons clock, the decade, the rented/vacant quarter) is posted to it, so one play button plays both.
// It posts its KPI strip back, shown under the left project's.
import type { KpiValue, Methods, ProjectProfile } from './types'
import type { LifeFilter } from './ui/LifePanel'
import type { KpiScale, SiteFigures } from './ui/KpiStrip'
import type { Layer } from './layers'
import type { Scale } from './App'
import type { ViewOptions } from './viewer/Viewer'
import { PROJECTS } from './profile'

const Q = new URLSearchParams(window.location.search)
/** This page is the right half of a pair: no bars, it follows the left. */
export const FOLLOW = Q.get('embed') === 'follow'
/** This page is the left half of a pair: the project shown on the right, or null. */
export const PAIR: string | null = !FOLLOW && PROJECTS[Q.get('pair') ?? ''] ? Q.get('pair') : null

/** What the left posts to the right whenever it changes. */
export interface PairState {
  scale: Scale
  layer: Layer
  sun: { month: number; day: number; hour: number }
  view: ViewOptions
  lifeFilter: LifeFilter
  distYear: number
  leaseStep: number
  profile: string | null
}

/** The right half's KPI strip, drawn by the left. */
export interface PairKpis {
  scale: KpiScale
  profile: ProjectProfile | null
  cavfKpis: string[] | null
  pinned: string[] | null
  methods: Methods | null
  values: Record<string, KpiValue> | null
  valuesFrom: 'here' | 'building' | null
  waiting: string | null
  site: SiteFigures | null
}

export type PairMsg =
  | { t: 'state'; s: PairState }
  | { t: 'season'; se: number; h: number; labels: boolean }
  | { t: 'orbit'; speed: number }
  | { t: 'top'; px: string }          // where the left's bars end: the right's panels start under them
  | { t: 'ready' }
  | { t: 'kpis'; k: PairKpis }

const MARK = 'marievik-pair'
export function post(to: Window | null | undefined, m: PairMsg) {
  to?.postMessage({ [MARK]: m }, window.location.origin)
}
/** Listen for pair messages from the same origin; returns the unsubscribe. */
export function listen(on: (m: PairMsg, from: MessageEventSource | null) => void) {
  const h = (e: MessageEvent) => {
    if (e.origin !== window.location.origin || !e.data?.[MARK]) return
    on(e.data[MARK] as PairMsg, e.source)
  }
  window.addEventListener('message', h)
  return () => window.removeEventListener('message', h)
}

/** The address of the right half. */
export function followerSrc(project: string) {
  const q = new URLSearchParams(window.location.search)
  for (const k of ['pair', 'building', 'split']) q.delete(k)
  q.set('project', project)
  q.set('embed', 'follow')
  return `${window.location.pathname}?${q.toString()}`
}

/** This page with `left` and `right` paired, or `left` alone (right = null). */
export function pairHref(left: string, right: string | null) {
  const q = new URLSearchParams(window.location.search)
  for (const k of ['pair', 'building', 'split', 'embed']) q.delete(k)
  q.set('project', left)
  if (right) q.set('pair', right)
  return `${window.location.pathname}?${q.toString()}`
}

/** The project to pair with `project` first: the next one with a model of its own. */
export function defaultPair(project: string) {
  const keys = Object.keys(PROJECTS)
  return keys.find((k) => k !== project && !PROJECTS[k].placeholder) ?? keys.find((k) => k !== project)!
}
