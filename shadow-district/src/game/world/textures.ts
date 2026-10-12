import * as THREE from 'three';
import { clamp, hash2, lerp, smoothstep, tileFbm } from '../engine/math';

/**
 * Procedural texture generation. Everything is generated locally at load time:
 * no external image files are required, so the game runs fully offline.
 */

export interface PbrSet {
  map: THREE.Texture;
  orm: THREE.Texture; // G = roughness, B = metalness
  normal: THREE.Texture;
  emissive?: THREE.Texture;
  /** World-space size the texture covers (meters). */
  worldSize: [number, number];
}

interface Px {
  r: number; g: number; b: number;
  h: number; rough: number; metal: number;
  er: number; eg: number; eb: number;
}

// ---------------------------------------------------------------------------
// Noise table (tileable fbm) for fast sampling.
const NT = 256;
let noiseTable: Float32Array | null = null;
function table(): Float32Array {
  if (noiseTable) return noiseTable;
  noiseTable = new Float32Array(NT * NT);
  for (let y = 0; y < NT; y++) {
    for (let x = 0; x < NT; x++) {
      noiseTable[y * NT + x] = tileFbm(x / 32, y / 32, 8, 5);
    }
  }
  return noiseTable;
}

/** Tileable noise in [0,1]; u,v in [0,1); scale = integer repeats over the texture. */
function n(u: number, v: number, scale: number, seed = 0): number {
  const t = table();
  let x = (u * scale + seed * 0.37) * NT;
  let y = (v * scale + seed * 0.61) * NT;
  x = ((x % NT) + NT) % NT;
  y = ((y % NT) + NT) % NT;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const x1 = (x0 + 1) % NT, y1 = (y0 + 1) % NT;
  const a = t[y0 * NT + x0], b = t[y0 * NT + x1], c = t[y1 * NT + x0], d = t[y1 * NT + x1];
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: false })!;
  return [c, ctx];
}

function toTex(c: HTMLCanvasElement, srgb: boolean, aniso = 4): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Run a per-pixel generator and produce the PBR canvases. */
function generate(
  w: number,
  h: number,
  worldSize: [number, number],
  fn: (u: number, v: number, x: number, y: number, o: Px) => void,
  opts: { normalStrength?: number; emissive?: boolean; aniso?: number } = {},
): PbrSet {
  const [cc, cctx] = makeCanvas(w, h);
  const [oc, octx] = makeCanvas(w, h);
  const color = cctx.createImageData(w, h);
  const orm = octx.createImageData(w, h);
  const heights = new Float32Array(w * h);
  let emissiveData: ImageData | null = null;
  let ec: HTMLCanvasElement | null = null;
  let ectx: CanvasRenderingContext2D | null = null;
  if (opts.emissive) {
    [ec, ectx] = makeCanvas(w, h);
    emissiveData = ectx.createImageData(w, h);
  }
  const o: Px = { r: 0, g: 0, b: 0, h: 0, rough: 0.8, metal: 0, er: 0, eg: 0, eb: 0 };
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      o.r = o.g = o.b = 0.5;
      o.h = 0.5;
      o.rough = 0.8;
      o.metal = 0;
      o.er = o.eg = o.eb = 0;
      fn(u, v, x, y, o);
      const i = (y * w + x) * 4;
      color.data[i] = clamp(o.r, 0, 1) * 255;
      color.data[i + 1] = clamp(o.g, 0, 1) * 255;
      color.data[i + 2] = clamp(o.b, 0, 1) * 255;
      color.data[i + 3] = 255;
      orm.data[i] = 255;
      orm.data[i + 1] = clamp(o.rough, 0.02, 1) * 255;
      orm.data[i + 2] = clamp(o.metal, 0, 1) * 255;
      orm.data[i + 3] = 255;
      heights[y * w + x] = o.h;
      if (emissiveData) {
        emissiveData.data[i] = clamp(o.er, 0, 1) * 255;
        emissiveData.data[i + 1] = clamp(o.eg, 0, 1) * 255;
        emissiveData.data[i + 2] = clamp(o.eb, 0, 1) * 255;
        emissiveData.data[i + 3] = 255;
      }
    }
  }
  cctx.putImageData(color, 0, 0);
  octx.putImageData(orm, 0, 0);
  const normal = normalFromHeight(heights, w, h, opts.normalStrength ?? 2);
  const aniso = opts.aniso ?? 4;
  const set: PbrSet = {
    map: toTex(cc, true, aniso),
    orm: toTex(oc, false, aniso),
    normal: toTex(normal, false, aniso),
    worldSize,
  };
  if (emissiveData && ec && ectx) {
    ectx.putImageData(emissiveData, 0, 0);
    set.emissive = toTex(ec, true, aniso);
  }
  return set;
}

