import { useEffect, useRef, useState } from 'react'
import { sweep } from '../api'
import type { Bootstrap, Criteria, Plan, Settings, SweepFrame, SweepResult } from '../types'

export const CRIT_COLOR: Record<string, string> = {
  lcc: 'var(--color-c2)',
  carbon: 'var(--color-c3)',
  comfort: 'var(--color-c1)',
  usability: 'var(--color-c6)',
  functionality: 'var(--color-c5)',
}
export const CRIT_SHORT: Record<string, string> = {
  lcc: 'LCC / person',
  carbon: 'CO₂e / person',
  comfort: 'Comfort',
  usability: 'Usability',
  functionality: 'Function',
}

export function fmtCrit(k: string, v: number | undefined) {
  if (v === undefined || v === null) return '–'
  if (k === 'lcc') return `${Math.round(v / 1000).toLocaleString('en-US')}k`
  if (k === 'carbon') return `${(v / 1000).toFixed(1)} t`
  if (k === 'comfort') return `${v.toFixed(0)}%`
  return v.toFixed(0)
}

const ORDER = ['glazing', 'sill', 'window_width', 'partition', 'products', 'occupants',
  'wall_offset', 'rearrange', 'azimuth'] as const

interface Props {
  boot: Bootstrap
  plan: Plan
  settings: Settings
  selectedWall: string | null
  onApply: (plan: Plan, settings: Settings) => void
  onPreview: (frame: SweepFrame | null) => void
  setStatus: (s: string) => void
}

