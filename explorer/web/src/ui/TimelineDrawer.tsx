import { useEffect, useState, type ReactNode } from 'react'
import { fmt, msek, tco2 } from '../api'
import type { ProjectProfile, Timeline, TimelineKpiMeta, TimelineResponse, TimelineSegment } from '../types'
import { Badge } from './kit'

/** One colour per layout use, so a floor's use reads the same in every row — AMF Marievik's own palette
 *  (amffastigheter.se/marievik/): brand blue, coral, terracotta, teal, pink, yellow. */
export const USE_COLOR: Record<string, [string, string]> = {          // [bar, text]
  office_ground: ['#943b2e', '#ffffff'], office_open: ['#0528ca', '#ffffff'], office_cellular: ['#4aa3b5', '#ffffff'],
  retail: ['#fd876e', '#202020'], residential: ['#f4a7dd', '#202020'], hotel: ['#f7df81', '#202020'], school: ['#03b05f', '#ffffff'],
}
const TERRA = '#fd876e'
const STEP_MS = 1400
const title = 'font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-ink'

interface Props {
  tl: TimelineResponse | null
  profile: ProjectProfile | null
  year: number
  setYear: (y: number) => void
  pathway: string
  setPathway: (id: string) => void
  onClose: () => void
}

/** Ten years of one building as a Gantt chart, played on the 3D model: the chosen pathway against the unchanged building. */
export function TimelineDrawer({ tl, profile, year, setYear, pathway, setPathway, onClose }: Props) {
  const [playing, setPlaying] = useState(false)
  const [details, setDetails] = useState(false)
  const ready = tl && tl.status === 'ready' ? (tl as Timeline) : null

  useEffect(() => {
    if (!playing || !ready) return
    const last = ready.years[ready.years.length - 1]
    if (year >= last) { setPlaying(false); return }
    const t = window.setTimeout(() => setYear(year + 1), STEP_MS)
    return () => window.clearTimeout(t)
  }, [playing, year, ready, setYear])

  const shell = (controls: ReactNode, body: ReactNode) => (
    <section className="pointer-events-auto max-h-[44vh] w-[calc(100vw-1.5rem)] overflow-y-auto rounded-xl border border-line bg-raised/97 px-5 py-3.5 shadow-lg"
      aria-label="Ten-year scenario timeline">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h4 className={title}>10-year scenario timeline{ready ? ` · ${ready.building}` : ''}</h4>
        {profile && <span className="text-[12px] text-ink-2">as {profile.title}</span>}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {controls}
          <button onClick={onClose} className="px-1 text-[12px] text-ink-2 hover:text-ink" aria-label="Close timeline">✕</button>
        </span>
      </div>
      {body}
    </section>
  )

  if (!tl) return shell(null, <p className="text-[12.5px] text-ink-2">Asking the server…</p>)
  if (tl.status === 'failed') return shell(null, <p className="text-[12.5px] text-critical">Timeline failed: {'error' in tl ? tl.error : ''}</p>)
  if (!ready) {
    const p = tl as { done: number; total: number }
    return shell(null,
      <div className="text-[12.5px] text-ink-2">
        Laying out every use combination and testing pathways against the catalogue…{' '}
        <span className="font-mono">{p.total ? `${p.done}/${p.total} layouts` : 'starting'}</span>
        <div className="mt-2 h-1.5 overflow-hidden rounded bg-sunken">
          <div className="h-full bg-ink-2 transition-all" style={{ width: `${p.total ? (100 * p.done) / p.total : 3}%` }} />
        </div>
      </div>,
    )
  }

  const base = ready.segments.find((s) => s.id === 'unchanged')!
  const path = ready.segments.find((s) => s.id === pathway) ?? ready.segments.find((s) => s.segment === 2) ?? base
  const years = ready.years
  const yi = Math.max(0, years.indexOf(year))
  const kpiIds = (profile?.timeline_kpis ?? ['capex_cum', 'co2_cum', 'people', 'evening_share']).filter((k) => ready.kpis[k])
  const stateNow = ready.states[path.years[yi].state]
  const eventNow = path.events.find((e) => e.year === year)
  const highlights = ready.segments.filter((s) => s.highlight)
  const others = ready.segments.filter((s) => s.segment === 2 && !s.highlight)
  const optionLabel = (s: TimelineSegment) =>
    `${s.steps?.slice(1).map((st) => `${st.year}: ${st.label}`).join(' → ')} · ${fmt(s.totals?.walls_changed_m2)} m² walls · ${msek(s.totals?.capex_sek ?? 0)}`

  const controls = (
    <>
      <button onClick={() => { if (year >= years[years.length - 1]) setYear(years[0]); setPlaying((p) => !p) }}
        className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-[12.5px] font-medium hover:border-ink-2"
        aria-label={playing ? 'Pause' : 'Play the ten years'}>
        {playing ? '❚❚ Pause' : '▶ Play'}
      </button>
      <label className="flex items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-2.5 py-1 text-[12.5px] text-ink-2">
        Scenario:
        <select value={path.id} onChange={(e) => setPathway(e.target.value)} aria-label="Pathway"
          className="max-w-[24rem] bg-transparent py-0.5 font-medium text-ink outline-none">
          <optgroup label="One change">
            {highlights.filter((s) => s.changes === 1).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </optgroup>
          <optgroup label="Two changes">
            {highlights.filter((s) => s.changes === 2).map((s) => <option key={s.id} value={s.id}>{s.label.replace('Stepwise: ', '')}</option>)}
          </optgroup>
          <optgroup label={`All ${others.length + highlights.length} tested pathways`}>
            {others.map((s) => <option key={s.id} value={s.id}>{optionLabel(s)}</option>)}
          </optgroup>
        </select>
      </label>
    </>
  )

  return shell(controls,
    <>
      <Gantt tl={ready} seg={path} year={year} onYear={(y) => { setPlaying(false); setYear(y) }} />

      {/* KPI tiles at the chosen year, against the unchanged building */}
      <div className="mt-3 grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(kpiIds.length, 5)}, minmax(0, 1fr))` }}>
        {kpiIds.map((k) => <KpiTile key={k} id={k} meta={ready.kpis[k]} base={base} path={path} yi={yi} />)}
      </div>

      <button onClick={() => setDetails((d) => !d)} className="mt-2 text-[12px] text-ink-2 hover:text-ink" aria-expanded={details}>
        {details ? '▾' : '▸'} {year}: {Object.values(stateNow.groups).map((g) => g.label).join(' / ')}
        {eventNow ? ` · change this year (${msek(eventNow.capex_sek)})` : ''} · {stateNow.issues.length} standards issue{stateNow.issues.length === 1 ? '' : 's'}
      </button>
      {details && (
        <div className="mt-1.5 grid gap-x-6 gap-y-1 text-[12px] leading-snug md:grid-cols-2">
          <div>
            {eventNow ? (
              <p className="text-ink-2">
                {fmt(eventNow.walls_new_m2)} m² walls built, {fmt(eventNow.walls_removed_m2)} m² removed
                {eventNow.finish_m2 ? `, ${fmt(eventNow.finish_m2)} m² finishes` : ''}
                {eventNow.slab_opening_m2 ? `, ${fmt(eventNow.slab_opening_m2)} m² cut through slabs` : ''} · {msek(eventNow.capex_sek)} ·{' '}
                {tco2(eventNow.co2_kg)} · ≈ {fmt(eventNow.months)} months of works.
              </p>
            ) : <p className="text-ink-2">No change this year.</p>}
            {Object.values(stateNow.groups).map((g) => (
              <div key={g.use + g.label} className="text-ink-2">
                {g.label}: {fmt(g.persons)} people · fire class {g.fire_class} · walk to stair {g.walk_m} of {g.walk_limit_m} m
              </div>
            ))}
          </div>
          <div>
            {stateNow.issues.length === 0 ? <p className="text-ink-2">No issues found by the use catalogue checks.</p> : (
              <ul className="space-y-0.5">
                {stateNow.issues.map((i, n) => (
                  <li key={n} className="flex gap-1.5">
                    <Badge tone={i.severity === 'blocker' ? 'critical' : i.severity === 'major' ? 'warn' : 'muted'}>{i.severity}</Badge>
                    <span className="text-ink-2">{i.text}</span>
                  </li>
                ))}
              </ul>
            )}
            {profile && profile.needs_data.length > 0 && <p className="mt-1 text-muted">Needs data from {profile.title}: {profile.needs_data.join('; ')}.</p>}
            <p className="mt-1 text-[11px] text-muted">
              Decision years {ready.decision_years.join(', ')}: {ready.decision_years_source}
              {Object.keys(ready.assumptions).length > 0 && ` Working values: ${Object.entries(ready.assumptions).map(([k, a]) => `${k} = ${a.value}`).join(', ')}.`}
            </p>
          </div>
        </div>
      )}
    </>,
  )
}

/** Year columns; one row per floor group with its use over time; a row for the changes (works, then the open window). */
function Gantt({ tl, seg, year, onYear }: { tl: Timeline; seg: TimelineSegment; year: number; onYear: (y: number) => void }) {
  const years = tl.years
  const n = years.length
  const col = (i: number) => `${(100 * i) / n}%`
  const span = (a: number, b: number) => `${(100 * (b - a)) / n}%`
  const yi = Math.max(0, years.indexOf(year))
  const rows = (['ground', 'upper'] as const).map((g) => {
    const runs: { use: string; label: string; from: number; to: number }[] = []
    seg.years.forEach((r, i) => {
      const grp = tl.states[r.state]?.groups[g]
      const last = runs[runs.length - 1]
      if (last && last.use === grp?.use) last.to = i
      else if (grp) runs.push({ use: grp.use, label: grp.label, from: i, to: i })
    })
    return { g, runs, first: runs[0] }
  })
  const label = 'w-[11rem] shrink-0 pr-3 text-[12.5px] leading-tight'
  return (
    <div className="select-none">
      {/* year header */}
      <div className="flex">
        <span className={label} />
        <div className="relative h-6 flex-1">
          {years.map((y, i) => (
            <button key={y} onClick={() => onYear(y)} style={{ left: col(i), width: span(0, 1) }}
              className={`absolute top-0 h-full text-center font-mono text-[11.5px] ${i === yi ? 'font-semibold text-ink' : 'text-ink-2 hover:text-ink'}`}>
              {y}
              {i === yi && <span className="absolute inset-x-2 bottom-0 h-[2px] bg-ink" />}
              {tl.decision_years.includes(y) && <span className="absolute left-1/2 top-0 h-1 w-1 -translate-x-1/2 rounded-full bg-ink-2" title="Decision year" />}
            </button>
          ))}
        </div>
      </div>
      <div className="relative">
        {/* grid and the chosen year */}
        <div className="pointer-events-none absolute bottom-0 left-[11rem] right-0 top-0">
          {years.map((_, i) => <span key={i} className="absolute bottom-0 top-0 border-l border-line/70" style={{ left: col(i) }} />)}
          <span className="absolute bottom-0 top-0 bg-ink/[0.06]" style={{ left: col(yi), width: span(0, 1) }} />
        </div>
        {rows.map(({ g, runs, first }) => (
          <div key={g} className="flex items-center border-t border-line/70 py-2">
            <span className={label}>
              <span className="block font-medium text-ink">{g === 'ground' ? 'Ground floor' : 'Upper floors'}</span>
              <span className="block truncate text-[11.5px] text-ink-2">{first?.label}</span>
            </span>
            <div className="relative h-8 flex-1">
              {runs.map((r) => {
                const [bg, fg] = USE_COLOR[r.use] ?? ['#888', '#fff']
                return (
                  <button key={r.from} onClick={() => onYear(years[r.from])} title={`${r.label}: ${years[r.from]}–${years[r.to]}`}
                    className="absolute top-0 flex h-full items-center overflow-hidden rounded-md px-3 text-left text-[12px] font-medium"
                    style={{ left: `calc(${col(r.from)} + 2px)`, width: `calc(${span(r.from, r.to + 1)} - 4px)`, background: bg, color: fg }}>
                    <span className="truncate">{r.from === 0 ? 'In use' : r.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
        {/* changes: months of works (solid), then the window until the next decision year (dashed) */}
        <div className="flex items-center border-t border-line/70 py-2">
          <span className={`${label} font-medium text-ink`}>Potential change</span>
          <div className="relative h-8 flex-1">
            {seg.events.length === 0 && <span className="absolute inset-y-0 left-2 flex items-center text-[12px] text-muted">No change in this scenario</span>}
            {seg.events.map((e) => {
              const i = years.indexOf(e.year)
              const works = Math.max(0.6, e.months / 12)
              const next = tl.decision_years.find((y) => y > e.year) ?? years[years.length - 1] + 1
              return (
                <span key={e.year}>
                  <span className="absolute top-0 h-full rounded-md border-2 border-dashed" title="Until the next decision year"
                    style={{ left: `calc(${col(i)} + 2px)`, width: `calc(${span(i, years.indexOf(next) < 0 ? years.length : years.indexOf(next))} - 4px)`, borderColor: TERRA, opacity: 0.6 }} />
                  <button onClick={() => onYear(e.year)}
                    title={`${fmt(e.walls_changed_m2)} m² walls changed · ${msek(e.capex_sek)} · ≈ ${fmt(e.months)} months`}
                    className="absolute top-0 flex h-full items-center justify-center overflow-hidden rounded-md px-2 text-[12px] font-medium text-white"
                    style={{ left: `calc(${col(i)} + 2px)`, width: `calc(${span(0, works)} - 4px)`, background: TERRA, minWidth: '5.5rem' }}>
                    <span className="truncate">Reconfiguration</span>
                  </button>
                </span>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

const ICONS: Record<string, ReactNode> = {
  capex_cum: <path d="M4 16V11M9 16V7M14 16V4" />,
  co2_cum: <><path d="M5 15c0-6 4-10 11-11-1 7-5 11-11 11z" /><path d="M5 15l5-5" /></>,
  people: <><circle cx="7" cy="7" r="2.5" /><circle cx="13.5" cy="7.5" r="2" /><path d="M2.5 16c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4M12 12.2c2.5-.4 4.5 1 4.5 3.8" /></>,
  people_hours: <><circle cx="10" cy="10" r="6.5" /><path d="M10 6.5V10l2.5 1.5" /></>,
  evening_share: <><circle cx="10" cy="10" r="6.5" /><path d="M10 6.5V10l2.5 1.5" /></>,
  walls_changed_cum: <><path d="M3 5h14M3 10h14M3 15h14M7 5v5M13 10v5" /></>,
  disruption_cum: <><rect x="3.5" y="4.5" width="13" height="12" rx="1.5" /><path d="M3.5 8h13M7 3v3M13 3v3" /></>,
  uses_count: <><rect x="3" y="3" width="6" height="6" rx="1" /><rect x="11" y="3" width="6" height="6" rx="1" /><rect x="3" y="11" width="6" height="6" rx="1" /><rect x="11" y="11" width="6" height="6" rx="1" /></>,
  issues: <><path d="M10 3l8 14H2z" /><path d="M10 8v4M10 14.5v.5" /></>,
}

const show = (meta: TimelineKpiMeta, v: number) =>
  meta.unit === 'SEK' ? msek(v) : meta.unit === 'kg CO₂e' ? tco2(v) : meta.unit === '%' ? `${Math.round(v * 100)} %` : `${fmt(v)} ${meta.unit}`

function KpiTile({ id, meta, base, path, yi }: { id: string; meta: TimelineKpiMeta; base: TimelineSegment; path: TimelineSegment; yi: number }) {
  const b = path.years[yi].kpi[id] ?? 0
  const a = base.years[yi].kpi[id] ?? 0
  const diff = b - a
  const good = diff === 0 ? null : (diff > 0) === (meta.better === 'higher')
  return (
    <div className="flex items-start justify-between gap-2 rounded-lg border border-line bg-surface px-3.5 py-2.5" title={`${meta.note} (${meta.status})`}>
      <div className="min-w-0">
        <div className="truncate text-[12px] text-ink-2">{meta.label}</div>
        <div className="mt-1 text-[19px] font-semibold leading-none tabular-nums">{show(meta, b)}</div>
        <div className={`mt-1 font-mono text-[10.5px] ${good === null ? 'text-muted' : good ? 'text-good' : 'text-critical'}`}>
          {diff === 0 ? 'same as unchanged' : `${diff > 0 ? '+' : '−'}${show(meta, Math.abs(diff))} vs unchanged`}
          {meta.status === 'placeholder' && <span className="ml-1 text-warn">· placeholder</span>}
        </div>
      </div>
      <svg viewBox="0 0 20 20" className="h-6 w-6 shrink-0" fill="none" stroke={id === 'capex_cum' ? TERRA : '#7fa067'} strokeWidth="1.6" strokeLinecap="round" aria-hidden>
        {ICONS[id]}
      </svg>
    </div>
  )
}
