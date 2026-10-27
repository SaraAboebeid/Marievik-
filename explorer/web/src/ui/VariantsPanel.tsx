import { useState } from 'react'
import { Badge, Card } from './kit'
import type { VariantRow, Variants } from '../studio/engine'

// the KPIs a plan is scored on: key, label, shown as a share (×100 %), +1 more is better / -1 less is better
const KPIS: [string, string, boolean, number][] = [
  ['staff', 'People on the floor', false, 1], ['desks', 'Desks', false, 1], ['m2PerDesk', 'm² per desk', false, -1],
  ['daylitDesks', 'Desks with daylight', true, 1], ['meetSeatsPer10', 'Meeting seats per 10 people', false, 1],
  ['focusRooms', 'Focus rooms', false, 1], ['escapeWorst', 'Longest escape walk (m)', false, -1],
  ['deskUseAtPeak', 'Desks in use at the peak', true, 1], ['shortDays', 'Days short of desks', true, -1],
  ['meetDenied', 'Meetings without a room', true, -1], ['focusDenied', 'Focus requests refused', true, -1],
  ['lunchCrowding', 'Lunch: people per pantry seat', false, -1], ['wcWaitP90', 'WC wait, 9 in 10 under (min)', false, -1],
  ['walkPerDay', 'Walking per person per day (m)', false, -1],
]
const DEF = Object.fromEntries(KPIS.map((k) => [k[0], k]))

const fmt = (key: string, v: number | null | undefined) => {
  if (v === null || v === undefined) return '–'
  return DEF[key]?.[2] ? `${Math.round(v * 100)} %` : Number.isInteger(v) ? String(v) : v.toFixed(1)
}
const short = (r: VariantRow) => (r.generated ? r.id.replace('gen-', '#') : r.name.replace(/ \(as drawn\)/, ''))

function ticks(lo: number, hi: number) {
  const span = hi - lo || 1, step0 = span / 4, mag = 10 ** Math.floor(Math.log10(step0))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0
  const out = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6))
  return out
}

/** The trade-off scatter: every plan that passes, the front marked, the drawn layouts as squares. Click opens a plan. */
function Scatter({ rows, x, y, current, onOpen }: { rows: VariantRow[]; x: string; y: string; current: string; onOpen: (id: string) => void }) {
  const W = 300, H = 210, l = 34, r = 8, t = 8, b = 26
  const pts = rows.filter((p) => p.kpi[x] != null && p.kpi[y] != null)
  if (!pts.length) return null
  const ext = (k: string) => {
    const vs = pts.map((p) => p.kpi[k] as number), lo = Math.min(...vs), hi = Math.max(...vs), pad = (hi - lo) * 0.06 || 1
    return [lo - pad, hi + pad]
  }
  const [x0, x1] = ext(x), [y0, y1] = ext(y)
  const sx = (v: number) => l + ((v - x0) / (x1 - x0)) * (W - l - r)
  const sy = (v: number) => H - b - ((v - y0) / (y1 - y0)) * (H - t - b)
  const scale = (k: string) => (DEF[k]?.[2] ? 100 : 1)
  // draw the front last so it sits on top, and the plan on show above everything
  const order = [...pts].sort((a, c) => Number(!!a.pareto) - Number(!!c.pareto) + (a.id === current ? 1 : 0) - (c.id === current ? 1 : 0))
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full select-none" role="img" aria-label="Generated plans: trade-off between the two chosen KPIs">
      {ticks(x0, x1).map((v) => (
        <g key={`x${v}`}>
          <line x1={sx(v)} x2={sx(v)} y1={t} y2={H - b} stroke="var(--color-line)" strokeWidth={0.6} />
          <text x={sx(v)} y={H - b + 10} textAnchor="middle" fontSize={8} fill="var(--color-muted)">{+(v * scale(x)).toFixed(1)}</text>
        </g>
      ))}
      {ticks(y0, y1).map((v) => (
        <g key={`y${v}`}>
          <line x1={l} x2={W - r} y1={sy(v)} y2={sy(v)} stroke="var(--color-line)" strokeWidth={0.6} />
          <text x={l - 3} y={sy(v) + 3} textAnchor="end" fontSize={8} fill="var(--color-muted)">{+(v * scale(y)).toFixed(1)}</text>
        </g>
      ))}
      <text x={W - r} y={H - 3} textAnchor="end" fontSize={8.5} fill="var(--color-ink-2)">{DEF[x][1]} →</text>
      <text x={l + 2} y={t + 8} fontSize={8.5} fill="var(--color-ink-2)">↑ {DEF[y][1]}</text>
      {order.map((p) => {
        const cx = sx(p.kpi[x] as number), cy = sy(p.kpi[y] as number), on = p.id === current
        const tip = `${p.name}: ${DEF[x][1]} ${fmt(x, p.kpi[x])}, ${DEF[y][1]} ${fmt(y, p.kpi[y])}${p.pareto ? ' · on the trade-off front' : ''}`
        return (
          <g key={p.id} className="cursor-pointer" onClick={() => onOpen(p.id)}>
            <title>{tip}</title>
            {p.generated ? (
              <circle cx={cx} cy={cy} r={on ? 5 : p.pareto ? 3.2 : 2.2}
                fill={p.pareto ? 'var(--color-accent)' : 'var(--color-muted)'} fillOpacity={p.pareto ? 0.9 : 0.35}
                stroke={on ? 'var(--color-coral)' : 'none'} strokeWidth={2.5} />
            ) : (
              <>
                <rect x={cx - 3.5} y={cy - 3.5} width={7} height={7} fill="var(--color-raised)" stroke={on ? 'var(--color-coral)' : 'var(--color-ink)'} strokeWidth={on ? 2.5 : 1.2} />
                <text x={cx + 5} y={cy + 3} fontSize={7.5} fill="var(--color-ink)">{short(p)}</text>
              </>
            )}
          </g>
        )
      })}
    </svg>
  )
}

