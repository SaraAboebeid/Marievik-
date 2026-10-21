import { useEffect, useState, type ReactNode } from 'react'
import { fmt, msek, tco2 } from '../api'
import type { ProjectProfile, Timeline, TimelineResponse, TimelineSegment } from '../types'
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
    <section className="pointer-events-auto max-h-[38vh] w-[calc(100vw-1.5rem)] overflow-y-auto rounded-xl border border-line bg-raised/97 px-5 py-3.5 shadow-lg"
      aria-label="Ten-year scenario timeline">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h4 className={title}>10-year scenario timeline{ready ? ` · ${ready.building}` : ''}
          {ready?.floor !== undefined ? ` · floor ${ready.floor}` : ''}</h4>
        {profile && <span className="text-[12px] text-ink-2">as {profile.title_en}</span>}
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
      <Gantt tl={ready} base={base} path={path} year={year} onYear={(y) => { setPlaying(false); setYear(y) }} />

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

/** Year columns, one shared axis; segment 1 (unchanged) and segment 2 (the chosen pathway) each get
 *  their own labeled block of rows below it, so the two are compared directly, not one hidden behind
 *  a toggle; then one "Potential change" row for segment 2's events. */
function Gantt({ tl, base, path, year, onYear }: { tl: Timeline; base: TimelineSegment; path: TimelineSegment; year: number; onYear: (y: number) => void }) {
  const years = tl.years
  const n = years.length
  const col = (i: number) => `${(100 * i) / n}%`
  const span = (a: number, b: number) => `${(100 * (b - a)) / n}%`
  const yi = Math.max(0, years.indexOf(year))
  const label = 'w-[11rem] shrink-0 pr-3 text-[12.5px] leading-tight'

  const rowsOf = (seg: TimelineSegment) => Object.keys(tl.group_titles).map((g) => {
    const runs: { use: string; label: string; from: number; to: number; mix?: { use: string; label: string; share: number }[] }[] = []
    seg.years.forEach((r, i) => {
      const grp = tl.states[r.state]?.groups[g]
      const last = runs[runs.length - 1]
      if (last && last.use === grp?.use) last.to = i
      else if (grp) runs.push({ use: grp.use, label: grp.label, from: i, to: i, mix: grp.mix })
    })
    return { g, runs, first: runs[0] }
  })

  /** A mixed ground-floor state (several AMF-interview uses on one floor, by share) as a proportional
   *  multi-colour gradient, so the split actually reads from the bar instead of one flat colour. */
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

  const Section = ({ seg, kind }: { seg: TimelineSegment; kind: 'unchanged' | 'changed' }) => (
    <>
      <div className="flex items-baseline gap-2 pb-1 pt-3 first:pt-0">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
          {kind === 'unchanged' ? 'Segment 1 · use as it is' : 'Segment 2 · different uses over time'}
        </span>
        {kind === 'changed' && <span className="truncate text-[11.5px] text-ink-2">— {seg.label}</span>}
      </div>
      {rowsOf(seg).map(({ g, runs, first }) => (
        <div key={g} className="flex items-center border-t border-line/70 py-2">
          <span className={label}>
            <span className="block font-medium text-ink">{tl.group_titles[g]}</span>
            <span className="block truncate text-[11.5px] text-ink-2">{first?.label}</span>
          </span>
          <div className="relative h-8 flex-1">
            {runs.map((r) => {
              const [bg, fg] = USE_COLOR[r.use] ?? ['#888', '#fff']
              const background = r.mix ? mixBackground(r.mix) : bg
              const title = r.mix
                ? `${r.label}: ${r.mix.map((m) => `${m.label} ${Math.round(m.share * 100)}%`).join(' · ')} (${years[r.from]}–${years[r.to]})`
                : `${r.label}: ${years[r.from]}–${years[r.to]}`
              return (
                <button key={r.from} onClick={() => onYear(years[r.from])} title={title}
                  className="absolute top-0 flex h-full items-center overflow-hidden rounded-md px-3 text-left text-[12px] font-medium"
                  style={{ left: `calc(${col(r.from)} + 2px)`, width: `calc(${span(r.from, r.to + 1)} - 4px)`, background, color: r.mix ? '#ffffff' : fg }}>
                  <span className="truncate" style={r.mix ? { textShadow: '0 1px 2px rgba(0,0,0,.55)' } : undefined}>
                    {r.from === 0 ? 'In use' : r.label}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </>
  )

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
        {/* grid and the chosen year, spanning both segments */}
        <div className="pointer-events-none absolute bottom-0 left-[11rem] right-0 top-0">
          {years.map((_, i) => <span key={i} className="absolute bottom-0 top-0 border-l border-line/70" style={{ left: col(i) }} />)}
          <span className="absolute bottom-0 top-0 bg-ink/[0.06]" style={{ left: col(yi), width: span(0, 1) }} />
        </div>
        <Section seg={base} kind="unchanged" />
        <Section seg={path} kind="changed" />
        {/* changes: months of works (solid), then the window until the next decision year (dashed) */}
        <div className="flex items-center border-t border-line/70 py-2">
          <span className={`${label} font-medium text-ink`}>Potential change</span>
          <div className="relative h-8 flex-1">
            {path.events.length === 0 && <span className="absolute inset-y-0 left-2 flex items-center text-[12px] text-muted">No change in this scenario</span>}
            {path.events.map((e) => {
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
        <CostCarbonChart years={years} label={label} path={path} onYear={onYear} />
      </div>
    </div>
  )
}

const GWP_COLOR = '#7fa067'

/** Cumulative investment cost and upfront carbon across the chosen pathway's ten years, as a pair of
 *  gradient-filled lines sharing the Gantt's own year axis — each on its own scale (cost and carbon
 *  are different units and sizes), so a small floor and a whole building both read clearly. */
function CostCarbonChart({ years, label, path, onYear }: {
  years: number[]; label: string; path: TimelineSegment; onYear: (y: number) => void
}) {
  const n = years.length
  const costs = path.years.map((r) => r.kpi.transformation_cost ?? 0)
  const gwps = path.years.map((r) => r.kpi.upfront_gwp ?? 0)
  const maxCost = Math.max(1, ...costs)
  const maxGwp = Math.max(1, ...gwps)
  const cx = (i: number) => (100 * (i + 0.5)) / n
  const cy = (v: number, max: number) => 92 - 78 * (v / max)
  const line = (vals: number[], max: number) => vals.map((v, i) => `${i === 0 ? 'M' : 'L'} ${cx(i).toFixed(2)} ${cy(v, max).toFixed(2)}`).join(' ')
  const area = (vals: number[], max: number) => `${line(vals, max)} L ${cx(n - 1).toFixed(2)} 100 L ${cx(0).toFixed(2)} 100 Z`

  return (
    <div className="border-t border-line/70 pt-2.5">
      <div className="flex items-center gap-4">
        <span className={label}>
          <span className="block font-medium text-ink">Cost &amp; carbon</span>
          <span className="block truncate text-[11.5px] text-ink-2">cumulative, this pathway</span>
        </span>
        <span className="flex items-center gap-1.5 text-[11.5px] text-ink-2">
          <span className="h-2 w-2 rounded-full" style={{ background: TERRA }} /> Investment
          <span className="font-mono font-medium text-ink">{msek(costs[n - 1] ?? 0)}</span>
        </span>
        <span className="flex items-center gap-1.5 text-[11.5px] text-ink-2">
          <span className="h-2 w-2 rounded-full" style={{ background: GWP_COLOR }} /> Upfront carbon
          <span className="font-mono font-medium text-ink">{tco2(gwps[n - 1] ?? 0)}</span>
        </span>
      </div>
      <div className="flex">
        <span className={label} />
        <div className="relative h-24 flex-1">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full overflow-visible">
            <defs>
              <linearGradient id="tl-cost-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={TERRA} stopOpacity="0.3" />
                <stop offset="100%" stopColor={TERRA} stopOpacity="0" />
              </linearGradient>
              <linearGradient id="tl-gwp-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={GWP_COLOR} stopOpacity="0.26" />
                <stop offset="100%" stopColor={GWP_COLOR} stopOpacity="0" />
              </linearGradient>
            </defs>
            <line x1="0" y1="92" x2="100" y2="92" className="stroke-line" strokeWidth="0.4" />
            <path d={area(gwps, maxGwp)} fill="url(#tl-gwp-fill)" />
            <path d={area(costs, maxCost)} fill="url(#tl-cost-fill)" />
            <path d={line(gwps, maxGwp)} fill="none" stroke={GWP_COLOR} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            <path d={line(costs, maxCost)} fill="none" stroke={TERRA} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            {costs.map((v, i) => <circle key={`c${i}`} cx={cx(i)} cy={cy(v, maxCost)} r="1.3" fill={TERRA} />)}
            {gwps.map((v, i) => <circle key={`g${i}`} cx={cx(i)} cy={cy(v, maxGwp)} r="1.3" fill={GWP_COLOR} />)}
          </svg>
          <div className="absolute inset-0 flex">
            {years.map((y, i) => (
              <button key={y} onClick={() => onYear(y)}
                title={`${y}: ${msek(costs[i])} · ${tco2(gwps[i])}`} className="flex-1" aria-label={`Jump to ${y}`} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
