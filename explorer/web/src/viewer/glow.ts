import * as THREE from 'three'

// Lit windows, as in the physical model where every block is lit from inside. Two kinds of material share one dial:
//  - glass whose per-instance colour is the light behind it (the diffuse stays dark glass; the colour only glows)
//  - facade tiles with an emissive map (viewer/textures.ts facadeTiles, shopTiles)
// The dial (setGlow) follows the sun: a soft glow by day, stronger at dusk; off while a layer paints the windows.

const glowing = new Set<{ mat: THREE.MeshStandardMaterial; base: number }>()
let level = 0.35

export function setGlow(k: number) {
  level = k
  for (const g of glowing) g.mat.emissiveIntensity = g.base * level
}
export const glowLevel = () => level

function register(mat: THREE.MeshStandardMaterial, base: number) {
  const entry = { mat, base }
  glowing.add(entry)
  mat.emissiveIntensity = base * level
  mat.addEventListener('dispose', () => glowing.delete(entry))
  return mat
}

/** Window glass: instance colour = the room light. Black instances stay unlit glass. */
export function glowGlass(base = 1.9, params: THREE.MeshStandardMaterialParameters = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: '#33475a', roughness: 0.16, metalness: 0.5, envMapIntensity: 1.5, emissive: '#ffffff', ...params })
  const proto = THREE.MeshStandardMaterial.prototype
  mat.onBeforeCompile = (shader, renderer) => {
    proto.onBeforeCompile.call(mat, shader, renderer)   // keeps the toon bands (viewer/toon.ts)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_fragment>', '')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n\ttotalEmissiveRadiance *= vColor.rgb;\n#endif')
  }
  mat.customProgramCacheKey = () => proto.customProgramCacheKey.call(mat) + ':glowglass'
  return register(mat, base)
}

/** A facade material with an emissive map of lit windows. */
export function glowFacade(params: THREE.MeshStandardMaterialParameters, base = 0.9) {
  const mat = new THREE.MeshStandardMaterial({ emissive: '#ffffff', ...params })
  return register(mat, base)
}

/** Room lights for one building's windows: mostly warm, some cool and pastel, about one in six dark. */
const ROOMS = ['#ffe6bd', '#ffe6bd', '#ffedcf', '#ffedcf', '#fff4df', '#fff4df', '#ffdcaa', '#ffe6bd', '#ffd6cc', '#dcf3e0', '#fff4b0', '#e2ebff']
export function roomLight(rand: () => number, out: THREE.Color) {
  if (rand() < 0.2) return out.setRGB(0, 0, 0)
  return out.set(ROOMS[Math.floor(rand() * ROOMS.length)])
}
