import { Slider } from './kit'
import { Seg } from './StudioPanel'
import { LAYER_HINT, LAYER_LABEL } from './LayerBar'
import type { Layer } from '../layers'
import type { StudioView } from '../viewer/Viewer'
import type { Scenario } from '../studio/crowd'

const FLOOR_VIEWS: [StudioView, string][] = [['furniture', 'Furniture'], ['capacity', 'Capacity'], ['tenancy', 'Rented / vacant'], ['use', 'Room use'], ['fire', 'Fire escape'], ['move', 'Movement']]
const SCENARIOS: [Scenario, string][] = [['day', 'Normal day'], ['arrive', 'Morning arrival'], ['lunch', 'Lunch']]
const pill = 'flex flex-wrap items-center gap-1 rounded-md border-2 border-edge bg-surface p-1 text-[12.5px] shadow-[3px_3px_0_var(--color-edge)]'

/** The explorer's one lens picker, top bar, every scale: site-wide layers (whole building / district, mostly
 *  estimated) when no floor is open, swapping to that floor's own views (real data where B01 has drawn plans)
 *  once you open one — the same names meant two different button rows before; now there's one, one place. */
export function LensPanel({ floorOpen, onlyVacancy, tour = false, layer, setLayer, view, setView, scenario, setScenario, heat, setHeat, crowdNote, explode, setExplode }: {
  floorOpen: boolean
  onlyVacancy: boolean   // a single building, no floor open: Movement/Fire/Capacity move to the floor's own views
  tour?: boolean         // District and Building scale: the rented / vacant dusk tour is on offer
  layer: Layer; setLayer: (l: Layer) => void
  view: StudioView; setView: (v: StudioView) => void
  scenario: Scenario; setScenario: (s: Scenario) => void; heat: boolean; setHeat: (v: boolean) => void; crowdNote: string
  explode: number; setExplode: (v: number) => void   // pull every floor apart to see them all at once
}) {
  const siteIds: Layer[] = [...(onlyVacancy ? ['none', 'vacancy'] as Layer[] : ['none', 'movement', 'fire', 'capacity', 'vacancy'] as Layer[]), ...(tour ? ['tenancy'] as Layer[] : [])]
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {floorOpen ? (
        <>
          <Seg value={view} options={FLOOR_VIEWS} onChange={setView} wrapClass={pill} />
          {view === 'move' && (
            <>
              <Seg value={scenario} options={SCENARIOS} onChange={setScenario} wrapClass={pill} />
              <button type="button" onClick={() => setHeat(!heat)} aria-pressed={heat} title={crowdNote}
                className={`rounded-md border-2 border-edge px-3 py-1 text-[12px] font-semibold shadow-[3px_3px_0_var(--color-edge)] ${heat ? 'bg-coral text-[#202020]' : 'bg-surface'}`}>
                Busy routes
              </button>
            </>
          )}
        </>
      ) : (
        <Seg value={layer} options={siteIds.map((id) => [id, LAYER_LABEL[id]] as [Layer, string])} onChange={setLayer} hint={LAYER_HINT} wrapClass={pill} />
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
