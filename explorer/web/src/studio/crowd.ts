import { NX, NY, cellXY, descend, poiField } from './engine'
import type { Field, StudioModel } from './engine'

export type Scenario = 'day' | 'arrive' | 'lunch'
type Place = 'lift' | 'entry' | 'food' | 'wc' | 'meet'
export interface Walker { x: number; y: number; moving: boolean; gone?: boolean }
interface Agent extends Walker { home: number; path: number[] | null; k: number; wait: number; back: boolean; arrive: boolean }

const SPEED = 1.3 * 4   // walking speed, shown four times faster than real

/** People sitting at the floor's seats who get up for the WC, the pantry, meetings and the lifts. */
export class Crowd {
  readonly agents: Agent[] = []
  readonly heat = new Float32Array(NX * NY)   // footfall per walking cell: the busy routes
  readonly step: number
  private fields = new Map<Place, Field>()

  constructor(private m: StudioModel, private scn: Scenario, maxPeople = 140) {
    const seats = m.seats.filter((q) => isFinite(q.d) && q.cell >= 0 && q.n === 1)
    this.step = Math.max(1, Math.ceil(seats.length / maxPeople))
    for (let i = 0; i < seats.length; i += this.step) {
      const [x, y] = cellXY(seats[i].cell)
      this.agents.push({ home: seats[i].cell, x, y, path: null, k: 0, wait: Math.random() * 8, moving: false, back: false, arrive: false })
    }
    if (scn === 'arrive') this.agents.forEach((a, i) => {
      const p = descend(this.field('entry'), a.home).reverse()
      if (p.length > 1) { [a.x, a.y] = cellXY(p[0]); a.path = p; a.k = 0; a.wait = i * 0.12; a.moving = true; a.arrive = true }
    })
    if (scn === 'lunch') for (const a of this.agents) a.wait = Math.random() * 3
  }

  private field(kind: Place) {
    let f = this.fields.get(kind)
    if (!f) { f = poiField(this.m, kind); this.fields.set(kind, f) }
    return f
  }

  private pickTrip(a: Agent) {
    const r = Math.random()
    const kind: Place = this.scn === 'lunch' ? 'food' : r < 0.32 ? 'wc' : r < 0.62 ? 'food' : r < 0.88 ? 'meet' : 'lift'
    const p = descend(this.field(kind), a.home)
    if (p.length > 1) { a.path = p; a.k = 0; a.moving = true; a.back = false } else a.wait = 5
  }

  /** Advance everyone by dt seconds. */
  tick(dt: number) {
    for (const a of this.agents) {
      if (a.wait > 0) { a.wait -= dt; if (a.wait > 0) continue }
      if (!a.moving) { if (!a.arrive) this.pickTrip(a); continue }
      let rem = SPEED * dt
      while (rem > 0 && a.path && a.k < a.path.length - 1) {
        const [nx, ny] = cellXY(a.path[a.k + 1]), dx = nx - a.x, dy = ny - a.y, dd = Math.hypot(dx, dy)
        if (dd <= rem) { a.x = nx; a.y = ny; a.k++; rem -= dd; this.heat[a.path[a.k]] += 1 } else { a.x += (dx / dd) * rem; a.y += (dy / dd) * rem; rem = 0 }
      }
      if (a.path && a.k >= a.path.length - 1) {
        if (a.arrive) { a.moving = false; a.arrive = false; a.path = null; a.wait = this.scn === 'arrive' ? 1e9 : 5 }
        else if (!a.back) { a.path = a.path.slice().reverse(); a.k = 0; a.back = true; a.wait = this.scn === 'lunch' ? 25 + Math.random() * 20 : 2 + Math.random() * 6 }
        else { a.moving = false; a.path = null; a.wait = this.scn === 'lunch' ? 1e9 : 6 + Math.random() * 18 }
      }
    }
    for (let k = 0; k < this.heat.length; k++) this.heat[k] *= 0.9995
  }
}
