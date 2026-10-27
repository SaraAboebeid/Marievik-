import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { Sky } from 'three/examples/jsm/objects/Sky.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import { inkOn } from '../lifeIcons'
import { Rhino3dmLoader } from 'three/examples/jsm/loaders/3DMLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { BuildingPayload, FloorPayload, Ring, SitePayload, Unit, UrbanContext } from '../types'
import { UNIT_BOX, detailGeometry, disposeTree, flat, localBox, prism, segmentBox } from './geometry'
import { buildBarriers, buildFurniture, buildMassing, buildRoadPaint } from './context3d'
import { dfColor, unitColor } from './colors'
import { ATRIUM, CELL, CORES, ESCAPE_LIMIT, FRAME, H, NX, NY, TYPES, W, WALL_H, cellXY, subtract } from '../studio/engine'
import type { Rect, StudioModel } from '../studio/engine'
import type { Walker } from '../studio/crowd'
import type { Suite } from '../studio/tenancy'

export type StudioView = 'furniture' | 'capacity' | 'tenancy' | 'use' | 'fire' | 'move'
// furniture in the floor studio: colour and height (m) per kind
const STUDIO_FURN: Record<string, [string, number]> = {
  desk: ['#f4f1e6', 0.74], chair: ['#0528ca', 0.5], stool: ['#0528ca', 0.65], lchair: ['#f4a7dd', 0.7], sofa: ['#f4a7dd', 0.75],
  mtable: ['#f4f1e6', 0.74], ctable: ['#f4f1e6', 0.74], dtable: ['#f4f1e6', 0.74], htable: ['#f4f1e6', 1.05], coffee: ['#d9cfb4', 0.42],
  counter: ['#b9ab88', 1.1], cubicle: ['#e3eaee', 2.1], acc: ['#cfe0f2', 2.1], basin: ['#ffffff', 0.85], rack: ['#3b3a36', 2.0],
  shelf: ['#cfc6ad', 1.9], kitchen: ['#b9bfc4', 0.9], fridge: ['#b9bfc4', 1.9], bed: ['#ffffff', 0.6], locker: ['#cfc6ad', 1.9],
  planter: ['#6fae5a', 1.4], stage: ['#d9cfb4', 0.45], bench: ['#b88c55', 0.45], ahu: ['#b4b1a8', 2.2], pallet: ['#c9ac78', 1.2],
}
/** Distance colours: green near an exit, yellow, coral, red at the 45 m limit. */
function rampColor(t: number): [number, number, number] {
  const stops: [number, [number, number, number]][] = [[0, [3, 176, 95]], [0.55, [245, 214, 107]], [0.85, [253, 135, 110]], [1, [180, 50, 31]]]
  t = Math.max(0, Math.min(1, t))
  for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) {
    const [a0, a] = stops[i - 1], [b0, b] = stops[i], f = (t - a0) / (b0 - a0)
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
  }
  return stops[3][1]
}
const P = (x: number, y: number): [number, number] => [FRAME.origin[0] + x * FRAME.x[0] - y * FRAME.x[1], FRAME.origin[1] + x * FRAME.x[1] + y * FRAME.x[0]]
const rectRing = (r: Rect): Ring => [P(r[0], r[1]), P(r[2], r[1]), P(r[2], r[3]), P(r[0], r[3])]
const studioBox = (x0: number, y0: number, x1: number, y1: number, z0: number, z1: number) => localBox(FRAME.origin, FRAME.x, x0, x1, y0, y1, z0, z1)

export type Pick =
  | { type: 'building'; building: string; floor: number }
  | { type: 'unit'; building: string; floor: number; unit: string }
  | null

export interface ViewOptions {
  sky: boolean
  shadows: boolean
  ao: boolean
  explode: number
  labels: boolean
  context?: boolean
}

type Focus =
  | { kind: 'site' }
  | { kind: 'building'; building: string }
  | { kind: 'floor'; building: string; floor: number }
  | { kind: 'unit'; building: string; floor: number; unit: string }

export const SELECTION_COLOR = '#1e3434'   // deep pine: the accent, reserved for selection and primary actions

const WALL_COLORS: Record<string, string> = {
  E: '#d9d4ca', C: '#efece6', S: '#cfe0ea', K: '#b9b5ad', P: '#f4f2ee', I: '#f4f2ee', A: '#e8c27a',
}

interface BuildingView {
  group: THREE.Group
  floors: THREE.Group[]
  mats: THREE.Material[]
  payload: BuildingPayload
  detail: (THREE.Group | null)[] | null   // exploded view: every floor's real plan, one group per floor index
}

export class Viewer {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  readonly controls: OrbitControls
  private labelRenderer: CSS2DRenderer
  private composer: EffectComposer
  private aoPass: GTAOPass
  private sky = new Sky()
  private skyScene = new THREE.Scene()
  private skyEnvSky = new Sky()
  private pmrem: THREE.PMREMGenerator
  private envRT: THREE.WebGLRenderTarget | null = null
  private sunLight = new THREE.DirectionalLight(0xffffff, 3)
  private hemi = new THREE.HemisphereLight(0xdfe8f2, 0x8a8478, 0.6)
  private world = new THREE.Group()          // plan coordinates, z up
  private contextGroup = new THREE.Group()
  private buildingsGroup = new THREE.Group()
  private floorGroup = new THREE.Group()
  private analysisGroup = new THREE.Group()
  private labelGroup = new THREE.Group()
  private rhinoGroup = new THREE.Group()
  private lifeGroup = new THREE.Group()      // Urban scale: events, activities and amenities pinned on the site
  private lifeSeen = new Set<string>()      // pins shown last time, so only newcomers animate in
  private buildings = new Map<string, BuildingView>()
  private site: SitePayload | null = null
  private center = new THREE.Vector2()
  private focus: Focus = { kind: 'site' }
  private floor: FloorPayload | null = null
  private unitMeshes = new Map<string, THREE.Mesh>()
  private options: ViewOptions = { sky: true, shadows: true, ao: true, explode: 0, labels: true }
  private raf = 0
  private dirty = 2                           // frames left to draw; the view renders on demand
  private needsEnv = true
  private anim: { t0: number; dur: number; p0: THREE.Vector3; p1: THREE.Vector3; c0: THREE.Vector3; c1: THREE.Vector3 } | null = null
  private ray = new THREE.Raycaster()
  private pointer = new THREE.Vector2()
  private downAt = { x: 0, y: 0 }
  onPick: (p: Pick) => void = () => {}
  onHover: (p: Pick, x: number, y: number) => void = () => {}

