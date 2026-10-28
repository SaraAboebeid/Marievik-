// Leases: which lettable spaces are rented when, for the "Rented / vacant" tour and its 10-year timeline.
//
// The shape below is the input: a lease book, one entry per lettable space (its share of the building's lettable
// area) and one per lease on it (tenant, start, end). Vacancy is simply a gap between leases. Until real lease
// data arrives, mockLeaseBook() makes up a plausible book for every building — clearly flagged `mock` everywhere
// it shows. To use real data, build a LeaseBook in the same shape (e.g. from data/projects/marievik/leases.json)
// and pass it instead; nothing else changes.

export interface LeaseSpace { id: string; building: string; name: string; share: number }   // share of the building's lettable area
export interface Lease { space: string; tenant: string; start: number; end: number; renewal?: boolean }   // decimal years, end exclusive
export interface LeaseBook { from: number; to: number; spaces: LeaseSpace[]; leases: Lease[]; mock: boolean; note: string }

export const LEASE_FROM = 2026.75           // Q4 2026
export const LEASE_YEARS = 10
export const LEASE_STEPS = LEASE_YEARS * 4  // quarters on the timeline

/** "Q4 2026" for a decimal year at a quarter boundary. */
export const quarterLabel = (t: number) => `Q${Math.floor((((t % 1) + 1e-6) * 4)) + 1} ${Math.floor(t + 1e-6)}`
export const stepTime = (q: number) => LEASE_FROM + q / 4

const TENANTS = ['Agency', 'Studio', 'Clinic', 'Café', 'Co-working', 'Gym', 'Shop', 'Lab', 'Consultancy', 'School', 'Tech firm',
  'Architects', 'Bakery', 'Dental care', 'Media house', 'Start-up', 'Law firm', 'Physio', 'Restaurant', 'Design office']

function rngFor(key: string) {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619)
  let s = (h >>> 0) % 2147483646 + 1
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 }
}

/** A made-up lease book: each building split into 8–16 lettable spaces, 80–95 % let today, 3-, 5- or 10-year
 *  leases; at expiry about two in three renew, the rest stand empty for 3–21 months before a new tenant moves in. */
export function mockLeaseBook(buildings: string[]): LeaseBook {
  const spaces: LeaseSpace[] = []
  const leases: Lease[] = []
  const to = LEASE_FROM + LEASE_YEARS
  for (const b of buildings) {
    const r = rngFor(`mock-leases-${b}`)
    const n = 8 + Math.floor(r() * 9)
    const raw = Array.from({ length: n }, () => 0.4 + r())
    const sum = raw.reduce((a, x) => a + x, 0)
    const letToday = 0.8 + r() * 0.15
    const tenantName = () => `${TENANTS[Math.floor(r() * TENANTS.length)]} ${String.fromCharCode(65 + Math.floor(r() * 26))}`
    const term = () => [3, 3, 5, 5, 5, 10][Math.floor(r() * 6)]
    // empty today: spaces in random order until the building's vacancy is used up (never more than ~20 %)
    const empty = new Set<number>()
    let acc = 0
    for (const i of raw.map((_, i) => ({ i, k: r() })).sort((a, b) => a.k - b.k).map((o) => o.i)) {
      if (acc + raw[i] / sum > 1 - letToday) continue
      acc += raw[i] / sum
      empty.add(i)
    }
    raw.forEach((x, i) => {
      const id = `${b}-S${String(i + 1).padStart(2, '0')}`
      spaces.push({ id, building: b, name: `Space ${i + 1}`, share: x / sum })
      let t: number
      let tenant = tenantName()
      if (!empty.has(i)) {
        // let today: a lease that started some years ago and runs past now
        let start = LEASE_FROM - r() * 6
        let end = start + term()
        while (end <= LEASE_FROM + 0.25) { start = end; end = start + term() }
        leases.push({ space: id, tenant, start: q4(start), end: q4(end) })
        t = q4(end)
      } else {
        t = q4(LEASE_FROM + 0.25 + r() * 1.75)    // empty today, let within two years
        tenant = tenantName()
        const end = q4(t + term())
        leases.push({ space: id, tenant, start: t, end })
        t = end
      }
      while (t < to) {
        if (r() < 0.65) {
          const end = q4(t + term())
          leases.push({ space: id, tenant, start: t, end, renewal: true })
          t = end
        } else {
          const start = q4(t + 0.25 + r() * 1.5)
          tenant = tenantName()
          const end = q4(start + term())
          leases.push({ space: id, tenant, start, end })
          t = end
        }
      }
    })
  }
  return { from: LEASE_FROM, to, spaces, leases, mock: true,
    note: 'Mock lease book: made-up tenants, terms and renewals, standing in until real lease data is added.' }
}
const q4 = (t: number) => Math.round(t * 4) / 4

export const leaseAt = (book: LeaseBook, space: string, t: number) => book.leases.find((l) => l.space === space && l.start <= t + 1e-6 && t < l.end - 1e-6) ?? null

/** Share of each building's lettable area rented at time t. */
export function rentedShare(book: LeaseBook, t: number): Record<string, number> {
  const out: Record<string, number> = {}
  for (const s of book.spaces) out[s.building] = (out[s.building] ?? 0) + (leaseAt(book, s.id, t) ? s.share : 0)
  return out
}

/** What happens in the quarter starting at t: leases ending (and whether renewed), new lettings. */
export function eventsIn(book: LeaseBook, t: number, buildings?: string[]) {
  const inB = new Set(buildings ?? book.spaces.map((s) => s.building))
  const spaceB = new Map(book.spaces.map((s) => [s.id, s.building]))
  const q = book.leases.filter((l) => inB.has(spaceB.get(l.space)!))
  const at = (x: number) => Math.abs(x - t) < 0.01
  return {
    renewed: q.filter((l) => l.renewal && at(l.start)),
    newLets: q.filter((l) => !l.renewal && at(l.start) && l.start > book.from + 0.01),
    moveOuts: q.filter((l) => at(l.end) && !q.some((m) => m.space === l.space && m.renewal && at(m.start))),
  }
}
