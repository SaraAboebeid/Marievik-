import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { W as PLATE_W, type StudioMeta, type StudioPayload } from '../studio/engine'
import { GYPSUM, runCosts, smartax, solidM2, sumCosts, wallDiff, type ChangeCost, type SmartaxMode, type SystemSpec } from '../flex'
import type { FlexFrame, FlexFloorFrame } from '../viewer/Viewer'
import { DecadeChart, fmtK, fmtN } from './FlexDrawer'

// Flexibility at Building scale (B01): the whole building as an exploded stack of its floors, built twice side by
// side — Smartax walls on the left, fixed gypsum walls on the right — through ten years in which every floor keeps
// its own layout and changes on its own schedule. Each change brings the walls down and up on both sides; floors
// under works close for as long as their system takes, either all at once or one after another (the rest of the
// building stays open). Segment 1 — every floor as it is today, no works — is the baseline. Click a floor for the
// floor view (FlexDrawer).

const YEARS = Array.from({ length: 11 }, (_, i) => 2026 + i)
const Y0 = YEARS[0]
const TOTAL = YEARS.length * 52
const yearOf = (w: number) => Math.min(YEARS.length - 1, Math.floor(w / 52))
const toWeeks = (days: number) => (Math.ceil(days) * 7) / 5 / 7

export interface FloorPlan { start: string; changes: { year: number; layout: string }[] }
type Phasing = 'sequential' | 'together'
interface BChange { floor: number; year: number; from: string; to: string; diff: ReturnType<typeof wallDiff>; rem: number; add: number; gfa: number }
interface Sched { start: number; strip: number; build: number; end: number }

/** A starting ten years in which no two floors are alike: each keeps today's layout and changes on its own schedule. */
export function defaultBuildingPlan(meta: StudioMeta): FloorPlan[] {
  const has = (l: string) => !!meta.layouts[l]
  const pick = (...ls: string[]) => ls.find(has) ?? ls[0]
  const script: [number, string][][] = [
    [[2028, pick('gf_food')], [2033, pick('gf_cowork')]],
    [[2027, pick('cellular')], [2031, pick('cowork')]],
    [[2029, pick('abw')], [2034, pick('open')]],
    [[2028, pick('teams')], [2032, pick('mixed')]],
    [[2030, pick('cowork')]],
    [[2027, pick('cellular')], [2033, pick('teams')]],
    [[2029, pick('cafe', 'mixed')], [2035, pick('open')]],
  ]
  return meta.defaultFloor.map((start, f) => ({ start, changes: (script[f] ?? []).filter(([, l]) => l !== start).map(([year, layout]) => ({ year, layout })) }))
}
const layoutAt = (p: FloorPlan, year: number) => p.changes.filter((c) => c.year <= year).reduce((_, c) => c.layout, p.start)

