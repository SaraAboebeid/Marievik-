import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Ring, UrbanContext, XY } from '../types'
import { segmentBox } from './geometry'

// The model-maker's dressing (after the physical Marievik model at AMF's pavilion): fluffy clustered trees,
// little people on every quay, path, pier and lawn, planters of white flowers, café parasols by the shops,
// railings on the piers and boats out on Årstaviken. Decorative, not data: placed at random (seeded, so the
// same every time) on the surfaces the context says people can be. Everything instanced: a few draw calls.

let seed = 20261029
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)]

// ------------------------------------------------------------------ geometry helpers
export type Piece = [THREE.BufferGeometry, string]
const col = new THREE.Color()
function paint(g: THREE.BufferGeometry, hex: string) {
  const n = g.getAttribute('position').count
  const c = new Float32Array(n * 3)
  col.set(hex)
  for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3))
  return g
}
function clean(g: THREE.BufferGeometry) {
  const ng = g.index ? g.toNonIndexed() : g
  if (!ng.getAttribute('normal')) ng.computeVertexNormals()
  for (const k of Object.keys(ng.attributes)) if (!['position', 'normal', 'color'].includes(k)) ng.deleteAttribute(k)
  ng.clearGroups()
  return ng
}
export const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number, c: string): Piece =>
  [new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z + sz / 2), c]
export const cyl = (r0: number, r1: number, h: number, x: number, y: number, z: number, c: string, seg = 10): Piece =>
  [new THREE.CylinderGeometry(r1, r0, h, seg).rotateX(Math.PI / 2).translate(x, y, z + h / 2), c]
export function kit(pieces: Piece[]) {
  const g = mergeGeometries(pieces.map(([p, c]) => clean(paint(p, c))), false)!
  pieces.forEach(([p]) => p.dispose())
  g.computeVertexNormals()
  return g
}
export const vcMat = (o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, ...o })
export function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[], colors?: THREE.Color[], shadow = true) {
  const im = new THREE.InstancedMesh(geo, mat, Math.max(1, mats.length))
  mats.forEach((m, i) => im.setMatrixAt(i, m))
  colors?.forEach((c, i) => im.setColorAt(i, c))
  im.count = mats.length
  im.instanceMatrix.needsUpdate = true
  if (im.instanceColor) im.instanceColor.needsUpdate = true
  im.castShadow = shadow
  im.receiveShadow = true
  return im
}
const Z = new THREE.Vector3(0, 0, 1)
const _q = new THREE.Quaternion()
export const at = (x: number, y: number, z: number, rot: number, s = 1, sz = s) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q.setFromAxisAngle(Z, rot), new THREE.Vector3(s, s, sz))

// ------------------------------------------------------------------ where things can go
interface Poly { rings: Ring[]; bb: [number, number, number, number] }
const polys = (list: { rings: Ring[][] }[] | undefined): Poly[] => (list ?? []).flatMap((p) => p.rings.filter((r) => r[0]?.length > 2).map((rings) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of rings[0]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
  return { rings, bb: [x0, y0, x1, y1] as [number, number, number, number] }
}))
function inRing(r: Ring, x: number, y: number) {
  let c = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}
const inPoly = (p: Poly, x: number, y: number) =>
  x >= p.bb[0] && x <= p.bb[2] && y >= p.bb[1] && y <= p.bb[3] && inRing(p.rings[0], x, y) && !p.rings.slice(1).some((h) => inRing(h, x, y))
const areaOf = (p: Poly) => {
  const a = (r: Ring) => Math.abs(r.reduce((s, [x, y], i) => { const [u, v] = r[(i + 1) % r.length]; return s + x * v - u * y }, 0)) / 2
  return a(p.rings[0]) - p.rings.slice(1).reduce((s, h) => s + a(h), 0)
}
/** n random points inside a polygon (rejection sampling in its bounding box). */
function scatter(p: Poly, n: number, ok: (x: number, y: number) => boolean) {
  const out: XY[] = []
  for (let k = 0; k < n * 8 && out.length < n; k++) {
    const x = p.bb[0] + rnd() * (p.bb[2] - p.bb[0]), y = p.bb[1] + rnd() * (p.bb[3] - p.bb[1])
    if (inPoly(p, x, y) && ok(x, y)) out.push([x, y])
  }
  return out
}
/** n from a Poisson mean (so small polygons get someone now and then). */
const count = (mean: number) => Math.floor(mean) + (rnd() < mean - Math.floor(mean) ? 1 : 0)

