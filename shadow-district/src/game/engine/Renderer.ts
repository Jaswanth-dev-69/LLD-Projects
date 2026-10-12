import * as THREE from 'three';
import {
  EffectComposer,
  RenderPass,
  EffectPass,
  BloomEffect,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
  SMAAEffect,
  SMAAPreset,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import type { GraphicsSettings } from '../state/settings';
import { clamp } from './math';

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

/**
 * Owns the WebGL renderer, camera, and the post-processing chain.
 * Quality presets toggle passes rather than stacking every effect at once.
 */
export class RenderSystem {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private aoPass: N8AOPostPass | null = null;
  private bloom: BloomEffect | null = null;
  private settings: GraphicsSettings | null = null;
  private container: HTMLElement;
  private width = 1;
  private height = 1;
  /** Adaptive resolution multiplier (1 = target). */
  dynamicScale = 1;
  private slowTime = 0;
  private fastTime = 0;
  exposure = 1;
  private resizeObserver: ResizeObserver;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
      alpha: false,
      preserveDrawingBuffer: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setClearColor(0x05060a, 1);
    this.renderer.domElement.className = 'game-canvas';
    this.renderer.domElement.tabIndex = 0;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 900);
    this.camera.position.set(0, 10, 20);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  applySettings(g: GraphicsSettings): void {
    const prev = this.settings;
    this.settings = { ...g };
    this.camera.fov = g.fov;
    this.camera.far = 420 + 380 * g.viewDistance;
    this.camera.updateProjectionMatrix();

    const shadowsOn = g.shadows !== 'off';
    if (this.renderer.shadowMap.enabled !== shadowsOn) {
      this.renderer.shadowMap.enabled = shadowsOn;
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (!m) return;
        (Array.isArray(m) ? m : [m]).forEach((mm) => (mm.needsUpdate = true));
      });
    }

    const needComposer = g.bloom || g.ambientOcclusion || g.antialiasing;
    const rebuild =
      !prev ||
      prev.bloom !== g.bloom ||
      prev.ambientOcclusion !== g.ambientOcclusion ||
      prev.antialiasing !== g.antialiasing ||
      !!this.composer !== needComposer;
    if (rebuild) this.buildComposer(needComposer, g);
    if (!g.adaptiveResolution) this.dynamicScale = 1;
    this.resize();
  }

  private buildComposer(enabled: boolean, g: GraphicsSettings): void {
    this.composer?.dispose();
    this.composer = null;
    this.renderPass = null;
    this.aoPass = null;
    this.bloom = null;
    if (!enabled) {
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = this.exposure;
      return;
    }
    this.renderer.toneMapping = THREE.NoToneMapping;
    const composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.renderPass = new RenderPass(this.scene, this.camera);
    composer.addPass(this.renderPass);
    if (g.ambientOcclusion) {
      const ao = new N8AOPostPass(this.scene, this.camera, this.width, this.height);
      ao.configuration.aoRadius = 2.2;
      ao.configuration.distanceFalloff = 1.2;
      ao.configuration.intensity = 2.4;
      ao.configuration.halfRes = true;
      ao.configuration.gammaCorrection = false;
      ao.setQualityMode('Low');
      composer.addPass(ao);
      this.aoPass = ao;
    }
    const effects = [];
    if (g.bloom) {
      this.bloom = new BloomEffect({
        mipmapBlur: true,
        luminanceThreshold: 0.9,
        luminanceSmoothing: 0.25,
        intensity: 0.85,
        radius: 0.72,
      });
      effects.push(this.bloom);
    }
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    effects.push(tone);
    effects.push(new VignetteEffect({ offset: 0.32, darkness: 0.52 }));
    composer.addPass(new EffectPass(this.camera, ...effects));
    if (g.antialiasing) {
      composer.addPass(new EffectPass(this.camera, new SMAAEffect({ preset: SMAAPreset.HIGH })));
    }
    this.composer = composer;
  }

  setExposure(e: number): void {
    this.exposure = e;
    this.renderer.toneMappingExposure = e;
  }

  setBloomIntensity(v: number): void {
    if (this.bloom) this.bloom.intensity = v;
  }

  resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.width = w;
    this.height = h;
    const base = Math.min(window.devicePixelRatio || 1, 2);
    const scale = (this.settings?.resolutionScale ?? 1) * this.dynamicScale;
    const pr = clamp(base * scale, 0.35, 2);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer?.setSize(w, h, false);
  }

  /** Lower or raise the internal resolution to hold the frame budget. */
  updateAdaptive(frameMs: number, dt: number): void {
    if (!this.settings?.adaptiveResolution) return;
    if (frameMs > 21) {
      this.slowTime += dt;
      this.fastTime = 0;
    } else if (frameMs < 13.5) {
      this.fastTime += dt;
      this.slowTime = 0;
    } else {
      this.slowTime = Math.max(0, this.slowTime - dt);
      this.fastTime = Math.max(0, this.fastTime - dt);
    }
    if (this.slowTime > 1.5 && this.dynamicScale > 0.55) {
      this.dynamicScale = Math.max(0.55, this.dynamicScale - 0.1);
      this.slowTime = 0;
      this.resize();
    } else if (this.fastTime > 4 && this.dynamicScale < 1) {
      this.dynamicScale = Math.min(1, this.dynamicScale + 0.05);
      this.fastTime = 0;
      this.resize();
    }
  }

  get aoEnabled(): boolean {
    return this.aoPass !== null;
  }

  get effectiveScale(): number {
    return (this.settings?.resolutionScale ?? 1) * this.dynamicScale;
  }

  render(dt: number): void {
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.composer?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
