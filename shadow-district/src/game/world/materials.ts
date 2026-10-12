import * as THREE from 'three';
import type { FacadeStyle, PbrSet, TextureLibrary } from './textures';

/** Shared uniforms driven by time-of-day / weather. */
export const sharedUniforms = {
  uWetness: { value: 0 },
  uPuddle: { value: 0 },
  uTime: { value: 0 },
};

const NOISE_GLSL = /* glsl */ `
varying vec3 vSdWorld;
uniform float uWetness;
uniform float uPuddle;
float sdHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float sdNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(sdHash(i), sdHash(i + vec2(1.0, 0.0)), u.x), mix(sdHash(i + vec2(0.0, 1.0)), sdHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;

/**
 * Patch a standard material with world-space macro variation (breaks texture tiling)
 * and rain wetness / puddles (low roughness, flattened normals, darker albedo).
 */
export function patchSurface(mat: THREE.MeshStandardMaterial, opts: { macro: number; puddles: number; wetDarken: number }): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWetness = sharedUniforms.uWetness;
    shader.uniforms.uPuddle = sharedUniforms.uPuddle;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSdWorld;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 sdW = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          sdW = instanceMatrix * sdW;
        #endif
        vSdWorld = (modelMatrix * sdW).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE_GLSL}`)
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float sdMacro = sdNoise(vSdWorld.xz * 0.045) * 0.6 + sdNoise(vSdWorld.xz * 0.19) * 0.4;
        diffuseColor.rgb *= 1.0 + (sdMacro - 0.5) * ${opts.macro.toFixed(3)};
        float sdPN = sdNoise(vSdWorld.xz * 0.09 + 3.1) * 0.65 + sdNoise(vSdWorld.xz * 0.31) * 0.35;
        float sdPuddle = smoothstep(0.58, 0.66, sdPN) * uPuddle * ${opts.puddles.toFixed(3)};
        diffuseColor.rgb *= mix(1.0, 0.62, clamp(uWetness * ${opts.wetDarken.toFixed(3)} + sdPuddle * 0.8, 0.0, 1.0));`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor *= 1.0 - 0.5 * uWetness;
        roughnessFactor = mix(roughnessFactor, 0.03, sdPuddle);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        normal = normalize(mix(normal, normalize(vNormal), sdPuddle));`,
      );
  };
  mat.customProgramCacheKey = () => `surf-${opts.macro}-${opts.puddles}-${opts.wetDarken}`;
}

function pbr(set: PbrSet, params: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: set.map,
    roughnessMap: set.orm,
    metalnessMap: set.orm,
    normalMap: set.normal,
    roughness: 1,
    metalness: 1,
    ...params,
  });
}

export class MaterialLibrary {
  road: THREE.MeshStandardMaterial;
  sidewalk: THREE.MeshStandardMaterial;
  pavers: THREE.MeshStandardMaterial;
  concrete: THREE.MeshStandardMaterial;
  concreteFloor: THREE.MeshStandardMaterial;
  gravel: THREE.MeshStandardMaterial;
  brick: THREE.MeshStandardMaterial;
  roof: THREE.MeshStandardMaterial;
  corrugated: THREE.MeshStandardMaterial;
  container: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  metalPlate: THREE.MeshStandardMaterial;
  hazard: THREE.MeshStandardMaterial;
  storefront: THREE.MeshStandardMaterial;
  facades: Record<FacadeStyle, THREE.MeshStandardMaterial>;
  darkMetal: THREE.MeshStandardMaterial;
  paintedMetal: THREE.MeshStandardMaterial;
  carPaint: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  chrome: THREE.MeshStandardMaterial;
  plastic: THREE.MeshStandardMaterial;
  foliage: THREE.MeshStandardMaterial;
  bark: THREE.MeshStandardMaterial;
  fence: THREE.MeshStandardMaterial;
  water: THREE.MeshStandardMaterial;
  trim: THREE.MeshStandardMaterial;
  lampGlow: THREE.MeshBasicMaterial;
  windowGlowWarm: THREE.MeshBasicMaterial;
  redBeacon: THREE.MeshBasicMaterial;
  lightPool: THREE.MeshBasicMaterial;
  markingWhite: THREE.MeshStandardMaterial;
  markingYellow: THREE.MeshStandardMaterial;
  tailLight: THREE.MeshBasicMaterial;
  headLight: THREE.MeshBasicMaterial;
  private extra: THREE.Material[] = [];