/** One button: generate plans inside this floor's fixed envelope, check each one and run simulated working days
 *  on the ones that pass. Then the best few (click to open one here) and, folded away, the trade-off curve. */
export function GeneratePlans({ data, busy, error, onGenerate, current, onOpen, ground }: {
  data: Variants | null; busy: boolean; error: string | null; onGenerate: (n: number) => void; current: string; onOpen: (id: string) => void
  ground: boolean
}) {
  const [curve, setCurve] = useState(false)
  if (ground) return (
    <Card title="Generate plans">
      <p className="text-[12px] leading-snug text-ink-2">The generator lays out the upper floors so far — open floor 1 to 6 to generate plans there.</p>
    </Card>
  )
  const ok = data ? data.rows.filter((r) => r.valid) : []
  const top = ok.filter((r) => r.generated && r.pareto).sort((a, c) => (c.kpi.staff ?? 0) - (a.kpi.staff ?? 0)).slice(0, 5)
  return (
    <Card title="Generate plans" right={<Badge tone="warn">{busy ? 'generating…' : 'uncalibrated'}</Badge>}>
      <button type="button" onClick={() => onGenerate(300)} disabled={busy}
        className="w-full rounded-md border-2 border-edge bg-coral px-3 py-1.5 text-[13px] font-semibold text-[#202020] shadow-[3px_3px_0_var(--color-edge)] disabled:opacity-50">
        {busy ? 'Generating…' : data ? 'Generate again' : 'Generate 300 plans'}
      </button>
      {error && <p className="mt-2 text-[12px] text-serious">{error}</p>}
      {data && (
        <>
          <p className="mt-2 text-[12px] text-ink"><b>{data.meta.valid}</b> of {data.meta.n} pass every check · <b>{data.meta.front}</b> on the trade-off front</p>
          <table className="mt-1.5 w-full text-[11.5px]">
            <thead>
              <tr className="text-left font-mono text-[10px] uppercase text-muted">
                <th className="pb-1">Plan</th><th className="pb-1 text-right">People</th><th className="pb-1 text-right">Daylit</th><th className="pb-1 text-right">No room</th>
              </tr>
            </thead>
            <tbody>
              {top.map((r) => (
                <tr key={r.id} onClick={() => onOpen(r.id)} title="Open this plan on the floor"
                  className={`cursor-pointer border-t border-line hover:bg-sunken ${r.id === current ? 'font-semibold' : ''}`}>
                  <td className="py-0.5">{short(r)}</td>
                  <td className="text-right tabular-nums">{fmt('staff', r.kpi.staff)}</td>
                  <td className="text-right tabular-nums">{fmt('daylitDesks', r.kpi.daylitDesks)}</td>
                  <td className="text-right tabular-nums">{fmt('meetDenied', r.kpi.meetDenied)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" onClick={() => setCurve((c) => !c)} className="mt-2 text-[12px] font-medium text-ink underline-offset-2 hover:underline">
            {curve ? 'Hide the trade-off curve' : 'Show the trade-off curve'}
          </button>
          {curve && <Scatter rows={ok} x="staff" y="meetDenied" current={current} onOpen={onOpen} />}
        </>
      )}
    </Card>
  )
}
