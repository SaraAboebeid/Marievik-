// Floor studio in the browser: the server (explorer/studio) lays out and checks every floor; this file turns its
// JSON into the model the 3D view and panels draw, and keeps the one thing that must run locally — walking
// routes for the people animated on the floor (crowd.ts).
//
// Coordinates are metres in the building's own plan frame (B01: x along the street frontage, y inward).

export type Rect = [number, number, number, number]
export type Side = 'N' | 'S' | 'E' | 'W'
type Iv = [number, number]
export type Params = Record<string, number>

// fixed geometry of the studio building — replaced by the server's values on load (setGeometry)
export let W = 43.25, H = 53.47, CELL = 0.3, NX = 145, NY = 179, WALL_H = 2.7, ESCAPE_LIMIT = 45
export let FRAME = { origin: [25.81, -24.86] as [number, number], x: [0.55653, 0.83077] as [number, number] }
export let CORES: { id: string; r: Rect; stair: Rect }[] = [{ id: 'W', r: [12, 13, 15.6, 31], stair: [12, 24, 15.6, 31] }, { id: 'E', r: [27.6, 13, 31.2, 31], stair: [27.6, 24, 31.2, 31] }]
export let ATRIUM: Rect = [16.6, 15, 26.6, 35]
export let LIFTS: [number, number][] = [[11.7, 18.5], [31.5, 18.5]]

export interface StudioGeometry {
  frame: { origin: [number, number]; x: [number, number] }; plate: [number, number]; cell: number; nx: number; ny: number
  cores: { id: string; r: Rect; stair: Rect }[]; atrium: Rect; lifts: [number, number][]; escapeLimit: number; wallH: number
}
export function setGeometry(g: StudioGeometry) {
  FRAME = g.frame; W = g.plate[0]; H = g.plate[1]; CELL = g.cell; NX = g.nx; NY = g.ny
  CORES = g.cores; ATRIUM = g.atrium; LIFTS = g.lifts; ESCAPE_LIMIT = g.escapeLimit; WALL_H = g.wallH
}

export interface LayoutMeta { name: string; short: string; use: string; ground: boolean }
export interface StudioMeta {
  layouts: Record<string, LayoutMeta>; ground: string[]; typical: string[]; defaultFloor: string[]
  useToLayout: { ground: Record<string, string | null>; typical: Record<string, string | null> }
  geometry: StudioGeometry; buildings: string[]
}
export const layoutFor = (meta: StudioMeta, floor: number) => meta.defaultFloor[floor] ?? 'open'
export const layoutForUse = (meta: StudioMeta, use: string, ground: boolean) => meta.useToLayout[ground ? 'ground' : 'typical'][use] ?? null

/** Room colours and labels on the plan. */
export const TYPES: Record<string, { label: string; fill: string }> = {
  teamroom: { label: 'Team room', fill: '#f3ecd2' }, backoffice: { label: 'Back office', fill: '#f3ecd2' }, studio: { label: 'Studio', fill: '#f3ecd2' },
  cell: { label: 'Office', fill: '#f3ecd2' }, meeting: { label: 'Meeting room', fill: '#dbe6fb' }, project: { label: 'Project room', fill: '#dbe6fb' },
  booth: { label: 'Focus room', fill: '#e9e1fa' }, library: { label: 'Quiet library', fill: '#e9e1fa' }, pantry: { label: 'Pantry', fill: '#fbefc4' },
  lounge: { label: 'Lounge', fill: '#fbe0ec' }, cafe: { label: 'Café', fill: '#fde0d6' }, kitchen: { label: 'Kitchen', fill: '#e8e5dc' },
  event: { label: 'Event space', fill: '#fde0d6' }, wc: { label: 'WC', fill: '#dfe9ee' }, store: { label: 'Store', fill: '#e9e6dc' },
  plant: { label: 'Plant room', fill: '#e1dfd7' }, loading: { label: 'Loading', fill: '#e1dfd7' }, it: { label: 'IT / comms', fill: '#e1dfd7' },
  security: { label: 'Security', fill: '#dbe8e0' }, firstaid: { label: 'First aid', fill: '#dbe8e0' }, garden: { label: 'Atrium garden', fill: '#d6ecd2' },
}

export interface Room { id: string; name: string; t: string; r: Rect; area: number; open: boolean; doorSide: Side | null; label: string }
export interface Door { o: 'h' | 'v'; c: number; pos: number; w: number; room: string; side: Side }
export interface WallLine { o: 'h' | 'v'; c: number; solid: Iv[]; glass: Iv[]; all: Iv[] }
export interface Item { k: string; x: number; y: number; w: number; h: number; owner: string }
export interface Exit { id: string; x: number; y: number; w: number }
export interface Field { dist: Float64Array; org: Int8Array }
export interface Seat { it: Item; n: number; cell: number; d: number; exit: number }
export interface Handle { key: string; axis: 'x' | 'y'; span: [number, number]; min: number; max: number; label: string }
export interface Check { id: string; ok: boolean; text: string }
export interface Figures {
  gfa: number; workDesks: number; staff: number; guests: number; seatsAll: number; otherSeats: number; designLoad: number
  people: number; wcs: number; acc: number; wcNeed: number; worst: { cell: number; d: number } | null; unreachable: number
  exitLoad: { id: string; w: number; people: number; cap: number }[]; checks: Check[]; allOk: boolean
}
export interface CostRow { what: string; sek: number; kg: number }
export interface StudioModel {
  layout: { id: string; name: string; short: string; use: string; ground: boolean; deskRatio: number | null; defaults: Params; handles: Handle[] }
  p: Params; floor: number; ground: boolean; rooms: Room[]; doors: Door[]; walls: Record<string, WallLine>; items: Item[]
  seats: Seat[]; exits: Exit[]; grid: Uint8Array; escape: Field; worstRoute: number[]
  fig: Figures; roomFig: { r: Room; seats: number; max: number }[]; openSeats: number
  edit: { rows: CostRow[]; sek: number; kg: number; seatsDelta: number; peopleDelta: number } | null
}

