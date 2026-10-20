import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, fmt, fmt1, SYSTEM_COLOR, SYSTEM_LABEL, USE_LABEL } from '../api'
import type { ParametricCell, ParametricPayload, PlanGeometry, Settings, SitePayload, XY } from '../types'
import { Badge, Button, Toggle } from './kit'

interface Props {
  site: SitePayload
  start: string | null                                   // building to open with
  settingsOf: (id: string) => Settings | undefined       // each building's scenario in the 3D view
  onApply: (id: string, patch: Partial<Settings>) => void
  onClose: () => void
}

const CATNAME: Record<string, string> = {
  E: 'Facade (retained)', K: 'Core (retained)', C: 'Corridor wall', P: 'Partition between units', S: 'Support / atrium edge',
  I: 'Inside a unit', A: 'Added',
}
const RETAINED = new Set(['E', 'K'])
const TYPE_COLORS = ['var(--color-c2)', 'var(--color-c3)', 'var(--color-c1)', 'var(--color-c6)', 'var(--color-c4)', 'var(--color-c5)']
const CHART_USES = ['office_open', 'office_cellular', 'residential', 'hotel', 'school', 'retail']

type Tip = { x: number; y: number; body: ReactNode } | null

/** The dashboard's building-model view, on live layouts: site map, use x partition system x floor, the plan,
 *  the KPIs, every use x system on one chart, and the bill of quantities. */
