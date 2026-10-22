import type { Layer } from '../layers'

const LABEL: Record<Layer, string> = { none: 'None', movement: 'Movement', fire: 'Fire escape', capacity: 'Capacity', vacancy: 'Vacancy' }
const HINT: Record<Layer, string> = {
  none: 'No layer',
  movement: 'How busy each floor is at the peak, and trips to Liljeholmen station. On a B01 floor: people walking and the busiest routes.',
  fire: 'Longest escape walk against the 45 m limit (B01, drawn plans). On a B01 floor: escape distances and a JuPedSim evacuation.',
  capacity: 'People planned against the legal maximum, and whether every standards and safety check passes.',
  vacancy: 'Vacancy per building in the chosen year of the 10-year district model.',
}

/** The explorer's layers, switchable at every scale. */
export function LayerBar({ layer, setLayer, vacancy }: { layer: Layer; setLayer: (l: Layer) => void; vacancy: boolean }) {
  const ids: Layer[] = ['none', 'movement', 'fire', 'capacity', ...(vacancy ? ['vacancy' as Layer] : [])]
  return (
    <nav className="flex items-center gap-0.5 rounded-lg border border-line bg-raised/95 p-1 text-[12.5px] shadow-sm" aria-label="Layers">
      <span className="px-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-wide text-ink-2">Layers</span>
      {ids.map((id) => (
        <button key={id} onClick={() => setLayer(id)} title={HINT[id]} aria-pressed={layer === id}
          className={`rounded-md px-2.5 py-1 font-medium transition-colors ${layer === id ? 'bg-accent text-white' : 'text-ink-2 hover:text-ink'}`}>
          {LABEL[id]}
        </button>
      ))}
    </nav>
  )
}

export const LAYER_LEGEND: Record<Exclude<Layer, 'none'>, { title: string; bins: { color: string; label: string }[] }> = {
  capacity: { title: 'People planned ÷ legal maximum', bins: [
    { color: '#03b05f', label: '< 60 %' }, { color: '#9fcf4a', label: '60–85 %' }, { color: '#f5c443', label: '85–100 %' },
    { color: '#d8342b', label: 'over / check fails' }, { color: '#9a978e', label: 'estimate, no plan' }] },
  fire: { title: 'Longest escape walk ÷ 45 m limit', bins: [
    { color: '#03b05f', label: '< 60 %' }, { color: '#9fcf4a', label: '60–85 %' }, { color: '#f5c443', label: '85–100 %' },
    { color: '#d8342b', label: 'over the limit' }, { color: '#9a978e', label: 'needs plans' }] },
  movement: { title: 'People at the peak, per floor', bins: [
    { color: 'rgb(236,233,224)', label: 'few' }, { color: 'rgb(121,136,113)', label: '' }, { color: 'rgb(5,40,202)', label: 'most' },
    { color: '#0528ca', label: 'trips to the station' }] },
  vacancy: { title: 'Vacancy in the chosen year', bins: [
    { color: '#03b05f', label: '< 9 %' }, { color: '#9fcf4a', label: '9–13 %' }, { color: '#f5c443', label: '13–15 %' },
    { color: '#fd876e', label: '15–17 %' }, { color: '#d8342b', label: '> 17 %' }] },
}