/** The server's JSON for one floor (POST /api/studio/{building}/{floor}) as the model the explorer draws. */
export interface StudioPayload {
  layout: StudioModel['layout']; params: Params; floor: number; ground: boolean; rooms: Room[]; doors: Door[]; walls: Record<string, WallLine>
  items: [string, number, number, number, number, string][]; seats: [number, number, number, number, number][]; exits: Exit[]
  grid: { nx: number; ny: number; cell: number; walk: string; escape_cm: string }; worstRoute: number[]
  fig: Figures; roomFig: { id: string; seats: number; max: number }[]; openSeats: number; edit?: StudioModel['edit']
}
const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
export function fromPayload(p: StudioPayload): StudioModel {
  const items = p.items.map(([k, x, y, w, h, owner]) => ({ k, x, y, w, h, owner }))
  const esc = new Uint16Array(bytes(p.grid.escape_cm).buffer)
  const dist = new Float64Array(esc.length)
  for (let i = 0; i < esc.length; i++) dist[i] = esc[i] === 65535 ? Infinity : esc[i] / 100
  const byId = new Map(p.rooms.map((r) => [r.id, r]))
  return {
    layout: p.layout, p: p.params, floor: p.floor, ground: p.ground, rooms: p.rooms, doors: p.doors, walls: p.walls, items,
    seats: p.seats.map(([it, n, cell, d, exit]) => ({ it: items[it], n, cell, d: d < 0 ? Infinity : d, exit })),
    exits: p.exits, grid: bytes(p.grid.walk), escape: { dist, org: new Int8Array(0) }, worstRoute: p.worstRoute,
    fig: p.fig, roomFig: p.roomFig.map((f) => ({ r: byId.get(f.id)!, seats: f.seats, max: f.max })), openSeats: p.openSeats, edit: p.edit ?? null,
  }
}

export interface YearKpi {
  year: number; layout: string; use: string
  running: number; repl: number; works: number; cost: number; kg: number   // this year: running costs, replacements, change works; total cost and carbon
  cumCost: number; cumKg: number; people: number; seats: number; change: { sek: number; kg: number; months: number } | null
}
/** What a year holds when its use has no furnished layout: that use's running costs, the timeline's own people
 *  count, and the timeline's own cost and carbon for the works that bring it in. */
export interface YearOverride { opexUse?: string; people?: number; works?: { sek: number; kg: number; months: number } }

export interface CompareRow {
  layout: string; name: string; use: string; params: Params; people: number; seats: number; designLoad: number; worst: number | null
  allOk: boolean; failed: string[]; changeSek: number; changeKg: number; months: number
}

/** Simulated working days on one floor (explorer/studio/occupancy.py). Hourly arrays run 06..21. */
export interface Occupancy {
  layout: string; use: string; kind: 'work' | 'guests'; days: number; hours: number[]; curve: number[]
  people: { mean: number[]; p90: number[] }
  activity: { desk: number[]; meeting: number[]; food: number[]; focus: number[]; wc: number[]; guests: number[] }
  peak: { mean: number; p90: number; max: number; planned: number; legalMax: number }
  personHours: number; m2PerPersonHour: number
  wc: { cubicles: number; waitMean: number; waitP90: number; waitP99: number; worstDay: number }
  walk: { perPersonDay: number }
  roomUse: Record<string, number[]>
  note: string
  staff?: number; attendance?: number; lunchOut?: number
  desks?: { n: number; shared: boolean; peakMean: number; peakP90: number; useAtPeak: number; shortDays: number; withoutDesk: number }
  meetings?: { rooms: { id: string; name: string; cap: number; bookedShare: number; avgFill: number }[]; perDay: number; deniedPerDay: number; deniedShare: number; tooBigShare: number }
  focus?: { rooms: number; perDay: number; deniedShare: number }
  food?: { seats: number; peakMean: number; crowding: number }
  demand?: number
  guests?: { seats: number; usable: number; coversPerDay: number; turnedAwayPerDay: number; turnedAwayShare: number; peakFill: number }
}