export interface Ground {
  free: (x: number, y: number) => boolean   // not in a building, road, water or rail
  onWater: (x: number, y: number) => boolean
}
export function ground(ctx: UrbanContext, footprints: Ring[]): Ground {
  const blocked = [...polys(ctx.massing), ...polys(ctx.roads), ...polys(ctx.water), ...polys(ctx.parking), ...footprints.map((f) => polys([{ rings: [[f]] }])[0]).filter(Boolean)]
  const water = polys(ctx.water)
  const disc = ctx.circle
  const inDisc = (x: number, y: number) => !disc || Math.hypot(x - disc[0], y - disc[1]) < disc[2] - 4
  return {
    free: (x, y) => inDisc(x, y) && !blocked.some((p) => inPoly(p, x, y)),
    onWater: (x, y) => inDisc(x, y) && water.some((p) => inPoly(p, x, y)),
  }
}

// ------------------------------------------------------------------ trees
/** A crown of 6–9 lumps, like the flocked foam trees of the model; three shapes to vary the canopy. */
function crownGeometry(lumps: number) {
  const parts: THREE.BufferGeometry[] = []
  for (let i = 0; i < lumps; i++) {
    const a = rnd() * Math.PI * 2, r = i === 0 ? 0 : 0.38 + rnd() * 0.22, z = (rnd() - 0.35) * 0.55
    const s = i === 0 ? 0.72 : 0.42 + rnd() * 0.2
    const g = new THREE.IcosahedronGeometry(s, 1)
    const pos = g.getAttribute('position')
    const ph = rnd() * 10
    for (let k = 0; k < pos.count; k++) {   // a little lumpiness on each: a function of the point, so the faces still meet
      const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k)
      const f = 1 + 0.09 * Math.sin(x * 9.1 + ph) * Math.sin(y * 7.3 - ph) + 0.06 * Math.sin(z * 11.7 + ph * 2)
      pos.setXYZ(k, x * f, y * f, z * f)
    }
    parts.push(g.translate(Math.cos(a) * r, Math.sin(a) * r, z).toNonIndexed())
  }
  const g = mergeGeometries(parts, false)!
  parts.forEach((p) => p.dispose())
  g.deleteAttribute('uv')
  g.computeVertexNormals()
  return g
}
export function buildTrees(trees: NonNullable<UrbanContext['trees']>): THREE.Object3D[] {
  if (!trees.length) return []
  seed = 4242
  const out: THREE.Object3D[] = []
  const trunkGeo = new THREE.CylinderGeometry(0.55, 1, 1, 6).rotateX(Math.PI / 2).translate(0, 0, 0.5)
  const trunks: THREE.Matrix4[] = []
  const shapes = [crownGeometry(7), crownGeometry(9), crownGeometry(6)]
  const crowns: { m: THREE.Matrix4[]; c: THREE.Color[] }[] = shapes.map(() => ({ m: [], c: [] }))
  const cones: { m: THREE.Matrix4[]; c: THREE.Color[] } = { m: [], c: [] }
  for (const t of trees) {
    const h = Math.max(3, t.h)
    const r = Math.max(0.1, h * 0.016)
    trunks.push(new THREE.Matrix4().compose(new THREE.Vector3(t.p[0], t.p[1], 0), _q.identity(), new THREE.Vector3(r, r, h * 0.72)))
    if (t.leaf === 'needleleaved') {
      cones.m.push(at(t.p[0], t.p[1], h * 0.22, 0, h * 0.2, h * 0.8))
      cones.c.push(new THREE.Color().setHSL(0.31 + rnd() * 0.04, 0.32, 0.2 + rnd() * 0.06))
      continue
    }
    const cr = h * (0.24 + rnd() * 0.07)
    const k = Math.floor(rnd() * shapes.length)
    crowns[k].m.push(new THREE.Matrix4().compose(new THREE.Vector3(t.p[0], t.p[1], h - cr * 0.9), _q.setFromAxisAngle(Z, rnd() * Math.PI * 2),
      new THREE.Vector3(cr, cr * (0.85 + rnd() * 0.3), cr * (0.8 + rnd() * 0.2))))
    // the model's two greens: a fresh yellow-green and a deep green, and everything between
    const fresh = rnd()
    crowns[k].c.push(new THREE.Color().setHSL(0.19 + fresh * 0.1, 0.36 + rnd() * 0.16, 0.36 - fresh * 0.15 + rnd() * 0.05))
  }
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#5d4a3a', roughness: 1 })
  out.push(instanced(trunkGeo, trunkMat, trunks))
  const leaf = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, flatShading: true })
  shapes.forEach((g, i) => { if (crowns[i].m.length) { const im = instanced(g, leaf, crowns[i].m, crowns[i].c); im.userData.crown = true; out.push(im) } })
  if (cones.m.length) {
    const coneGeo = new THREE.ConeGeometry(1, 1, 8).rotateX(Math.PI / 2).translate(0, 0, 0.5)
    out.push(instanced(coneGeo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, flatShading: true }), cones.m, cones.c))
  }
  for (const o of out) o.userData.trees = true
  return out
}

