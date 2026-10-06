import { MONTHS } from '../viewer/sun'
import type { ViewOptions } from '../viewer/Viewer'
import type { Level } from '../types'
import { Toggle } from './kit'

interface Props {
  sun: { month: number; day: number; hour: number }
  setSun: (s: { month: number; day: number; hour: number }) => void
  view: ViewOptions
  setView: (v: ViewOptions) => void
  level: Level
}

const PRESETS: [string, number, number, number][] = [
  ['Winter solstice', 12, 21, 12], ['Equinox', 3, 20, 12], ['Summer solstice', 6, 21, 15],
]

export function SunBar({ sun, setSun, view, setView }: Props) {
  const hh = Math.floor(sun.hour)
  const mm = Math.round((sun.hour - hh) * 60)
  return (
    <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-md border border-line bg-raised/95 px-3 py-1.5 shadow-sm">
      <span className="font-mono text-[9.5px] uppercase tracking-[0.09em] text-muted">Sun</span>
      <select value={sun.month} onChange={(e) => setSun({ ...sun, month: Number(e.target.value), day: Math.min(sun.day, 28) })}
        className="rounded border border-line bg-surface px-1 py-0.5 text-[12px]" aria-label="Month">
        {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
      </select>
      <input type="number" min={1} max={31} value={sun.day} aria-label="Day"
        onChange={(e) => setSun({ ...sun, day: Math.max(1, Math.min(31, Number(e.target.value))) })}
        className="w-12 rounded border border-line bg-surface px-1 py-0.5 text-[12px]" />
      <input type="range" min={3} max={22} step={0.25} value={sun.hour} aria-label="Time of day"
        onChange={(e) => setSun({ ...sun, hour: Number(e.target.value) })} className="w-44 accent-[var(--color-accent)]" />
      <span className="w-12 font-mono text-[12px] tabular-nums">{String(hh).padStart(2, '0')}:{String(mm).padStart(2, '0')}</span>
      <select aria-label="Preset" value="" onChange={(e) => {
        const p = PRESETS[Number(e.target.value)]
        if (p) setSun({ month: p[1], day: p[2], hour: p[3] })
      }} className="rounded border border-line bg-surface px-1 py-0.5 text-[12px]">
        <option value="">Presets…</option>
        {PRESETS.map((p, i) => <option key={p[0]} value={i}>{p[0]}</option>)}
      </select>
      <span className="text-line-strong">|</span>
      <Toggle on={view.sky} onChange={(v) => setView({ ...view, sky: v })} label="Sky" />
      <Toggle on={view.shadows} onChange={(v) => setView({ ...view, shadows: v })} label="Shadows" />
      <Toggle on={view.ao} onChange={(v) => setView({ ...view, ao: v })} label="AO" />
      <Toggle on={view.labels} onChange={(v) => setView({ ...view, labels: v })} label="Labels" />
    </div>
  )
}
