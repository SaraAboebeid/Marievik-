import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { MarchingCubes } from 'three/examples/jsm/objects/MarchingCubes.js'

// Public art around Marievik, modelled from Sara's photos (October 2026) and placed at their OpenStreetMap
// nodes (tourism=artwork). Simplified, model-maker style: smooth bronze bodies built from ellipsoids and limbs,
// stone and granite plinths. Plan coordinates, z up; each sculpture is built round its own origin, then placed.
//  - Själsfränder, Kerstin Ahlgren: three large bronze women on a low granite platform on the quay
//  - Origin, Pål Svensson: a polished black granite sphere breaking out of split stone, on black slabs
//  - Barnhuvud, Hertha Hillfon: a bronze baby's head on a black granite cube, in B03's courtyard

export interface Artwork { id: string; name: string; artist: string; p: [number, number]; facing: number }
export const ARTWORKS: Artwork[] = [
  { id: 'sjalsfrander', name: 'Själsfränder', artist: 'Kerstin Ahlgren', p: [130.21, -63.82], facing: -109.3 },
  { id: 'origin', name: 'Origin', artist: 'Pål Svensson', p: [9.07, -76.67], facing: -32.5 },
  { id: 'barnhuvud', name: 'Barnhuvud', artist: 'Hertha Hillfon', p: [-12.01, -56.87], facing: -32.5 },
]

type Part = [THREE.BufferGeometry, string]
const col = new THREE.Color()
function paint(g: THREE.BufferGeometry, hex: string) {
  const ng = g.index ? g.toNonIndexed() : g
  for (const k of Object.keys(ng.attributes)) if (!['position', 'normal'].includes(k)) ng.deleteAttribute(k)
  if (!ng.getAttribute('normal')) ng.computeVertexNormals()
  const n = ng.getAttribute('position').count
  const c = new Float32Array(n * 3)
  col.set(hex)
  for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b }
  ng.setAttribute('color', new THREE.BufferAttribute(c, 3))
  ng.clearGroups()
  return ng
}
const merge = (parts: Part[]) => {
  const g = mergeGeometries(parts.map(([p, c]) => paint(p, c)), false)!
  parts.forEach(([p]) => p.dispose())
  return g
}

// ------------------------------------------------------------------ body parts
// Bodies are signed distance fields: ellipsoids and tapered limbs blended with a smooth minimum, then meshed by
// marching cubes, so the forms flow into each other like cast bronze instead of meeting as separate balls.
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
type Prim = { k: 'e'; c: THREE.Vector3; r: [number, number, number]; q: THREE.Quaternion } | { k: 'l'; a: THREE.Vector3; b: THREE.Vector3; ra: number; rb: number }
/** An ellipsoid with radii r, centred at c, its x axis turned to `dir` (default along x). */
function blob(c: THREE.Vector3, r: [number, number, number], dir?: THREE.Vector3): Prim {
  const q = dir ? new THREE.Quaternion().setFromUnitVectors(V(1, 0, 0), dir.clone().normalize()).invert() : new THREE.Quaternion()
  return { k: 'e', c, r, q }
}
/** A tapered limb from a to b (radius ra at a, rb at b), rounded at both ends. */
const limb = (a: THREE.Vector3, b: THREE.Vector3, ra: number, rb: number): Prim[] => [{ k: 'l', a, b, ra, rb }]
const foot = (heel: THREE.Vector3, toe: THREE.Vector3) => limb(heel, toe, 0.075, 0.06)

const _p = new THREE.Vector3(), _ba = new THREE.Vector3()
function sdf(prim: Prim, x: number, y: number, z: number) {
  if (prim.k === 'e') {
    _p.set(x, y, z).sub(prim.c).applyQuaternion(prim.q)
    const [rx, ry, rz] = prim.r
    const k0 = Math.hypot(_p.x / rx, _p.y / ry, _p.z / rz)
    return (k0 - 1) * Math.min(rx, ry, rz)
  }
  _p.set(x, y, z).sub(prim.a)
  _ba.copy(prim.b).sub(prim.a)
  const t = Math.max(0, Math.min(1, _p.dot(_ba) / _ba.lengthSq()))
  return _p.sub(_ba.multiplyScalar(t)).length() - (prim.ra + (prim.rb - prim.ra) * t)
}
const smin = (a: number, b: number, k: number) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25 }

