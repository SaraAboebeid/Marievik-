// Flexibility: what it takes to change a floor's layout with Smartax walls against fixed gypsum stud walls.
// Wall geometry comes from the floor studio (explorer/studio, B01's plans); prices and carbon from the Smartax vs
// gypsum price sheet (Smartax_vs_Gips_70_mm_projektpris_2026-10.xlsx, EI30, 2.5 m wall, 450 SEK/h) and the
// component data (data/components). Everything else is an assumption, flagged where it is used.

import type { WallLine } from './studio/engine'

export interface WallSeg { o: 'h' | 'v'; c: number; a: number; b: number; glass: boolean }
export const segLen = (s: WallSeg) => s.b - s.a

type Iv = [number, number]
const EPS = 0.1
const keyOf = (o: string, c: number) => `${o}${(Math.round(c * 20) / 20).toFixed(2)}`
function norm(iv: Iv[]): Iv[] {
  const s = iv.filter(([a, b]) => b - a > 1e-6).sort((p, q) => p[0] - q[0])
  const out: Iv[] = []
  for (const [a, b] of s) {
    const last = out[out.length - 1]
    if (last && a <= last[1] + 1e-6) last[1] = Math.max(last[1], b)
    else out.push([a, b])
  }
  return out
}
function subtract(A: Iv[], B: Iv[]): Iv[] {
  let res = norm(A)
  for (const [b0, b1] of norm(B)) {
    res = res.flatMap(([a0, a1]): Iv[] => (b1 <= a0 || b0 >= a1 ? [[a0, a1] as Iv] : ([[a0, Math.max(a0, b0)], [Math.min(a1, b1), a1]] as Iv[])).filter(([x, y]) => y - x > EPS))
  }
  return res
}
const intersect = (A: Iv[], B: Iv[]) => subtract(A, subtract(A, B))

function lines(walls: Record<string, WallLine>, glass: boolean) {
  const m = new Map<string, { o: 'h' | 'v'; c: number; iv: Iv[] }>()
  for (const w of Object.values(walls)) {
    const k = keyOf(w.o, w.c)
    const e = m.get(k) ?? { o: w.o, c: w.c, iv: [] }
    e.iv.push(...(glass ? w.glass : w.solid).map(([a, b]) => [a, b] as Iv))
    m.set(k, e)
  }
  return m
}

/** The walls one layout keeps, removes and adds on its way to the next (solid and glazed separately). */
export function wallDiff(from: Record<string, WallLine>, to: Record<string, WallLine>) {
  const kept: WallSeg[] = [], removed: WallSeg[] = [], added: WallSeg[] = []
  for (const glass of [false, true]) {
    const A = lines(from, glass), B = lines(to, glass)
    for (const k of new Set([...A.keys(), ...B.keys()])) {
      const a = A.get(k), b = B.get(k)
      const o = (a ?? b)!.o, c = (a ?? b)!.c
      const ai = a ? norm(a.iv) : [], bi = b ? norm(b.iv) : []
      const push = (to: WallSeg[], iv: Iv[]) => iv.forEach(([x, y]) => { if (y - x > EPS) to.push({ o, c, a: x, b: y, glass }) })
      push(kept, intersect(ai, bi))
      push(removed, subtract(ai, bi))
      push(added, subtract(bi, ai))
    }
  }
  return { kept, removed, added }
}
export const allSegs = (walls: Record<string, WallLine>) => wallDiff(walls, {}).removed

// ------------------------------------------------------------------ the two systems
export const WALL_H = 2.7          // m, data/studio/costs.json partitions.wall_height_m
export const CREW_HOURS_DAY = 6 * 8 // a six-person crew (assumption)
export const RENT = 3000          // SEK per m2 lettable and year: corporate office willingness to pay (data/district/marievik_market.json, example data)
export const LETTABLE = 0.85      // marievik_market.json lettable_share