export function ParametricDrawer({ site, start, settingsOf, onApply, onClose }: Props) {
  const study = site.buildings.find((b) => b.role === 'study')?.id ?? site.buildings[0].id
  const [bid, setBid] = useState(start ?? study)
  const base = settingsOf(bid) ?? site.defaults
  const [use, setUse] = useState(base.use)
  const [system, setSystem] = useState(base.partition_system)
  const [floor, setFloor] = useState(1)
  const [data, setData] = useState<ParametricPayload | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [cells, setCells] = useState<Record<string, ParametricCell>>({})
  const [tip, setTip] = useState<Tip>(null)

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const pick = (id: string) => {
    const s = settingsOf(id) ?? site.defaults
    setBid(id); setUse(s.use); setSystem(s.partition_system); setFloor(1)
  }

  const settings: Settings = { ...base, use, partition_system: system }
  const skey = JSON.stringify(settings)
  useEffect(() => {
    let alive = true
    setBusy(true); setErr(null)
    api.parametric(bid, settings, floor)
      .then((r) => { if (alive) { setData(r); if (r.floor !== floor) setFloor(r.floor) } })
      .catch((e) => { if (alive) setErr((e as Error).message) })
      .finally(() => { if (alive) setBusy(false) })
    return () => { alive = false }
  }, [bid, skey, floor]) // eslint-disable-line react-hooks/exhaustive-deps

  // the chart: every use x system on this building, filled in as the layouts arrive (cached on the server)
  const systems = useMemo(() => [...site.systems.filter((s) => s !== 'as_profile'), ...site.suppliers.map((s) => s.system)], [site])
  const baseKey = JSON.stringify({ ...base, use: null, partition_system: null })
  const gen = useRef(0)
  useEffect(() => {
    const my = ++gen.current
    setCells({})
    const queue = CHART_USES.filter((u) => u in site.uses).flatMap((u) => systems.map((s) => [u, s] as const))
    const work = async () => {
      while (queue.length && gen.current === my) {
        const [u, s] = queue.shift()!
        try {
          const c = await api.cell(bid, { ...base, use: u, partition_system: s })
          if (gen.current === my) setCells((m) => ({ ...m, [`${u}|${s}`]: c }))
        } catch { /* a use the footprint cannot take: leave the bar out */ }
      }
    }
    void Promise.all([work(), work()])
    return () => { gen.current++ }
  }, [bid, baseKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const b = site.buildings.find((x) => x.id === bid)!
  const k = data?.kpi
  const inView = JSON.stringify({ ...base }) === JSON.stringify(settings)
  const useOpts = ['site', ...Object.keys(site.uses)]
  const sysOpts = [...site.systems, ...site.suppliers.map((s) => s.system)]
  const sysLabel = (s: string) => site.suppliers.find((x) => x.system === s)?.title ?? SYSTEM_LABEL[s] ?? s

  return (
    <div className="absolute inset-0 z-30 flex items-start justify-center bg-ink/25 p-3 pt-12" onClick={onClose}>
      <div className="flex max-h-full w-[min(92rem,100%)] flex-col rounded-lg border border-line bg-raised shadow-xl"
        onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Parametric model">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
          <h3 className="text-[14px] font-semibold">Parametric model</h3>
          <span className="text-[12.5px] text-ink-2">the building, floor by floor: every wall, door and window from the layout engine, priced from the catalogue</span>
          {(busy || Object.keys(cells).length < CHART_USES.length * systems.length) && (
            <span className="font-mono text-[11.5px] text-ink-2">{busy ? 'laying out…' : `chart ${Object.keys(cells).length}/${CHART_USES.length * systems.length}`}</span>
          )}
          <button onClick={onClose} className="ml-auto font-mono text-[16px] text-muted hover:text-ink" aria-label="Close">×</button>
        </div>

        <div className="overflow-y-auto px-4 py-3">
          <div className="grid gap-4 lg:grid-cols-[19rem_1fr]">
            {/* site, building, controls */}
            <div>
              <SiteMap site={site} selected={bid} onPick={pick} setTip={setTip} />
              <p className="mt-1.5 text-[12px] leading-snug text-ink-2">
                <b className="font-medium text-ink">{b.id} · {b.name}</b><br />
                {b.levels} storeys · today {b.current_use}{data ? ` · ${data.floors.length} floors in this scenario` : ''}
                {base.added_floors ? ` (+${base.added_floors} added)` : ''}
              </p>
              <Group label="Upper floors use">
                {useOpts.map((u) => <Toggle key={u} on={use === u} onChange={() => setUse(u)} label={USE_LABEL[u] ?? site.uses[u] ?? u} />)}
              </Group>
              <Group label="Walls">
                {sysOpts.map((s) => <Toggle key={s} on={system === s} onChange={() => setSystem(s)} label={sysLabel(s)} />)}
              </Group>
              <Group label="Floor">
                {(data?.floors ?? []).map((f) => (
                  <Toggle key={f.index} on={floor === f.index} onChange={() => setFloor(f.index)}
                    label={`F${String(f.index).padStart(2, '0')}${f.index === 0 ? ' ground' : ''}${f.added ? ' +' : ''}`} />
                ))}
              </Group>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {inView
                  ? <Badge tone="good">this is {bid} in the 3D view</Badge>
                  : <Button primary onClick={() => onApply(bid, { use, partition_system: system })}>Apply to {bid} in 3D</Button>}
              </div>
              {err && <p className="mt-2 text-[12px] text-critical">{err}</p>}
            </div>

            {/* the plan */}
            <div className="min-w-0">
              {data && <Plan plan={data.plan} setTip={setTip} />}
              {data && (
                <p className="mt-1 text-[12px] text-ink-2">
                  F{String(data.floor).padStart(2, '0')} · {data.floors[data.floor]?.use_label} · walls {fmt1(data.plan.wall_h)} m high ·
                  hover a wall or room for details
                </p>
              )}
            </div>
          </div>

          {/* KPIs */}
          {k && (
            <div className="mt-4 grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
              <Stat label={`${k.unit_name}s`} value={fmt(k.units)} sub={`${fmt(k.nfa_m2)} m² net of ${fmt(k.gfa_m2)} m² (${fmt((k.nfa_m2 / k.gfa_m2) * 100)} %)`} />
              <Stat label="Partition density" value={`${k.partition_density.toFixed(2)} m²/m²`} sub={`${fmt(k.partition_area_m2)} m² wall, ${fmt(k.partition_run_m)} m run, ${fmt(k.doors)} doors`} />
              <Stat label="Fit-out cost" value={`${fmt1(k.capex_sek / 1e6)} MSEK`} sub={`${fmt(k.capex_sek_per_m2)} SEK per m² gross`} />
              <Stat label="Upfront carbon" value={`${fmt1(k.upfront_kgco2e_per_m2)} kg/m²`} sub={`${fmt(k.upfront_kgco2e / 1000)} t CO₂e, A1–A5 of new material`} />
              <Stat label="End of life" value={`${fmt(k.c1c4_kgco2e / 1000)} t`} sub={`C1–C4 · module D ${fmt(k.d_credit_kgco2e / 1000)} t, not netted`} />
              <Stat label="Walls vs requirements" value={k.walls.sound_below_m2 || k.walls.fire_below_m2 ? `${fmt(Math.max(k.walls.sound_below_m2, k.walls.fire_below_m2))} m² short` : 'all met'}
                sub={k.walls.shortfalls[0] ? `${k.walls.shortfalls[0].category}: ${k.walls.shortfalls[0].has} < ${k.walls.shortfalls[0].required}` : 'indicative sound and fire per use'}
                tone={k.walls.sound_below_m2 || k.walls.fire_below_m2 ? 'warn' : 'good'} />
            </div>
          )}

          {/* every use x system */}
          <h4 className="mb-1 mt-5 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-ink">Upfront carbon per m² gross, every use × wall system, on {bid}</h4>
          <Chart site={site} systems={systems} cells={cells} use={use} system={system} sysLabel={sysLabel}
            onPick={(u, s) => { setUse(u); setSystem(s) }} setTip={setTip} />
          <p className="mt-1 text-[11.5px] text-ink-2">
            New fit-out carbon A1–A5 of becoming each use in the retained shell; click a bar to open it. ◆ marks walls that miss the
            indicative sound or fire requirement of the use. Ground floor and added floors as in the 3D scenario.
          </p>

          {/* bill */}
          {data && (
            <>
              <h4 className="mb-1 mt-5 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-ink">Bill of quantities, new elements, whole building</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="text-left font-mono text-[10.5px] uppercase tracking-wide text-ink-2">
                      <th className="py-1 pr-3 font-medium">Component</th><th className="py-1 pr-3 font-medium">Supplier</th>
                      <th className="py-1 pr-3 font-medium">Layer</th><th className="py-1 pr-3 text-right font-medium">Quantity</th>
                      <th className="py-1 pr-3 text-right font-medium">Cost</th><th className="py-1 pr-3 text-right font-medium">A1–A5</th>
                      <th className="py-1 font-medium">Data</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.bill.map((r) => (
                      <tr key={r.id} className="border-t border-line">
                        <td className="py-1.5 pr-3">{r.name}<div className="font-mono text-[11px] text-muted">{r.id}</div></td>
                        <td className="py-1.5 pr-3 text-ink-2">{r.supplier}</td>
                        <td className="py-1.5 pr-3 text-ink-2">{r.layer.replace('_', ' ')}</td>
                        <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{fmt(r.qty)} {r.unit}</td>
                        <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{fmt1(r.capex_sek / 1e6)} MSEK</td>
                        <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{fmt1(r.upfront_kgco2e / 1000)} t</td>
                        <td className="py-1.5"><Badge tone={r.verified ? 'good' : 'warn'}>{r.verified ? 'supplier / EPD' : 'placeholder'}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-1.5 text-[11.5px] text-ink-2">
                {data.mock_priced_rows > 0 && `${data.mock_priced_rows} elements are priced from the layout engine's own list because the catalogue has no entry yet. `}
                {Object.entries(data.unpriced).length > 0 && `Not priced yet: ${Object.entries(data.unpriced).map(([c, v]) => `${fmt(v)} m² ${c.replace('_', ' ')}`).join(', ')}.`}
              </p>
            </>
          )}
        </div>
      </div>
      {tip && (
        <div className="pointer-events-none fixed z-40 max-w-[300px] rounded-md bg-ink px-2.5 py-1.5 text-[12px] leading-snug text-bg shadow-lg"
          style={{ left: tip.x + 14, top: tip.y + 14 }}>{tip.body}</div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------- pieces
function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-2.5">
      <div className="mb-1 text-[11.5px] text-ink-2">{label}</div>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  )
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'good' | 'warn' }) {
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2.5">
      <div className="text-[11.5px] text-ink-2">{label}</div>
      <div className={`mt-1 font-mono text-[18px] font-semibold leading-none tabular-nums ${tone === 'warn' ? 'text-warn' : tone === 'good' ? 'text-good' : 'text-ink'}`}>{value}</div>
      <div className="mt-1 text-[11px] leading-tight text-muted">{sub}</div>
    </div>
  )
}

function SiteMap({ site, selected, onPick, setTip }: { site: SitePayload; selected: string; onPick: (id: string) => void; setTip: (t: Tip) => void }) {
  const all = site.buildings.flatMap((b) => b.footprint)
  const x0 = Math.min(...all.map((p) => p[0])), x1 = Math.max(...all.map((p) => p[0]))
  const y0 = Math.min(...all.map((p) => p[1])), y1 = Math.max(...all.map((p) => p[1]))
  const pad = 8
  const P = (p: XY) => `${p[0] - x0 + pad},${y1 - p[1] + pad}`
  return (
    <svg viewBox={`0 0 ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}`} className="w-full rounded-md border border-line bg-surface" role="img"
      aria-label="Site plan; select a building">
      {site.buildings.map((b) => {
        const sel = b.id === selected
        const c = b.footprint.reduce((a, p) => [a[0] + p[0] / b.footprint.length, a[1] + p[1] / b.footprint.length], [0, 0])
        return (
          <g key={b.id} className="cursor-pointer" onClick={() => onPick(b.id)}
            onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, body: <><b>{b.id} · {b.name}</b><br />{b.levels} storeys · today {b.current_use}</> })}
            onMouseLeave={() => setTip(null)}>
            <polygon points={b.footprint.map(P).join(' ')} strokeWidth={0.8}
              fill={sel ? 'var(--color-accent)' : b.current_use === 'residential' ? 'var(--color-accent-soft)' : 'var(--color-sunken)'}
              stroke={sel ? 'var(--color-ink)' : 'var(--color-line-strong)'} />
            <text x={c[0] - x0 + pad} y={y1 - c[1] + pad + 3} textAnchor="middle" fontSize={9} fontFamily="var(--font-mono)"
              fill={sel ? 'var(--color-raised)' : 'var(--color-ink-2)'} fontWeight={sel ? 600 : 400} pointerEvents="none">{b.id}</text>
          </g>
        )
      })}
    </svg>
  )
}

function Plan({ plan, setTip }: { plan: PlanGeometry; setTip: (t: Tip) => void }) {
  const xs = plan.footprint.map((p) => p[0]), ys = plan.footprint.map((p) => p[1])
  const w = Math.max(...xs), h = Math.max(...ys), pad = 2
  const Y = (y: number) => h - y
  const pts = (a: XY[]) => a.map((p) => `${p[0]},${Y(p[1])}`).join(' ')
  const ops: Record<string, PlanGeometry['openings']> = {}
  plan.openings.forEach((o) => { (ops[o.wall] ??= []).push(o) })

  // new walls coloured by build: one colour per wall type, largest first
  const lengths: Record<string, number> = {}
  plan.walls.forEach((wl) => {
    if (!RETAINED.has(wl.cat)) lengths[wl.type] = (lengths[wl.type] ?? 0) + Math.hypot(wl.b[0] - wl.a[0], wl.b[1] - wl.a[1])
  })
  const types = Object.keys(lengths).sort((a, b) => lengths[b] - lengths[a])
  const colorOf = (t: string) => TYPE_COLORS[types.indexOf(t) % TYPE_COLORS.length]
  const labelMin = (w * h) / 80

  return (
    <div>
      <svg viewBox={`${-pad} ${-pad} ${w + 2 * pad} ${h + 2 * pad}`} className="max-h-[56vh] w-full rounded-md border border-line bg-bg" role="img"
        aria-label={`Plan of floor ${plan.index}`}>
        <polygon points={pts(plan.footprint)} fill="var(--color-surface)" />
        {plan.rooms.map((r) => {
          const n = r.name.split(' (')[0]
          const fill = n.startsWith('Core') ? 'var(--color-sunken)' : n.startsWith('Atrium') ? 'var(--color-accent-soft)'
            : n === 'Corridor' ? 'var(--color-bg)' : 'var(--color-raised)'
          return <polygon key={r.id} points={pts(r.poly)} fill={fill}
            onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, body: <><b>{r.name}</b><br />{fmt1(r.area)} m² · {r.id}</> })}
            onMouseLeave={() => setTip(null)} />
        })}
        {plan.walls.map((wl) => {
          const [ax, ay] = wl.a, [bx, by] = wl.b
          const L = Math.hypot(bx - ax, by - ay)
          if (L < 0.05) return null
          const ux = (bx - ax) / L, uy = (by - ay) / L
          const P = (s: number): XY => [ax + ux * s, ay + uy * s]
          const col = RETAINED.has(wl.cat) ? 'var(--color-ink-2)' : colorOf(wl.type)
          const doors = (ops[wl.id] ?? []).filter((o) => o.kind === 'door').sort((a, b) => a.s0 - b.s0)
          const segs: [number, number][] = []
          let s = 0
          doors.forEach((d) => { if (d.s0 > s) segs.push([s, d.s0]); s = Math.max(s, d.s1) })
          if (s < L) segs.push([s, L])
          return (
            <g key={wl.id}>
              {segs.map(([s0, s1], i) => {
                const p = P(s0), q = P(s1)
                return <line key={i} x1={p[0]} y1={Y(p[1])} x2={q[0]} y2={Y(q[1])} stroke={col} strokeWidth={Math.max(wl.t, 0.12)} />
              })}
              {(ops[wl.id] ?? []).filter((o) => o.kind === 'window').map((o, i) => {
                const p = P(o.s0), q = P(o.s1)
                return <line key={`w${i}`} x1={p[0]} y1={Y(p[1])} x2={q[0]} y2={Y(q[1])}
                  stroke={o.new ? 'var(--color-c1)' : 'var(--color-surface)'} strokeWidth={Math.max(wl.t * 0.45, 0.08)} />
              })}
              {doors.map((d, i) => {
                const p = P(d.s0), r = d.s1 - d.s0, e = P(d.s1)
                const q: XY = [p[0] - uy * r, p[1] + ux * r]
                return <path key={`d${i}`} d={`M${p[0]},${Y(p[1])} L${q[0]},${Y(q[1])} A${r},${r} 0 0 1 ${e[0]},${Y(e[1])}`}
                  fill="none" stroke="var(--color-muted)" strokeWidth={0.06} />
              })}
              <line x1={ax} y1={Y(ay)} x2={bx} y2={Y(by)} stroke="transparent" strokeWidth={0.9}
                onMouseMove={(ev) => setTip({
                  x: ev.clientX, y: ev.clientY, body: <><b>{wl.id}</b> · {fmt1(L)} m<br />{CATNAME[wl.cat] ?? wl.cat}<br />
                    <span className="font-mono">{wl.type}</span><br />{RETAINED.has(wl.cat) ? 'Existing, no new carbon' : 'New fit-out'}</>,
                })}
                onMouseLeave={() => setTip(null)} />
            </g>
          )
        })}
        {plan.rooms.filter((r) => r.area >= labelMin && !r.name.startsWith('Corridor')).map((r) => (
          <text key={`t${r.id}`} x={r.label[0]} y={Y(r.label[1])} textAnchor="middle" fontSize={Math.max(0.9, Math.min(1.5, w / 55))}
            fontFamily="var(--font-mono)" fill="var(--color-ink-2)" pointerEvents="none">
            {r.name.length > 16 ? r.name.slice(0, 15) + '…' : r.name}
          </text>
        ))}
      </svg>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-ink-2">
        <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-4 rounded-sm" style={{ background: 'var(--color-ink-2)' }} />Retained facade and core</span>
        {types.map((t) => (
          <span key={t} className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-4 rounded-sm" style={{ background: colorOf(t) }} />
            <span className="font-mono">{t}</span> {fmt(lengths[t])} m</span>
        ))}
        <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-4 rounded-sm" style={{ background: 'var(--color-c1)' }} />New windows</span>
      </div>
    </div>
  )
}

