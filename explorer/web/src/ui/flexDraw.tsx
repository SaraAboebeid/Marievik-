import { ATRIUM, CORES, H as PLATE_H, TYPES, W as PLATE_W, type Room } from '../studio/engine'
import type { SystemSpec, WallSeg } from '../flex'

// Floors of B01 drawn in isometric view as SVG, shared by the floor view (FlexDrawer) and the building view
// (BuildingFlex). Plan metres in, screen units out; z is drawn as it is (walls a little taller to read).

export const HZ = 3.4   // walls drawn a little taller than 2.7 m so they read at this size
export const C30 = Math.cos(Math.PI / 6), S30 = 0.5
export const iso = (x: number, y: number, z: number): [number, number] => [(x - y) * C30, (x + y) * S30 - z]
export const pts = (ps: [number, number][]) => ps.map(([a, b]) => `${a.toFixed(2)},${b.toFixed(2)}`).join(' ')

type Prism = { a: [number, number]; b: [number, number]; z0: number; z1: number; th: number; fill: string; edge?: string; op?: number; depth: number }
function prismFaces(p: Prism) {
  const dx = p.b[0] - p.a[0], dy = p.b[1] - p.a[1]
  const L = Math.hypot(dx, dy) || 1e-6
  const nx = (-dy / L) * p.th / 2, ny = (dx / L) * p.th / 2
  const c = [[p.a[0] + nx, p.a[1] + ny], [p.b[0] + nx, p.b[1] + ny], [p.b[0] - nx, p.b[1] - ny], [p.a[0] - nx, p.a[1] - ny]] as [number, number][]
  const faces: { ps: [number, number][]; shade: number }[] = []
  for (let i = 0; i < 4; i++) {
    const [x0, y0] = c[i], [x1, y1] = c[(i + 1) % 4]
    // outward normal of this side; visible when it faces the viewer (towards +x+y)
    const ox = y1 - y0, oy = -(x1 - x0)
    const cx = (c[0][0] + c[2][0]) / 2, cy = (c[0][1] + c[2][1]) / 2
    const out = ((x0 + x1) / 2 - cx) * ox + ((y0 + y1) / 2 - cy) * oy > 0 ? 1 : -1
    if ((ox + oy) * out <= 0) continue
    faces.push({ ps: [iso(x0, y0, p.z0), iso(x1, y1, p.z0), iso(x1, y1, p.z1), iso(x0, y0, p.z1)], shade: ox * out > 0 ? 0.82 : 0.68 })
  }
  faces.push({ ps: c.map(([x, y]) => iso(x, y, p.z1)), shade: 1 })
  return faces
}
const shadeHex = (hex: string, k: number) => {
  const n = parseInt(hex.slice(1), 16)
  const f = (v: number) => Math.round(Math.min(255, v * k)).toString(16).padStart(2, '0')
  return `#${f((n >> 16) & 255)}${f((n >> 8) & 255)}${f(n & 255)}`
}

export interface FloorLayerProps {
  rooms: Room[]; steady: WallSeg[] | null; kept: WallSeg[]; removed: WallSeg[]; added: WallSeg[]; t: number; sys: SystemSpec; closed: boolean
  zBase: number; dim?: boolean
}
/** One floor as SVG shapes at height zBase: plate, rooms, cores and walls — kept, coming down (red, or lifted off
 *  green when the system reuses panels), panels in flight, and new walls going up — plus a hatch while closed. */
