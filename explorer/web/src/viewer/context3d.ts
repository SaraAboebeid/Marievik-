import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Ring, UrbanContext, XY } from '../types'
import { UNIT_BOX, prism, segmentBox } from './geometry'

// The detailed urban context around Marievik (parametric/site/make_context.py → massing, barriers, furniture,
// crossings, markings): neighbouring buildings with colour, windows and pitched roofs, fences and hedges,
// street furniture, zebra crossings and centre lines. Everything is merged or instanced: a few draw calls.

type Massing = NonNullable<UrbanContext['massing']>[number]

const col = new THREE.Color()
function paint(g: THREE.BufferGeometry, hex: string) {
  const n = g.getAttribute('position').count
  const c = new Float32Array(n * 3)
  col.set(hex)
  for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3))
  return g
}
/** Keep only position, normal, uv and color, so different generators merge. */
function clean(g: THREE.BufferGeometry) {
  const ng = g.index ? g.toNonIndexed() : g
  for (const k of Object.keys(ng.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) ng.deleteAttribute(k)
  if (!ng.getAttribute('uv')) ng.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(ng.getAttribute('position').count * 2), 2))
  ng.clearGroups()
  return ng
}
/** Split an ExtrudeGeometry into its caps (group 0) and its walls (group 1). */
function capsAndWalls(g: THREE.BufferGeometry): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const src = g.index ? g.toNonIndexed() : g
  const part = (gi: number) => {
    const out = new THREE.BufferGeometry()
    for (const name of ['position', 'normal', 'uv']) {
      const a = src.getAttribute(name) as THREE.BufferAttribute
      const ranges = src.groups.filter((r) => (r.materialIndex ?? 0) === gi)
      const len = ranges.reduce((s, r) => s + r.count, 0)
      const arr = new Float32Array(len * a.itemSize)
      let o = 0
      for (const r of ranges) {
        arr.set((a.array as Float32Array).subarray(r.start * a.itemSize, (r.start + r.count) * a.itemSize), o)
        o += r.count * a.itemSize
      }
      out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize))
    }
    return out
  }
  return [part(0), part(1)]
}

/** A gabled or hipped roof over a rectangle (long side c0→c1), from the wall top z up by rh. */
function pitchedRoof(r: NonNullable<Massing['roof']>, z: number, roofHex: string, wallHex: string) {
  const [c0, c1, c2, c3] = r.rect.map(([x, y]) => new THREE.Vector3(x, y, z))
  const long = c0.distanceTo(c1)
  const short = c1.distanceTo(c2)
  const u = c1.clone().sub(c0).normalize()
  const m03 = c0.clone().add(c3).multiplyScalar(0.5).setZ(z + r.rh)
  const m12 = c1.clone().add(c2).multiplyScalar(0.5).setZ(z + r.rh)
  const inset = r.shape === 'hipped' ? Math.min(short / 2, long / 2 - 0.01) : 0
  const r0 = m03.clone().addScaledVector(u, inset)
  const r1 = m12.clone().addScaledVector(u, -inset)
  const centre = c0.clone().add(c2).multiplyScalar(0.5)
  const pos: number[] = []
  const cols: number[] = []
  const roofC = new THREE.Color(roofHex)
  const wallC = new THREE.Color(wallHex)
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, k: THREE.Color) => {
    const n = b.clone().sub(a).cross(c.clone().sub(a))
    const out = a.clone().add(b).add(c).multiplyScalar(1 / 3).sub(centre)
    if (n.dot(out) < 0) [b, c] = [c, b]
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
    for (let i = 0; i < 3; i++) cols.push(k.r, k.g, k.b)
  }
  const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, k: THREE.Color) => { tri(a, b, c, k); tri(a, c, d, k) }
  quad(c0, c1, r1, r0, roofC)
  quad(c2, c3, r0, r1, roofC)
  tri(c0, r0, c3, r.shape === 'hipped' ? roofC : wallC)
  tri(c1, c2, r1, r.shape === 'hipped' ? roofC : wallC)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3))
  g.computeVertexNormals()
  return clean(g)
}

/** A facade texture: white wall with a soft grid of windows, one per ~2.8 m bay and ~3.1 m storey (world UVs). */
function windowTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const x = c.getContext('2d')!
  x.fillStyle = '#ffffff'
  x.fillRect(0, 0, 64, 64)
  x.fillStyle = '#a9b1b5'
  x.fillRect(20, 18, 24, 28)
  x.fillStyle = '#ccd1d3'
  x.fillRect(20, 18, 24, 3)
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(1 / 2.8, 1 / 3.1)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 16   // clamped to the GPU's max; keeps the window grid from shimmering on facades seen at an angle
  return t
}
const PLAIN = new Set(['shed', 'garage', 'garages', 'allotment_house', 'roof', 'parking', 'storage_tank', 'service', 'toilets', 'kiosk', 'bridge'])

