// Life on the site at Urban scale: AMF's events and activities timeline and the amenities around Marievik.
// Server side: explorer/urban_life.py, data/projects/<project>/urban_life.json.

export interface LifeItem {
  id: string; name: string; kind: 'permanent' | 'temporary'; year: number; category: string
  x: number | null; y: number | null; building: string | null
  place: string; confidence: 'address' | 'osm' | 'approx' | 'unknown'; note: string; url: string | null
}
export interface Amenity { name: string; type: string; x: number; y: number; addr: string; source: string }
export interface UrbanLife {
  _meta: Record<string, string>
  categories: Record<string, { label: string; colour: string }>
  timeline: LifeItem[]
  amenities: Amenity[]
}

export const AMENITY_TYPES: Record<string, { label: string; colour: string }> = {
  restaurant: { label: 'Restaurant', colour: '#fd876e' }, cafe: { label: 'Café', colour: '#c97855' },
  bar: { label: 'Bar', colour: '#8a72d8' }, fast_food: { label: 'Fast food', colour: '#f5c443' },
  hotel: { label: 'Hotel', colour: '#0528ca' }, spa: { label: 'Spa / beauty', colour: '#3d8fd1' },
  venue: { label: 'Event venue', colour: '#c46ba4' }, community: { label: 'Community', colour: '#dfa00c' },
  park: { label: 'Park', colour: '#128f6e' }, playground: { label: 'Playground', colour: '#7fa067' },
  supermarket: { label: 'Supermarket', colour: '#9a978e' },
}

/** On the map in year `y`: a permanent item from its year on, a temporary one in its own year only. */
export const activeIn = (t: LifeItem, y: number) => (t.kind === 'permanent' ? t.year <= y : t.year === y)