// ------------------------------------------------------------------ people
export const CLOTHES = ['#c8402f', '#f2efe6', '#2b4a8a', '#e8b923', '#3c7a4a', '#2a2a2e', '#d9c7a4', '#e58fa0', '#1f2f4a', '#8a5a3c', '#5fa3c8', '#f07f3c']
export const SKIN = ['#f1d2b6', '#e2b48f', '#c68c62', '#8d5a3b', '#5e3b26', '#f6dcc6']
/** Little scale figures: legs a shade darker than the top, a head; some sit on the lawns. */
export function buildPeople(spots: { p: XY; z?: number; sit?: boolean }[]): THREE.Object3D[] {
  if (!spots.length) return []
  seed = 777
  spots = [...spots]
  for (let i = spots.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [spots[i], spots[j]] = [spots[j], spots[i]] }   // so a lower count thins everywhere evenly
  const body = kit([
    box(0.13, 0.17, 0.8, -0.075, 0, 0, '#6d6d6d'), box(0.13, 0.17, 0.8, 0.075, 0, 0, '#6d6d6d'),   // legs
    box(0.42, 0.24, 0.6, 0, 0, 0.8, '#ffffff'),                                                   // torso and arms
    box(0.12, 0.1, 0.08, 0, 0, 1.4, '#ffffff'),                                                   // neck
  ])
  const head = new THREE.SphereGeometry(0.12, 8, 6).translate(0, 0, 1.6)
  const bm: THREE.Matrix4[] = [], bc: THREE.Color[] = [], hm: THREE.Matrix4[] = [], hc: THREE.Color[] = []
  for (const s of spots) {
    const rot = rnd() * Math.PI * 2
    const h = 0.92 + rnd() * 0.16                                  // 1.6–1.9 m tall
    const sz = s.sit ? 0.55 : 1
    const m = at(s.p[0], s.p[1], s.z ?? 0.06, rot, h, h * sz)
    bm.push(m)
    hm.push(m)
    bc.push(new THREE.Color(pick(CLOTHES)))
    hc.push(new THREE.Color(pick(SKIN)))
  }
  const out = [instanced(body, vcMat({ roughness: 0.85 }), bm, bc, true), instanced(head, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8 }), hm, hc, false)]
  for (const o of out) o.userData.people = spots.length
  return out
}

/** Where people are: busy on plazas, piers and paved paths, scattered on lawns and in parks, round the study
 *  buildings' doors. */