export function buildMassing(list: Massing[]): THREE.Object3D[] {
  const caps: THREE.BufferGeometry[] = []
  const walls: THREE.BufferGeometry[] = []
  const blank: THREE.BufferGeometry[] = []
  for (const b of list) {
    const top = b.h
    for (const rings of b.rings) {
      const g = prism(rings as Ring[], b.z0 ?? 0, top)
      if (!g) continue
      const [cap, wall] = capsAndWalls(g)
      g.dispose()
      caps.push(clean(paint(cap, b.rc)))
      ;(PLAIN.has(b.kind ?? '') || top - (b.z0 ?? 0) < 4 ? blank : walls).push(clean(paint(wall, b.c)))
    }
    if (b.roof) caps.push(pitchedRoof(b.roof, top, b.rc, b.c))
  }
  const out: THREE.Object3D[] = []
  const mesh = (gs: THREE.BufferGeometry[], mat: THREE.Material) => {
    if (!gs.length) return
    const m = mergeGeometries(gs, false)
    gs.forEach((x) => x.dispose())
    if (!m) return
    m.computeVertexNormals()
    const o = new THREE.Mesh(m, mat)
    o.castShadow = o.receiveShadow = true
    out.push(o)
  }
  mesh(caps, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: true }))
  mesh(walls, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, map: windowTexture() }))
  mesh(blank, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }))
  return out
}

// ------------------------------------------------------------------ fences, walls, hedges
const BARRIER: Record<string, { c: string; w: number; rough?: number }> = {
  fence: { c: '#5b5f62', w: 0.06 }, railing: { c: '#6d7174', w: 0.06 }, handrail: { c: '#6d7174', w: 0.06 },
  guard_rail: { c: '#a3a7a9', w: 0.12 }, wall: { c: '#bcb4a6', w: 0.3 }, city_wall: { c: '#a99f90', w: 0.8 },
  retaining_wall: { c: '#a9a193', w: 0.45 }, hedge: { c: '#4d6c3b', w: 0.9 }, jersey_barrier: { c: '#cdc8bd', w: 0.6 },
}
export function buildBarriers(list: NonNullable<UrbanContext['barriers']>): THREE.Object3D[] {
  const out: THREE.Object3D[] = []
  const m4 = new THREE.Matrix4()
  for (const b of list) {
    const s = BARRIER[b.kind] ?? BARRIER.fence
    const segs: [XY, XY][] = []
    for (const ln of b.lines) for (let i = 0; i < ln.length - 1; i++) if (Math.hypot(ln[i + 1][0] - ln[i][0], ln[i + 1][1] - ln[i][1]) > 0.05) segs.push([ln[i], ln[i + 1]])
    if (!segs.length) continue
    const mat = new THREE.MeshStandardMaterial({ color: s.c, roughness: b.kind === 'hedge' ? 1 : 0.8, flatShading: b.kind === 'hedge' })
    const im = new THREE.InstancedMesh(UNIT_BOX, mat, segs.length)
    segs.forEach(([a, c], i) => im.setMatrixAt(i, segmentBox(a[0], a[1], c[0], c[1], 0, b.h, s.w, m4)))
    im.instanceMatrix.needsUpdate = true
    im.castShadow = im.receiveShadow = true
    out.push(im)
  }
  return out
}

