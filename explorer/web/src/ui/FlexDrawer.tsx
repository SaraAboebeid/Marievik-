import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from '../api'
import { H as PLATE_H, W as PLATE_W, type StudioMeta, type StudioPayload } from '../studio/engine'
import { FloorLayer, HZ, iso, pts, type FloorLayerProps } from './flexDraw'
import type { Timeline, TimelineResponse } from '../types'
import { GYPSUM, WALL_H, runCosts, smartax, solidM2, sumCosts, wallDiff, type ChangeCost, type SmartaxMode, type SystemSpec } from '../flex'

// Flexibility (Building scale, B01): one floor built twice side by side — Smartax walls on the left, fixed gypsum
// walls on the right — through either one year (a use per quarter, picked from the floor studio's plans) or ten
// years (segment 2 of the floor's 10-year plan, with segment 1, the use as it is, as the no-change baseline). At
// each change the walls that go come down, the walls that come go up, and each floor is closed for as long as its
// system takes: the clocks run in step, so you see which floor reopens first.

type Mode = 'year' | 'decade'
interface Slot { label: string; layout: string | null; use: string }
interface Change { i: number; start: number; from: Slot; to: Slot; diff: ReturnType<typeof wallDiff> | null; rem: number; add: number }
interface Phases { start: number; strip: number; build: number; end: number }   // weeks

