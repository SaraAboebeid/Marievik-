// Seasons & hours (Urban / District scale): one day in each season at Marievik, played from morning to the next
// morning. What the outdoor places host and what the ground floors become after office hours, how the weather
// and the light change. A programme to argue with, not data: invented from the tenants on the ground floors
// (data/projects/marievik/ground_floors.json via /api/floor/{id}/0) and the open spaces in the context.

import { dayOfYear, sunPosition } from './viewer/sun'

export type SeasonId = 'spring' | 'summer' | 'autumn' | 'winter'
export interface Season { id: SeasonId; label: string; icon: string; month: number; day: number; tint: string }
export const SEASONS: Season[] = [
  { id: 'spring', label: 'Spring', icon: '🌸', month: 4, day: 26, tint: '#9fcf4a' },
  { id: 'summer', label: 'Summer', icon: '☀️', month: 7, day: 4, tint: '#f5c443' },
  { id: 'autumn', label: 'Autumn', icon: '🍂', month: 10, day: 17, tint: '#e0782f' },
  { id: 'winter', label: 'Winter', icon: '❄️', month: 12, day: 13, tint: '#7fb6e6' },
]
const LAT = 59.3095, LON = 18.028, TZ = 1   // Marievik; local standard time
export function sunAt(season: number, hour: number) {
  const s = SEASONS[season]
  return sunPosition(LAT, LON, TZ, dayOfYear(s.month, s.day), hour - (s.month >= 4 && s.month <= 10 ? 1 : 0))   // clock shows summer time
}
/** 0 in daylight, 1 in the dark, through civil twilight. */
export function nightOf(season: number, hour: number) {
  const a = sunAt(season, hour).altitude
  return Math.min(1, Math.max(0, (3 - a) / 9))
}

// ------------------------------------------------------------------ the activity families (colour, glow)
export type Kind = 'work' | 'food' | 'culture' | 'party' | 'craft' | 'well' | 'shop' | 'home' | 'closed'
export const KINDS: Record<Kind, { label: string; colour: string }> = {
  work: { label: 'Work', colour: '#9fb3c8' },
  food: { label: 'Food & drink', colour: '#fd876e' },
  culture: { label: 'Culture & learning', colour: '#8a72d8' },
  party: { label: 'Nightlife & events', colour: '#e0479e' },
  craft: { label: 'Crafts & making', colour: '#dfa00c' },
  well: { label: 'Wellbeing & sport', colour: '#2fb5a0' },
  shop: { label: 'Shops & markets', colour: '#f5c443' },
  home: { label: 'Residents', colour: '#c9c2b0' },
  closed: { label: 'Closed', colour: '#5d6168' },
}

// ------------------------------------------------------------------ weather
export interface Weather { rain: number; snow: number; leaves: number; petals: number; cover: number; label: string; icon: string }
/** Weather on the season's day at this hour (hour may run past 24 into the next morning). */
export function weatherAt(season: number, hour: number): Weather {
  const h = hour % 24
  const win = (a: number, b: number) => (h >= a && h < b ? 1 : 0)
  const id = SEASONS[season].id
  if (id === 'spring') {
    const rain = win(14, 16.5)
    return { rain, snow: 0, leaves: 0, petals: 1, cover: 0, label: rain ? 'April shower' : 'Blossom & sun', icon: rain ? '🌦️' : '🌸' }
  }
  if (id === 'summer') return { rain: 0, snow: 0, leaves: 0, petals: 0, cover: 0, label: h > 21 || h < 4 ? 'Light summer night' : 'Sunny, 24 °C', icon: '☀️' }
  if (id === 'autumn') {
    const rain = win(15, 21)
    return { rain, snow: 0, leaves: 1, petals: 0, cover: 0, label: rain ? 'Rain & falling leaves' : 'Falling leaves', icon: rain ? '🌧️' : '🍂' }
  }
  const t = hour < 6 ? hour + 24 : hour   // the winter day runs 06:00 → 06:00
  const snow = (t >= 6 && t < 13) || (t >= 18 && t < 26) ? 1 : 0
  return { rain: 0, snow, leaves: 0, petals: 0, cover: Math.min(1, 0.45 + 0.55 * Math.min(1, (t - 6) / 10)), label: snow ? 'Snowing, −4 °C' : 'Crisp and clear, −6 °C', icon: snow ? '🌨️' : '❄️' }
}

