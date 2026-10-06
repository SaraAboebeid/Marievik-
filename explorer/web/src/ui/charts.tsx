import { useMemo, useState } from 'react'
import { DF_BINS } from '../viewer/colors'

const W = 330
const H = 150
const PAD = { l: 30, r: 8, t: 10, b: 20 }

/** Hottest week: operative temperature against outdoor air and the EN 16798-1 category II band. */
export function HotWeekChart({ data }: {
  data: { start_day: number; op: number[]; out: number[]; upper: number[]; lower: number[] }
}) {
  const [hover, setHover] = useState<number | null>(null)
  const n = data.op.length
  const all = [...data.op, ...data.out, ...data.upper, ...data.lower]
  const lo = Math.floor(Math.min(...all) / 5) * 5
  const hi = Math.ceil(Math.max(...all) / 5) * 5
  const x = (i: number) => PAD.l + (i / (n - 1)) * (W - PAD.l - PAD.r)
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b)
  const path = (vs: number[]) => vs.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')
  const band = useMemo(() => {
    const top = data.upper.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')
    const bot = data.lower.map((_, j) => {
      const i = n - 1 - j
      return `L${x(i).toFixed(1)},${y(data.lower[i]).toFixed(1)}`
    }).join('')
    return top + bot + 'Z'
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])
  const ticks = []
  for (let v = lo; v <= hi; v += 5) ticks.push(v)
  const date = (d: number) => new Date(Date.UTC(2025, 0, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Operative temperature in the hottest week"
        onPointerMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
          const px = ((e.clientX - r.left) / r.width) * W
          const i = Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (n - 1))
          setHover(i >= 0 && i < n ? i : null)
        }}
        onPointerLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth={1} />
            <text x={PAD.l - 4} y={y(t) + 3} textAnchor="end" className="fill-[var(--color-muted)] font-mono text-[8.5px]">{t}°</text>
          </g>
        ))}
        {[0, 1, 2, 3, 4, 5, 6].map((d) => (
          <text key={d} x={x(d * 24 + 12)} y={H - 6} textAnchor="middle" className="fill-[var(--color-muted)] font-mono text-[8.5px]">
            {date(data.start_day + d)}
          </text>
        ))}
        <path d={band} fill="var(--color-good)" opacity={0.14} />
        <path d={path(data.out)} fill="none" stroke="var(--color-muted)" strokeWidth={1.5} strokeDasharray="3 2" />
        <path d={path(data.op)} fill="none" stroke="var(--color-c2)" strokeWidth={2} />
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="var(--color-ink-2)" strokeWidth={1} />
            <circle cx={x(hover)} cy={y(data.op[hover])} r={4} fill="var(--color-c2)" stroke="var(--color-raised)" strokeWidth={2} />
          </g>
        )}
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-ink-2">
        <span className="flex items-center gap-1"><span className="h-0.5 w-3 bg-[var(--color-c2)]" />Operative, unit</span>
        <span className="flex items-center gap-1"><span className="h-0 w-3 border-t border-dashed border-[var(--color-muted)]" />Outdoor air</span>
        <span className="flex items-center gap-1"><span className="h-2 w-3 bg-[var(--color-good)] opacity-30" />Cat. II band</span>
      </div>
      {hover !== null && (
        <div className="pointer-events-none absolute right-1 top-0 rounded border border-line bg-raised px-2 py-1 font-mono text-[10.5px] shadow-sm">
          {date(data.start_day + Math.floor(hover / 24))} {String(hover % 24).padStart(2, '0')}:00 · unit {data.op[hover].toFixed(1)}° · out {data.out[hover].toFixed(1)}° · band {data.lower[hover].toFixed(1)}–{data.upper[hover].toFixed(1)}°
        </div>
      )}
    </div>
  )
}

/** Share of sensor points per daylight-factor bin. */
export function DfHistogram({ values }: { values: number[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const counts = DF_BINS.map((b, i) => values.filter((v) => v >= (i ? DF_BINS[i - 1].max : -Infinity) && v < b.max).length)
  const total = Math.max(1, values.length)
  const max = Math.max(...counts, 1)
  const bw = (W - PAD.l - PAD.r) / counts.length
  const h = 90
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${h + 22}`} className="w-full" role="img" aria-label="Distribution of daylight factor">
        <line x1={PAD.l} x2={W - PAD.r} y1={h} y2={h} stroke="var(--color-line-strong)" />
        {counts.map((c, i) => {
          const bh = (c / max) * (h - 12)
          return (
            <g key={i} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
              <rect x={PAD.l + i * bw} y={0} width={bw} height={h} fill="transparent" />
              <path d={`M${PAD.l + i * bw + 1},${h} v${-Math.max(0, bh - 4)} q0,-4 4,-4 h${bw - 10} q4,0 4,4 v${Math.max(0, bh - 4)} z`}
                fill={DF_BINS[i].color} opacity={hover === null || hover === i ? 1 : 0.55} />
              <text x={PAD.l + i * bw + bw / 2} y={h + 12} textAnchor="middle" className="fill-[var(--color-muted)] font-mono text-[8.5px]">{DF_BINS[i].label}</text>
            </g>
          )
        })}
        <text x={W - PAD.r} y={h + 21} textAnchor="end" className="fill-[var(--color-muted)] font-mono text-[8px]">DF %</text>
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute right-1 top-0 rounded border border-line bg-raised px-2 py-1 font-mono text-[10.5px] shadow-sm">
          DF {DF_BINS[hover].label} %: {Math.round((100 * counts[hover]) / total)} % of points
        </div>
      )}
    </div>
  )
}
