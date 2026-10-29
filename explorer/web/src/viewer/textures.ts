import * as THREE from 'three'

// Small canvas textures for the model-maker's finish (the physical Marievik model at AMF's pavilion): speckled
// paving and flocked grass on the ground, timber decks, sedum roofs, and the facade tiles for the neighbouring
// blocks with their framed, lit windows and glazed shopfronts. All world-scaled: UVs are metres (plan x, y on flat
// faces; along the wall and up on walls), so `repeat` is 1 / the tile size in metres.

let seed = 1
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }

function canvas(w: number, h = w) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d')!] as const
}
/** `wall`: for the side walls of an ExtrudeGeometry, whose UVs run v = 1 - height; flipped back so the canvas
 *  reads the right way up and its bottom edge sits at the foot of the wall. */
function tex(c: HTMLCanvasElement, metresX: number, metresY = metresX, srgb = true, wall = false) {
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(1 / metresX, (wall ? -1 : 1) / metresY)
  if (wall) t.offset.set(0, 1 / metresY)
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}
const cache = new Map<string, THREE.Texture>()
const once = (k: string, make: () => THREE.Texture) => { if (!cache.has(k)) cache.set(k, make()); return cache.get(k)! }

/** Light speckle on a near-white base (multiplies the material colour): paving, plazas, the ground. */
export function speckle(metres = 6, contrast = 0.1, joints = 0) {
  return once(`speckle${metres}:${contrast}:${joints}`, () => {
    seed = 11
    const [c, x] = canvas(256)
    x.fillStyle = '#f4f4f4'
    x.fillRect(0, 0, 256, 256)
    for (let i = 0; i < 5200; i++) {
      const v = Math.round(244 + (rnd() - 0.5) * 2 * 255 * contrast)
      x.fillStyle = `rgb(${v},${v},${v})`
      const s = rnd() < 0.85 ? 1 : 2
      x.fillRect(Math.floor(rnd() * 256), Math.floor(rnd() * 256), s, s)
    }
    if (joints) {   // paving joints, `joints` slabs across the tile
      x.strokeStyle = 'rgba(0,0,0,0.07)'
      x.lineWidth = 1
      const st = 256 / joints
      for (let i = 0; i <= joints; i++) {
        x.beginPath(); x.moveTo(0, i * st + 0.5); x.lineTo(256, i * st + 0.5); x.stroke()
        for (let j = 0; j <= joints; j++) {
          const off = (i % 2) * st / 2
          x.beginPath(); x.moveTo(j * st + off + 0.5, i * st); x.lineTo(j * st + off + 0.5, (i + 1) * st); x.stroke()
        }
      }
    }
    return tex(c, metres)
  })
}

/** Flocked grass: tufts of lighter and darker green over white (the material colour sets the green). */
export function flock(metres = 5) {
  return once(`flock${metres}`, () => {
    seed = 23
    const [c, x] = canvas(256)
    x.fillStyle = '#eef0e6'
    x.fillRect(0, 0, 256, 256)
    for (let i = 0; i < 9000; i++) {
      const k = rnd()
      x.fillStyle = k < 0.45 ? 'rgba(255,255,230,0.55)' : k < 0.85 ? 'rgba(60,80,30,0.22)' : 'rgba(255,240,170,0.5)'
      const s = 1 + Math.floor(rnd() * 2.2)
      x.fillRect(Math.floor(rnd() * 256), Math.floor(rnd() * 256), s, s)
    }
    return tex(c, metres)
  })
}

/** Sedum and meadow roofs: olive, ochre and rust specks, the dried-moss look of the model's green roofs. */
export function sedum(metres = 4) {
  return once(`sedum${metres}`, () => {
    seed = 31
    const [c, x] = canvas(256)
    x.fillStyle = '#e8e2c6'
    x.fillRect(0, 0, 256, 256)
    const cols = ['rgba(120,130,60,0.6)', 'rgba(170,140,70,0.55)', 'rgba(150,90,60,0.4)', 'rgba(90,110,50,0.6)', 'rgba(230,220,170,0.6)']
    for (let i = 0; i < 12000; i++) {
      x.fillStyle = cols[Math.floor(rnd() * cols.length)]
      const s = 1 + Math.floor(rnd() * 2.5)
      x.fillRect(Math.floor(rnd() * 256), Math.floor(rnd() * 256), s, s)
    }
    return tex(c, metres)
  })
}