export function ParamPanel({ boot, plan, settings, selectedWall, onApply, onPreview, setStatus }: Props) {
  const [withThermal, setWithThermal] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [run, setRun] = useState<SweepResult | null>(null)
  const [frame, setFrame] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [offset, setOffset] = useState(0)
  const timer = useRef<number | null>(null)

  useEffect(() => () => { if (timer.current) window.clearInterval(timer.current) }, [])

  const P = boot.parameters
  const windows = plan.shell.windows.filter((w) => !w.door)
  const current: Record<string, number | string> = {
    glazing: plan.shell.windows.filter((w) => w.glazing === 'upgraded').length > plan.shell.windows.length / 2
      ? 'upgraded' : 'existing',
    sill: windows.length ? Math.min(...windows.map((w) => w.sill_mm)) : 900,
    window_width: 100,
    partition: Object.entries(boot.partition_specs).find(([, v]) =>
      plan.walls.some((w) => !w.fixed && !w.wet && w.component === v.component))?.[0] ?? 'conventional',
    products: mostCommon(plan.furniture.map((f) => f.product?.split('#')[1]).filter(Boolean) as string[]) ?? 'standard',
    occupants: settings.occupants,
    azimuth: settings.azimuth ?? plan.shell.facade_azimuth_deg ?? 180,
    rearrange: 0,
  }

  async function apply(param: string, value: number | string) {
    setBusy(param)
    try {
      const r = await sweep(plan, settings, param, {
        values: [value], wall_id: selectedWall ?? undefined,
      })
      const f = r.frames[0]
      if (f.skipped || !f.plan) { setStatus(`${P[param].label}: ${f.skipped ?? 'cannot apply'}`); return }
      onApply(f.plan, f.settings!)
    } catch (e) {
      setStatus(`engine error — ${(e as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  async function play(param: string) {
    if (timer.current) window.clearInterval(timer.current)
    setBusy(param)
    setStatus(withThermal || param === 'azimuth'
      ? 'running the scenarios with EnergyPlus…' : 'running the scenarios…')
    try {
      const r = await sweep(plan, settings, param, {
        wall_id: selectedWall ?? undefined, thermal: withThermal,
      })
      setRun(r)
      const usable = r.frames.map((f, i) => (f.plan ? i : -1)).filter((i) => i >= 0)
      if (!usable.length) { setStatus('no value of this parameter fits the plan'); return }
      setPlaying(true)
      let k = 0
      const show = (i: number) => { setFrame(i); onPreview(r.frames[i]) }
      show(usable[0])
      timer.current = window.setInterval(() => {
        k += 1
        if (k >= usable.length) {
          window.clearInterval(timer.current!)
          timer.current = null
          setPlaying(false)
          if (r.least_regret !== null) show(r.least_regret)
          setStatus(`${r.frames.length} scenarios · least regret: ${label(r, r.least_regret)}`)
          return
        }
        show(usable[k])
      }, 750)
    } catch (e) {
      setStatus(`engine error — ${(e as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  function stop() {
    if (timer.current) window.clearInterval(timer.current)
    timer.current = null
    setPlaying(false)
    setRun(null)
    setFrame(null)
    onPreview(null)
  }

  function keep() {
    if (!run || frame === null) return
    const f = run.frames[frame]
    if (f.plan && f.settings) onApply(f.plan, f.settings)
    stop()
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] leading-snug text-muted">
        Change a parameter to apply it, or press ▶ to play it through its range. Every scenario is
        scored on all five criteria; the plan animates through them and stops on the one with the
        least regret.
      </p>
      <label className="flex cursor-pointer items-center gap-2 text-[12px] text-ink-2">
        <input id="sweep-thermal" type="checkbox" checked={withThermal}
          onChange={(e) => setWithThermal(e.target.checked)} />
        Include thermal comfort in sweeps (EnergyPlus, ~6 s per batch)
      </label>

      {run && (
        <SweepChart run={run} frame={frame} playing={playing}
          onPick={(i) => { setFrame(i); onPreview(run.frames[i]) }}
          onKeep={keep} onCancel={stop} />
      )}

      <div className="flex flex-col divide-y divide-line rounded-md border border-line bg-raised">
        {ORDER.map((key) => {
          const meta = P[key]
          if (!meta) return null
          const needsWall = key === 'wall_offset'
          const disabled = busy !== null || playing || (needsWall && !selectedWall)
          return (
            <div key={key} className="flex flex-col gap-1.5 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12.5px] font-medium">{meta.label}</span>
                <button type="button" disabled={disabled} onClick={() => play(key)}
                  title={`Play ${meta.label.toLowerCase()} through ${meta.values.join(', ')}${meta.unit ? ` ${meta.unit}` : ''}`}
                  className="rounded border border-line-strong bg-raised px-2 py-0.5 font-mono text-[11px] text-accent hover:border-accent disabled:opacity-40">
                  {busy === key ? '…' : '▶ play'}
                </button>
              </div>
              <Control k={key} boot={boot} meta={meta} value={current[key]} disabled={disabled}
                offset={offset} setOffset={setOffset} selectedWall={selectedWall}
                onCommit={(v) => { apply(key, v); if (key === 'wall_offset') setOffset(0) }} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Control({
  k, boot, meta, value, disabled, offset, setOffset, selectedWall, onCommit,
}: {
  k: string
  boot: Bootstrap
  meta: { values: (number | string)[]; unit: string }
  value: number | string | undefined
  disabled: boolean
  offset: number
  setOffset: (n: number) => void
  selectedWall: string | null
  onCommit: (v: number | string) => void
}) {
  const sel = 'w-full rounded border border-line-strong bg-raised px-1.5 py-1 text-[12px]'
  if (k === 'glazing') {
    return (
      <select id={`p-${k}`} className={sel} disabled={disabled} value={String(value)}
        onChange={(e) => onCommit(e.target.value)}>
        <option value="existing">Existing glazing (as built)</option>
        <option value="upgraded">New openable triple glazing</option>
      </select>
    )
  }
  if (k === 'partition') {
    return (
      <select id={`p-${k}`} className={sel} disabled={disabled} value={String(value)}
        onChange={(e) => onCommit(e.target.value)}>
        {Object.entries(boot.partition_specs).map(([id, s]) => <option key={id} value={id}>{s.label}</option>)}
      </select>
    )
  }
  if (k === 'products') {
    return (
      <select id={`p-${k}`} className={sel} disabled={disabled} value={String(value)}
        onChange={(e) => onCommit(e.target.value)}>
        {Object.entries(boot.product_strategies).map(([id, l]) => <option key={id} value={id}>{l}</option>)}
      </select>
    )
  }
  if (k === 'rearrange') {
    return (
      <button type="button" disabled={disabled} className={`${sel} text-left hover:border-accent`}
        onClick={() => onCommit(Math.floor(Math.random() * 1000))}>
        New arrangement of the movable furniture
      </button>
    )
  }
  if (k === 'wall_offset') {
    return selectedWall ? (
      <Slider id={`p-${k}`} min={-1500} max={1500} step={50} value={offset} unit="mm" disabled={disabled}
        onInput={setOffset} onCommit={(v) => { if (v !== 0) onCommit(v) }} />
    ) : <p className="text-[11.5px] text-muted">Select a wall on the plan to move or play it.</p>
  }
  const ranges: Record<string, [number, number, number]> = {
    sill: [0, 1200, 50], window_width: [50, 180, 5], occupants: [1, 6, 1], azimuth: [0, 345, 15],
  }
  const [min, max, step] = ranges[k] ?? [0, 100, 1]
  return (
    <Slider id={`p-${k}`} min={min} max={max} step={step} value={Number(value ?? min)} unit={meta.unit}
      disabled={disabled} onCommit={onCommit} />
  )
}

function Slider({
  id, min, max, step, value, unit, disabled, onCommit, onInput,
}: {
  id: string; min: number; max: number; step: number; value: number; unit: string; disabled: boolean
  onCommit: (v: number) => void; onInput?: (v: number) => void
}) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <div className="flex items-center gap-2">
      <input id={id} type="range" min={min} max={max} step={step} value={v} disabled={disabled}
        className="flex-1 accent-[var(--color-accent)]"
        onChange={(e) => { setV(+e.target.value); onInput?.(+e.target.value) }}
        onPointerUp={() => onCommit(v)} onKeyUp={() => onCommit(v)} />
      <span className="w-[70px] text-right font-mono text-[11.5px] tabular-nums">
        {v > 0 && id === 'p-wall_offset' ? '+' : ''}{v}{unit ? ` ${unit}` : ''}
      </span>
    </div>
  )
}

function label(r: SweepResult, i: number | null) {
  if (i === null) return '–'
  const v = r.frames[i].value
  return `${v}${r.meta.unit && typeof v === 'number' ? ` ${r.meta.unit}` : ''}`
}

function mostCommon(xs: string[]) {
  const c: Record<string, number> = {}
  xs.forEach((x) => { c[x] = (c[x] ?? 0) + 1 })
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0]
}

function SweepChart({
  run, frame, playing, onPick, onKeep, onCancel,
}: {
  run: SweepResult; frame: number | null; playing: boolean
  onPick: (i: number) => void; onKeep: () => void; onCancel: () => void
}) {
  const frames = run.frames
  const keys = (['lcc', 'carbon', 'comfort', 'usability', 'functionality'] as const)
    .filter((k) => frames.some((f) => f.criteria?.[k] !== undefined))
  const W = 300, H = 120, pad = 14
  const x = (i: number) => pad + (frames.length === 1 ? (W - 2 * pad) / 2 : i * (W - 2 * pad) / (frames.length - 1))
  const norm = (k: keyof Criteria) => {
    const vals = frames.map((f) => f.criteria?.[k]).filter((v): v is number => v !== undefined)
    const lo = Math.min(...vals), hi = Math.max(...vals)
    const better = k === 'lcc' || k === 'carbon' ? -1 : 1
    return (v: number) => {
      const n = hi === lo ? 0.5 : (v - lo) / (hi - lo)
      return H - pad - (better > 0 ? n : 1 - n) * (H - 2 * pad)
    }
  }
  return (
    <div className="rounded-md border border-accent bg-raised p-3">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <b className="text-[12.5px]">{run.meta.label}{run.thermal ? ' · with EnergyPlus' : ''}</b>
        <span className="font-mono text-[10.5px] text-muted">higher = better on every line</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H + 18}`} className="block h-auto w-full">
        {frames.map((f, i) => (
          <g key={i} className="cursor-pointer" onClick={() => f.plan && onPick(i)}>
            <rect x={x(i) - 12} y={0} width={24} height={H} fill={i === frame ? 'var(--color-accent-soft)' : 'transparent'} />
            {i === run.least_regret && <text x={x(i)} y={10} textAnchor="middle" fontSize={10} fill="var(--color-accent)">★</text>}
            <text x={x(i)} y={H + 13} textAnchor="middle" fontSize={9} fontFamily="var(--font-mono)"
              fill={f.plan ? 'var(--color-muted)' : 'var(--color-critical)'}>
              {String(f.value).slice(0, 7)}
            </text>
          </g>
        ))}
        {keys.map((k) => {
          const y = norm(k)
          const pts = frames.map((f, i) => (f.criteria?.[k] !== undefined ? `${x(i)},${y(f.criteria[k]!)}` : null))
            .filter(Boolean).join(' ')
          return (
            <g key={k} pointerEvents="none">
              <polyline points={pts} fill="none" stroke={CRIT_COLOR[k]} strokeWidth={2} />
              {frames.map((f, i) => f.criteria?.[k] !== undefined && (
                <circle key={i} cx={x(i)} cy={y(f.criteria[k]!)} r={i === frame ? 3.5 : 2} fill={CRIT_COLOR[k]} />
              ))}
            </g>
          )
        })}
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px]">
        {keys.map((k) => (
          <span key={k} className="flex items-center gap-1">
            <i className="inline-block h-2 w-2 rounded-full" style={{ background: CRIT_COLOR[k] }} />
            {CRIT_SHORT[k]}
          </span>
        ))}
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full font-mono text-[10.5px] tabular-nums">
          <thead>
            <tr className="text-muted">
              <th className="text-left font-normal">{run.meta.unit || 'value'}</th>
              {keys.map((k) => <th key={k} className="text-right font-normal">{CRIT_SHORT[k]}</th>)}
            </tr>
          </thead>
          <tbody>
            {frames.map((f, i) => (
              <tr key={i} onClick={() => f.plan && onPick(i)}
                className={`cursor-pointer ${i === frame ? 'bg-accent-soft' : ''} ${i === run.least_regret ? 'font-semibold text-accent' : ''}`}>
                <td>{i === run.least_regret ? '★ ' : ''}{String(f.value)}</td>
                {f.plan
                  ? keys.map((k) => <td key={k} className="text-right">{fmtCrit(k, f.criteria?.[k])}</td>)
                  : <td colSpan={keys.length} className="text-right text-critical">{f.skipped}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex gap-2">
        <button type="button" disabled={playing || frame === null} onClick={onKeep}
          className="rounded border border-accent bg-accent px-2.5 py-1 text-[12px] text-white disabled:opacity-40">
          Keep this scenario
        </button>
        <button type="button" onClick={onCancel}
          className="rounded border border-line-strong bg-raised px-2.5 py-1 text-[12px] text-ink-2 hover:border-accent">
          Back to my plan
        </button>
      </div>
    </div>
  )
}
