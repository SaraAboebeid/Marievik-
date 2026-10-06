import { useEffect, useState } from 'react'
import { SYSTEM_LABEL, USE_LABEL, WINDOW_LABEL } from '../api'
import type { BuildingPayload, Level, Settings, SitePayload } from '../types'
import type { ViewOptions } from '../viewer/Viewer'
import { Button, Card, Field, Select, Slider, Toggle } from './kit'

interface Props {
  site: SitePayload
  level: Level
  building: BuildingPayload | null
  settings: Settings | null
  loading: boolean
  onChange: (patch: Partial<Settings>) => void
  onGo: (l: Level) => void
  view: ViewOptions
  setView: (v: ViewOptions) => void
  onSave: (name: string) => void
  onResetBuilding: () => void
  onResetSite: () => void
}

export function ScenarioPanel({ site, level, building, settings, loading, onChange, onGo, view, setView, onSave, onResetBuilding, onResetSite }: Props) {
  const [added, setAdded] = useState(settings?.added_floors ?? 0)
  const [name, setName] = useState('')
  useEffect(() => setAdded(settings?.added_floors ?? 0), [settings?.added_floors, building?.id])

  const useOpts: [string, string][] = ['site', ...Object.keys(site.uses)].map((u) => [u, USE_LABEL[u] ?? site.uses[u] ?? u])
  const sb = building ? site.buildings.find((x) => x.id === building.id) : null

  if (level.kind === 'site' || !building || !settings) {
    return (
      <Card title="Site">
        <p className="text-[12px] leading-relaxed text-ink-2">
          {site.buildings.length} buildings at {site.location.name}. Click a building to open it, then a floor,
          then a unit. Every building can take its own scenario: change its uses, partitions, windows, or add floors on top.
        </p>
        <p className="mt-2 text-[10.5px] leading-snug text-muted">{site.provenance}</p>
        <div className="mt-2 flex gap-1.5">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Scenario name"
            className="min-w-0 flex-1 rounded border border-line bg-surface px-2 py-1 text-[12px] outline-none focus:border-accent" />
          <Button onClick={() => { onSave(name || `Scenario ${new Date().toLocaleTimeString('sv-SE')}`); setName('') }}>Save</Button>
        </div>
        <div className="mt-2">
          <Button onClick={onResetSite}>Reset whole site</Button>
        </div>
      </Card>
    )
  }

  return (
    <>
      <Card title={`Scenario · ${building.id}`} right={loading ? <span className="font-mono text-[10px] text-accent">updating…</span> : null}>
        <div className="mb-2 text-[12.5px] font-medium">{building.name}</div>
        {sb?.facade?.notes && <p className="mb-2 text-[11px] leading-snug text-muted">{sb.facade.notes}</p>}
        <Field label="Ground floor use">
          <Select value={settings.ground_use} onChange={(v) => onChange({ ground_use: v })} options={useOpts} />
        </Field>
        <Field label="Upper floors use">
          <Select value={settings.use} onChange={(v) => onChange({ use: v })} options={useOpts} />
        </Field>
        <Field label="Partition system">
          <Select value={settings.partition_system} onChange={(v) => onChange({ partition_system: v })}
            options={site.systems.map((s) => [s, SYSTEM_LABEL[s] ?? s])} />
        </Field>
        <Field label="Windows">
          <Select value={settings.windows} onChange={(v) => onChange({ windows: v })}
            options={site.windows.map((s) => [s, WINDOW_LABEL[s] ?? s])} />
        </Field>
        <Field label="Add floors on top" hint={`${building.kpi.existing_floors} + ${added} = ${building.kpi.existing_floors + added}`}>
          <Slider value={added} min={0} max={site.max_added} onChange={setAdded} onCommit={(v) => onChange({ added_floors: v })} />
        </Field>
        {added > 0 && (
          <Field label="Use of the added floors">
            <Select value={settings.added_use} onChange={(v) => onChange({ added_use: v })}
              options={[['same', USE_LABEL.same], ...useOpts.filter(([u]) => u !== 'site')]} />
          </Field>
        )}
        <Toggle on={settings.facade} onChange={(v) => onChange({ facade: v })} label="Facade & roof detail" />
        <div className="mt-2 flex gap-1.5">
          <Button onClick={onResetBuilding}>Reset building</Button>
          <Button onClick={onResetSite}>Reset whole site</Button>
        </div>
      </Card>

      {level.kind === 'building' && (
        <Card title="Floors" right={<span className="font-mono text-[10px] text-muted">click to open</span>}>
          <div className="mb-2">
            <Field label="Explode floors" hint={`${view.explode.toFixed(1)} m`}>
              <Slider value={view.explode} min={0} max={8} step={0.5} onChange={(v) => setView({ ...view, explode: v })} />
            </Field>
          </div>
          <ul className="max-h-64 overflow-y-auto">
            {[...building.floors].reverse().map((f) => (
              <li key={f.index}>
                <button onClick={() => onGo({ kind: 'floor', building: building.id, floor: f.index })}
                  className="flex w-full items-baseline justify-between gap-2 rounded px-1.5 py-1 text-left text-[12px] hover:bg-sunken">
                  <span>
                    <span className="font-mono text-muted">F{String(f.index).padStart(2, '0')}</span>{' '}
                    {f.use_label}{f.added && <span className="ml-1 rounded bg-warn-bg px-1 text-[10px] text-warn">added</span>}
                  </span>
                  <span className="font-mono text-[11px] text-muted">{f.units} units</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  )
}