function normalFromHeight(hm: Float32Array, w: number, h: number, strength: number): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(w, h);
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const ym = ((y - 1 + h) % h) * w, yp = ((y + 1) % h) * w, y0 = y * w;
    for (let x = 0; x < w; x++) {
      const xm = (x - 1 + w) % w, xp = (x + 1) % w;
      const dx = (hm[y0 + xp] - hm[y0 + xm]) * strength;
      const dy = (hm[yp + x] - hm[ym + x]) * strength;
      // OpenGL convention (+Y up in tangent space; canvas rows go down).
      let nx = -dx, ny = dy, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y0 + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const srgb = (hex: number): [number, number, number] => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
function setColor(o: Px, c: [number, number, number], k = 1): void {
  o.r = c[0] * k;
  o.g = c[1] * k;
  o.b = c[2] * k;
}
function mixColor(o: Px, c: [number, number, number], t: number): void {
  o.r = lerp(o.r, c[0], t);
  o.g = lerp(o.g, c[1], t);
  o.b = lerp(o.b, c[2], t);
}

// ---------------------------------------------------------------------------
// Ground textures

function asphalt(): PbrSet {
  const size = 1024;
  // Precompute cracks as a height mask via random walks (wrapped for tiling).
  const crack = new Float32Array(size * size);
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let k = 0; k < 9; k++) {
    let x = rnd() * size, y = rnd() * size;
    let ang = rnd() * Math.PI * 2;
    const len = 120 + rnd() * 260;
    for (let s = 0; s < len; s++) {
      ang += (rnd() - 0.5) * 0.6;
      x += Math.cos(ang) * 1.4;
      y += Math.sin(ang) * 1.4;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const px = ((Math.round(x) + ox) % size + size) % size;
          const py = ((Math.round(y) + oy) % size + size) % size;
          const wgt = ox === 0 && oy === 0 ? 1 : 0.35;
          crack[py * size + px] = Math.max(crack[py * size + px], wgt);
        }
      }
      if (rnd() < 0.015) ang += (rnd() - 0.5) * 2.5;
    }
  }
  const base = srgb(0x343436);
  return generate(size, size, [9, 9], (u, v, x, y, o) => {
    const grain = hash2(x, y);
    const big = n(u, v, 2, 1);
    const mid = n(u, v, 6, 2);
    const fine = n(u, v, 24, 3);
    let k = 0.85 + (big - 0.5) * 0.35 + (mid - 0.5) * 0.18 + (grain - 0.5) * 0.22;
    // Light aggregate stones
    const stone = grain > 0.965 ? 1 : 0;
    k += stone * 0.45;
    // Darker tar patches
    const patch = smoothstep(0.62, 0.66, n(u, v, 3, 4));
    k *= 1 - patch * 0.22;
    setColor(o, base, k);
    const c = crack[y * size + x];
    if (c > 0) {
      o.r *= 1 - c * 0.6;
      o.g *= 1 - c * 0.6;
      o.b *= 1 - c * 0.6;
    }
    o.h = 0.5 + (grain - 0.5) * 0.35 + (fine - 0.5) * 0.4 + stone * 0.25 - c * 0.7;
    o.rough = 0.88 - stone * 0.25 - patch * 0.18 + (grain - 0.5) * 0.08 + c * 0.1;
    o.metal = 0;
  }, { normalStrength: 1.6, aniso: 8 });
}

function sidewalk(): PbrSet {
  const size = 512;
  const tilesPer = 4; // 4m world → 1m tiles
  const base = srgb(0x8d8a84);
  return generate(size, size, [4, 4], (u, v, x, y, o) => {
    const tx = (u * tilesPer) % 1, ty = (v * tilesPer) % 1;
    const tileId = hash2(Math.floor(u * tilesPer), Math.floor(v * tilesPer));
    const edge = Math.min(tx, 1 - tx, ty, 1 - ty);
    const joint = 1 - smoothstep(0.004, 0.014, edge);
    const stain = n(u, v, 3, 5);
    const grain = hash2(x, y);
    let k = 0.92 + (tileId - 0.5) * 0.12 + (stain - 0.5) * 0.3 + (grain - 0.5) * 0.08;
    k *= 1 - joint * 0.45;
    // Gum spots / dark stains
    const spot = smoothstep(0.78, 0.82, n(u, v, 10, 6));
    k *= 1 - spot * 0.25;
    setColor(o, base, k);
    o.h = 0.6 - joint * 0.5 + (grain - 0.5) * 0.12;
    o.rough = 0.82 + (grain - 0.5) * 0.1 - spot * 0.2;
  }, { normalStrength: 2.2 });
}

function concrete(): PbrSet {
  const size = 512;
  const base = srgb(0x9a968e);
  return generate(size, size, [4, 4], (u, v, x, y, o) => {
    const big = n(u, v, 2, 7);
    const mid = n(u, v, 8, 8);
    const grain = hash2(x, y);
    // vertical drip streaks
    const streak = n(u * 1, v * 0.08, 16, 9);
    const form = (v * 4) % 1;
    const line = 1 - smoothstep(0.0, 0.012, Math.min(form, 1 - form));
    let k = 0.9 + (big - 0.5) * 0.25 + (mid - 0.5) * 0.12 + (grain - 0.5) * 0.06;
    k *= 1 - smoothstep(0.55, 0.8, streak) * 0.22;
    k *= 1 - line * 0.18;
    // bug holes
    const hole = grain > 0.993 ? 1 : 0;
    k *= 1 - hole * 0.4;
    setColor(o, base, k);
    o.h = 0.5 + (mid - 0.5) * 0.2 + (grain - 0.5) * 0.1 - hole * 0.4 - line * 0.2;
    o.rough = 0.86 + (grain - 0.5) * 0.08;
  }, { normalStrength: 1.4 });
}