export function peopleSpots(ctx: UrbanContext, footprints: Ring[], g: Ground) {
  seed = 99
  const spots: { p: XY; z?: number; sit?: boolean }[] = []
  const add = (list: Poly[], per: number, opts: { z?: number; sit?: number } = {}, ok = g.free) => {
    for (const p of list) for (const pt of scatter(p, count(areaOf(p) / per), ok)) spots.push({ p: pt, z: opts.z, sit: rnd() < (opts.sit ?? 0) })
  }
  add(polys(ctx.plazas), 35)
  add(polys((ctx.paths ?? []).filter((p) => p.surface !== 'asphalt')), 70, { z: 0.08 })
  add(polys((ctx.paths ?? []).filter((p) => p.surface === 'asphalt')), 380, { z: 0.08 })
  add(polys(ctx.piers), 32, { z: 0.42 }, () => true)
  const greens = (k: string[]) => (ctx.greens ?? []).filter((x) => k.includes(x.kind))
  add(polys(greens(['park'])), 260, { sit: 0.35 })
  add(polys(greens(['grass'])), 550, { sit: 0.4 })
  add(polys(greens(['playground', 'pitch'])), 90)
  add(polys(greens(['sand'])), 70, { sit: 0.6 })
  // round the study buildings: a ring 2–9 m out from each footprint, about one person per 7 m of facade
  for (const f of footprints) {
    for (let i = 0; i < f.length - 1; i++) {
      const [ax, ay] = f[i], [bx, by] = f[i + 1]
      const len = Math.hypot(bx - ax, by - ay)
      for (let k = count(len / 5); k > 0; k--) {
        const t = rnd(), d = 2 + rnd() * 7
        const nx = (by - ay) / len, ny = -(bx - ax) / len   // one side; the free() test drops the inside
        for (const sgn of [1, -1]) {
          const x = ax + (bx - ax) * t + nx * d * sgn, y = ay + (by - ay) * t + ny * d * sgn
          if (g.free(x, y)) { spots.push({ p: [x, y] }); break }
        }
      }
    }
  }
  return spots
}

