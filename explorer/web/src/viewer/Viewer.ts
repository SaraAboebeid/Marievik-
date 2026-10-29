import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { Sky } from 'three/examples/jsm/objects/Sky.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { DofShader, OutlineShader, fixGtaoLogDepth, gradientSky, setToon } from './toon'
import { waterMaterial, waterTime } from './water'
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import { inkOn } from '../lifeIcons'
import { Rhino3dmLoader } from 'three/examples/jsm/loaders/3DMLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { BuildingPayload, FloorPayload, Ring, SitePayload, Unit, UrbanContext } from '../types'
import { glowGlass, roomLight, setGlow } from './glow'
import { flock, planks, pvCells, sedum, speckle, shoreBands } from './textures'
import { buildSculptures } from './sculptures'
import { SeasonShow } from './seasonShow'
import { nightOf, sunAt } from '../seasons'
import type { Amenity } from '../urbanLife'
import { buildBoats, buildDressing, buildPeople, buildPierRails, buildTrees, ground, peopleSpots, type Ground } from './dress'
import { UNIT_BOX, detailGeometry, disposeTree, flat, inflate, localBox, prism, segmentBox } from './geometry'
import { buildBarriers, buildFurniture, buildMassing, buildRoadPaint } from './context3d'
import { dfColor, unitColor } from './colors'
import { ATRIUM, CELL, CORES, ESCAPE_LIMIT, FRAME, H, NX, NY, TYPES, W, WALL_H, cellXY, subtract } from '../studio/engine'
import type { Rect, StudioModel } from '../studio/engine'
import type { Walker } from '../studio/crowd'
import type { Suite } from '../studio/tenancy'
import type { WallSeg } from '../flex'

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

/** One floor of one side of the flexibility stacks at one moment (BuildingFlex computes it, the viewer draws it). */
export interface FlexFloorFrame {
  key: string; ground: boolean; closed: boolean; t: number
  rooms: { t: string; r: Rect; open: boolean }[]
  steady: WallSeg[] | null; kept: WallSeg[]; removed: WallSeg[]; added: WallSeg[]
}
export interface FlexFrame {
  building: string; gap: number
  /** changes when the panels around the view change size, so the camera fits the pair again */
  fit?: string
  sides: { id: 'smartax' | 'gypsum'; title: string; tone: string; dx: number; reusable: boolean; recover: number; floors: FlexFloorFrame[] }[]
}

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
  toon?: boolean       // banded light and ink outlines (viewer/toon.ts)
  bloom?: boolean
  dof?: boolean        // far buildings slightly out of focus
  skyStyle?: boolean   // stylised gradient sky instead of the physical one (toon.ts gradientSky)
  waterMotion?: boolean  // animated ripples (redraws ~30 times a second while water is in the context)
}

