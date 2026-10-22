import { useEffect, useState, type ReactNode } from 'react'
import { fmt, msek, tco2 } from '../api'
import type { ProjectProfile, Timeline, TimelineResponse, TimelineSegment } from '../types'
import type { YearKpi } from '../studio/engine'
import { Badge } from './kit'

/** One colour per layout use, so a floor's use reads the same in every row — AMF Marievik's own palette
 *  (amffastigheter.se/marievik/): brand blue, coral, terracotta, teal, pink, yellow. */
export const USE_COLOR: Record<string, [string, string]> = {          // [bar, text]
  office_ground: ['#943b2e', '#ffffff'], office_open: ['#0528ca', '#ffffff'], office_cellular: ['#4aa3b5', '#ffffff'],
  retail: ['#fd876e', '#202020'], residential: ['#f4a7dd', '#202020'], hotel: ['#f7df81', '#202020'], school: ['#03b05f', '#ffffff'],
  restaurant_cafe: ['#d6336c', '#ffffff'],
  // the catalogue uses a mixed ground-floor state (MIX_STATES) can be made of, beyond the 7 above
  assembly_event: ['#e08a1e', '#202020'], shared_amenities: ['#8a93a6', '#ffffff'],
}
const TERRA = '#fd876e'
const S1_COLOR = '#202020'
const GWP_COLOR = '#7fa067'
const STEP_MS = 1400
const title = 'font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-ink'
const LABEL = 'w-[7.5rem] shrink-0 pr-2 text-[12px] leading-tight'

interface Props {
  tl: TimelineResponse | null
  profile: ProjectProfile | null
  year: number
  setYear: (y: number) => void
  pathway: string
  setPathway: (id: string) => void
  onClose: () => void
  /** which segment plays on the 3D model: 1 keeps today's use, 2 follows the chosen pathway */
  segment: 1 | 2
  setSegment: (s: 1 | 2) => void
  /** year-by-year KPIs of both segments (B01's furnished floors); without them the server's cost and carbon chart shows */
  kpis?: { s1: YearKpi[]; s2: YearKpi[] } | null
  /** what the model shows this year, when that needs saying */
  note?: string | null
}

/** Ten years side by side: segment 1 (the use as it is) and segment 2 (the chosen pathway of changes), each
 *  with its own year axis, Gantt row, KPIs and Play button. The segment playing is the one on the 3D model. */