/** Timber decking: planks along x, 0.15 m wide, with joints and a little grain. */
export function planks(metres = 3) {
  return once(`planks${metres}`, () => {
    seed = 41
    const [c, x] = canvas(256)
    const n = Math.round(metres / 0.15)
    const ph = 256 / n
    for (let i = 0; i < n; i++) {
      const v = 236 + Math.round((rnd() - 0.5) * 22)
      x.fillStyle = `rgb(${v},${v - 6},${v - 18})`
      x.fillRect(0, i * ph, 256, ph)
      x.fillStyle = 'rgba(90,60,30,0.25)'
      x.fillRect(0, i * ph, 256, 1)
      const j = rnd() * 256   // a butt joint per plank
      x.fillRect(j, i * ph, 1, ph)
    }
    return tex(c, metres)
  })
}

/** PV modules: dark cells in a light frame grid, 1 x 1.7 m panels. */
export function pvCells() {
  return once('pv', () => {
    const [c, x] = canvas(128, 256)
    x.fillStyle = '#c8ccd2'
    x.fillRect(0, 0, 128, 256)
    x.fillStyle = '#ffffff'
    for (let i = 0; i < 6; i++) for (let j = 0; j < 10; j++) x.fillRect(4 + i * 20.5, 4 + j * 25, 18, 22)
    return tex(c, 1, 1.7)
  })
}

// ------------------------------------------------------------------ facades for the neighbouring blocks
// One tile is 4 bays (2.8 m) by 4 storeys (3.1 m). Diffuse: wall white (the vertex colour tints it), frames light,
// glass grey-blue with a sill under each window. Emissive: the windows that are lit, warm and a few pastel, as in
// the model where every block is lit from inside.
const BAY = 2.8, STOREY = 3.1, NB = 4, NS = 4
const LIT = ['#ffe3b0', '#ffe9c4', '#fff2d6', '#ffd9a0', '#ffd2c8', '#d8f1dc', '#fff3a6', '#dfe9ff']
export function facadeTiles() {
  const d = cache.get('facade:d')
  if (d) return { map: d, emissive: cache.get('facade:e')! }
  seed = 57
  const S = 64   // px per bay / storey
  const [cd, xd] = canvas(S * NB, S * NS)
  const [ce, xe] = canvas(S * NB, S * NS)
  xd.fillStyle = '#ffffff'
  xd.fillRect(0, 0, S * NB, S * NS)
  xe.fillStyle = '#000000'
  xe.fillRect(0, 0, S * NB, S * NS)
  for (let b = 0; b < NB; b++) {
    for (let s = 0; s < NS; s++) {
      const x0 = b * S + 17, y0 = s * S + 15, w = 30, h = 34
      // a faint slab line per storey
      xd.fillStyle = 'rgba(0,0,0,0.05)'
      xd.fillRect(b * S, s * S + S - 3, S, 2)
      xd.fillStyle = '#d6d6d2'                                  // reveal / frame
      xd.fillRect(x0 - 3, y0 - 3, w + 6, h + 6)
      const lit = rnd() < 0.62
      const g = lit ? 150 + Math.round(rnd() * 30) : 92 + Math.round(rnd() * 25)
      xd.fillStyle = `rgb(${g - 8},${g + 2},${g + 12})`             // glass
      xd.fillRect(x0, y0, w, h)
      xd.fillStyle = 'rgba(255,255,255,0.25)'                     // sky glint on the upper pane
      xd.fillRect(x0, y0, w, 4)
      xd.fillStyle = '#e6e6e2'                                   // mullion and transom
      xd.fillRect(x0 + w / 2 - 1, y0, 2, h)
      xd.fillRect(x0, y0 + 10, w, 2)
      xd.fillStyle = '#efefec'                                   // sill
      xd.fillRect(x0 - 4, y0 + h + 2, w + 8, 3)
      if (lit) {
        xe.fillStyle = LIT[Math.floor(rnd() * LIT.length)]
        xe.fillRect(x0, y0, w, h)
        xe.fillStyle = '#000000'
        xe.fillRect(x0 + w / 2 - 1, y0, 2, h)
        xe.fillRect(x0, y0 + 10, w, 2)
        if (rnd() < 0.3) {   // a blind half down
          xe.fillStyle = 'rgba(0,0,0,0.55)'
          xe.fillRect(x0, y0, w, 6 + rnd() * 12)
        }
      }
    }
  }
  const map = tex(cd, BAY * NB, STOREY * NS, true, true)
  const emissive = tex(ce, BAY * NB, STOREY * NS, true, true)
  cache.set('facade:d', map)
  cache.set('facade:e', emissive)
  return { map, emissive }
}