/** Mesh the smooth union of the primitives (marching cubes over their bounding cube). */
function bodyGeometry(prims: Prim[], res = 72, blend = 0.07): THREE.BufferGeometry {
  const lo = V(Infinity, Infinity, Infinity), hi = V(-Infinity, -Infinity, -Infinity)
  for (const p of prims) {
    const pts = p.k === 'e' ? [[p.c, Math.max(...p.r)] as const] : [[p.a, p.ra] as const, [p.b, p.rb] as const]
    for (const [c, r] of pts) { lo.min(V(c.x - r, c.y - r, c.z - r)); hi.max(V(c.x + r, c.y + r, c.z + r)) }
  }
  const c = lo.clone().add(hi).multiplyScalar(0.5)
  const h = Math.max(hi.x - lo.x, hi.y - lo.y, hi.z - lo.z) / 2 + 0.12
  const mc = new MarchingCubes(res, new THREE.MeshBasicMaterial(), false, false, 200000)
  const S = mc.size, half = mc.halfsize
  for (let z = 0; z < S; z++) for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const px = c.x + ((x - half) / half) * h, py = c.y + ((y - half) / half) * h, pz = c.z + ((z - half) / half) * h
    let d = Infinity
    for (const p of prims) d = d === Infinity ? sdf(p, px, py, pz) : smin(d, sdf(p, px, py, pz), blend)
    mc.field[x + y * S + z * S * S] = mc.isolation - d * 400
  }
  mc.update()
  const n = mc.count
  const pos = mc.positionArray.slice(0, n * 3)
  for (let i = 0; i < n; i++) { pos[i * 3] = c.x + pos[i * 3] * h; pos[i * 3 + 1] = c.y + pos[i * 3 + 1] * h; pos[i * 3 + 2] = c.z + pos[i * 3 + 2] * h }
  // smooth normals from the field's gradient (the cubes' own facets band badly under the toon light)
  const field = (x: number, y: number, z: number) => { let d = Infinity; for (const p of prims) d = d === Infinity ? sdf(p, x, y, z) : smin(d, sdf(p, x, y, z), blend); return d }
  const nrm = new Float32Array(n * 3), e = 0.004
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2]
    const gx = field(x + e, y, z) - field(x - e, y, z), gy = field(x, y + e, z) - field(x, y - e, z), gz = field(x, y, z + e) - field(x, y, z - e)
    const l = Math.hypot(gx, gy, gz) || 1
    nrm[i * 3] = gx / l; nrm[i * 3 + 1] = gy / l; nrm[i * 3 + 2] = gz / l
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3))
  mc.geometry.dispose()
  return g
}

