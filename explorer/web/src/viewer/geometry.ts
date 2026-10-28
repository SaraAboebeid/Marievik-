import * as THREE from 'three'
import type { Detail, Ring } from '../types'

// Everything is built in plan coordinates (x east, y north, z up) inside a world group that the
// viewer rotates -90 degrees about X, so three.js sees (x, z, -y) with y up.

export function shapeFromRings(rings: Ring[]): THREE.Shape | null {
  if (!rings.length || rings[0].length < 3) return null
  const outer = rings[0]
  const shape = new THREE.Shape(outer.map(([x, y]) => new THREE.Vector2(x, y)))
  for (const h of rings.slice(1)) {
    if (h.length >= 3) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))))
  }
  return shape
}

/** A vertical prism from z0 to z1 (plan rings: outer first, then holes). */
export function prism(rings: Ring[], z0: number, z1: number): THREE.BufferGeometry | null {
  const s = shapeFromRings(rings)
  if (!s) return null
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.01, z1 - z0), bevelEnabled: false, curveSegments: 1 })
  g.translate(0, 0, z0)
  return g
}

/** Rings pushed out by d metres (holes shrink), mitred at the corners. For thin trims that must sit just proud of a
 *  wall: with the logarithmic depth buffer, polygonOffset does nothing, so coplanar faces z-fight. */
export function inflate(rings: Ring[], d: number, keep?: (x: number, y: number) => boolean): Ring[] {
  const area = (r: Ring) => r.reduce((s, [x, y], i) => { const [u, v] = r[(i + 1) % r.length]; return s + x * v - u * y }, 0)
  const sign = rings.length && area(rings[0]) < 0 ? -1 : 1   // outer CCW: the right-hand normal points out
  return rings.map((r) => r.map(([x, y], i) => {
    if (keep?.(x, y)) return [x, y] as [number, number]   // e.g. points on a clip edge, which isn't a real shore
    const [px, py] = r[(i - 1 + r.length) % r.length], [nx, ny] = r[(i + 1) % r.length]
    const n1 = norm(y - py, px - x), n2 = norm(ny - y, x - nx)
    const bx = n1[0] + n2[0], by = n1[1] + n2[1]
    const k = Math.max(0.3, (bx * n1[0] + by * n1[1]))   // miter, capped at sharp corners
    return [x + sign * d * bx / k, y + sign * d * by / k] as [number, number]
  }))
}
function norm(x: number, y: number): [number, number] {
  const l = Math.hypot(x, y) || 1
  return [x / l, y / l]
}

/** A flat face at height z (used for unit fills and slabs seen from above). */
export function flat(rings: Ring[], z: number): THREE.BufferGeometry | null {
  const s = shapeFromRings(rings)
  if (!s) return null
  const g = new THREE.ShapeGeometry(s, 1)
  g.translate(0, 0, z)
  return g
}

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()
const _z = new THREE.Vector3(0, 0, 1)

/** Matrix for a unit box (centred at the origin) stretched between two plan points. */
export function segmentBox(ax: number, ay: number, bx: number, by: number, z0: number, z1: number, depth: number, out = _m) {
  const dx = bx - ax
  const dy = by - ay
  const len = Math.hypot(dx, dy)
  _q.setFromAxisAngle(_z, Math.atan2(dy, dx))
  _p.set((ax + bx) / 2, (ay + by) / 2, (z0 + z1) / 2)
  _s.set(Math.max(len, 0.01), depth, Math.max(0.01, z1 - z0))
  return out.compose(_p, _q, _s)
}

/** Matrix for a box in a wall's local frame: origin o, unit vector u, s along u, t across (left normal). */
export function localBox(o: [number, number], u: [number, number], s0: number, s1: number, t0: number, t1: number,
  z0: number, z1: number, out = _m) {
  const sc = (s0 + s1) / 2
  const tc = (t0 + t1) / 2
  const vx = -u[1]
  const vy = u[0]
  _q.setFromAxisAngle(_z, Math.atan2(u[1], u[0]))
  _p.set(o[0] + u[0] * sc + vx * tc, o[1] + u[1] * sc + vy * tc, (z0 + z1) / 2)
  _s.set(Math.max(0.01, Math.abs(s1 - s0)), Math.max(0.01, Math.abs(t1 - t0)), Math.max(0.01, z1 - z0))
  return out.compose(_p, _q, _s)
}

export const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1)

/** Geometry for a facade / roof descriptor from mvk.facade. */
export function detailGeometry(d: Detail): THREE.BufferGeometry | null {
  if (d.k === 'prism') return prism(d.rings, d.z0, d.z1)
  if (d.k === 'box') {
    const g = UNIT_BOX.clone()
    g.applyMatrix4(localBox(d.o, d.u, d.s[0], d.s[1], d.t[0], d.t[1], d.z[0], d.z[1], new THREE.Matrix4()))
    return g
  }
  if (d.k === 'vault') {
    // half-barrel across the width, extruded along u
    const w = d.width / 2
    const shape = new THREE.Shape()
    shape.moveTo(-w, 0)
    const n = 16
    for (let i = 0; i <= n; i++) {
      const a = Math.PI - (Math.PI * i) / n
      shape.lineTo(Math.cos(a) * w, (Math.sin(a) * d.rise))
    }
    shape.lineTo(-w, 0)
    const g = new THREE.ExtrudeGeometry(shape, { depth: d.length, bevelEnabled: false, curveSegments: 12 })
    // shape plane: x across (v), y up (z); extrusion along +z -> along u
    const vx = -d.u[1]
    const vy = d.u[0]
    const m = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(vx, vy, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(d.u[0], d.u[1], 0),
    )
    m.setPosition(d.o[0], d.o[1], d.z0)
    g.applyMatrix4(m)
    return g
  }
  return null
}

export function disposeTree(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh
    if (m.geometry && m.geometry !== UNIT_BOX) m.geometry.dispose()
    const mat = (m as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
    else if (mat && !(mat as THREE.Material & { userData: { shared?: boolean } }).userData?.shared) mat.dispose()
  })
}
