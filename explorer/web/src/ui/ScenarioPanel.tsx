import { useEffect, useState, type ReactNode } from 'react'
import { SYSTEM_LABEL, USE_LABEL, WINDOW_LABEL } from '../api'
import type { BuildingPayload, Level, SavedScenario, Settings, SitePayload } from '../types'
import type { ViewOptions } from '../viewer/Viewer'
import { Badge, Button, Card, Field, Section, Select, Slider, Toggle } from './kit'

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
  saved: SavedScenario[]
  onChange: (patch: Partial<Settings>) => void
  onGo: (l: Level) => void
  view: ViewOptions
  setView: (v: ViewOptions) => void
  onSave: (name: string) => void
  onRestore: (s: SavedScenario) => void
  onCompare: () => void
  onSuppliers: () => void
  onResetBuilding: () => void
  timeline: { label: string; title: string; onOpen: () => void }
}

/** A folding block inside the setup card (Facade & roof, Core & services). */
function Fold({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mb-2 rounded-lg border border-line">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[13px] font-medium text-ink">
        <span className={`text-[11px] transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden>›</span>{title}
      </button>
      {open && <div className="px-3 pb-3 text-[12.5px] text-ink-2">{children}</div>}
    </div>
  )
}

const Icon = {
  save: <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 3h9l3 3v11H4z" /><path d="M7 3v4h6V3M7 17v-5h6v5" /></svg>,
  base: <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 17h14M5 17V8l5-4 5 4v9" /><path d="M8 17v-4h4v4" /></svg>,
  scen: <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M6 4l9 6-9 6z" /></svg>,
}

export function ScenarioPanel(p: Props) {
  const { site, level, building, settings, loading, status, onChange, onGo, view, setView, onResetBuilding } = p
  const [added, setAdded] = useState(settings?.added_floors ?? 0)
  const [open, setOpen] = useState(true)
  const [naming, setNaming] = useState<string | null>(null)     // the name being typed for a new scenario
  useEffect(() => setAdded(settings?.added_floors ?? 0), [settings?.added_floors, building?.id])

  const useOpts: [string, string][] = ['site', ...Object.keys(site.uses)].map((u) => [u, USE_LABEL[u] ?? site.uses[u] ?? u])
  const sb = building ? site.buildings.find((x) => x.id === building.id) : null

  if (level.kind === 'site' || !building || !settings) {
    return (
      <Card title="Site">
        <p className="text-[13px] leading-relaxed text-ink-2">
          {site.buildings.length} buildings at {site.location.name}. <b className="font-medium text-ink">Pick a building</b> in the
          top bar or click one in the model, then a floor, then a unit.
        </p>
      </Card>
    )
  }

  const existing = building.kpi.existing_floors
  const floors = existing + added
  const setFloors = (n: number) => {
    const a = Math.max(0, Math.min(site.max_added, n - existing))
    setAdded(a)
    onChange({ added_floors: a })
  }
  const changed = status.changed.includes(building.id)
  const describe = (s: SavedScenario) => {
    const st = s.scenarios[building.id]
    if (!st) return 'Other buildings changed'
    const lab = (u: string) => (USE_LABEL[u] ?? site.uses[u] ?? u).replace('Current use (site data)', 'as today')
    return `${lab(st.ground_use)} + ${lab(st.use)}`
  }
  const save = () => {
    p.onSave((naming ?? '').trim() || `Scenario ${status.savedCount + 1}`)
    setNaming(null)
  }

  return (
    <>
      <section className="mb-3 overflow-hidden rounded-xl border bg-raised px-4 py-3.5 shadow-sm">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
          className={`checker-band -mx-4 -mt-3.5 flex w-[calc(100%+2rem)] items-center justify-between px-4 pb-3 pt-2 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-ink ${open ? 'mb-3' : '-mb-[1rem]'}`}>
          Building setup
          <span className="flex items-center gap-2">
            {loading && <span className="font-normal normal-case tracking-normal text-ink-2">updating…</span>}
            <span className={`transition-transform ${open ? '' : 'rotate-180'}`} aria-hidden>⌃</span>
          </span>
        </button>
        {open && (
          <>
            <div className="mb-2.5 text-[13.5px] font-semibold leading-snug">{building.id} · {building.name}</div>
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

            <div className="mb-1 flex items-center justify-between text-[12px] text-ink-2">
              <span>Number of floors</span>
              <span className="flex items-center gap-1">
                <button type="button" onClick={() => setFloors(floors - 1)} disabled={floors <= existing} aria-label="One floor less"
                  className="grid h-7 w-7 place-items-center rounded-md text-[16px] text-ink hover:bg-sunken disabled:opacity-30">−</button>
                <span className="grid h-7 w-9 place-items-center rounded-md border border-line bg-surface font-mono text-[13px] text-ink">{floors}</span>
                <button type="button" onClick={() => setFloors(floors + 1)} disabled={floors >= existing + site.max_added} aria-label="One floor more"
                  className="grid h-7 w-7 place-items-center rounded-md border border-line text-[16px] text-ink hover:bg-sunken disabled:opacity-30">+</button>
              </span>
            </div>
            <div className="mb-1">
              <Slider value={floors} min={existing} max={existing + site.max_added} onChange={(v) => setAdded(v - existing)}
                onCommit={(v) => setFloors(v)} />
            </div>
            <p className="mb-3 font-mono text-[10.5px] text-muted">{existing} existing{added ? ` + ${added} added` : ''}</p>
            {added > 0 && (
              <Field label="Use of the added floors">
                <Select value={settings.added_use} onChange={(v) => onChange({ added_use: v })}
                  options={[['same', USE_LABEL.same], ...useOpts.filter(([u]) => u !== 'site')]} />
              </Field>
            )}

            <Fold title="Facade & roof detail">
              {sb?.facade?.notes && <p className="mb-2 leading-snug">{sb.facade.notes}</p>}
              <Toggle on={settings.facade} onChange={(v) => onChange({ facade: v })} label="Show facade & roof detail" />
            </Fold>
            <Fold title="Core & services">
              <p className="leading-snug">
                Cores, stairs, lifts and the facade are retained structure: a change of use works around them. Partitions,
                finishes and doors are the space plan that changes.
              </p>
              <div className="mt-2">
                <Button onClick={onResetBuilding} disabled={!changed} title={changed ? undefined : 'This building is as it is today'}>
                  Undo changes to {building.id}
                </Button>
              </div>
            </Fold>

            {naming === null ? (
              <button type="button" onClick={() => setNaming('')}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border-2 border-edge bg-accent px-3 py-2.5 text-[13.5px] font-bold text-white shadow-sm transition-transform hover:-translate-y-px">
                {Icon.save} Save scenario
              </button>
            ) : (
              <div className="mt-2 flex gap-1.5">
                <input autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} placeholder="Name, e.g. Office transformation"
                  onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setNaming(null) }} aria-label="Scenario name"
                  className="min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-2.5 py-2 text-[13px] outline-none focus:border-ink-2" />
                <button type="button" onClick={save} className="rounded-lg bg-accent px-3 text-[13px] font-semibold text-white">Save</button>
              </div>
            )}
            <button type="button" onClick={p.timeline.onOpen} title={p.timeline.title}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border-2 border-edge bg-coral px-3 py-2.5 text-[13.5px] font-bold text-[#202020] shadow-sm transition-transform hover:-translate-y-px">
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <path d="M2 10h16" /><circle cx="5" cy="10" r="1.6" fill="currentColor" /><circle cx="10" cy="10" r="1.6" fill="currentColor" /><circle cx="15" cy="10" r="1.6" fill="currentColor" />
              </svg>
              {p.timeline.label}
            </button>
          </>
        )}
      </section>

      <section className="mb-3 overflow-hidden rounded-xl border bg-raised px-4 py-3.5 shadow-sm">
        <div className="checker-band -mx-4 -mt-3.5 mb-3 flex items-center justify-between px-4 pb-3 pt-2">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-ink">Scenarios</span>
          <button type="button" onClick={() => setNaming((n) => n ?? '')} aria-label="Save a new scenario" title="Save the current setup as a scenario"
            className="grid h-7 w-7 place-items-center rounded-md border-2 border-edge bg-surface text-[16px] text-ink hover:bg-sunken">+</button>
        </div>
        <ul className="space-y-1">
          <li>
            <button type="button" onClick={onResetBuilding}
              className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left ${!changed && !status.name ? 'border-l-[3px] border-accent bg-accent-soft' : 'hover:bg-sunken'}`}>
              <span className="mt-0.5 text-ink-2">{Icon.base}</span>
              <span><span className="block text-[13px] font-medium">Base case</span><span className="block text-[11.5px] text-ink-2">Current building</span></span>
            </button>
          </li>
          {p.saved.map((s, i) => (
            <li key={s.id}>
              <button type="button" onClick={() => p.onRestore(s)}
                className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left ${status.name === s.name ? 'border-l-[3px] border-accent bg-accent-soft' : 'hover:bg-sunken'}`}>
                <span className="mt-0.5 text-ink-2">{Icon.scen}</span>
                <span className="min-w-0"><span className="block truncate text-[13px] font-medium">{i + 1}. {s.name}</span>
                  <span className="block truncate text-[11.5px] text-ink-2">{describe(s)}</span></span>
              </button>
            </li>
          ))}
        </ul>
        <button type="button" onClick={p.onCompare} disabled={p.saved.length === 0}
          className="mt-2.5 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-[13px] font-medium hover:border-ink-2 disabled:opacity-40">
          Compare scenarios
        </button>
      </section>

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