// ------------------------------------------------------------------ Själsfränder
/** Lying on her side, curled, head resting on her forearm (the figure on the left in the photos). */
function lyingWoman(): Prim[] {
  return [
    blob(V(0, 0, 0.42), [0.62, 0.5, 0.42]),                         // hips
    blob(V(0.15, -0.05, 0.62), [0.4, 0.38, 0.3]),                    // the upper hip, rolled over
    blob(V(0.72, 0.02, 0.36), [0.52, 0.42, 0.34], V(1, 0, -0.15)),    // torso
    blob(V(0.62, -0.25, 0.33), [0.26, 0.2, 0.22]),                   // breast
    blob(V(1.3, 0.12, 0.38), [0.19, 0.16, 0.2]),                     // head
    blob(V(1.26, 0.14, 0.52), [0.17, 0.15, 0.1]),                    // hair
    ...limb(V(0.95, -0.1, 0.12), V(1.32, 0.0, 0.22), 0.1, 0.08),     // forearm under the head
    ...limb(V(1.0, 0.2, 0.45), V(1.25, 0.2, 0.3), 0.1, 0.08),        // other arm
    ...limb(V(-0.35, -0.05, 0.5), V(-0.9, -0.3, 0.6), 0.26, 0.15),   // upper thigh, drawn up
    ...limb(V(-0.9, -0.3, 0.6), V(-1.3, -0.1, 0.18), 0.14, 0.08),    // shin
    ...foot(V(-1.3, -0.1, 0.12), V(-1.45, -0.18, 0.1)),
    ...limb(V(-0.35, 0.15, 0.25), V(-0.85, 0.25, 0.22), 0.25, 0.14), // lower thigh
    ...limb(V(-0.85, 0.25, 0.22), V(-1.15, 0.3, 0.1), 0.13, 0.08),
    ...foot(V(-1.15, 0.3, 0.06), V(-1.3, 0.32, 0.06)),
  ]
}
/** Reclining, leaning back on a ball, one arm resting over it, legs stretched out (centre). */
function ballWoman(): Prim[] {
  return [
    blob(V(0, 0, 0.3), [0.45, 0.4, 0.3]),                            // hips
    blob(V(0.38, 0, 0.72), [0.25, 0.34, 0.4], V(0.55, 0, 1)),         // torso leaning back
    blob(V(0.3, -0.12, 0.82), [0.14, 0.13, 0.13]), blob(V(0.3, 0.12, 0.82), [0.14, 0.13, 0.13]),
    blob(V(0.48, 0, 1.26), [0.15, 0.13, 0.17]),                      // head, looking along her legs
    blob(V(0.56, 0, 1.3), [0.12, 0.13, 0.15]),                       // hair, gathered
    ...limb(V(0.48, 0, 1.06), V(0.46, 0, 1.15), 0.07, 0.07),         // neck
    ...limb(V(0.55, 0.3, 1.0), V(0.85, 0.35, 0.82), 0.09, 0.07),     // arm over the ball
    ...limb(V(0.85, 0.35, 0.82), V(0.95, 0.15, 0.85), 0.07, 0.06),
    ...limb(V(0.45, -0.32, 0.98), V(0.15, -0.38, 0.62), 0.09, 0.07), // arm resting on her knee
    ...limb(V(0.15, -0.38, 0.62), V(-0.3, -0.3, 0.52), 0.07, 0.06),
    ...limb(V(-0.1, -0.18, 0.3), V(-0.55, -0.25, 0.55), 0.22, 0.13), // raised leg
    ...limb(V(-0.55, -0.25, 0.55), V(-1.0, -0.22, 0.08), 0.12, 0.07),
    ...foot(V(-1.0, -0.22, 0.05), V(-1.15, -0.2, 0.04)),
    ...limb(V(-0.1, 0.18, 0.22), V(-0.65, 0.22, 0.2), 0.22, 0.12),   // leg on the ground
    ...limb(V(-0.65, 0.22, 0.2), V(-1.2, 0.26, 0.08), 0.12, 0.07),
    ...foot(V(-1.2, 0.26, 0.06), V(-1.32, 0.24, 0.1)),
  ]
}
/** Sitting up, one knee raised and hugged in both arms, the other leg folded under (right). */
function sittingWoman(): Prim[] {
  return [
    blob(V(0, 0, 0.36), [0.5, 0.48, 0.36]),                          // seat
    blob(V(0.05, 0, 0.85), [0.3, 0.36, 0.42], V(0.25, 0, 1)),         // torso
    blob(V(0.2, -0.14, 0.9), [0.15, 0.14, 0.14]), blob(V(0.2, 0.14, 0.9), [0.15, 0.14, 0.14]),
    ...limb(V(0.1, 0, 1.18), V(0.12, 0, 1.3), 0.07, 0.07),
    blob(V(0.14, 0, 1.44), [0.15, 0.13, 0.17]),                      // head
    blob(V(0.04, 0, 1.5), [0.12, 0.12, 0.12]),                       // bun
    ...limb(V(0.15, -0.15, 0.32), V(0.55, -0.1, 0.78), 0.22, 0.13),  // raised thigh
    ...limb(V(0.55, -0.1, 0.78), V(0.75, -0.12, 0.08), 0.13, 0.07),  // shin
    ...foot(V(0.75, -0.12, 0.05), V(0.9, -0.12, 0.04)),
    ...limb(V(0.12, 0.3, 1.05), V(0.48, 0.12, 0.92), 0.09, 0.07),    // arms round the knee
    ...limb(V(0.48, 0.12, 0.92), V(0.52, -0.28, 0.82), 0.07, 0.06),
    ...limb(V(0.12, -0.32, 1.02), V(0.42, -0.34, 0.75), 0.09, 0.07),
    ...limb(V(0.42, -0.34, 0.75), V(0.55, 0.05, 0.72), 0.07, 0.06),
    ...limb(V(0.1, 0.3, 0.18), V(0.6, 0.45, 0.15), 0.21, 0.12),      // folded leg
    ...limb(V(0.6, 0.45, 0.15), V(0.15, 0.62, 0.1), 0.12, 0.07),
    ...foot(V(0.15, 0.62, 0.06), V(0.02, 0.62, 0.06)),
  ]
}