// ------------------------------------------------------------------ walking routes for the animated people
export function cellOf(x: number, y: number): [number, number] {
  return [Math.min(NX - 1, Math.max(0, Math.floor(x / CELL))), Math.min(NY - 1, Math.max(0, Math.floor(y / CELL)))]
}
export function cellXY(c: number): [number, number] { const i = c % NX; return [(i + 0.5) * CELL, ((c - i) / NX + 0.5) * CELL] }
export function nearestWalkable(g: Uint8Array, x: number, y: number) {
  const c = cellOf(x, y)
  for (let rad = 0; rad < 10; rad++) for (let dj = -rad; dj <= rad; dj++) for (let di = -rad; di <= rad; di++) {
    if (Math.max(Math.abs(di), Math.abs(dj)) !== rad) continue
    const i = c[0] + di, j = c[1] + dj
    if (i >= 0 && j >= 0 && i < NX && j < NY && g[j * NX + i]) return j * NX + i
  }
  return -1
}
/** Shortest walking distance (m) from the nearest source to every cell, and which source it was. */
export function dijkstra(g: Uint8Array, sources: number[]): Field {
  const n = NX * NY, dist = new Float64Array(n).fill(Infinity), org = new Int8Array(n).fill(-1)
  const heap: [number, number][] = [], D = CELL, DD = CELL * Math.SQRT2
  const push = (c: number, d: number) => {
    heap.push([d, c])
    let k = heap.length - 1
    while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p }
  }
  const pop = () => {
    const top = heap[0], last = heap.pop()!
    if (heap.length) {
      heap[0] = last
      let k = 0
      for (;;) {
        const l = 2 * k + 1, r = l + 1
        let m = k
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r
        if (m === k) break
        ;[heap[m], heap[k]] = [heap[k], heap[m]]
        k = m
      }
    }
    return top
  }
  sources.forEach((s, idx) => { if (s >= 0) { dist[s] = 0; org[s] = idx; push(s, 0) } })
  while (heap.length) {
    const [d, c] = pop()
    if (d > dist[c]) continue
    const i = c % NX, j = (c - i) / NX
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue
      const ni = i + di, nj = j + dj
      if (ni < 0 || nj < 0 || ni >= NX || nj >= NY) continue
      const nc = nj * NX + ni
      if (!g[nc]) continue
      if (di && dj && (!g[j * NX + ni] || !g[nj * NX + i])) continue
      const nd = d + (di && dj ? DD : D)
      if (nd < dist[nc]) { dist[nc] = nd; org[nc] = org[c]; push(nc, nd) }
    }
  }
  return { dist, org }
}
/** Follow a field downhill from a cell to its source: the walking route, cell by cell. */
export function descend(field: Field, start: number) {
  const path: number[] = []
  let c = start, guard = 0
  if (c < 0 || !isFinite(field.dist[c])) return path
  while (guard++ < 3000) {
    path.push(c)
    if (field.dist[c] === 0) break
    const i = c % NX, j = (c - i) / NX
    let best = c, bd = field.dist[c]
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ni = i + di, nj = j + dj
      if (ni < 0 || nj < 0 || ni >= NX || nj >= NY) continue
      const nc = nj * NX + ni
      if (field.dist[nc] < bd - 1e-4) { bd = field.dist[nc]; best = nc }
    }
    if (best === c) break
    c = best
  }
  return path
}
/** Walking field to a kind of place people go during the day. */
export function poiField(m: StudioModel, kind: 'lift' | 'entry' | 'food' | 'wc' | 'meet'): Field {
  let src: number[] = []
  if (kind === 'lift') src = LIFTS.map(([x, y]) => nearestWalkable(m.grid, x, y))
  else if (kind === 'entry') src = m.ground ? [nearestWalkable(m.grid, m.exits[0].x, m.exits[0].y)] : LIFTS.map(([x, y]) => nearestWalkable(m.grid, x, y))
  else {
    const types = { food: ['pantry', 'cafe', 'kitchen'], wc: ['wc'], meet: ['meeting', 'project', 'event'] }[kind]
    for (const r of m.rooms) if (types.includes(r.t)) { const c = nearestWalkable(m.grid, (r.r[0] + r.r[2]) / 2, (r.r[1] + r.r[3]) / 2); if (c >= 0) src.push(c) }
    if (kind === 'food') for (const it of m.items) if (it.k === 'counter' && it.owner === 'zone') src.push(nearestWalkable(m.grid, it.x + it.w / 2, it.y - 0.6))
    if (!src.length) src = LIFTS.map(([x, y]) => nearestWalkable(m.grid, x, y))
  }
  return dijkstra(m.grid, src)
}

/** Partition runs minus door openings (for drawing). */
export function subtract(A: Iv[], B: Iv[]): Iv[] {
  const out: Iv[] = []
  for (const a of A) {
    let segs: Iv[] = [[a[0], a[1]]]
    for (const b of B) {
      const nx: Iv[] = []
      for (const s of segs) {
        if (b[1] <= s[0] || b[0] >= s[1]) { nx.push(s); continue }
        if (b[0] > s[0]) nx.push([s[0], b[0]])
        if (b[1] < s[1]) nx.push([b[1], s[1]])
      }
      segs = nx
    }
    out.push(...segs)
  }
  return out.filter((s) => s[1] - s[0] > 0.05)
}