function brick(): PbrSet {
  const size = 512;
  const rows = 30, cols = 8; // 2m world: 0.25m x ~0.067m bricks
  const mortar = srgb(0xa59f94);
  return generate(size, size, [2, 2], (u, v, x, y, o) => {
    const row = Math.floor(v * rows);
    const fy = (v * rows) % 1;
    const off = row % 2 === 0 ? 0 : 0.5;
    const cu = u * cols + off;
    const col = Math.floor(cu);
    const fx = cu % 1;
    const id = hash2(col % cols, row);
    const edge = Math.min(fx * 3.8, (1 - fx) * 3.8, fy, 1 - fy);
    const isMortar = edge < 0.12;
    const grain = hash2(x, y);
    if (isMortar) {
      setColor(o, mortar, 0.85 + (grain - 0.5) * 0.15);
      o.h = 0.25;
      o.rough = 0.95;
    } else {
      const hue = id;
      const c: [number, number, number] = [
        lerp(0.42, 0.62, hue) , lerp(0.17, 0.27, hue), lerp(0.12, 0.18, hue),
      ];
      const k = 0.85 + (n(u, v, 12, 10) - 0.5) * 0.35 + (grain - 0.5) * 0.12;
      setColor(o, c, k);
      if (id > 0.88) mixColor(o, [0.22, 0.14, 0.11], 0.6);
      o.h = 0.7 + (grain - 0.5) * 0.15;
      o.rough = 0.88;
    }
    const soot = smoothstep(0.55, 0.9, n(u, v, 2, 11));
    o.r *= 1 - soot * 0.35;
    o.g *= 1 - soot * 0.35;
    o.b *= 1 - soot * 0.35;
  }, { normalStrength: 3 });
}

function pavers(): PbrSet {
  const size = 512;
  const count = 8; // 4m world → 0.5m stones
  return generate(size, size, [4, 4], (u, v, x, y, o) => {
    const row = Math.floor(v * count);
    const off = row % 2 ? 0.5 : 0;
    const cu = u * count + off;
    const col = Math.floor(cu);
    const fx = cu % 1, fy = (v * count) % 1;
    const id = hash2(col % count, row);
    const edge = Math.min(fx, 1 - fx, fy, 1 - fy);
    const gap = 1 - smoothstep(0.02, 0.05, edge);
    const grain = hash2(x, y);
    const tone = lerp(0.42, 0.62, id);
    const warm: [number, number, number] = [tone * 1.05, tone * 0.98, tone * 0.9];
    setColor(o, warm, 0.9 + (n(u, v, 6, 12) - 0.5) * 0.2 + (grain - 0.5) * 0.08);
    o.r *= 1 - gap * 0.55; o.g *= 1 - gap * 0.55; o.b *= 1 - gap * 0.55;
    o.h = 0.7 - gap * 0.6 + (grain - 0.5) * 0.08 + (1 - smoothstep(0, 0.2, edge)) * -0.1;
    o.rough = 0.7 + (grain - 0.5) * 0.15;
  }, { normalStrength: 2.5 });
}

function gravel(): PbrSet {
  const size = 512;
  return generate(size, size, [5, 5], (u, v, x, y, o) => {
    const grain = hash2(x, y);
    const cell = hash2(Math.floor(x / 3), Math.floor(y / 3));
    const big = n(u, v, 3, 13);
    const k = 0.55 + cell * 0.35 + (grain - 0.5) * 0.15 + (big - 0.5) * 0.3;
    setColor(o, [0.42, 0.39, 0.34], k);
    o.h = cell * 0.6 + grain * 0.2;
    o.rough = 0.95;
  }, { normalStrength: 3 });
}

function corrugated(): PbrSet {
  const size = 512;
  const ridges = 24; // 2m world
  return generate(size, size, [2, 2], (u, v, x, y, o) => {
    const s = Math.sin(u * ridges * Math.PI * 2);
    const rust = smoothstep(0.58, 0.85, n(u, v, 3, 14)) * smoothstep(0.3, 1.0, v * 0.6 + n(u, v, 12, 15));
    const grain = hash2(x, y);
    const dirt = n(u * 0.5, v * 2, 6, 16);
    const k = 0.82 + s * 0.06 + (dirt - 0.5) * 0.2 + (grain - 0.5) * 0.05;
    setColor(o, [0.78, 0.78, 0.78], k);
    mixColor(o, [0.42, 0.22, 0.12], rust * 0.85);
    o.h = 0.5 + s * 0.45;
    o.rough = 0.55 + rust * 0.4 + (grain - 0.5) * 0.06;
    o.metal = 0.55 * (1 - rust);
  }, { normalStrength: 4 });
}