// ------------------------------------------------------------------ road paint
export function buildRoadPaint(crossings: NonNullable<UrbanContext['crossings']>, markings: NonNullable<UrbanContext['markings']>): THREE.Object3D[] {
  const mats: THREE.Matrix4[] = []
  const q = new THREE.Quaternion()
  const Z = new THREE.Vector3(0, 0, 1)
  // zebra: bars along the street, 0.5 m wide, 1 m apart, across its width
  for (const [x, y, deg, w, z] of crossings) {
    const a = (deg * Math.PI) / 180
    const n: XY = [-Math.sin(a), Math.cos(a)]
    q.setFromAxisAngle(Z, a)
    for (let s = -w / 2 + 0.5; s <= w / 2 - 0.4; s += 1.0) {
      mats.push(new THREE.Matrix4().compose(new THREE.Vector3(x + n[0] * s, y + n[1] * s, (z ?? 0) + 0.075), q, new THREE.Vector3(3.0, 0.5, 0.02)))
    }
  }
  // centre lines: 3 m dashes every 9 m
  for (const m of markings) {
    for (const ln of m.lines) {
      let carry = 0
      for (let i = 0; i < ln.length - 1; i++) {
        const [ax, ay] = ln[i]
        const [bx, by] = ln[i + 1]
        const len = Math.hypot(bx - ax, by - ay)
        if (len < 0.01) continue
        const ux = (bx - ax) / len
        const uy = (by - ay) / len
        q.setFromAxisAngle(Z, Math.atan2(uy, ux))
        let d = carry
        for (; d + 3 <= len; d += 9) {
          mats.push(new THREE.Matrix4().compose(new THREE.Vector3(ax + ux * (d + 1.5), ay + uy * (d + 1.5), (m.z ?? 0) + 0.07), q, new THREE.Vector3(3, 0.15, 0.02)))
        }
        carry = Math.max(0, d - len)
      }
    }
  }
  if (!mats.length) return []
  const im = new THREE.InstancedMesh(UNIT_BOX, new THREE.MeshStandardMaterial({ color: '#efede6', roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), mats.length)
  mats.forEach((m, i) => im.setMatrixAt(i, m))
  im.instanceMatrix.needsUpdate = true
  im.receiveShadow = true
  return [im]
}

// ------------------------------------------------------------------ street furniture
// Each kind is a little kit of boxes and cylinders (local x along the path it stands by), merged and instanced.
type Piece = [THREE.BufferGeometry, string]
const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number, c: string, rz = 0): Piece => {
  const g = new THREE.BoxGeometry(sx, sy, sz)
  if (rz) g.rotateZ(rz)
  return [g.translate(x, y, z + sz / 2), c]
}
const cyl = (r: number, h: number, x: number, y: number, z: number, c: string, seg = 10): Piece =>
  [new THREE.CylinderGeometry(r, r, h, seg).rotateX(Math.PI / 2).translate(x, y, z + h / 2), c]