function Chart({ site, systems, cells, use, system, sysLabel, onPick, setTip }: {
  site: SitePayload; systems: string[]; cells: Record<string, ParametricCell>; use: string; system: string
  sysLabel: (s: string) => string; onPick: (u: string, s: string) => void; setTip: (t: Tip) => void
}) {
  const uses = CHART_USES.filter((u) => u in site.uses)
  const vals = Object.values(cells).map((c) => c.upfront_kgco2e_per_m2)
  const max = Math.max(10, ...vals) * 1.12
  const W = 900, barH = 12, gap = 3, rowH = systems.length * (barH + gap) + 14, padL = 170, padR = 70, H = uses.length * rowH + 26
  const bw = W - padL - padR
  const step = max > 80 ? 20 : max > 40 ? 10 : 5
  const ticks: number[] = []
  for (let t = 0; t <= max; t += step) ticks.push(t)
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Upfront carbon per m² by use and wall system">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL + (bw * t) / max} x2={padL + (bw * t) / max} y1={4} y2={H - 20} stroke="var(--color-line)" />
            <text x={padL + (bw * t) / max} y={H - 6} textAnchor="middle" fontSize={10.5} fontFamily="var(--font-mono)" fill="var(--color-muted)">{t}</text>
          </g>
        ))}
        {uses.map((u, i) => {
          const y0 = i * rowH + 6
          const on = u === use
          return (
            <g key={u}>
              <text x={padL - 10} y={y0 + (systems.length * (barH + gap)) / 2 + 3} textAnchor="end" fontSize={12.5}
                fill={on ? 'var(--color-ink)' : 'var(--color-ink-2)'} fontWeight={on ? 600 : 400}>{USE_LABEL[u] ?? site.uses[u]}</text>
              {systems.map((s, j) => {
                const c = cells[`${u}|${s}`]
                const y = y0 + j * (barH + gap)
                if (!c) return <text key={s} x={padL + 4} y={y + barH - 2.5} fontSize={10.5} fontFamily="var(--font-mono)" fill="var(--color-muted)">…</text>
                const w = Math.max(2, (bw * c.upfront_kgco2e_per_m2) / max)
                const sel = on && s === system
                return (
                  <g key={s} className="cursor-pointer" onClick={() => onPick(u, s)}
                    onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, body: <><b>{USE_LABEL[u] ?? u}</b> · {sysLabel(s)}<br />
                      {fmt1(c.upfront_kgco2e_per_m2)} kg CO₂e/m² · {fmt(c.capex_sek_per_m2)} SEK/m²<br />
                      {c.walls_ok ? 'walls meet sound and fire' : 'some walls miss sound or fire'}</> })}
                    onMouseLeave={() => setTip(null)}>
                    <rect x={padL} y={y} width={w} height={barH} rx={3} fill={SYSTEM_COLOR[s] ?? 'var(--color-c5)'} opacity={sel ? 1 : 0.55}
                      stroke={sel ? 'var(--color-ink)' : 'none'} strokeWidth={1} />
                    <text x={padL + w + 6} y={y + barH - 2.5} fontSize={11} fontFamily="var(--font-mono)" fill="var(--color-ink-2)">
                      {fmt1(c.upfront_kgco2e_per_m2)}{c.walls_ok ? '' : ' ◆'}
                    </text>
                  </g>
                )
              })}
            </g>
          )
        })}
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-ink-2">
        {systems.map((s) => (
          <span key={s} className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-4 rounded-sm" style={{ background: SYSTEM_COLOR[s] }} />{sysLabel(s)}</span>
        ))}
      </div>
    </div>
  )
}