function bronze() {
  return new THREE.MeshStandardMaterial({ color: '#8a7350', roughness: 0.42, metalness: 0.45, envMapIntensity: 1.2 })
}
function stoneMat(hex: string, rough = 0.85) { return new THREE.MeshStandardMaterial({ color: hex, roughness: rough }) }

/** Three women on a low granite platform, about 9 x 5 m; x along the quay. */
function sjalsfrander(): THREE.Object3D {
  const g = new THREE.Group()
  const plat = new THREE.Shape([V(-4.6, -2.2, 0), V(4.4, -2.6, 0), V(4.8, 2.4, 0), V(-4.2, 2.6, 0)].map((v) => new THREE.Vector2(v.x, v.y)))
  const top = new THREE.Mesh(new THREE.ExtrudeGeometry(plat, { depth: 0.22, bevelEnabled: false }), stoneMat('#b9b6ae'))
  const curb = new THREE.Mesh(new THREE.ExtrudeGeometry(plat, { depth: 0.2, bevelEnabled: true, bevelSize: 0.18, bevelThickness: 0.02, bevelSegments: 1 }), stoneMat('#9d9a93'))
  top.position.z = 0.02
  g.add(curb, top)
  const s = 1.25   // larger than life
  const fig = (prims: Prim[], x: number, y: number, rot: number, ball = false) => {
    const m = new THREE.Mesh(bodyGeometry(prims), bronze())
    if (ball) {   // her ball: a separate casting she leans on
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.4, 28, 20).translate(0.82, 0, 0.4), m.material)
      b.castShadow = b.receiveShadow = true
      m.add(b)
    }
    m.scale.setScalar(s)
    m.rotation.z = rot
    m.position.set(x, y, 0.24)
    m.castShadow = m.receiveShadow = true
    g.add(m)
  }
  fig(lyingWoman(), -2.6, -0.4, 0.15)       // left, head towards the water side
  fig(ballWoman(), 0.4, 1.3, -0.35, true)         // centre, at the back
  fig(sittingWoman(), 2.9, -0.2, Math.PI)   // right, turned to the others
  return g
}