// ------------------------------------------------------------------ outdoor places
export interface Zone { id: string; name: string; p: [number, number]; note: string }
/** The open places round the site (plan coordinates from the context: the park by B07, the bathing pier, the quay
 *  by B04, the square by B03 and Origin, the park south of B12). */
export const ZONES: Zone[] = [
  { id: 'park', name: 'Marieviksparken', p: [131, 3], note: 'the park on the water by B07' },
  { id: 'badet', name: 'Marieviksbadet', p: [187, -8], note: 'the bathing pier' },
  { id: 'kajen', name: 'Kajen', p: [132, -46], note: 'the quay by B04 and Själsfränder' },
  { id: 'torget', name: 'Sjövikstorget', p: [26, -95], note: 'the square by B03 and Origin' },
  { id: 'sodra', name: 'Södra parken', p: [-147, -252], note: 'the park south of B12' },
]
export interface Activity { zone: string; name: string; kind: Kind; from: number; to: number; kit: string; crowd: number; lights?: string[] }
/** What each place hosts in each season, and when (hours; `to` past 24 runs into the night). `kit` is what the
 *  model builds there (viewer/seasonShow.ts); `crowd` how many people it draws at its peak. */
export const PROGRAMME: Record<SeasonId, Activity[]> = {
  spring: [
    { zone: 'park', name: 'Spring food market & BBQ', kind: 'food', from: 10, to: 19, kit: 'foodmarket', crowd: 70 },
    { zone: 'park', name: 'Blossom picnic, live acoustic set', kind: 'culture', from: 19, to: 22, kit: 'acoustic', crowd: 35, lights: ['#ffd27a', '#ff9ec7'] },
    { zone: 'badet', name: 'Kayak & SUP from the pier', kind: 'well', from: 10, to: 19, kit: 'kayaks', crowd: 14 },
    { zone: 'badet', name: 'Sauna evenings', kind: 'well', from: 17, to: 22, kit: 'sauna', crowd: 10 },
    { zone: 'kajen', name: 'Flea market on the quay', kind: 'shop', from: 10, to: 16, kit: 'flea', crowd: 45 },
    { zone: 'torget', name: 'Plant & seed swap', kind: 'shop', from: 10, to: 16, kit: 'plants', crowd: 30 },
    { zone: 'sodra', name: 'Picnics under the cherry trees', kind: 'food', from: 11, to: 20, kit: 'picnic', crowd: 40 },
  ],
  summer: [
    { zone: 'park', name: 'Picnics & lawn games', kind: 'well', from: 9, to: 17, kit: 'picnic', crowd: 55 },
    { zone: 'park', name: 'Concerts in the park', kind: 'party', from: 18, to: 23.5, kit: 'concert', crowd: 160, lights: ['#ff3fa4', '#3fd7ff', '#ffd23f', '#9b6bff'] },
    { zone: 'badet', name: 'Swimming & sunbathing', kind: 'well', from: 8, to: 21, kit: 'swim', crowd: 60 },
    { zone: 'badet', name: 'Midnight dip', kind: 'well', from: 21, to: 25, kit: 'swim', crowd: 12 },
    { zone: 'kajen', name: 'Food trucks & outdoor bar', kind: 'food', from: 12, to: 25, kit: 'trucks', crowd: 80, lights: ['#ffcf7a'] },
    { zone: 'torget', name: 'Table tennis & boule', kind: 'well', from: 9, to: 22, kit: 'games', crowd: 30 },
    { zone: 'sodra', name: 'Morning yoga in the park', kind: 'well', from: 6.5, to: 9, kit: 'yoga', crowd: 24 },
    { zone: 'sodra', name: 'Open-air cinema', kind: 'culture', from: 21.5, to: 24, kit: 'cinema', crowd: 60, lights: ['#ffffff'] },
  ],
  autumn: [
    { zone: 'park', name: 'Harvest market', kind: 'shop', from: 10, to: 16, kit: 'harvest', crowd: 60 },
    { zone: 'park', name: 'Lantern walk & light art', kind: 'culture', from: 17, to: 23, kit: 'lanterns', crowd: 70, lights: ['#ff7a3f', '#ffd23f', '#7a5bff', '#3fd7ff'] },
    { zone: 'badet', name: 'Sauna & cold dip', kind: 'well', from: 15, to: 22, kit: 'sauna', crowd: 14 },
    { zone: 'kajen', name: 'Light festival on the quay', kind: 'culture', from: 17, to: 23, kit: 'lightart', crowd: 50, lights: ['#ff3fa4', '#3fd7ff', '#7cff6b'] },
    { zone: 'torget', name: "Farmers' market", kind: 'shop', from: 9, to: 15, kit: 'pumpkins', crowd: 40 },
    { zone: 'sodra', name: 'Leaf piles & play', kind: 'well', from: 10, to: 16, kit: 'leafplay', crowd: 20 },
  ],
  winter: [
    { zone: 'park', name: 'Christmas market', kind: 'shop', from: 11, to: 21, kit: 'xmas', crowd: 120, lights: ['#ffd27a', '#ffb347'] },
    { zone: 'badet', name: 'Sauna & winter bathing', kind: 'well', from: 7, to: 21, kit: 'sauna', crowd: 16 },
    { zone: 'kajen', name: 'Fire pits & glögg', kind: 'food', from: 15, to: 22, kit: 'firepits', crowd: 40, lights: ['#ff9a3f'] },
    { zone: 'torget', name: 'Ice rink', kind: 'well', from: 10, to: 21, kit: 'rink', crowd: 40, lights: ['#e8f4ff', '#bcdcff'] },
    { zone: 'sodra', name: 'Sledding & snowmen', kind: 'well', from: 10, to: 15, kit: 'snowplay', crowd: 30 },
  ],
}
/** Is the activity on at this hour (hours past midnight count as 24+), and how far into its opening (0–1). */
export function onAt(a: Activity, hour: number) {
  const h = hour < 5 && a.to > 24 ? hour + 24 : hour
  return h >= a.from && h < a.to
}
/** The set-up stays (stage, huts, rink) while the season lasts; the activity itself only in its hours. */
export const SETUP_STAYS = new Set(['concert', 'xmas', 'rink', 'sauna', 'trucks', 'cinema', 'lanterns', 'lightart', 'firepits', 'foodmarket', 'harvest'])

