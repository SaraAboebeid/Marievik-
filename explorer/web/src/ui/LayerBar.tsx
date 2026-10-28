import type { Layer } from '../layers'

// Labels/hints and the result legend for the explorer's site-wide layers (left panel, ui/LensPanel.tsx, when no
// floor is open — a floor open shows that floor's own views instead, same picker, see LensPanel.tsx).
export const LAYER_LABEL: Record<Layer, string> = { none: 'None', amenities: 'Amenities', movement: 'Movement', fire: 'Fire escape', capacity: 'Capacity', vacancy: 'Vacancy', tenancy: 'Rented / vacant', flexibility: 'Flexibility' }
export const LAYER_HINT: Record<Layer, string> = {
  none: 'No layer',
  amenities: 'Restaurants, cafés, shops and the rest within a walk of Marievik (OpenStreetMap), as tokens on the map.',
  movement: 'How busy each floor is at the peak, and trips to Liljeholmen station. On a B01 floor: people walking and the busiest routes.',
  fire: 'Longest escape walk against the 45 m limit (B01, drawn plans). On a B01 floor: escape distances and a JuPedSim evacuation.',
  capacity: 'People planned against the legal maximum, and whether every standards and safety check passes.',
  vacancy: "Today's real/placeholder vacancy per building, or the chosen year of the 10-year district model once you've run it.",
  flexibility: 'Smartax walls against fixed gypsum walls on one B01 floor through a year: pick a use per quarter and watch both floors change — cost, carbon, waste and weeks closed.',
  tenancy: 'A dusk tour around the buildings: example spaces lit when rented, dark when vacant, in each building\'s share (today, or the chosen year of the district model). Drag to look around; the tour carries on after.',
}

export const LAYER_LEGEND: Record<Exclude<Layer, 'none' | 'amenities' | 'flexibility'>, { title: string; bins: { color: string; label: string }[] }> = {
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
  tenancy: { title: 'Example spaces at dusk', bins: [
    { color: '#ffc45e', label: 'lit: rented' }, { color: '#1f2836', label: 'dark: vacant' }] },
}