function wood(): PbrSet {
  const size = 256;
  const planks = 5;
  return generate(size, size, [1.2, 1.2], (u, v, x, y, o) => {
    const p = Math.floor(v * planks);
    const fy = (v * planks) % 1;
    const id = hash2(p, 3);
    const grainLine = Math.sin((u * 40 + n(u, v, 4, 17 + p) * 6) * Math.PI) * 0.5 + 0.5;
    const gap = 1 - smoothstep(0.02, 0.06, Math.min(fy, 1 - fy));
    const k = 0.7 + id * 0.25 + grainLine * 0.12;
    setColor(o, [0.55, 0.42, 0.28], k);
    o.r *= 1 - gap * 0.6; o.g *= 1 - gap * 0.6; o.b *= 1 - gap * 0.6;
    o.h = 0.6 - gap * 0.5 + grainLine * 0.08;
    o.rough = 0.85;
  }, { normalStrength: 2 });
}

function roof(): PbrSet {
  const size = 256;
  return generate(size, size, [6, 6], (u, v, x, y, o) => {
    const grain = hash2(x, y);
    const big = n(u, v, 2, 18);
    const k = 0.5 + (grain - 0.5) * 0.2 + (big - 0.5) * 0.3;
    setColor(o, [0.33, 0.33, 0.34], k + 0.4);
    o.h = grain * 0.5;
    o.rough = 0.95;
  }, { normalStrength: 2 });
}

function metalPlate(): PbrSet {
  const size = 256;
  return generate(size, size, [2, 2], (u, v, x, y, o) => {
    const grain = hash2(x, y);
    // diamond tread
    const a = ((u + v) * 16) % 1, b = ((u - v + 4) * 16) % 1;
    const tread = smoothstep(0.42, 0.5, Math.abs(a - 0.5)) * smoothstep(0.1, 0.0, Math.abs(b - 0.5) - 0.35);
    const scratches = n(u * 4, v * 0.3, 8, 19);
    setColor(o, [0.55, 0.56, 0.58], 0.8 + (scratches - 0.5) * 0.25 + (grain - 0.5) * 0.06);
    o.h = 0.4 + tread * 0.5;
    o.rough = 0.45 + (scratches - 0.5) * 0.2;
    o.metal = 0.85;
  }, { normalStrength: 2 });
}

function hazard(): PbrSet {
  const size = 256;
  return generate(size, size, [1, 1], (u, v, x, y, o) => {
    const stripe = ((u + v) * 4) % 1 < 0.5;
    const grain = hash2(x, y);
    const wear = smoothstep(0.6, 0.8, n(u, v, 6, 20));
    if (stripe) setColor(o, [0.92, 0.66, 0.08], 0.9 + (grain - 0.5) * 0.1);
    else setColor(o, [0.08, 0.08, 0.08], 1);
    mixColor(o, [0.5, 0.5, 0.48], wear * 0.6);
    o.h = 0.5;
    o.rough = 0.6 + wear * 0.3;
  }, { normalStrength: 1 });
}

// ---------------------------------------------------------------------------
// Building facades. World size: 16m (4 bays) x 14m (4 floors).

export type FacadeStyle = 'office' | 'apartment' | 'brick' | 'industrial' | 'modern';