// ------------------------------------------------------------------ ground floors, round the clock
export interface UnitProgram { label: string; kind: Kind; open: boolean }
const pickBy = <T,>(list: T[], key: string) => list[[...key].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 9973, 7) % list.length]
/** What a ground-floor unit is used for at this hour, by its tenancy (unit name from the floor plan). */
export function unitProgram(name: string, building: string, season: number, hour: number): UnitProgram | null {
  const h = hour % 24
  const s = SEASONS[season].id
  const cat = name.split(' · ')[0]
  const who = name.split(' · ')[1] ?? ''
  const key = building + name
  const between = (a: number, b: number) => (a <= b ? h >= a && h < b : h >= a || h < b)
  if (/^(Core|Support|WC|IT|Facilities|Security|First aid|Plant|Admin|Bin|Loading|Bike)/.test(cat)) return null
  if (cat.startsWith('Lobby')) {
    const residents = /Resident/.test(who)
    if (residents) return between(17, 21) ? { label: pickBy(['Book swap & homework club', 'Residents’ supper club', 'Kids’ Lego club', 'Neighbours’ fika'], key), kind: 'home', open: true }
      : { label: 'Residents’ entrance', kind: 'home', open: between(6, 23) }
    if (between(7, 17)) return { label: who ? `${who.replace(/ (office )?entrance/, '')} reception` : 'Office reception', kind: 'work', open: true }
    if (between(17, 22)) {
      const eve = s === 'winter' ? ['Christmas crafts & glögg', 'Wreath workshop', 'Candle-making', 'Yoga studio']
        : s === 'summer' ? ['After-work run club', 'Yoga studio', 'Salsa class', 'Pottery & ceramics']
          : ['Yoga studio', 'Pottery & ceramics', 'Life drawing', 'Language café', 'Board-game night', 'Repair café']
      const label = pickBy(eve, key)
      return { label, kind: /Pottery|drawing|craft|Wreath|Candle|Repair/.test(label) ? 'craft' : /Yoga|run|Salsa/.test(label) ? 'well' : 'culture', open: true }
    }
    return { label: 'Closed', kind: 'closed', open: false }
  }
  if (cat.startsWith('Event space')) {
    if (between(8, 17)) return { label: `${who || 'Event space'}: conference & talks`, kind: 'work', open: true }
    if (between(17, 1)) {
      const eve = s === 'winter' ? ['Julbord & office party', 'Christmas quiz', 'Lucia concert'] : s === 'summer' ? ['Club night', 'Stand-up comedy', 'Supper club']
        : s === 'autumn' ? ['Quiz night', 'Film club', 'Jazz evening'] : ['Quiz night', 'Spring gala', 'Stand-up comedy']
      const label = pickBy(eve, key)
      return { label: between(17, 18) ? `Setting up: ${label.toLowerCase()}` : `${label} at ${who || 'the event space'}`, kind: /quiz|Film|Jazz|Lucia/i.test(label) ? 'culture' : 'party', open: between(18, 1) }
    }
    return { label: 'Closed', kind: 'closed', open: false }
  }
  if (cat.startsWith('Café')) {
    if (between(7, 17)) return { label: `${who && who !== 'Café' && who !== 'retail' ? who : 'Café'}: coffee & lunch`, kind: 'food', open: true }
    if (between(17, 23)) return { label: pickBy(['Wine bar & open mic', 'Board-game café', 'Poetry night', 'Knitting café'], key), kind: 'culture', open: true }
    return { label: 'Closed', kind: 'closed', open: false }
  }
  if (cat.startsWith('Restaurant')) {
    if (between(11, 14.5)) return { label: `${who || 'Restaurant'}: lunch`, kind: 'food', open: true }
    if (between(17, s === 'summer' ? 1 : 23)) return { label: `${who || 'Restaurant'}: dinner${s === 'winter' ? ' & julbord' : s === 'summer' ? ' on the terrace' : ''}`, kind: 'food', open: true }
    return { label: `${who || 'Restaurant'}: closed`, kind: 'closed', open: false }
  }
  if (cat.startsWith('Shop')) {
    if (between(10, s === 'winter' ? 21 : 19)) return { label: s === 'winter' ? 'Shop: late Christmas opening' : 'Shop', kind: 'shop', open: true }
    if (between(19, 22)) return { label: pickBy(['Pop-up gallery', 'Vinyl night', 'Repair café', 'Maker market'], key), kind: 'craft', open: true }
    return { label: 'Closed', kind: 'closed', open: false }
  }
  if (cat.startsWith('Gym')) {
    if (between(6, 17)) return { label: `${who || 'Gym'}`, kind: 'well', open: true }
    if (between(17, 22)) return { label: `${who || 'Gym'}: ${pickBy(['spinning party', 'boxing class', 'climbing night', 'dance class'], key)}`, kind: 'well', open: true }
    return { label: 'Closed', kind: 'closed', open: false }
  }
  if (cat.startsWith('Atrium')) return between(8, 17) ? { label: 'Atrium garden', kind: 'work', open: true } : between(17, 23) ? { label: s === 'winter' ? 'Glögg & jazz in the atrium' : 'Jazz in the atrium', kind: 'culture', open: true } : { label: 'Closed', kind: 'closed', open: false }
  if (cat.startsWith('Meeting')) return between(8, 17) ? { label: 'Meetings', kind: 'work', open: true } : between(17, 21) ? { label: 'Coding club', kind: 'culture', open: true } : { label: 'Closed', kind: 'closed', open: false }
  if (cat.startsWith('Visitor')) return between(8, 17) ? { label: 'Visitor lounge', kind: 'work', open: true } : between(17, 23) ? { label: 'Quiz after hours', kind: 'culture', open: true } : { label: 'Closed', kind: 'closed', open: false }
  if (cat.startsWith('Lobby, reception')) return { label: between(7, 18) ? 'Reception' : 'Closed', kind: between(7, 18) ? 'work' : 'closed', open: between(7, 18) }
  return { label: cat, kind: 'work', open: between(8, 17) }
}
/** How lively the streets are, 0–1 (people outdoors). */
export function streetLife(season: number, hour: number) {
  const h = hour % 24
  const day = h >= 9 && h < 18 ? 1 : h >= 18 && h < 22 ? 0.65 : h >= 6 && h < 9 ? 0.5 : h >= 22 ? 0.3 : 0.08
  const w = weatherAt(season, hour)
  const s = SEASONS[season].id
  const sk = s === 'summer' ? 1 : s === 'spring' ? 0.85 : s === 'autumn' ? 0.6 : 0.5
  return Math.min(1, day * sk * (w.rain ? 0.55 : 1))
}
export const fmtHour = (hour: number) => { const h = ((hour % 24) + 24) % 24; return `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}` }