export function BuildingFlex({ meta, onOpenFloor, onClose, onFrame }: {
  meta: StudioMeta; onOpenFloor: (floor: number) => void; onClose: () => void; onFrame: (f: FlexFrame | null) => void
}) {
  const [plan, setPlan] = useState<FloorPlan[]>(() => defaultBuildingPlan(meta))
  const [sxMode, setSxMode] = useState<SmartaxMode>('documented')
  const [phasing, setPhasing] = useState<Phasing>('sequential')
  const [week, setWeek] = useState(0)
  const [small, setSmall] = useState(() => (typeof window !== 'undefined' ? window.innerHeight < 1000 : false))
  const [playing, setPlaying] = useState(false)
  const [payloads, setPayloads] = useState<Record<string, StudioPayload>>({})
  const [err, setErr] = useState<string | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const nF = plan.length

  // every floor's plans, in every layout it passes through (the floor studio, explorer/studio)
  const needed = [...new Set(plan.flatMap((p, f) => [p.start, ...p.changes.map((c) => c.layout)].map((l) => `${f}:${l}`)))]
  useEffect(() => {
    let alive = true
    for (const key of needed) {
      if (payloads[key]) continue
      const [f, l] = key.split(':')
      api.studioFloor('B01', Number(f), l, {}).then((p) => { if (alive) setPayloads((m) => ({ ...m, [key]: p })) })
        .catch((e) => { if (alive) setErr(`Floor ${f}, ${l}: ${(e as Error).message}`) })
    }
    return () => { alive = false }
  }, [needed.join('|')])
  const pay = (f: number, l: string) => payloads[`${f}:${l}`]
  const ready = needed.every((k) => payloads[k])

  // the changes, in time order (the panel store carries from one to the next across the whole building)
  const changes: BChange[] = useMemo(() => {
    if (!ready) return []
    const out: BChange[] = []
    plan.forEach((p, f) => {
      let cur = p.start
      for (const c of [...p.changes].sort((a, b) => a.year - b.year)) {
        if (c.layout === cur) continue
        const diff = wallDiff(pay(f, cur).walls, pay(f, c.layout).walls)
        out.push({ floor: f, year: c.year, from: cur, to: c.layout, diff, rem: solidM2(diff.removed), add: solidM2(diff.added), gfa: pay(f, cur).fig.gfa })
        cur = c.layout
      }
    })
    return out.sort((a, b) => a.year - b.year || a.floor - b.floor)
  }, [ready, JSON.stringify(plan)])
  const sysL = useMemo(() => smartax(sxMode), [sxMode])
  // runCosts carries the store; one call over the whole building, with each floor's own area for the rent
  const run = (sys: SystemSpec) => {
    const ks = runCosts(sys, changes.map((c) => ({ rem: c.rem, add: c.add })), 1)
    return ks.map((k, i) => ({ ...k, lostRentSek: k.lostRentSek * changes[i].gfa }))
  }
  const costL = useMemo(() => run(sysL), [changes, sysL])
  const costR = useMemo(() => run(GYPSUM), [changes])
  // when each change happens: all floors of a year at once, or one after another
  const schedule = (cs: ChangeCost[]): Sched[] => {
    const nextFree: Record<number, number> = {}
    return changes.map((c, i) => {
      const ys = (c.year - Y0) * 52
      const start = phasing === 'together' ? ys : Math.max(ys, nextFree[c.year] ?? ys)
      const k = cs[i]
      const end = start + k.days / 7
      nextFree[c.year] = end
      return { start, strip: start + toWeeks(k.stripDays), build: start + toWeeks(k.stripDays + k.buildDays), end }
    })
  }
  const schL = useMemo(() => schedule(costL), [costL, phasing])
  const schR = useMemo(() => schedule(costR), [costR, phasing])

  // the clock: ten years in ~35 s, slowing down while any floor is under works
  const wk = useRef(week)
  wk.current = week
  useEffect(() => {
    if (!playing) return
    let raf = 0, last = performance.now()
    const tick = (now: number) => {
      const w0 = wk.current
      const busy = [...schL, ...schR].some((p) => w0 >= p.start && w0 < p.end)
      const w = Math.min(TOTAL, w0 + ((now - last) / 1000) * (busy ? 6 : 22))
      last = now
      setWeek(w)
      if (w >= TOTAL) { setPlaying(false); return }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, schL, schR])
  const play = () => {
    if (playing) return setPlaying(false)
    if (week >= TOTAL - 0.01) setWeek(0)
    setPlaying(true)
  }
  const jump = (w: number) => { setPlaying(false); setWeek(w) }
  const yi = yearOf(week)

  // the 3D model: B01 exploded twice in the scene (Viewer.setFlexFrame) — one frame per moment of the clock
  const steadyOf = useRef(new Map<string, ReturnType<typeof wallDiff>['kept']>())
  useEffect(() => {
    if (!ready) return
    const floorFrame = (f: number, sch: Sched[]): FlexFloorFrame => {
      let ci = -1
      changes.forEach((c, i) => { if (c.floor === f && week >= sch[i].start) ci = i })
      const c = ci >= 0 ? changes[ci] : null
      const sc = ci >= 0 ? sch[ci] : null
      const closed = !!sc && week < sc.end
      const t = !sc || week >= sc.end ? 1 : week < sc.strip ? ((week - sc.start) / Math.max(1e-3, sc.strip - sc.start)) * 0.35
        : week < sc.build ? 0.35 + ((week - sc.strip) / Math.max(1e-3, sc.build - sc.strip)) * 0.5 : 0.85 + ((week - sc.build) / Math.max(1e-3, sc.end - sc.build)) * 0.15
      const layout = c ? (t < 0.5 ? c.from : c.to) : plan[f].start
      const p = pay(f, layout)
      const rooms = p.rooms.map((r) => ({ t: r.t, r: r.r, open: r.open }))
      if (c && closed) {
        return { key: `${c.from}>${c.to}:${Math.round(t * 48)}:${sysKey}`, ground: f === 0, closed, t, rooms, steady: null, kept: c.diff.kept, removed: c.diff.removed, added: c.diff.added }
      }
      const k = `${f}:${layout}`
      if (!steadyOf.current.has(k)) steadyOf.current.set(k, wallDiff(p.walls, p.walls).kept)
      return { key: `${layout}:open`, ground: f === 0, closed: false, t: 1, rooms, steady: steadyOf.current.get(k)!, kept: [], removed: [], added: [] }
    }
    const openOf = (sch: Sched[]) => nF - new Set(changes.filter((_, i) => week >= sch[i].start && week < sch[i].end).map((c) => c.floor)).size
    const sysKey = sxMode
    onFrame({
      building: 'B01', gap: 9, fit: small ? 'small' : 'large',
      sides: [
        { id: 'smartax', title: `Smartax walls · ${openOf(schL)} of ${nF} floors open`, tone: '#3c8f5f', dx: -(PLATE_W / 2 + 11), reusable: sysL.reinstallSek > 0, recover: sysL.recover,
          floors: plan.map((_, f) => floorFrame(f, schL)) },
        { id: 'gypsum', title: `Fixed gypsum walls · ${openOf(schR)} of ${nF} floors open`, tone: '#7a8796', dx: PLATE_W / 2 + 11, reusable: false, recover: GYPSUM.recover,
          floors: plan.map((_, f) => floorFrame(f, schR)) },
      ],
    })
  }, [ready, week, changes, schL, schR, sysL, small])
  useEffect(() => () => onFrame(null), [])

  // shared figures: the uses don't depend on the wall system — people on the building now, against segment 1
  const peopleNow = ready ? plan.reduce((a, p, f) => a + (pay(f, layoutAt(p, YEARS[yi]))?.fig.people ?? 0), 0) : 0
  const peopleBase = ready ? plan.reduce((a, p, f) => a + (pay(f, p.start)?.fig.people ?? 0), 0) : 0
  const changesThisYear = changes.filter((c) => c.year === YEARS[yi]).length

  const setRow = (f: number, row: FloorPlan) => { const p = [...plan]; p[f] = row; setPlan(p); setPlaying(false) }
  const opts = (f: number) => (f === 0 ? meta.ground : meta.typical)
  const name = (l: string) => meta.layouts[l]?.name ?? l

  const totNow = (cs: ChangeCost[], sch: Sched[]) => sumCosts(cs.filter((_, i) => sch[i].start <= week + 1e-6))
  return (
    <div className="pointer-events-auto flex max-h-[min(24rem,42vh)] w-full flex-col overflow-hidden rounded-xl border-2 border-edge bg-raised shadow-[3px_3px_0_var(--color-edge)]">
      <div className="checker-band flex flex-wrap items-center justify-between gap-2 px-3.5 pb-2 pt-1">
        <h4 className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em]">Flexibility · B01 · Smartax left, gypsum right</h4>
        <span className="flex items-center gap-1.5">
          <button type="button" onClick={() => setSmall(!small)} aria-expanded={!small} title={small ? 'Show the figures, charts and floor plans' : 'Fold away, to see more of the model'}
            className="rounded-[4px] border-2 border-edge bg-surface px-1.5 font-mono text-[11px] font-bold">{small ? 'more ▴' : 'less ▾'}</button>
          <span className="rounded-[4px] border-2 border-edge bg-surface px-1.5 font-mono text-[12px] font-bold">{YEARS[yi]}</span>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-6 w-6 place-items-center rounded-full border-2 border-edge bg-surface text-[13px] leading-none">×</button>
        </span>
      </div>
      <div className="overflow-y-auto px-3.5 py-2.5">
        {/* the controls and the shared figures */}
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <button type="button" onClick={play} disabled={!ready} aria-pressed={playing}
            className={`rounded-md border-2 border-edge px-3 py-1 font-mono text-[12px] font-bold shadow-[2px_2px_0_var(--color-edge)] disabled:opacity-40 ${playing ? 'bg-accent text-white' : 'bg-coral text-[#202020]'}`}>
            {playing ? '❚❚ pause' : '▶ play ten years'}
          </button>
          <div className="flex flex-wrap gap-1">
            {YEARS.map((y, i) => (
              <button key={y} type="button" onClick={() => jump(i * 52)} title={`${y}: ${changes.filter((c) => c.year === y).length} floor change(s)`}
                className={`rounded border-[1.5px] border-edge px-1.5 font-mono text-[10.5px] ${i === yi ? 'bg-coral font-bold' : changes.some((c) => c.year === y) ? 'bg-[#f5c443]' : 'bg-surface'}`}>{String(y).slice(2)}</button>
            ))}
          </div>
          <span className="flex overflow-hidden rounded-md border-2 border-edge text-[11px] font-semibold" title="When several floors change in the same year">
            {(['sequential', 'together'] as Phasing[]).map((ph) => (
              <button key={ph} type="button" aria-pressed={phasing === ph} onClick={() => setPhasing(ph)}
                className={`px-2 py-0.5 ${phasing === ph ? 'bg-ink text-surface' : 'bg-surface'}`}>{ph === 'sequential' ? 'one floor at a time' : 'all at once'}</button>
            ))}
          </span>
          <span className="ml-auto flex flex-wrap gap-3 font-mono text-[11px] text-ink-2">
            <span title="Planned people on all floors in this year's layouts (floor studio), against segment 1: every floor as it is today">
              People <b className="text-ink">{fmtN(peopleNow)}</b> <span className="text-muted">(segment 1: {fmtN(peopleBase)})</span>
            </span>
            <span>Floors changing this year <b className="text-ink">{changesThisYear}</b></span>
          </span>
        </div>

        {small && ready && (() => {
          // one card per KPI: Smartax against gypsum so far, and Smartax's difference (green when it does better)
          const l = totNow(costL, schL), r = totNow(costR, schR)
          const cards: [string, number, number, (v: number) => string][] = [
            ['Wall works SEK', l.sek, r.sek, fmtK],
            ['Carbon t CO₂e', l.kg / 1000, r.kg / 1000, (v) => fmtN(v, 1)],
            ['Waste t', l.wasteT, r.wasteT, (v) => fmtN(v, 1)],
            ['Floor-wks shut', l.days / 7, r.days / 7, (v) => fmtN(v, 1)],
            ['Rent lost SEK', l.lostRentSek, r.lostRentSek, fmtK],
          ]
          return (
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-5">
              {cards.map(([k, a, b, f]) => {
                const d = b > 1e-9 ? (a - b) / b : null
                const tag = d === null || Math.abs(d) < 0.005 ? 'bg-sunken text-ink-2' : d < 0 ? 'bg-[#03b05f] text-white' : 'bg-[#d8342b] text-white'
                return (
                  <div key={k} className="rounded-md border-2 border-edge bg-surface px-2 py-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-muted">{k}</span>
                      <span className={`rounded px-1 font-mono text-[10.5px] font-bold tabular-nums ${tag}`}
                        title="Smartax against fixed gypsum walls, so far">{d === null ? '—' : `${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(Math.round(d * 100))} %`}</span>
                    </div>
                    <div className="flex items-baseline gap-2 font-mono text-[11px] tabular-nums">
                      <span className="flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-sm" style={{ background: '#3c8f5f' }} /><b>{f(a)}</b></span>
                      <span className="flex items-center gap-1 text-ink-2"><i className="inline-block h-2 w-2 rounded-sm" style={{ background: '#7a8796' }} />{f(b)}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })()}
        {!small && <>
        {err && <p className="mb-2 rounded border border-critical bg-critical-bg px-2 py-1 text-[11.5px] text-critical">{err}</p>}
        {!ready ? <p className="py-3 text-center text-[12px] text-muted">Laying out every floor's plans…</p> : (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {[{ sys: sysL, tone: '#3c8f5f', cs: costL, sch: schL, other: costR, osch: schR }, { sys: GYPSUM, tone: '#7a8796', cs: costR, sch: schR, other: costL, osch: schL }].map(({ sys, tone, cs, sch, other, osch }) => {
              const tot = sumCosts(cs.filter((_, i) => sch[i].start <= week + 1e-6))
              const oth = sumCosts(other.filter((_, i) => osch[i].start <= week + 1e-6))
              const better = (a: number, b: number) => (a < b - 1e-6 ? 'text-good font-bold' : a > b + 1e-6 ? 'text-critical' : '')
              return (
                <div key={sys.id} className="rounded-lg border-2 border-edge bg-surface">
                  <div className="flex flex-wrap items-center justify-between gap-1.5 border-b-2 border-edge px-2 py-1" style={{ background: `${tone}22` }}>
                    <b className="flex items-center gap-1.5 text-[12px]"><i className="inline-block h-3 w-3 rounded-sm border-2 border-edge" style={{ background: tone }} />{sys.id === 'gypsum' ? 'Fixed gypsum walls (right)' : 'Smartax walls (left)'}</b>
                    {sys.id !== 'gypsum' && (
                      <span className="flex items-center gap-1 text-[10px]">
                        <button type="button" aria-pressed={sxMode === 'documented'} onClick={() => setSxMode('documented')} title={smartax('documented').note}
                          className={`rounded border-[1.5px] border-edge px-1 ${sxMode === 'documented' ? 'bg-ink text-surface' : 'bg-surface'}`}>as documented</button>
                        <button type="button" aria-pressed={sxMode === 'claimed'} onClick={() => setSxMode('claimed')} title={smartax('claimed').note}
                          className={`rounded border-[1.5px] border-edge px-1 ${sxMode === 'claimed' ? 'bg-[#f5c443]' : 'bg-surface'}`}>as claimed</button>
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-6 gap-x-2 px-2 py-1 text-[10.5px]">
                    <Fig k="Wall works" v={`${fmtK(tot.sek)}`} cls={better(tot.sek, oth.sek)} />
                    <Fig k="Carbon t" v={`${fmtN(tot.kg / 1000, 1)}`} cls={better(tot.kg, oth.kg)} />
                    <Fig k="Waste t" v={`${fmtN(tot.wasteT, 1)}`} cls={better(tot.wasteT, oth.wasteT)} />
                    <Fig k="Reused·rec. m²" v={`${fmtN(tot.reusedM2)}·${fmtN(tot.recoveredM2)}`} cls={better(-tot.reusedM2 - tot.recoveredM2, -oth.reusedM2 - oth.recoveredM2)} />
                    <Fig k="Floor-wks shut" v={`${fmtN(tot.days / 7, 1)}`} cls={better(tot.days, oth.days)} />
                    <Fig k="Rent lost" v={`${fmtK(tot.lostRentSek)}`} cls={better(tot.lostRentSek, oth.lostRentSek)} />
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {ready && (
          <details className="mt-2"><summary className="cursor-pointer font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em]">Charts: ten years, cumulative</summary>
          <DecadeChart slots={YEARS.map((y) => ({ label: String(y) }))} changes={changes.map((c) => ({ i: c.year - Y0 }))} costL={costL} costR={costR}
            week={week} setWeek={jump} seg1="every floor as it is today" />
          </details>
        )}

        {/* the ten years, floor by floor: today's layout and its changes — every floor its own */}
        <details className="mt-2 rounded-lg border-2 border-edge bg-surface">
          <summary className="cursor-pointer px-2.5 py-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em]">Segment 2 · each floor's ten years (edit any floor)</summary>
          <div className="space-y-1 px-2.5 pb-2">
            {plan.map((_, f) => f).reverse().map((f) => {
              const p = plan[f]
              return (
                <div key={f} className={`flex flex-wrap items-center gap-1.5 text-[11.5px] ${hover === f ? 'rounded bg-[#fde0d6]' : ''}`} onMouseEnter={() => setHover(f)} onMouseLeave={() => setHover(null)}>
                  <button type="button" onClick={() => onOpenFloor(f)} title="Open this floor's own view"
                    className="w-14 rounded border-[1.5px] border-edge bg-surface px-1 font-mono text-[10.5px] font-bold hover:bg-coral">Floor {f} ›</button>
                  <select value={p.start} onChange={(e) => setRow(f, { ...p, start: e.target.value })} className="rounded border-[1.5px] border-edge bg-surface px-1 py-px">
                    {opts(f).map((l) => <option key={l} value={l}>{name(l)}</option>)}
                  </select>
                  {p.changes.map((c, k) => (
                    <span key={k} className="flex items-center gap-1">
                      <span className="text-muted">→</span>
                      <select value={c.year} onChange={(e) => { const cs = [...p.changes]; cs[k] = { ...c, year: Number(e.target.value) }; setRow(f, { ...p, changes: cs }) }}
                        className="rounded border-[1.5px] border-edge bg-[#f5c443] px-1 py-px font-mono">
                        {YEARS.slice(1).map((y) => <option key={y} value={y}>{y}</option>)}
                      </select>
                      <select value={c.layout} onChange={(e) => { const cs = [...p.changes]; cs[k] = { ...c, layout: e.target.value }; setRow(f, { ...p, changes: cs }) }}
                        className="rounded border-[1.5px] border-edge bg-surface px-1 py-px">
                        {opts(f).map((l) => <option key={l} value={l}>{name(l)}</option>)}
                      </select>
                      <button type="button" onClick={() => setRow(f, { ...p, changes: p.changes.filter((_, j) => j !== k) })} title="Remove this change" className="text-muted hover:text-critical">×</button>
                    </span>
                  ))}
                  {p.changes.length < 3 && (
                    <button type="button" onClick={() => setRow(f, { ...p, changes: [...p.changes, { year: Math.min(2036, (p.changes[p.changes.length - 1]?.year ?? 2027) + 3), layout: opts(f).find((l) => l !== layoutAt(p, 2036)) ?? p.start }] })}
                      className="rounded border-[1.5px] border-dashed border-edge px-1.5 text-[10.5px] text-ink-2 hover:bg-sunken">+ change</button>
                  )}
                </div>
              )
            })}
            <p className="pt-1 text-[10.5px] text-muted">
              Segment 1 keeps every floor as it is today: no wall works, the dashed baseline. Walls from the floor studio's plans for each floor (solid partitions; glazed ones cost the same either way).
              Prices, carbon and times as in the floor view; the Smartax panel store is shared by the whole building. One floor at a time: floors changing the same year are done one after another, so the rest stay open.
            </p>
          </div>
        </details>
        </>}
      </div>
    </div>
  )
}
const Fig = ({ k, v, cls, title }: { k: string; v: string; cls: string; title?: string }) => (
  <div title={title}><span className="block font-mono text-[9.5px] uppercase tracking-[0.06em] text-muted">{k}</span><span className={`font-mono tabular-nums ${cls}`}>{v}</span></div>
)

