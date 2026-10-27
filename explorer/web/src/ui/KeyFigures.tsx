import { useState } from 'react'
import { fmt, fmt1 } from '../api'
import type { Distribution, Figure, Figures } from '../types'
import { STATUS_TAG } from './ProfileKpis'
import { Card } from './kit'

/** One colour per space category, the same on every floor and in every scenario — AMF Marievik's own
 *  palette (amffastigheter.se/marievik/): brand blue, coral, terracotta, teal, pink, green. */
const CAT_COLOR: Record<string, string> = {
  'Workstations': '#0528ca', 'Lobby / reception': '#99d9e5', 'Café / retail': '#fd876e', 'Meeting rooms': '#4aa3b5',
  'Core / services': '#943b2e', 'Circulation': '#f6e9de', 'Pantry / kitchen': '#f7df81', 'Homes': '#f4a7dd',
  'Hotel rooms': '#943b2e', 'Classrooms': '#4aa3b5', 'Atrium': '#e5f0f5', 'Other': '#ebe8d7',
}

function value(f: Figure) {
  if (f.unit === 'SEK') return [fmt1((f.value as number) / 1e6), 'MSEK']
  if (f.unit === 'kg CO₂e') return [fmt((f.value as number) / 1000), 't CO₂e']
  if (f.unit === 'share') return [`${Math.round((f.value as number) * 100)}`, '%']
  if (f.unit === 'people' || f.unit === 'grade') return [String(typeof f.value === 'number' ? fmt(f.value) : f.value), '']
  return [fmt(f.value as number), f.unit]
}

export function Tile({ f }: { f: Figure }) {
  const [v, u] = value(f)
  const tag = STATUS_TAG[f.status]
  return (
    <div className="rounded-lg bg-sunken/70 px-3 py-2.5" title={f.note}>
      <div className="flex items-baseline gap-1">
        <span className="text-[20px] leading-none tabular-nums" style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}>{v}</span>
        {u && <span className="text-[12px] font-medium text-ink-2">{u}</span>}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-1 text-[11.5px] text-ink-2">
        <span>{f.label}</span>
        {f.status !== 'computed' && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tag.tone === 'warn' ? 'bg-warn' : 'bg-muted'}`} title={tag.label} />}
      </div>
    </div>
  )
}

function Donut({ d }: { d: Distribution }) {
  const [hover, setHover] = useState<string | null>(null)
  const R = 38, r = 22, C = 50
  let a0 = -Math.PI / 2
  const arcs = d.rows.map((row) => {
    const a1 = a0 + row.share * 2 * Math.PI
    const large = a1 - a0 > Math.PI ? 1 : 0
    const p = (rad: number, ang: number) => `${(C + rad * Math.cos(ang)).toFixed(2)},${(C + rad * Math.sin(ang)).toFixed(2)}`
    const path = `M${p(R, a0)} A${R},${R} 0 ${large} 1 ${p(R, a1 - 0.001)} L${p(r, a1 - 0.001)} A${r},${r} 0 ${large} 0 ${p(r, a0)} Z`
    a0 = a1
    return { row, path }
  })
  const shown = d.rows.find((x) => x.category === hover)
  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 100 100" className="h-[7.5rem] w-[7.5rem] shrink-0" role="img" aria-label={`Space distribution, ${d.label}`}>
        {arcs.map(({ row, path }) => (
          <path key={row.category} d={path} fill={CAT_COLOR[row.category] ?? CAT_COLOR.Other} stroke="var(--color-raised)" strokeWidth={1}
            opacity={hover && hover !== row.category ? 0.45 : 1}
            onPointerEnter={() => setHover(row.category)} onPointerLeave={() => setHover(null)} />
        ))}
        {shown && (
          <text x={C} y={C + 3} textAnchor="middle" className="fill-[var(--color-ink)] font-mono text-[9px]">{fmt(shown.m2)} m²</text>
        )}
      </svg>
      <ul className="min-w-0 flex-1 space-y-[3px] text-[12px]">
        {d.rows.map((row) => (
          <li key={row.category} className="flex items-center gap-2" onPointerEnter={() => setHover(row.category)} onPointerLeave={() => setHover(null)}>
            <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: CAT_COLOR[row.category] ?? CAT_COLOR.Other }} />
            <span className="min-w-0 flex-1 truncate text-ink-2">{row.category}</span>
            <span className="font-mono tabular-nums text-ink">{Math.round(row.share * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

const liveBadge = (loading: boolean) => (
  <span className="flex items-center gap-1.5 rounded-md bg-good-bg px-2 py-0.5 text-[11.5px] font-medium text-good">
    <span className={`h-1.5 w-1.5 rounded-full bg-good ${loading ? 'animate-pulse' : ''}`} />{loading ? 'Updating' : 'Live update'}
  </span>
)

/** Building level, top of the left panel: the headline numbers — everything else about the building
 *  (cost, carbon, flexibility) is secondary to these. Vacancy is not repeated here: Building Overview,
 *  right below this card, already gives it in detail, per floor. */
export function HeadlineFigures({ data, loading }: { data: Figures | null; loading: boolean }) {
  if (!data) {
    return <Card title="Key figures">Calculating…</Card>
  }
  const f = data.figures
  return (
    <Card title="Key figures" right={liveBadge(loading)}>
      <div className="grid grid-cols-2 gap-2">
        <Tile f={f.gfa_m2} /><Tile f={f.usable_m2} /><Tile f={f.occupancy} />
      </div>
    </Card>
  )
}

/** Building level: the ground and typical floor's space distribution, between the rented/vacant bars and
 *  the rest of the key figures (cost, carbon, flexibility). */
export function SpaceDistribution({ data }: { data: Figures | null }) {
  if (!data) return null
  return (
    <Card title="Space distribution">
      {(['ground', 'typical'] as const).map((k, i) => (
        <div key={k} className={i === 0 ? '' : 'mt-4 border-t border-line pt-3.5'}>
          <div className="mb-2.5 text-[11.5px] text-ink-2">{data.distribution[k].label}</div>
          <Donut d={data.distribution[k]} />
        </div>
      ))}
    </Card>
  )
}