// ------------------------------------------------------------------ planters, café parasols
const FLOWERS = ['#f7f5ee', '#f7f5ee', '#f3eef6', '#f4c6d0', '#f6e27a']
export function buildDressing(ctx: UrbanContext, footprints: { ring: Ring; shops: boolean }[], g: Ground): THREE.Object3D[] {
  seed = 314
  const out: THREE.Object3D[] = []
  // planters: a timber box, a green bush, white flowers on top
  const planter = kit([box(1.3, 1.3, 0.45, 0, 0, 0, '#8a6a4a'), box(1.1, 1.1, 0.12, 0, 0, 0.45, '#5f4a36')])
  const bush = new THREE.IcosahedronGeometry(0.62, 1).scale(1, 1, 0.75).translate(0, 0, 0.85)
  const pm: THREE.Matrix4[] = [], bm: THREE.Matrix4[] = [], bc: THREE.Color[] = []
  const place = (x: number, y: number) => {
    const m = at(x, y, 0.06, rnd() * Math.PI)
    pm.push(m)
    bm.push(m)
    bc.push(new THREE.Color(rnd() < 0.55 ? pick(FLOWERS) : new THREE.Color().setHSL(0.25 + rnd() * 0.06, 0.4, 0.33).getStyle()))
  }
  for (const p of [...polys(ctx.plazas), ...polys((ctx.paths ?? []).filter((x) => ['paved', 'paving_stones', 'concrete', 'wood'].includes(x.surface)))]) {
    for (const [x, y] of scatter(p, count(areaOf(p) / 260), g.free)) place(x, y)
  }
  // café parasols with a table and four stools, in twos and threes in front of the shops
  const umb = kit([
    cyl(0.04, 0.04, 2.3, 0, 0, 0, '#d8d4c8', 6),
    [new THREE.ConeGeometry(1.35, 0.45, 8).rotateX(Math.PI / 2).translate(0, 0, 2.35), '#ffffff'] as Piece,
  ])
  const table = kit([cyl(0.04, 0.04, 0.72, 0, 0, 0, '#3d4044', 6), cyl(0.38, 0.38, 0.04, 0, 0, 0.72, '#e9e5da', 12),
    ...[0, 1, 2, 3].map((k): Piece => box(0.34, 0.34, 0.45, Math.cos(k * Math.PI / 2) * 0.7, Math.sin(k * Math.PI / 2) * 0.7, 0, '#6b7a70'))])
  const um: THREE.Matrix4[] = [], uc: THREE.Color[] = [], tm: THREE.Matrix4[] = []
  const PARASOL = ['#f2d24b', '#f2d24b', '#f4f1e8', '#e46a5a', '#2f6e5a', '#f39a7b']
  for (const f of footprints) {
    if (!f.shops) continue
    const r = f.ring
    const edges = r.slice(0, -1).map((p, i) => [p, r[i + 1]] as [XY, XY]).filter(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]) > 10)
    for (let n = 0; n < 3 && edges.length; n++) {
      const [a, b] = pick(edges)
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len
      const tone = pick(PARASOL)
      const t0 = 3 + rnd() * Math.max(1, len - 12)
      for (const sgn of [1, -1]) {
        const nx = uy * sgn, ny = -ux * sgn
        const probe = [a[0] + ux * (t0 + 2) + nx * 4.5, a[1] + uy * (t0 + 2) + ny * 4.5]
        if (!g.free(probe[0], probe[1])) continue
        for (let k = 0; k < 2 + Math.floor(rnd() * 2); k++) {
          const x = a[0] + ux * (t0 + k * 3.2) + nx * (3.6 + rnd() * 0.6), y = a[1] + uy * (t0 + k * 3.2) + ny * (3.6 + rnd() * 0.6)
          if (!g.free(x, y)) continue
          um.push(at(x, y, 0.06, rnd() * Math.PI))
          uc.push(new THREE.Color(tone))
          tm.push(at(x, y, 0.06, rnd() * Math.PI))
        }
        break
      }
    }
  }
  const mat = vcMat({ roughness: 0.75 })
  if (pm.length) {
    out.push(instanced(planter, mat, pm))
    out.push(instanced(bush, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, flatShading: true }), bm, bc))
  }
  if (um.length) {
    out.push(instanced(umb, mat.clone(), um, uc))
    out.push(instanced(table, mat, tm))
  }
  return out
}

// ------------------------------------------------------------------ piers: railings
export function buildPierRails(piers: NonNullable<UrbanContext['piers']>, top = 0.4): THREE.Object3D[] {
  const posts: THREE.Matrix4[] = [], rails: THREE.Matrix4[] = []
  for (const p of piers) for (const rings of p.rings) {
    const r = rings[0]
    if (!r || r.length < 3) continue
    for (let i = 0; i < r.length - 1; i++) {
      const [ax, ay] = r[i], [bx, by] = r[i + 1]
      const len = Math.hypot(bx - ax, by - ay)
      if (len < 1.2) continue
      rails.push(segmentBox(ax, ay, bx, by, top + 0.95, top + 1.0, 0.05, new THREE.Matrix4()))
      rails.push(segmentBox(ax, ay, bx, by, top + 0.5, top + 0.53, 0.03, new THREE.Matrix4()))
      const n = Math.max(1, Math.round(len / 2.2))
      for (let k = 0; k <= n; k++) {
        const t = k / n
        posts.push(at(ax + (bx - ax) * t, ay + (by - ay) * t, top, 0, 1))
      }
    }
  }
  if (!rails.length) return []
  const metal = new THREE.MeshStandardMaterial({ color: '#c9c6bd', roughness: 0.5, metalness: 0.3 })
  const postGeo = new THREE.BoxGeometry(0.06, 0.06, 1).translate(0, 0, 0.5)
  return [instanced(new THREE.BoxGeometry(1, 1, 1), metal, rails, undefined, false), instanced(postGeo, metal, posts, undefined, false)]
}

