import { useState } from 'react'
import type { KpiValue, Methods, ProjectProfile } from '../types'

export type KpiScale = 'urban' | 'district' | 'building' | 'floor'

interface Props {
  scale: KpiScale
  profile: ProjectProfile | null
  cavfKpis: string[] | null          // a generic profile's CAVF KPIs, when there is no project profile
  pinned: string[] | null            // ticked on the landing page (?kpis=): followed at every scale
  methods: Methods | null
  values: Record<string, KpiValue> | null   // at this scale: the building's KPIs, or the district/urban totals
  valuesFrom: 'here' | 'building' | null    // 'building': on a floor, the figures are the whole building's
  waiting: string | null                    // why there are no values yet ("Pick a building", "Calculating…")
  onExplain: (kpi: string) => void
}

const TONE = {
  computed: { dot: 'bg-[#0a7a4a]', label: 'calculated' },
  partial: { dot: 'bg-accent', label: 'partly calculated' },
  placeholder: { dot: 'bg-[#d08a1c]', label: 'placeholder value' },
} as const

/** The KPI strip under the top bar: the profile's KPIs for the scale on screen (data/projects/<id>.json
 *  scale_kpis), then the ones followed from the landing page that this scale doesn't already show, then the
 *  profile's KPIs that belong to no place (decision influence, ...) in a Project chip. Each tile says honestly
 *  whether it is calculated here, borrowed from the building, a placeholder, or not available at this scale. */
export function KpiStrip({ scale, profile, cavfKpis, pinned, methods, values, valuesFrom, waiting, onExplain }: Props) {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('mvx-kpistrip') !== '0' } catch { return true } })
  const toggle = () => setOpen((o) => { try { localStorage.setItem('mvx-kpistrip', o ? '0' : '1') } catch { /* private window */ } return !o })

  const sk = profile?.scale_kpis
  const atScale = sk?.[scale] ?? cavfKpis ?? []
  const primary = new Set(profile?.primary_kpis ?? [])
  const role = [...(profile?.primary_kpis ?? []), ...(profile?.secondary_kpis ?? [])]
  const governance = (k: string) => methods?.kpis[k]?.group === 'Governance'   // about the process, not a place
  const mine = [...new Set(pinned ?? role)].filter((k) => !atScale.includes(k))
  const followed = mine.filter((k) => !governance(k))
  const project = mine.filter(governance)
  const name = (k: string) => methods?.kpis[k]?.name ?? k.replace(/_/g, ' ')
  const scaleName = scale[0].toUpperCase() + scale.slice(1)

  const tile = (k: string, kind: 'scale' | 'followed') => {
    const v = values?.[k]
    const tone = v ? TONE[v.status] : null
    const borrowed = v && valuesFrom === 'building'
    const title = v
      ? `${name(k)} · ${tone!.label}${borrowed ? ' · whole-building figure (not calculated per floor yet)' : ''}\n${v.note}\nClick for the method`
      : `${name(k)} · ${waiting ?? `not calculated at ${scale} scale yet`}\n${methods?.kpis[k]?.explorer ?? ''}\nClick for the method`
    return (
      <button key={kind + k} type="button" onClick={() => onExplain(k)} title={title}
        className={`flex min-w-[8.5rem] max-w-[13rem] shrink-0 flex-col items-start rounded-md border-2 px-2 py-1 text-left transition-[transform,box-shadow] hover:-translate-y-px ${
          kind === 'followed' ? 'border-dashed border-edge bg-surface' : 'border-edge bg-surface shadow-[2px_2px_0_var(--color-edge)]'
        } ${primary.has(k) && kind === 'scale' ? 'border-t-[5px] border-t-coral' : ''}`}>
        <span className="flex w-full items-center gap-1 font-mono text-[9.5px] uppercase tracking-[0.06em] text-ink-2">
          <span className="min-w-0 truncate">{name(k)}</span>
          {tone && <i className={`ml-auto h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} aria-label={tone.label} />}
        </span>
        {v ? (
          <span className={`whitespace-nowrap font-mono text-[13.5px] font-semibold tabular-nums leading-tight ${borrowed ? 'text-ink-2' : 'text-ink'}`}>
            {v.display}{borrowed && <span className="ml-1 font-sans text-[9.5px] font-normal text-muted">bldg</span>}
          </span>
        ) : (
          <span className="text-[11.5px] italic leading-tight text-muted">{waiting ?? 'not at this scale yet'}</span>
        )}
      </button>
    )
  }

  if (!atScale.length && !followed.length) return null
  return (
    <div className="-mx-4 -mb-2 mt-0.5 basis-full border-t-2 border-edge bg-sunken/70">
      <div className="flex items-stretch gap-2 px-4 py-1.5">
        <button type="button" onClick={toggle} aria-expanded={open} title={open ? 'Hide the KPI strip' : 'Show the KPI strip'}
          className="flex shrink-0 flex-col items-start justify-center rounded-md border-2 border-edge bg-coral px-2 py-0.5 text-left shadow-[2px_2px_0_var(--color-edge)]">
          <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.08em] text-[#202020]">KPIs {open ? '▴' : '▾'}</span>
          <span className="text-[11px] font-semibold leading-tight text-[#202020]">{scaleName}</span>
        </button>
        {open && (
          <div className="flex min-w-0 flex-1 items-stretch gap-1.5 overflow-x-auto pb-0.5">
            {atScale.map((k) => tile(k, 'scale'))}
            {followed.length > 0 && (
              <>
                <span className="flex shrink-0 items-center px-1 font-mono text-[9.5px] uppercase tracking-[0.08em] text-muted" title="Followed from your landing-page choice, though this scale doesn't focus on them">
                  also followed
                </span>
                {followed.map((k) => tile(k, 'followed'))}
              </>
            )}
            {project.length > 0 && (
              <button type="button" onClick={() => onExplain(project[0])}
                title={`Project KPIs, not tied to a place: ${project.map(name).join(', ')}. Qualitative, assessed for the project as a whole.`}
                className="ml-auto flex shrink-0 flex-col items-start justify-center rounded-md border-2 border-edge bg-surface px-2 py-1 text-left">
                <span className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-ink-2">Project</span>
                <span className="text-[11.5px] leading-tight text-ink">{project.map(name).join(' · ')}</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