/** Shopfronts for the ground floor: tall glazing in dark frames, 4.2 m bays, 3.6 m high, the upper third a fascia. */
export const SHOP_H = 3.6
export function shopTiles() {
  const d = cache.get('shop:d')
  if (d) return { map: d, emissive: cache.get('shop:e')! }
  seed = 77
  const W = 256, H = 110
  const [cd, xd] = canvas(W, H)
  const [ce, xe] = canvas(W, H)
  xd.fillStyle = '#3c3f42'
  xd.fillRect(0, 0, W, H)
  xe.fillStyle = '#000'
  xe.fillRect(0, 0, W, H)
  const bays = 2
  for (let b = 0; b < bays; b++) {
    const x0 = b * (W / bays) + 5, w = W / bays - 10
    xd.fillStyle = '#9fb1b8'
    xd.fillRect(x0, 22, w, H - 26)
    xd.fillStyle = '#3c3f42'
    xd.fillRect(x0 + w * 0.62, 22, 3, H - 26)                   // door mullion
    xd.fillStyle = 'rgba(255,255,255,0.3)'
    xd.fillRect(x0, 22, w, 5)
    const k = rnd()
    xe.fillStyle = k < 0.7 ? '#ffe2b0' : k < 0.85 ? '#ffd5c8' : '#e2f3d8'
    xe.fillRect(x0, 22, w, H - 26)
    xe.fillStyle = '#000'
    xe.fillRect(x0 + w * 0.62, 22, 3, H - 26)
    // a little sign on the fascia
    xd.fillStyle = ['#d8c27a', '#c7564b', '#e9e5da', '#5f7f6a'][Math.floor(rnd() * 4)]
    xd.fillRect(x0 + w * 0.2, 7, w * 0.45, 9)
  }
  const map = tex(cd, 4.2 * bays, SHOP_H, true, true)
  const emissive = tex(ce, 4.2 * bays, SHOP_H, true, true)
  cache.set('shop:d', map)
  cache.set('shop:e', emissive)
  return { map, emissive }
}

/** Årstaviken's colour by distance from the shore: a pale foam line, shallow green-blue, then the deep. Drawn on a
 *  canvas over the water's bounding box (UVs are plan metres) and clipped to the water, so bands stay in it.
 *  `notShore` marks points that aren't a real shore (the edge of the context's disc, seams between polygons). */
export function shoreBands(rings: [number, number][][][], notShore: (x: number, y: number) => boolean) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const rs of rings) for (const [x, y] of rs[0] ?? []) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
  const W = x1 - x0, H = y1 - y0
  const s = Math.min(1.6, 2048 / Math.max(W, H))            // px per metre
  const [c, x] = canvas(Math.max(4, Math.ceil(W * s)), Math.max(4, Math.ceil(H * s)))
  const P = (px: number, py: number): [number, number] => [(px - x0) * s, (y1 - py) * s]
  x.fillStyle = '#2f5868'
  x.fillRect(0, 0, c.width, c.height)
  const water = new Path2D()
  for (const rs of rings) for (const r of rs) r.forEach((pt, i) => { const [u, v] = P(pt[0], pt[1]); if (i) water.lineTo(u, v); else water.moveTo(u, v) })
  const shore = new Path2D()
  for (const rs of rings) for (const r of rs) {
    for (let i = 0; i < r.length - 1; i++) {
      const a = r[i], b = r[i + 1]
      if (notShore(a[0], a[1]) && notShore(b[0], b[1])) continue
      const [u0, v0] = P(a[0], a[1]), [u1, v1] = P(b[0], b[1])
      shore.moveTo(u0, v0)
      shore.lineTo(u1, v1)
    }
  }
  x.save()
  x.clip(water, 'evenodd')
  x.lineCap = x.lineJoin = 'round'
  for (const [w, col] of [[30, '#3b6772'], [20, '#4a7a80'], [12, '#5b8a90'], [4.6, '#e9f1ef']] as [number, string][]) {
    x.strokeStyle = col
    x.lineWidth = w * s
    x.stroke(shore)
  }
  x.restore()
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
  t.repeat.set(1 / W, 1 / H)
  t.offset.set(-x0 / W, -y0 / H)
  t.anisotropy = 8
  return t
}