// ------------------------------------------------------------------ boats
/** Sailing dinghies, yachts and day boats moored or drifting off the shore, 12–70 m out. */
export function buildBoats(waterRings: Ring[][], notShore: (x: number, y: number) => boolean, piers: NonNullable<UrbanContext['piers']>, g: Ground, centre: XY, n = 16): THREE.Object3D[] {
  seed = 2718
  const shore: [number, number, number, number][] = []
  for (const rs of waterRings) for (const r of rs) for (let i = 0; i < r.length - 1; i++) {
    if (notShore(r[i][0], r[i][1]) && notShore(r[i + 1][0], r[i + 1][1])) continue
    shore.push([r[i][0], r[i][1], r[i + 1][0], r[i + 1][1]])
  }
  for (const p of piers) for (const rs of p.rings) { const r = rs[0]; for (let i = 0; i < r.length - 1; i++) shore.push([r[i][0], r[i][1], r[i + 1][0], r[i + 1][1]]) }
  const distShore = (x: number, y: number) => {
    let d = Infinity
    for (const [ax, ay, bx, by] of shore) {
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2))
      d = Math.min(d, Math.hypot(ax + dx * t - x, ay + dy * t - y))
    }
    return d
  }
  const spots: XY[] = []
  for (let k = 0; k < 4000 && spots.length < n; k++) {
    const a = rnd() * Math.PI * 2, r = 60 + rnd() * 520
    const x = centre[0] + Math.cos(a) * r, y = centre[1] + Math.sin(a) * r
    if (!g.onWater(x, y)) continue
    const d = distShore(x, y)
    if (d < 12 || d > 70 || spots.some(([u, v]) => Math.hypot(u - x, v - y) < 25)) continue
    spots.push([x, y])
  }
  if (!spots.length) return []
  const hull = (L: number, B: number, D: number, c: string): Piece => {
    const s = new THREE.Shape()
    s.moveTo(-L / 2, -B / 2); s.lineTo(L * 0.18, -B / 2); s.quadraticCurveTo(L * 0.42, -B / 2, L / 2, 0)
    s.quadraticCurveTo(L * 0.42, B / 2, L * 0.18, B / 2); s.lineTo(-L / 2, B / 2); s.lineTo(-L / 2, -B / 2)
    return [new THREE.ExtrudeGeometry(s, { depth: D, bevelEnabled: false, curveSegments: 6 }), c]
  }
  const sail = (L: number, H: number): Piece => {
    const g2 = new THREE.BufferGeometry()
    g2.setAttribute('position', new THREE.Float32BufferAttribute([0.1, 0, 0.9, -L * 0.42, 0, 0.9, 0.1, 0, 0.9 + H, 0.1, 0, 0.9, 0.1, 0, 0.9 + H, -L * 0.42, 0, 0.9], 3))
    return [g2, '#fbfaf5']
  }
  const sailboat = kit([hull(7, 2.4, 0.7, '#f4f2ec'), box(2.2, 1.3, 0.45, -0.4, 0, 0.7, '#e7e2d6'), cyl(0.05, 0.05, 9, 0.6, 0, 0.7, '#d0ccc2', 6), sail(7, 8.2)])
  const dinghy = kit([hull(4, 1.5, 0.45, '#e9e5da'), cyl(0.04, 0.04, 5, 0.4, 0, 0.45, '#d0ccc2', 6), sail(4.5, 4.3)])
  const dayboat = kit([hull(6.5, 2.3, 0.75, '#f6f4ef'), box(2.2, 1.8, 0.7, -0.6, 0, 0.75, '#3b5f7a'), box(2.4, 2.0, 0.08, -0.6, 0, 1.45, '#f6f4ef')])
  const lists: THREE.Matrix4[][] = [[], [], []]
  for (const [x, y] of spots) lists[Math.floor(rnd() * 3)].push(at(x, y, -0.1, rnd() * Math.PI * 2))
  const mat = vcMat({ roughness: 0.55, side: THREE.DoubleSide })
  return [sailboat, dinghy, dayboat].flatMap((geo, i) => (lists[i].length ? [instanced(geo, mat, lists[i])] : []))
}
