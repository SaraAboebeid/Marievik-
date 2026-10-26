import { useState, type ReactNode } from 'react'
import { Badge, Card, Row, Section, Select, Slider, Stat, StatGrid } from './kit'
import type { CompareRow, StudioMeta, StudioModel } from '../studio/engine'
import type { Scenario } from '../studio/crowd'
import type { StudioView } from '../viewer/Viewer'

// On a studio floor the left panel holds what you change (layout, walls, generated plans, who comes in) and the
// right panel what comes out of it (checks, a day on the floor, rooms, evacuation, tenancy), each in tabs.

const VIEWS: [StudioView, string][] = [['furniture', 'Furniture'], ['capacity', 'Capacity'], ['tenancy', 'Rented / vacant'], ['use', 'Room use'], ['fire', 'Fire escape'], ['move', 'Movement']]
const SCENARIOS: [Scenario, string][] = [['day', 'Normal day'], ['arrive', 'Morning arrival'], ['lunch', 'Lunch']]
const ksek = (n: number) => Math.round(n / 1000).toLocaleString('sv-SE')
const msek = (n: number) => (n / 1e6).toLocaleString('sv-SE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
// what each server check rests on (explorer/studio/engine.py figures())
const CHECK_NOTE: Record<string, (m: StudioModel) => string> = {
  escape: (m) => `Real walking route around walls and furniture to the nearest ${m.ground ? 'exit door' : 'stair'}`,
  wc: (m) => (m.layout.use === 'office' || m.layout.use === 'cowork' ? '1 per started 15 employees' : '1 per 50 guests plus staff (example)'),
  accessible_wc: () => 'At least one per floor',
  reach: () => 'A clear walking route from each seat',
  load: () => 'Legal maximum: room areas × occupancy density (BBR table; others are examples)',
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-0.5 rounded-md border-2 border-edge p-0.5">
      {options.map(([id, label]) => (
        <button key={id} type="button" onClick={() => onChange(id)} aria-pressed={value === id}
          className={`rounded px-2 py-0.5 text-[12px] font-semibold ${value === id ? 'bg-accent text-white' : 'text-ink-2 hover:text-ink'}`}>{label}</button>
      ))}
    </div>
  )
}

/** One tab at a time, the choice remembered in this browser. */
function useTab<T extends string>(key: string, tabs: [T, string][]) {
  const [tab, setTab] = useState<T>(() => {
    try { const t = localStorage.getItem(key) as T | null; return t && tabs.some(([id]) => id === t) ? t : tabs[0][0] } catch { return tabs[0][0] }
  })
  return [tab, (t: T) => { setTab(t); try { localStorage.setItem(key, t) } catch { /* private window */ } }] as const
}

function Tabs<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (t: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-x-1 gap-y-0.5 border-b-2 border-line">
      {options.map(([id, text]) => (
        <button key={id} type="button" role="tab" aria-selected={value === id} onClick={() => onChange(id)}
          className={`-mb-[2px] border-b-2 px-1.5 pb-1 pt-0.5 text-[12.5px] font-semibold ${value === id ? 'border-accent text-accent' : 'border-transparent text-ink-2 hover:text-ink'}`}>
          {text}
        </button>
      ))}
    </div>
  )
}

export interface CapacityState {
  busy: 'maximise' | 'compare' | null
  result: { before: { people: number; allOk: boolean }; after: { people: number; allOk: boolean; failed: string[] } } | null
  rows: CompareRow[] | null
}

type ChangeTab = 'layout' | 'walls' | 'plans' | 'people'
const CHANGE_TABS: [ChangeTab, string][] = [['layout', 'Layout'], ['walls', 'Walls'], ['plans', 'Plans'], ['people', 'People']]

/** Left panel on a studio floor: everything you can change. Pick a layout (or compare them all), move its walls
 *  (or let the search fit the most people), pick a generated plan, set who comes in. */