export function FloorLayer({ rooms, steady, kept, removed, added, t, sys, closed, zBase, dim }: FloorLayerProps) {
  const ends = (s: WallSeg): [[number, number], [number, number]] => (s.o === 'h' ? [[s.a, s.c], [s.b, s.c]] : [[s.c, s.a], [s.c, s.b]])
  const prisms: Prism[] = []
  const add = (s: WallSeg, z1: number, fill: string, z0 = 0, op = 1) => {
    if (z1 - z0 < 0.02) return
    const [a, b] = ends(s)
    prisms.push({ a, b, z0: z0 + zBase, z1: z1 + zBase, th: 0.35, fill: s.glass ? '#a9cbe0' : fill, op: s.glass ? 0.75 * op : op, depth: (a[0] + b[0] + a[1] + b[1]) / 2 })
  }
  for (const c of CORES) prisms.push({ a: [c.r[0], (c.r[1] + c.r[3]) / 2], b: [c.r[2], (c.r[1] + c.r[3]) / 2], z0: zBase, z1: zBase + HZ, th: c.r[3] - c.r[1], fill: '#a6a296', depth: (c.r[0] + c.r[2] + c.r[1] + c.r[3]) / 2 })
  const WALL = '#efece4'
  const reusable = sys.reinstallSek > 0
  if (steady) steady.forEach((s) => add(s, HZ, WALL))
  else {
    kept.forEach((s) => add(s, HZ, WALL))
    // strip-out (0–0.35): what goes comes down; reusable panels lift off whole and turn green, the rest crumbles red
    const k1 = Math.min(1, t / 0.35)
    const share = reusable ? sys.recover : 0
    removed.forEach((s, i) => {
      const whole = reusable && (i % 10) < share * 10
      if (whole) { if (t < 0.35) add(s, HZ + k1 * 1.5, '#7fc59a', k1 * 1.5) }
      else if (t < 0.35) add(s, HZ * (1 - k1), k1 > 0.05 ? '#e0605a' : WALL)
    })
    // panels in flight (claimed Smartax): from where they came down to where they go up
    if (reusable && t >= 0.35 && t < 0.85) {
      const src = removed.filter((_, i) => (i % 10) < share * 10 && !removed[i].glass)
      const k2 = Math.min(1, (t - 0.35) / 0.35)
      added.filter((s) => !s.glass).forEach((s, i) => {
        if (!src.length || i >= src.length * 1.2) return
        const [a0, b0] = ends(src[i % src.length]), [a1, b1] = ends(s)
        const L = (p: number, q: number) => p + (q - p) * k2
        const a: [number, number] = [L(a0[0], a1[0]), L(a0[1], a1[1])], b: [number, number] = [L(b0[0], b1[0]), L(b0[1], b1[1])]
        const lift = 1.5 * (1 - k2)
        prisms.push({ a, b, z0: zBase + lift, z1: zBase + HZ + lift, th: 0.35, fill: '#7fc59a', depth: (a[0] + b[0] + a[1] + b[1]) / 2 })
      })
    }
    // building (0.35–0.85): new walls rise; gypsum stays wet grey until filled and painted
    if (t >= 0.35) {
      const k3 = Math.min(1, (t - 0.35) / 0.5)
      const wet = sys.id === 'gypsum' && t < 1
      const fill = wet ? (t < 0.85 ? '#b8b4aa' : '#c9d4dc') : reusable && t < 0.9 ? '#bfe3cb' : sys.id === 'smartax' && t < 0.9 ? '#ead9b8' : WALL
      added.forEach((s) => add(s, HZ * k3, fill))
    }
  }
  prisms.sort((p, q) => p.depth - q.depth)
  const corners = [iso(0, 0, zBase), iso(PLATE_W, 0, zBase), iso(PLATE_W, PLATE_H, zBase), iso(0, PLATE_H, zBase)]
  const at = (r: number[]) => [iso(r[0], r[1], zBase), iso(r[2], r[1], zBase), iso(r[2], r[3], zBase), iso(r[0], r[3], zBase)] as [number, number][]
  const hid = `hatch-${sys.id}`
  return (
    <g opacity={dim ? 0.45 : 1}>
      <defs>
        <pattern id={hid} width="2.4" height="2.4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="0.9" height="2.4" fill="#f5c443" opacity="0.3" />
        </pattern>
      </defs>
      <polygon points={pts(corners)} fill="#dcd8cc" stroke="#202020" strokeWidth={0.35} />
      {rooms.map((r) => <polygon key={r.id} points={pts(at(r.r))} fill={TYPES[r.t]?.fill ?? '#eee9da'} opacity={r.open ? 0.55 : 0.95} />)}
      <polygon points={pts(at(ATRIUM))} fill="#d6ecd2" stroke="#7fa067" strokeWidth={0.25} />
      {prisms.map((p, i) => prismFaces(p).map((f, j) => (
        <polygon key={`${i}-${j}`} points={pts(f.ps)} fill={shadeHex(p.fill, f.shade)} fillOpacity={p.op ?? 1} stroke="#202020" strokeWidth={0.12} strokeOpacity={0.55} />
      )))}
      {closed && <polygon points={pts(corners)} fill={`url(#${hid})`} />}
    </g>
  )
}
