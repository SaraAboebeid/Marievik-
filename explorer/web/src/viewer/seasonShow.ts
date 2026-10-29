import * as THREE from 'three'
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import type { FloorPayload, Ring, UrbanContext, XY } from '../types'
import type { Amenity } from '../urbanLife'
import { KINDS, PROGRAMME, SEASONS, SETUP_STAYS, ZONES, nightOf, onAt, streetLife, unitProgram, weatherAt, type Activity, type Kind } from '../seasons'
import { CLOTHES, SKIN, at, box, cyl, instanced, kit, vcMat, type Ground, type Piece } from './dress'
import { flat, prism, segmentBox } from './geometry'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
const mergeGeometriesSafe = (gs: THREE.BufferGeometry[]) => { gs.forEach((g) => g.deleteAttribute('uv')); const m = mergeGeometries(gs, false)!; gs.forEach((g) => g.dispose()); m.computeVertexNormals(); return m }

// The seasons show (Urban / District scale, layer "Seasons & hours"): the study buildings cut open to their
// ground-floor plans, each unit lit in the colour of what it is used for at that hour; the outdoor places set up
// for each season's activities (markets, a concert stage, a sauna, an ice rink …) with crowds when they're on and
// beams of light at night; the trees through the year, falling leaves, rain, snow settling; cafés and restaurants
// round about glowing when open. Plan coordinates, z up, inside the viewer's world group.

let seed = 1
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)]
const Z = new THREE.Vector3(0, 0, 1)

// ------------------------------------------------------------------ shared bits
let radialTex: THREE.Texture | null = null
function radial() {
  if (radialTex) return radialTex
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const x = c.getContext('2d')!
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)')
  x.fillStyle = g
  x.fillRect(0, 0, 64, 64)
  radialTex = new THREE.CanvasTexture(c)
  return radialTex
}
const glowMat = (hex: string, opacity = 1) => new THREE.MeshBasicMaterial({ color: hex, map: radial(), transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
const lampMat = (hex: string) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(2.2), toneMapped: false })