  constructor(private container: HTMLElement) {
    const w = container.clientWidth
    const h = container.clientHeight
    // logarithmicDepthBuffer: the camera's near:far ratio (0.5 / 20000 = 40 000:1) badly starves a linear depth
    // buffer at distance, so thinly z-stacked context layers (water -0.02, ground -0.05, roads 0.04, …) z-fight
    // and visibly swap which one is "in front" once the camera is more than a couple hundred units out.
    this.renderer = new THREE.WebGLRenderer({
      antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true, logarithmicDepthBuffer: true,
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(w, h)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.55
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    container.appendChild(this.renderer.domElement)

    this.labelRenderer = new CSS2DRenderer()
    this.labelRenderer.setSize(w, h)
    Object.assign(this.labelRenderer.domElement.style, { position: 'absolute', top: '0', left: '0', pointerEvents: 'none', zIndex: '0' })
    container.appendChild(this.labelRenderer.domElement)

    this.camera = new THREE.PerspectiveCamera(38, w / h, 0.5, 20000)
    this.camera.position.set(-260, 210, 260)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.maxPolarAngle = Math.PI * 0.495
    this.controls.minDistance = 4
    this.controls.maxDistance = 3000
    this.controls.screenSpacePanning = true
    this.controls.addEventListener('change', () => this.invalidate())

    // sky, sun and image-based light from the same sky
    this.sky.scale.setScalar(15000)
    this.skyEnvSky.scale.setScalar(15000)
    for (const s of [this.sky, this.skyEnvSky]) {
      const u = s.material.uniforms
      u.turbidity.value = 3.2
      u.rayleigh.value = 1.4
      u.mieCoefficient.value = 0.004
      u.mieDirectionalG.value = 0.82
    }
    this.scene.add(this.sky)
    this.skyScene.add(this.skyEnvSky)
    this.pmrem = new THREE.PMREMGenerator(this.renderer)

    this.sunLight.castShadow = true
    this.sunLight.shadow.mapSize.set(4096, 4096)
    this.sunLight.shadow.bias = -0.0004
    this.sunLight.shadow.normalBias = 0.6
    const sc = this.sunLight.shadow.camera
    sc.left = -320; sc.right = 320; sc.top = 320; sc.bottom = -320; sc.near = 10; sc.far = 2000
    this.scene.add(this.sunLight, this.sunLight.target, this.hemi)

    this.world.rotation.x = -Math.PI / 2
    this.world.add(this.contextGroup, this.buildingsGroup, this.floorGroup, this.analysisGroup, this.labelGroup, this.rhinoGroup, this.lifeGroup)
    this.scene.add(this.world)

    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.aoPass = new GTAOPass(this.scene, this.camera, w, h)
    this.aoPass.blendIntensity = 0.85
    this.aoPass.updateGtaoMaterial({ radius: 2.5, distanceExponent: 1.4, thickness: 2.0, scale: 1.0 })
    this.composer.addPass(this.aoPass)
    this.composer.addPass(new OutputPass())

    const el = this.renderer.domElement
    el.addEventListener('pointerdown', (e) => { this.downAt = { x: e.clientX, y: e.clientY } })
    el.addEventListener('pointerup', (e) => {
      if (Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) < 5 && e.button === 0) this.onPick(this.pick(e))
    })
    el.addEventListener('pointermove', (e) => this.onHover(this.pick(e), e.clientX, e.clientY))
    el.addEventListener('pointerleave', () => this.onHover(null, 0, 0))
    window.addEventListener('resize', this.resize)
    this.setSun(30, 200)
    this.loop()
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    window.removeEventListener('resize', this.resize)
    this.renderer.dispose()
    this.container.innerHTML = ''
  }

  private resize = () => {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
    this.labelRenderer.setSize(w, h)
    this.composer.setSize(w, h)
    this.invalidate()
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop)
    if (this.anim) {
      const k = Math.min(1, (performance.now() - this.anim.t0) / this.anim.dur)
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2
      this.camera.position.lerpVectors(this.anim.p0, this.anim.p1, e)
      this.controls.target.lerpVectors(this.anim.c0, this.anim.c1, e)
      if (k >= 1) this.anim = null
    }
    if (this.controls.update()) this.dirty = Math.max(this.dirty, 2)
    if (this.anim) this.dirty = Math.max(this.dirty, 1)
    if (this.needsEnv) this.updateEnv()
    if (this.dirty <= 0) return
    this.dirty--
    if (this.options.ao) this.composer.render()
    else this.renderer.render(this.scene, this.camera)
    this.labelRenderer.render(this.scene, this.camera)
  }

  /** Ask for a redraw (the loop only draws when something changed). */
  invalidate(frames = 2) {
    this.dirty = Math.max(this.dirty, frames)
  }

  // ------------------------------------------------------------------ sun, sky, options
  setSun(altitude: number, azimuth: number) {
    const alt = THREE.MathUtils.degToRad(Math.max(altitude, -4))
    const az = THREE.MathUtils.degToRad(azimuth)
    // plan: x east, y north; three: (x, z, -y)
    const dir = new THREE.Vector3(Math.cos(alt) * Math.sin(az), Math.sin(alt), -Math.cos(alt) * Math.cos(az))
    this.sky.material.uniforms.sunPosition.value.copy(dir)
    this.skyEnvSky.material.uniforms.sunPosition.value.copy(dir)
    const up = Math.max(0, Math.sin(alt))
    this.sunLight.position.copy(dir).multiplyScalar(800)
    this.sunLight.target.position.set(0, 0, 0)
    this.sunLight.intensity = altitude > 0 ? 0.6 + 3.2 * Math.min(1, up * 2.2) : 0
    this.sunLight.color.setHSL(0.09, 0.55 * (1 - Math.min(1, up * 2)), 0.5 + 0.45 * Math.min(1, up * 2.5))
    this.hemi.intensity = 0.35 + 0.5 * Math.min(1, up * 3)
    this.renderer.toneMappingExposure = altitude > 0 ? 0.42 + 0.18 * (1 - up) : 0.6
    this.needsEnv = true
  }

  private updateEnv() {
    this.needsEnv = false
    this.invalidate()
    this.envRT?.dispose()
    this.envRT = this.pmrem.fromScene(this.skyScene, 0, 1, 20000)
    this.scene.environment = this.envRT.texture
    this.scene.environmentIntensity = 0.55
  }

  setOptions(o: Partial<ViewOptions>) {
    this.invalidate()
    const prevExplode = this.options.explode
    this.options = { ...this.options, ...o }
    this.sky.visible = this.options.sky
    this.scene.background = this.options.sky ? null : new THREE.Color('#d7dfda')
    this.renderer.shadowMap.enabled = this.options.shadows
    this.sunLight.castShadow = this.options.shadows
    this.scene.traverse((c) => {
      const m = (c as THREE.Mesh).material as THREE.Material | undefined
      if (m) m.needsUpdate = true
    })
    this.labelGroup.visible = this.options.labels
    this.ctxGroup.visible = this.options.context !== false
    if (prevExplode !== this.options.explode) this.applyFocus(false)
  }

