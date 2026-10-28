import * as THREE from 'three'
import { isToon } from './toon'

// Årstaviken's surface: a standard material with moving ripples bent into its normal (so it catches the sky's
// reflection in shifting patches), slow drifting colour patches and sun glints, all fading out with distance so
// the far water stays calm instead of shimmering. One shared clock (waterTime) drives every water material.

export const waterTime = { value: 0 }

const VERT_DECL = /* glsl */ `
  varying vec2 vPlan;
  varying vec3 vTx;
  varying vec3 vTy;`

const FRAG_DECL = /* glsl */ `
  uniform float uTime;
  uniform float uWaves;
  varying vec2 vPlan;
  varying vec3 vTx;
  varying vec3 vTy;
  float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float wNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), u.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  // slope (dh/dx, dh/dy) of a few directional waves: direction, wavelength (m), amplitude (m), speed (m/s)
  vec2 wSlope(vec2 p, float t, float dist) {
    vec2 g = vec2(0.0);
    vec4 W[6];
    W[0] = vec4(normalize(vec2(1.0, 0.35)), 11.0, 0.06);
    W[1] = vec4(normalize(vec2(-0.45, 1.0)), 6.3, 0.04);
    W[2] = vec4(normalize(vec2(0.75, -0.8)), 3.7, 0.025);
    W[3] = vec4(normalize(vec2(-1.0, -0.25)), 2.1, 0.014);
    W[4] = vec4(normalize(vec2(0.25, 1.0)), 1.3, 0.009);
    W[5] = vec4(normalize(vec2(0.9, 0.6)), 0.8, 0.005);
    for (int i = 0; i < 6; i++) {
      float k = 6.2832 / W[i].z;
      float speed = 0.45 * sqrt(W[i].z);
      float near = 1.0 - smoothstep(W[i].z * 18.0, W[i].z * 55.0, dist);   // each wave fades once it gets too fine to draw
      g += W[i].xy * (W[i].w * k * near * cos(dot(W[i].xy, p) * k + t * speed * k));
    }
    return g;
  }`

/** Water with ripples and glints; `colour` is its deep colour (the shallow and foam bands use other colours). */
export function waterMaterial(colour: string, waves = 1) {
  const m = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.14, metalness: 0, envMapIntensity: 1.25 })
  m.onBeforeCompile = (shader) => {
    if (isToon()) shader.fragmentShader = '#define TOON\n' + shader.fragmentShader
    shader.uniforms.uTime = waterTime
    shader.uniforms.uWaves = { value: waves }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_DECL)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vPlan = transformed.xy;
        vTx = normalize(normalMatrix * vec3(1.0, 0.0, 0.0));
        vTy = normalize(normalMatrix * vec3(0.0, 1.0, 0.0));`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_DECL)
      // slow, large patches of lighter and darker water, drifting with the wind
      .replace('#include <color_fragment>', `#include <color_fragment>
        float wPatch = wNoise(vPlan / 45.0 + vec2(uTime * 0.012, uTime * 0.006)) * 0.6 + wNoise(vPlan / 13.0 - uTime * 0.02) * 0.4;
        diffuseColor.rgb *= 0.86 + 0.28 * wPatch;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        float wDist = length(vViewPosition);
        float wFade = uWaves * (1.0 - smoothstep(180.0, 1400.0, wDist));
        vec2 s = wSlope(vPlan, uTime, wDist) * wFade;
        normal = normalize(normal - s.x * vTx - s.y * vTy);`)
      // sun glints: the sun's reflection off each ripple, crisp little sparkles in the toon look
      .replace('#include <opaque_fragment>', `
        #if NUM_DIR_LIGHTS > 0
          vec3 wR = reflect(-normalize(vViewPosition), normal);
          float wG = pow(max(dot(wR, directionalLights[0].direction), 0.0), 300.0);
          #ifdef TOON
            wG = smoothstep(0.35, 0.5, wG);
          #endif
          outgoingLight += directionalLights[0].color * wG * 1.6 * (1.0 - smoothstep(250.0, 1600.0, wDist));
        #endif
        #include <opaque_fragment>`)
  }
  m.customProgramCacheKey = () => 'water' + (isToon() ? '-toon' : '')
  return m
}