/** A beam of light: apex at the origin along +z, fading with distance; additive, so the bloom takes it up. */
function beamMaterial(hex: string, strength = 0.32) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
    uniforms: { uColor: { value: new THREE.Color(hex) }, uA: { value: strength } },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying float vY; varying vec3 vN; varying vec3 vV;
      void main() { vY = uv.y; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uColor; uniform float uA; varying float vY; varying vec3 vN; varying vec3 vV;
      void main() {
        #include <logdepthbuf_fragment>
        // clamped: pow() of a negative base is NaN, and one NaN pixel smears into black blocks through the bloom
        float edge = pow(clamp(abs(dot(vN, vV)), 0.0, 1.0), 1.2); float a = uA * pow(clamp(1.0 - vY, 0.0, 1.0), 1.3) * (0.25 + edge);
        a = clamp(a, 0.0, 1.0);
        gl_FragColor = vec4(uColor * a * 1.8, a); }`,
  })
}
function beam(hex: string, len: number, spread: number, strength?: number) {
  const g = new THREE.CylinderGeometry(len * spread, 0.25, len, 24, 1, true).translate(0, len / 2, 0).rotateX(Math.PI / 2)
  const m = new THREE.Mesh(g, beamMaterial(hex, strength))
  m.renderOrder = 5
  m.frustumCulled = false
  return m
}

/** Little scale figures (as viewer/dress.ts), instanced from matrices. */
let figGeo: { body: THREE.BufferGeometry; head: THREE.BufferGeometry } | null = null
function figures(mats: THREE.Matrix4[], clothes?: string[]) {
  if (!figGeo) figGeo = {
    body: kit([box(0.13, 0.17, 0.8, -0.075, 0, 0, '#6d6d6d'), box(0.13, 0.17, 0.8, 0.075, 0, 0, '#6d6d6d'), box(0.42, 0.24, 0.6, 0, 0, 0.8, '#ffffff'), box(0.12, 0.1, 0.08, 0, 0, 1.4, '#ffffff')]),
    head: new THREE.SphereGeometry(0.12, 8, 6).translate(0, 0, 1.6),
  }
  const g = new THREE.Group()
  if (!mats.length) return { group: g, body: null as THREE.InstancedMesh | null, head: null as THREE.InstancedMesh | null }
  const body = instanced(figGeo.body, vcMat({ roughness: 0.85 }), mats, mats.map(() => new THREE.Color(pick(clothes ?? CLOTHES))), false)
  const head = instanced(figGeo.head, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8 }), mats, mats.map(() => new THREE.Color(pick(SKIN))), false)
  g.add(body, head)
  return { group: g, body, head }
}
const _q = new THREE.Quaternion(), _qx = new THREE.Quaternion()
/** A figure lying on its back along local x. */
const lying = (x: number, y: number, z: number, rot: number) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z + 0.12), _q.setFromAxisAngle(Z, rot).multiply(_qx.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)), new THREE.Vector3(1, 1, 1))
const merged = (pieces: Piece[], o: THREE.MeshStandardMaterialParameters = {}) => {
  const m = new THREE.Mesh(kit(pieces), vcMat(o))
  m.castShadow = m.receiveShadow = true
  return m
}
/** Fairy lights strung between points (local), sagging a little; bulbs only lit at night. */
function stringLights(pairs: [THREE.Vector3, THREE.Vector3][], hex = '#ffd27a') {
  const pts: THREE.Matrix4[] = []
  for (const [a, b] of pairs) {
    const n = Math.max(4, Math.round(a.distanceTo(b) / 0.8))
    for (let i = 0; i <= n; i++) {
      const t = i / n
      const p = a.clone().lerp(b, t)
      p.z -= Math.sin(t * Math.PI) * a.distanceTo(b) * 0.06
      pts.push(new THREE.Matrix4().makeTranslation(p.x, p.y, p.z))
    }
  }
  const im = instanced(new THREE.SphereGeometry(0.09, 6, 4), lampMat(hex), pts, undefined, false)
  im.userData.night = true
  return im
}
const poleGeo = () => cyl(0.06, 0.06, 4, 0, 0, 0, '#3d4044', 6)

// ------------------------------------------------------------------ particles (smoke, steam)
class Puffs {
  points: THREE.Points
  private v: Float32Array
  constructor(private sources: THREE.Vector3[], private n = 40, colour = '#e9e9e6', size = 6, private rise = 1.2, private life = 5) {
    const pos = new Float32Array(sources.length * n * 3)
    this.v = new Float32Array(sources.length * n)
    for (let i = 0; i < this.v.length; i++) this.v[i] = rnd() * life
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ color: colour, size, sizeAttenuation: false, transparent: true, opacity: 0.55, depthWrite: false, map: radial() }))
    this.points.frustumCulled = false
  }
  step(dt: number) {
    const pos = this.points.geometry.getAttribute('position') as THREE.BufferAttribute
    const a = pos.array as Float32Array
    this.sources.forEach((s, si) => {
      for (let k = 0; k < this.n; k++) {
        const i = si * this.n + k
        this.v[i] += dt
        if (this.v[i] > this.life) this.v[i] = 0
        const t = this.v[i]
        a[i * 3] = s.x + Math.sin(i * 1.7 + t) * 0.3 * t
        a[i * 3 + 1] = s.y + Math.cos(i * 2.3) * 0.25 * t + t * 0.4
        a[i * 3 + 2] = s.z + t * this.rise
      }
    })
    pos.needsUpdate = true
  }
}

// ------------------------------------------------------------------ the kits for each activity
interface KitOut {
  setup: THREE.Object3D[]           // stays up through the season
  live: THREE.Object3D[]            // only while the activity is on
  crowd: THREE.Matrix4[]            // people (local) while it's on
  crowdClothes?: string[]
  beams?: { p: THREE.Vector3; d: THREE.Vector3; sweep: number }[]
  step?: (t: number, dt: number, on: number, crowd: THREE.Group | null) => void
}
interface Frame { o: XY; ang: number; ex: number; ey: number; z: number; free: (x: number, y: number) => boolean; water: (x: number, y: number) => boolean }

const STRIPES = ['#d8453a', '#f2c230', '#2f7a5c', '#2b5aa8', '#e0703a']
function stall(x: number, y: number, rot: number, awning: string, goods: string[]): Piece[] {
  const c = Math.cos(rot), s = Math.sin(rot)
  const P = (lx: number, ly: number): [number, number] => [x + lx * c - ly * s, y + lx * s + ly * c]
  const out: Piece[] = []
  const add = (p: Piece) => { const g = p[0]; g.rotateZ(rot); const [px, py] = [x, y]; g.translate(px, py, 0); out.push(p) }
  add(box(2.6, 1.2, 0.9, 0, 0, 0, '#9a7a56'))                          // counter
  add(box(2.8, 1.8, 0.06, 0, -0.2, 2.25, awning))                      // awning
  add(box(2.8, 0.05, 0.35, 0, -1.1, 1.92, '#ffffff'))                  // valance
  for (const lx of [-1.3, 1.3]) for (const ly of [-1.0, 0.6]) add(box(0.06, 0.06, 2.25, lx, ly, 0, '#4a3a2c'))
  for (let k = 0; k < 6; k++) add(box(0.3, 0.3, 0.22, -1.0 + k * 0.4, -0.2, 0.9, goods[k % goods.length]))
  void P
  return out
}
function hut(x: number, y: number, rot: number, snow: boolean): Piece[] {
  const out: Piece[] = []
  const add = (p: Piece) => { p[0].rotateZ(rot); p[0].translate(x, y, 0); out.push(p) }
  add(box(2.4, 2.0, 2.2, 0, 0, 0, '#7a5434'))
  const roof = new THREE.CylinderGeometry(0.01, 1.75, 1.0, 4, 1).rotateY(Math.PI / 4).scale(1.0, 1, 1).rotateX(Math.PI / 2).translate(0, 0, 2.7)
  add([roof, snow ? '#f4f6f7' : '#5a3a26'])
  add(box(2.0, 0.08, 0.9, 0, -1.02, 1.0, '#e9c98a'))                  // the open hatch, lit
  return out
}

function buildKit(name: string, act: Activity, f: Frame): KitOut {
  seed = [...name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 2147483647, 11) || 11
  const out: KitOut = { setup: [], live: [], crowd: [] }
  const W = Math.min(f.ex, 26), H = Math.min(f.ey, 18)
  const crowdAround = (cx: number, cy: number, rx: number, ry: number, n: number, z = f.z, face?: [number, number]) => {
    for (let i = 0, tries = 0; i < n && tries < n * 4; tries++) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd())
      const x = cx + Math.cos(a) * rx * r, y = cy + Math.sin(a) * ry * r
      if (f.z < 0.2 && !f.free(...f2w(f, x, y))) continue   // not inside a building or on the road
      i++
      const rot = face ? Math.atan2(face[1] - y, face[0] - x) - Math.PI / 2 : rnd() * Math.PI * 2
      out.crowd.push(at(x, y, z, rot, 0.95 + rnd() * 0.12))
    }
  }
  const z = 0                 // the kit's group sits at the deck's height (f.z); things in the water go down by zw
  const zw = -f.z
  switch (act.kit) {
    case 'foodmarket': case 'harvest': case 'flea': case 'plants': case 'pumpkins': {
      const goods = act.kit === 'harvest' || act.kit === 'pumpkins' ? ['#e0782f', '#c8452e', '#e8b830', '#7a9a3c'] : act.kit === 'plants' ? ['#4f8a3a', '#7fb05a', '#e58fa0', '#f2efe6']
        : act.kit === 'flea' ? ['#2b5aa8', '#e8b923', '#c8402f', '#d9c7a4', '#8a5a3c'] : ['#c8402f', '#e8b923', '#f2efe6', '#8a5a3c']
      const pieces: Piece[] = []
      const n = Math.max(3, Math.min(7, Math.floor(W / 3.4)))
      for (let i = 0; i < n; i++) {
        const x = -W * 0.6 + (i + 0.5) * (W * 1.2 / n)
        pieces.push(...stall(x, -H * 0.35, 0, STRIPES[i % STRIPES.length], goods), ...stall(x, H * 0.35, Math.PI, STRIPES[(i + 2) % STRIPES.length], goods))
      }
      if (act.kit === 'pumpkins' || act.kit === 'harvest') for (let i = 0; i < 26; i++) pieces.push([new THREE.SphereGeometry(0.28 + rnd() * 0.15, 10, 8).scale(1, 1, 0.75).translate(-W * 0.5 + rnd() * W, (rnd() - 0.5) * H * 0.3, 0.2), pick(['#e0782f', '#e8962f', '#d26a24'])])
      const m = merged(pieces)
      ;(SETUP_STAYS.has(act.kit) ? out.setup : out.live).push(m)
      if (act.kit === 'foodmarket') {
        const grills = [V(-W * 0.3, 0, z), V(W * 0.15, 1.5, z), V(W * 0.45, -1.2, z)]
        out.live.push(merged(grills.flatMap((g): Piece[] => [cyl(0.4, 0.4, 0.5, g.x, g.y, 0.4, '#2c2c2e', 12), cyl(0.03, 0.03, 0.4, g.x, g.y, 0, '#3d4044', 6)])))
        const smoke = new Puffs(grills.map((g) => g.clone().setZ(1.1)), 30, '#d9d6cf', 9, 1.1, 6)
        out.live.push(smoke.points)
        out.step = (_t, dt) => smoke.step(dt)
      }
      crowdAround(0, 0, W * 0.6, H * 0.25, act.crowd)
      break
    }
    case 'acoustic': case 'concert': case 'cinema': {
      const big = act.kit === 'concert'
      const sw = big ? 14 : act.kit === 'cinema' ? 12 : 6, sd = big ? 8 : 4
      const sx = W * 0.62, pieces: Piece[] = []
      if (act.kit === 'cinema') {
        pieces.push(box(0.3, 12, 6.8, sx, 0, 1.2, '#f4f3ee'), box(0.25, 0.25, 8, sx + 0.3, -5.5, 0, '#3d4044'), box(0.25, 0.25, 8, sx + 0.3, 5.5, 0, '#3d4044'))
        const screen = new THREE.Mesh(new THREE.PlaneGeometry(11.6, 6.4).rotateY(-Math.PI / 2).translate(sx - 0.17, 0, z + 4.6), new THREE.MeshBasicMaterial({ color: '#9ec7ff', toneMapped: false }))
        screen.userData.night = true
        out.live.push(screen)
        for (let r = 0; r < 6; r++) for (let k = 0; k < 10; k++) pieces.push(box(0.6, 0.55, 0.35, sx - 8 - r * 1.6, -6 + k * 1.3, 0, pick(['#d8453a', '#2b5aa8', '#f2c230', '#2f7a5c'])))
        for (let r = 0; r < 6; r++) for (let k = 0; k < 10; k++) if (rnd() < 0.85) out.crowd.push(at(sx - 8 - r * 1.6, -6 + k * 1.3, z + 0.05, Math.PI / 2, 1, 0.6))
        out.beams = [{ p: V(sx - 19, 0, z + 2), d: V(1, 0, 0.2), sweep: 0 }]
      } else {
        pieces.push(box(sd, sw, big ? 1.4 : 0.6, sx, 0, 0, '#2a2b2e'))   // the stage
        const top = big ? 8 : 4
        for (const yy of [-sw / 2, sw / 2]) for (const xx of [sx - sd / 2, sx + sd / 2]) pieces.push(box(0.3, 0.3, top, xx, yy, 0, '#9aa0a6'))   // truss towers
        pieces.push(box(sd + 0.4, sw + 0.4, 0.4, sx, 0, top, '#9aa0a6'), box(sd + 0.2, sw + 0.2, 0.15, sx, 0, top + 0.4, '#3d4044'))
        if (big) for (const yy of [-sw / 2 - 1.4, sw / 2 + 1.4]) pieces.push(box(1.4, 1.4, 4.2, sx - sd / 2 + 0.7, yy, 0, '#1d1e20'))   // speaker stacks
        if (big) pieces.push(box(0.2, sw * 0.6, 3.4, sx + sd / 2 - 0.3, 0, 1.8, '#111214'))
        const players = big ? 5 : 2
        for (let i = 0; i < players; i++) out.crowd.push(at(sx, -sw * 0.3 + (i / Math.max(1, players - 1)) * sw * 0.6, z + (big ? 1.4 : 0.6), Math.PI / 2))
        // the LED wall, changing colour with the music
        if (big) {
          const led = new THREE.Mesh(new THREE.PlaneGeometry(sw * 0.58, 3.2).rotateY(-Math.PI / 2).translate(sx + sd / 2 - 0.42, 0, z + 3.5), new THREE.MeshBasicMaterial({ color: '#ff3fa4', toneMapped: false }))
          out.live.push(led)
          const cols = (act.lights ?? ['#ff3fa4']).map((c) => new THREE.Color(c).multiplyScalar(1.6))
          const prev = out.step
          out.step = (t, dt, on, cr) => { prev?.(t, dt, on, cr); const i = Math.floor(t * 1.2) % cols.length; (led.material as THREE.MeshBasicMaterial).color.copy(cols[i]).lerp(cols[(i + 1) % cols.length], (t * 1.2) % 1) }
        }
        out.beams = (act.lights ?? []).flatMap((_, i) => [
          { p: V(sx - sd / 2, -sw / 2 + (i + 0.5) * (sw / Math.max(1, (act.lights ?? []).length)), z + top), d: V(-1, (rnd() - 0.5) * 0.6, 0.9), sweep: 0.8 + rnd() * 0.6 },
        ])
        if (big) out.beams.push({ p: V(sx, -sw / 2, z + top), d: V(-0.2, -0.3, 1), sweep: 1.4 }, { p: V(sx, sw / 2, z + top), d: V(-0.2, 0.3, 1), sweep: 1.1 })
        // the audience, facing the stage, and bouncing to it
        crowdAround(sx - sd / 2 - (big ? 11 : 5), 0, big ? 9 : 4, sw * 0.55, act.crowd - players, z, [sx, 0])
      }
      out.setup.push(merged(pieces))
      if (big) {
        const base = out.crowd.slice()
        const phase = base.map(() => rnd() * 6.28)
        const prev = out.step
        out.step = (t, dt, on, cr) => {
          prev?.(t, dt, on, cr)
          const body = cr?.children[0] as THREE.InstancedMesh | undefined
          const head = cr?.children[1] as THREE.InstancedMesh | undefined
          if (!body || !head || !on) return
          const m = new THREE.Matrix4()
          for (let i = 0; i < Math.min(body.count, base.length); i++) {
            m.copy(base[i])
            m.elements[14] += Math.max(0, Math.sin(t * 7.5 + phase[i])) * 0.22
            body.setMatrixAt(i, m); head.setMatrixAt(i, m)
          }
          body.instanceMatrix.needsUpdate = head.instanceMatrix.needsUpdate = true
        }
      }
      break
    }
    case 'picnic': case 'yoga': case 'leafplay': case 'snowplay': case 'games': {
      const pieces: Piece[] = []
      if (act.kit === 'picnic') {
        for (let i = 0; i < Math.round(act.crowd / 3); i++) {
          const x = (rnd() - 0.5) * W * 1.4, y = (rnd() - 0.5) * H * 1.4
          if (!f.free(...f2w(f, x, y))) continue
          const r = rnd() * Math.PI
          const g = new THREE.BoxGeometry(2, 1.6, 0.03).rotateZ(r).translate(x, y, 0.04)
          pieces.push([g, pick(['#d8453a', '#f2efe6', '#2b5aa8', '#f2c230', '#e58fa0', '#6fa85a'])])
          pieces.push(box(0.4, 0.3, 0.25, x + 0.5, y + 0.3, 0.04, '#9a7a56'))
          for (let k = 0; k < 3; k++) out.crowd.push(at(x + Math.cos(r + k * 2.1) * 0.6, y + Math.sin(r + k * 2.1) * 0.6, z + 0.05, rnd() * 6.28, 1, 0.58))
        }
      } else if (act.kit === 'yoga') {
        for (let r = 0; r < 4; r++) for (let k = 0; k < 6; k++) {
          const x = -6 + k * 2.4, y = -4 + r * 2.6
          pieces.push(box(0.7, 1.8, 0.02, x, y, 0.03, pick(['#7fb6e6', '#c46ba4', '#2fb5a0', '#f2c230'])))
          out.crowd.push(at(x, y, z + 0.05, Math.PI / 2, 1, rnd() < 0.5 ? 1 : 0.6))
        }
        pieces.push(box(1.0, 2.0, 0.02, -10, 0, 0.03, '#e0479e'))
        out.crowd.push(at(-10, 0, z + 0.05, -Math.PI / 2))
      } else if (act.kit === 'games') {
        for (let i = 0; i < 3; i++) {
          const x = -W * 0.3 + i * 4.5
          pieces.push(box(2.74, 1.52, 0.06, x, 3, 0.7, '#2b5aa8'), box(0.04, 1.6, 0.15, x, 3, 0.76, '#f4f4f0'), box(2.2, 0.3, 0.7, x, 3, 0, '#3d4044'))
          out.crowd.push(at(x - 2, 3, z, -Math.PI / 2), at(x + 2, 3, z, Math.PI / 2))
        }
        pieces.push(box(12, 3.5, 0.04, 0, -3.5, 0.02, '#d6c7a2'))
        for (let i = 0; i < 6; i++) pieces.push([new THREE.SphereGeometry(0.06, 8, 6).translate(-4 + rnd() * 8, -3.5 + (rnd() - 0.5) * 2, 0.1), '#9aa0a6'])
        crowdAround(0, -3.5, 6, 2.6, act.crowd - 6)
      } else if (act.kit === 'leafplay') {
        for (let i = 0; i < 9; i++) pieces.push([new THREE.SphereGeometry(1.1 + rnd() * 0.6, 10, 6).scale(1, 1, 0.38).translate((rnd() - 0.5) * W, (rnd() - 0.5) * H, 0), pick(['#e0782f', '#c8452e', '#e8b830', '#a85a2a'])])
        crowdAround(0, 0, W * 0.6, H * 0.6, act.crowd)
      } else {
        for (let i = 0; i < 6; i++) {
          const x = (rnd() - 0.5) * W, y = (rnd() - 0.5) * H
          pieces.push([new THREE.SphereGeometry(0.5, 10, 8).translate(x, y, 0.45), '#f7f9fa'], [new THREE.SphereGeometry(0.36, 10, 8).translate(x, y, 1.15), '#f7f9fa'],
            [new THREE.SphereGeometry(0.25, 10, 8).translate(x, y, 1.65), '#f7f9fa'], [new THREE.ConeGeometry(0.05, 0.25, 6).rotateZ(Math.PI / 2).translate(x + 0.3, y, 1.65), '#e0782f'])
        }
        pieces.push([new THREE.SphereGeometry(9, 16, 8).scale(1, 0.7, 0.22).translate(0, 0, -0.4), '#f4f6f7'])   // the sledding hill
        for (let i = 0; i < 8; i++) pieces.push(box(0.5, 1.1, 0.12, (rnd() - 0.5) * 12, (rnd() - 0.5) * 8, 0.6, pick(['#d8453a', '#2b5aa8', '#f2c230'])))
        crowdAround(0, 0, W * 0.6, H * 0.6, act.crowd)
      }
      if (pieces.length) out.live.push(merged(pieces))
      break
    }
    case 'trucks': case 'firepits': case 'lightart': case 'lanterns': {
      const pieces: Piece[] = []
      const pairs: [THREE.Vector3, THREE.Vector3][] = []
      if (act.kit === 'trucks') {
        for (let i = 0; i < 4; i++) {
          const x = -W * 0.55 + i * (W * 1.1 / 3), c = pick(['#e46a5a', '#f2c230', '#5fa3c8', '#3c8f5f'])
          pieces.push(box(4.4, 2.1, 2.3, x, -H * 0.35, 0.5, c), box(1.4, 2.1, 1.6, x + 2.8, -H * 0.35, 0.5, '#f2efe6'), box(4.0, 0.9, 0.06, x, -H * 0.35 + 1.4, 2.4, '#f2efe6'))
          for (const dx of [-1.4, 1.4, 3.0]) pieces.push(cyl(0.38, 0.38, 0.25, x + dx, -H * 0.35, 0.12, '#1d1e20', 10))
        }
        for (let i = 0; i < 14; i++) {
          const x = (rnd() - 0.5) * W * 1.2, y = H * 0.1 + rnd() * H * 0.3
          pieces.push(box(0.6, 1.4, 0.4, x, y, 0, pick(['#f2efe6', '#d8453a', '#2b5aa8'])))   // deck chairs
        }
        for (let i = 0; i < 4; i++) {
          const x = -W * 0.5 + i * (W / 3)
          const pg = poleGeo(); pg[0].translate(x, H * 0.45, 0); pieces.push(pg)
          if (i) pairs.push([V(x - W / 3, H * 0.45, 4), V(x, H * 0.45, 4)])
        }
        crowdAround(0, H * 0.15, W * 0.55, H * 0.25, act.crowd)
      } else if (act.kit === 'firepits') {
        const pits: THREE.Vector3[] = []
        for (let i = 0; i < 5; i++) {
          const x = -W * 0.55 + i * (W * 1.1 / 4), y = (i % 2 ? 1 : -1) * H * 0.15
          pits.push(V(x, y, z + 0.5))
          pieces.push(cyl(0.7, 0.8, 0.45, x, y, 0, '#2c2c2e', 14))
          for (let k = 0; k < 3; k++) { const a = k * 2.1 + rnd(); pieces.push(box(1.6, 0.4, 0.45, x + Math.cos(a) * 2.2, y + Math.sin(a) * 2.2, 0, '#7a5434')) }
          crowdAround(x, y, 2.6, 2.6, Math.round(act.crowd / 5), z, [x, y])
        }
        pieces.push(...hut(W * 0.4, H * 0.45, Math.PI, false))
        const flames = new THREE.InstancedMesh(new THREE.ConeGeometry(0.45, 1.1, 8).rotateX(Math.PI / 2).translate(0, 0, 0.55), lampMat('#ff8a2a'), pits.length)
        pits.forEach((p, i) => flames.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z - 0.1)))
        const glows = pits.map((p) => { const g = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), glowMat('#ff8a2a', 0.8)); g.position.set(p.x, p.y, z + 0.08); return g })
        out.live.push(flames, ...glows)
        const smoke = new Puffs(pits.map((p) => p.clone().setZ(p.z + 1)), 20, '#cfc8c0', 7, 1.4, 5)
        out.live.push(smoke.points)
        out.step = (t, dt) => {
          smoke.step(dt)
          pits.forEach((p, i) => flames.setMatrixAt(i, new THREE.Matrix4().compose(V(p.x, p.y, p.z - 0.1), new THREE.Quaternion(), V(1, 1, 0.8 + 0.35 * Math.abs(Math.sin(t * 9 + i * 2))))))
          flames.instanceMatrix.needsUpdate = true
        }
      } else {
        // light art: glowing pillars and lanterns along a winding path
        const cols = act.lights ?? ['#ffd27a']
        const pil: THREE.Object3D[] = []
        const n = act.kit === 'lightart' ? 7 : 14
        for (let i = 0; i < n; i++) {
          const x = -W * 0.6 + (i / (n - 1)) * W * 1.2, y = Math.sin(i * 0.9) * H * 0.3
          if (!f.free(...f2w(f, x, y))) continue
          const c = cols[i % cols.length]
          if (act.kit === 'lightart') {
            const m = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 5, 16).rotateX(Math.PI / 2).translate(x, y, z + 2.5), lampMat(c))
            const g = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), glowMat(c, 0.9)); g.position.set(x, y, z + 0.08)
            pil.push(m, g)
          } else {
            pieces.push(cyl(0.04, 0.04, 2.2, x, y, 0, '#3d4044', 6))
            const m = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 8).translate(x, y, z + 2.3), lampMat(c))
            const g = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), glowMat(c, 0.8)); g.position.set(x, y, z + 0.08)
            pil.push(m, g)
          }
        }
        out.live.push(...pil.map((o) => { o.userData.night = true; return o }))
        out.beams = cols.map((_, i) => ({ p: V(-W * 0.5 + (i / Math.max(1, cols.length - 1)) * W, H * 0.4, z), d: V(0, 0, 1), sweep: 0.5 + i * 0.2 }))
        crowdAround(0, 0, W * 0.6, H * 0.4, act.crowd)
      }
      if (pairs.length) out.live.push(stringLights(pairs))
      if (pieces.length) (SETUP_STAYS.has(act.kit) ? out.setup : out.live).push(merged(pieces))
      break
    }
    case 'xmas': {
      const pieces: Piece[] = []
      const n = 12
      const huts: [number, number, number][] = []
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2
        const x = Math.cos(a) * W * 0.55, y = Math.sin(a) * H * 0.55
        huts.push([x, y, a + Math.PI / 2])
        pieces.push(...hut(x, y, a + Math.PI / 2 + Math.PI, true))
      }
      // the huts' open hatches, lit warm
      const hatches = huts.map(([x, y, r]) => { const rr = r + Math.PI; return new THREE.Matrix4().compose(V(x + Math.sin(rr) * 1.06, y - Math.cos(rr) * 1.06, z + 1.45), new THREE.Quaternion().setFromAxisAngle(Z, rr), V(2.0, 0.06, 0.9)) })
      out.setup.push(instanced(new THREE.BoxGeometry(1, 1, 1), lampMat('#ffcf8a'), hatches, undefined, false))
      // the tree: tiers of green, a star, lights
      for (let k = 0; k < 4; k++) pieces.push([new THREE.ConeGeometry(2.6 - k * 0.55, 3.2, 12).rotateX(Math.PI / 2).translate(0, 0, 1.6 + k * 2.2), '#2f5a36'])
      pieces.push(cyl(0.3, 0.3, 1.0, 0, 0, 0, '#5a3a26'))
      out.setup.push(merged(pieces))
      const bulbs: THREE.Matrix4[] = []
      for (let i = 0; i < 90; i++) {
        const h = rnd() * 8.5, r = (2.7 - h * 0.28) * 0.92, a = rnd() * 6.28
        bulbs.push(new THREE.Matrix4().makeTranslation(Math.cos(a) * r, Math.sin(a) * r, z + 1.2 + h))
      }
      const lights = instanced(new THREE.SphereGeometry(0.12, 6, 4), lampMat('#ffd27a'), bulbs, bulbs.map(() => new THREE.Color(pick(['#ffd27a', '#ff6a5a', '#ffffff', '#7ac8ff']))), false)
      const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.6, 0).translate(0, 0, z + 10.4), lampMat('#ffe27a'))
      const pairs: [THREE.Vector3, THREE.Vector3][] = huts.map(([x, y]) => [V(0, 0, 9.5), V(x * 0.95, y * 0.95, 2.6)])
      const sl = stringLights(pairs, '#ffd9a0')
      lights.userData.night = true
      out.setup.push(lights, star, sl)
      const g = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.6, H * 1.6), glowMat('#ffb347', 0.5)); g.position.set(0, 0, z + 0.1); g.userData.night = true
      out.setup.push(g)
      crowdAround(0, 0, W * 0.45, H * 0.45, act.crowd, z, undefined)
      out.crowdClothes = ['#c8402f', '#1f2f4a', '#2a2a2e', '#f2efe6', '#3c7a4a', '#8a5a3c', '#e8b923']
      out.beams = [{ p: V(-W * 0.6, -H * 0.6, z), d: V(0.3, 0.3, 1), sweep: 0.3 }, { p: V(W * 0.6, H * 0.6, z), d: V(-0.3, -0.3, 1), sweep: 0.35 }]
      out.step = (t) => { (star.material as THREE.MeshBasicMaterial).color.setScalar(1.6 + 0.8 * Math.sin(t * 3)).multiply(new THREE.Color('#ffe27a')) }
      break
    }
    case 'rink': {
      const rx = Math.min(W * 0.75, 15), ry = Math.min(H * 0.75, 8)
      const ice = new THREE.Mesh(new THREE.CircleGeometry(1, 48).scale(rx, ry, 1).translate(0, 0, z + 0.06), new THREE.MeshStandardMaterial({ color: '#dff0fa', roughness: 0.06, metalness: 0.2, envMapIntensity: 2 }))
      ice.receiveShadow = true
      const boards: Piece[] = []
      for (let i = 0; i < 48; i++) {
        const a0 = (i / 48) * 6.283, a1 = ((i + 1) / 48) * 6.283
        const g = new THREE.BoxGeometry(1, 0.12, 1.0)
        const p0 = [Math.cos(a0) * rx, Math.sin(a0) * ry], p1 = [Math.cos(a1) * rx, Math.sin(a1) * ry]
        const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1])
        g.scale(len, 1, 1).rotateZ(Math.atan2(p1[1] - p0[1], p1[0] - p0[0])).translate((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, 0.5)
        boards.push([g, i % 6 < 3 ? '#f4f4f0' : '#2b5aa8'])
      }
      for (const [x, y] of [[-rx - 2, -ry - 2], [rx + 2, ry + 2], [-rx - 2, ry + 2], [rx + 2, -ry - 2]]) boards.push(cyl(0.12, 0.12, 9, x, y, 0, '#3d4044', 6))
      out.setup.push(ice, merged(boards))
      out.beams = [[-rx - 2, -ry - 2], [rx + 2, ry + 2], [-rx - 2, ry + 2], [rx + 2, -ry - 2]].map(([x, y]) => ({ p: V(x, y, z + 9), d: V(-x * 0.1, -y * 0.1, -1), sweep: 0 }))
      // skaters going round
      const n = act.crowd
      const ph = Array.from({ length: n }, () => [rnd() * 6.28, 0.55 + rnd() * 0.4, 0.55 + rnd() * 0.35] as const)
      for (let i = 0; i < n; i++) out.crowd.push(at(0, 0, z + 0.06, 0))
      out.step = (t, _dt, on, grp) => {
        const body = grp?.children[0] as THREE.InstancedMesh | undefined, head = grp?.children[1] as THREE.InstancedMesh | undefined
        if (!body || !head || !on) return
        const m = new THREE.Matrix4()
        for (let i = 0; i < Math.min(body.count, n); i++) {
          const [p0, sp, rr] = ph[i]
          const a = p0 + t * sp * 0.35
          const x = Math.cos(a) * rx * rr, y = Math.sin(a) * ry * rr
          const dx = -Math.sin(a) * rx, dy = Math.cos(a) * ry
          m.compose(V(x, y, z + 0.06), new THREE.Quaternion().setFromAxisAngle(Z, Math.atan2(dy, dx) - Math.PI / 2), V(1, 1, 1))
          body.setMatrixAt(i, m); head.setMatrixAt(i, m)
        }
        body.instanceMatrix.needsUpdate = head.instanceMatrix.needsUpdate = true
      }
      break
    }
    case 'sauna': case 'swim': case 'kayaks': {
      const pieces: Piece[] = []
      const deck = 0
      if (act.kit === 'sauna') {
        const sx = W * 0.3, sy = 0
        pieces.push(box(5, 3.4, 2.7, sx, sy, 0, '#5c4330'), box(5.4, 3.8, 0.25, sx, sy, 2.7, '#3a2a1e'), box(0.5, 0.5, 1.4, sx + 1.6, sy + 1, 2.9, '#2c2c2e'), box(1.2, 0.08, 1.8, sx - 1, sy - 1.72, 0.2, '#e9c98a'))
        pieces.push(box(0.8, 0.5, 0.06, sx - 3.4, sy, 0.3, '#9aa0a6'), box(0.05, 0.6, 1.4, sx - 3.9, sy, -1.2, '#c9c6bd'))   // ladder
        const steam = new Puffs([V(sx + 1.6, sy + 1, deck + 4.4), V(sx - 1, sy - 1.9, deck + 2)], 40, '#f2f2f0', 12, 0.9, 7)
        out.live.push(steam.points)
        out.step = (_t, dt) => steam.step(dt)
        const g = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), glowMat('#ffb347', 0.6)); g.position.set(sx - 1, sy - 3, deck + 0.05); g.userData.night = true
        out.live.push(g)
        // people in robes on the deck, a few in the water
        for (let i = 0; i < Math.round(act.crowd * 0.6); i++) out.crowd.push(at(sx - 3 + rnd() * 6, sy - 3.5 + rnd() * 1.5, deck, rnd() * 6.28))
        out.crowdClothes = ['#f4f4f0', '#f4f4f0', '#d9c7a4', '#7fb6e6']
      }
      if (act.kit === 'swim') {
        for (let i = 0; i < 12; i++) {
          const x = (rnd() - 0.5) * W * 1.2, y = (rnd() - 0.5) * H * 1.2
          const r = rnd() * 6.28
          pieces.push([new THREE.BoxGeometry(1.9, 0.9, 0.02).rotateZ(r).translate(x, y, 0.03), pick(['#d8453a', '#f2c230', '#5fa3c8', '#e58fa0', '#f2efe6'])])
          out.crowd.push(lying(x, y, deck, r))
          if (i % 3 === 0) pieces.push(cyl(0.03, 0.03, 2.2, x + 1, y + 1, 0, '#d0ccc2', 6), [new THREE.ConeGeometry(1.2, 0.4, 8).rotateX(Math.PI / 2).translate(x + 1, y + 1, 2.3), pick(['#f2d24b', '#e46a5a', '#f4f1e8'])])
        }
      }
      if (act.kit === 'swim' || act.kit === 'sauna' || act.kit === 'kayaks') {
        // in the water: swimmers' heads and shoulders, kayaks and paddleboards, bobbing
        const inWater: { x: number; y: number; k: number; r: number }[] = []
        for (let k = 0; k < 600 && inWater.length < (act.kit === 'swim' ? Math.round(act.crowd * 0.5) : act.kit === 'kayaks' ? 9 : 4); k++) {
          const x = (rnd() - 0.5) * (W * 2.4 + 30), y = (rnd() - 0.5) * (H * 2.4 + 30)
          if (f.water(...f2w(f, x, y))) inWater.push({ x, y, k: act.kit === 'kayaks' ? (rnd() < 0.6 ? 1 : 2) : 0, r: rnd() * 6.28 })
        }
        const heads: THREE.Matrix4[] = [], boats: THREE.Matrix4[] = [], boards: THREE.Matrix4[] = []
        for (const w of inWater) {
          if (w.k === 0) heads.push(at(w.x, w.y, zw - 0.05, w.r))
          else if (w.k === 1) { boats.push(at(w.x, w.y, zw, w.r)); out.crowd.push(at(w.x, w.y, zw - 0.55, w.r, 1, 0.75)) }
          else { boards.push(at(w.x, w.y, zw, w.r)); out.crowd.push(at(w.x, w.y, zw + 0.12, w.r)) }
        }
        if (heads.length) {
          const hg = kit([[new THREE.SphereGeometry(0.13, 8, 6).translate(0, 0, 0.2), '#e2b48f'], [new THREE.SphereGeometry(0.28, 8, 6).scale(1, 0.7, 0.4).translate(0, 0, 0), '#e2b48f'], [new THREE.TorusGeometry(0.6, 0.02, 4, 20), '#e9f1ef']])
          const hm = instanced(hg, vcMat(), heads, heads.map(() => new THREE.Color(pick(['#ffffff', '#f6dcc6', '#c68c62', '#ffe0b0']))), false)
          out.live.push(hm)
          const base = heads.map((m) => m.clone())
          const prev = out.step
          out.step = (t, dt, on, cr) => { prev?.(t, dt, on, cr); base.forEach((m, i) => { const mm = m.clone(); mm.elements[14] += Math.sin(t * 2 + i) * 0.06; hm.setMatrixAt(i, mm) }); hm.instanceMatrix.needsUpdate = true }
        }
        if (boats.length) out.live.push(instanced(kit([[new THREE.SphereGeometry(1, 12, 6).scale(1.9, 0.33, 0.18), '#e46a5a'], box(0.9, 0.5, 0.05, 0, 0, 0.15, '#2c2c2e')]), vcMat(), boats, boats.map(() => new THREE.Color(pick(['#ffffff', '#ffe27a', '#bfe3ff']))), true))
        if (boards.length) out.live.push(instanced(kit([box(3.0, 0.75, 0.12, 0, 0, 0, '#f4f4f0'), box(2.6, 0.1, 0.13, 0, 0, 0.01, '#5fa3c8')]), vcMat(), boards, undefined, true))
      }
      if (pieces.length) (act.kit === 'sauna' ? out.setup : out.live).push(merged(pieces))
      break
    }
  }
  return out
}
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
const f2w = (f: Frame, x: number, y: number): [number, number] => {
  const c = Math.cos(f.ang), s = Math.sin(f.ang)
  return [f.o[0] + x * c - y * s, f.o[1] + x * s + y * c]
}

// ------------------------------------------------------------------ the show
export interface SeasonData { floors: FloorPayload[]; amenities: Amenity[]; ctx: UrbanContext; ground: Ground; centre: XY; labels: boolean }
interface ActNode { act: Activity; zone: string; season: number; setup: THREE.Group; live: THREE.Group; crowd: THREE.Group | null; crowdN: number
  beams: { o: THREE.Object3D; base: THREE.Quaternion; sweep: number }[]; step?: KitOut['step']; label: CSS2DObject; on: number }
interface UnitNode { mesh: THREE.Mesh; name: string; building: string; area: number; poly: Ring; holes: Ring[]; z: number; prog: ReturnType<typeof unitProgram> }

export class SeasonShow {
  group = new THREE.Group()
  private acts: ActNode[] = []
  private units: UnitNode[] = []
  private bLabels = new Map<string, CSS2DObject>()
  private inside: THREE.Group | null = null
  private insideKey = ''
  private weather: { rain: THREE.LineSegments; snow: THREE.Points; leaves: THREE.Points; petals: THREE.Points; leafBed: THREE.InstancedMesh | null }
  private crowns: { im: THREE.InstancedMesh; base: THREE.Color[] }[] = []
  private bare: THREE.InstancedMesh | null = null
  private people: THREE.InstancedMesh[] = []
  private seasonMats: { mat: THREE.MeshStandardMaterial; kind: string; base: THREE.Color }[] = []
  private roofs: THREE.MeshStandardMaterial[] = []
  private halos: { im: THREE.InstancedMesh; orbs: THREE.InstancedMesh; list: { a: Amenity; m: THREE.Matrix4 }[] } | null = null
  private seating: { g: THREE.Object3D; type: string }[] = []
  private clock = { season: -1, hour: 0, night: 0, w: weatherAt(0, 12) }
  private t = 0
  private region: { c: XY; r: number }

  constructor(private d: SeasonData, ctxGroup: THREE.Object3D) {
    this.group.name = 'seasons'
    this.region = { c: d.centre, r: 320 }
    this.buildPlans()
    this.buildZones()
    this.buildAmenities()
    this.weather = this.buildWeather()
    // what the season tints: tree crowns, people, lawns and ground, roofs (found in the context group)
    ctxGroup.traverse((o) => {
      const im = o as THREE.InstancedMesh
      if (o.userData.crown && im.instanceColor) {
        const base: THREE.Color[] = []
        for (let i = 0; i < im.count; i++) { const c = new THREE.Color(); im.getColorAt(i, c); base.push(c) }
        this.crowns.push({ im, base })
      }
      if (o.userData.people && im.isInstancedMesh) { this.people.push(im); im.userData.full = im.userData.full ?? im.count }
      const mm = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined
      if (mm && !Array.isArray(mm) && mm.userData?.season) this.seasonMats.push({ mat: mm, kind: mm.userData.season, base: mm.color.clone() })
      if (o.userData.roofs && mm) this.roofs.push(mm)
    })
    this.bare = this.bareTrees()
  }
  /** Winter: the broadleaved trees bare, a few branches each (the crowns hide). */
  private bareTrees() {
    const trees = (this.d.ctx.trees ?? []).filter((t) => t.leaf !== 'needleleaved')
    if (!trees.length) return null
    seed = 515
    const parts: THREE.BufferGeometry[] = []
    const limb = (a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number) => {
      const d = b.clone().sub(a), len = d.length()
      const g = new THREE.CylinderGeometry(r1, r0, len, 5, 1, true).translate(0, len / 2, 0)
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize())).translate(a.x, a.y, a.z)
      parts.push(g.toNonIndexed())
    }
    limb(V(0, 0, 0.45), V(0, 0, 0.95), 0.016, 0.006)
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * 6.28 + rnd() * 0.5, h0 = 0.42 + rnd() * 0.3, r = 0.22 + rnd() * 0.12
      const tip = V(Math.cos(a) * r, Math.sin(a) * r, h0 + 0.25 + rnd() * 0.2)
      limb(V(0, 0, h0), tip, 0.009, 0.003)
      for (let k = 0; k < 2; k++) limb(tip.clone().multiplyScalar(0.7).setZ(tip.z - 0.05), tip.clone().add(V((rnd() - 0.5) * 0.18, (rnd() - 0.5) * 0.18, 0.1 + rnd() * 0.1)), 0.004, 0.002)
    }
    const geo = mergeGeometriesSafe(parts)
    const mats = trees.map((t) => new THREE.Matrix4().compose(V(t.p[0], t.p[1], 0), new THREE.Quaternion().setFromAxisAngle(Z, rnd() * 6.28), V(Math.max(3, t.h), Math.max(3, t.h), Math.max(3, t.h))))
    const im = instanced(geo, new THREE.MeshStandardMaterial({ color: '#5a4c42', roughness: 1 }), mats, undefined, true)
    im.visible = false
    this.group.add(im)
    return im
  }

  // ---------------------------------------------------------------- ground floors, cut open
  private buildPlans() {
    const g = new THREE.Group()
    g.name = 'plans'
    const wallMat = new THREE.MeshStandardMaterial({ color: '#f4f1ea', roughness: 0.8 })
    for (const fp of this.d.floors) {
      const z = fp.z
      const slab = flat(fp.rings, z + 0.03)
      if (slab) { const m = new THREE.Mesh(slab, new THREE.MeshStandardMaterial({ color: '#e6e1d6', roughness: 0.9 })); m.receiveShadow = true; g.add(m) }
      for (const u of fp.units) {
        const geo = flat([u.poly, ...u.holes], z + 0.07)
        if (!geo) continue
        const prog = unitProgram(u.name, fp.building, 0, 12)
        const mat = new THREE.MeshStandardMaterial({ color: prog ? KINDS[prog.kind].colour : '#d9d5cc', roughness: 0.85, emissive: '#000000' })
        const mesh = new THREE.Mesh(geo, mat)
        mesh.receiveShadow = true
        g.add(mesh)
        this.units.push({ mesh, name: u.name, building: fp.building, area: u.area, poly: u.poly, holes: u.holes, z, prog: null })
      }
      // walls cut at 1.3 m, the plan read from above
      const ws = fp.walls.filter((w) => Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) > 0.05)
      if (ws.length) {
        const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), wallMat, ws.length)
        ws.forEach((w, i) => im.setMatrixAt(i, segmentBox(w.a[0], w.a[1], w.b[0], w.b[1], z + 0.05, z + 1.3, Math.max(0.1, w.t), new THREE.Matrix4())))
        im.instanceMatrix.needsUpdate = true
        im.castShadow = im.receiveShadow = true
        g.add(im)
      }
      // the rest of the building as a ghost: its outline to the roof, faint faces
      const top = Math.max(fp.z + fp.height, (fp as FloorPayload & { top?: number }).top ?? 0)
      const env = prism(fp.rings.slice(0, 1), z, Math.max(top, z + 4))
      if (env) {
        const lines = new THREE.LineSegments(new THREE.EdgesGeometry(env, 25), new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55 }))
        lines.userData.envelope = fp.building
        g.add(lines)
        env.dispose()
      }
      // the building's headline: what's on in it now
      const el = document.createElement('div')
      el.className = 'studio-label layer season-b'
      const lab = new CSS2DObject(el)
      const c = centroid(fp.rings[0])
      lab.position.set(c[0], c[1], z + 7)
      g.add(lab)
      this.bLabels.set(fp.building, lab)
    }
    this.group.add(g)
  }
  /** Envelope heights come from the viewer's building payloads (set after construction). */
  setEnvelopes(heights: Record<string, number>) {
    this.group.traverse((o) => {
      const id = o.userData.envelope as string | undefined
      if (!id || !heights[id]) return
      const ls = o as THREE.LineSegments
      const fp = this.d.floors.find((f) => f.building === id)!
      const env = prism(fp.rings.slice(0, 1), fp.z, heights[id])
      if (!env) return
      ls.geometry.dispose()
      ls.geometry = new THREE.EdgesGeometry(env, 25)
      env.dispose()
    })
  }

  // ---------------------------------------------------------------- outdoor places
  private frame(p: XY): Frame {
    const ctx = this.d.ctx
    const cands = [...(ctx.greens ?? []), ...(ctx.piers ?? []), ...(ctx.paths ?? []), ...(ctx.plazas ?? [])]
    let ring: Ring | null = null, zDeck = 0.06
    for (const c of cands) for (const rs of c.rings) if (rs[0] && inside(rs[0], p[0], p[1])) { if (!ring || area(rs[0]) > area(ring)) { ring = rs[0]; zDeck = (ctx.piers ?? []).includes(c as never) ? 0.42 : 0.06 } }
    let ang = 0, ex = 14, ey = 10
    if (ring) {
      const pts = ring
      const mx = pts.reduce((a, q) => a + q[0], 0) / pts.length, my = pts.reduce((a, q) => a + q[1], 0) / pts.length
      let sxx = 0, syy = 0, sxy = 0
      for (const [x, y] of pts) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my) }
      ang = 0.5 * Math.atan2(2 * sxy, sxx - syy)
      const c = Math.cos(ang), s = Math.sin(ang)
      ex = 0; ey = 0
      for (const [x, y] of pts) { const u = (x - p[0]) * c + (y - p[1]) * s, v = -(x - p[0]) * s + (y - p[1]) * c; ex = Math.max(ex, Math.abs(u)); ey = Math.max(ey, Math.abs(v)) }
      ex = Math.max(6, Math.min(ex * 0.8, 28)); ey = Math.max(4, Math.min(ey * 0.8, 20))
    }
    return { o: p, ang, ex, ey, z: zDeck, free: this.d.ground.free, water: this.d.ground.onWater }
  }
  private buildZones() {
    SEASONS.forEach((s, si) => {
      for (const act of PROGRAMME[s.id]) {
        const zone = ZONES.find((z) => z.id === act.zone)!
        const f = this.frame(zone.p)
        const k = buildKit(`${s.id}:${act.zone}:${act.kit}:${act.from}`, act, f)
        const setup = new THREE.Group(), live = new THREE.Group()
        for (const g of [setup, live]) { g.position.set(f.o[0], f.o[1], f.z > 0.2 ? f.z : 0); g.rotation.z = f.ang; g.visible = false; this.group.add(g) }
        k.setup.forEach((o) => setup.add(o))
        k.live.forEach((o) => live.add(o))
        let crowd: THREE.Group | null = null
        if (k.crowd.length) { const fg = figures(k.crowd, k.crowdClothes); crowd = fg.group; crowd.userData.crowd = true; live.add(crowd) }
        const beams = (k.beams ?? []).map((b) => {
          const piv = new THREE.Object3D()
          piv.position.copy(b.p)
          const bm = beam((act.lights ?? ['#ffffff'])[Math.floor(rnd() * (act.lights?.length ?? 1))], act.kit === 'rink' ? 14 : act.kit === 'cinema' ? 22 : 70, act.kit === 'rink' ? 0.5 : 0.09, act.kit === 'rink' ? 0.18 : 0.3)
          piv.add(bm)
          piv.quaternion.setFromUnitVectors(Z, b.d.clone().normalize())
          piv.userData.night = true
          live.add(piv)
          return { o: piv, base: piv.quaternion.clone(), sweep: b.sweep }
        })
        const el = document.createElement('div')
        el.className = 'studio-label layer season-z'
        el.innerHTML = `<i style="background:${KINDS[act.kind].colour}"></i>${act.name}`
        const label = new CSS2DObject(el)
        label.position.set(f.o[0], f.o[1], (act.kit === 'concert' ? 14 : act.kit === 'xmas' ? 13 : 7) + f.z)
        label.visible = false
        this.group.add(label)
        this.acts.push({ act, zone: act.zone, season: si, setup, live, crowd, crowdN: k.crowd.length, beams, step: k.step, label, on: 0 })
      }
    })
  }

  // ---------------------------------------------------------------- cafés and restaurants round about
  private buildAmenities() {
    const near = this.d.amenities.filter((a) => ['restaurant', 'cafe', 'bar', 'fast_food', 'venue', 'hotel', 'spa', 'supermarket'].includes(a.type)
      && Math.hypot(a.x - this.region.c[0], a.y - this.region.c[1]) < 560)
    if (!near.length) return
    const list = near.map((a) => ({ a, m: new THREE.Matrix4().makeTranslation(a.x, a.y, 0.12) }))
    const halo = new THREE.InstancedMesh(new THREE.PlaneGeometry(14, 14), glowMat('#ffffff', 0.85), list.length)
    const orbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 10, 8).translate(0, 0, 4.5), lampMat('#ffffff'), list.length)
    list.forEach((it, i) => {
      const c = new THREE.Color(it.a.type === 'bar' ? '#b48cff' : it.a.type === 'cafe' ? '#ffcf8a' : it.a.type === 'restaurant' ? '#ffb07a' : it.a.type === 'venue' ? '#ff7ac8' : '#ffe9b0')
      halo.setColorAt(i, c); orbs.setColorAt(i, c)
      halo.setMatrixAt(i, it.m); orbs.setMatrixAt(i, it.m)
    })
    halo.frustumCulled = orbs.frustumCulled = false
    this.group.add(halo, orbs)
    this.halos = { im: halo, orbs, list }
    // outdoor tables by the cafés and restaurants, out in spring and summer
    seed = 909
    for (const it of list) {
      if (!['restaurant', 'cafe', 'bar', 'fast_food'].includes(it.a.type)) continue
      let spot: XY | null = null
      for (let k = 0; k < 24 && !spot; k++) {
        const ang = rnd() * 6.28, r = 3 + rnd() * 9
        const x = it.a.x + Math.cos(ang) * r, y = it.a.y + Math.sin(ang) * r
        if (this.d.ground.free(x, y)) spot = [x, y]
      }
      if (!spot) continue
      const pieces: Piece[] = [], crowd: THREE.Matrix4[] = []
      const tone = pick(['#f2d24b', '#f4f1e8', '#e46a5a', '#2f6e5a'])
      for (let k = 0; k < 3; k++) {
        const x = spot[0] + (k - 1) * 2.6, y = spot[1] + (rnd() - 0.5)
        pieces.push(cyl(0.35, 0.35, 0.04, x, y, 0.72, '#e9e5da', 10), cyl(0.04, 0.04, 0.72, x, y, 0, '#3d4044', 6), cyl(0.03, 0.03, 2.3, x, y, 0, '#d8d4c8', 6),
          [new THREE.ConeGeometry(1.3, 0.45, 8).rotateX(Math.PI / 2).translate(x, y, 2.35), tone])
        for (let p = 0; p < 2 + Math.floor(rnd() * 2); p++) crowd.push(at(x + Math.cos(p * 2.3) * 0.7, y + Math.sin(p * 2.3) * 0.7, 0.06, p * 2.3 + Math.PI / 2, 1, 0.68))
      }
      const g = new THREE.Group()
      g.add(merged(pieces), figures(crowd).group)
      g.visible = false
      this.group.add(g)
      this.seating.push({ g, type: it.a.type })
    }
  }

  // ---------------------------------------------------------------- weather
  private buildWeather() {
    const { c, r } = this.region
    const pts = (n: number, colour: THREE.Color[] | string, size: number) => {
      const pos = new Float32Array(n * 3), col = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) {
        pos[i * 3] = c[0] + (rnd() * 2 - 1) * r; pos[i * 3 + 1] = c[1] + (rnd() * 2 - 1) * r; pos[i * 3 + 2] = rnd() * 60
        const cc = typeof colour === 'string' ? new THREE.Color(colour) : pick(colour)
        col[i * 3] = cc.r; col[i * 3 + 1] = cc.g; col[i * 3 + 2] = cc.b
      }
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      g.setAttribute('color', new THREE.BufferAttribute(col, 3))
      const p = new THREE.Points(g, new THREE.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, map: radial() }))
      p.frustumCulled = false
      p.visible = false
      this.group.add(p)
      return p
    }
    const snow = pts(9000, '#ffffff', 3.2)
    const leaves = pts(3500, ['#e0782f', '#e8b830', '#c8452e', '#a85a2a'].map((h) => new THREE.Color(h)), 4.2)
    const petals = pts(2600, ['#f6c7d6', '#fbe3ea', '#ffffff'].map((h) => new THREE.Color(h)), 3.6)
    // rain: short streaks
    const n = 7000
    const rp = new Float32Array(n * 6)
    for (let i = 0; i < n; i++) {
      const x = c[0] + (rnd() * 2 - 1) * r, y = c[1] + (rnd() * 2 - 1) * r, z = rnd() * 70
      rp.set([x, y, z, x + 0.25, y + 0.1, z + 2.2], i * 6)
    }
    const rg = new THREE.BufferGeometry()
    rg.setAttribute('position', new THREE.BufferAttribute(rp, 3))
    const rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: '#cfdcea', transparent: true, opacity: 0.55, depthWrite: false }))
    rain.frustumCulled = false
    rain.visible = false
    this.group.add(rain)
    // a carpet of fallen leaves under the trees (autumn)
    let leafBed: THREE.InstancedMesh | null = null
    const trees = (this.d.ctx.trees ?? []).filter((t) => Math.hypot(t.p[0] - c[0], t.p[1] - c[1]) < r + 80)
    if (trees.length) {
      const mats: THREE.Matrix4[] = [], cols: THREE.Color[] = []
      for (const t of trees) for (let k = 0; k < 14; k++) {
        const a = rnd() * 6.28, d = Math.sqrt(rnd()) * t.h * 0.45
        mats.push(new THREE.Matrix4().compose(V(t.p[0] + Math.cos(a) * d, t.p[1] + Math.sin(a) * d, 0.09), new THREE.Quaternion().setFromAxisAngle(Z, rnd() * 6.28), V(1, 1, 1)))
        cols.push(new THREE.Color(pick(['#e0782f', '#e8b830', '#c8452e', '#a85a2a'])))
      }
      leafBed = instanced(new THREE.PlaneGeometry(0.5, 0.35), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, side: THREE.DoubleSide }), mats, cols, false)
      leafBed.visible = false
      this.group.add(leafBed)
    }
    return { rain, snow, leaves, petals, leafBed }
  }

  // ---------------------------------------------------------------- the clock
  setClock(season: number, hour: number, labels: boolean) {
    const night = nightOf(season, hour)
    const w = weatherAt(season, hour)
    const sChanged = season !== this.clock.season
    this.clock = { season, hour, night, w }
    // activities
    for (const n of this.acts) {
      const inSeason = n.season === season
      const on = inSeason && onAt(n.act, hour) ? 1 : 0
      n.on = on
      n.setup.visible = inSeason && (SETUP_STAYS.has(n.act.kit) || on > 0)
      n.live.visible = on > 0
      n.label.visible = labels && on > 0
      n.live.traverse((o) => { if (o.userData.night) o.visible = night > 0.35 })
      n.setup.traverse((o) => { if (o.userData.night) o.visible = night > 0.35 || n.act.kit === 'xmas' })
      if (n.crowd) {
        const h = hour < 5 ? hour + 24 : hour
        const ramp = Math.min(1, (h - n.act.from) / 0.75, (n.act.to - h) / 0.5)
        const cnt = Math.round(n.crowdN * Math.max(0.15, Math.min(1, ramp)) * (w.rain ? 0.6 : 1))
        for (const c of n.crowd.children) (c as THREE.InstancedMesh).count = cnt
      }
    }
    // ground floors
    const now = new Map<string, { label: string; kind: Kind; area: number }[]>()
    for (const u of this.units) {
      const p = unitProgram(u.name, u.building, season, hour)
      u.prog = p
      const mat = u.mesh.material as THREE.MeshStandardMaterial
      if (!p) { mat.color.set('#d9d5cc'); mat.emissive.set('#000000'); continue }
      const col = new THREE.Color(KINDS[p.kind].colour)
      // a light tint by day, glowing in its colour after dark; closed spaces go dark
      mat.color.copy(p.open ? col.clone().lerp(new THREE.Color('#f4f1ea'), 0.5 - night * 0.3) : new THREE.Color('#6d7178'))
      mat.emissive.copy(p.open ? col : new THREE.Color('#000000'))
      mat.emissiveIntensity = p.open ? night * 0.85 : 0
      if (p.open) now.set(u.building, [...(now.get(u.building) ?? []), { label: p.label, kind: p.kind, area: u.area }])
    }
    const order: Kind[] = ['party', 'culture', 'craft', 'well', 'food', 'shop', 'home', 'work']
    for (const [b, lab] of this.bLabels) {
      const list = (now.get(b) ?? []).sort((x, y) => order.indexOf(x.kind) - order.indexOf(y.kind) || y.area - x.area)
      const top = list[0]
      const el = lab.element
      lab.visible = labels && !!top && !/closed/i.test(top.label)   // closed buildings get no label
      const html = top ? `<i style="background:${KINDS[top.kind].colour}"></i><b>${b}</b> ${top.label}` : ''
      if (el.innerHTML !== html) el.innerHTML = html
    }
    // people inside the open units (rebuilt only when what's open changes)
    const key = this.units.filter((u) => u.prog?.open).map((u) => u.building + u.name + u.prog!.kind).join('|') + (night > 0.5 ? 'n' : 'd')
    if (key !== this.insideKey) {
      this.insideKey = key
      if (this.inside) { this.group.remove(this.inside); this.inside.traverse((o) => (o as THREE.Mesh).geometry !== figGeo?.body && (o as THREE.Mesh).geometry !== figGeo?.head && (o as THREE.Mesh).geometry?.dispose()) }
      seed = 4040
      const mats: THREE.Matrix4[] = []
      for (const u of this.units) {
        if (!u.prog?.open) continue
        const per = u.prog.kind === 'party' ? 10 : u.prog.kind === 'food' || u.prog.kind === 'culture' || u.prog.kind === 'craft' ? 16 : u.prog.kind === 'well' ? 20 : 45
        const n = Math.min(60, Math.round(u.area / per))
        let got = 0
        const xs = u.poly.map((q) => q[0]), ys = u.poly.map((q) => q[1])
        const bb = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
        for (let k = 0; k < n * 6 && got < n; k++) {
          const x = bb[0] + rnd() * (bb[2] - bb[0]), y = bb[1] + rnd() * (bb[3] - bb[1])
          if (!inside(u.poly, x, y) || u.holes.some((h) => inside(h, x, y))) continue
          mats.push(at(x, y, u.z + 0.08, rnd() * 6.28, 1, u.prog.kind === 'food' || u.prog.kind === 'craft' || u.prog.kind === 'culture' ? (rnd() < 0.6 ? 0.68 : 1) : 1))
          got++
        }
      }
      this.inside = figures(mats).group
      this.group.add(this.inside)
    }
    // cafés round about: glow when open in the dark, tables out in the warm seasons
    if (this.halos) {
      const { im, orbs, list } = this.halos
      const hide = new THREE.Matrix4().makeScale(0, 0, 0)
      list.forEach((it, i) => {
        const open = amenityOpen(it.a.type, hour)
        const m = open && night > 0.25 ? it.m : hide
        im.setMatrixAt(i, m); orbs.setMatrixAt(i, m)
      })
      im.instanceMatrix.needsUpdate = orbs.instanceMatrix.needsUpdate = true
    }
    const warm = SEASONS[season].id === 'summer' || SEASONS[season].id === 'spring'
    for (const s of this.seating) s.g.visible = warm && amenityOpen(s.type, hour) && !w.rain && hour % 24 < 23
    // street life
    const life = streetLife(season, hour)
    for (const im of this.people) im.count = Math.round((im.userData.full as number) * life)
    // weather
    const W = this.weather
    W.rain.visible = w.rain > 0
    W.snow.visible = w.snow > 0
    W.leaves.visible = w.leaves > 0
    W.petals.visible = w.petals > 0
    if (W.leafBed) W.leafBed.visible = SEASONS[season].id === 'autumn'
    if (sChanged || season === 3) this.tint(season, w.cover)
  }
  private tint(season: number, cover: number) {
    const id = SEASONS[season].id
    const c = new THREE.Color()
    const AUT = ['#e0782f', '#e8b830', '#c8452e', '#d9962f', '#8a9a3c'].map((h) => new THREE.Color(h))
    const snowC = new THREE.Color('#f3f6f8')
    for (const { im, base } of this.crowns) {
      for (let i = 0; i < base.length; i++) {
        const h = (i * 2654435761) % 1000 / 1000
        if (id === 'summer') c.copy(base[i])
        else if (id === 'spring') c.copy(base[i]).lerp(h < 0.22 ? new THREE.Color('#f4b6c8') : new THREE.Color('#a8d86a'), h < 0.22 ? 0.85 : 0.55)
        else if (id === 'autumn') c.copy(AUT[Math.floor(h * AUT.length)]).lerp(base[i], 0.15)
        else c.set('#6e6052').lerp(snowC, cover * 0.55)
        im.setColorAt(i, c)
      }
      im.instanceColor!.needsUpdate = true
      im.visible = id !== 'winter'
    }
    if (this.bare) this.bare.visible = id === 'winter'
    for (const s of this.seasonMats) {
      if (s.kind === 'green') {
        const tgt = id === 'spring' ? new THREE.Color('#9cc46a') : id === 'summer' ? s.base : id === 'autumn' ? new THREE.Color('#a39a5a') : new THREE.Color('#8f9a7c')
        s.mat.color.copy(id === 'summer' ? s.base : tgt).lerp(snowC, id === 'winter' ? cover * 0.92 : 0)
      } else s.mat.color.copy(s.base).lerp(snowC, id === 'winter' ? cover * 0.85 : 0)
      s.mat.emissive.set(id === 'winter' ? '#ffffff' : '#000000')
      s.mat.emissiveIntensity = id === 'winter' ? cover * 0.12 : 0
    }
    for (const r of this.roofs) { r.emissive.set('#ffffff'); r.emissiveIntensity = id === 'winter' ? cover * 0.55 : 0 }
  }

  /** Animation: falling things, beams sweeping, crowds bouncing, smoke and steam. */
  step(dt: number) {
    this.t += dt
    const t = this.t
    const { c, r } = this.region
    const fall = (p: THREE.Points, speed: number, sway: number) => {
      if (!p.visible) return
      const a = (p.geometry.getAttribute('position') as THREE.BufferAttribute)
      const arr = a.array as Float32Array
      for (let i = 0; i < arr.length; i += 3) {
        arr[i + 2] -= speed * dt * (0.7 + ((i * 7) % 10) / 15)
        arr[i] += Math.sin(t * 1.3 + i) * sway * dt
        arr[i + 1] += Math.cos(t * 1.1 + i * 0.7) * sway * dt
        if (arr[i + 2] < 0.1) { arr[i + 2] = 40 + ((i * 13) % 30); arr[i] = c[0] + (((i * 7919) % 2000) / 1000 - 1) * r; arr[i + 1] = c[1] + (((i * 104729) % 2000) / 1000 - 1) * r }
      }
      a.needsUpdate = true
    }
    fall(this.weather.snow, 1.6, 0.8)
    fall(this.weather.leaves, 1.4, 1.6)
    fall(this.weather.petals, 1.0, 1.4)
    if (this.weather.rain.visible) {
      const a = this.weather.rain.geometry.getAttribute('position') as THREE.BufferAttribute
      const arr = a.array as Float32Array
      for (let i = 0; i < arr.length; i += 6) {
        arr[i + 2] -= 28 * dt; arr[i + 5] -= 28 * dt
        if (arr[i + 2] < 0) { arr[i + 2] += 70; arr[i + 5] += 70 }
      }
      a.needsUpdate = true
    }
    for (const n of this.acts) {
      if (!n.setup.visible && !n.live.visible) continue
      n.step?.(t, dt, n.on, n.crowd)
      if (n.live.visible) for (const b of n.beams) {
        if (!b.sweep) continue
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(t * b.sweep) * 0.45, Math.cos(t * b.sweep * 0.8) * 0.35, 0))
        b.o.quaternion.copy(b.base).multiply(q)
      }
    }
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.geometry && m.geometry !== figGeo?.body && m.geometry !== figGeo?.head) m.geometry.dispose()
      const mat = m.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
      else mat?.dispose()
      if (o instanceof CSS2DObject) o.element.remove()
    })
    // put the context back as it was
    for (const { im, base } of this.crowns) { base.forEach((b, i) => im.setColorAt(i, b)); im.instanceColor!.needsUpdate = true; im.visible = true }
    for (const im of this.people) im.count = im.userData.full as number
    for (const s of this.seasonMats) { s.mat.color.copy(s.base); s.mat.emissive.set('#000000'); s.mat.emissiveIntensity = 0 }
    for (const r of this.roofs) r.emissiveIntensity = 0
    this.group.parent?.remove(this.group)
  }
}

function amenityOpen(type: string, hour: number) {
  const h = hour % 24
  const w = (a: number, b: number) => (a <= b ? h >= a && h < b : h >= a || h < b)
  return type === 'cafe' ? w(7, 18) : type === 'restaurant' ? w(11, 23) : type === 'bar' ? w(16, 2) : type === 'fast_food' ? w(10, 23)
    : type === 'venue' ? w(18, 1) : type === 'spa' ? w(9, 21) : type === 'supermarket' ? w(7, 22) : true
}
function inside(r: Ring, x: number, y: number) {
  let c = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}
const area = (r: Ring) => Math.abs(r.reduce((s, [x, y], i) => { const [u, v] = r[(i + 1) % r.length]; return s + x * v - u * y }, 0)) / 2
const centroid = (r: Ring): XY => [r.reduce((a, q) => a + q[0], 0) / r.length, r.reduce((a, q) => a + q[1], 0) / r.length]
