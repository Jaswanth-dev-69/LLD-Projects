import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface BoxOpts {
  /** World size covered by one texture repeat [u, v]. */
  uv?: [number, number];
  /** UV offset in texture units. */
  uvOffset?: [number, number];
  /** 'bottom' puts y=0 at the base, 'center' centers the box. */
  origin?: 'bottom' | 'center';
  faces?: Partial<Record<'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz', boolean>>;
}

/** Indexed box with UVs in world units so textures keep their real scale. */
export function boxGeo(w: number, h: number, d: number, opts: BoxOpts = {}): THREE.BufferGeometry {
  const [su, sv] = opts.uv ?? [1, 1];
  const [ou, ov] = opts.uvOffset ?? [0, 0];
  const y0 = opts.origin === 'bottom' ? 0 : -h / 2;
  const y1 = y0 + h;
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2;
  const faces = { px: true, nx: true, py: true, ny: true, pz: true, nz: true, ...(opts.faces ?? {}) };
  const pos: number[] = [], nor: number[] = [], uvs: number[] = [], idx: number[] = [];
  const quad = (
    a: [number, number, number], b: [number, number, number], c: [number, number, number], dd: [number, number, number],
    n: [number, number, number], uvA: [number, number], uvB: [number, number], uvC: [number, number], uvD: [number, number],
  ) => {
    const base = pos.length / 3;
    pos.push(...a, ...b, ...c, ...dd);
    nor.push(...n, ...n, ...n, ...n);
    for (const t of [uvA, uvB, uvC, uvD]) uvs.push(t[0] / su + ou, t[1] / sv + ov);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const hv0 = y0 - (opts.origin === 'bottom' ? 0 : y0); // v measured from the base
  const hv1 = hv0 + h;
  // +Z (front)
  if (faces.pz) quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [0, hv0], [w, hv0], [w, hv1], [0, hv1]);
  // -Z (back)
  if (faces.nz) quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], [w, hv0], [2 * w, hv0], [2 * w, hv1], [w, hv1]);
  // +X (right)
  if (faces.px) quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], [0, hv0], [d, hv0], [d, hv1], [0, hv1]);
  // -X (left)
  if (faces.nx) quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], [d, hv0], [2 * d, hv0], [2 * d, hv1], [d, hv1]);
  // +Y (top)
  if (faces.py) quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [x0, -z1], [x1, -z1], [x1, -z0], [x0, -z0]);
  // -Y (bottom)
  if (faces.ny) quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], [x0, z0], [x1, z0], [x1, z1], [x0, z1]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  return g;
}

/** Horizontal plane (facing up) centered at origin, world-scaled UVs. */
export function planeGeo(w: number, d: number, uv: [number, number] = [1, 1], uvOffset: [number, number] = [0, 0]): THREE.BufferGeometry {
  return boxGeo(w, 0, d, { uv, uvOffset, origin: 'center', faces: { px: false, nx: false, pz: false, nz: false, ny: false } });
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const _p = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export function trs(x: number, y: number, z: number, rotY = 0, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
  _q.setFromAxisAngle(_up, rotY);
  _s.set(sx, sy, sz);
  _p.set(x, y, z);
  return new THREE.Matrix4().compose(_p, _q, _s);
}

/** Normalize a geometry to the attribute set used by the batcher (position/normal/uv, indexed). */
export function normalizeGeometry(g: THREE.BufferGeometry): THREE.BufferGeometry {
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) {
    const n = g.attributes.position.count;
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  }
  if (!g.index) {
    const n = g.attributes.position.count;
    const idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    g.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  g.morphAttributes = {};
  return g;
}

interface Bucket {
  material: THREE.Material;
  geos: THREE.BufferGeometry[];
  castShadow: boolean;
  receiveShadow: boolean;
}

/**
 * Collects static geometry and merges it per (material, spatial chunk) to keep draw
 * calls low while still allowing frustum culling of distant chunks.
 */
export class StaticBatcher {
  private buckets = new Map<string, Bucket>();
  readonly chunkSize: number;
  meshes: THREE.Mesh[] = [];

  constructor(chunkSize = 72) {
    this.chunkSize = chunkSize;
  }

  add(
    geo: THREE.BufferGeometry,
    material: THREE.Material,
    matrix?: THREE.Matrix4,
    opts: { castShadow?: boolean; receiveShadow?: boolean } = {},
  ): void {
    const g = normalizeGeometry(geo);
    if (matrix) g.applyMatrix4(matrix);
    g.computeBoundingBox();
    const c = g.boundingBox!.getCenter(_p);
    const cx = Math.floor(c.x / this.chunkSize), cz = Math.floor(c.z / this.chunkSize);
    const cast = opts.castShadow ?? true;
    const recv = opts.receiveShadow ?? true;
    const key = `${material.uuid}|${cx},${cz}|${cast ? 1 : 0}${recv ? 1 : 0}`;
    let b = this.buckets.get(key);
    if (!b) {
      b = { material, geos: [], castShadow: cast, receiveShadow: recv };
      this.buckets.set(key, b);
    }
    b.geos.push(g);
  }

  build(parent: THREE.Object3D): THREE.Mesh[] {
    for (const b of this.buckets.values()) {
      const merged = b.geos.length === 1 ? b.geos[0] : mergeGeometries(b.geos, false);
      if (!merged) continue;
      if (b.geos.length > 1) b.geos.forEach((g) => g.dispose());
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      const mesh = new THREE.Mesh(merged, b.material);
      mesh.castShadow = b.castShadow;
      mesh.receiveShadow = b.receiveShadow;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      parent.add(mesh);
      this.meshes.push(mesh);
    }
    this.buckets.clear();
    return this.meshes;
  }

  dispose(): void {
    for (const m of this.meshes) {
      m.geometry.dispose();
      m.removeFromParent();
    }
    this.meshes = [];
  }
}

export interface PropPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  castShadow?: boolean;
  receiveShadow?: boolean;
  /** Use the per-instance color for this part. */
  tinted?: boolean;
}