export type SmartaxMode = 'documented' | 'claimed'
export interface SystemSpec {
  id: 'smartax' | 'gypsum'; label: string
  newSek: number; newKg: number          // per m2 of wall: build (price sheet total; A1-A3)
  installH: number                      // labour hours per m2 to build
  stripSek: number; stripH: number      // per m2 taken out
  recover: number                       // share of what comes out that goes up again
  reinstallSek: number; reinstallKg: number; reinstallH: number
  endKg: number                         // C1-C4 per m2 of what is thrown away
  massKg: number                        // per m2 of wall (assumption from the build-ups)
  finishDays: number                    // working days after building before the floor reopens
  note: string
}
export const GYPSUM: SystemSpec = {
  id: 'gypsum', label: 'Fixed gypsum walls',
  newSek: 1165, newKg: 16.2, installH: 739 / 450, stripSek: 480, stripH: 480 / 450, recover: 0.05,
  reinstallSek: 0, reinstallKg: 0, reinstallH: 0, endKg: 3.4, massKg: 31, finishDays: 5,
  note: 'Traditional 70 mm stud wall, 2 board layers + plywood each side, filled and painted (price sheet EI30: 1 165 SEK/m², 16.2 kg A1–A3). Strip-out 480 SEK/m² and 5 % recovery (data/components, placeholder). Filler and paint need about a week of drying before the floor reopens (assumption).',
}
export function smartax(mode: SmartaxMode): SystemSpec {
  const base = {
    id: 'smartax' as const, label: 'Smartax walls', newSek: 970, newKg: 11.2, installH: 541.5 / 450, endKg: 0.65, massKg: 32, finishDays: 1,
  }
  return mode === 'documented'
    ? { ...base, stripSek: 480, stripH: 480 / 450, recover: 0.07, reinstallSek: 0, reinstallKg: 0, reinstallH: 0,
      note: 'As documented: boards glued and nailed to the studs (installation guide 2024-03-04), so only the timber frame (≈ 7 %) is recovered; strip-out as for a stud wall, 480 SEK/m². Build 970 SEK/m², 11.2 kg A1–A3 (price sheet). Pre-finished liner: no filler, back in use the day after.' }
    : { ...base, stripSek: 250, stripH: 250 / 450, recover: 0.6, reinstallSek: 630, reinstallKg: 2.5, reinstallH: 541.5 / 450,
      note: "As Smartax claims (price sheet: 'Demontering: Skruvbar, Återbrukbar: Ja'): screwed, 60 % of panels come down whole and go up again (data/studio/costs.json reuse_share, placeholder); take-down 250 SEK/m²; reinstalling a panel is the install labour plus a new liner, ≈ 630 SEK/m², 2.5 kg (A4+A5). Needs a documented demount method from Smartax before it is used as fact." }
}

export interface ChangeCost {
  removedM2: number; addedM2: number; reusedM2: number; newM2: number; recoveredM2: number; storeM2: number
  sek: number; kg: number; wasteT: number; days: number; lostRentSek: number
  stripDays: number; buildDays: number; finishDays: number
}
export const solidM2 = (segs: WallSeg[]) => segs.filter((s) => !s.glass).reduce((a, s) => a + segLen(s), 0) * WALL_H

/** One change of layout on one floor with one system, in m² of solid wall taken out and put in (glazed partitions
 *  are the same either way and left out). `store` is what the system already has in storage from earlier changes:
 *  a reusable system takes panels down whole, puts back what the new layout needs and stores the rest for later. */
export function changeCostM2(sys: SystemSpec, rem: number, add: number, gfa: number, store = 0): ChangeCost {
  const recovered = rem * sys.recover
  const reusable = sys.reinstallSek > 0
  const available = reusable ? store + recovered : 0
  const reused = Math.min(available, add)
  const fresh = add - reused
  const thrown = rem - recovered
  const sek = rem * sys.stripSek + reused * sys.reinstallSek + fresh * sys.newSek
  const kg = thrown * sys.endKg + reused * sys.reinstallKg + fresh * sys.newKg
  const stripDays = rem > 0.01 || add > 0.01 ? 1 + (rem * sys.stripH) / CREW_HOURS_DAY : 0   // a day to set up
  const buildDays = (reused * sys.reinstallH + fresh * sys.installH) / CREW_HOURS_DAY
  const finishDays = add > 0.01 ? sys.finishDays : 0
  const days = rem < 0.01 && add < 0.01 ? 0 : (Math.ceil(stripDays + buildDays + finishDays) * 7) / 5   // calendar days closed
  return {
    removedM2: rem, addedM2: add, reusedM2: reused, newM2: fresh, recoveredM2: recovered, storeM2: available - reused,
    sek, kg, wasteT: (thrown * sys.massKg) / 1000, days, lostRentSek: (days / 365) * RENT * gfa * LETTABLE,
    stripDays, buildDays, finishDays,
  }
}
/** A run of changes, carrying the panel store from one to the next. */
export function runCosts(sys: SystemSpec, changes: { rem: number; add: number }[], gfa: number): ChangeCost[] {
  let store = 0
  return changes.map((c) => { const k = changeCostM2(sys, c.rem, c.add, gfa, store); store = k.storeM2; return k })
}
const ZERO: ChangeCost = { removedM2: 0, addedM2: 0, reusedM2: 0, newM2: 0, recoveredM2: 0, storeM2: 0, sek: 0, kg: 0, wasteT: 0, days: 0, lostRentSek: 0, stripDays: 0, buildDays: 0, finishDays: 0 }
export const sumCosts = (cs: ChangeCost[]) => cs.reduce((a, c) => ({
  ...a, removedM2: a.removedM2 + c.removedM2, addedM2: a.addedM2 + c.addedM2, reusedM2: a.reusedM2 + c.reusedM2, newM2: a.newM2 + c.newM2,
  recoveredM2: a.recoveredM2 + c.recoveredM2, storeM2: c.storeM2, sek: a.sek + c.sek, kg: a.kg + c.kg, wasteT: a.wasteT + c.wasteT,
  days: a.days + c.days, lostRentSek: a.lostRentSek + c.lostRentSek,
}), ZERO)