function facade(style: FacadeStyle): PbrSet {
  const size = 512;
  const bays = 4, floors = 4;
  const wallColors: Record<FacadeStyle, [number, number, number]> = {
    office: srgb(0x3a434d),
    apartment: srgb(0xb7a184),
    brick: srgb(0x7a3f2c),
    industrial: srgb(0x8f8c85),
    modern: srgb(0x2b2c30),
  };
  const wall = wallColors[style];
  return generate(size, size, [16, 14], (u, v, x, y, o) => {
    const bx = u * bays, fy = v * floors;
    const bay = Math.floor(bx), floor = Math.floor(fy);
    const lx = bx - bay, ly = fy - floor; // 0..1 within bay/floor (ly=0 is top of the floor in canvas space)
    const id = hash2(bay * 7 + 3, floor * 13 + 5);
    const id2 = hash2(bay * 3 + 11, floor * 5 + 1);
    const grain = hash2(x, y);
    const dirt = n(u, v, 3, 21);
    let win = false, frame = false;
    let wx0 = 0.12, wx1 = 0.88, wy0 = 0.18, wy1 = 0.78;
    switch (style) {
      case 'office':
        wx0 = 0.03; wx1 = 0.97; wy0 = 0.05; wy1 = 0.82; break;
      case 'apartment':
        wx0 = 0.28; wx1 = 0.72; wy0 = 0.22; wy1 = 0.74; break;
      case 'brick':
        wx0 = 0.25; wx1 = 0.75; wy0 = 0.15; wy1 = 0.8; break;
      case 'industrial':
        wx0 = 0.04; wx1 = 0.96; wy0 = 0.18; wy1 = 0.42; break;
      case 'modern':
        wx0 = 0.08; wx1 = 0.92; wy0 = 0.1; wy1 = 0.86; break;
    }
    const inX = lx > wx0 && lx < wx1, inY = ly > wy0 && ly < wy1;
    const fw = 0.025;
    if (inX && inY) {
      win = true;
      // mullions
      const mx = (lx - wx0) / (wx1 - wx0), my = (ly - wy0) / (wy1 - wy0);
      const divX = style === 'office' ? 2 : style === 'industrial' ? 6 : style === 'brick' ? 3 : 2;
      const divY = style === 'brick' ? 3 : style === 'industrial' ? 2 : 1;
      const dx = Math.abs(((mx * divX) % 1) - 0.5), dy = Math.abs(((my * divY) % 1) - 0.5);
      if (dx > 0.5 - fw * divX * 0.8 || (divY > 1 && dy > 0.5 - fw * divY)) frame = true;
      if (mx < 0.02 || mx > 0.98 || my < 0.03 || my > 0.97) frame = true;
    }
    if (win && !frame) {
      // Glass: reflective dark with interior hint.
      const lit = id < (style === 'industrial' ? 0.18 : style === 'office' ? 0.42 : 0.38);
      const curtain = id2;
      const sky = 1 - ly;
      if (style === 'office' || style === 'modern') {
        setColor(o, [0.16 + sky * 0.08, 0.2 + sky * 0.1, 0.26 + sky * 0.12], 1);
        o.rough = 0.06 + grain * 0.04;
        o.metal = 0.85;
      } else {
        setColor(o, [0.08, 0.09, 0.1], 1);
        o.rough = 0.1;
        o.metal = 0.5;
      }
      o.h = 0.15;
      if (lit) {
        // Warm residential, cool offices; ceiling falloff toward the bottom of the window.
        const warmth = style === 'office' ? 0.15 : style === 'modern' ? 0.45 : 0.85;
        const tv = style === 'apartment' && id2 > 0.85;
        const fall = 0.55 + 0.45 * (1 - (ly - wy0) / (wy1 - wy0));
        const blinds = (style === 'office' && id2 > 0.6) ? (Math.sin(ly * 140) > 0 ? 0.55 : 1) : 1;
        let er = lerp(0.85, 1.0, warmth), eg = lerp(0.9, 0.78, warmth), eb = lerp(1.0, 0.5, warmth);
        if (tv) { er = 0.45; eg = 0.6; eb = 1.0; }
        const intensity = (0.55 + id2 * 0.45) * fall * blinds * (curtain > 0.7 && style !== 'office' ? 0.6 : 1);
        o.er = er * intensity; o.eg = eg * intensity; o.eb = eb * intensity;
        // Interior color in the albedo so lit windows read even in daylight
        mixColor(o, [er * 0.35, eg * 0.32, eb * 0.28], 0.4);
      }
    } else if (win && frame) {
      const fc: [number, number, number] = style === 'office' || style === 'modern' ? [0.16, 0.17, 0.19] : style === 'brick' ? [0.18, 0.2, 0.19] : [0.75, 0.75, 0.72];
      setColor(o, fc, 0.9 + (grain - 0.5) * 0.08);
      o.h = 0.55;
      o.rough = 0.45;
      o.metal = style === 'office' || style === 'modern' ? 0.8 : 0.1;
    } else {
      // Wall
      let k = 0.9 + (dirt - 0.5) * 0.3 + (grain - 0.5) * 0.08;
      if (style === 'brick') {
        const rows = 52, cols = 32;
        const r = Math.floor(v * rows * floors / 4);
        const cu = u * cols + (r % 2) * 0.5;
        const fx = cu % 1, fy2 = (v * rows) % 1;
        const mortar = Math.min(fx * 3, (1 - fx) * 3, fy2, 1 - fy2) < 0.12;
        const bid = hash2(Math.floor(cu), r);
        if (mortar) {
          setColor(o, [0.55, 0.52, 0.48], 0.9);
          o.h = 0.35;
        } else {
          setColor(o, [lerp(0.4, 0.56, bid), lerp(0.18, 0.25, bid), lerp(0.13, 0.17, bid)], k);
          o.h = 0.6;
        }
        o.rough = 0.9;
      } else if (style === 'office') {
        // spandrel panels between floors
        setColor(o, wall, k);
        o.h = 0.6;
        o.rough = 0.5;
        o.metal = 0.6;
      } else if (style === 'industrial') {
        const panel = (u * 16) % 1;
        const seam = panel < 0.015 || panel > 0.985 ? 1 : 0;
        setColor(o, wall, k * (1 - seam * 0.3));
        o.h = 0.6 - seam * 0.3;
        o.rough = 0.85;
      } else if (style === 'modern') {
        setColor(o, wall, k);
        const seam = (ly < 0.015 || ly > 0.985) ? 1 : 0;
        o.h = 0.6 - seam * 0.3;
        o.rough = 0.35;
        o.metal = 0.3;
      } else {
        // stucco apartment with sill + ledge
        setColor(o, wall, k + (hash2(x >> 1, y >> 1) - 0.5) * 0.06);
        o.h = 0.55 + (grain - 0.5) * 0.08;
        o.rough = 0.92;
        const sill = lx > wx0 - 0.04 && lx < wx1 + 0.04 && ly > wy1 && ly < wy1 + 0.04;
        if (sill) { setColor(o, [0.8, 0.78, 0.74], 0.95); o.h = 0.85; }
      }
      // floor ledge band
      if (ly > 0.95 && style !== 'office') {
        mixColor(o, [0.3, 0.3, 0.3], 0.35);
        o.h = 0.8;
      }
      // rain streaks under windows
      const streak = smoothstep(0.6, 0.9, n(u * 2, v * 0.12, 8, 22)) * (style === 'modern' ? 0.3 : 1);
      o.r *= 1 - streak * 0.25; o.g *= 1 - streak * 0.25; o.b *= 1 - streak * 0.25;
    }
  }, { normalStrength: 2.5, emissive: true });
}