  // ------------------------------------------------------------------ site
  setSite(site: SitePayload) {
    this.invalidate()
    this.site = site
    disposeTree(this.contextGroup)
    this.contextGroup.clear()
    const pts = site.buildings.flatMap((b) => b.footprint)
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    this.center.set((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2)
    this.world.position.set(-this.center.x, 0, this.center.y)

    const ground = new THREE.Mesh(new THREE.CircleGeometry(1400, 96),
      new THREE.MeshStandardMaterial({ color: '#b9bcae', roughness: 1 }))
    ground.position.set(this.center.x, this.center.y, -0.05)
    ground.receiveShadow = true
    ground.userData.placeholder = true
    this.contextGroup.add(ground)
    // Årstaviken lies south-east of the blocks: a simple water plane to read the site by
    const water = new THREE.Mesh(new THREE.PlaneGeometry(1600, 700),
      new THREE.MeshStandardMaterial({ color: '#4b6475', roughness: 0.12, metalness: 0.4 }))
    water.position.set(this.center.x + 330, this.center.y - 470, -0.02)
    water.rotation.z = Math.atan2(-0.8, 0.6) + Math.PI / 2
    water.receiveShadow = true
    water.userData.placeholder = true
    this.contextGroup.add(water)
    const road = new THREE.LineBasicMaterial({ color: '#8c8f86' })
    for (const r of site.roads) {
      const g = new THREE.BufferGeometry().setFromPoints(r.pts.map(([x, y]) => new THREE.Vector3(x, y, 0.03)))
      const line = new THREE.Line(g, road)
      line.userData.placeholder = true
      this.contextGroup.add(line)
    }
    this.frameSite(false)
  }

  // ------------------------------------------------------------------ urban context (OpenStreetMap)
  private ctxGroup = new THREE.Group()

  setContext(ctx: UrbanContext) {
    this.invalidate()
    disposeTree(this.ctxGroup)
    this.ctxGroup.clear()
    if (!this.ctxGroup.parent) this.world.add(this.ctxGroup)
    // the real shoreline, streets and greens replace the placeholder ground and water
    for (const c of [...this.contextGroup.children]) if (c.userData.placeholder) this.contextGroup.remove(c)
    const g = this.ctxGroup
    const surf = (ringsList: Ring[][], z: number, mat: THREE.Material, thick = 0) => {
      const geos: THREE.BufferGeometry[] = []
      for (const rings of ringsList) {
        const geo = thick ? prism(rings, z, z + thick) : flat(rings, z)
        if (geo) geos.push(geo.index ? geo.toNonIndexed() : geo)
      }
      if (!geos.length) return
      const merged = mergeGeometries(geos, false)
      geos.forEach((x) => x.dispose())
      if (!merged) return
      merged.computeVertexNormals()
      const m = new THREE.Mesh(merged, mat)
      m.receiveShadow = true
      m.castShadow = thick > 0.5
      g.add(m)
    }
    const M = (color: string, rough = 0.95, extra: THREE.MeshStandardMaterialParameters = {}) =>
      new THREE.MeshStandardMaterial({ color, roughness: rough, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, ...extra })
    const [x0, y0, x1, y1] = ctx.clip ?? [-400, -500, 450, 400]
    const disc = ctx.circle
    if (disc) {   // the context covers a disc: ground to its edge, the landscape ring from there on
      const ground = new THREE.Mesh(new THREE.CircleGeometry(disc[2], 128), new THREE.MeshStandardMaterial({ color: '#cfccc4', roughness: 1 }))
      ground.position.set(disc[0], disc[1], -0.05)
      ground.receiveShadow = true
      g.add(ground)
    } else {
      surf([[[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]], -0.05, new THREE.MeshStandardMaterial({ color: '#cfccc4', roughness: 1 }))
    }
    const outer = new THREE.Mesh(new THREE.RingGeometry(disc ? disc[2] - 0.5 : Math.hypot(x1 - x0, y1 - y0) * 0.55, 2600, 128, 1),
      new THREE.MeshStandardMaterial({ color: '#b9bcae', roughness: 1 }))
    outer.position.set(disc ? disc[0] : (x0 + x1) / 2, disc ? disc[1] : (y0 + y1) / 2, -0.08)
    outer.receiveShadow = true
    g.add(outer)
    for (const w of ctx.water ?? []) surf(w.rings, -0.02, new THREE.MeshStandardMaterial({ color: '#3f5f73', roughness: 0.08, metalness: 0.35, envMapIntensity: 1.4 }))
    const GREEN: Record<string, string> = { grass: '#86a862', park: '#7fa35a', wood: '#5f8648', scrub: '#7b9a5a', playground: '#c8b88e', pitch: '#6f9e58', flowerbed: '#b98a9a', rock: '#a9a59c', sand: '#d9cba3' }
    const byKind = new Map<string, Ring[][]>()
    for (const gr of ctx.greens ?? []) byKind.set(gr.kind, [...(byKind.get(gr.kind) ?? []), ...gr.rings])
    for (const [k, rs] of byKind) surf(rs, 0.02, M(GREEN[k] ?? '#8aa86a'))
    for (const p of ctx.plazas ?? []) surf(p.rings, 0.03, M('#d6d0c4'))
    for (const p of ctx.parking ?? []) surf(p.rings, 0.035, M('#76787b', 0.9))
    for (const r of ctx.roads ?? []) surf(r.rings, 0.04 + (r.z ?? 0), M(r.z ? '#6c6e72' : '#4e5054', 0.9), r.z ? 0.8 : 0)
    const PATH: Record<string, string> = { wood: '#9b7651', gravel: '#d6c7a2', paved: '#c9c3b7' }
    for (const p of ctx.paths ?? []) surf(p.rings, 0.06 + (p.z ?? 0), M(PATH[p.surface] ?? PATH.paved))
    for (const p of ctx.piers ?? []) surf(p.rings, 0.0, M('#8a6a48', 0.85), 0.4)
    for (const p of ctx.platforms ?? []) surf(p.rings, p.z ?? 0, M('#bdb8ae', 0.9), 0.8)
    if (ctx.massing?.length) {
      // neighbouring buildings in detail: parts, colours, windows, pitched roofs (viewer/context3d.ts)
      for (const o of buildMassing(ctx.massing)) g.add(o)
    } else {
      const nb = new THREE.MeshStandardMaterial({ color: '#e4e1da', roughness: 0.9 })
      for (const b of ctx.buildings ?? []) surf(b.rings, 0, nb, b.h)
    }
    for (const o of buildBarriers(ctx.barriers ?? [])) g.add(o)
    for (const o of buildRoadPaint(ctx.crossings ?? [], ctx.markings ?? [])) g.add(o)
    for (const o of buildFurniture(ctx.furniture ?? {})) g.add(o)
    // rail: ballast strips
    for (const r of ctx.rail ?? []) {
      for (const ln of r.lines) {
        for (let i = 0; i < ln.length - 1; i++) {
          const box = new THREE.Mesh(UNIT_BOX, M('#7a6a5c', 1))
          box.matrixAutoUpdate = false
          box.matrix.copy(segmentBox(ln[i][0], ln[i][1], ln[i + 1][0], ln[i + 1][1], (r.z ?? 0) + 0.02, (r.z ?? 0) + 0.18, 3.0, new THREE.Matrix4()))
          box.receiveShadow = true
          g.add(box)
        }
      }
    }
    // trees: instanced trunks and crowns, size from the mapped or estimated height
    const trees = ctx.trees ?? []
    if (trees.length) {
      const trunkGeo = new THREE.CylinderGeometry(0.6, 1, 1, 7).rotateX(Math.PI / 2).translate(0, 0, 0.5)
      const crownGeo = new THREE.IcosahedronGeometry(1, 1)
      const coneGeo = new THREE.ConeGeometry(1, 1, 8).rotateX(Math.PI / 2).translate(0, 0, 0.5)
      const trunk = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: '#5a4636', roughness: 1 }), trees.length)
      const broad = trees.filter((t) => t.leaf !== 'needleleaved')
      const needle = trees.filter((t) => t.leaf === 'needleleaved')
      const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, flatShading: true }), broad.length)
      const cones = new THREE.InstancedMesh(coneGeo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, flatShading: true }), Math.max(1, needle.length))
      const m4 = new THREE.Matrix4()
      const q = new THREE.Quaternion()
      const col = new THREE.Color()
      let rnd = 7
      const rand = () => { rnd = (rnd * 16807) % 2147483647; return rnd / 2147483647 }
      trees.forEach((t, i) => {
        const r = Math.max(0.12, t.h * 0.02)
        m4.compose(new THREE.Vector3(t.p[0], t.p[1], 0), q, new THREE.Vector3(r, r, t.h * 0.42))
        trunk.setMatrixAt(i, m4)
      })
      broad.forEach((t, i) => {
        const cr = t.h * (0.27 + rand() * 0.08)
        q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), rand() * Math.PI)
        m4.compose(new THREE.Vector3(t.p[0], t.p[1], t.h - cr * 0.95), q, new THREE.Vector3(cr, cr * (0.9 + rand() * 0.2), cr * 0.85))
        crowns.setMatrixAt(i, m4)
        crowns.setColorAt(i, col.setHSL(0.24 + rand() * 0.06, 0.34 + rand() * 0.12, 0.27 + rand() * 0.08))
      })
      needle.forEach((t, i) => {
        q.identity()
        m4.compose(new THREE.Vector3(t.p[0], t.p[1], t.h * 0.3), q, new THREE.Vector3(t.h * 0.2, t.h * 0.2, t.h * 0.72))
        cones.setMatrixAt(i, m4)
        cones.setColorAt(i, col.setHSL(0.3 + rand() * 0.04, 0.3, 0.2 + rand() * 0.05))
      })
      for (const im of [trunk, crowns, cones]) {
        im.instanceMatrix.needsUpdate = true
        if (im.instanceColor) im.instanceColor.needsUpdate = true
        im.castShadow = true
        im.receiveShadow = true
        im.userData.trees = true
        g.add(im)
      }
      if (!needle.length) cones.visible = false
    }
    // street lamps
    const lamps = ctx.furniture?.lamp ? [] : ctx.lamps ?? []   // drawn with heads among the furniture when present
    if (lamps.length) {
      const pole = new THREE.CylinderGeometry(0.07, 0.09, 1, 6).rotateX(Math.PI / 2).translate(0, 0, 0.5)
      const inst = new THREE.InstancedMesh(pole, new THREE.MeshStandardMaterial({ color: '#3d4044', roughness: 0.6, metalness: 0.4 }), lamps.length)
      const m4 = new THREE.Matrix4()
      lamps.forEach(([x, y], i) => inst.setMatrixAt(i, m4.makeScale(1, 1, 5.5).setPosition(x, y, 0)))
      inst.instanceMatrix.needsUpdate = true
      inst.castShadow = true
      g.add(inst)
    }
  }

  setContextVisible(v: boolean) {
    this.ctxGroup.visible = v
    this.invalidate()
  }

  private mat(key: string, site = this.site, opts: THREE.MeshStandardMaterialParameters = {}) {
    const c = site?.materials[key]
    const color = c ? new THREE.Color(`rgb(${c[0]},${c[1]},${c[2]})`) : new THREE.Color('#d8d4cc')
    if (key === 'glass') {
      return new THREE.MeshStandardMaterial({ color: '#41596a', roughness: 0.12, metalness: 0.55, envMapIntensity: 1.6, ...opts })
    }
    const metal = key.startsWith('metal') || key === 'pv'
    return new THREE.MeshStandardMaterial({ color, roughness: metal ? 0.45 : 0.88, metalness: metal ? 0.35 : 0.0, ...opts })
  }

  // ------------------------------------------------------------------ buildings
  setBuilding(p: BuildingPayload) {
    this.invalidate()
    const old = this.buildings.get(p.id)
    if (old) {
      this.buildingsGroup.remove(old.group)
      disposeTree(old.group)
    }
    const group = new THREE.Group()
    group.userData = { building: p.id }
    const mats: THREE.Material[] = []
    const cache = new Map<string, THREE.Material>()
    const m = (key: string) => {
      if (!cache.has(key)) {
        const mm = this.mat(key)
        cache.set(key, mm)
        mats.push(mm)
      }
      return cache.get(key)!
    }
    const floors: THREE.Group[] = []
    const glass = m('glass')
    const door = new THREE.MeshStandardMaterial({ color: '#4a3a2c', roughness: 0.6 })
    mats.push(door)
    for (const f of p.floors) {
      const fg = new THREE.Group()
      fg.userData = { floor: f.index, z: f.z }
      const geo = prism(f.rings, f.z, f.z + f.height - 0.04)
      if (geo) {
        const mesh = new THREE.Mesh(geo, m(f.material))
        mesh.castShadow = mesh.receiveShadow = true
        mesh.userData = { pick: 'building', building: p.id, floor: f.index, shell: true }
        fg.add(mesh)
      }
      // a slightly darker floor edge band, as the slab reads on a real facade
      const band = prism(f.rings, f.z + f.height - 0.22, f.z + f.height + 0.02)
      if (band) {
        const bm = new THREE.Mesh(band, this.mat(f.added ? 'timber' : f.material, this.site, { color: new THREE.Color('#bdb8ae') }))
        mats.push(bm.material as THREE.Material)
        bm.scale.set(1, 1, 1)
        bm.receiveShadow = true
        bm.userData = { shell: true }
        fg.add(bm)
      }
      floors.push(fg)
      group.add(fg)
    }
    // windows and doors on the outside face, one instanced mesh per floor
    const byFloor = new Map<number, number[][]>()
    for (const w of p.windows) {
      const f = p.floors.findIndex((fl) => w[4] >= fl.z - 0.01 && w[4] < fl.z + fl.height)
      if (f < 0) continue
      if (!byFloor.has(f)) byFloor.set(f, [])
      byFloor.get(f)!.push(w)
    }
    for (const [fi, ws] of byFloor) {
      for (const isDoor of [0, 1]) {
        const list = ws.filter((w) => w[6] === isDoor)
        if (!list.length) continue
        const inst = new THREE.InstancedMesh(UNIT_BOX, isDoor ? door : glass, list.length)
        list.forEach((w, i) => inst.setMatrixAt(i, segmentBox(w[0], w[1], w[2], w[3], w[4], w[5], 0.12)))
        inst.instanceMatrix.needsUpdate = true
        inst.castShadow = false
        inst.receiveShadow = true
        floors[fi].add(inst)
      }
    }
    // roof, parapets, balconies, plant
    for (const d of p.details) {
      const geo = detailGeometry(d)
      if (!geo) continue
      const mesh = new THREE.Mesh(geo, m(d.m))
      mesh.castShadow = mesh.receiveShadow = true
      const z = d.k === 'prism' ? d.z0 : d.k === 'box' ? d.z[0] : d.z0
      let fi = p.floors.findIndex((fl) => z >= fl.z - 0.25 && z < fl.z + fl.height - 0.25)
      if (fi < 0) fi = p.floors.length - 1
      floors[fi].add(mesh)
    }
    this.buildingsGroup.add(group)
    this.buildings.set(p.id, { group, floors, mats, payload: p, detail: null })
    this.applyFocus(false)
  }

  // ------------------------------------------------------------------ focus levels
  setFocus(f: Focus, animate = true) {
    this.focus = f
    if (f.kind === 'site' || f.kind === 'building') this.clearFloor()
    this.applyFocus(animate)
  }

  /** Buildings to ghost regardless of focus — District's unselected buildings, Urban's receded massing. */
  setDimmed(ids: Iterable<string> | null) {
    this.dimmed = new Set(ids ?? [])
    this.applyFocus(false)
  }
  private dimmed: Set<string> = new Set()

  private applyFocus(animate: boolean) {
    this.invalidate()
    const f = this.focus
    for (const [id, bv] of this.buildings) {
      const active = f.kind !== 'site' && 'building' in f && f.building === id
      const ghost = (f.kind !== 'site' && !active) || this.dimmed.has(id)
      for (const mm of bv.mats) {
        const sm = mm as THREE.MeshStandardMaterial
        sm.transparent = ghost
        sm.opacity = ghost ? 0.16 : 1
        sm.depthWrite = !ghost
        sm.needsUpdate = true
      }
      // a ghosted neighbour shows its volume only: no windows, roof plant or balconies
      bv.group.traverse((c) => {
        const m = c as THREE.Mesh
        if (!m.isMesh) return
        m.castShadow = !ghost
        if (!m.userData.shell) m.visible = !ghost
      })
      this.outline(bv, active && f.kind === 'building')
      const explode = active ? this.options.explode : 0
      const inFloor = active && (f.kind === 'floor' || f.kind === 'unit')
      bv.floors.forEach((fg, i) => {
        fg.position.z = explode * i
        // inside one floor, normally only what's below it shows (the open floor itself is drawn in floorGroup,
        // and nothing blocks the view into it from above) - exploded, every other floor shows as well
        fg.visible = !inFloor || (i !== f.floor && (explode > 0 || i < f.floor))
        // a floor with its real plan loaded (setExplodedPlans): the plan replaces its massing box, windows and roof
        const hasDetail = !!bv.detail?.[i]
        for (const c of fg.children) {
          if (c.userData.detail) continue
          if (hasDetail) c.visible = false
          else if (c.userData.shell) c.visible = true
        }
      })
    }
    // the open floor (and its labels, analysis and studio overlays) moves with its own floor when exploded
    const off = f.kind === 'floor' || f.kind === 'unit' ? this.options.explode * f.floor : 0
    this.floorGroup.position.z = this.analysisGroup.position.z = this.labelGroup.position.z = off
    this.floorGroup.visible = f.kind === 'floor' || f.kind === 'unit'
    this.analysisGroup.visible = this.floorGroup.visible
    this.labelGroup.visible = this.floorGroup.visible && this.options.labels
    if (f.kind === 'unit') this.highlightUnit(f.unit)
    else this.highlightUnit(null)
    if (animate) this.frame()
  }

  /** The selected building's edges in the selection colour (see the map legend). */
  private outline(bv: BuildingView, on: boolean) {
    const old: THREE.LineSegments[] = []
    bv.group.traverse((c) => { if (c.userData.outline) old.push(c as THREE.LineSegments) })
    if (on && old.length) return
    for (const l of old) {
      l.parent?.remove(l)
      l.geometry.dispose()
      ;(l.material as THREE.Material).dispose()
    }
    if (!on) return
    bv.group.traverse((c) => {
      const m = c as THREE.Mesh
      if (!m.isMesh || m.userData.pick !== 'building') return
      const lines = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 30),
        new THREE.LineBasicMaterial({ color: SELECTION_COLOR }))
      lines.userData = { outline: true }
      lines.raycast = () => {}                       // never picked
      m.add(lines)
    })
  }

  private frame() {
    const f = this.focus
    if (f.kind === 'site') return this.frameSite(true)
    const bv = this.buildings.get(f.building)
    if (!bv) return
    const box = new THREE.Box3()
    if (f.kind === 'building') {
      bv.group.updateWorldMatrix(true, true)
      box.setFromObject(bv.group)
      return this.flyToBox(box, 1.25, 0.7)
    }
    if (f.kind === 'floor' && (this.floor || this.studioOn)) {
      this.floorGroup.updateWorldMatrix(true, true)
      box.setFromObject(this.floorGroup)
      return this.flyToBox(box, 1.0, 1.05)
    }
    if (f.kind === 'unit') {
      const um = this.unitMeshes.get(f.unit)
      if (um) {
        um.updateWorldMatrix(true, false)
        box.setFromObject(um)
        box.expandByVector(new THREE.Vector3(2, 3, 2))
        return this.flyToBox(box, 1.6, 1.1)
      }
    }
  }

  frameSite(animate = true) {
    const box = new THREE.Box3()
    this.buildingsGroup.updateWorldMatrix(true, true)
    if (this.buildingsGroup.children.length) box.setFromObject(this.buildingsGroup)
    else box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(300, 30, 300))
    if (animate) this.flyToBox(box, 0.9, 0.42)
    else {
      const c = box.getCenter(new THREE.Vector3())
      const r = box.getSize(new THREE.Vector3()).length() * 0.95
      this.camera.position.set(c.x - r * 0.6, c.y + r * 0.38, c.z + r * 0.62)
      this.controls.target.copy(c)
    }
  }

  private flyToBox(box: THREE.Box3, dist = 1.2, elev = 0.6) {
    const c = box.getCenter(new THREE.Vector3())
    const r = Math.max(8, box.getSize(new THREE.Vector3()).length() * 0.5)
    const d = (r / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2))) * dist * 0.6
    const dir = this.camera.position.clone().sub(this.controls.target).setY(0)
    if (dir.lengthSq() < 1e-6) dir.set(-1, 0, 1)
    dir.normalize()
    const p1 = c.clone().add(dir.multiplyScalar(d * Math.cos(Math.atan(elev)))).add(new THREE.Vector3(0, d * Math.sin(Math.atan(elev)), 0))
    this.anim = { t0: performance.now(), dur: 900, p0: this.camera.position.clone(), p1, c0: this.controls.target.clone(), c1: c }
  }

  // ------------------------------------------------------------------ floor detail
  clearFloor() {
    disposeTree(this.floorGroup)
    this.floorGroup.clear()
    this.clearAnalysis()
    this.labelGroup.children.forEach((c) => (c as CSS2DObject).element?.remove())
    this.labelGroup.clear()
    this.unitMeshes.clear()
    this.floor = null
    this.studioOn = false
    this.studioAgents = null
    this.studioHeat = null
    this.studioDensity = null
  }

  // ------------------------------------------------------------------ floor studio (B01 mock-up)
  private studioOn = false
  private studioBase = 0
  private studioAgents: THREE.InstancedMesh | null = null
  private studioHeat: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture } | null = null
  private studioDensity: THREE.Mesh | null = null

  private studioLabel(text: string, x: number, y: number, z: number, cls = '') {
    const el = document.createElement('div')
    el.className = `studio-label ${cls}`
    el.textContent = text
    const lab = new CSS2DObject(el)
    const [px, py] = P(x, y)
    lab.position.set(px, py, z)
    this.labelGroup.add(lab)
  }

  /** A plane over the whole plate at height z, coloured cell by cell (escape distance or busy routes). */
  private studioGridPlane(z: number, colour: (c: number) => [number, number, number, number] | null) {
    const canvas = document.createElement('canvas')
    canvas.width = NX; canvas.height = NY
    this.paintGrid(canvas, colour)
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.magFilter = THREE.LinearFilter
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }))
    plane.matrixAutoUpdate = false
    plane.matrix.copy(studioBox(0, 0, NX * CELL, NY * CELL, z, z + 0.001))
    plane.renderOrder = 2
    this.floorGroup.add(plane)
    return { canvas, tex }
  }

  private paintGrid(canvas: HTMLCanvasElement, colour: (c: number) => [number, number, number, number] | null) {
    const ctx = canvas.getContext('2d')!
    const img = ctx.createImageData(NX, NY)
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const v = colour(j * NX + i)
      if (!v) continue
      const o = ((NY - 1 - j) * NX + i) * 4   // canvas rows run top-down; plan y runs up
      img.data[o] = v[0]; img.data[o + 1] = v[1]; img.data[o + 2] = v[2]; img.data[o + 3] = v[3]
    }
    ctx.putImageData(img, 0, 0)
  }

  /** Draw one B01 floor from the floor studio in place of the explorer's own floor. */
  setStudio(m: StudioModel, base: number, view: StudioView, fly = false, suites: Suite[] = [], use: Record<string, number> | null = null) {
    this.invalidate()
    this.clearFloor()
    this.studioOn = true
    this.studioBase = base
    const g = this.floorGroup
    const add = (geo: THREE.BufferGeometry | null, mat: THREE.Material, shadows = true) => {
      if (!geo) return
      const mesh = new THREE.Mesh(geo, mat)
      mesh.castShadow = mesh.receiveShadow = shadows
      g.add(mesh)
    }
    const boxMesh = (mat: THREE.Material, mtx: THREE.Matrix4) => {
      const mesh = new THREE.Mesh(UNIT_BOX, mat)
      mesh.matrixAutoUpdate = false
      mesh.matrix.copy(mtx)
      mesh.castShadow = mesh.receiveShadow = true
      g.add(mesh)
    }
    // slab, with the atrium open from floor 1 up
    add(prism([rectRing([0, 0, W, H]), ...(m.ground ? [] : [rectRing(ATRIUM)])], base - 0.3, base), new THREE.MeshStandardMaterial({ color: '#c9c6bf', roughness: 0.95 }))
    // room floors, tinted by type
    for (const r of m.rooms) {
      add(flat([rectRing(r.r)], base + 0.015), new THREE.MeshStandardMaterial({ color: TYPES[r.t]?.fill ?? '#ece9e0', roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1 }), false)
    }
    // the glazed facade, low so the floor reads from above
    const glass = new THREE.MeshStandardMaterial({ color: '#9fc3d6', transparent: true, opacity: 0.2, roughness: 0.1, depthWrite: false })
    const corners = [[0, 0], [W, 0], [W, H], [0, H]]
    corners.forEach((a, i) => {
      const b = corners[(i + 1) % 4], pa = P(a[0], a[1]), pb = P(b[0], b[1])
      const mesh = new THREE.Mesh(UNIT_BOX, glass)
      mesh.matrixAutoUpdate = false
      mesh.matrix.copy(segmentBox(pa[0], pa[1], pb[0], pb[1], base, base + 1.1, 0.06))
      g.add(mesh)
    })
    // cores
    const coreMat = new THREE.MeshStandardMaterial({ color: '#4a4944', roughness: 0.9 })
    for (const c of CORES) boxMesh(coreMat, studioBox(c.r[0], c.r[1], c.r[2], c.r[3], base, base + 3.2))
    // partitions, with the door openings left out
    const solid: number[][] = [], glassW: number[][] = []
    for (const L of Object.values(m.walls)) {
      const gaps = m.doors.filter((d) => d.o === L.o && Math.abs(d.c - L.c) < 0.06).map((d) => [d.pos - d.w / 2, d.pos + d.w / 2] as [number, number])
      for (const [list, out] of [[L.solid, solid], [L.glass, glassW]] as const) {
        for (const s of subtract(list, gaps)) out.push(L.o === 'h' ? [s[0], L.c, s[1], L.c] : [L.c, s[0], L.c, s[1]])
      }
    }
    for (const [list, mat] of [[solid, new THREE.MeshStandardMaterial({ color: '#efece4', roughness: 0.9 })],
      [glassW, new THREE.MeshStandardMaterial({ color: '#7fb0d8', transparent: true, opacity: 0.38, roughness: 0.1, depthWrite: false })]] as const) {
      if (!list.length) continue
      const inst = new THREE.InstancedMesh(UNIT_BOX, mat, list.length)
      list.forEach((s, i) => { const a = P(s[0], s[1]), b = P(s[2], s[3]); inst.setMatrixAt(i, segmentBox(a[0], a[1], b[0], b[1], base, base + WALL_H, 0.1)) })
      inst.instanceMatrix.needsUpdate = true
      inst.castShadow = inst.receiveShadow = true
      g.add(inst)
    }
    // furniture, one instanced mesh coloured per kind
    if (m.items.length) {
      const inst = new THREE.InstancedMesh(UNIT_BOX, new THREE.MeshStandardMaterial({ roughness: 0.8 }), m.items.length)
      const col = new THREE.Color()
      m.items.forEach((it, i) => {
        const [c, h] = STUDIO_FURN[it.k] ?? ['#cccccc', 0.8]
        inst.setMatrixAt(i, studioBox(it.x, it.y, it.x + it.w, it.y + it.h, base + 0.02, base + h))
        inst.setColorAt(i, col.set(c))
      })
      inst.instanceMatrix.needsUpdate = true
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true
      inst.castShadow = inst.receiveShadow = true
      g.add(inst)
    }
    // labels
    const lz = base + WALL_H + 0.6
    if (view === 'capacity') {
      for (const rf of m.roomFig) {
        if (rf.max === 0 && !rf.seats) continue
        this.studioLabel(`${rf.seats} / ${rf.max}`, (rf.r.r[0] + rf.r.r[2]) / 2, (rf.r.r[1] + rf.r.r[3]) / 2, lz, rf.seats > rf.max ? 'over' : '')
      }
      if (m.openSeats) this.studioLabel(`Open area: ${m.openSeats} seats`, 21.6, 10.5, lz, 'open')
    } else if (view === 'furniture') {
      for (const r of m.rooms) if (r.area >= 18) this.studioLabel(r.name, (r.r[0] + r.r[2]) / 2, (r.r[1] + r.r[3]) / 2, lz, 'name')
    } else if (view === 'tenancy') {
      // each lettable suite tinted in its tenant's colour, vacant ones grey, shared parts left plain
      for (const s of suites) {
        if (s.shared) continue
        const mat = new THREE.MeshBasicMaterial({ color: s.colour, transparent: true, opacity: s.tenant ? 0.62 : 0.5, depthWrite: false, toneMapped: false })
        const geo = flat([rectRing(s.r)], base + 0.04)
        if (!geo) continue
        const mesh = new THREE.Mesh(geo, mat)
        mesh.renderOrder = 2
        g.add(mesh)
        this.studioLabel(s.tenant ? `${s.tenant} · ${Math.round(s.area)} m²` : `Vacant · ${Math.round(s.area)} m²`,
          (s.r[0] + s.r[2]) / 2, (s.r[1] + s.r[3]) / 2, lz, s.tenant ? 'tenant' : 'vacant')
      }
    } else if (view === 'use' && use) {
      // how much of each room is in use at the chosen hour (simulated days): pale = idle, coral = full
      const idle = new THREE.Color('#f4f1e8'), full = new THREE.Color('#e4572e')
      for (const r of m.rooms) {
        const v = use[r.id]
        if (v === undefined) continue
        const geo = flat([rectRing(r.r)], base + 0.04)
        if (!geo) continue
        const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: idle.clone().lerp(full, Math.min(1, v)), transparent: true, opacity: 0.72, depthWrite: false, toneMapped: false }))
        mesh.renderOrder = 2
        g.add(mesh)
        if (r.area >= 9) this.studioLabel(`${Math.round(v * 100)} %`, (r.r[0] + r.r[2]) / 2, (r.r[1] + r.r[3]) / 2, lz, v > 0.85 ? 'over' : '')
      }
      if (use.open !== undefined) this.studioLabel(`Open desks: ${Math.round(use.open * 100)} % in use`, 21.6, 10.5, lz, 'open')
    }
    // fire: distance to the nearest exit painted on the floor, exits, and the floor's longest walk
    if (view === 'fire') {
      this.studioGridPlane(base + 0.03, (c) => {
        const d = m.escape.dist[c]
        if (!m.grid[c] || !isFinite(d)) return null
        const [r, gg, b] = rampColor(d / ESCAPE_LIMIT)
        return [r, gg, b, 150]
      })
      const exitMat = new THREE.MeshStandardMaterial({ color: '#03b05f', roughness: 0.6 })
      m.exits.forEach((e, i) => {
        boxMesh(exitMat, studioBox(e.x - 0.5, e.y - 0.5, e.x + 0.5, e.y + 0.5, base, base + 2.4))
        this.studioLabel(`${e.id} · ${m.fig.exitLoad[i].people} people`, e.x, e.y, base + 3.2, 'exit')
      })
      const w0 = m.fig.worst
      if (w0) {
        const path = m.worstRoute.map(cellXY)
        if (path.length > 1) {
          const inst = new THREE.InstancedMesh(UNIT_BOX, new THREE.MeshStandardMaterial({ color: '#202020' }), path.length - 1)
          for (let i = 0; i < path.length - 1; i++) {
            const a = P(path[i][0], path[i][1]), b = P(path[i + 1][0], path[i + 1][1])
            inst.setMatrixAt(i, segmentBox(a[0], a[1], b[0], b[1], base + 0.05, base + 0.2, 0.22))
          }
          inst.instanceMatrix.needsUpdate = true
          g.add(inst)
          this.studioLabel(`Longest walk ${w0.d.toFixed(1)} m`, path[0][0], path[0][1], base + 2.2, 'exit')
        }
      }
    }
    this.applyFocus(fly)
  }

  /** People walking on the studio floor (positions in B01's plan frame). */
  setStudioAgents(walkers: Walker[]) {
    if (!this.studioOn) return
    if (!this.studioAgents || this.studioAgents.count !== walkers.length) {
      if (this.studioAgents) { this.floorGroup.remove(this.studioAgents); this.studioAgents.geometry.dispose() }
      const geo = new THREE.CylinderGeometry(0.24, 0.24, 1.6, 10)
      geo.rotateX(Math.PI / 2)   // stand up along plan z
      this.studioAgents = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.6 }), Math.max(1, walkers.length))
      this.studioAgents.castShadow = true
      this.floorGroup.add(this.studioAgents)
    }
    const m = new THREE.Matrix4(), col = new THREE.Color()
    walkers.forEach((w, i) => {
      const [x, y] = P(w.x, w.y)
      m.makeTranslation(x, y, this.studioBase + 0.82)
      if (w.gone) m.makeScale(0, 0, 0)   // already out: hidden, the instance kept so counts never change mid-play
      this.studioAgents!.setMatrixAt(i, m)
      this.studioAgents!.setColorAt(i, col.set(w.moving ? '#fd876e' : '#0528ca'))
    })
    this.studioAgents.instanceMatrix.needsUpdate = true
    if (this.studioAgents.instanceColor) this.studioAgents.instanceColor.needsUpdate = true
    this.invalidate(1)
  }

  /** Footfall painted on the floor: the routes people use most. Pass null to remove it. */
  setStudioHeat(heat: Float32Array | null) {
    if (!this.studioOn) return
    let mx = 0
    if (heat) for (let k = 0; k < heat.length; k++) if (heat[k] > mx) mx = heat[k]
    const colour = (c: number): [number, number, number, number] | null => {
      if (!heat || mx <= 0) return null
      const v = heat[c] / mx
      if (v < 0.02) return null
      const [r, g, b] = rampColor(0.35 + v * 0.65)
      return [r, g, b, Math.min(210, 40 + v * 220)]
    }
    if (!this.studioHeat) this.studioHeat = this.studioGridPlane(this.studioBase + 0.03, colour)
    else { this.paintGrid(this.studioHeat.canvas, colour); this.studioHeat.tex.needsUpdate = true }
    this.invalidate(1)
  }

  /** Crowd density during an evacuation (people per m², the highest each cell saw), on its own coarse grid. */
  setStudioDensity(d: Float32Array | null, nx: number, ny: number, cell: number) {
    if (!this.studioOn) return
    if (this.studioDensity) { this.floorGroup.remove(this.studioDensity); disposeTree(this.studioDensity) ; this.studioDensity = null }
    if (!d) { this.invalidate(1); return }
    const canvas = document.createElement('canvas')
    canvas.width = nx; canvas.height = ny
    const ctx = canvas.getContext('2d')!
    const img = ctx.createImageData(nx, ny)
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const v = d[j * nx + i]
      if (v < 0.5) continue
      const [r, g, b] = rampColor(Math.min(1, v / 4))   // 4 people per m² and up: red
      const o = ((ny - 1 - j) * nx + i) * 4
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 170
    }
    ctx.putImageData(img, 0, 0)
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.magFilter = THREE.NearestFilter
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }))
    plane.matrixAutoUpdate = false
    plane.matrix.copy(studioBox(0, 0, nx * cell, ny * cell, this.studioBase + 0.035, this.studioBase + 0.036))
    plane.renderOrder = 3
    this.floorGroup.add(plane)
    this.studioDensity = plane
    this.invalidate(1)
  }

  // ------------------------------------------------------------------ layers: floors tinted by a figure, flows to the station
  private layerGroup = new THREE.Group()
  private layerMeshes: THREE.Object3D[] = []

  /** Tint each listed building floor by floor (colour per floor, null = leave as is), with a label over the roof.
   *  The tints ride on the building's own floor groups, so they follow explode and floor focus. */
  setLayerTint(tints: Record<string, { floors: (string | null)[]; label?: string }> | null) {
    this.invalidate()
    for (const o of this.layerMeshes) { o.parent?.remove(o); disposeTree(o) }
    this.layerMeshes = []
    this.layerGroup.children.forEach((c) => (c as CSS2DObject).element?.remove())
    disposeTree(this.layerGroup)
    this.layerGroup.clear()
    if (!this.layerGroup.parent) this.world.add(this.layerGroup)
    if (!tints) return
    const mats = new Map<string, THREE.Material>()
    const mat = (c: string) => {
      if (!mats.has(c)) mats.set(c, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.86, toneMapped: false }))
      return mats.get(c)!
    }
    for (const [id, t] of Object.entries(tints)) {
      const bv = this.buildings.get(id)
      if (!bv) continue
      let top = 0, cx = 0, cy = 0
      bv.payload.floors.forEach((f, i) => {
        top = Math.max(top, f.z + f.height)
        const c = t.floors[i]
        if (!c || !bv.floors[i]) return
        const geo = prism(f.rings, f.z + 0.03, f.z + f.height - 0.08)
        if (!geo) return
        geo.computeBoundingBox()
        const bb = geo.boundingBox!
        cx = (bb.min.x + bb.max.x) / 2; cy = (bb.min.y + bb.max.y) / 2
        geo.translate(-cx, -cy, 0); geo.scale(1.015, 1.015, 1); geo.translate(cx, cy, 0)   // just proud of the facade
        const mesh = new THREE.Mesh(geo, mat(c))
        mesh.userData = { pick: 'building', building: id, floor: f.index, shell: true, layer: true }
        bv.floors[i].add(mesh)
        this.layerMeshes.push(mesh)
      })
      if (t.label) {
        const el = document.createElement('div')
        el.className = 'studio-label layer'
        el.textContent = t.label
        const lab = new CSS2DObject(el)
        lab.position.set(cx, cy, top + 4)
        this.layerGroup.add(lab)
      }
    }
  }

  /** Ribbons on the ground from each building to a point (people heading for the station), width by trips. */
  setFlows(flows: { from: [number, number]; to: [number, number]; trips: number }[] | null, label?: { at: [number, number]; text: string }) {
    this.invalidate()
    const old = this.layerGroup.getObjectByName('flows')
    if (old) { this.layerGroup.remove(old); disposeTree(old) }
    this.layerGroup.children.filter((c) => c.name === 'flow-label').forEach((c) => { (c as CSS2DObject).element?.remove(); this.layerGroup.remove(c) })
    if (!this.layerGroup.parent) this.world.add(this.layerGroup)
    if (!flows?.length) return
    const g = new THREE.Group()
    g.name = 'flows'
    const mx = Math.max(...flows.map((f) => f.trips), 1)
    const mat = new THREE.MeshBasicMaterial({ color: '#0528ca', transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false })
    for (const f of flows) {
      const w = 1.5 + 7 * (f.trips / mx)
      const mesh = new THREE.Mesh(UNIT_BOX, mat)
      mesh.matrixAutoUpdate = false
      mesh.matrix.copy(segmentBox(f.from[0], f.from[1], f.to[0], f.to[1], 0.15, 0.35, w))
      mesh.renderOrder = 2
      g.add(mesh)
    }
    this.layerGroup.add(g)
    if (label) {
      const el = document.createElement('div')
      el.className = 'studio-label exit'
      el.textContent = label.text
      const lab = new CSS2DObject(el)
      lab.name = 'flow-label'
      lab.position.set(label.at[0], label.at[1], 8)
      this.layerGroup.add(lab)
    }
  }

  setFloor(fp: FloorPayload, colorFor?: (u: Unit) => string | null) {
    this.invalidate()
    this.clearFloor()
    this.floor = fp
    this.buildFloorMeshes(fp, this.floorGroup, colorFor, { labels: true, register: true })
    this.applyFocus(true)
  }

  /** One floor's real plan (slab, walls, glazing, openings, unit fills) into group `g` - shared by the single
   *  open floor (setFloor, labelled and pickable) and every floor at once when exploded (setExplodedPlans,
   *  plain geometry only: picking and labels stay the single-floor view's job, or the plan gets too busy). */
  private buildFloorMeshes(fp: FloorPayload, g: THREE.Group, colorFor?: (u: Unit) => string | null,
    opts: { labels: boolean; register: boolean; cut?: number } = { labels: true, register: true }) {
    // cut: walls sliced this far above the floor (a section), so the plan can be seen into from any angle
    const top = opts.cut !== undefined ? fp.base + opts.cut : Infinity
    const facade = this.buildings.get(fp.building)?.payload.floors[fp.index]?.material ?? 'render_light'
    // slab with atrium voids
    const slabRings: Ring[] = [...fp.rings, ...fp.voids.map((v) => v[0])]
    const slab = prism(slabRings, fp.z, fp.base)
    if (slab) {
      const s = new THREE.Mesh(slab, new THREE.MeshStandardMaterial({ color: '#c9c6bf', roughness: 0.95 }))
      s.receiveShadow = s.castShadow = true
      g.add(s)
    }
    // walls, by category, as instanced boxes
    const cats = 'ECSKPIA'
    const byCat = new Map<number, number[][]>()
    for (const pc of fp.pieces) {
      if (pc[6] >= top) continue
      if (!byCat.has(pc[9])) byCat.set(pc[9], [])
      byCat.get(pc[9])!.push(pc[7] > top ? [...pc.slice(0, 7), top, ...pc.slice(8)] : pc)
    }
    for (const [ci, list] of byCat) {
      const cat = cats[ci]
      const mat = cat === 'E' ? this.mat(facade) : new THREE.MeshStandardMaterial({ color: WALL_COLORS[cat], roughness: 0.9 })
      const inst = new THREE.InstancedMesh(UNIT_BOX, mat, list.length)
      list.forEach((pc, i) => inst.setMatrixAt(i, localBox([pc[0], pc[1]], [pc[2], pc[3]], pc[4], pc[5], -pc[8] / 2, pc[8] / 2, pc[6], pc[7])))
      inst.instanceMatrix.needsUpdate = true
      inst.castShadow = inst.receiveShadow = true
      g.add(inst)
    }
    // glazed partitions read as glass
    const glassWalls = fp.walls.filter((w) => /GLASS/.test(w.type))
    if (glassWalls.length) {
      const inst = new THREE.InstancedMesh(UNIT_BOX, new THREE.MeshStandardMaterial({ color: '#9fc3d6', transparent: true, opacity: 0.35, roughness: 0.1 }), glassWalls.length)
      glassWalls.forEach((w, i) => inst.setMatrixAt(i, segmentBox(w.a[0], w.a[1], w.b[0], w.b[1], fp.base, Math.min(fp.base + fp.wall_h, top), 0.03)))
      inst.instanceMatrix.needsUpdate = true
      g.add(inst)
    }
    // openings
    const clip = (o: FloorPayload['openings'][number]) => (o.z1 > top ? { ...o, z1: top } : o)
    const wins = fp.openings.filter((o) => o.kind === 'window' && o.z0 < top).map(clip)
    const doors = fp.openings.filter((o) => o.kind === 'door').map(clip)
    if (wins.length) {
      const inst = new THREE.InstancedMesh(UNIT_BOX, new THREE.MeshStandardMaterial({ color: '#7fa6bd', transparent: true, opacity: 0.4, roughness: 0.05, metalness: 0.2 }), wins.length)
      wins.forEach((o, i) => inst.setMatrixAt(i, segmentBox(o.a[0], o.a[1], o.b[0], o.b[1], o.z0, o.z1, 0.04)))
      inst.instanceMatrix.needsUpdate = true
      g.add(inst)
    }
    if (doors.length) {
      const inst = new THREE.InstancedMesh(UNIT_BOX, new THREE.MeshStandardMaterial({ color: '#8a6a4a', roughness: 0.7 }), doors.length)
      doors.forEach((o, i) => inst.setMatrixAt(i, segmentBox(o.a[0], o.a[1], o.b[0], o.b[1], o.z0, o.z1, 0.05)))
      inst.instanceMatrix.needsUpdate = true
      g.add(inst)
    }
    // unit fills (pickable and labelled in the single-floor view only - see opts above)
    const many = fp.units.filter((u) => u.kind === 'unit').length > 24
    for (const u of fp.units) {
      const geo = flat([u.poly, ...(u.holes ?? [])], fp.base + 0.025)
      if (!geo) continue
      const col = colorFor?.(u) ?? unitColor(u.name, u.kind)
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        color: col, roughness: 0.9, transparent: true, opacity: u.kind === 'unit' ? 0.62 : 0.35, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -1,
      }))
      mesh.receiveShadow = true
      mesh.userData = { pick: 'unit', unit: u.id, kind: u.kind, base: col }
      g.add(mesh)
      if (opts.register) this.unitMeshes.set(u.id, mesh)
      if (opts.labels && u.kind === 'unit') {
        const el = document.createElement('div')
        el.className = 'unit-label'
        // many small units: area only, so the plan stays readable
        el.textContent = many ? `${Math.round(u.area)}` : `${u.name.replace('Apartment ', '')} · ${Math.round(u.area)} m²`
        const lab = new CSS2DObject(el)
        lab.position.set(u.label[0], u.label[1], fp.base + 1.2)
        this.labelGroup.add(lab)
      }
    }
  }

  /** Explode view: every floor's real plan at once (not just the massing box), B01's drawn plans included.
   *  `floors` null clears it and goes back to plain massing boxes for every floor. */
  setExplodedPlans(bid: string, floors: FloorPayload[] | null) {
    this.invalidate()
    const bv = this.buildings.get(bid)
    if (!bv) return
    if (bv.detail) {
      bv.detail.forEach((g, i) => { if (g) { bv.floors[i]?.remove(g); disposeTree(g) } })
      bv.detail = null
    }
    if (floors) {
      const detail: (THREE.Group | null)[] = []
      for (const fp of floors) {
        const fg = bv.floors[fp.index]
        if (!fg) continue
        const g = new THREE.Group()
        g.userData = { detail: true }
        this.buildFloorMeshes(fp, g, undefined, { labels: false, register: false, cut: 1.2 })
        fg.add(g)
        detail[fp.index] = g
      }
      bv.detail = detail
    }
    this.applyFocus(false)
  }

  /** Urban scale: pins on the site, one visual language per kind of life:
   *  permanent → a flag planted in the ground (it stays), temporary → a balloon tied to the spot (it floats away
   *  after its year), amenity → a round board-game token with its type's icon (name on hover).
   *  Pins not on the map the last time pop in with a small animation. null clears them. */
  setLifePins(pins: {
    x: number; y: number; label: string; colour: string; kind: 'permanent' | 'temporary' | 'amenity'; title: string
    id?: string; icon?: string; badge?: string
  }[] | null) {
    this.invalidate()
    this.lifeGroup.children.forEach((c) => (c as CSS2DObject).element?.remove())
    this.lifeGroup.clear()
    const seen = new Set<string>()
    let n = 0
    for (const p of pins ?? []) {
      const id = p.id ?? `${p.kind}:${p.label}:${p.x}:${p.y}`
      seen.add(id)
      const el = document.createElement('div')
      el.title = p.title
      el.className = `lp lp-${p.kind}${this.lifeSeen.has(id) ? '' : ' enter'}`
      // a stable per-pin phase, so balloons and flags don't all bob in step
      let h = 0
      for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
      el.style.setProperty('--c', p.colour)
      el.style.setProperty('--on', inkOn(p.colour))
      el.style.setProperty('--phase', `${-(Math.abs(h) % 2400)}ms`)
      el.style.setProperty('--d', `${p.kind === 'amenity' ? (n++ % 40) * 12 : 150 + (Math.abs(h) % 350)}ms`)
      el.style.setProperty('--tilt', `${(Math.abs(h) % 2 ? 1 : -1) * (2 + (Math.abs(h) % 3))}deg`)
      const icon = p.icon ?? ''
      const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
      const badge = p.badge ? `<em class="lp-badge">${esc(p.badge)}</em>` : ''
      if (p.kind === 'permanent') {
        el.innerHTML = `<div class="lp-in"><span class="lp-foot"></span><span class="lp-pole"></span><span class="lp-knob"></span>`
          + `<span class="lp-flag"><b class="lp-ico">${icon}</b><span class="lp-name">${esc(p.label)}</span><span class="lp-check"></span>${badge}</span></div>`
      } else if (p.kind === 'temporary') {
        el.innerHTML = `<div class="lp-in"><span class="lp-foot"></span>`
          + `<svg class="lp-string" width="14" height="30" viewBox="0 0 14 30"><path d="M7 0c-5 5 5 9 0 14s5 9 0 16" fill="none" stroke="#202020" stroke-width="1.6" stroke-linecap="round"/></svg>`
          + `<span class="lp-bob"><span class="lp-balloon"><b class="lp-ico">${icon}</b></span><span class="lp-knot"></span>`
          + `<span class="lp-ticket"><span class="lp-name">${esc(p.label)}</span>${badge}</span></span></div>`
      } else {
        el.innerHTML = `<div class="lp-in"><span class="lp-token">${icon}</span><span class="lp-tag">${esc(p.label)}</span></div>`
      }
      const o = new CSS2DObject(el)
      // flags and balloons stand on their spot (bottom-centre anchor); tokens sit centred on it
      if (p.kind === 'amenity') o.center.set(0.5, 0.5)
      else o.center.set(0.5, 1)
      o.position.set(p.x, p.y, 1.5)
      this.lifeGroup.add(o)
    }
    this.lifeSeen = seen
  }

  recolorUnits(colorFor: (u: Unit) => string | null) {
    this.invalidate()
    if (!this.floor) return
    for (const u of this.floor.units) {
      const m = this.unitMeshes.get(u.id)
      if (!m) continue
      const c = colorFor(u) ?? unitColor(u.name, u.kind)
      ;(m.material as THREE.MeshStandardMaterial).color.set(c)
      m.userData.base = c
    }
  }

  private highlightUnit(id: string | null) {
    this.invalidate()
    for (const [uid, m] of this.unitMeshes) {
      const mat = m.material as THREE.MeshStandardMaterial
      const on = uid === id
      mat.emissive.set(on ? '#ffffff' : '#000000')
      mat.emissiveIntensity = on ? 0.25 : 0
      mat.opacity = id && !on ? 0.25 : m.userData.kind === 'unit' ? 0.62 : 0.35
    }
  }

  // ------------------------------------------------------------------ analysis overlays
  clearAnalysis() {
    this.invalidate()
    disposeTree(this.analysisGroup)
    this.analysisGroup.clear()
  }

  showDaylight(points: [number, number, number][], z: number, cell: number) {
    this.invalidate()
    this.clearAnalysis()
    if (!points.length) return
    const geo = new THREE.PlaneGeometry(cell * 0.94, cell * 0.94)
    const inst = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ toneMapped: false }), points.length)
    const m = new THREE.Matrix4()
    const c = new THREE.Color()
    points.forEach(([x, y, v], i) => {
      m.makeTranslation(x, y, z)
      inst.setMatrixAt(i, m)
      inst.setColorAt(i, c.set(dfColor(v)))
    })
    inst.instanceMatrix.needsUpdate = true
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true
    this.analysisGroup.add(inst)
    // hide unit fills under the grid so the colours read true
    for (const mm of this.unitMeshes.values()) (mm.material as THREE.MeshStandardMaterial).opacity = 0.12
  }

  // ------------------------------------------------------------------ picking
  private pick(e: PointerEvent): Pick {
    const r = this.renderer.domElement.getBoundingClientRect()
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    this.ray.setFromCamera(this.pointer, this.camera)
    const targets: THREE.Object3D[] = []
    if (this.floorGroup.visible) for (const m of this.unitMeshes.values()) targets.push(m)
    this.buildingsGroup.traverse((c) => { if (c.userData.pick === 'building' && c.visible && c.parent?.visible) targets.push(c) })
    const hit = this.ray.intersectObjects(targets, false)[0]
    if (!hit) return null
    const u = hit.object.userData
    if (u.pick === 'unit' && this.floor) return { type: 'unit', building: this.floor.building, floor: this.floor.index, unit: u.unit }
    return { type: 'building', building: u.building, floor: u.floor }
  }

  // ------------------------------------------------------------------ Rhino
  async loadRhino(src: string | ArrayBuffer, onLayers?: (layers: { name: string; visible: boolean; color: string }[]) => void) {
    const loader = new Rhino3dmLoader()
    loader.setLibraryPath(new URL('rhino3dm/', document.baseURI).href)
    const obj: THREE.Object3D = await new Promise((resolve, reject) => {
      if (typeof src === 'string') loader.load(src, resolve, undefined, reject)
      else loader.parse(src, resolve, reject)
    })
    disposeTree(this.rhinoGroup)
    this.rhinoGroup.clear()
    obj.traverse((c) => {
      const m = c as THREE.Mesh
      if (m.isMesh) {
        m.castShadow = m.receiveShadow = true
        const mat = m.material as THREE.MeshStandardMaterial
        if (mat && 'roughness' in mat) mat.roughness = Math.max(0.6, mat.roughness ?? 0.8)
      }
    })
    this.rhinoGroup.add(obj)
    const layers = ((obj.userData.layers ?? []) as { name: string; fullPath?: string; visible: boolean; color: { r: number; g: number; b: number } }[])
      .map((l) => ({ name: l.fullPath ?? l.name, visible: l.visible, color: `rgb(${l.color?.r ?? 128},${l.color?.g ?? 128},${l.color?.b ?? 128})` }))
    this.applyRhinoLayers(new Set(layers.filter((l) => l.visible).map((l) => l.name)), layers.map((l) => l.name))
    onLayers?.(layers)
    return layers
  }

  applyRhinoLayers(visible: Set<string>, all?: string[]) {
    this.invalidate()
    const root = this.rhinoGroup.children[0]
    if (!root) return
    const names: string[] = all ?? ((root.userData.layers ?? []) as { name: string; fullPath?: string }[]).map((l) => l.fullPath ?? l.name)
    root.traverse((c) => {
      const li = c.userData?.attributes?.layerIndex
      if (li === undefined) return
      // as in Rhino: a layer shows only when it and every parent layer are on
      const parts = (names[li] ?? '').split('::')
      c.visible = parts.every((_, i) => visible.has(parts.slice(0, i + 1).join('::')))
    })
  }

  setRhinoVisible(v: boolean) {
    this.invalidate()
    this.rhinoGroup.visible = v
  }

  setBuildingsVisible(v: boolean) {
    this.invalidate()
    this.buildingsGroup.visible = v
  }

  screenshot(): string {
    this.composer.render()
    return this.renderer.domElement.toDataURL('image/png')
  }
}