export function TimelineDrawer({ tl, profile, year, setYear, pathway, setPathway, onClose, segment, setSegment, kpis, note }: Props) {
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

  const shell = (body: ReactNode) => (
    <section className="pointer-events-auto max-h-[42vh] w-[calc(100vw-1.5rem)] overflow-y-auto rounded-xl border border-line bg-raised/97 px-5 py-3 shadow-lg"
      aria-label="Ten-year scenario timeline">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h4 className={title}>10-year scenario timeline{ready ? ` · ${ready.building}` : ''}
          {ready?.floor !== undefined ? ` · floor ${ready.floor}` : ''}</h4>
        {profile && <span className="text-[12px] text-ink-2">as {profile.title_en}</span>}
        <button onClick={onClose} className="ml-auto px-1 text-[12px] text-ink-2 hover:text-ink" aria-label="Close timeline">✕</button>
      </div>
      {body}
    </section>
  )

  if (!tl) return shell(<p className="text-[12.5px] text-ink-2">Asking the server…</p>)
  if (tl.status === 'failed') return shell(<p className="text-[12.5px] text-critical">Timeline failed: {'error' in tl ? tl.error : ''}</p>)
  if (!ready) {
    const p = tl as { done: number; total: number }
    return shell(
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
  const shown = segment === 1 ? base : path
  const stateNow = ready.states[shown.years[yi].state]
  const eventNow = segment === 2 ? path.events.find((e) => e.year === year) : undefined
  const highlights = ready.segments.filter((s) => s.highlight)
  const others = ready.segments.filter((s) => s.segment === 2 && !s.highlight)
  const optionLabel = (s: TimelineSegment) =>
    `${s.steps?.slice(1).map((st) => `${st.year}: ${st.label}`).join(' → ')} · ${fmt(s.totals?.walls_changed_m2)} m² walls · ${msek(s.totals?.capex_sek ?? 0)}`

  const play = (s: 1 | 2) => {
    if (playing && segment === s) { setPlaying(false); return }
    if (segment !== s || year >= years[years.length - 1]) setYear(years[0])
    setSegment(s)
    setPlaying(true)
  }
  const jump = (s: 1 | 2) => (y: number) => { setPlaying(false); setSegment(s); setYear(y) }
  const playButton = (s: 1 | 2) => (
    <button onClick={() => play(s)} aria-pressed={segment === s}
      title={s === 1 ? 'Play ten years with the use unchanged: running costs, replacements and people over time' : 'Play the chosen pathway: the use and the layout change, with their works and running costs'}
      className={`rounded-lg border px-3 py-1 text-[12.5px] font-semibold ${segment === s ? (s === 1 ? 'border-edge bg-ink text-bg' : 'border-edge bg-coral text-[#202020]') : 'border-line-strong bg-surface hover:border-ink-2'}`}>
      {playing && segment === s ? '❚❚ Pause' : '▶ Play'}
    </button>
  )
  const scenarioSelect = (
    <label className="flex min-w-0 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-2 py-0.5 text-[12px] text-ink-2">
      Scenario:
      <select value={path.id} onChange={(e) => setPathway(e.target.value)} aria-label="Pathway"
        className="min-w-0 max-w-[18rem] bg-transparent py-0.5 font-medium text-ink outline-none">
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
  )

  return shell(
    <>
      {note && <p className="mb-2 rounded-md border-2 border-dashed border-edge px-2.5 py-1 text-[12px]">{note}</p>}
      <div className="grid gap-4 xl:grid-cols-2">
        <SegmentColumn tl={ready} seg={base} n={1} active={segment === 1} year={year} onYear={jump(1)}
          head={<>{playButton(1)}</>} own={kpis?.s1 ?? null} other={kpis?.s2 ?? null} />
        <SegmentColumn tl={ready} seg={path} n={2} active={segment === 2} year={year} onYear={jump(2)}
          head={<>{playButton(2)}{scenarioSelect}</>} own={kpis?.s2 ?? null} other={kpis?.s1 ?? null} />
      </div>

      <button onClick={() => setDetails((d) => !d)} className="mt-2 text-[12px] text-ink-2 hover:text-ink" aria-expanded={details}>
        {details ? '▾' : '▸'} Segment {segment}, {year}: {Object.values(stateNow.groups).map((g) => g.label).join(' / ')}
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
                {stateNow.issues.map((i, k) => (
                  <li key={k} className="flex gap-1.5">
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

/** One segment as its own column: header with Play, year axis, the Gantt row per floor or group, the
 *  changes (segment 2), and its KPIs over the ten years with the other segment drawn faint for comparison. */
function SegmentColumn({ tl, seg, n, active, year, onYear, head, own, other }: {
  tl: Timeline; seg: TimelineSegment; n: 1 | 2; active: boolean; year: number; onYear: (y: number) => void
  head: ReactNode; own: YearKpi[] | null; other: YearKpi[] | null
}) {
  const years = tl.years
  const N = years.length
  const col = (i: number) => `${(100 * i) / N}%`
  const span = (a: number, b: number) => `${(100 * (b - a)) / N}%`
  const yi = Math.max(0, years.indexOf(year))
  const colour = n === 1 ? S1_COLOR : TERRA

  const rows = Object.keys(tl.group_titles).map((g) => {
    const runs: { use: string; label: string; from: number; to: number; mix?: { use: string; label: string; share: number }[] }[] = []
    seg.years.forEach((r, i) => {
      const grp = tl.states[r.state]?.groups[g]
      const last = runs[runs.length - 1]
      if (last && last.use === grp?.use) last.to = i
      else if (grp) runs.push({ use: grp.use, label: grp.label, from: i, to: i, mix: grp.mix })
    })
    return { g, runs, first: runs[0] }
  })
  /** A mixed ground-floor state as a proportional multi-colour gradient, so the split reads from the bar. */
  const mixBackground = (parts: { use: string; share: number }[]) => {
    let at = 0
    const stops = parts.flatMap((p) => {
      const [c] = USE_COLOR[p.use] ?? ['#888', '#fff']
      const from = at
      at += p.share * 100
      return [`${c} ${from}%`, `${c} ${at}%`]
    })
    return `linear-gradient(to right, ${stops.join(', ')})`
  }

  return (
    <div className={`min-w-0 rounded-lg border-2 px-3 py-2 ${active ? 'border-edge' : 'border-line opacity-80'}`}>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em]" style={{ color: n === 1 ? undefined : '#c2492f' }}>
          Segment {n} · {n === 1 ? 'use as it is' : 'uses change'}
        </span>
        {active && <span className="font-mono text-[10px] font-semibold uppercase text-ink">· on the model</span>}
        <span className="ml-auto flex min-w-0 flex-wrap items-center gap-1.5">{head}</span>
      </div>

      {/* year axis */}
      <div className="flex">
        <span className={LABEL} />
        <div className="relative h-5 flex-1">
          {years.map((y, i) => (
            <button key={y} onClick={() => onYear(y)} style={{ left: col(i), width: span(0, 1) }}
              className={`absolute top-0 h-full text-center font-mono text-[10.5px] ${i === yi && active ? 'font-semibold text-ink' : 'text-ink-2 hover:text-ink'}`}>
              {String(y).slice(2)}
              {i === yi && active && <span className="absolute inset-x-1 bottom-0 h-[2px] bg-ink" />}
              {tl.decision_years.includes(y) && <span className="absolute left-1/2 top-0 h-1 w-1 -translate-x-1/2 rounded-full bg-ink-2" title="Decision year" />}
            </button>
          ))}
        </div>
      </div>

      <div className="relative">
        <div className="pointer-events-none absolute bottom-0 left-[7.5rem] right-0 top-0">
          {years.map((_, i) => <span key={i} className="absolute bottom-0 top-0 border-l border-line/60" style={{ left: col(i) }} />)}
          {active && <span className="absolute bottom-0 top-0 bg-ink/[0.07]" style={{ left: col(yi), width: span(0, 1) }} />}
        </div>

        {rows.map(({ g, runs, first }) => (
          <div key={g} className="flex items-center border-t border-line/70 py-1.5">
            <span className={LABEL}>
              <span className="block font-medium text-ink">{tl.group_titles[g]}</span>
              <span className="block truncate text-[11px] text-ink-2">{first?.label}</span>
            </span>
            <div className="relative h-7 flex-1">
              {runs.map((r) => {
                const [bg, fg] = USE_COLOR[r.use] ?? ['#888', '#fff']
                return (
                  <button key={r.from} onClick={() => onYear(years[r.from])} title={`${r.label}: ${years[r.from]}–${years[r.to]}`}
                    className="absolute top-0 flex h-full items-center overflow-hidden rounded-md px-2 text-left text-[11.5px] font-medium"
                    style={{ left: `calc(${col(r.from)} + 2px)`, width: `calc(${span(r.from, r.to + 1)} - 4px)`, background: r.mix ? mixBackground(r.mix) : bg, color: r.mix ? '#ffffff' : fg }}>
                    <span className="truncate">{r.from === 0 ? 'In use' : r.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}

        {n === 2 && (
          <div className="flex items-center border-t border-line/70 py-1.5">
            <span className={`${LABEL} font-medium text-ink`}>Changes</span>
            <div className="relative h-7 flex-1">
              {seg.events.length === 0 && <span className="absolute inset-y-0 left-2 flex items-center text-[11.5px] text-muted">No change in this scenario</span>}
              {seg.events.map((e) => {
                const i = years.indexOf(e.year)
                return (
                  <button key={e.year} onClick={() => onYear(e.year)}
                    title={`${fmt(e.walls_changed_m2)} m² walls changed · ${msek(e.capex_sek)} · ≈ ${fmt(e.months)} months`}
                    className="absolute top-0 flex h-full items-center justify-center overflow-hidden rounded-md px-1.5 text-[11px] font-medium text-white"
                    style={{ left: `calc(${col(i)} + 2px)`, width: `calc(${span(0, Math.max(1, e.months / 12))} - 4px)`, background: TERRA }}>
                    <span className="truncate">Works</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
        {n === 1 && (
          <div className="flex items-center border-t border-line/70 py-1.5">
            <span className={`${LABEL} font-medium text-ink`}>Changes</span>
            <div className="relative h-7 flex-1"><span className="absolute inset-y-0 left-2 flex items-center text-[11.5px] text-muted">None: replacements only, as they fall due</span></div>
          </div>
        )}

        {own ? (
          <>
            <KpiRow years={years} yi={yi} active={active} colour={colour} onYear={onYear} title="Cost" sub="cumulative, MSEK"
              own={own.map((k) => k.cumCost)} other={other?.map((k) => k.cumCost) ?? null} fmtV={(v) => (v / 1e6).toFixed(1)} />
            <KpiRow years={years} yi={yi} active={active} colour={colour} onYear={onYear} title="Carbon" sub="cumulative, t CO₂e"
              own={own.map((k) => k.cumKg / 1000)} other={other?.map((k) => k.cumKg / 1000) ?? null} fmtV={(v) => v.toFixed(0)} />
            <KpiRow years={years} yi={yi} active={active} colour={colour} onYear={onYear} title="People" sub="on the floor"
              own={own.map((k) => k.people)} other={other?.map((k) => k.people) ?? null} fmtV={(v) => String(Math.round(v))} />
            <YearLine k={own[yi]} year={years[yi]} />
          </>
        ) : (
          <CostCarbonChart years={years} path={seg} onYear={onYear} />
        )}
      </div>
    </div>
  )
}

/** One KPI over the ten years: this segment's line bold, the other segment's faint behind it. */
function KpiRow({ years, yi, active, colour, onYear, title: t, sub, own, other, fmtV }: {
  years: number[]; yi: number; active: boolean; colour: string; onYear: (y: number) => void
  title: string; sub: string; own: number[]; other: number[] | null; fmtV: (v: number) => string
}) {
  const n = years.length
  const max = Math.max(1, ...own, ...(other ?? []))
  const cx = (i: number) => (100 * (i + 0.5)) / n
  const cy = (v: number) => 92 - 80 * (v / max)
  const line = (vals: number[]) => vals.map((v, i) => `${i === 0 ? 'M' : 'L'} ${cx(i).toFixed(2)} ${cy(v).toFixed(2)}`).join(' ')
  return (
    <div className="flex border-t border-line/70 pt-1">
      <span className={LABEL}>
        <span className="block font-medium text-ink">{t} <span className="font-mono text-[11px]" style={{ color: colour === TERRA ? '#c2492f' : colour }}>{fmtV(own[yi] ?? 0)}</span></span>
        <span className="block text-[11px] text-ink-2">{sub}</span>
      </span>
      <div className="relative h-12 flex-1">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full overflow-visible">
          <line x1="0" y1="92" x2="100" y2="92" className="stroke-line" strokeWidth="0.4" />
          {other && <path d={line(other)} fill="none" stroke="#9a978e" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
          <path d={line(own)} fill="none" stroke={colour} strokeWidth={active ? 2.4 : 1.6} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </svg>
        <div className="absolute inset-0 flex">
          {years.map((y, i) => <button key={y} onClick={() => onYear(y)} className="flex-1" title={`${y}: ${fmtV(own[i] ?? 0)}${other ? ` (other segment ${fmtV(other[i] ?? 0)})` : ''}`} aria-label={`Jump to ${y}`} />)}
        </div>
      </div>
    </div>
  )
}

/** What this segment spends, emits and holds in the chosen year. */
function YearLine({ k, year }: { k: YearKpi | undefined; year: number }) {
  if (!k) return null
  const ksek = (v: number) => `${Math.round(v / 1000).toLocaleString('sv-SE')} kSEK`
  return (
    <div className="flex border-t border-line/70 py-1 text-[11.5px]">
      <span className={`${LABEL} font-medium text-ink`}>In {year}<span className="block text-[10.5px] font-normal text-muted">example figures</span></span>
      <span className="flex flex-1 flex-wrap gap-x-3 text-ink-2">
        <span>running {ksek(k.running)}</span>
        {k.repl > 0 && <span>replacements {ksek(k.repl)}</span>}
        {k.works > 0 && <span className="font-semibold text-ink">works {ksek(k.works)} ({k.change?.months} months)</span>}
        <span>{(k.kg / 1000).toFixed(1)} t CO₂e</span>
        <span>{k.people} people</span>
      </span>
    </div>
  )
}

/** Cumulative investment cost and upfront carbon from the server's timeline, for buildings without
 *  furnished floors: a pair of lines on the segment's year axis, each on its own scale. */
function CostCarbonChart({ years, path, onYear }: { years: number[]; path: TimelineSegment; onYear: (y: number) => void }) {
  const n = years.length
  const costs = path.years.map((r) => r.kpi.transformation_cost ?? 0)
  const gwps = path.years.map((r) => r.kpi.upfront_gwp ?? 0)
  const maxCost = Math.max(1, ...costs)
  const maxGwp = Math.max(1, ...gwps)
  const cx = (i: number) => (100 * (i + 0.5)) / n
  const cy = (v: number, max: number) => 92 - 78 * (v / max)
  const line = (vals: number[], max: number) => vals.map((v, i) => `${i === 0 ? 'M' : 'L'} ${cx(i).toFixed(2)} ${cy(v, max).toFixed(2)}`).join(' ')
  return (
    <div className="flex border-t border-line/70 pt-1.5">
      <span className={LABEL}>
        <span className="block font-medium text-ink">Cost &amp; carbon</span>
        <span className="block text-[11px] text-ink-2"><span style={{ color: TERRA }}>●</span> {msek(costs[n - 1] ?? 0)} · <span style={{ color: GWP_COLOR }}>●</span> {tco2(gwps[n - 1] ?? 0)}</span>
      </span>
      <div className="relative h-16 flex-1">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full overflow-visible">
          <line x1="0" y1="92" x2="100" y2="92" className="stroke-line" strokeWidth="0.4" />
          <path d={line(gwps, maxGwp)} fill="none" stroke={GWP_COLOR} strokeWidth={1.8} vectorEffect="non-scaling-stroke" />
          <path d={line(costs, maxCost)} fill="none" stroke={TERRA} strokeWidth={1.8} vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="absolute inset-0 flex">
          {years.map((y, i) => <button key={y} onClick={() => onYear(y)} title={`${y}: ${msek(costs[i])} · ${tco2(gwps[i])}`} className="flex-1" aria-label={`Jump to ${y}`} />)}
        </div>
      </div>
    </div>
  )
}