function storefront(): PbrSet {
  const size = 512;
  // 8m wide x 4.5m tall: 2 shop windows + door.
  return generate(size, size, [8, 4.5], (u, v, x, y, o) => {
    const grain = hash2(x, y);
    const unit = Math.floor(u * 2);
    const lu = (u * 2) % 1;
    const id = hash2(unit, 77);
    // sign band at top (v < 0.18), glass from 0.22 to 0.95
    if (v < 0.18) {
      setColor(o, [0.12, 0.12, 0.13], 1);
      o.rough = 0.4; o.metal = 0.5; o.h = 0.7;
      return;
    }
    const frame = lu < 0.04 || lu > 0.96 || v < 0.22 || v > 0.95 || (Math.abs(lu - 0.62) < 0.012);
    const door = lu > 0.64 && lu < 0.92 && v > 0.3;
    if (v > 0.95) {
      setColor(o, [0.25, 0.25, 0.26], 0.9 + (grain - 0.5) * 0.1);
      o.rough = 0.8; o.h = 0.6;
      return;
    }
    if (frame) {
      setColor(o, [0.08, 0.08, 0.09], 1);
      o.rough = 0.35; o.metal = 0.8; o.h = 0.8;
      return;
    }
    // Shop interior: shelves silhouettes + bright lighting
    const shelf = Math.sin(v * 60) > 0.6 && !door ? 1 : 0;
    const hue = id;
    const ir = lerp(1.0, 0.65, hue), ig = lerp(0.85, 0.95, hue), ib = lerp(0.6, 1.0, hue);
    const glow = 0.55 + 0.45 * (1 - v);
    setColor(o, [0.12 + ir * 0.25, 0.12 + ig * 0.25, 0.12 + ib * 0.25], 1 - shelf * 0.35);
    o.rough = 0.05; o.metal = 0.3; o.h = 0.3;
    const k = (door ? 0.7 : 1) * glow * (1 - shelf * 0.5);
    o.er = ir * k; o.eg = ig * k; o.eb = ib * k;
  }, { normalStrength: 2, emissive: true });
}

function container(): PbrSet {
  const size = 512;
  const ridges = 20;
  return generate(size, size, [3, 2.6], (u, v, x, y, o) => {
    const s = Math.abs(((u * ridges) % 1) - 0.5) < 0.22 ? 1 : 0;
    const grain = hash2(x, y);
    const rust = smoothstep(0.62, 0.86, n(u, v, 4, 23));
    const grime = smoothstep(0.4, 1, v) * n(u, v, 8, 24);
    const top = v < 0.04 || v > 0.96 ? 1 : 0;
    setColor(o, [0.85, 0.85, 0.85], 0.92 - grime * 0.35 + (grain - 0.5) * 0.05 - top * 0.25);
    mixColor(o, [0.38, 0.2, 0.1], rust * 0.8);
    o.h = s * 0.8 + top * 0.2;
    o.rough = 0.55 + rust * 0.35;
    o.metal = 0.45 * (1 - rust);
  }, { normalStrength: 3.5 });
}

// ---------------------------------------------------------------------------
// Utility textures