  constructor(private tex: TextureLibrary) {
    const t = tex;
    const repeatFor = (set: PbrSet) => set; // UVs are generated in world units / worldSize
    repeatFor(t.asphalt);
    this.road = pbr(t.asphalt, { color: 0xffffff });
    patchSurface(this.road, { macro: 0.5, puddles: 1, wetDarken: 0.45 });
    this.sidewalk = pbr(t.sidewalk);
    patchSurface(this.sidewalk, { macro: 0.35, puddles: 0.55, wetDarken: 0.35 });
    this.pavers = pbr(t.pavers);
    patchSurface(this.pavers, { macro: 0.3, puddles: 0.6, wetDarken: 0.35 });
    this.concrete = pbr(t.concrete);
    this.concreteFloor = pbr(t.concrete, { color: 0xb8b4ac });
    patchSurface(this.concreteFloor, { macro: 0.4, puddles: 0.7, wetDarken: 0.3 });
    this.gravel = pbr(t.gravel);
    patchSurface(this.gravel, { macro: 0.4, puddles: 0.4, wetDarken: 0.4 });
    this.brick = pbr(t.brick);
    this.roof = pbr(t.roof);
    this.corrugated = pbr(t.corrugated, { color: 0x8e9499 });
    this.container = pbr(t.container);
    this.wood = pbr(t.wood);
    this.metalPlate = pbr(t.metalPlate);
    this.hazard = pbr(t.hazard);
    this.storefront = pbr(t.storefront, { emissiveMap: t.storefront.emissive, emissive: 0xffffff, emissiveIntensity: 1 });
    this.facades = {} as Record<FacadeStyle, THREE.MeshStandardMaterial>;
    for (const style of Object.keys(t.facades) as FacadeStyle[]) {
      const set = t.facades[style];
      this.facades[style] = pbr(set, { emissiveMap: set.emissive, emissive: 0xffffff, emissiveIntensity: 0.4 });
    }
    this.darkMetal = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.45, metalness: 0.85 });
    this.paintedMetal = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.35 });
    this.carPaint = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.28, metalness: 0.55 });
    this.glass = new THREE.MeshStandardMaterial({ color: 0x0c1218, roughness: 0.05, metalness: 0.9 });
    this.rubber = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9, metalness: 0 });
    this.chrome = new THREE.MeshStandardMaterial({ color: 0xd8dde3, roughness: 0.15, metalness: 1 });
    this.plastic = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0 });
    this.foliage = new THREE.MeshStandardMaterial({ color: 0x3f5f2a, roughness: 0.85, metalness: 0, flatShading: true });
    this.bark = new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 0.95, metalness: 0 });
    this.fence = new THREE.MeshStandardMaterial({
      color: 0xb0b5ba, map: t.chainLink, alphaMap: t.chainLink, alphaTest: 0.4,
      roughness: 0.5, metalness: 0.8, side: THREE.DoubleSide,
    });
    this.water = new THREE.MeshStandardMaterial({
      color: 0x0b2a33, roughness: 0.06, metalness: 0.1, normalMap: t.waterNormal,
      normalScale: new THREE.Vector2(0.6, 0.6),
    });
    this.trim = new THREE.MeshStandardMaterial({ color: 0x6d6a66, roughness: 0.8, metalness: 0.1 });
    this.lampGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.85, 0.6) });
    this.windowGlowWarm = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.8, 0.5) });
    this.redBeacon = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.2, 0.15) });
    this.lightPool = new THREE.MeshBasicMaterial({
      map: t.lightPool, color: new THREE.Color(1, 0.72, 0.42), transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.markingWhite = new THREE.MeshStandardMaterial({
      color: 0xd8d6cf, roughness: 0.7, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    patchSurface(this.markingWhite, { macro: 0.25, puddles: 0.8, wetDarken: 0.3 });
    this.markingYellow = new THREE.MeshStandardMaterial({
      color: 0xd9a426, roughness: 0.7, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    patchSurface(this.markingYellow, { macro: 0.25, puddles: 0.8, wetDarken: 0.3 });
    this.tailLight = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 0.08, 0.05) });
    this.headLight = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.8, 2.4) });
  }

  /** Create (and track for disposal) an extra material. */
  track<T extends THREE.Material>(m: T): T {
    this.extra.push(m);
    return m;
  }

  setEnvironment(env: THREE.Texture | null, intensity: number): void {
    const all = this.all();
    for (const m of all) {
      if (m instanceof THREE.MeshStandardMaterial) {
        m.envMap = env;
        m.envMapIntensity = intensity;
        m.needsUpdate = true;
      }
    }
  }

  all(): THREE.Material[] {
    return [
      this.road, this.sidewalk, this.pavers, this.concrete, this.concreteFloor, this.gravel, this.brick, this.roof,
      this.corrugated, this.container, this.wood, this.metalPlate, this.hazard, this.storefront,
      ...Object.values(this.facades), this.darkMetal, this.paintedMetal, this.carPaint, this.glass, this.rubber,
      this.chrome, this.plastic, this.foliage, this.bark, this.fence, this.water, this.trim, this.lampGlow,
      this.windowGlowWarm, this.redBeacon, this.lightPool, this.markingWhite, this.markingYellow, this.tailLight,
      this.headLight, ...this.extra,
    ];
  }

  dispose(): void {
    for (const m of this.all()) m.dispose();
    this.tex.dispose();
  }
}