const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4']
export const fmtK = (n: number) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(2)} M` : `${Math.round(n / 1000).toLocaleString('sv-SE')} k`)
export const fmtN = (n: number, d = 0) => n.toLocaleString('sv-SE', { maximumFractionDigits: d, minimumFractionDigits: d })
const USE_LABEL: Record<string, string> = { office_open: 'Open-plan office', office_cellular: 'Cellular office', school: 'School', hotel: 'Hotel',
  residential: 'Housing', retail: 'Retail', restaurant_cafe: 'Restaurant & café', mix_cafe_amenities: 'Café & amenities', mix_cafe_event_amenities: 'Café, events & amenities' }
const useLabel = (u: string) => USE_LABEL[u] ?? u.replace(/_/g, ' ')
const toWeeks = (days: number) => (Math.ceil(days) * 7) / 5 / 7

export function FlexDrawer({ meta, project, floor, setFloor, prefill, prefillNote, onClose }: {
  meta: StudioMeta; project: string; floor: number; setFloor: (f: number) => void
  prefill: string[]; prefillNote: string; onClose: () => void
}) {
  const typical = meta.typical
  const [mode, setMode] = useState<Mode>('year')
  const [plan, setPlan] = useState<string[]>(prefill)
  useEffect(() => { setPlan(prefill) }, [prefill.join('|')])
  const [sxMode, setSxMode] = useState<SmartaxMode>('documented')
  const [week, setWeek] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [payloads, setPayloads] = useState<Record<string, StudioPayload>>({})
  const [err, setErr] = useState<string | null>(null)

  // ten years: the floor's own 10-year plan (explorer/timeline.py), polled until the server has it ready
  const [tl, setTl] = useState<TimelineResponse | null>(null)
  const [pathway, setPathway] = useState('lowest_cost')
  useEffect(() => {
    if (mode !== 'decade') return
    let alive = true, t = 0
    setTl(null)
    const poll = () => api.timeline('B01', project, floor).then((r) => {
      if (!alive) return
      setTl(r)
      if (r.status === 'computing') t = window.setTimeout(poll, 2000)
    }).catch((e) => { if (alive) { setErr(`10-year plan: ${(e as Error).message}`); t = window.setTimeout(poll, 5000) } })
    poll()
    return () => { alive = false; window.clearTimeout(t) }
  }, [mode, floor, project])
  const tlReady = tl && tl.status === 'ready' ? (tl as Timeline) : null
  const pathways = tlReady ? tlReady.segments.filter((s) => s.segment === 2 && s.highlight) : []
  const seg2 = tlReady ? tlReady.segments.find((s) => s.id === pathway) ?? pathways[0] : null
  const seg1 = tlReady?.segments.find((s) => s.segment === 1)

  // the slots (quarters or years) and the changes between them
  const slotWeeks = mode === 'year' ? 13 : 52
  const slots: Slot[] = mode === 'year'
    ? plan.map((l, q) => ({ label: QUARTERS[q], layout: l, use: meta.layouts[l]?.use ?? l }))
    : seg2 && tlReady ? seg2.years.map((y) => {
      const use = tlReady.states[y.state]?.groups.floor?.use ?? tlReady.states[y.state]?.groups.upper?.use ?? ''
      return { label: String(y.year), layout: meta.useToLayout.typical[use] ?? null, use }
    }) : []
  const totalWeeks = Math.max(1, slots.length) * slotWeeks
  const layouts = [...new Set(slots.map((s) => s.layout).filter((l): l is string => !!l))]
  useEffect(() => {
    let alive = true
    for (const l of layouts) {
      const key = `${floor}:${l}`
      if (payloads[key]) continue
      api.studioFloor('B01', floor, l, {}).then((p) => { if (alive) setPayloads((m) => ({ ...m, [key]: p })) })
        .catch((e) => { if (alive) setErr(`${l}: ${(e as Error).message}`) })
    }
    return () => { alive = false }
  }, [floor, layouts.join('|')])
  const pay = (l: string | null) => (l ? payloads[`${floor}:${l}`] : undefined)
  const ready = slots.length > 0 && layouts.every((l) => pay(l))
  const gfa = ready ? pay(layouts[0])?.fig.gfa ?? 2000 : 2000

  const changes: Change[] = useMemo(() => {
    if (!ready) return []
    const out: Change[] = []
    if (mode === 'year') {
      for (let q = 1; q < slots.length; q++) {
        if (slots[q].layout === slots[q - 1].layout) continue
        const diff = wallDiff(pay(slots[q - 1].layout)!.walls, pay(slots[q].layout)!.walls)
        out.push({ i: q, start: q * slotWeeks, from: slots[q - 1], to: slots[q], diff, rem: solidM2(diff.removed), add: solidM2(diff.added) })
      }
    } else if (seg2 && tlReady) {
      for (const e of seg2.events) {
        const i = tlReady.years.indexOf(e.year)
        if (i <= 0) continue
        const from = slots[i - 1], to = slots[i]
        const a = pay(from.layout), b = pay(to.layout)
        const diff = a && b && from.layout !== to.layout ? wallDiff(a.walls, b.walls) : null
        out.push({ i, start: i * slotWeeks, from, to, diff, rem: e.walls_removed_m2, add: e.walls_new_m2 })
      }
    }
    return out
  }, [ready, mode, slots.map((s) => s.layout ?? s.use).join('|'), seg2?.id, floor])
  const sysL = useMemo(() => smartax(sxMode), [sxMode])
  const costL = useMemo(() => runCosts(sysL, changes, gfa), [changes, sysL, gfa])
  const costR = useMemo(() => runCosts(GYPSUM, changes, gfa), [changes, gfa])
  const phases = (cs: ChangeCost[]): Phases[] => changes.map((c, i) => {
    const k = cs[i]
    return { start: c.start, strip: c.start + toWeeks(k.stripDays), build: c.start + toWeeks(k.stripDays + k.buildDays), end: c.start + k.days / 7 }
  })
  const phL = useMemo(() => phases(costL), [costL])
  const phR = useMemo(() => phases(costR), [costR])

  // the clock: a year in ~26 s; ten years in ~35 s, slowing down while either floor is closed
  const wk = useRef(week)
  wk.current = week
  useEffect(() => { setWeek(0); setPlaying(false) }, [mode, floor, seg2?.id])
  useEffect(() => {
    if (!playing) return
    let raf = 0, last = performance.now()
    const tick = (now: number) => {
      const w0 = wk.current
      const busy = [...phL, ...phR].some((p) => w0 >= p.start && w0 < p.end)
      const speed = mode === 'year' ? 2 : busy ? 5 : 20
      const w = Math.min(totalWeeks, w0 + ((now - last) / 1000) * speed)
      last = now
      setWeek(w)
      if (w >= totalWeeks) { setPlaying(false); return }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, totalWeeks, phL, phR, mode])
  const play = () => {
    if (playing) return setPlaying(false)
    if (week >= totalWeeks - 0.01) setWeek(0)
    setPlaying(true)
  }
  const jump = (w: number) => { setPlaying(false); setWeek(w) }

  const upTo = (cs: ChangeCost[]) => sumCosts(cs.filter((_, i) => changes[i].start <= week + 1e-6))
  const totL = upTo(costL), totR = upTo(costR)
  const slotNow = Math.min(Math.max(0, slots.length - 1), Math.floor(week / slotWeeks))
  const name = (l: string) => meta.layouts[l]?.name ?? l
  const nowLabel = mode === 'year' ? `${slots[slotNow]?.label ?? ''} · week ${Math.floor(week) + 1}` : `${slots[slotNow]?.label ?? ''}`

  return (
    <div className="pointer-events-auto flex max-h-[min(40rem,66vh)] w-full flex-col overflow-hidden rounded-xl border-2 border-edge bg-raised shadow-[3px_3px_0_var(--color-edge)]">
      <div className="checker-band flex flex-wrap items-center justify-between gap-2 px-3.5 pb-2.5 pt-1.5">
        <h4 className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em]">Flexibility · B01 floor {floor} · Smartax against fixed gypsum walls</h4>
        <span className="flex items-center gap-1.5">
          <span className="flex overflow-hidden rounded-md border-2 border-edge text-[11px] font-bold">
            {(['year', 'decade'] as Mode[]).map((m) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}
                className={`px-2 py-0.5 ${mode === m ? 'bg-ink text-surface' : 'bg-surface'}`}>{m === 'year' ? 'One year' : '10 years'}</button>
            ))}
          </span>
          <span className="rounded-[4px] border-2 border-edge bg-surface px-1.5 font-mono text-[12px] font-bold">{nowLabel}</span>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-6 w-6 place-items-center rounded-full border-2 border-edge bg-surface text-[13px] leading-none">×</button>
        </span>
      </div>
      <div className="overflow-y-auto px-3.5 py-2.5">
        <div className="mb-2 flex flex-wrap items-end gap-2">
          <label className="flex flex-col font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted">Floor
            <select value={floor} onChange={(e) => { setPlaying(false); setWeek(0); setFloor(Number(e.target.value)) }}
              className="mt-0.5 rounded-md border-2 border-edge bg-surface px-1.5 py-0.5 font-sans text-[12px] normal-case tracking-normal text-ink">
              {meta.defaultFloor.map((_, f) => f).filter((f) => f > 0).map((f) => <option key={f} value={f}>Floor {f}</option>)}
            </select>
          </label>
          {mode === 'year' ? plan.map((l, q) => (
            <label key={q} className={`flex min-w-[8.5rem] flex-1 flex-col font-mono text-[10.5px] uppercase tracking-[0.08em] ${q === slotNow ? 'text-ink' : 'text-muted'}`}>
              {QUARTERS[q]}{q > 0 && plan[q] !== plan[q - 1] ? ' · change' : ''}
              <select value={l} onChange={(e) => { const p = [...plan]; p[q] = e.target.value; setPlan(p); setPlaying(false) }}
                className={`mt-0.5 rounded-md border-2 border-edge px-1.5 py-0.5 font-sans text-[12px] normal-case tracking-normal text-ink ${q === slotNow ? 'bg-coral shadow-[2px_2px_0_var(--color-edge)]' : 'bg-surface'}`}>
                {typical.map((t) => <option key={t} value={t}>{name(t)}</option>)}
              </select>
            </label>
          )) : (
            <>
              <label className="flex min-w-[16rem] flex-col font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted">Segment 2 · pathway
                <select value={seg2?.id ?? ''} disabled={!tlReady} onChange={(e) => setPathway(e.target.value)}
                  className="mt-0.5 rounded-md border-2 border-edge bg-coral px-1.5 py-0.5 font-sans text-[12px] normal-case tracking-normal text-ink shadow-[2px_2px_0_var(--color-edge)]">
                  {pathways.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </label>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 pb-0.5">
                {slots.map((s, i) => {
                  const changed = i > 0 && s.use !== slots[i - 1].use
                  return (
                    <button key={i} type="button" onClick={() => jump(i * slotWeeks)} title={`${s.label}: ${useLabel(s.use)}${s.layout ? '' : ' (no drawn plan yet)'}`}
                      className={`rounded border-[1.5px] border-edge px-1 font-mono text-[9.5px] leading-tight ${i === slotNow ? 'bg-coral' : changed ? 'bg-[#f5c443]' : 'bg-surface'}`}>
                      {s.label.slice(2)}<span className="block font-sans text-[9px]">{useLabel(s.use).split(' ')[0]}</span>
                    </button>
                  )
                })}
              </div>
            </>
          )}
          <button type="button" onClick={play} aria-pressed={playing} disabled={!ready}
            className={`rounded-md border-2 border-edge px-3 py-1 font-mono text-[12px] font-bold shadow-[2px_2px_0_var(--color-edge)] disabled:opacity-40 ${playing ? 'bg-accent text-white' : 'bg-coral text-[#202020]'}`}>
            {playing ? '❚❚ pause' : mode === 'year' ? '▶ play the year' : '▶ play ten years'}
          </button>
        </div>
        <p className="mb-2 text-[10.5px] text-muted">
          {mode === 'year' ? prefillNote
            : tlReady && seg2 ? `Segment 2, "${seg2.label}": ${seg2.events.length ? seg2.events.map((e) => `${e.year} ${useLabel(e.from)} → ${useLabel(e.to)}`).join(', ') : 'no change'}. Wall quantities from the 10-year plan (explorer/timeline.py); the plans show the drawn layouts where the floor studio has one. Segment 1 (${seg1?.label ?? 'use as it is'}) changes nothing: no wall works, the baseline in the chart below.`
            : tl && tl.status === 'computing' ? `Working out the floor's 10-year plan… ${tl.done} / ${tl.total}` : 'Loading the floor’s 10-year plan…'}
        </p>

        {err && <p className="mb-2 rounded border border-critical bg-critical-bg px-2 py-1 text-[11.5px] text-critical">{err}</p>}
        {!ready ? <p className="py-8 text-center text-[12px] text-muted">{mode === 'year' ? 'Laying out the four plans…' : 'Waiting for the 10-year plan…'}</p> : (
          <>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <SystemColumn sys={sysL} tone="#3c8f5f" slots={slots} slotWeeks={slotWeeks} pay={pay} changes={changes} ph={phL} costs={costL} week={week} setWeek={jump} total={totL} other={totR}
                head={(
                  <span className="flex items-center gap-1 text-[10.5px]">
                    <button type="button" aria-pressed={sxMode === 'documented'} onClick={() => setSxMode('documented')} title={smartax('documented').note}
                      className={`rounded border-[1.5px] border-edge px-1.5 ${sxMode === 'documented' ? 'bg-ink text-surface' : 'bg-surface'}`}>as documented (glued)</button>
                    <button type="button" aria-pressed={sxMode === 'claimed'} onClick={() => setSxMode('claimed')} title={smartax('claimed').note}
                      className={`rounded border-[1.5px] border-edge px-1.5 ${sxMode === 'claimed' ? 'bg-[#f5c443]' : 'bg-surface'}`}>as claimed (screwed, reused)</button>
                  </span>
                )} />
              <SystemColumn sys={GYPSUM} tone="#7a8796" slots={slots} slotWeeks={slotWeeks} pay={pay} changes={changes} ph={phR} costs={costR} week={week} setWeek={jump} total={totR} other={totL} />
            </div>
            {mode === 'decade' && <DecadeChart slots={slots} changes={changes} costL={costL} costR={costR} week={week} setWeek={jump} seg1={seg1?.label ?? 'Use as it is'} />}
          </>
        )}
        <details className="mt-2 text-[10.5px] leading-snug text-muted">
          <summary className="cursor-pointer font-mono uppercase tracking-[0.08em]">Where the numbers come from</summary>
          <p className="mt-1"><b className="text-ink-2">Walls:</b> one year — the floor studio's plans for B01 (solid partitions; glazed ones cost the same either way and are left out), {WALL_H} m high (data/studio/costs.json). Ten years — the wall areas taken out and put in at each change of segment 2 (explorer/timeline.py).</p>
          <p className="mt-1"><b className="text-ink-2">Smartax:</b> {sysL.note} Panels taken down whole and not needed straight away are stored and used at the next change.</p>
          <p className="mt-1"><b className="text-ink-2">Gypsum:</b> {GYPSUM.note}</p>
          <p className="mt-1"><b className="text-ink-2">Time and rent:</b> labour hours from the price sheet's unit times (450 SEK/h) for a six-person crew, plus a day to set up (assumption). Lost rent at 3 000 SEK/m²/year on 85 % of the floor (data/district/marievik_market.json, example data). Carbon: A1–A3 for new walls, C1–C4 for what is thrown away.</p>
        </details>
      </div>
    </div>
  )
}

