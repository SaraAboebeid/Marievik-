import type { ReactNode } from 'react'
import { Slider } from './kit'
import { Seg } from './StudioPanel'
import { LAYER_HINT, LAYER_LABEL } from './LayerBar'
import { LAYERS_AT, LAYER_ORDER, type Layer } from '../layers'
import type { StudioView } from '../viewer/Viewer'
import type { Scenario } from '../studio/crowd'

// Floor scale uses the same lens row as the other scales, plus Room use; each lens it has is one of the floor's own
// views (None = the plain furnished plan, Vacancy = the floor zoned rented/vacant). The rest grey out.
type FloorLens = Layer | 'use'
const FLOOR_ORDER: FloorLens[] = ['none', 'use','movement', 'fire', 'capacity', 'vacancy', 'tenancy', 'flexibility']
const FLOOR_VIEW: Partial<Record<FloorLens, StudioView>> = { none: 'furniture', use: 'use', movement: 'move', fire: 'fire', capacity: 'capacity', vacancy: 'tenancy' }
const FLOOR_HINT: Partial<Record<FloorLens, string>> = {
  none: 'The furnished plan, no colouring', use: 'What each room is used for, through a working day',
  movement: 'People walking and the busiest routes', fire: 'Escape distances and a JuPedSim evacuation',
  capacity: 'People planned against the legal maximum, room by room', vacancy: 'The floor zoned into rented and vacant spaces',
}
const SCENARIOS: [Scenario, string][] = [['day', 'Normal day'], ['arrive', 'Morning arrival'], ['lunch', 'Lunch']]
export type FireMode = 'static' | 'sim'

/** A lens's own options, under the lens row on the right (top of the right panel): Movement's scenario and busy
 *  routes, Fire escape's static zones or the JuPedSim evacuation (its run/play controls in `evac`). */
export function LensOptions({ view, scenario, setScenario, heat, setHeat, crowdNote, fireMode, setFireMode, evac }: {
  view: StudioView
  scenario: Scenario; setScenario: (s: Scenario) => void; heat: boolean; setHeat: (v: boolean) => void; crowdNote: string
  fireMode: FireMode; setFireMode: (m: FireMode) => void; evac: ReactNode
}) {
  if (view !== 'move' && view !== 'fire') return null
  const seg = 'flex flex-wrap gap-1 rounded-md border-2 border-edge bg-surface p-1 text-[12px]'
  return (
    <div className="mb-2.5 rounded-lg border-2 border-edge bg-raised p-2 shadow-[3px_3px_0_var(--color-edge)]">
      <div className="mb-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em]">{view === 'move' ? 'Movement' : 'Fire escape'}</div>
      {view === 'move' ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Seg value={scenario} options={SCENARIOS} onChange={setScenario} wrapClass={seg} />
          <button type="button" onClick={() => setHeat(!heat)} aria-pressed={heat} title={crowdNote}
            className={`rounded-md border-2 border-edge px-2.5 py-1 text-[12px] font-semibold ${heat ? 'bg-coral text-[#202020]' : 'bg-surface'}`}>
            Busy routes
          </button>
        </div>
      ) : (
        <>
          <Seg value={fireMode} options={[['static', 'Zones & distances'], ['sim', 'Evacuation simulation']]} onChange={setFireMode} wrapClass={seg}
            hint={{ static: 'Escape distances to each stair against the 45 m limit, and how many people use each exit', sim: 'People walking out, simulated with JuPedSim: how long it takes and where it crowds' }} />
          {fireMode === 'sim' && <div className="mt-2">{evac}</div>}
        </>
      )}
    </div>
  )
}

const pill = 'flex flex-wrap items-center gap-1 rounded-md border-2 border-edge bg-surface p-1 text-[12.5px] shadow-[3px_3px_0_var(--color-edge)]'

/** The explorer's one lens picker, top bar, every scale: site-wide layers (whole building / district, mostly
 *  estimated) when no floor is open, swapping to that floor's own views (real data where B01 has drawn plans)
 *  once you open one — the same names meant two different button rows before; now there's one, one place. */
export function LensPanel({ floorOpen, scale, layer, setLayer, view, setView, explode, setExplode }: {
  floorOpen: boolean
  scale: 'urban' | 'district' | 'building'   // decides which lenses can be picked (layers.ts LAYERS_AT); the rest grey out
  layer: Layer; setLayer: (l: Layer) => void
  view: StudioView; setView: (v: StudioView) => void
  explode: number; setExplode: (v: number) => void   // pull every floor apart to see them all at once
}) {
  const allowed = LAYERS_AT[scale]
  const where = (l: Layer) => (['urban', 'district', 'building'] as const).filter((s) => LAYERS_AT[s].includes(l)).join(' and ')
  const disabled = Object.fromEntries(LAYER_ORDER.filter((l) => !allowed.includes(l))
    .map((l) => [l, `${LAYER_LABEL[l]}: not at ${scale} scale — available at ${where(l)} scale`])) as Partial<Record<Layer, string>>
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {floorOpen ? (
        <>
          <Seg value={FLOOR_ORDER.find((l) => FLOOR_VIEW[l] === view) ?? 'none'}
            options={FLOOR_ORDER.map((l) => [l, l === 'use' ? 'Room use' : LAYER_LABEL[l]] as [FloorLens, string])}
            onChange={(l) => { const v = FLOOR_VIEW[l]; if (v) setView(v) }} hint={FLOOR_HINT} wrapClass={pill}
            disabled={Object.fromEntries(FLOOR_ORDER.filter((l) => !FLOOR_VIEW[l]).map((l) => [l, `${LAYER_LABEL[l as Layer]}: not at floor scale`]))} />
        </>
      ) : (
        <Seg value={layer} options={LAYER_ORDER.map((id) => [id, LAYER_LABEL[id]] as [Layer, string])} onChange={setLayer}
          hint={LAYER_HINT} wrapClass={pill} disabled={disabled} />
      )}
      <label className={`${pill} cursor-pointer gap-2 px-3 py-1.5`} title="Explode floors: pull every floor apart and show each one's real plan - walls, rooms and units, not just the box.">
        <input type="checkbox" className="h-3.5 w-3.5 accent-[color:var(--color-accent)]" checked={explode > 0}
          onChange={(e) => setExplode(e.target.checked ? 3 : 0)} aria-label="Explode floors" />
        <span className="font-semibold text-ink-2">Explode</span>
        <span className="w-20"><Slider value={explode} min={0} max={8} step={0.5} onChange={setExplode} /></span>
        <span className="font-mono text-ink-2">{explode.toFixed(1)} m</span>
      </label>
    </div>
  )
}
