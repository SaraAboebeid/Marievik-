import { useEffect, useMemo, useRef, useState } from 'react'
import { LEASE_STEPS, eventsIn, quarterLabel, rentedShare, stepTime, type Lease, type LeaseBook } from '../leases'

const KIND = {
  in: { label: 'Moves in', dot: 'bg-[#e08a1e]' },
  renew: { label: 'Renews', dot: 'bg-accent' },
  out: { label: 'Moves out', dot: 'bg-[#1f2836]' },
} as const
const term = (l: Lease) => `${quarterLabel(l.start)} – ${quarterLabel(l.end)}`

/** The rented / vacant tour's clock: ten years of leases, quarter by quarter, with play. The chart is the share
 *  of lettable area rented (the whole site, or the building in focus); the dots under it are lease events. */
export function LeaseTimeline({ book, buildings, focus, step, setStep, playing, setPlaying }: {
  book: LeaseBook; buildings: string[]; focus: string | null
  step: number; setStep: (q: number) => void; playing: boolean; setPlaying: (p: boolean) => void
}) {
  const ids = focus ? [focus] : buildings
  // share of the area rented each quarter, weighted by building (equal weights: lettable areas aren't in the book yet)
  const series = useMemo(() => Array.from({ length: LEASE_STEPS + 1 }, (_, q) => {
    const r = rentedShare(book, stepTime(q))
    return ids.reduce((a, id) => a + (r[id] ?? 0), 0) / Math.max(1, ids.length)
  }), [book, ids.join(',')])
  const events = useMemo(() => Array.from({ length: LEASE_STEPS + 1 }, (_, q) => eventsIn(book, stepTime(q), ids)), [book, ids.join(',')])

  // the table behind the chart: one row per lease event (move-in, renewal, move-out), in time order
  const [showTable, setShowTable] = useState(false)
  const rows = useMemo(() => {
    const space = new Map(book.spaces.map((s) => [s.id, s]))
    const out: { q: number; kind: 'in' | 'renew' | 'out'; lease: Lease; building: string; name: string; share: number; after: number }[] = []
    events.forEach((e, q) => {
      const r = rentedShare(book, stepTime(q))
      const add = (kind: 'in' | 'renew' | 'out', ls: Lease[]) => ls.forEach((l) => {
        const s = space.get(l.space)!
        out.push({ q, kind, lease: l, building: s.building, name: s.name, share: s.share, after: r[s.building] ?? 0 })
      })
      add('out', e.moveOuts); add('renew', e.renewed); add('in', e.newLets)
    })
    return out
  }, [book, events])
  const tableRef = useRef<HTMLDivElement>(null)
  useEffect(() => {   // keep the current quarter's rows in view as the timeline plays
    if (!showTable) return
    tableRef.current?.querySelector('[data-now="1"]')?.scrollIntoView({ block: 'nearest' })
  }, [step, showTable])

  const latest = useRef(step)
  latest.current = step
  useEffect(() => {
    if (!playing) return
    const id = window.setInterval(() => {
      if (latest.current >= LEASE_STEPS) { setPlaying(false); return }
      setStep(latest.current + 1)
    }, 900)
    return () => window.clearInterval(id)
  }, [playing, setStep, setPlaying])

  // the chart is drawn at its real width (the strip spans the screen), so text and dots keep their size
  const box = useRef<HTMLDivElement>(null)
  const [W, setW] = useState(900)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(300, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const H = 64, lo = 0.6
  const x = (q: number) => (q / LEASE_STEPS) * W
  const y = (v: number) => H - ((Math.max(lo, v) - lo) / (1 - lo)) * (H - 10)
  const line = series.map((v, q) => `${q ? 'L' : 'M'}${x(q).toFixed(1)},${y(v).toFixed(1)}`).join('')
  const ev = events[step]
  const now = series[step]
  const play = () => {
    if (playing) return setPlaying(false)
    if (step >= LEASE_STEPS) setStep(0)
    setPlaying(true)
  }
  const list = (ls: { tenant: string; space: string }[]) => ls.slice(0, 3).map((l) => `${l.tenant} (${l.space.replace('-S', ' · ')})`).join(', ') + (ls.length > 3 ? ` +${ls.length - 3}` : '')

  return (
    <div className="pointer-events-auto w-full rounded-xl border-2 border-edge bg-raised shadow-[3px_3px_0_var(--color-edge)]">
      <div className="checker-band flex items-center justify-between gap-2 px-3.5 pb-2.5 pt-1.5">
        <h4 className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em]">Leases · {focus ?? 'all buildings'} · 10 years</h4>
        <span className="flex items-center gap-1.5">
          <button type="button" onClick={() => setShowTable((s) => !s)} aria-pressed={showTable}
            title={showTable ? 'Hide the lease table' : 'Show the lease events behind the chart as a table'}
            className={`rounded-[4px] border-2 border-edge px-1.5 font-mono text-[11px] font-bold ${showTable ? 'bg-ink text-surface' : 'bg-surface text-ink hover:bg-sunken'}`}>
            ▦ table
          </button>
          <span className="rounded-[4px] border-2 border-edge bg-surface px-1.5 font-mono text-[12px] font-bold">{quarterLabel(stepTime(step))}</span>
        </span>
      </div>
      <div className="px-3.5 py-2.5">
        <div className="mb-1.5 flex items-center gap-2">
          <button type="button" onClick={play} aria-pressed={playing} title={playing ? 'Pause' : 'Play the ten years'}
            className={`rounded-md border-2 border-edge px-2 py-0.5 font-mono text-[11px] font-bold shadow-[2px_2px_0_var(--color-edge)] ${playing ? 'bg-accent text-white' : 'bg-coral text-[#202020]'}`}>
            {playing ? '❚❚ pause' : '▶ play'}
          </button>
          <input type="range" min={0} max={LEASE_STEPS} step={1} value={step} aria-label="Quarter"
            onChange={(e) => { setPlaying(false); setStep(Number(e.target.value)) }} className="h-1.5 flex-1 accent-[color:var(--color-accent)]" />
          <span className="w-[4.2rem] text-right font-mono text-[15px] font-bold tabular-nums">{Math.round(now * 100)} %</span>
        </div>
        <div ref={box}>
        <svg viewBox={`0 0 ${W} ${H + 18}`} width={W} height={H + 18} className="block cursor-pointer" role="img" aria-label="Share of lettable area rented, quarter by quarter"
          onClick={(e) => {
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
            setPlaying(false)
            setStep(Math.max(0, Math.min(LEASE_STEPS, Math.round(((e.clientX - r.left) / r.width) * LEASE_STEPS))))
          }}>
          {[0.7, 0.8, 0.9, 1].map((v) => (
            <g key={v}>
              <line x1={0} x2={W} y1={y(v)} y2={y(v)} stroke="var(--color-line)" strokeWidth={0.8} />
              <text x={2} y={y(v) - 1.5} fontSize={7.5} fill="var(--color-muted)" fontFamily="var(--font-mono)">{Math.round(v * 100)} %</text>
            </g>
          ))}
          <path d={`${line}L${W},${H}L0,${H}Z`} fill="#ffc45e" opacity={0.35} />
          <path d={line} fill="none" stroke="#202020" strokeWidth={1.6} />
          {Array.from({ length: LEASE_YEARS_LABELS }, (_, i) => (
            <text key={i} x={x(i * 4 + 1)} y={H + 16} fontSize={8} textAnchor="middle" fill="var(--color-muted)" fontFamily="var(--font-mono)">{Math.floor(stepTime(i * 4 + 1))}</text>
          ))}
          {events.map((e, q) => (
            <g key={q}>
              {e.moveOuts.length > 0 && <circle cx={x(q)} cy={H + 5} r={3.4} fill="#1f2836" stroke="#fffdf6" strokeWidth={1} />}
              {e.newLets.length > 0 && <circle cx={x(q)} cy={H - 3} r={3.4} fill="#e08a1e" stroke="#202020" strokeWidth={1} />}
            </g>
          ))}
          <line x1={x(step)} x2={x(step)} y1={0} y2={H} stroke="var(--color-accent)" strokeWidth={2} />
          <circle cx={x(step)} cy={y(now)} r={3.5} fill="var(--color-coral)" stroke="#202020" strokeWidth={1.4} />
        </svg>
        </div>
        <div className="mt-1.5 grid grid-cols-3 gap-1.5 text-[11px] leading-snug">
          <div className="rounded-md border-[1.5px] border-edge bg-surface px-2 py-1">
            <b className="block font-mono text-[10px] uppercase tracking-[0.06em] text-ink-2">Moving out</b>
            {ev.moveOuts.length ? <span className="text-ink">{list(ev.moveOuts)}</span> : <span className="text-muted">none this quarter</span>}
          </div>
          <div className="rounded-md border-[1.5px] border-edge bg-surface px-2 py-1">
            <b className="block font-mono text-[10px] uppercase tracking-[0.06em] text-ink-2">Renewed</b>
            {ev.renewed.length ? <span className="text-ink">{list(ev.renewed)}</span> : <span className="text-muted">none</span>}
          </div>
          <div className="rounded-md border-[1.5px] border-edge bg-surface px-2 py-1">
            <b className="block font-mono text-[10px] uppercase tracking-[0.06em] text-ink-2">New lettings</b>
            {ev.newLets.length ? <span className="text-ink">{list(ev.newLets)}</span> : <span className="text-muted">none</span>}
          </div>
        </div>
        {showTable && (
          <div ref={tableRef} className="mt-2 max-h-[13rem] overflow-y-auto rounded-md border-[1.5px] border-edge bg-surface">
            <table className="w-full border-collapse text-left text-[11.5px] tabular-nums">
              <thead className="sticky top-0 bg-sunken font-mono text-[9.5px] uppercase tracking-[0.06em] text-ink-2">
                <tr>
                  {['Quarter', 'Event', 'Building', 'Space', 'Tenant', 'Lease', 'Share of building', 'Building rented after'].map((h) => (
                    <th key={h} className="border-b-[1.5px] border-edge px-2 py-1 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} data-now={r.q === step ? 1 : undefined} onClick={() => { setPlaying(false); setStep(r.q) }}
                    className={`cursor-pointer border-t border-line ${r.q === step ? 'bg-coral/35 font-semibold' : r.q < step ? 'text-ink-2' : ''} hover:bg-sunken`}>
                    <td className="whitespace-nowrap px-2 py-0.5 font-mono">{quarterLabel(stepTime(r.q))}</td>
                    <td className="whitespace-nowrap px-2 py-0.5"><i className={`mr-1.5 inline-block h-2 w-2 rounded-full ${KIND[r.kind].dot}`} />{KIND[r.kind].label}</td>
                    <td className="px-2 py-0.5 font-mono">{r.building}</td>
                    <td className="whitespace-nowrap px-2 py-0.5">{r.name}</td>
                    <td className="whitespace-nowrap px-2 py-0.5">{r.lease.tenant}</td>
                    <td className="whitespace-nowrap px-2 py-0.5 font-mono text-[10.5px]">{term(r.lease)}</td>
                    <td className="px-2 py-0.5 font-mono">{Math.round(r.share * 100)} %</td>
                    <td className="px-2 py-0.5 font-mono">{Math.round(r.after * 100)} %</td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={8} className="px-2 py-2 text-muted">No lease events in these ten years.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-1.5 flex items-center gap-3 text-[10.5px] text-ink-2">
          <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-4 rounded-[2px] border border-edge bg-[#ffc45e]" />lit: rented</span>
          <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-4 rounded-[2px] border border-edge bg-[#1f2836]" />dark: vacant</span>
          <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-full border border-edge bg-[#e08a1e]" />new letting</span>
          <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-full bg-[#1f2836]" />move-out</span>
        </div>
      </div>
    </div>
  )
}
const LEASE_YEARS_LABELS = 10