const WOOD = '#8a6a4a'
const METAL = '#3d4044'
const KITS: Record<string, () => Piece[]> = {
  bench: () => [box(1.8, 0.45, 0.06, 0, 0, 0.42, WOOD), box(1.8, 0.06, 0.42, 0, -0.22, 0.5, WOOD),
    box(0.06, 0.45, 0.42, -0.8, 0, 0, METAL), box(0.06, 0.45, 0.42, 0.8, 0, 0, METAL)],
  picnic: () => [box(1.8, 0.75, 0.06, 0, 0, 0.72, WOOD), box(1.8, 0.28, 0.05, 0, 0.62, 0.42, WOOD), box(1.8, 0.28, 0.05, 0, -0.62, 0.42, WOOD),
    box(0.08, 1.5, 0.06, -0.7, 0, 0.36, WOOD), box(0.08, 1.5, 0.06, 0.7, 0, 0.36, WOOD), box(0.08, 0.08, 0.72, -0.7, 0, 0, WOOD), box(0.08, 0.08, 0.72, 0.7, 0, 0, WOOD)],
  lounger: () => [box(0.7, 1.9, 0.08, 0, 0, 0.32, WOOD, 0), box(0.7, 0.7, 0.08, 0, 0.7, 0.55, WOOD), box(0.6, 0.1, 0.32, 0, -0.8, 0, METAL), box(0.6, 0.1, 0.55, 0, 0.9, 0, METAL)],
  bin: () => [cyl(0.24, 0.85, 0, 0, 0, '#3f4a44'), cyl(0.26, 0.06, 0, 0, 0.85, '#2c332f')],
  grit_bin: () => [box(0.9, 0.5, 0.6, 0, 0, 0, '#d7a521')],
  bike: () => [-0.7, 0, 0.7].flatMap((x): Piece[] => [box(0.05, 0.05, 0.8, x, -0.35, 0, '#6d7175'), box(0.05, 0.05, 0.8, x, 0.35, 0, '#6d7175'), box(0.05, 0.75, 0.05, x, 0, 0.78, '#6d7175')]),
  shelter: () => [box(3.6, 1.6, 0.12, 0, 0, 2.4, '#4a4e52'), box(3.6, 0.05, 2.1, 0, -0.75, 0.25, '#b9cbd2'), box(0.05, 1.5, 2.1, -1.78, 0, 0.25, '#b9cbd2'),
    box(0.08, 0.08, 2.4, -1.75, -0.75, 0, METAL), box(0.08, 0.08, 2.4, 1.75, -0.75, 0, METAL), box(0.08, 0.08, 2.4, 1.75, 0.75, 0, METAL), box(0.08, 0.08, 2.4, -1.75, 0.75, 0, METAL),
    box(1.6, 0.35, 0.05, 0.2, -0.5, 0.45, WOOD), box(0.5, 0.05, 0.4, 2.1, 0.6, 2.2, '#2b5aa8'), box(0.06, 0.06, 2.6, 2.1, 0.6, 0, METAL)],
  bus_stop: () => [box(0.07, 0.07, 2.6, 0, 0, 0, METAL), box(0.06, 0.5, 0.4, 0, 0, 2.2, '#2b5aa8')],
  artwork: () => [box(0.9, 0.9, 0.8, 0, 0, 0, '#c9c2b5'), [new THREE.IcosahedronGeometry(0.62, 0).translate(0, 0, 1.45), '#d9784f'] as Piece],
  life_ring: () => [box(0.1, 0.1, 1.3, 0, 0, 0, '#6d7174'), [new THREE.TorusGeometry(0.28, 0.07, 6, 14).rotateY(Math.PI / 2).translate(0.08, 0, 1.0), '#e0602a'] as Piece],
  post_box: () => [box(0.08, 0.08, 0.9, 0, 0, 0, METAL), box(0.45, 0.3, 0.5, 0, 0, 0.9, '#e8b923')],
  recycling: () => [box(1.3, 1.2, 1.5, -1.4, 0, 0, '#4f7d4d'), box(1.3, 1.2, 1.5, 0, 0, 0, '#3e6a99'), box(1.3, 1.2, 1.5, 1.4, 0, 0, '#9a9a94')],
  fountain: () => [cyl(1.6, 0.5, 0, 0, 0, '#b9b2a5', 20), cyl(1.4, 0.02, 0, 0, 0.45, '#6f95ad', 20), cyl(0.15, 1.2, 0, 0, 0.5, '#b9b2a5')],
  flagpole: () => [cyl(0.06, 9, 0, 0, 0, '#f1efe9'), box(1.6, 0.02, 1.0, 0.82, 0, 7.8, '#2a5ca8'), box(1.6, 0.03, 0.2, 0.82, 0, 8.2, '#f0c419'), box(0.2, 0.03, 1.0, 0.55, 0, 7.8, '#f0c419')],
  bollard: () => [cyl(0.1, 0.9, 0, 0, 0, METAL, 8)],
  signal: () => [box(0.1, 0.1, 3.4, 0, 0, 0, METAL), box(0.3, 0.25, 0.9, 0, 0.18, 2.4, '#2f3133')],
  locker: () => [box(2.2, 0.6, 1.9, 0, 0, 0, '#d9d4c8'), box(2.2, 0.62, 0.1, 0, 0, 1.9, '#5c5f63')],
  toilets: () => [box(2.0, 2.0, 2.6, 0, 0, 0, '#7f8c86'), box(2.2, 2.2, 0.12, 0, 0, 2.6, '#3d4044')],
  tap: () => [box(0.14, 0.14, 0.95, 0, 0, 0, '#4a6a8a')],
  bbq: () => [cyl(0.38, 0.75, 0, 0, 0, '#3b3b3d', 12)],
  fitness: () => [box(0.1, 0.1, 2.2, -1, 0, 0, '#c8442f'), box(0.1, 0.1, 2.2, 1, 0, 0, '#c8442f'), box(2.0, 0.06, 0.06, 0, 0, 2.15, '#6d7175'), box(2.0, 0.06, 0.06, 0, 0, 1.4, '#6d7175')],
  info: () => [box(0.07, 0.07, 1.6, -0.5, 0, 0, METAL), box(0.07, 0.07, 1.6, 0.5, 0, 0, METAL), box(1.2, 0.06, 0.8, 0, 0, 0.8, '#2b4a6b')],
  charger: () => [box(0.45, 0.3, 1.45, 0, 0, 0, '#3c8f5f')],
  lamp: () => [cyl(0.08, 5.4, 0, 0, 0, METAL, 8), cyl(0.3, 0.32, 0, 0, 5.4, '#fff1c2', 12), cyl(0.36, 0.1, 0, 0, 5.72, '#2f3133', 12)],
}

export function buildFurniture(furniture: NonNullable<UrbanContext['furniture']>): THREE.Object3D[] {
  const out: THREE.Object3D[] = []
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.1 })
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const Z = new THREE.Vector3(0, 0, 1)
  const one = new THREE.Vector3(1, 1, 1)
  for (const [kind, pts] of Object.entries(furniture)) {
    if (!pts.length) continue
    const kit = (KITS[kind] ?? KITS.bollard)()
    const geo = mergeGeometries(kit.map(([g, c]) => clean(paint(g, c))), false)
    kit.forEach(([g]) => g.dispose())
    if (!geo) continue
    geo.computeVertexNormals()
    const im = new THREE.InstancedMesh(geo, mat, pts.length)
    pts.forEach(([x, y, deg], i) => {
      q.setFromAxisAngle(Z, ((deg ?? 0) * Math.PI) / 180)
      im.setMatrixAt(i, m4.compose(new THREE.Vector3(x, y, 0.06), q, one))
    })
    im.instanceMatrix.needsUpdate = true
    im.castShadow = true
    im.receiveShadow = true
    out.push(im)
  }
  return out
}