interface PropInstance {
  matrix: THREE.Matrix4;
  color: THREE.Color | null;
}

/** Instanced rendering for repeated props, chunked spatially for culling. */
export class InstancedProps {
  private kinds = new Map<string, PropPart[]>();
  private instances = new Map<string, PropInstance[]>();
  meshes: THREE.InstancedMesh[] = [];
  private chunkSize: number;

  constructor(chunkSize = 96) {
    this.chunkSize = chunkSize;
  }

  define(kind: string, parts: PropPart[]): void {
    this.kinds.set(kind, parts);
  }

  has(kind: string): boolean {
    return this.kinds.has(kind);
  }

  add(kind: string, matrix: THREE.Matrix4, color?: THREE.Color | number): void {
    if (!this.kinds.has(kind)) throw new Error(`Unknown prop kind ${kind}`);
    let list = this.instances.get(kind);
    if (!list) {
      list = [];
      this.instances.set(kind, list);
    }
    list.push({ matrix, color: color === undefined ? null : new THREE.Color(color) });
  }

  build(parent: THREE.Object3D): void {
    const pos = new THREE.Vector3();
    for (const [kind, list] of this.instances) {
      const parts = this.kinds.get(kind)!;
      // group by chunk
      const chunks = new Map<string, PropInstance[]>();
      for (const inst of list) {
        pos.setFromMatrixPosition(inst.matrix);
        const key = `${Math.floor(pos.x / this.chunkSize)},${Math.floor(pos.z / this.chunkSize)}`;
        let c = chunks.get(key);
        if (!c) {
          c = [];
          chunks.set(key, c);
        }
        c.push(inst);
      }
      for (const group of chunks.values()) {
        for (const part of parts) {
          const mesh = new THREE.InstancedMesh(part.geometry, part.material, group.length);
          mesh.castShadow = part.castShadow ?? true;
          mesh.receiveShadow = part.receiveShadow ?? true;
          group.forEach((inst, i) => {
            mesh.setMatrixAt(i, inst.matrix);
            if (part.tinted) mesh.setColorAt(i, inst.color ?? new THREE.Color(1, 1, 1));
          });
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
          mesh.computeBoundingSphere();
          mesh.matrixAutoUpdate = false;
          mesh.name = `props:${kind}`;
          parent.add(mesh);
          this.meshes.push(mesh);
        }
      }
    }
    this.instances.clear();
  }

  dispose(): void {
    const geos = new Set<THREE.BufferGeometry>();
    for (const m of this.meshes) {
      geos.add(m.geometry);
      m.dispose();
      m.removeFromParent();
    }
    for (const parts of this.kinds.values()) parts.forEach((p) => geos.add(p.geometry));
    geos.forEach((g) => g.dispose());
    this.meshes = [];
  }
}

/** Merge several (geometry, matrix) pairs into one geometry (same material). */
export function mergeParts(parts: Array<[THREE.BufferGeometry, THREE.Matrix4?]>): THREE.BufferGeometry {
  const geos = parts.map(([g, m]) => {
    const c = normalizeGeometry(g.clone());
    if (m) c.applyMatrix4(m);
    return c;
  });
  const merged = mergeGeometries(geos, false)!;
  geos.forEach((g) => g.dispose());
  parts.forEach(([g]) => g.dispose());
  return merged;
}

export function cyl(rTop: number, rBot: number, h: number, seg = 10, y0 = 0): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg);
  g.translate(0, y0 + h / 2, 0);
  return g;
}

export { _m as tmpMatrix };
