import { useState } from 'react'
import { fmt, fmt1 } from '../api'
import type { SavedScenario } from '../types'
import { Button } from './kit'

interface Props {
  saved: SavedScenario[]
  current: { gfa_m2: number; units: number; capex_sek: number; upfront_kgco2e: number; added_gfa_m2: number }
  onClose: () => void
  onRemove: (id: string) => void
  onRestore: (s: SavedScenario) => void
  onSave: (name: string) => void
}

/** Saved site scenarios side by side (stored in this browser). */
export function CompareDrawer({ saved, current, onClose, onRemove, onRestore, onSave }: Props) {
  const [name, setName] = useState('')
  const rows: { label: string; get: (k: SavedScenario['kpi'], a?: SavedScenario['analysis']) => string }[] = [
    { label: 'GFA m²', get: (k) => fmt(k.gfa_m2) },
    { label: 'Added GFA m²', get: (k) => fmt(k.added_gfa_m2) },
    { label: 'Units', get: (k) => fmt(k.units) },
    { label: 'Fit-out MSEK', get: (k) => fmt1(k.capex_sek / 1e6) },
    { label: 'Upfront t CO₂e', get: (k) => fmt(k.upfront_kgco2e / 1000) },
    { label: 'kg CO₂e / m²', get: (k) => fmt1(k.gfa_m2 ? k.upfront_kgco2e / k.gfa_m2 : 0) },
    { label: 'Analysed floor', get: (_k, a) => (a ? `${a.building} F${a.floor}` : '–') },
    { label: 'Mean DF %', get: (_k, a) => fmt1(a?.mean_df) },
    { label: 'Area ≥ 300 lx', get: (_k, a) => (a?.area_300 !== undefined ? `${fmt(a.area_300 * 100)} %` : '–') },
    { label: 'Comfortable %', get: (_k, a) => fmt1(a?.comfortable_pct) },
    { label: 'Too warm %', get: (_k, a) => fmt1(a?.overheating_pct) },
  ]
  return (
    <div className="absolute bottom-14 left-1/2 z-20 w-[min(68rem,calc(100vw-2rem))] -translate-x-1/2 rounded-md border border-line bg-raised p-3 shadow-lg">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[14px] font-semibold">Scenarios <span className="font-normal text-ink-2">· compare saved versions of the site</span></h3>
        <div className="flex items-center gap-1.5">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Housing + 2 floors"
            aria-label="Scenario name"
            className="w-60 rounded border border-line-strong bg-surface px-2 py-1.5 text-[13px] outline-none focus:border-ink-2" />
          <Button primary onClick={() => { onSave(name.trim() || `Scenario ${saved.length + 1}`); setName('') }}>Create scenario from current</Button>
          <button onClick={onClose} className="ml-1 font-mono text-[14px] text-muted hover:text-ink" aria-label="Close">×</button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left">
              <th className="py-1.5 pr-3 font-mono text-[10.5px] uppercase tracking-wide text-ink-2">KPI</th>
              <th className="py-1.5 pr-3 text-right font-semibold text-ink">Current</th>
              {saved.map((s) => (
                <th key={s.id} className="py-1.5 pr-3 text-right font-medium">
                  <div>{s.name}</div>
                  <div className="flex justify-end gap-2 text-[11.5px] font-normal">
                    <button className="text-ink underline-offset-2 hover:underline" onClick={() => onRestore(s)}>load</button>
                    <button className="text-muted hover:text-critical" onClick={() => onRemove(s.id)}>delete</button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-t border-line">
                <td className="py-1.5 pr-3 text-ink-2">{r.label}</td>
                <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{r.get(current, undefined)}</td>
                {saved.map((s) => <td key={s.id} className="py-1.5 pr-3 text-right font-mono tabular-nums">{r.get(s.kpi, s.analysis)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!saved.length && (
        <div className="mt-2 rounded-md bg-sunken px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-2">
          <b className="font-medium text-ink">No scenarios saved yet, so there is nothing to compare.</b> A scenario keeps every
          building's settings. To make one: open a building, change its uses, partitions, windows or floors (left panel), then name it
          above and press <i>Create scenario from current</i>. Save at least two to compare them. Run daylight or comfort on a floor
          first if you want those figures in the table too.
        </div>
      )}
      <p className="mt-2 text-[11.5px] text-ink-2">Saved in this browser only. Each saved scenario keeps every building's settings, so "load" restores it.</p>
    </div>
  )
}