const EXPOSURE = 1.2  // on top of the sun-driven exposure in setSun
const DUSK_MS = 4000  // the rented/vacant tour's evening falling (and the morning coming back)
// rented / vacant tour: a warm lit window (bright enough to bloom) and an unlit one
const TOUR_LIT = new THREE.Color(1.9, 1.3, 0.62)
const TOUR_DARK = new THREE.Color('#1f2836')

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
  private outlinePass = new ShaderPass(OutlineShader)
  private dofPass = new ShaderPass(DofShader)
  private bloomPass: UnrealBloomPass
  private sky = new Sky()
  private skyScene = new THREE.Scene()
  private skyEnvSky = new Sky()
  private gradSky = gradientSky()
  private gradEnvSky = new THREE.Mesh(this.gradSky.geometry, this.gradSky.material)
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
  private hasWater = false
  private waterAt = 0
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
    this.controls.addEventListener('start', () => { if (this.tour) { this.tour.hold = true; this.tour.resumeAt = 0 } this.orbitHoldUntil = Infinity })
    this.controls.addEventListener('end', () => { if (this.tour) this.tour.resumeAt = performance.now() + 3500; this.orbitHoldUntil = performance.now() + 3500 })

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
    this.gradSky.scale.setScalar(15000)
    this.gradEnvSky.scale.setScalar(15000)
    this.scene.add(this.sky, this.gradSky)
    this.skyScene.add(this.skyEnvSky, this.gradEnvSky)
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

    // multisampled, or thin mullions and frames shimmer once the post effects are on (the canvas's own
    // antialias only applies when the scene renders straight to it)
    const pr = this.renderer.getPixelRatio()
    this.composer = new EffectComposer(this.renderer,
      new THREE.WebGLRenderTarget(w * pr, h * pr, { type: THREE.HalfFloatType, samples: 4 }))
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.aoPass = new GTAOPass(this.scene, this.camera, w, h)
    {
      // light that doesn't write depth (beams, glows, haloes) stays out of the normal/depth pass, or the outlines
      // and AO would draw it as a solid
      const ao = this.aoPass as unknown as { overrideVisibility: () => void; scene: THREE.Scene }
      const base = ao.overrideVisibility.bind(ao)
      ao.overrideVisibility = () => {
        base()
        ao.scene.traverse((o) => {
          const m = (o as THREE.Mesh).material as THREE.Material | undefined
          if (m && !Array.isArray(m) && m.transparent && !m.depthWrite) o.visible = false
        })
      }
    }
    this.aoPass.blendIntensity = 0.85
    this.aoPass.updateGtaoMaterial({ radius: 2.5, distanceExponent: 1.4, thickness: 2.0, scale: 1.0 })
    fixGtaoLogDepth([this.aoPass.gtaoMaterial, this.aoPass.pdMaterial], this.camera.near, this.camera.far)
    // ghosted (faded) buildings stay out of the normal/depth pass: no soft shading or ink outlines drawn through them
    const hideLines = this.aoPass.overrideVisibility.bind(this.aoPass)
    this.aoPass.overrideVisibility = () => {
      hideLines()
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined
        if (m && !Array.isArray(m) && m.transparent && m.opacity < 0.6) o.visible = false
      })
    }
    this.composer.addPass(this.aoPass)
    // the outline pass reads the normals and depth GTAOPass renders anyway
    this.outlinePass.uniforms.tNormal.value = this.aoPass.normalTexture
    this.outlinePass.uniforms.tDepth.value = this.aoPass.depthTexture
    this.outlinePass.enabled = false
    this.composer.addPass(this.outlinePass)
    this.dofPass.uniforms.tDepth.value = this.aoPass.depthTexture
    this.dofPass.uniforms.far.value = this.camera.far
    this.dofPass.enabled = false
    this.composer.addPass(this.dofPass)
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.3, 0.5, 2.6)
    this.bloomPass.enabled = false
    this.composer.addPass(this.bloomPass)
    this.composer.addPass(new OutputPass())
    this.setTexel(w, h)

    const el = this.renderer.domElement
    el.addEventListener('pointerdown', (e) => { this.downAt = { x: e.clientX, y: e.clientY } })
    el.addEventListener('pointerup', (e) => {
      if (Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) < 5 && e.button === 0) {
        const p = this.pick(e)
        const ff = this.flex ? this.flexPick(e) : -1
        if (ff >= 0) { this.onFlexFloor(ff); return }
        const band = !p && this.walk ? this.walkBand(e) : -1
        if (band >= 0) this.onWalkRing(band)
        else this.onPick(p)
      }
    })
    el.addEventListener('pointermove', (e) => {
      const p = this.pick(e)
      this.onHover(p, e.clientX, e.clientY)
      if (this.walk) {
        const b = p ? -1 : this.walkBand(e)
        el.style.cursor = b >= 0 ? 'pointer' : ''
        if (b !== this.walk.hover) { this.walk.hover = b; this.walkPaint() }
      }
    })
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
    this.setTexel(w, h)
    this.invalidate()
  }

  private setTexel(w: number, h: number) {
    const pr = this.renderer.getPixelRatio()
    this.outlinePass.uniforms.texel.value.set(1 / (w * pr), 1 / (h * pr))
    this.dofPass.uniforms.texel.value.set(1 / (w * pr), 1 / (h * pr))
    this.dofPass.uniforms.maxBlur.value = 3 * pr
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
    if (this.tour) this.tourStep()
    if (this.walk) this.walkStep()
    if (this.season && !document.hidden) {
      const now = performance.now()
      if (now - this.seasonAt > 33) {
        const dt = Math.min(0.1, (now - (this.seasonAt || now)) / 1000)
        // the 360: circle the orbit target while the year plays, as the rented/vacant tour does; dragging pauses it
        if (this.seasonOrbit && !this.anim && now > this.orbitHoldUntil) {
          const tgt = this.controls.target
          const off = this.camera.position.clone().sub(tgt)
          off.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.seasonOrbit * dt)
          this.camera.position.copy(tgt).add(off)
        }
        this.season.step(dt)
        this.seasonAt = now
        this.dirty = Math.max(this.dirty, 1)
      }
    }
    if (this.controls.update()) this.dirty = Math.max(this.dirty, 2)
    if (this.anim) this.dirty = Math.max(this.dirty, 1)
    this.stepDusk(performance.now())
    if (this.needsEnv) this.updateEnv()
    if (this.hasWater && this.options.waterMotion && this.ctxGroup.visible && !document.hidden) {
      const now = performance.now()
      if (now - this.waterAt > 33) {   // ~30 fps is plenty for slow ripples, and halves the cost of the effects
        this.waterAt = now
        waterTime.value = now / 1000
        this.dirty = Math.max(this.dirty, 1)
      }
    }
    if (this.dirty <= 0) return
    this.dirty--
    const o = this.options
    if (o.dof) {
      const focus = this.camera.position.distanceTo(this.controls.target)
      this.dofPass.uniforms.focus.value = focus * 1.1
      this.dofPass.uniforms.range.value = focus * 1.8
    }
    if (o.ao || o.toon || o.bloom || o.dof) this.composer.render()
    else this.renderer.render(this.scene, this.camera)
    this.labelRenderer.render(this.scene, this.camera)
  }

  /** Ask for a redraw (the loop only draws when something changed). */
  invalidate(frames = 2) {
    this.dirty = Math.max(this.dirty, frames)
  }

  // ------------------------------------------------------------------ sun, sky, options
  setSun(altitude: number, azimuth: number) {
    this.sunReq = [altitude, azimuth]
    this.applySky(true)
  }

  // The rented/vacant tour's dusk is not a switch but an evening falling: duskK runs 0 (the clock's daylight) →
  // 1 (dusk) over DUSK_MS, the sun sinking through a warm sunset into a cool, dim evening, and back again after.
  private duskK = 0
  private duskT = 0          // linear progress; duskK is it eased
  private duskTarget = 0
  private duskAt = 0
  private envAt = 0
  private readonly bloomDay: [number, number] = [0.3, 2.6]   // strength, threshold outside the tour

  private stepDusk(now: number) {
    if (this.duskT === this.duskTarget) { this.duskAt = now; return }
    const dt = Math.min(1, (now - (this.duskAt || now)) / 1000)   // wall clock: ~4 s however slowly frames come
    this.duskAt = now
    const d = dt * 1000 / DUSK_MS
    this.duskT = this.duskTarget > this.duskT ? Math.min(this.duskTarget, this.duskT + d) : Math.max(this.duskTarget, this.duskT - d)
    this.duskK = this.duskT * this.duskT * (3 - 2 * this.duskT)
    this.applySky(this.duskT === this.duskTarget)
    this.dirty = Math.max(this.dirty, 1)
  }

  /** Sun, light, exposure, sky colours and glow for the clock's sun blended toward dusk by duskK.
   *  The image-based light is re-baked at most every 150 ms while the evening falls (it's the slow part). */
  private applySky(final: boolean) {
    const [altitude0, azimuth] = this.sunReq
    const k = Math.max(this.duskK, this.nightK)   // the tour's falling evening, or the seasons show's night
    const altitude = THREE.MathUtils.lerp(altitude0, -2.5, k)   // the sun goes down
    const alt = THREE.MathUtils.degToRad(Math.max(altitude, -4))
    const az = THREE.MathUtils.degToRad(azimuth)
    // plan: x east, y north; three: (x, z, -y)
    const dir = new THREE.Vector3(Math.cos(alt) * Math.sin(az), Math.sin(alt), -Math.cos(alt) * Math.cos(az))
    this.sky.material.uniforms.sunPosition.value.copy(dir)
    this.skyEnvSky.material.uniforms.sunPosition.value.copy(dir)
    ;(this.gradSky.material as THREE.ShaderMaterial).uniforms.sunDir.value.copy(dir)
    const up = Math.max(0, Math.sin(alt))
    const dayI = altitude > 0 ? 0.6 + 3.2 * Math.min(1, up * 2.2) : 0
    const dayCol = new THREE.Color().setHSL(0.09, 0.55 * (1 - Math.min(1, up * 2)), 0.5 + 0.45 * Math.min(1, up * 2.5))
    const dayHemi = 0.35 + 0.5 * Math.min(1, up * 3)
    const dayExp = altitude > 0 ? 0.42 + 0.18 * (1 - up) : 0.6
    // dusk: a cool moonlight from high up so the massing still reads, a dimmer sky, lit windows glow
    const moon = new THREE.Vector3(Math.sin(az) * 300, 700, -Math.cos(az) * 300).normalize()
    this.sunLight.position.copy(dir.clone().lerp(moon, k).normalize()).multiplyScalar(800)
    this.sunLight.target.position.set(0, 0, 0)
    this.sunLight.intensity = THREE.MathUtils.lerp(dayI, 0.55, k)
    this.sunLight.color.copy(dayCol).lerp(new THREE.Color('#9fb4e0'), k)
    this.hemi.intensity = THREE.MathUtils.lerp(dayHemi, 0.32, k)
    this.renderer.toneMappingExposure = EXPOSURE * THREE.MathUtils.lerp(dayExp, 0.5, k)
    // the stylised sky: day → a warm sunset half-way → the dim evening
    const gu = (this.gradSky.material as THREE.ShaderMaterial).uniforms
    const pal = (day: string, set: string, eve: string) => k < 0.5
      ? new THREE.Color(day).lerp(new THREE.Color(set), k * 2) : new THREE.Color(set).lerp(new THREE.Color(eve), k * 2 - 1)
    gu.zenith.value.copy(pal('#4f93dc', '#3d5f9c', '#1d2a4d'))
    gu.horizon.value.copy(pal('#e9eee8', '#f0b58a', '#7c7896'))
    gu.ground.value.copy(pal('#dcdcd2', '#b9a99a', '#4a4b55'))
    gu.sunCol.value.copy(pal('#fff1cf', '#ffb36b', '#f2b98a'))
    gu.intensity.value = THREE.MathUtils.lerp(1.15, 0.95, k)
    // lit rooms (viewer/glow.ts): a soft glow by day, more as the sun gets low, full at night; while the
    // rented/vacant tour runs its own lit and dark windows take over, so these go out with the evening
    const g = altitude0 > 0 ? 0.32 + 0.75 * (1 - Math.min(1, up * 2.5)) : 1.35
    setGlow(this.tour ? g * (1 - k) : g)
    this.bloomPass.strength = THREE.MathUtils.lerp(this.bloomDay[0], 0.5, k)
    this.bloomPass.threshold = THREE.MathUtils.lerp(this.bloomDay[1], 1.25, k)
    const now = performance.now()
    if (final || now - this.envAt > 150) { this.envAt = now; this.needsEnv = true }
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
    const stylised = !!this.options.skyStyle
    if (this.gradEnvSky.visible !== stylised) this.needsEnv = true   // relight from whichever sky is shown
    this.sky.visible = this.options.sky && !stylised
    this.gradSky.visible = this.options.sky && stylised
    this.skyEnvSky.visible = !stylised
    this.gradEnvSky.visible = stylised
    this.scene.background = this.options.sky ? null : new THREE.Color('#d7dfda')
    this.renderer.shadowMap.enabled = this.options.shadows
    this.sunLight.castShadow = this.options.shadows
    setToon(!!this.options.toon)
    this.outlinePass.enabled = !!this.options.toon
    this.dofPass.enabled = !!this.options.dof
    this.bloomPass.enabled = !!this.options.bloom
    this.aoPass.blendIntensity = this.options.ao ? 0.85 : 0   // toon without soft shading still needs the pass's normals
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
      const gt = speckle(6, 0.08).clone()
      gt.repeat.set((disc[2] * 2) / 6, (disc[2] * 2) / 6)
      gt.needsUpdate = true
      const ground = new THREE.Mesh(new THREE.CircleGeometry(disc[2], 128), new THREE.MeshStandardMaterial({ color: '#d3d0c8', roughness: 1, map: gt, userData: { season: 'ground' } }))
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
    // water in three bands from the shore out: a foam line, shallow water, then the deep with ripples and glints
    // (viewer/water.ts). Points on the context's clip circle aren't shore, so the bands don't follow that edge.
    // Seams where two water polygons meet aren't shore either: points used by more than one polygon stay put.
    const waterRings = (ctx.water ?? []).flatMap((w) => w.rings)
    const key = (x: number, y: number) => `${Math.round(x * 2)},${Math.round(y * 2)}`
    const owners = new Map<string, Set<number>>()
    waterRings.forEach((rs, i) => rs.forEach((r) => r.forEach(([x, y]) => {
      const k = key(x, y)
      owners.set(k, (owners.get(k) ?? new Set()).add(i))
    })))
    const onClip = (x: number, y: number) =>
      (owners.get(key(x, y))?.size ?? 0) > 1 || (!!disc && Math.abs(Math.hypot(x - disc[0], y - disc[1]) - disc[2]) < 1.5)
    // one surface; its colour map carries the bands, drawn on a canvas clipped to the water so they can never
    // spill onto the land (offsetting the outlines instead tangled in the bays and left wedges of water ashore)
    if (waterRings.length) {
      const wmat = waterMaterial('#ffffff')
      wmat.map = shoreBands(waterRings, onClip)
      surf(waterRings, -0.02, wmat)
    }
    this.hasWater = waterRings.length > 0
    const GREEN: Record<string, string> = { grass: '#86a862', park: '#7fa35a', wood: '#5f8648', scrub: '#7b9a5a', playground: '#c8b88e', pitch: '#6f9e58', flowerbed: '#b98a9a', rock: '#a9a59c', sand: '#d9cba3' }
    const byKind = new Map<string, Ring[][]>()
    for (const gr of ctx.greens ?? []) byKind.set(gr.kind, [...(byKind.get(gr.kind) ?? []), ...gr.rings])
    // model-maker's finishes (viewer/textures.ts): flocked lawns, speckled paving, timber decks
    const SANDY = new Set(['playground', 'sand', 'rock'])
    for (const [k, rs] of byKind) {
      const gm = M(GREEN[k] ?? '#8aa86a', 0.95, { map: SANDY.has(k) ? speckle(3, 0.16) : flock(k === 'wood' ? 7 : 5) })
      gm.userData.season = SANDY.has(k) ? 'ground' : 'green'   // tinted by the seasons show (viewer/seasonShow.ts)
      surf(rs, 0.02, gm)
    }
    for (const p of ctx.plazas ?? []) surf(p.rings, 0.03, M('#ddd8cd', 0.95, { map: speckle(4.8, 0.1, 6) }))
    for (const p of ctx.parking ?? []) surf(p.rings, 0.035, M('#76787b', 0.9, { map: speckle(4, 0.08) }))
    for (const r of ctx.roads ?? []) surf(r.rings, 0.04 + (r.z ?? 0), M(r.z ? '#6c6e72' : '#4e5054', 0.9, { map: speckle(4, 0.07) }), r.z ? 0.8 : 0)
    const PATH: Record<string, string> = { wood: '#c9a77a', gravel: '#d6c7a2', paved: '#d2ccc0' }
    const PATH_TEX: Record<string, () => THREE.Texture> = { wood: () => planks(3), gravel: () => speckle(2, 0.22), asphalt: () => speckle(4, 0.07) }
    for (const p of ctx.paths ?? []) surf(p.rings, 0.06 + (p.z ?? 0), M(PATH[p.surface] ?? PATH.paved, 0.95, { map: (PATH_TEX[p.surface] ?? (() => speckle(3, 0.1, 4)))() }))
    for (const p of ctx.piers ?? []) surf(p.rings, 0.0, M('#c9a77a', 0.85, { map: planks(3) }), 0.4)
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
    // public art modelled from photos (viewer/sculptures.ts); the generic artwork markers stay for the rest
    const art = buildSculptures()
    g.add(art.group)
    const furn = { ...(ctx.furniture ?? {}) }
    if (furn.artwork) furn.artwork = furn.artwork.filter(([x, y]) => !art.spots.some(([u, v]) => Math.hypot(u - x, v - y) < 3))
    for (const o of buildFurniture(furn)) g.add(o)
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
    // trees: clustered, flocked crowns like the model's (viewer/dress.ts), size from the mapped or estimated height
    for (const o of buildTrees(ctx.trees ?? [])) g.add(o)
    // the model-maker's dressing: people, planters, café parasols, pier railings, boats (viewer/dress.ts)
    {
      const fps = (this.site?.buildings ?? []).map((b) => {
        const r = b.footprint.map(([x, y]) => [x, y] as [number, number])
        if (r.length && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1])) r.push([r[0][0], r[0][1]])
        return { ring: r, shops: ['retail', 'restaurant', 'cafe', 'food'].includes(b.ground_use ?? '') }
      })
      const gr = ground(ctx, fps.map((f) => f.ring))
      this.ctxData = ctx
      this.ctxGround = gr
      this.ctxCentre = fps.length ? [fps.reduce((a, f) => a + f.ring[0][0], 0) / fps.length, fps.reduce((a, f) => a + f.ring[0][1], 0) / fps.length] : [0, 0]
      for (const o of buildPeople(peopleSpots(ctx, fps.map((f) => f.ring), gr).filter((sp) => !art.spots.some(([u, v]) => Math.hypot(u - sp.p[0], v - sp.p[1]) < 5.5)))) g.add(o)
      for (const o of buildDressing(ctx, fps, gr)) g.add(o)
      for (const o of buildPierRails(ctx.piers ?? [])) g.add(o)
      if (waterRings.length) for (const o of buildBoats(waterRings, onClip, ctx.piers ?? [], gr, disc ? [disc[0], disc[1]] : [(x0 + x1) / 2, (y0 + y1) / 2])) g.add(o)
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
    // the model's roofs: sedum, timber decks, PV modules with their cells (world-scaled maps, viewer/textures.ts)
    const map = key === 'green' ? sedum() : key === 'timber' ? planks(3) : key === 'pv' ? pvCells() : key.startsWith('membrane') ? speckle(5, 0.06) : undefined
    if (key === 'green') color.set('#c9c08a')
    return new THREE.MeshStandardMaterial({ color, roughness: metal ? 0.45 : 0.88, metalness: metal ? 0.35 : 0.0, map, ...opts })
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
      const band = prism(inflate(f.rings, 0.03), f.z + f.height - 0.22, f.z + f.height + 0.02)
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
    // windows and doors on the outside face, one set of instanced meshes per floor (viewer/glow.ts for the lit rooms):
    // glass set just proud of the wall, a frame of four bars standing in front of it, a mullion in wide windows, a
    // transom in tall ones, and a sill — the crisp, lit facades of the physical model
    const byFloor = new Map<number, number[][]>()
    for (const w of p.windows) {
      const f = p.floors.findIndex((fl) => w[4] >= fl.z - 0.01 && w[4] < fl.z + fl.height)
      if (f < 0) continue
      if (!byFloor.has(f)) byFloor.set(f, [])
      byFloor.get(f)!.push(w)
    }
    let seed = [...p.id].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) % 2147483647 || 7
    const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
    const glowing = glowGlass()
    mats.push(glowing)
    const trimMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6, metalness: 0.15 })
    mats.push(trimMat)
    const lightc = new THREE.Color()
    for (const [fi, ws] of byFloor) {
      const fl = p.floors[fi]
      const ring = fl.rings[0]
      const inside = (x: number, y: number) => {
        let c = false
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [xi, yi] = ring[i], [xj, yj] = ring[j]
          if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
        }
        return c
      }
      const brick = fl.material.startsWith('brick') || fl.material.includes('dark')
      const frames: THREE.Matrix4[] = [], sills: THREE.Matrix4[] = [], panes: THREE.Matrix4[] = [], doors: THREE.Matrix4[] = []
      const lights: THREE.Color[] = []
      for (const w of ws) {
        const [ax, ay, bx, by, z0, z1, isDoor] = w
        const len = Math.hypot(bx - ax, by - ay)
        if (len < 0.15) continue
        const u: [number, number] = [(bx - ax) / len, (by - ay) / len]
        // t runs along the left normal of a→b; flip so +t is outward
        const lx = -u[1], ly = u[0]
        const out = inside((ax + bx) / 2 + lx * 0.5, (ay + by) / 2 + ly * 0.5) ? -1 : 1
        const T = (t0: number, t1: number): [number, number] => (out > 0 ? [t0, t1] : [-t1, -t0])
        const box = (s0: number, s1: number, t: [number, number], zz0: number, zz1: number) =>
          localBox([ax, ay], u, s0, s1, t[0], t[1], zz0, zz1, new THREE.Matrix4())
        const h = z1 - z0, fw = 0.07
        if (isDoor) doors.push(box(0, len, T(-0.06, 0.05), z0, z1))
        else {
          panes.push(box(0, len, T(-0.06, 0.04), z0, z1))
          lights.push(roomLight(rng, lightc).clone())
          sills.push(box(-0.08, len + 0.08, T(-0.02, 0.15), z0 - 0.06, z0))
        }
        // the frame: head, jambs (and a sill bar under doors), a mullion in wide windows, a transom in tall ones
        frames.push(box(-fw, len + fw, T(-0.02, 0.11), z1, z1 + fw))
        frames.push(box(-fw, 0, T(-0.02, 0.11), z0, z1))
        frames.push(box(len, len + fw, T(-0.02, 0.11), z0, z1))
        if (!isDoor) frames.push(box(-fw, len + fw, T(-0.02, 0.11), z0 - fw * 0.5, z0 + 0.02))
        if (!isDoor && len > 1.45) frames.push(box(len / 2 - 0.03, len / 2 + 0.03, T(-0.02, 0.09), z0, z1))
        if (!isDoor && h > 1.9) frames.push(box(0, len, T(-0.02, 0.09), z0 + h * 0.78, z0 + h * 0.78 + 0.05))
      }
      const inst = (list: THREE.Matrix4[], mat: THREE.Material, shadow = false) => {
        if (!list.length) return null
        const im = new THREE.InstancedMesh(UNIT_BOX, mat, list.length)
        list.forEach((mm, i) => im.setMatrixAt(i, mm))
        im.instanceMatrix.needsUpdate = true
        im.castShadow = shadow
        im.receiveShadow = true
        floors[fi].add(im)
        return im
      }
      const glassIm = inst(panes, glowing)
      if (glassIm) { lights.forEach((c, i) => glassIm.setColorAt(i, c)); glassIm.instanceColor!.needsUpdate = true; glassIm.userData.windows = true }
      inst(doors, door)
      // frames and sills share one mesh (instance colours), to keep the draw calls per floor down
      const trim = inst([...frames, ...sills], trimMat)
      if (trim) {
        const fc = new THREE.Color(brick ? '#efe9dd' : '#50565c'), sc = new THREE.Color('#e6e2d8')
        for (let i = 0; i < frames.length + sills.length; i++) trim.setColorAt(i, i < frames.length ? fc : sc)
        trim.instanceColor!.needsUpdate = true
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

  /** The tallest band of the canvas (in px from its top) not covered by the explorer's panels. */
  private openBand(): [number, number] {
    const rc = this.container.getBoundingClientRect()
    const H = rc.height, step = 8
    const free: boolean[] = []
    for (let y = 0; y < H; y += step) {
      free.push([0.3, 0.5, 0.7].every((fx) => {
        const el = document.elementFromPoint(rc.left + rc.width * fx, rc.top + y)
        return !el || this.container.contains(el)
      }))
    }
    let best: [number, number] = [0, H], len = 0, start = -1
    free.push(false)
    free.forEach((f, i) => {
      if (f && start < 0) start = i
      if (!f && start >= 0) { if (i - start > len) { len = i - start; best = [start * step, Math.min(H, i * step)] } start = -1 }
    })
    return len * step < 120 ? [0, H] : best
  }

  private flyToBox(box: THREE.Box3, dist = 1.2, elev = 0.6) {
    // while the twin exploded building is up, any focus the explorer asks for (the building loading, say) goes to it
    if (this.flex && this.flexGo) return this.flexGo()
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

  // ------------------------------------------------------------------ flexibility: B01 exploded, twice (Building scale)
  onFlexFloor: (floor: number) => void = () => {}
  private flex: {
    group: THREE.Group; sides: { group: THREE.Group; floors: (THREE.Group | null)[]; keys: string[]; label: CSS2DObject; el: HTMLElement }[]
    saved: Map<THREE.Material, [boolean, number, boolean]>; hidden: string
  } | null = null
  private flexGo: (() => void) | null = null
  private flexFit = ''

  /** Building-scale flexibility: B01 taken out of the model, exploded floor by floor and built twice side by side
   *  — Smartax on the left, fixed gypsum on the right — while everything around it turns see-through. Each call
   *  draws one moment: every floor's rooms and walls (kept, coming down, panels in flight, going up), closed floors
   *  hatched. Floors are only rebuilt when their state has changed, so playing the years stays light. null ends it. */
  setFlexFrame(frame: FlexFrame | null) {
    this.invalidate()
    if (!frame) {
      if (!this.flex) return
      const F = this.flex
      F.sides.forEach((sd) => sd.el.remove())
      F.group.parent?.remove(F.group)
      disposeTree(F.group)
      for (const [m, [tr, op, dw]] of F.saved) { const mm = m as THREE.MeshStandardMaterial; mm.transparent = tr; mm.opacity = op; mm.depthWrite = dw; mm.needsUpdate = true }
      const bv = this.buildings.get(F.hidden)
      if (bv) bv.group.visible = true
      this.flex = null
      this.flexGo = null
      this.setDimmed([])
      return
    }
    const bv = this.buildings.get(frame.building)
    if (!bv) return
    if (!this.flex) {
      // the surroundings go see-through: other buildings ghosted, the urban context faded
      const saved = new Map<THREE.Material, [boolean, number, boolean]>()
      for (const root of [this.ctxGroup, this.contextGroup]) root.traverse((c) => {
        const mesh = c as THREE.Mesh
        if (!mesh.isMesh) return
        for (const m of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[]) {
          if (!m || saved.has(m)) continue
          saved.set(m, [m.transparent, m.opacity, m.depthWrite])
          m.transparent = true; m.opacity = Math.min(m.opacity, 0.14); m.depthWrite = false; m.needsUpdate = true
        }
      })
      this.setDimmed([...this.buildings.keys()].filter((id) => id !== frame.building))
      bv.group.visible = false
      const group = new THREE.Group()
      this.world.add(group)
      const sides = frame.sides.map(() => {
        const g = new THREE.Group()
        group.add(g)
        const el = document.createElement('div')
        el.className = 'studio-label layer flex-side'
        const label = new CSS2DObject(el)
        group.add(label)
        return { group: g, floors: frame.sides[0].floors.map(() => null), keys: frame.sides[0].floors.map(() => ''), label, el }
      })
      this.flex = { group, sides, saved, hidden: frame.building }
      // fly to both stacks
      const top = bv.payload.floors.length * (frame.gap + 3.6)
      const a = P(frame.sides[0].dx, 0), b = P(frame.sides[frame.sides.length - 1].dx + W, H)
      const box = new THREE.Box3(new THREE.Vector3(Math.min(a[0], b[0]) - this.center.x, 0, -(Math.max(a[1], b[1])) + this.center.y),
        new THREE.Vector3(Math.max(a[0], b[0]) - this.center.x, top, -(Math.min(a[1], b[1])) + this.center.y))
      // look at the pair from the front (the studio's -y side), so Smartax stands on the left and gypsum on the
      // right; after any fly the explorer itself is doing (picking the building) has landed
      const go = () => {
        // the explorer's panels cover much of the canvas: find the band of it that is still open and fit both
        // stacks snugly into that band, by projecting the corners of their box from a trial camera
        const [b0, b1] = this.openBand()
        const Hc = this.container.clientHeight || 1
        const yAxis = new THREE.Vector3(-FRAME.x[1], 0, -FRAME.x[0])   // studio +y in three coordinates (plan (x, y) -> (x, ., -y))
        const dir = yAxis.clone().multiplyScalar(-1).normalize()
        const elev = 0.3
        const off = dir.clone().multiplyScalar(Math.cos(elev)).add(new THREE.Vector3(0, Math.sin(elev), 0))
        const cam = this.camera.clone()
        const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z))
        let target = box.getCenter(new THREE.Vector3())
        let d = Math.max(30, box.getSize(new THREE.Vector3()).length()) * 1.5
        // wanted NDC window: full width less a margin, the open band less a margin (NDC y is up)
        const yTop = 1 - (2 * (b0 + 34)) / Hc, yBot = 1 - (2 * (b1 - 10)) / Hc, xHalf = 0.9
        for (let it = 0; it < 6; it++) {
          cam.position.copy(target).add(off.clone().multiplyScalar(d))
          cam.lookAt(target)
          cam.updateMatrixWorld(true)
          const ps = corners.map((v) => v.clone().project(cam))
          const x0 = Math.min(...ps.map((q) => q.x)), x1 = Math.max(...ps.map((q) => q.x))
          const y0 = Math.min(...ps.map((q) => q.y)), y1 = Math.max(...ps.map((q) => q.y))
          const k = Math.max((x1 - x0) / (2 * xHalf), (y1 - y0) / (yTop - yBot))
          // move the aim so the projected box centre lands on the window centre, then scale the distance
          const tanV = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))
          const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0)
          const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1)
          const dx = ((x0 + x1) / 2) * tanV * cam.aspect * d, dy = ((y0 + y1) / 2 - (yTop + yBot) / 2) * tanV * d
          target = target.clone().add(right.multiplyScalar(dx)).add(up.multiplyScalar(dy))
          d *= k
        }
        const p1 = target.clone().add(off.multiplyScalar(d))
        this.anim = { t0: performance.now(), dur: 1200, p0: this.camera.position.clone(), p1, c0: this.controls.target.clone(), c1: target }
        this.invalidate()
      }
      this.flexGo = go
      this.flexFit = frame.fit ?? ''
      go()
    }
    const F = this.flex
    if ((frame.fit ?? '') !== this.flexFit) { this.flexFit = frame.fit ?? ''; requestAnimationFrame(() => this.flexGo?.()) }
    frame.sides.forEach((sd, si) => {
      const side = F.sides[si]
      const [head, ...rest] = sd.title.split(' · ')
      side.el.innerHTML = `<b>${head}</b>${rest.length ? `<br><span>${rest.join(' · ')}</span>` : ''}`
      side.label.center.set(0.5, 1)
      side.el.style.background = sd.tone
      side.el.style.color = inkOn(sd.tone)
      const pTop = P(sd.dx + W / 2, H / 2)
      side.label.position.set(pTop[0], pTop[1], bv.payload.floors.length * frame.gap + (bv.payload.floors.at(-1)?.z ?? 20) + 8)
      sd.floors.forEach((fl, i) => {
        if (side.keys[i] === fl.key) return
        side.keys[i] = fl.key
        const old = side.floors[i]
        if (old) { side.group.remove(old); disposeTree(old) }
        const z = (bv.payload.floors[i]?.z ?? i * 3.6) + i * frame.gap
        const g = this.flexFloor(fl, sd, z)
        g.userData.flexFloor = i
        g.traverse((c) => { c.userData.flexFloor = i })
        side.group.add(g)
        side.floors[i] = g
      })
    })
  }

  private flexFloor(fl: FlexFloorFrame, sd: FlexFrame['sides'][number], z: number) {
    const g = new THREE.Group()
    const Q = (x: number, y: number) => P(x + sd.dx, y)
    const ring = (r: Rect): Ring => [Q(r[0], r[1]), Q(r[2], r[1]), Q(r[2], r[3]), Q(r[0], r[3])]
    const add = (geo: THREE.BufferGeometry | null, mat: THREE.Material) => { if (geo) { const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; g.add(m) } }
    add(prism([ring([0, 0, W, H]), ...(fl.ground ? [] : [ring(ATRIUM)])], z - 0.3, z), new THREE.MeshStandardMaterial({ color: fl.closed ? '#e8d9a4' : '#d4d0c6', roughness: 0.95 }))
    for (const r of fl.rooms) add(flat([ring(r.r)], z + 0.02), new THREE.MeshStandardMaterial({ color: TYPES[r.t]?.fill ?? '#ece9e0', roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, transparent: r.open, opacity: r.open ? 0.6 : 1 }))
    const core = new THREE.MeshStandardMaterial({ color: '#7d7a72', roughness: 0.9 })
    for (const c of CORES) {
      const m = new THREE.Mesh(UNIT_BOX, core)
      m.matrixAutoUpdate = false
      m.matrix.copy(localBox(Q(0, 0), FRAME.x, c.r[0], c.r[2], c.r[1], c.r[3], z, z + 3.2))
      g.add(m)
    }
    // walls, by state: kept white; coming down red (or lifted off green when the system reuses panels);
    // in flight green; going up wood-coloured (Smartax) or wet grey (gypsum, until filled and painted)
    const HW = WALL_H, t = fl.t
    const boxes: { a: [number, number]; b: [number, number]; z0: number; z1: number; c: string; glass: boolean }[] = []
    const ends = (s: WallSeg): [[number, number], [number, number]] => (s.o === 'h' ? [[s.a, s.c], [s.b, s.c]] : [[s.c, s.a], [s.c, s.b]])
    const put = (s: WallSeg, z0: number, z1: number, c: string) => { if (z1 - z0 > 0.02) { const [a, b] = ends(s); boxes.push({ a, b, z0, z1, c, glass: s.glass }) } }
    if (fl.steady) fl.steady.forEach((s) => put(s, z, z + HW, '#efece4'))
    else {
      fl.kept.forEach((s) => put(s, z, z + HW, '#efece4'))
      const k1 = Math.min(1, t / 0.35)
      fl.removed.forEach((s, i) => {
        const whole = sd.reusable && (i % 10) < sd.recover * 10
        if (t >= 0.35) return
        if (whole) put(s, z + k1 * 1.6, z + HW + k1 * 1.6, '#5fbf82')
        else put(s, z, z + HW * (1 - k1), k1 > 0.05 ? '#e0473f' : '#efece4')
      })
      if (sd.reusable && t >= 0.35 && t < 0.85) {
        const src = fl.removed.filter((s, i) => (i % 10) < sd.recover * 10 && !s.glass)
        const k2 = Math.min(1, (t - 0.35) / 0.35)
        fl.added.filter((s) => !s.glass).forEach((s, i) => {
          if (!src.length || i >= src.length * 1.2) return
          const [a0, b0] = ends(src[i % src.length]), [a1, b1] = ends(s)
          const L = (p: number, q: number) => p + (q - p) * k2
          const lift = 1.6 * (1 - k2)
          boxes.push({ a: [L(a0[0], a1[0]), L(a0[1], a1[1])], b: [L(b0[0], b1[0]), L(b0[1], b1[1])], z0: z + lift, z1: z + HW + lift, c: '#5fbf82', glass: false })
        })
      }
      if (t >= 0.35) {
        const k3 = Math.min(1, (t - 0.35) / 0.5)
        const c = sd.id === 'gypsum' ? (t < 0.85 ? '#a9a59b' : '#b9c7d2') : sd.reusable && t < 0.9 ? '#a8dcb9' : t < 0.9 ? '#e3c99a' : '#efece4'
        fl.added.forEach((s) => put(s, z, z + HW * k3, c))
      }
    }
    for (const glass of [false, true]) {
      const list = boxes.filter((b) => b.glass === glass)
      if (!list.length) continue
      const mat = glass ? new THREE.MeshStandardMaterial({ color: '#7fb0d8', transparent: true, opacity: 0.4, roughness: 0.1, depthWrite: false })
        : new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85 })
      const inst = new THREE.InstancedMesh(UNIT_BOX, mat, list.length)
      const col = new THREE.Color()
      list.forEach((bx, i) => {
        const a = Q(bx.a[0], bx.a[1]), b = Q(bx.b[0], bx.b[1])
        inst.setMatrixAt(i, segmentBox(a[0], a[1], b[0], b[1], bx.z0, bx.z1, 0.14))
        if (!glass) inst.setColorAt(i, col.set(bx.c))
      })
      inst.instanceMatrix.needsUpdate = true
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true
      inst.castShadow = inst.receiveShadow = !glass
      g.add(inst)
    }
    // a closed floor: a yellow veil over it
    if (fl.closed) add(flat([ring([0, 0, W, H])], z + HW + 0.05), new THREE.MeshBasicMaterial({ color: '#f5c443', transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }))
    return g
  }

  /** The floor (index) of the flexibility stacks under the pointer, or -1. */
  private flexPick(e: PointerEvent): number {
    if (!this.flex) return -1
    const r = this.renderer.domElement.getBoundingClientRect()
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    this.ray.setFromCamera(this.pointer, this.camera)
    const hit = this.ray.intersectObject(this.flex.group, true).find((h) => typeof h.object.userData.flexFloor === 'number')
    return hit ? hit.object.userData.flexFloor : -1
  }

  // ------------------------------------------------------------------ walking rings (Urban scale)
  onWalkRing: (band: number) => void = () => {}
  private walk: {
    group: THREE.Group; c: [number, number]; radii: number[]; colours: string[]
    bands: THREE.Mesh[]; edges: THREE.Mesh[]; pulse: THREE.Mesh; labels: HTMLElement[]
    selected: number; hover: number; t0: number; at: number
  } | null = null

  /** The site's centre in plan coordinates (the middle of the study buildings' extent). */
  siteCenter(): [number, number] { return [this.center.x, this.center.y] }

  /** Rings of walking distance around the site centre: a tinted band per ring (clickable, onWalkRing), a bold edge,
   *  a label button on each edge, and a slow pulse travelling outwards. `selected` lifts one band. null removes them. */
  setWalkRings(w: { center: [number, number]; rings: { r: number; label: string; colour: string }[]; selected: number | null } | null) {
    this.invalidate()
    if (this.walk && (!w || w.rings.map((r) => r.r).join() !== this.walk.radii.join() || w.rings.map((r) => r.label).join() !== this.walk.labels.map((l) => l.textContent).join())) {
      this.walk.labels.forEach((l) => l.remove())
      this.walk.group.parent?.remove(this.walk.group)
      disposeTree(this.walk.group)
      this.walk = null
    }
    if (!w) return
    if (this.walk) { this.walk.selected = w.selected ?? -1; this.walkPaint(); return }
    const group = new THREE.Group()
    group.renderOrder = 2
    const [cx, cy] = w.center
    const bands: THREE.Mesh[] = []
    const edges: THREE.Mesh[] = []
    const labels: HTMLElement[] = []
    w.rings.forEach((ring, i) => {
      const r0 = i ? w.rings[i - 1].r : 0
      const band = new THREE.Mesh(new THREE.RingGeometry(Math.max(0.01, r0), ring.r, 160, 1),
        new THREE.MeshBasicMaterial({ color: ring.colour, transparent: true, opacity: 0.1, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }))
      band.position.set(cx, cy, 0.4)
      group.add(band)
      bands.push(band)
      const ew = 1.6 + ring.r * 0.004
      const edge = new THREE.Mesh(new THREE.RingGeometry(ring.r - ew, ring.r + ew, 200, 1),
        new THREE.MeshBasicMaterial({ color: ring.colour, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false }))
      edge.position.set(cx, cy, 0.6)
      group.add(edge)
      edges.push(edge)
      // a dashed inner halo, for the hand-drawn feel of the rest of the explorer
      const dash = new THREE.Mesh(new THREE.RingGeometry(ring.r - 7, ring.r - 5.5, 160, 1, 0, Math.PI * 2),
        new THREE.MeshBasicMaterial({ color: '#202020', transparent: true, opacity: 0.35, depthWrite: false }))
      dash.position.set(cx, cy, 0.55)
      group.add(dash)
      // the label button sits on the edge, towards the south-east, staggered so they don't stack
      const el = document.createElement('button')
      el.type = 'button'
      el.className = 'walk-label'
      el.style.setProperty('--c', ring.colour)
      el.style.setProperty('--t', inkOn(ring.colour))
      el.textContent = ring.label
      el.addEventListener('pointerdown', (e) => e.stopPropagation())
      el.addEventListener('click', (e) => { e.stopPropagation(); this.onWalkRing(i) })
      const a = -Math.PI / 4 - i * 0.22
      const o = new CSS2DObject(el)
      o.position.set(cx + Math.cos(a) * ring.r, cy + Math.sin(a) * ring.r, 2)
      group.add(o)
      labels.push(el)
    })
    const outer = w.rings[w.rings.length - 1].r
    const pulse = new THREE.Mesh(new THREE.RingGeometry(0.985, 1, 160, 1),
      new THREE.MeshBasicMaterial({ color: '#fffdf6', transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false }))
    pulse.position.set(cx, cy, 0.5)
    pulse.userData.outer = outer
    group.add(pulse)
    this.world.add(group)
    const now = performance.now()
    this.walk = { group, c: [cx, cy], radii: w.rings.map((r) => r.r), colours: w.rings.map((r) => r.colour), bands, edges, pulse, labels,
      selected: w.selected ?? -1, hover: -1, t0: now, at: 0 }
    this.walkPaint()
  }

  private walkPaint() {
    const W = this.walk
    if (!W) return
    W.bands.forEach((b, i) => { (b.material as THREE.MeshBasicMaterial).opacity = i === W.selected ? 0.32 : i === W.hover ? 0.2 : 0.09 })
    W.edges.forEach((e, i) => { e.scale.setScalar(1); (e.material as THREE.MeshBasicMaterial).opacity = W.selected < 0 || i === W.selected ? 0.95 : 0.45 })
    W.labels.forEach((l, i) => l.classList.toggle('on', i === W.selected))
    this.invalidate()
  }

  /** Which band a pointer is over (ground plane), or -1. */
  private walkBand(e: PointerEvent): number {
    const W = this.walk
    if (!W) return -1
    const r = this.renderer.domElement.getBoundingClientRect()
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    this.ray.setFromCamera(this.pointer, this.camera)
    const hit = this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3())
    if (!hit) return -1
    // three (x, y, z) → plan: x + cx, cy − z
    const px = hit.x + this.center.x, py = this.center.y - hit.z
    const d = Math.hypot(px - W.c[0], py - W.c[1])
    return W.radii.findIndex((rr) => d <= rr)
  }

  private walkStep() {
    const W = this.walk!
    const now = performance.now()
    if (now - W.at < 33) return   // ~30 fps is plenty for the pulse
    W.at = now
    const outer = W.pulse.userData.outer as number
    const k = ((now - W.t0) / 4200) % 1           // one sweep every 4.2 s
    const r = Math.max(1, outer * k)
    W.pulse.scale.setScalar(r)
    ;(W.pulse.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - k) * Math.min(1, k * 8)
    this.dirty = Math.max(this.dirty, 1)
  }

  // ------------------------------------------------------------------ rented / vacant: a dusk tour around the buildings
  private sunReq: [number, number] = [30, 200]
  // ------------------------------------------------------------------ seasons & hours (viewer/seasonShow.ts)
  private season: SeasonShow | null = null
  private seasonAt = 0
  private seasonOrbit = 0          // rad/s; 0 = still
  private orbitHoldUntil = 0
  /** Circle the view round the site while the seasons show runs (speed in rad/s, 0 to stop). */
  setSeasonOrbit(speed: number) { this.seasonOrbit = speed; this.orbitHoldUntil = 0; this.invalidate() }
  private nightK = 0
  private seasonSun: [number, number] | null = null
  private ctxData: UrbanContext | null = null
  private ctxGround: Ground | null = null
  private ctxCentre: [number, number] = [0, 0]

  /** Start (or end, with null) the seasons show: the study buildings open to their ground-floor plans, the outdoor
   *  places set up for each season, weather, crowds and lights. Drive it with setSeasonClock. */
  setSeasonShow(d: { floors: FloorPayload[]; amenities: Amenity[] } | null) {
    this.invalidate()
    if (this.season) {
      this.season.dispose()
      this.season = null
      this.nightK = 0
      this.buildingsGroup.visible = true
      if (this.seasonSun) { this.sunReq = this.seasonSun; this.seasonSun = null }
      this.applySky(true)
    }
    if (!d || !this.ctxData || !this.ctxGround) return
    this.seasonSun = [...this.sunReq] as [number, number]
    const show = new SeasonShow({ ...d, ctx: this.ctxData, ground: this.ctxGround, centre: this.ctxCentre, labels: true }, this.ctxGroup)
    const heights: Record<string, number> = {}
    for (const [id, bv] of this.buildings) heights[id] = (bv.payload.floors.at(-1)?.z ?? 0) + (bv.payload.floors.at(-1)?.height ?? 0)
    show.setEnvelopes(heights)
    this.world.add(show.group)
    this.season = show
    this.buildingsGroup.visible = false
    this.frameSite(true)
  }
  /** The show's clock: season 0–3 (spring … winter), hour 0–30 (past 24 is the next morning). */
  setSeasonClock(season: number, hour: number, labels = true) {
    if (!this.season) return
    const sp = sunAt(season, hour % 24)
    this.nightK = nightOf(season, hour % 24)
    this.sunReq = [sp.altitude, sp.azimuth]
    this.applySky(false)
    this.season.setClock(season, hour, labels)
    this.invalidate()
  }

  private tour: {
    group: THREE.Group; meshes: THREE.InstancedMesh[]
    spaces: { mesh: THREE.InstancedMesh; idx: number[]; on: number; level: number; delay: number; building: string; lease: string | null }[]
    labels: Map<string, HTMLElement>
    t0: number; at: number; hold: boolean; resumeAt: number; speed: number
  } | null = null

  /** Rented / vacant at district or building scale: every building's windows grouped into example spaces (a run
   *  of neighbouring windows on one floor and facade), each dealt to one of the building's lettable spaces from the
   *  lease book by its share of the area; the sky drops to dusk, and the camera circles slowly — the site, or the one
   *  building in focus. Dragging pauses the circling; it picks up again a few seconds after. Which spaces are lit
   *  (rented) or dark (vacant) comes from setTenancyOccupancy, so playing the years only fades windows, never rebuilds.
   *  null ends the tour and puts the daylight back. */
  setTenancyTour(t: { lettable: Record<string, { id: string; share: number }[]>; focus?: string | null } | null) {
    this.invalidate()
    if (this.tour) {
      for (const m of this.tour.meshes) { m.parent?.remove(m); m.geometry.dispose() }
      this.tour.group.children.forEach((c) => (c as CSS2DObject).element?.remove())
      this.tour.group.parent?.remove(this.tour.group)
      this.tour = null
      if (!t) { this.duskTarget = 0; this.invalidate(); return }   // the morning comes back, gradually
    }
    if (!t) return
    let seed = 20261028
    const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
    const labels = new Map<string, HTMLElement>()
    const group = new THREE.Group()
    this.world.add(group)
    const plane = new THREE.PlaneGeometry(1, 1)
    const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
    const meshes: THREE.InstancedMesh[] = []
    const spaces: NonNullable<Viewer['tour']>['spaces'] = []
    const ids = t.focus ? [t.focus] : Object.keys(t.lettable)
    const m4 = new THREE.Matrix4()
    const box = new THREE.Box3()
    for (const id of ids) {
      const bv = this.buildings.get(id)
      if (!bv) continue
      box.expandByObject(bv.group)
      // windows → floors → facades → runs of neighbours (one example space each)
      const byFloor = new Map<number, number[][]>()
      for (const w of bv.payload.windows) {
        if (w[6]) continue                                  // doors stay as they are
        const zc = (w[4] + w[5]) / 2
        const fi = bv.payload.floors.findIndex((f) => zc >= f.z && zc < f.z + f.height)
        if (fi < 0 || !bv.floors[fi]) continue
        byFloor.set(fi, [...(byFloor.get(fi) ?? []), w])
      }
      for (const [fi, ws] of byFloor) {
        const f = bv.payload.floors[fi]
        const ring = f.rings[0]
        const inside = (x: number, y: number) => {
          let c = false
          for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const [xi, yi] = ring[i], [xj, yj] = ring[j]
            if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
          }
          return c
        }
        const facades = new Map<string, { s: number; w: number[]; u: [number, number]; n: [number, number] }[]>()
        for (const w of ws) {
          const [ax, ay, bx, by] = w
          const len = Math.hypot(bx - ax, by - ay)
          if (len < 0.2) continue
          const u: [number, number] = [(bx - ax) / len, (by - ay) / len]
          let n: [number, number] = [-u[1], u[0]]
          const mx = (ax + bx) / 2, my = (ay + by) / 2
          if (inside(mx + n[0] * 0.6, my + n[1] * 0.6)) n = [-n[0], -n[1]]   // outward
          const ang = Math.round(((Math.atan2(n[1], n[0]) * 180) / Math.PI) / 10)
          const off = Math.round((mx * n[0] + my * n[1]) / 1.5)
          const key = `${ang}:${off}`
          facades.set(key, [...(facades.get(key) ?? []), { s: mx * -n[1] + my * n[0], w, u, n }])
        }
        const idxOf: number[][] = []
        const all: { w: number[]; u: [number, number]; n: [number, number] }[] = []
        for (const list of facades.values()) {
          list.sort((a, b) => a.s - b.s)
          let run: number[] = [], start = -1e9, last = -1e9
          const span = 7 + rng() * 6                         // spaces 7–13 m along the facade
          for (const it of list) {
            if (run.length && (it.s - last > 2.6 || it.s - start > span)) { idxOf.push(run); run = [] }
            if (!run.length) start = it.s
            run.push(all.length)
            all.push(it)
            last = it.s
          }
          if (run.length) idxOf.push(run)
        }
        if (!all.length) continue
        const im = new THREE.InstancedMesh(plane, mat, all.length)
        all.forEach(({ w, u, n }, i) => {
          const [ax, ay, bx, by, z0, z1] = w
          const len = Math.hypot(bx - ax, by - ay) * 0.86, h = (z1 - z0) * 0.86
          m4.makeBasis(new THREE.Vector3(u[0] * len, u[1] * len, 0), new THREE.Vector3(0, 0, h), new THREE.Vector3(n[0], n[1], 0))
          m4.setPosition((ax + bx) / 2 + n[0] * 0.065, (ay + by) / 2 + n[1] * 0.065, (z0 + z1) / 2)
          im.setMatrixAt(i, m4)
          im.setColorAt(i, TOUR_DARK)
        })
        im.instanceMatrix.needsUpdate = true
        im.userData = { tour: true }
        bv.floors[fi].add(im)
        meshes.push(im)
        // which of this floor's spaces are rented: the building's share, at random
        for (const idx of idxOf) spaces.push({ mesh: im, idx, on: 0, level: 0, delay: 0, building: id, lease: null })
      }
      // deal the example spaces, in random order, to the building's lettable spaces by their share of the area
      const mine = spaces.filter((sp) => sp.building === id)
      const order = mine.map((sp) => ({ sp, r: rng() })).sort((a, b) => a.r - b.r).map((x) => x.sp)
      const lets = t.lettable[id] ?? []
      const total = lets.reduce((a, l) => a + l.share, 0) || 1
      order.forEach((sp, k) => {
        let acc = 0
        const pos = ((k + 0.5) / order.length) * total
        sp.lease = lets.find((l) => (acc += l.share) >= pos)?.id ?? lets[lets.length - 1]?.id ?? null
        sp.delay = DUSK_MS * 0.55 + rng() * 2600   // lights come on one by one, as the evening falls
      })
      {
        const bb = new THREE.Box3().setFromObject(bv.group)
        const el = document.createElement('div')
        el.className = 'studio-label layer tour'
        labels.set(id, el)
        const o = new CSS2DObject(el)
        // world group is rotated: back to plan coordinates for the label's position
        const c = bb.getCenter(new THREE.Vector3())
        o.position.set(c.x + this.center.x, -c.z + this.center.y, bb.max.y + 4)
        group.add(o)
      }
    }
    const now = performance.now()
    this.tour = { group, meshes, spaces, labels, t0: now, at: now, hold: false, resumeAt: 0, speed: t.focus ? 0.16 : 0.08 }
    this.duskTarget = 1   // evening falls (stepDusk, in the render loop)
    this.invalidate()
    if (!box.isEmpty()) this.flyToBox(box, t.focus ? 1.4 : 0.95, 0.38)
  }

  /** Which lettable spaces are rented now (lease space id → rented), and each building's label. Windows fade. */
  setTenancyOccupancy(rented: Record<string, boolean>, labels?: Record<string, string>) {
    const T = this.tour
    if (!T) return
    for (const s of T.spaces) s.on = s.lease && rented[s.lease] ? 1 : 0
    for (const [id, el] of T.labels) { el.textContent = labels?.[id] ?? ''; el.style.display = labels?.[id] ? '' : 'none' }
    this.invalidate()
  }

  private tourStep() {
    const T = this.tour!
    const now = performance.now()
    const dt = Math.min(0.05, (now - T.at) / 1000)
    T.at = now
    if (T.hold && T.resumeAt && now > T.resumeAt) { T.hold = false; T.resumeAt = 0 }
    if (!T.hold && !this.anim) {
      // circle the orbit target, keeping the distance and height the view has
      const tgt = this.controls.target
      const off = this.camera.position.clone().sub(tgt)
      off.applyAxisAngle(new THREE.Vector3(0, 1, 0), T.speed * dt)
      this.camera.position.copy(tgt).add(off)
      this.dirty = Math.max(this.dirty, 1)
    }
    let changed = false
    const since = now - T.t0
    const col = new THREE.Color()
    for (const s of T.spaces) {
      const target = since > s.delay ? s.on : 0
      if (Math.abs(s.level - target) < 0.004) continue
      s.level += Math.sign(target - s.level) * Math.min(Math.abs(target - s.level), dt * 2.2)
      col.copy(TOUR_DARK).lerp(TOUR_LIT, s.level)
      for (const i of s.idx) s.mesh.setColorAt(i, col)
      s.mesh.instanceColor!.needsUpdate = true
      changed = true
    }
    if (changed) this.dirty = Math.max(this.dirty, 1)
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
    id?: string; icon?: string; badge?: string; dim?: boolean
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
      el.className = `lp lp-${p.kind}${this.lifeSeen.has(id) ? '' : ' enter'}${p.dim ? ' lp-dim' : ''}`
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
