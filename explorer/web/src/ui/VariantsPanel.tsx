import { useState } from 'react'
import { Badge, Section, Select } from './kit'
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
const WHY: Record<string, string> = {
  wc: 'too few WCs', escape: 'escape walk too long', exit: 'a stair overloaded', reach: 'seats cannot be reached',
  load: 'over the legal maximum', accessible_wc: 'no accessible WC', door: 'a room without a door', desks: 'no desks',
}
const SIZES: [string, string][] = [['100', '100 plans'], ['300', '300 plans'], ['500', '500 plans']]

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

/** Floor plans generated within B01's fixed envelope, each checked and run through simulated working days. */
export function VariantsPanel({ data, busy, error, onGenerate, current, onOpen, ground }: {
  data: Variants | null; busy: boolean; error: string | null; onGenerate: (n: number) => void; current: string; onOpen: (id: string) => void
  ground: boolean
}) {
  const [n, setN] = useState('300')
  const [x, setX] = useState('staff')
  const [y, setY] = useState('meetDenied')
  const [sortKey, setSortKey] = useState('staff')
  const ok = data ? data.rows.filter((r) => r.valid) : []
  const front = ok.filter((r) => r.generated && r.pareto)
  const dir = DEF[sortKey]?.[3] ?? 1
  const list = [...front].sort((a, c) => dir * ((c.kpi[sortKey] ?? 0) - (a.kpi[sortKey] ?? 0))).slice(0, 12)
  const shown = data?.rows.find((r) => r.id === current)
  const opts = KPIS.map(([k, label]) => [k, label] as [string, string])
  if (ground) return (
    <Section id="studio-variants" title="Generated plans">
      <p className="text-[12px] leading-snug text-ink-2">
        The plan generator lays out the upper floors so far. Open floor 1 to 6 to generate plans there; the ground floor, with its entrance, loading and service rooms, comes later.
      </p>
    </Section>
  )
  return (
    <Section id="studio-variants" title="Generated plans" right={<Badge tone="warn">{busy ? 'generating…' : 'uncalibrated'}</Badge>}>
      <p className="mb-2 text-[12px] leading-snug text-ink-2">
        Random plans inside this floor's fixed envelope: cores, atrium, stairs and WC blocks stay; rooms go along the façades and beside the cores, the rest is open plan.
        Each plan gets the same safety and standards checks as a drawn layout, and the ones that pass get simulated working days. Click a plan to open it here.
      </p>
      <div className="mb-2 flex items-center gap-1.5">
        <div className="w-32"><Select value={n} onChange={setN} options={SIZES} disabled={busy} /></div>
        <button type="button" onClick={() => onGenerate(+n)} disabled={busy}
          className="rounded-md border-2 border-edge bg-coral px-2.5 py-1 text-[12.5px] font-semibold text-[#202020] disabled:opacity-50">
          {busy ? 'Generating…' : data ? 'Generate again' : 'Generate plans'}
        </button>
      </div>
      {error && <p className="mb-2 text-[12px] text-serious">{error}</p>}
      {data && (
        <>
          <p className="mb-1.5 text-[12px] text-ink">
            <b>{data.meta.n}</b> plans in {data.meta.seconds} s: <b>{data.meta.valid}</b> pass every check, <b>{data.meta.front}</b> are on the trade-off front
            (no other plan is better on people, daylight, meeting rooms, focus rooms and walking all at once).
          </p>
          {Object.keys(data.meta.rejected).length > 0 && (
            <p className="mb-2 text-[11.5px] text-muted">
              Rejected for: {Object.entries(data.meta.rejected).map(([k, v]) => `${WHY[k] ?? k} (${v})`).join(', ')}. A plan can fail more than one check.
            </p>
          )}
          <div className="mb-1 grid grid-cols-2 gap-1.5 text-[11px] text-ink-2">
            <label><span className="mb-0.5 block">Across</span><Select value={x} onChange={setX} options={opts} /></label>
            <label><span className="mb-0.5 block">Up</span><Select value={y} onChange={setY} options={opts} /></label>
          </div>
          <Scatter rows={ok} x={x} y={y} current={current} onOpen={onOpen} />
          <p className="mb-2.5 flex flex-wrap gap-x-3 text-[11px] text-muted">
            <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-accent align-middle" />on the front</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-muted/40 align-middle" />passes</span>
            <span><span className="mr-1 inline-block h-2 w-2 border border-ink align-middle" />drawn layouts</span>
          </p>
          {shown && (
            <div className="mb-2.5 rounded-md border-2 border-line bg-sunken px-2.5 py-1.5 text-[12px]">
              <b>On show: {shown.name}</b>{shown.pareto ? ' · on the trade-off front' : ''}
              <div className="mt-1 grid grid-cols-2 gap-x-3 text-[11.5px] text-ink-2">
                {['staff', 'daylitDesks', 'meetDenied', 'focusDenied', 'walkPerDay', 'lunchCrowding'].map((k) => (
                  <span key={k} className="flex justify-between gap-2"><span className="truncate">{DEF[k][1]}</span><span className="tabular-nums text-ink">{fmt(k, shown.kpi[k])}</span></span>
                ))}
              </div>
            </div>
          )}
          <label className="mb-1 block text-[11px] text-ink-2">
            <span className="mb-0.5 block">The front, best first by</span>
            <Select value={sortKey} onChange={setSortKey} options={opts} />
          </label>
          <table className="w-full text-[11.5px]">
            <thead>
              <tr className="text-left font-mono text-[10px] uppercase text-muted">
                <th className="pb-1">Plan</th><th className="pb-1 text-right">People</th><th className="pb-1 text-right">Daylit</th>
                <th className="pb-1 text-right">No room</th><th className="pb-1 text-right">{sortKey === 'staff' ? 'Walk m' : 'Sorted by'}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id} onClick={() => onOpen(r.id)} title="Open this plan on the floor"
                  className={`cursor-pointer border-t border-line hover:bg-sunken ${r.id === current ? 'font-semibold' : ''}`}>
                  <td className="py-0.5">{short(r)}</td>
                  <td className="text-right tabular-nums">{fmt('staff', r.kpi.staff)}</td>
                  <td className="text-right tabular-nums">{fmt('daylitDesks', r.kpi.daylitDesks)}</td>
                  <td className="text-right tabular-nums">{fmt('meetDenied', r.kpi.meetDenied)}</td>
                  <td className="text-right tabular-nums">{sortKey === 'staff' ? fmt('walkPerDay', r.kpi.walkPerDay) : fmt(sortKey, r.kpi[sortKey])}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] leading-snug text-muted">
            Daylight counts desks within 6 m of the façade or 4.5 m of the atrium. Occupancy rates are assumptions until there is sensor and booking data, so compare plans with each other rather than reading the numbers as forecasts.
          </p>
        </>
      )}
    </Section>
  )
}