function SystemColumn({ sys, tone, slots, slotWeeks, pay, changes, ph, costs, week, setWeek, total, other, head }: {
  sys: SystemSpec; tone: string; slots: Slot[]; slotWeeks: number; pay: (l: string | null) => StudioPayload | undefined; changes: Change[]; ph: Phases[]; costs: ChangeCost[]
  week: number; setWeek: (w: number) => void; total: ChangeCost; other: ChangeCost; head?: ReactNode
}) {
  // where this floor is: the change under way (or the last one done) and how far through it
  let ci = -1
  changes.forEach((_, i) => { if (week >= ph[i].start) ci = i })
  const ch = ci >= 0 ? changes[ci] : null
  const p = ci >= 0 ? ph[ci] : null
  const closed = !!p && week < p.end
  const stage = !p || week >= p.end ? 'open' : week < p.strip ? 'strip' : week < p.build ? 'build' : 'finish'
  const t = !p || week >= p.end ? 1 : week < p.strip ? ((week - p.start) / Math.max(1e-3, p.strip - p.start)) * 0.35
    : week < p.build ? 0.35 + ((week - p.strip) / Math.max(1e-3, p.build - p.strip)) * 0.5 : 0.85 + ((week - p.build) / Math.max(1e-3, p.end - p.build)) * 0.15
  const slotNow = Math.min(slots.length - 1, Math.floor(week / slotWeeks))
  const slot = ch ? (t < 0.5 ? ch.from : ch.to) : slots[0]
  const shown = ch && ch.diff ? slot : slots[Math.max(0, slotNow)]
  const plan = pay(shown?.layout ?? null)
  const better = (a: number, b: number) => (a < b - 1e-6 ? 'text-good font-bold' : a > b + 1e-6 ? 'text-critical' : '')
  const label = { open: 'Open', strip: 'Closed · stripping out', build: 'Closed · building walls', finish: sys.id === 'gypsum' ? 'Closed · filling, drying, painting' : 'Closed · finishing' }[stage]
  const steady = plan && !(ch && ch.diff && closed) ? wallDiff(plan.walls, plan.walls).kept : null

  return (
    <div className="rounded-lg border-2 border-edge bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-1.5 border-b-2 border-edge px-2.5 py-1.5" style={{ background: `${tone}18` }}>
        <b className="flex items-center gap-1.5 text-[13px]"><i className="inline-block h-3 w-3 rounded-sm border-2 border-edge" style={{ background: tone }} />{sys.label}</b>
        {head}
        <span className={`rounded-[4px] border-[1.5px] border-edge px-1.5 font-mono text-[10.5px] font-bold ${closed ? 'bg-[#f5c443]' : 'bg-good-bg text-good'}`}>{label}</span>
      </div>
      {plan ? (
        <IsoPlan rooms={plan.rooms} steady={steady} kept={ch?.diff?.kept ?? []} removed={ch?.diff?.removed ?? []} added={ch?.diff?.added ?? []} t={steady ? 1 : t} sys={sys} closed={closed} />
      ) : (
        <NoPlan use={shown?.use ?? ''} closed={closed} ch={ch} cost={ci >= 0 ? costs[ci] : null} />
      )}
      <YearStrip slots={slots} slotWeeks={slotWeeks} ph={ph} costs={costs} week={week} setWeek={setWeek} tone={tone} />
      <div className="grid grid-cols-3 gap-x-2 gap-y-1 border-t-2 border-edge px-2.5 py-1.5 text-[11px]">
        <Fig k="Wall works" v={`${fmtK(total.sek)} SEK`} cls={better(total.sek, other.sek)} />
        <Fig k="Carbon" v={`${fmtN(total.kg / 1000, 1)} t CO₂e`} cls={better(total.kg, other.kg)} />
        <Fig k="Waste" v={`${fmtN(total.wasteT, 1)} t`} cls={better(total.wasteT, other.wasteT)} />
        <Fig k="Reused · recovered" v={`${fmtN(total.reusedM2)} · ${fmtN(total.recoveredM2)} m²`} cls={better(-total.reusedM2 - total.recoveredM2, -other.reusedM2 - other.recoveredM2)}
          title={`Panels put back up: ${fmtN(total.reusedM2)} m². Material recovered when walls came down: ${fmtN(total.recoveredM2)} m²${total.storeM2 > 0.5 ? `; ${fmtN(total.storeM2)} m² of panels in store` : ''}.`} />
        <Fig k="Floor closed" v={`${fmtN(total.days / 7, 1)} weeks`} cls={better(total.days, other.days)} />
        <Fig k="Rent lost" v={`${fmtK(total.lostRentSek)} SEK`} cls={better(total.lostRentSek, other.lostRentSek)} />
      </div>
    </div>
  )
}
const Fig = ({ k, v, cls, title }: { k: string; v: string; cls: string; title?: string }) => (
  <div title={title}><span className="block font-mono text-[9.5px] uppercase tracking-[0.06em] text-muted">{k}</span><span className={`font-mono tabular-nums ${cls}`}>{v}</span></div>
)