export function StudioChangePanel({ model, meta, floorLabel, layout, layouts, setLayout, setParam, onReset, timelineShown, onTimeline,
  capacity, onMaximise, onCompare, onPickRow, plans, people }: {
  model: StudioModel; meta: StudioMeta; floorLabel: string
  layout: string; layouts: string[]; setLayout: (id: string) => void; setParam: (key: string, v: number) => void; onReset: () => void
  timelineShown: boolean; onTimeline: () => void
  capacity: CapacityState; onMaximise: () => void; onCompare: () => void; onPickRow: (r: CompareRow) => void
  plans: ReactNode; people: ReactNode
}) {
  const L = model.layout
  const [tab, setTab] = useTab('mvx-studio-change-tab', CHANGE_TABS)
  const name = (id: string) => meta.layouts[id]?.name ?? (id.startsWith('gen-') ? `Generated plan ${id.slice(4)}` : id)
  return (
    <>
      <Card title={`${floorLabel} · change`}>
        <label className="mb-2.5 block text-[12px] text-ink-2">
          <span className="mb-1 block">Layout today</span>
          <Select value={layout} onChange={setLayout} options={[...layouts, ...(layouts.includes(layout) ? [] : [layout])].map((id) => [id, name(id)])} />
        </label>
        <Tabs value={tab} options={CHANGE_TABS} onChange={setTab} label="What to change" />
      </Card>

      {tab === 'layout' && (
        <Section id="studio-layout" title="Layouts for this floor">
          <button type="button" onClick={onTimeline} aria-pressed={timelineShown}
            className={`mb-2.5 w-full rounded-md border-2 border-edge px-2 py-1 text-[12.5px] font-semibold ${timelineShown ? 'bg-surface' : 'bg-coral text-[#202020]'}`}>
            {timelineShown ? 'Hide the 10-year timeline' : 'Show the 10-year timeline'}
          </button>
          <p className="mb-2 text-[12px] leading-snug text-ink-2">
            Every drawn layout this floor can take, each with its walls placed for the most people, and what changing to it would cost. Click one to use it.
          </p>
          <button type="button" onClick={onCompare} disabled={!!capacity.busy}
            className="mb-2 rounded-md border-2 border-edge bg-surface px-2.5 py-1 text-[12.5px] font-semibold disabled:opacity-50">
            {capacity.busy === 'compare' ? 'Comparing…' : 'Compare all layouts'}
          </button>
          {capacity.rows && (
            <table className="w-full text-[11.5px]">
              <thead><tr className="text-left font-mono text-[10px] uppercase text-muted"><th className="pb-1">Layout, walls optimised</th><th className="pb-1 text-right">People</th><th className="pb-1 text-right">Change</th></tr></thead>
              <tbody>
                {capacity.rows.map((r) => (
                  <tr key={r.layout} onClick={() => onPickRow(r)} title={r.allOk ? 'Use this layout with these walls' : `Fails: ${r.failed.join('; ')}`}
                    className={`cursor-pointer border-t border-line hover:bg-sunken ${r.layout === layout ? 'font-semibold' : ''}`}>
                    <td className="py-0.5">
                      <span className={r.allOk ? '' : 'text-serious'}>{r.allOk ? '✓' : '✗'}</span> {r.name}
                      {!r.allOk && <span className="block text-[10.5px] text-serious">{r.failed[0]}</span>}
                    </td>
                    <td className="text-right tabular-nums">{r.people}</td>
                    <td className="text-right tabular-nums">{r.changeSek ? `${msek(r.changeSek)} MSEK` : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      )}

      {tab === 'walls' && (
        <Section id="studio-walls" title="Move walls">
          {!L.handles.length ? (
            <p className="text-[12px] text-muted">This layout has no movable walls. Generated plans are fixed: generate more plans to try other arrangements.</p>
          ) : (
            <>
              <button type="button" onClick={onMaximise} disabled={!!capacity.busy}
                className="mb-2 rounded-md border-2 border-edge bg-coral px-2.5 py-1 text-[12.5px] font-semibold text-[#202020] disabled:opacity-50">
                {capacity.busy === 'maximise' ? 'Searching…' : 'Fit the most people safely'}
              </button>
              <p className="mb-2 text-[11.5px] leading-snug text-muted">Moves the walls within their limits and keeps the positions that fit the most people while escape routes, stairs, WCs and the legal maximum all still pass.</p>
              {capacity.result && (
                <p className="mb-2 rounded-md border-2 border-line bg-sunken px-2.5 py-1.5 text-[12px]">
                  {capacity.result.before.people} → <b>{capacity.result.after.people} people</b>
                  {capacity.result.after.allOk ? ', every check passing.' : `; still failing: ${capacity.result.after.failed.join('; ')}`}
                  {!capacity.result.before.allOk && capacity.result.after.allOk ? ' The layout as drawn did not pass.' : ''}
                </p>
              )}
              {L.handles.map((h) => (
                <label key={h.key} className="mb-2 block text-[12px] text-ink-2">
                  <span className="mb-0.5 flex justify-between"><span>{h.label}</span><span className="font-mono text-ink">{model.p[h.key].toFixed(1)} m</span></span>
                  <Slider value={model.p[h.key]} min={h.min} max={h.max} step={0.15} onChange={(v) => setParam(h.key, v)} />
                </label>
              ))}
              {model.edit && (
                <div className="mt-1 rounded-md border-2 border-line bg-sunken px-2.5 py-2 text-[12px]">
                  {model.edit.rows.map((r) => <Row key={r.what} label={r.what} value={`${ksek(r.sek)} kSEK`} sub />)}
                  <Row strong label="Moving these walls" value={`${ksek(model.edit.sek)} kSEK · ${(model.edit.kg / 1000).toFixed(1)} t CO₂e`} />
                  <p className="mt-1 text-muted">
                    {model.edit.peopleDelta >= 0 ? '+' : ''}{model.edit.peopleDelta} people, {model.edit.seatsDelta >= 0 ? '+' : ''}{model.edit.seatsDelta} seats against the layout as drawn.
                  </p>
                  <button type="button" onClick={onReset} className="mt-1.5 rounded-md border-2 border-edge bg-surface px-2 py-0.5 text-[12px] font-semibold">Put the walls back</button>
                </div>
              )}
            </>
          )}
        </Section>
      )}

      {tab === 'plans' && plans}
      {tab === 'people' && people}
    </>
  )
}

type ResultTab = 'checks' | 'day' | 'rooms' | 'evac' | 'tenancy'
const RESULT_TABS: [ResultTab, string][] = [['checks', 'Checks'], ['day', 'A day'], ['rooms', 'Rooms'], ['evac', 'Evacuation'], ['tenancy', 'Tenancy']]

/** Right panel on a studio floor: what the floor as laid out holds and how it performs. */
export function StudioPanel({ model, view, setView, floorLabel, scenario, setScenario, heat, setHeat, crowdNote, loading, day, evac, tenancy }: {
  model: StudioModel; view: StudioView; setView: (v: StudioView) => void; floorLabel: string
  scenario: Scenario; setScenario: (s: Scenario) => void; heat: boolean; setHeat: (v: boolean) => void; crowdNote: string; loading: boolean
  day: ReactNode; evac: ReactNode; tenancy: ReactNode   // the simulated day, evacuation and who rents what, each on its own tab
}) {
  const f = model.fig, L = model.layout, office = L.use === 'office' || L.use === 'cowork'
  const [tab, setTabState] = useTab('mvx-studio-result-tab', RESULT_TABS)
  const setTab = (t: ResultTab) => {
    setTabState(t)
    if (t === 'evac') setView('fire')        // the evacuation plays on the plan
    if (t === 'tenancy') setView('tenancy')  // and the suites are coloured on it
  }
  return (
    <>
      <Card title={`${floorLabel} · results`} right={<Badge tone="warn">{loading ? 'updating…' : 'mock-up · example data'}</Badge>}>
        <span className="mb-1 block text-[11px] text-muted">On the plan</span>
        <div className="mb-2.5"><Seg value={view} options={VIEWS} onChange={setView} /></div>
        {view === 'move' && (
          <div className="mb-2.5 flex flex-wrap items-center gap-2">
            <Seg value={scenario} options={SCENARIOS} onChange={setScenario} />
            <button type="button" onClick={() => setHeat(!heat)} aria-pressed={heat}
              className={`rounded-md border-2 border-edge px-2 py-0.5 text-[12px] font-semibold ${heat ? 'bg-coral text-[#202020]' : 'bg-surface'}`}>Busy routes</button>
            <span className="text-[11.5px] text-muted">{crowdNote}</span>
          </div>
        )}
        <Tabs value={tab} options={RESULT_TABS} onChange={setTab} label="Results" />
      </Card>

      {tab === 'day' && day}
      {tab === 'evac' && evac}
      {tab === 'tenancy' && (tenancy ?? <Card title="Tenancy"><p className="text-[12px] text-muted">No tenancy figures for this floor yet.</p></Card>)}

      {tab === 'checks' && (
        <Section id="studio-checks" title={L.name}>
          <StatGrid>
            {office ? (
              <>
                <Stat label="workplaces (desks)" value={f.workDesks} />
                <Stat label={L.deskRatio ? `people at ${L.deskRatio} desks per person` : 'people, one desk each'} value={f.staff} />
              </>
            ) : (
              <>
                <Stat label={L.use === 'ground' ? 'visitor and café seats' : 'guest seats'} value={f.guests} />
                <Stat label="staff desks" value={f.workDesks} />
              </>
            )}
            <Stat label="other seats (meeting, lounge…)" value={f.otherSeats} />
            <Stat label="legal maximum on the floor (fire)" value={f.designLoad} />
            <Stat label="longest walk to an exit" value={f.worst ? f.worst.d.toFixed(1) : '–'} unit="m" />
            <Stat label="gross floor area" value={f.gfa.toLocaleString('sv-SE')} unit="m²" />
          </StatGrid>
          <ul className="mt-2.5 space-y-1.5">
            {f.checks.map((c) => {
              const exit = f.exitLoad.find((x) => `exit:${x.id}` === c.id)
              const note = exit ? `${exit.w} m door, 1.0 m per 150 people` : CHECK_NOTE[c.id]?.(model)
              return (
                <li key={c.id} className="flex items-start gap-2 text-[12.5px]">
                  <Badge tone={c.ok ? 'good' : 'serious'}>{c.ok ? 'OK' : 'Check'}</Badge>
                  <span>{c.text}{note && <span className="block text-[11px] text-muted">{note}</span>}</span>
                </li>
              )
            })}
          </ul>
        </Section>
      )}

      {tab === 'rooms' && (
        <Section id="studio-rooms" title="Rooms and seats">
          <table className="w-full text-[12px]">
            <thead><tr className="text-left font-mono text-[10.5px] uppercase text-muted"><th className="pb-1">Room</th><th className="pb-1 text-right">m²</th><th className="pb-1 text-right">Seats</th><th className="pb-1 text-right">Max</th></tr></thead>
            <tbody>
              {model.openSeats > 0 && <tr className="border-t border-line"><td className="py-0.5">Open area and zones</td><td /><td className="text-right tabular-nums">{model.openSeats}</td><td /></tr>}
              {model.roomFig.slice().sort((a, b) => b.seats - a.seats || b.r.area - a.r.area).map((rf) => (
                <tr key={rf.r.id} className={`border-t border-line ${rf.seats > rf.max && rf.max > 0 ? 'text-serious' : ''}`}>
                  <td className="py-0.5">{rf.r.name}</td><td className="text-right tabular-nums">{rf.r.area.toFixed(0)}</td>
                  <td className="text-right tabular-nums">{rf.seats}</td><td className="text-right tabular-nums">{rf.max}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </>
  )
}