/** Origin: a polished black sphere on black granite slabs, split stone lying round it like a broken shell. */
function origin(): THREE.Object3D {
  const g = new THREE.Group()
  const slab = new THREE.Mesh(new THREE.BoxGeometry(5.2, 4.2, 0.12).translate(0, 0, 0.06), new THREE.MeshStandardMaterial({ color: '#2b2c2e', roughness: 0.35, metalness: 0.1 }))
  slab.receiveShadow = true
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.85, 48, 32).translate(0, 0, 0.12 + 0.78),
    new THREE.MeshStandardMaterial({ color: '#111214', roughness: 0.05, metalness: 0.35, envMapIntensity: 2.2 }))
  sphere.castShadow = true
  g.add(slab, sphere)
  // the split stone: some broken shell pieces with polished black insides, some rough grey rubble, in a ring
  let seed = 31
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
  const parts: Part[] = []
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + rnd() * 0.2
    const r = 1.0 + rnd() * 0.55
    const shell = rnd() < 0.35
    const geo = new THREE.DodecahedronGeometry(1, 0).scale(0.28 + rnd() * 0.2, 0.2 + rnd() * 0.15, 0.08 + rnd() * 0.07)
    geo.rotateZ(a + rnd() * 0.6).rotateX((rnd() - 0.5) * 0.5).rotateY((rnd() - 0.5) * (shell ? 1.2 : 0.4))
    geo.translate(Math.cos(a) * r, Math.sin(a) * r, 0.16 + (shell ? 0.12 : 0.04))
    parts.push([geo, shell ? '#2a2b2e' : '#8f8e88'])
  }
  const stones = new THREE.Mesh(merge(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, flatShading: true }))
  stones.castShadow = stones.receiveShadow = true
  g.add(stones)
  // Marievik's wayfinding totem beside it: three painted blocks and a sign
  const totem = new THREE.Mesh(merge([
    [new THREE.BoxGeometry(0.5, 0.5, 0.55).translate(0, 0, 0.275), '#b8344a'],
    [new THREE.BoxGeometry(0.5, 0.5, 0.55).translate(0, 0, 0.825), '#2d61b5'],
    [new THREE.BoxGeometry(0.5, 0.5, 0.55).translate(0, 0, 1.375), '#f08a6c'],
    [new THREE.BoxGeometry(0.44, 0.44, 0.3).translate(0, 0, 1.8), '#e9e6dc'],
  ]), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }))
  totem.position.set(-2.1, 1.6, 0.12)
  totem.castShadow = true
  g.add(totem)
  return g
}

/** Barnhuvud: a sleeping baby's head lying on its cheek, on a black granite cube. */
function barnhuvud(): THREE.Object3D {
  const g = new THREE.Group()
  const cube = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.65).translate(0, 0, 0.325),
    new THREE.MeshStandardMaterial({ color: '#141516', roughness: 0.12, metalness: 0.3, envMapIntensity: 1.8 }))
  cube.castShadow = cube.receiveShadow = true
  const geo = bodyGeometry([
    blob(V(0.04, 0, 0.27), [0.3, 0.25, 0.25], V(1, 0, 0.35)),   // the skull, long, tipped back
    blob(V(-0.13, -0.06, 0.12), [0.15, 0.12, 0.12]),           // cheeks
    blob(V(-0.13, 0.08, 0.13), [0.14, 0.11, 0.11]),
    blob(V(-0.235, 0.01, 0.17), [0.06, 0.05, 0.045]),          // nose
    blob(V(-0.215, 0.0, 0.085), [0.05, 0.075, 0.035]),         // lips
    blob(V(-0.19, -0.075, 0.24), [0.03, 0.06, 0.018]),         // closed eyes
    blob(V(-0.19, 0.095, 0.24), [0.03, 0.06, 0.018]),
    blob(V(0.04, 0.22, 0.2), [0.08, 0.03, 0.1]),               // ear
  ], 56, 0.04)
  const head = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#6a5a48', roughness: 0.3, metalness: 0.5, envMapIntensity: 1.4 }))
  head.rotation.x = -0.35          // lying on its cheek
  head.position.set(0, 0, 0.67)
  head.scale.setScalar(1.15)
  head.castShadow = true
  g.add(cube, head)
  return g
}

/** All three, placed and turned to face as mapped. Returns the group and the spots it covers (so the generic
 *  artwork markers there can be left out). */
export function buildSculptures(): { group: THREE.Group; spots: [number, number][] } {
  const group = new THREE.Group()
  group.name = 'sculptures'
  const make: Record<string, () => THREE.Object3D> = { sjalsfrander, origin, barnhuvud }
  for (const a of ARTWORKS) {
    const o = make[a.id]()
    o.position.set(a.p[0], a.p[1], 0.06)
    o.rotation.z = (a.facing * Math.PI) / 180
    o.userData = { artwork: a.id }
    o.traverse((c) => { c.userData.artwork = a.id })
    group.add(o)
  }
  return { group, spots: ARTWORKS.map((a) => a.p) }
}