/** A use with no drawn plan yet (school, housing, hotel): the floor plate with the timeline's wall quantities. */
function NoPlan({ use, closed, ch, cost }: { use: string; closed: boolean; ch: Change | null; cost: ChangeCost | null }) {
  const corners = [iso(0, 0, 0), iso(PLATE_W, 0, 0), iso(PLATE_W, PLATE_H, 0), iso(0, PLATE_H, 0)]
  const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1])
  const vb = [Math.min(...xs) - 2, Math.min(...ys) - 8, Math.max(...xs) - Math.min(...xs) + 4, Math.max(...ys) - Math.min(...ys) + 12]
  const [cx, cy] = iso(PLATE_W / 2, PLATE_H / 2, 0)
  return (
    <svg viewBox={vb.join(' ')} className="block h-[17rem] w-full" role="img" aria-label="The floor, no drawn plan for this use">
      <polygon points={pts(corners)} fill={closed ? '#f3e2a6' : '#e7e2d3'} stroke="#202020" strokeWidth={0.35} strokeDasharray="1.2 0.8" />
      <text x={cx} y={cy - 2} textAnchor="middle" fontSize={3.4} fontWeight={700} fill="#202020">{useLabel(use)}</text>
      <text x={cx} y={cy + 2.5} textAnchor="middle" fontSize={2.2} fill="#47443c">no floor plan drawn for this use yet</text>
      {ch && cost && <text x={cx} y={cy + 6} textAnchor="middle" fontSize={2.2} fill="#47443c">this change: {fmtN(cost.removedM2)} m² out · {fmtN(cost.addedM2)} m² in</text>}
    </svg>
  )
}