function radial(size: number, stops: Array<[number, string]>): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [p, col] of stops) g.addColorStop(p, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function smokeTexture(): THREE.CanvasTexture {
  const size = 128;
  const [c, ctx] = makeCanvas(size, size);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x / size - 0.5, dy = y / size - 0.5;
      const d = Math.sqrt(dx * dx + dy * dy) * 2;
      const nn = n(x / size, y / size, 3, 30) * 0.6 + n(x / size, y / size, 7, 31) * 0.4;
      const a = clamp((1 - d) * 1.6, 0, 1) * clamp(nn * 1.6 - 0.25, 0, 1);
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = a * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function sparkTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.15, 'rgba(255,240,200,0.95)');
  g.addColorStop(0.4, 'rgba(255,160,60,0.35)');
  g.addColorStop(1, 'rgba(255,100,20,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function flashTexture(): THREE.CanvasTexture {
  const size = 128;
  const [c, ctx] = makeCanvas(size, size);
  ctx.translate(size / 2, size / 2);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, size / 2);
  g.addColorStop(0, 'rgba(255,255,240,1)');
  g.addColorStop(0.2, 'rgba(255,220,140,0.9)');
  g.addColorStop(0.5, 'rgba(255,140,40,0.35)');
  g.addColorStop(1, 'rgba(255,80,0,0)');
  ctx.fillStyle = g;
  for (let i = 0; i < 6; i++) {
    ctx.rotate(Math.PI / 3);
    ctx.beginPath();
    ctx.moveTo(-6, 0);
    ctx.lineTo(0, -size / 2);
    ctx.lineTo(6, 0);
    ctx.closePath();
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.22, 0, Math.PI * 2);
  ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function bulletHole(): THREE.CanvasTexture {
  const size = 64;
  const [c, ctx] = makeCanvas(size, size);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
  g.addColorStop(0, 'rgba(5,5,5,1)');
  g.addColorStop(0.18, 'rgba(15,15,15,0.95)');
  g.addColorStop(0.35, 'rgba(40,38,35,0.6)');
  g.addColorStop(0.7, 'rgba(60,58,55,0.18)');
  g.addColorStop(1, 'rgba(60,58,55,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  // cracks
  ctx.strokeStyle = 'rgba(20,20,20,0.5)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + hash2(i, 9) * 0.8;
    ctx.beginPath();
    ctx.moveTo(32, 32);
    ctx.lineTo(32 + Math.cos(a) * (12 + hash2(i, 3) * 14), 32 + Math.sin(a) * (12 + hash2(i, 4) * 14));
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function scorch(): THREE.CanvasTexture {
  const size = 128;
  const [c, ctx] = makeCanvas(size, size);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x / size - 0.5, dy = y / size - 0.5;
      const d = Math.sqrt(dx * dx + dy * dy) * 2;
      const nn = n(x / size, y / size, 4, 33);
      const a = clamp((1 - d) * 1.5 - nn * 0.5, 0, 1);
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 10;
      img.data[i + 3] = a * 230;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function waterNormal(): THREE.CanvasTexture {
  const size = 256;
  const hm = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      hm[y * size + x] = n(u, v, 4, 40) * 0.6 + n(u, v, 9, 41) * 0.3 + n(u, v, 17, 42) * 0.1;
    }
  }
  const c = normalFromHeight(hm, size, size, 6);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

function chainLink(): THREE.CanvasTexture {
  const size = 128;
  const [c, ctx] = makeCanvas(size, size);
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(190,195,200,1)';
  ctx.lineWidth = 3;
  const step = 32;
  for (let i = -size; i < size * 2; i += step) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + size, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(i + size, 0);
    ctx.lineTo(i, size);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export interface SignStyle {
  text: string;
  color: string;
  sub?: string;
  font?: string;
  width?: number;
  height?: number;
  frame?: boolean;
}

/** Neon sign texture: glowing tube lettering on a transparent background. */
export function neonTexture(s: SignStyle): THREE.CanvasTexture {
  const w = s.width ?? 512, h = s.height ?? 160;
  const [c, ctx] = makeCanvas(w, h);
  ctx.clearRect(0, 0, w, h);
  const font = s.font ?? '700';
  const size = Math.floor(h * (s.sub ? 0.46 : 0.62));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${font} ${size}px "Bebas Neue", "Arial Narrow", Impact, sans-serif`;
  let scaleX = 1;
  const measured = ctx.measureText(s.text).width;
  if (measured > w * 0.9) scaleX = (w * 0.9) / measured;
  const cy = s.sub ? h * 0.4 : h * 0.52;
  const draw = (blur: number, lw: number, col: string, alpha: number) => {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = s.color;
    ctx.shadowBlur = blur;
    ctx.strokeStyle = col;
    ctx.lineWidth = lw;
    ctx.translate(w / 2, cy);
    ctx.scale(scaleX, 1);
    ctx.strokeText(s.text, 0, 0);
    ctx.restore();
  };
  if (s.frame) {
    ctx.save();
    ctx.shadowColor = s.color;
    ctx.shadowBlur = 18;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 6;
    ctx.strokeRect(10, 10, w - 20, h - 20);
    ctx.restore();
  }
  draw(28, 10, s.color, 0.55);
  draw(10, 6, s.color, 0.9);
  draw(0, 2.5, '#ffffff', 1);
  if (s.sub) {
    ctx.save();
    ctx.font = `600 ${Math.floor(h * 0.2)}px "Rajdhani", "Arial", sans-serif`;
    ctx.shadowColor = s.color;
    ctx.shadowBlur = 12;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(s.sub, w / 2, h * 0.8);
    ctx.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Billboard poster art (original fictional brands). */
export function billboardTexture(kind: number): THREE.CanvasTexture {
  const w = 1024, h = 384;
  const [c, ctx] = makeCanvas(w, h);
  const themes = [
    { a: '#0b1d3a', b: '#1f6fb2', title: 'HALVERN BAY FERRIES', sub: 'THE CITY LOOKS BETTER FROM THE WATER', accent: '#ffd36b' },
    { a: '#2a0a12', b: '#d2333f', title: 'KESSEL', sub: 'ENERGY THAT KEEPS THE NIGHT AWAKE', accent: '#ffffff' },
    { a: '#121212', b: '#3b3b3b', title: 'VANTA MOTORS', sub: 'BUILT FOR STREETS THAT NEVER SLEEP', accent: '#e8a33d' },
    { a: '#06221d', b: '#18a382', title: 'CALDER BANK', sub: 'YOUR MONEY. OUR HARBOR.', accent: '#e6fff7' },
  ];
  const th = themes[kind % themes.length];
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, th.a);
  g.addColorStop(1, th.b);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 0.15;
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = i % 2 ? '#ffffff' : '#000000';
    ctx.beginPath();
    ctx.arc(w * 0.78 + Math.cos(i) * 60, h * 0.5 + Math.sin(i * 1.3) * 50, 160 - i * 9, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = th.accent;
  ctx.font = '700 120px "Bebas Neue", Impact, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(th.title, 50, h * 0.42);
  ctx.fillStyle = '#ffffff';
  ctx.font = '600 34px "Rajdhani", Arial, sans-serif';
  ctx.fillText(th.sub, 54, h * 0.72);
  ctx.strokeStyle = th.accent;
  ctx.lineWidth = 6;
  ctx.strokeRect(14, 14, w - 28, h - 28);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Spray-painted graffiti tag decal (original). */
export function graffitiTexture(kind: number): THREE.CanvasTexture {
  const w = 512, h = 256;
  const [c, ctx] = makeCanvas(w, h);
  const words = ['SABLE', 'NO KINGS', 'TIDE RISES', 'LANTERN LIES', 'D7'];
  const colors = ['#ff4a3d', '#5fd3e8', '#e8a33d', '#b36bff', '#7dff8a'];
  const word = words[kind % words.length];
  const col = colors[kind % colors.length];
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-0.08 + hash2(kind, 2) * 0.16);
  ctx.font = '700 110px "Bebas Neue", Impact, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 18;
  ctx.strokeText(word, 0, 0);
  ctx.fillStyle = col;
  ctx.fillText(word, 0, 0);
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = '#fff';
  ctx.fillText(word, -3, -4);
  // drips
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = col;
  for (let i = 0; i < 8; i++) {
    const x = -180 + hash2(i, kind) * 360;
    ctx.fillRect(x, 30, 4, 20 + hash2(kind, i) * 50);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------

export class TextureLibrary {
  asphalt!: PbrSet;
  sidewalk!: PbrSet;
  concrete!: PbrSet;
  brick!: PbrSet;
  pavers!: PbrSet;
  gravel!: PbrSet;
  corrugated!: PbrSet;
  wood!: PbrSet;
  roof!: PbrSet;
  metalPlate!: PbrSet;
  hazard!: PbrSet;
  container!: PbrSet;
  storefront!: PbrSet;
  facades = {} as Record<FacadeStyle, PbrSet>;
  lightPool!: THREE.Texture;
  softParticle!: THREE.Texture;
  smoke!: THREE.Texture;
  spark!: THREE.Texture;
  flash!: THREE.Texture;
  bulletHole!: THREE.Texture;
  scorch!: THREE.Texture;
  waterNormal!: THREE.Texture;
  chainLink!: THREE.Texture;
  glow!: THREE.Texture;

  /** Generate all textures, yielding between steps so the loading bar animates. */
  async generate(onStep: (label: string, frac: number) => void): Promise<void> {
    const steps: Array<[string, () => void]> = [
      ['Paving the streets', () => { this.asphalt = asphalt(); }],
      ['Pouring sidewalks', () => { this.sidewalk = sidewalk(); this.pavers = pavers(); }],
      ['Mixing concrete', () => { this.concrete = concrete(); this.gravel = gravel(); }],
      ['Laying brick', () => { this.brick = brick(); this.roof = roof(); }],
      ['Forging steel', () => { this.corrugated = corrugated(); this.metalPlate = metalPlate(); this.hazard = hazard(); this.wood = wood(); }],
      ['Stacking containers', () => { this.container = container(); }],
      ['Raising towers', () => { this.facades.office = facade('office'); this.facades.modern = facade('modern'); }],
      ['Building apartments', () => { this.facades.apartment = facade('apartment'); this.facades.brick = facade('brick'); }],
      ['Opening shops', () => { this.facades.industrial = facade('industrial'); this.storefront = storefront(); }],
      ['Wiring the lights', () => {
        this.lightPool = radial(128, [[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.55)'], [0.7, 'rgba(255,255,255,0.15)'], [1, 'rgba(255,255,255,0)']]);
        this.softParticle = radial(64, [[0, 'rgba(255,255,255,1)'], [0.5, 'rgba(255,255,255,0.45)'], [1, 'rgba(255,255,255,0)']]);
        this.glow = radial(128, [[0, 'rgba(255,255,255,1)'], [0.12, 'rgba(255,255,255,0.8)'], [0.4, 'rgba(255,255,255,0.18)'], [1, 'rgba(255,255,255,0)']]);
        this.smoke = smokeTexture();
        this.spark = sparkTexture();
        this.flash = flashTexture();
        this.bulletHole = bulletHole();
        this.scorch = scorch();
        this.waterNormal = waterNormal();
        this.chainLink = chainLink();
      }],
    ];
    for (let i = 0; i < steps.length; i++) {
      onStep(steps[i][0], i / steps.length);
      await new Promise<void>((r) => setTimeout(r, 0));
      steps[i][1]();
    }
    onStep('Textures ready', 1);
  }

  dispose(): void {
    const all: Array<THREE.Texture | undefined> = [];
    const pushSet = (s?: PbrSet) => s && all.push(s.map, s.orm, s.normal, s.emissive);
    [this.asphalt, this.sidewalk, this.concrete, this.brick, this.pavers, this.gravel, this.corrugated, this.wood,
      this.roof, this.metalPlate, this.hazard, this.container, this.storefront, ...Object.values(this.facades)].forEach(pushSet);
    all.push(this.lightPool, this.softParticle, this.smoke, this.spark, this.flash, this.bulletHole, this.scorch,
      this.waterNormal, this.chainLink, this.glow);
    for (const t of all) t?.dispose();
  }
}
