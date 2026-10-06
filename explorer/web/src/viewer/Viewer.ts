import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { Sky } from 'three/examples/jsm/objects/Sky.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import { Rhino3dmLoader } from 'three/examples/jsm/loaders/3DMLoader.js'
import type { BuildingPayload, FloorPayload, Ring, SitePayload, Unit } from '../types'
import { UNIT_BOX, detailGeometry, disposeTree, flat, localBox, prism, segmentBox } from './geometry'
import { dfColor, unitColor } from './colors'

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
}

type Focus =
  | { kind: 'site' }
  | { kind: 'building'; building: string }
  | { kind: 'floor'; building: string; floor: number }
  | { kind: 'unit'; building: string; floor: number; unit: string }

const WALL_COLORS: Record<string, string> = {
  E: '#d9d4ca', C: '#efece6', S: '#cfe0ea', K: '#b9b5ad', P: '#f4f2ee', I: '#f4f2ee', A: '#e8c27a',
}

interface BuildingView {
  group: THREE.Group
  floors: THREE.Group[]
  mats: THREE.Material[]
  payload: BuildingPayload
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
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true })
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
    this.world.add(this.contextGroup, this.buildingsGroup, this.floorGroup, this.analysisGroup, this.labelGroup, this.rhinoGroup)
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
    this.scene.background = this.options.sky ? null : new THREE.Color('#e9ece9')
    this.renderer.shadowMap.enabled = this.options.shadows
    this.sunLight.castShadow = this.options.shadows
    this.scene.traverse((c) => {
      const m = (c as THREE.Mesh).material as THREE.Material | undefined
      if (m) m.needsUpdate = true
    })
    this.labelGroup.visible = this.options.labels
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
    this.contextGroup.add(ground)
    // Årstaviken lies south-east of the blocks: a simple water plane to read the site by
    const water = new THREE.Mesh(new THREE.PlaneGeometry(1600, 700),
      new THREE.MeshStandardMaterial({ color: '#4b6475', roughness: 0.12, metalness: 0.4 }))
    water.position.set(this.center.x + 330, this.center.y - 470, -0.02)
    water.rotation.z = Math.atan2(-0.8, 0.6) + Math.PI / 2
    water.receiveShadow = true
    this.contextGroup.add(water)
    const road = new THREE.LineBasicMaterial({ color: '#8c8f86' })
    for (const r of site.roads) {
      const g = new THREE.BufferGeometry().setFromPoints(r.pts.map(([x, y]) => new THREE.Vector3(x, y, 0.03)))
      this.contextGroup.add(new THREE.Line(g, road))
    }
    this.frameSite(false)
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
    this.buildings.set(p.id, { group, floors, mats, payload: p })
    this.applyFocus(false)
  }

  // ------------------------------------------------------------------ focus levels
  setFocus(f: Focus, animate = true) {
    this.focus = f
    if (f.kind === 'site' || f.kind === 'building') this.clearFloor()
    this.applyFocus(animate)
  }

  private applyFocus(animate: boolean) {
    this.invalidate()
    const f = this.focus
    for (const [id, bv] of this.buildings) {
      const active = f.kind !== 'site' && 'building' in f && f.building === id
      const ghost = f.kind !== 'site' && !active
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
      const explode = active && f.kind === 'building' ? this.options.explode : 0
      bv.floors.forEach((fg, i) => {
        fg.position.z = explode * i
        fg.visible = !(active && (f.kind === 'floor' || f.kind === 'unit')) || i < f.floor
      })
    }
    this.floorGroup.visible = f.kind === 'floor' || f.kind === 'unit'
    this.analysisGroup.visible = this.floorGroup.visible
    this.labelGroup.visible = this.floorGroup.visible && this.options.labels
    if (f.kind === 'unit') this.highlightUnit(f.unit)
    else this.highlightUnit(null)
    if (animate) this.frame()
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
    if (f.kind === 'floor' && this.floor) {
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
  }

  setFloor(fp: FloorPayload, colorFor?: (u: Unit) => string | null) {
    this.invalidate()
    this.clearFloor()
    this.floor = fp
    const g = this.floorGroup
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
      if (!byCat.has(pc[9])) byCat.set(pc[9], [])
      byCat.get(pc[9])!.push(pc)
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
      glassWalls.forEach((w, i) => inst.setMatrixAt(i, segmentBox(w.a[0], w.a[1], w.b[0], w.b[1], fp.base, fp.base + fp.wall_h, 0.03)))
      inst.instanceMatrix.needsUpdate = true
      g.add(inst)
    }
    // openings
    const wins = fp.openings.filter((o) => o.kind === 'window')
    const doors = fp.openings.filter((o) => o.kind === 'door')
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
    // unit fills (pickable) and labels
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
      this.unitMeshes.set(u.id, mesh)
      if (u.kind === 'unit') {
        const el = document.createElement('div')
        el.className = 'unit-label'
        // many small units: area only, so the plan stays readable
        el.textContent = many ? `${Math.round(u.area)}` : `${u.name.replace('Apartment ', '')} · ${Math.round(u.area)} m²`
        const lab = new CSS2DObject(el)
        lab.position.set(u.label[0], u.label[1], fp.base + 1.2)
        this.labelGroup.add(lab)
      }
    }
    this.applyFocus(true)
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