/** The time axis (a year of weeks, or ten years): each change's closure — strip-out, new walls, finishing — and the clock. */
function YearStrip({ slots, slotWeeks, ph, costs, week, setWeek, tone }: { slots: Slot[]; slotWeeks: number; ph: Phases[]; costs: ChangeCost[]; week: number; setWeek: (w: number) => void; tone: string }) {
  const total = Math.max(1, slots.length) * slotWeeks
  const X = (w: number) => (w / total) * 100
  return (
    <div className="relative mx-2.5 mb-4 mt-1.5 h-7 cursor-pointer select-none rounded border-[1.5px] border-edge bg-sunken"
      onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setWeek(Math.max(0, Math.min(total, ((e.clientX - r.left) / r.width) * total))) }}>
      {slots.map((_, i) => i > 0 && <i key={i} className="absolute top-0 h-full w-px bg-line-strong" style={{ left: `${X(i * slotWeeks)}%` }} />)}
      {slots.map((s, i) => <span key={s.label + i} className="absolute top-0.5 font-mono text-[8.5px] text-muted" style={{ left: `calc(${X(i * slotWeeks)}% + 2px)` }}>{slots.length > 6 ? s.label.slice(2) : s.label}</span>)}
      {ph.map((p, i) => (
        <span key={i} title={`${fmtN(costs[i].days / 7, 1)} weeks closed`}>
          <i className="absolute bottom-0.5 h-2.5 border-y border-l border-edge" style={{ left: `${X(p.start)}%`, width: `${Math.max(0.3, X(p.strip - p.start))}%`, background: '#5b5f62' }} />
          <i className="absolute bottom-0.5 h-2.5 border-y border-edge" style={{ left: `${X(p.strip)}%`, width: `${X(p.build - p.strip)}%`, background: tone }} />
          <i className="absolute bottom-0.5 h-2.5 border-y border-r border-edge" style={{ left: `${X(p.build)}%`, width: `${X(Math.max(0, p.end - p.build))}%`, background: 'repeating-linear-gradient(45deg,#f5c443 0 3px,#fffdf6 3px 6px)' }} />
        </span>
      ))}
      <i className="absolute -top-0.5 h-[calc(100%+4px)] w-0.5 bg-accent" style={{ left: `${X(week)}%` }} />
      <span className="pointer-events-none absolute -bottom-3.5 right-0 flex gap-2 font-mono text-[8.5px] text-muted">
        <span><i className="mr-0.5 inline-block h-1.5 w-2.5 bg-[#5b5f62] align-middle" />strip-out</span>
        <span><i className="mr-0.5 inline-block h-1.5 w-2.5 align-middle" style={{ background: tone }} />new walls</span>
        <span><i className="mr-0.5 inline-block h-1.5 w-2.5 align-middle" style={{ background: 'repeating-linear-gradient(45deg,#f5c443 0 2px,#fffdf6 2px 4px)' }} />finishing</span>
      </span>
    </div>
  )
}

