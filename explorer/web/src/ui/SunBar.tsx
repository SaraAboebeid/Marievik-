import { useState } from 'react'
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

/** Sun date/time and view options. Collapsed to one small button so it stays off the model until needed. */
export function SunBar({ sun, setSun, view, setView }: Props) {
  const [open, setOpen] = useState(false)
  const hh = Math.floor(sun.hour)
  const mm = Math.round((sun.hour - hh) * 60)
  const time = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} aria-expanded={false}
        className="flex items-center gap-2 rounded-lg border border-line bg-raised/95 px-3 py-1.5 text-[12.5px] text-ink shadow-sm hover:border-line-strong">
        <span aria-hidden>☀</span>
        <span>{sun.day} {MONTHS[sun.month - 1]} · {time}</span>
        <span className="text-ink-2">· Sun & view ▴</span>
      </button>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-raised/95 px-3.5 py-2 shadow-sm">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-2">Sun</span>
      <select value={sun.month} onChange={(e) => setSun({ ...sun, month: Number(e.target.value), day: Math.min(sun.day, 28) })}
        className="rounded border border-line-strong bg-surface px-1.5 py-0.5 text-[12.5px]" aria-label="Month">
        {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
      </select>
      <input type="number" min={1} max={31} value={sun.day} aria-label="Day"
        onChange={(e) => setSun({ ...sun, day: Math.max(1, Math.min(31, Number(e.target.value))) })}
        className="w-12 rounded border border-line-strong bg-surface px-1.5 py-0.5 text-[12.5px]" />
      <input type="range" min={3} max={22} step={0.25} value={sun.hour} aria-label="Time of day"
        onChange={(e) => setSun({ ...sun, hour: Number(e.target.value) })} className="w-44 accent-[var(--color-ink-2)]" />
      <span className="w-12 font-mono text-[12.5px] tabular-nums">{time}</span>
      <select aria-label="Preset" value="" onChange={(e) => {
        const p = PRESETS[Number(e.target.value)]
        if (p) setSun({ month: p[1], day: p[2], hour: p[3] })
      }} className="rounded border border-line-strong bg-surface px-1.5 py-0.5 text-[12.5px]">
        <option value="">Presets…</option>
        {PRESETS.map((p, i) => <option key={p[0]} value={i}>{p[0]}</option>)}
      </select>
      <span className="text-line-strong">|</span>
      <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-2">View</span>
      <Toggle on={view.sky} onChange={(v) => setView({ ...view, sky: v })} label="Sky" />
      <Toggle on={view.shadows} onChange={(v) => setView({ ...view, shadows: v })} label="Shadows" />
      <Toggle on={view.ao} onChange={(v) => setView({ ...view, ao: v })} label="Soft shading" />
      <Toggle on={view.labels} onChange={(v) => setView({ ...view, labels: v })} label="Labels" />
      <button type="button" onClick={() => setOpen(false)} className="ml-1 text-[12px] text-ink-2 hover:text-ink" aria-label="Collapse">▾ hide</button>
    </div>
  )
}
