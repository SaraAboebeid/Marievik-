import { useEffect, useState } from 'react'
import { SYSTEM_LABEL, USE_LABEL, WINDOW_LABEL } from '../api'
import type { BuildingPayload, Level, Settings, SitePayload } from '../types'
import type { ViewOptions } from '../viewer/Viewer'
import { Badge, Button, Card, ConfirmButton, Field, Section, Select, Slider, Toggle } from './kit'

export interface ScenarioStatus {
  changed: string[]          // building ids that differ from today's site
  name: string | null        // the saved scenario on screen, if nothing changed since it was saved or loaded
  savedCount: number
}

interface Props {
  site: SitePayload
  level: Level
  building: BuildingPayload | null
  settings: Settings | null
  loading: boolean
  status: ScenarioStatus
  onChange: (patch: Partial<Settings>) => void
  onGo: (l: Level) => void
  view: ViewOptions
  setView: (v: ViewOptions) => void
  onSave: (name: string) => void
  onCompare: () => void
  onSuppliers: () => void
  onResetBuilding: () => void
  onResetSite: () => void
}

export function ScenarioPanel(p: Props) {
  const { site, level, building, settings, loading, status, onChange, onGo, view, setView, onResetBuilding } = p
  const [added, setAdded] = useState(settings?.added_floors ?? 0)
  useEffect(() => setAdded(settings?.added_floors ?? 0), [settings?.added_floors, building?.id])

  const useOpts: [string, string][] = ['site', ...Object.keys(site.uses)].map((u) => [u, USE_LABEL[u] ?? site.uses[u] ?? u])
  const sb = building ? site.buildings.find((x) => x.id === building.id) : null

  if (level.kind === 'site' || !building || !settings) {
    return (
      <>
        <Card title="Site">
          <p className="text-[13px] leading-relaxed text-ink-2">
            {site.buildings.length} buildings at {site.location.name}. <b className="font-medium text-ink">Click a building</b> to
            open it, then a floor, then a unit.
          </p>
        </Card>
        <ScenarioFlow {...p} />
      </>
    )
  }

  const changed = status.changed.includes(building.id)
  return (
    <>
      <Card title={`Change building ${building.id}`} right={loading ? <span className="font-mono text-[11px] text-ink-2">updating…</span> : null}>
        <div className="mb-1 text-[14px] font-semibold leading-snug">{building.name}</div>
        {sb?.facade?.notes && <p className="mb-2.5 text-[12px] leading-snug text-muted">{sb.facade.notes}</p>}
        <Field label="Ground floor use">
          <Select value={settings.ground_use} onChange={(v) => onChange({ ground_use: v })} options={useOpts} />
        </Field>
        <Field label="Upper floors use">
          <Select value={settings.use} onChange={(v) => onChange({ use: v })} options={useOpts} />
        </Field>
        <Field label="Partition system">
          <Select value={settings.partition_system} onChange={(v) => onChange({ partition_system: v })}
            options={[
              ...site.systems.map((s): [string, string] => [s, SYSTEM_LABEL[s] ?? s]),
              ...site.suppliers.map((x): [string, string] => [x.system, `${x.title} (supplier)`]),
            ]} />
        </Field>
        <SupplierSummary site={site} system={settings.partition_system} onOpen={p.onSuppliers} />
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
        <div className="mt-3 border-t border-line pt-2.5">
          <Button onClick={onResetBuilding} disabled={!changed} title={changed ? undefined : 'This building is as it is today'}>
            Undo changes to {building.id}
          </Button>
        </div>
      </Card>

      {level.kind === 'building' && (
        <Section id="floors" title={`Floors (${building.floors.length})`} right={<span className="text-[11px] text-muted">click to open</span>}>
          <Field label="Explode floors" hint={`${view.explode.toFixed(1)} m`}>
            <Slider value={view.explode} min={0} max={8} step={0.5} onChange={(v) => setView({ ...view, explode: v })} />
          </Field>
          <ul className="max-h-64 overflow-y-auto">
            {[...building.floors].reverse().map((f) => (
              <li key={f.index}>
                <button onClick={() => onGo({ kind: 'floor', building: building.id, floor: f.index })}
                  className="flex w-full items-baseline justify-between gap-2 rounded px-1.5 py-1 text-left text-[13px] hover:bg-sunken">
                  <span>
                    <span className="font-mono text-ink-2">F{String(f.index).padStart(2, '0')}</span>{' '}
                    {f.use_label}{f.added && <span className="ml-1 rounded bg-warn-bg px-1 text-[11px] text-warn">added</span>}
                  </span>
                  <span className="font-mono text-[12px] text-ink-2">{f.units} units</span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <ScenarioFlow {...p} />
    </>
  )
}

/** Under the partition dropdown: the chosen supplier's product in brief, with the way into its full card. */
function SupplierSummary({ site, system, onOpen }: { site: SitePayload; system: string; onOpen: () => void }) {
  const sup = site.suppliers.find((x) => x.system === system)
  if (!sup) {
    return site.suppliers.length > 0 ? (
      <button type="button" onClick={onOpen}
        className="-mt-1.5 mb-2.5 block text-left text-[12px] text-ink-2 underline-offset-2 hover:text-ink hover:underline">
        Supplier products: {site.suppliers.map((x) => x.title).join(', ')} ›
      </button>
    ) : null
  }
  const dB = sup.products.map((x) => x.Rw_dB)
  const stated = sup.products.filter((x) => !x.estimate).length
  return (
    <div className="-mt-1 mb-2.5 rounded-md border border-line bg-sunken px-2.5 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold">{sup.title}</span>
        <span className="text-[11px] text-ink-2">{sup.supplier.split(' ')[0]}</span>
      </div>
      <p className="mt-0.5 text-[12px] leading-snug text-ink-2">
        {sup.products.length} builds, {Math.min(...dB)}–{Math.max(...dB)} dB. Each wall gets the cheapest build that meets its use's
        sound and fire requirement.
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <Badge tone={stated === sup.products.length ? 'good' : 'warn'}>{stated}/{sup.products.length} supplier-stated</Badge>
        {(() => {
          const reuse = Math.max(...sup.products.map((x) => x.recovery_rate))
          return <Badge tone={reuse < 0.5 ? 'warn' : 'good'}>{sup.products[0].fixing}: ≤ {Math.round(reuse * 100)} % reusable</Badge>
        })()}
      </div>
      <button type="button" onClick={onOpen}
        className="mt-1.5 text-[12px] font-medium text-ink underline-offset-2 hover:underline">
        Open product card: range, comparison in this building, open questions ›
      </button>
    </div>
  )
}

/** One flow: change buildings → name and save → compare. The site-wide reset sits apart and asks first. */
function ScenarioFlow({ site, status, onSave, onCompare, onResetSite }: Props) {
  const [name, setName] = useState('')
  const n = status.changed.length
  const state = n === 0
    ? { text: status.name ? `“${status.name}”` : 'Today’s site, no changes', tone: 'text-ink-2' }
    : status.name
      ? { text: `“${status.name}”`, tone: 'text-ink' }
      : { text: `${n} building${n > 1 ? 's' : ''} changed, not saved`, tone: 'text-warn' }
  const step = (i: number, text: string, done: boolean) => (
    <li className={`flex items-start gap-2 ${done ? 'text-ink-2' : 'text-ink'}`}>
      <span className={`mt-[1px] grid h-[18px] w-[18px] flex-none place-items-center rounded-full font-mono text-[10.5px] ${done ? 'bg-sunken text-ink-2' : 'bg-ink text-bg'}`}>
        {done ? '✓' : i}
      </span>
      <span>{text}</span>
    </li>
  )
  return (
    <Section id="scenario-flow" title="Scenario">
      <div className="mb-2.5 rounded-md bg-sunken px-2.5 py-2">
        <div className="text-[11px] text-ink-2">On screen now</div>
        <div className={`text-[13.5px] font-semibold ${state.tone}`}>{state.text}</div>
        {n > 0 && <div className="mt-0.5 font-mono text-[11px] text-ink-2">{status.changed.join(' · ')}</div>}
      </div>
      <ol className="mb-3 space-y-1.5 text-[12.5px]">
        {step(1, 'Open a building and change its uses, partitions, windows or floors', n > 0)}
        {step(2, 'Name the scenario and save it', !!status.name && n > 0)}
        {step(3, 'Compare saved scenarios side by side', false)}
      </ol>
      <div className="flex gap-1.5">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Housing + 2 floors"
          aria-label="Scenario name"
          className="min-w-0 flex-1 rounded border border-line-strong bg-surface px-2 py-1.5 text-[13px] outline-none focus:border-ink-2" />
        <Button primary onClick={() => { onSave(name.trim() || `Scenario ${status.savedCount + 1}`); setName('') }}>Save</Button>
      </div>
      <div className="mt-2">
        <Button onClick={onCompare}>Compare saved ({status.savedCount})</Button>
      </div>
      <div className="mt-3 border-t border-line pt-2.5">
        <ConfirmButton confirm={`Put all ${site.buildings.length} buildings back to today's site? Unsaved changes are lost; saved scenarios are kept.`}
          onConfirm={onResetSite}>
          Reset all buildings to today…
        </ConfirmButton>
      </div>
    </Section>
  )
}