/** Ten years, cumulative: what changing the floor costs (wall works + rent lost while closed) and emits, with
 *  Smartax, with gypsum, and segment 1 — the use as it is, no wall works — as the baseline. */
export function DecadeChart({ slots, changes, costL, costR, week, setWeek, seg1 }: {
  slots: { label: string }[]; changes: { i: number }[]; costL: ChangeCost[]; costR: ChangeCost[]; week: number; setWeek: (w: number) => void; seg1: string
}) {
  const n = slots.length
  const cum = (cs: ChangeCost[], f: (c: ChangeCost) => number) => slots.map((_, i) => cs.reduce((a, c, k) => a + (changes[k].i <= i ? f(c) : 0), 0))
  const charts = [
    { title: 'Cost of changing: wall works + rent lost', unit: 'MSEK', f: (c: ChangeCost) => (c.sek + c.lostRentSek) / 1e6, d: 2 },
    { title: 'Carbon of the wall works', unit: 't CO₂e', f: (c: ChangeCost) => c.kg / 1000, d: 1 },
  ]
  const W = 620, H = 92
  return (
    <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
      {charts.map((ch) => {
        const L = cum(costL, ch.f), R = cum(costR, ch.f)
        const max = Math.max(1e-6, ...L, ...R) * 1.12
        const x = (i: number) => 26 + (i / Math.max(1, n - 1)) * (W - 32)
        const y = (v: number) => H - 6 - (v / max) * (H - 14)
        const path = (v: number[]) => v.map((p, i) => (i ? `L${x(i).toFixed(1)},${y(v[i - 1]).toFixed(1)}L${x(i).toFixed(1)},${y(p).toFixed(1)}` : `M${x(0)},${y(p).toFixed(1)}`)).join('')
        const yr = Math.min(n - 1, week / 52)
        return (
          <div key={ch.title} className="rounded-lg border-2 border-edge bg-surface px-2.5 py-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <b className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-2">{ch.title}, cumulative</b>
              <span className="font-mono text-[10px] text-muted">{ch.unit}</span>
            </div>
            <svg viewBox={`0 0 ${W} ${H + 10}`} className="block w-full cursor-pointer" onClick={(e) => {
              const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
              const i = Math.round((((e.clientX - r.left) / r.width) * W - 26) / (W - 32) * (n - 1))
              setWeek(Math.max(0, Math.min(n - 1, i)) * 52)
            }}>
              {[0, 0.5, 1].map((k) => (
                <g key={k}>
                  <line x1={26} x2={W - 6} y1={y(max * k / 1.12)} y2={y(max * k / 1.12)} stroke="var(--color-line)" strokeWidth={0.7} />
                  <text x={22} y={y(max * k / 1.12) + 2.5} fontSize={7} textAnchor="end" fill="var(--color-muted)" fontFamily="var(--font-mono)">{fmtN(max * k / 1.12, ch.d)}</text>
                </g>
              ))}
              {slots.map((s, i) => <text key={i} x={x(i)} y={H + 8} fontSize={7} textAnchor="middle" fill="var(--color-muted)" fontFamily="var(--font-mono)">{s.label.slice(2)}</text>)}
              <path d={`M${x(0)},${y(0)}L${x(n - 1)},${y(0)}`} stroke="#202020" strokeWidth={1.2} strokeDasharray="3 2" fill="none" />
              <path d={path(R)} stroke="#7a8796" strokeWidth={2.2} fill="none" />
              <path d={path(L)} stroke="#3c8f5f" strokeWidth={2.2} fill="none" />
              {changes.map((c, k) => <circle key={k} cx={x(c.i)} cy={H - 6} r={2.2} fill="#f5c443" stroke="#202020" strokeWidth={0.8} />)}
              <line x1={x(yr)} x2={x(yr)} y1={4} y2={H - 6} stroke="var(--color-accent)" strokeWidth={1.5} />
            </svg>
            <div className="flex flex-wrap gap-x-3 font-mono text-[9.5px] text-ink-2">
              <span><i className="mr-1 inline-block h-0.5 w-3 bg-[#3c8f5f] align-middle" />Smartax {fmtN(L[n - 1], ch.d)}</span>
              <span><i className="mr-1 inline-block h-0.5 w-3 bg-[#7a8796] align-middle" />Gypsum {fmtN(R[n - 1], ch.d)}</span>
              <span><i className="mr-1 inline-block h-0 w-3 border-t border-dashed border-[#202020] align-middle" />Segment 1, {seg1.toLowerCase()}: no wall works</span>
              <span><i className="mr-1 inline-block h-2 w-2 rounded-full border border-edge bg-[#f5c443] align-middle" />change of use</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ------------------------------------------------------------------ the floor drawn in isometric view (SVG)
function IsoPlan(props: Omit<FloorLayerProps, 'zBase'>) {
  const corners = [iso(0, 0, 0), iso(PLATE_W, 0, 0), iso(PLATE_W, PLATE_H, 0), iso(0, PLATE_H, 0)]
  const xs = corners.map((c) => c[0]), ys = [...corners.map((c) => c[1]), iso(0, 0, HZ + 3)[1]]
  const vb = [Math.min(...xs) - 2, Math.min(...ys) - 2, Math.max(...xs) - Math.min(...xs) + 4, Math.max(...ys) - Math.min(...ys) + 4]
  return (
    <svg viewBox={vb.join(' ')} className="block h-[17rem] w-full" role="img" aria-label="The floor in isometric view">
      <FloorLayer {...props} zBase={0} />
    </svg>
  )
}
