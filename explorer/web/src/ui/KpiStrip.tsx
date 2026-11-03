import { useState, type ReactNode } from 'react'
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
  site?: SiteFigures | null                 // with no building open: the whole site's current scenario, first in the strip
  tag?: string                              // two projects in one window: the left project's name
  pair?: PairSide | null                    // two projects in one window: the right project, compared tile by tile
}

/** The right project's half of a shared strip (what pair.ts posts back). */
export interface PairSide {
  tag: string
  profile: ProjectProfile | null
  cavfKpis: string[] | null
  pinned: string[] | null
  values: Record<string, KpiValue> | null
  valuesFrom: 'here' | 'building' | null
  waiting: string | null
  site: SiteFigures | null
}

export interface SiteFigures {
  tiles: { label: string; value: string; unit?: string; sub?: string }[]
  note: string        // where the figures come from (the tooltip of the group's label)
  progress?: string   // "4/13 laid out" while the buildings are still being laid out
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
export function KpiStrip({ scale, profile, cavfKpis, pinned, methods, values, valuesFrom, waiting, onExplain, site, tag, pair }: Props) {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('mvx-kpistrip') !== '0' } catch { return true } })
  const toggle = () => setOpen((o) => { try { localStorage.setItem('mvx-kpistrip', o ? '0' : '1') } catch { /* private window */ } return !o })

  const governance = (k: string) => methods?.kpis[k]?.group === 'Governance'   // about the process, not a place
  const lists = (p: ProjectProfile | null, cavf: string[] | null, pin: string[] | null) => {
    const role = [...(p?.primary_kpis ?? []), ...(p?.secondary_kpis ?? [])]
    return { atScale: p?.scale_kpis?.[scale] ?? cavf ?? [], primary: p?.primary_kpis ?? [], mine: [...new Set(pin ?? role)] }
  }
  const a = lists(profile, cavfKpis, pinned)
  const b = pair ? lists(pair.profile, pair.cavfKpis, pair.pinned) : null
  // two projects: one strip with the KPIs either of them looks at here, each tile showing both values
  const atScale = [...new Set([...a.atScale, ...(b?.atScale ?? [])])]
  const primary = new Set([...a.primary, ...(b?.primary ?? [])])
  const mine = [...new Set([...a.mine, ...(b?.mine ?? [])])].filter((k) => !atScale.includes(k))
  const followed = mine.filter((k) => !governance(k))
  const project = mine.filter(governance)
  const name = (k: string) => methods?.kpis[k]?.name ?? k.replace(/_/g, ' ')
  const scaleName = scale[0].toUpperCase() + scale.slice(1)

  // one project's line in a shared tile: its name, then its value
  const who = (t: string) => (
    <span className="w-[6.4em] shrink-0 truncate font-sans text-[9.5px] font-semibold uppercase tracking-[0.04em] text-ink-2" title={t}>{t}</span>
  )
  const line = (t: string, shown: ReactNode | null, why: string | null, dim?: boolean) => (
    <span className="flex w-full items-baseline gap-1.5 leading-tight">
      {who(t)}
      {shown != null ? (
        <span className={`whitespace-nowrap font-mono text-[12.5px] font-semibold tabular-nums ${dim ? 'text-ink-2' : 'text-ink'}`}>{shown}</span>
      ) : (
        <span className="truncate text-[11px] italic text-muted">{why ?? 'not here yet'}</span>
      )}
    </span>
  )
  const kpiLine = (t: string, v: KpiValue | undefined, from: 'here' | 'building' | null, why: string | null) => {
    const borrowed = !!v && from === 'building'
    return line(t, v ? <>{v.display}{borrowed && <span className="ml-1 font-sans text-[9px] font-normal text-muted">bldg</span>}</> : null, why, borrowed)
  }

  const tile = (k: string, kind: 'scale' | 'followed') => {
    const v = values?.[k]
    const tone = v ? TONE[v.status] : null
    const borrowed = v && valuesFrom === 'building'
    const title = v
      ? `${name(k)} · ${tone!.label}${borrowed ? ' · whole-building figure (not calculated per floor yet)' : ''}\n${v.note}\nClick for the method`
      : `${name(k)} · ${waiting ?? `not calculated at ${scale} scale yet`}\n${methods?.kpis[k]?.explorer ?? ''}\nClick for the method`
    const both = pair ? `${tag}: ${v?.display ?? waiting ?? '—'}\n${pair.tag}: ${pair.values?.[k]?.display ?? pair.waiting ?? '—'}\n` : ''
    return (
      <button key={kind + k} type="button" onClick={() => onExplain(k)} title={both + title}
        className={`flex ${pair ? 'min-w-[10rem] max-w-[14rem]' : 'min-w-[8.5rem] max-w-[13rem]'} shrink-0 flex-col items-start rounded-md border-2 px-2 py-1 text-left transition-[transform,box-shadow] hover:-translate-y-px ${
          kind === 'followed' ? 'border-dashed border-edge bg-surface' : 'border-edge bg-surface shadow-[2px_2px_0_var(--color-edge)]'
        } ${primary.has(k) && kind === 'scale' ? 'border-t-[5px] border-t-coral' : ''}`}>
        <span className="flex w-full items-center gap-1 font-mono text-[9.5px] uppercase tracking-[0.06em] text-ink-2">
          <span className="min-w-0 truncate">{name(k)}</span>
          {tone && <i className={`ml-auto h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} aria-label={tone.label} />}
        </span>
        {pair ? (
          <>
            {kpiLine(tag ?? '', v, valuesFrom, waiting)}
            {kpiLine(pair.tag, pair.values?.[k], pair.valuesFrom, pair.waiting)}
          </>
        ) : v ? (
          <span className={`whitespace-nowrap font-mono text-[13.5px] font-semibold tabular-nums leading-tight ${borrowed ? 'text-ink-2' : 'text-ink'}`}>
            {v.display}{borrowed && <span className="ml-1 font-sans text-[9.5px] font-normal text-muted">bldg</span>}
          </span>
        ) : (
          <span className="text-[11.5px] italic leading-tight text-muted">{waiting ?? 'not at this scale yet'}</span>
        )}
      </button>
    )
  }

  // two projects: the site figures matched by label, each tile showing both
  const sites = pair ? [site, pair.site] : [site]
  const tags = pair ? [tag ?? '', pair.tag] : ['']
  const anySite = sites.some(Boolean)
  const siteLabels = sites.flatMap((s) => s?.tiles.map((t) => t.label) ?? []).filter((l, i, all) => all.indexOf(l) === i)
  const siteNote = pair ? sites.map((s, i) => s && `${tags[i]}: ${s.note}`).filter(Boolean).join('\n') : site?.note ?? ''
  const siteProgress = pair ? sites.map((s, i) => s?.progress && `${tags[i]} ${s.progress}`).filter(Boolean).join(' · ') : site?.progress

  if (!atScale.length && !followed.length && !anySite) return null
  return (
    <div className="-mx-4 -mb-2 mt-0.5 basis-full border-t-2 border-edge bg-sunken/70">
      <div className="flex items-stretch gap-2 px-4 py-1.5">
        <button type="button" onClick={toggle} aria-expanded={open} title={open ? 'Hide the KPI strip' : 'Show the KPI strip'}
          className="flex shrink-0 flex-col items-start justify-center rounded-md border-2 border-edge bg-coral px-2 py-0.5 text-left shadow-[2px_2px_0_var(--color-edge)]">
          <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.08em] text-[#202020]">KPIs {open ? '▴' : '▾'}</span>
          <span className="text-[11px] font-semibold leading-tight text-[#202020]">{tag && !pair ? `${tag} · ${scaleName}` : scaleName}</span>
          {pair && <span className="text-[10px] leading-tight text-[#202020]/80">{tag} vs {pair.tag}</span>}
        </button>
        {open && (
          <div className="flex min-w-0 flex-1 items-stretch gap-1.5 overflow-x-auto pb-0.5">
            {pair && anySite && (
              <>
                <span className="flex max-w-[9rem] shrink-0 flex-col justify-center px-1 font-mono text-[9.5px] uppercase tracking-[0.08em] text-ink-2" title={siteNote}>
                  Site · now
                  {siteProgress && <span className="normal-case tracking-normal text-muted">{siteProgress}</span>}
                </span>
                {siteLabels.map((l) => {
                  const f = sites.map((s) => s?.tiles.find((t) => t.label === l))
                  return (
                    <div key={l} title={`${l}\n${f.map((t, i) => `${tags[i]}: ${t ? `${t.value} ${t.unit ?? ''}${t.sub ? ` · ${t.sub}` : ''}` : '—'}`).join('\n')}\n${siteNote}`}
                      className="flex min-w-[10rem] max-w-[14rem] shrink-0 flex-col items-start rounded-md border-2 border-edge bg-surface px-2 py-1 shadow-[2px_2px_0_var(--color-edge)]">
                      <span className="w-full truncate font-mono text-[9.5px] uppercase tracking-[0.06em] text-ink-2">{l}</span>
                      {f.map((t, i) => (
                        <span key={i} className="contents">
                          {line(tags[i], t ? <>{t.value}{t.unit && <span className="ml-1 font-sans text-[9.5px] font-normal text-ink-2">{t.unit}</span>}</> : null, '—')}
                        </span>
                      ))}
                    </div>
                  )
                })}
                {(atScale.length > 0 || followed.length > 0) && <span className="mx-1 w-0.5 shrink-0 self-stretch bg-edge/40" aria-hidden />}
              </>
            )}
            {!pair && site && (
              <>
                <span className="flex shrink-0 flex-col justify-center px-1 font-mono text-[9.5px] uppercase tracking-[0.08em] text-ink-2" title={site.note}>
                  Site · now
                  {site.progress && <span className="normal-case tracking-normal text-muted">{site.progress}</span>}
                </span>
                {site.tiles.map((t) => (
                  <div key={t.label} title={`${t.label}${t.sub ? ` · ${t.sub}` : ''}\n${site.note}`}
                    className="flex min-w-[8.5rem] max-w-[13rem] shrink-0 flex-col items-start rounded-md border-2 border-edge bg-surface px-2 py-1 shadow-[2px_2px_0_var(--color-edge)]">
                    <span className="w-full truncate font-mono text-[9.5px] uppercase tracking-[0.06em] text-ink-2">{t.label}</span>
                    <span className="whitespace-nowrap font-mono text-[13.5px] font-semibold tabular-nums leading-tight text-ink">
                      {t.value}{t.unit && <span className="ml-1 font-sans text-[10px] font-normal text-ink-2">{t.unit}</span>}
                    </span>
                    {t.sub && <span className="w-full truncate text-[10px] leading-tight text-muted">{t.sub}</span>}
                  </div>
                ))}
                {(atScale.length > 0 || followed.length > 0) && <span className="mx-1 w-0.5 shrink-0 self-stretch bg-edge/40" aria-hidden />}
              </>
            )}
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
