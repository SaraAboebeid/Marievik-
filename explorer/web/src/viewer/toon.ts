import * as THREE from 'three'

// Toon look for the viewer (trial): sunlight falls in three flat bands instead of a smooth gradient, no
// highlights, and ink outlines drawn from GTAOPass's normal and depth buffers. Switched with ViewOptions.toon.

let toonOn = false

// Every MeshStandardMaterial shares this chunk; the bands only compile in when TOON is defined.
THREE.ShaderChunk.lights_physical_pars_fragment = THREE.ShaderChunk.lights_physical_pars_fragment
  .replace(/(\n\s*)vec3 irradiance = dotNL \* directLight\.color;/,
    '$1#ifdef TOON\n\tdotNL = dotNL < 0.04 ? 0.0 : dotNL < 0.35 ? 0.5 : 1.0;\n\t#endif$1vec3 irradiance = dotNL * directLight.color;')
  .replace(/(\n\s*)(reflectedLight\.directSpecular \+= irradiance \* BRDF_GGX\([^;]*;)/,
    '$1#ifndef TOON$1$2$1#endif')

const proto = THREE.MeshStandardMaterial.prototype
proto.onBeforeCompile = (shader) => { if (toonOn) shader.fragmentShader = '#define TOON\n' + shader.fragmentShader }
proto.customProgramCacheKey = () => (toonOn ? 'toon' : '')

/** GTAOPass (and its denoiser) read depth as if it were perspective, but the viewer uses a logarithmic depth buffer,
 *  so positions came out wrong and the soft shading swam and flickered as the camera moved. This wraps their depth
 *  reads to convert log depth, log2(1 + w) / log2(far + 1), back to perspective depth first. */
export function fixGtaoLogDepth(mats: THREE.ShaderMaterial[], near: number, far: number) {
  for (const m of mats) {
    m.uniforms.aoLogNear = { value: near }
    m.uniforms.aoLogFar = { value: far }
    m.fragmentShader = m.fragmentShader
      .replace(/float getDepth\(\s*const vec2 uv\s*\)\s*\{/, `uniform float aoLogNear, aoLogFar;
        float logToPersp(float d) {
          if (d >= 1.0) return 1.0;
          float w = exp2(d * log2(aoLogFar + 1.0)) - 1.0;
          return viewZToPerspectiveDepth(-w, aoLogNear, aoLogFar);
        }
        float getDepthRaw(const vec2 uv);
        float getDepth(const vec2 uv) { return logToPersp(getDepthRaw(uv)); }
        float getDepthRaw(const vec2 uv) {`)
      .replace(/float fetchDepth\(\s*const ivec2 uv\s*\)\s*\{/, `float fetchDepthRaw(const ivec2 uv);
        float fetchDepth(const ivec2 uv) { return logToPersp(fetchDepthRaw(uv)); }
        float fetchDepthRaw(const ivec2 uv) {`)
    m.needsUpdate = true
  }
}

/** Turn the bands on or off; materials pick it up once they're flagged needsUpdate. */
export function setToon(on: boolean) { toonOn = on }
export const isToon = () => toonOn

/** A stylised sky dome (trial, ViewOptions.skyStyle): soft blue zenith to a warm chalk horizon with a glow around the
 *  sun, in place of the physical haze. Also used to light the scene, so the ambient light follows the same colours. */
export function gradientSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false,
    uniforms: {
      zenith: { value: new THREE.Color('#4f93dc') },
      horizon: { value: new THREE.Color('#e9eee8') },
      ground: { value: new THREE.Color('#dcdcd2') },
      sunCol: { value: new THREE.Color('#fff1cf') },
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      intensity: { value: 1.15 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 zenith, horizon, ground, sunCol, sunDir;
      uniform float intensity;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 c = d.y > 0.0 ? mix(horizon, zenith, pow(smoothstep(0.0, 0.2, d.y), 0.6)) : mix(horizon, ground, min(1.0, -d.y * 6.0));
        float s = max(dot(d, normalize(sunDir)), 0.0);
        c = mix(c, sunCol, 0.55 * pow(s, 24.0) + 0.9 * pow(s, 900.0));
        gl_FragColor = vec4(c * intensity, 1.0);
      }`,
  })
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat)
  m.renderOrder = -1
  m.frustumCulled = false
  return m
}

/** Depth of field, far side only: whatever lies beyond the orbit target goes gradually soft. Distance comes from
 *  GTAOPass's depth, which the logarithmic depth buffer stores as log2(1 + w) / log2(far + 1). */
export const DofShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    texel: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
    far: { value: 20000 },
    focus: { value: 300 },      // m, camera to orbit target
    range: { value: 450 },      // m beyond focus until the blur is full
    maxBlur: { value: 3.0 },    // px at full blur
  },
  vertexShader: quadVertex(),
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse, tDepth;
    uniform vec2 texel;
    uniform float far, focus, range, maxBlur;
    varying vec2 vUv;
    float dist(vec2 uv) { return exp2(texture2D(tDepth, uv).x * log2(far + 1.0)) - 1.0; }
    float coc(vec2 uv) { return clamp((dist(uv) - focus) / range, 0.0, 1.0) * maxBlur; }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float r = coc(vUv);
      if (r < 0.35) { gl_FragColor = c; return; }
      vec4 acc = c; float wsum = 1.0;
      for (int i = 0; i < 16; i++) {
        float f = (float(i) + 0.5) / 16.0;
        float a = float(i) * 2.39996;
        vec2 uv = vUv + vec2(cos(a), sin(a)) * sqrt(f) * r * texel;
        float w = smoothstep(0.0, r * 0.5, coc(uv));   // a sharp near object doesn't smear into the blur behind it
        acc += texture2D(tDiffuse, uv) * w; wsum += w;
      }
      gl_FragColor = acc / wsum;
    }`,
}

function quadVertex() {
  return /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`
}

/** Screen-space ink lines: a step in the view normal (creases) or in log depth (silhouettes). */
export const OutlineShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tNormal: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    texel: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
    ink: { value: new THREE.Color('#202020') },
    strength: { value: 0.85 },
  },
  vertexShader: quadVertex(),
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse, tNormal, tDepth;
    uniform vec2 texel;
    uniform vec3 ink;
    uniform float strength;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 n = texture2D(tNormal, vUv).xyz;
      float d = texture2D(tDepth, vUv).x;
      float e = 0.0;
      vec2 o[4];
      o[0] = vec2(texel.x, 0.0); o[1] = vec2(-texel.x, 0.0); o[2] = vec2(0.0, texel.y); o[3] = vec2(0.0, -texel.y);
      vec3 nb[4];
      for (int i = 0; i < 4; i++) {
        nb[i] = texture2D(tNormal, vUv + o[i]).xyz;
        float dd = texture2D(tDepth, vUv + o[i]).x;
        e = max(e, smoothstep(0.0025, 0.005, dd - d));   // only the nearer side, so lines stay one pixel thin
      }
      // creases, but not across a sliver one pixel wide (a frame or mullion seen edge-on): if both neighbours on
      // an axis agree with each other, the centre is a sliver and would just flicker as the camera moves
      for (int a = 0; a < 2; a++) {
        vec3 p = nb[a * 2], q = nb[a * 2 + 1];
        float crease = max(distance(n, p), distance(n, q));
        float sliver = 1.0 - smoothstep(0.1, 0.25, distance(p, q));
        e = max(e, smoothstep(0.25, 0.45, crease) * (1.0 - sliver));
      }
      gl_FragColor = vec4(mix(c.rgb, ink, e * strength), c.a);
    }`,
}
