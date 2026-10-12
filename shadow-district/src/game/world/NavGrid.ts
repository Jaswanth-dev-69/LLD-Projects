import * as THREE from 'three';

/**
 * Ground-level navigation grid (1m cells) with A* + line-of-sight smoothing.
 * Obstacles are reference-counted so mission gates can open and close.
 */
export class NavGrid {
  readonly minX: number;
  readonly minZ: number;
  readonly cell: number;
  readonly w: number;
  readonly h: number;
  private block: Uint8Array;
  // A* scratch buffers (reused between searches; generation counter avoids clearing).
  private g: Float32Array;
  private f: Float32Array;
  private parent: Int32Array;
  private seen: Uint32Array;
  private closed: Uint32Array;
  private gen = 1;
  private heap: Int32Array;
  private heapSize = 0;
  searches = 0;

  constructor(minX: number, minZ: number, maxX: number, maxZ: number, cell = 1) {
    this.minX = minX;
    this.minZ = minZ;
    this.cell = cell;
    this.w = Math.ceil((maxX - minX) / cell);
    this.h = Math.ceil((maxZ - minZ) / cell);
    const n = this.w * this.h;
    this.block = new Uint8Array(n);
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.heap = new Int32Array(n);
  }

  toCell(x: number, z: number): [number, number] {
    return [Math.floor((x - this.minX) / this.cell), Math.floor((z - this.minZ) / this.cell)];
  }

  cellCenter(cx: number, cz: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.minX + (cx + 0.5) * this.cell, 0, this.minZ + (cz + 0.5) * this.cell);
  }

  private inBounds(cx: number, cz: number): boolean {
    return cx >= 0 && cz >= 0 && cx < this.w && cz < this.h;
  }

  /** Mark (or unmark with delta=-1) an oriented rectangle, inflated by `inflate`. */
  markRect(cx: number, cz: number, hw: number, hd: number, rotY = 0, inflate = 0.45, delta = 1): void {
    hw += inflate;
    hd += inflate;
    const cos = Math.cos(rotY), sin = Math.sin(rotY);
    const ex = Math.abs(hw * cos) + Math.abs(hd * sin);
    const ez = Math.abs(hw * sin) + Math.abs(hd * cos);
    const [x0, z0] = this.toCell(cx - ex, cz - ez);
    const [x1, z1] = this.toCell(cx + ex, cz + ez);
    for (let z = Math.max(0, z0); z <= Math.min(this.h - 1, z1); z++) {
      for (let x = Math.max(0, x0); x <= Math.min(this.w - 1, x1); x++) {
        const px = this.minX + (x + 0.5) * this.cell - cx;
        const pz = this.minZ + (z + 0.5) * this.cell - cz;
        // rotate into rect local space (inverse of rotY about Y)
        const lx = px * cos - pz * sin;
        const lz = px * sin + pz * cos;
        if (Math.abs(lx) <= hw && Math.abs(lz) <= hd) {
          const i = z * this.w + x;
          this.block[i] = Math.max(0, Math.min(255, this.block[i] + delta));
        }
      }
    }
  }

  markCircle(cx: number, cz: number, r: number, inflate = 0.45, delta = 1): void {
    const rr = r + inflate;
    const [x0, z0] = this.toCell(cx - rr, cz - rr);
    const [x1, z1] = this.toCell(cx + rr, cz + rr);
    for (let z = Math.max(0, z0); z <= Math.min(this.h - 1, z1); z++) {
      for (let x = Math.max(0, x0); x <= Math.min(this.w - 1, x1); x++) {
        const px = this.minX + (x + 0.5) * this.cell - cx;
        const pz = this.minZ + (z + 0.5) * this.cell - cz;
        if (px * px + pz * pz <= rr * rr) {
          const i = z * this.w + x;
          this.block[i] = Math.max(0, Math.min(255, this.block[i] + delta));
        }
      }
    }
  }

  /** Block everything outside a polygon-free rectangle region (used for bounds). */
  blockOutside(minX: number, minZ: number, maxX: number, maxZ: number): void {
    for (let z = 0; z < this.h; z++) {
      for (let x = 0; x < this.w; x++) {
        const px = this.minX + (x + 0.5) * this.cell;
        const pz = this.minZ + (z + 0.5) * this.cell;
        if (px < minX || px > maxX || pz < minZ || pz > maxZ) this.block[z * this.w + x] = Math.max(1, this.block[z * this.w + x]);
      }
    }
  }

  walkableCell(cx: number, cz: number): boolean {
    return this.inBounds(cx, cz) && this.block[cz * this.w + cx] === 0;
  }

  isWalkable(x: number, z: number): boolean {
    const [cx, cz] = this.toCell(x, z);
    return this.walkableCell(cx, cz);
  }

  /** Nearest walkable cell center within radius (spiral search). */
  nearestWalkable(x: number, z: number, out: THREE.Vector3, maxRadius = 8): boolean {
    const [cx, cz] = this.toCell(x, z);
    if (this.walkableCell(cx, cz)) {
      out.set(x, 0, z);
      return true;
    }
    for (let r = 1; r <= maxRadius; r++) {
      let best = -1, bestD = Infinity;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          const nx = cx + dx, nz = cz + dz;
          if (!this.walkableCell(nx, nz)) continue;
          const d = dx * dx + dz * dz;
          if (d < bestD) {
            bestD = d;
            best = nz * this.w + nx;
          }
        }
      }
      if (best >= 0) {
        this.cellCenter(best % this.w, Math.floor(best / this.w), out);
        return true;
      }
    }
    return false;
  }

  /** Grid ray march: is the straight line between a and b walkable? */
  lineWalkable(ax: number, az: number, bx: number, bz: number): boolean {
    const dx = bx - ax, dz = bz - az;
    const dist = Math.hypot(dx, dz);
    const steps = Math.ceil(dist / (this.cell * 0.35));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (!this.isWalkable(ax + dx * t, az + dz * t)) return false;
    }
    return true;
  }

  private push(i: number): void {
    const heap = this.heap, f = this.f;
    let k = this.heapSize++;
    heap[k] = i;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (f[heap[p]] <= f[heap[k]]) break;
      const t = heap[p]; heap[p] = heap[k]; heap[k] = t;
      k = p;
    }
  }

  private pop(): number {
    const heap = this.heap, f = this.f;
    const top = heap[0];
    const last = heap[--this.heapSize];
    if (this.heapSize > 0) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < this.heapSize && f[heap[l]] < f[heap[m]]) m = l;
        if (r < this.heapSize && f[heap[r]] < f[heap[m]]) m = r;
        if (m === k) break;
        const t = heap[m]; heap[m] = heap[k]; heap[k] = t;
        k = m;
      }
    }
    return top;
  }

  /**
   * A* from start to goal. Writes smoothed waypoints (excluding start) into `out`.
   * Returns false when no path exists within the expansion budget.
   */
  findPath(start: THREE.Vector3, goal: THREE.Vector3, out: THREE.Vector3[], maxExpand = 24000): boolean {
    out.length = 0;
    this.searches++;
    const s = new THREE.Vector3(), t = new THREE.Vector3();
    if (!this.nearestWalkable(start.x, start.z, s, 4)) return false;
    if (!this.nearestWalkable(goal.x, goal.z, t, 6)) return false;
    if (this.lineWalkable(s.x, s.z, t.x, t.z)) {
      out.push(new THREE.Vector3(t.x, 0, t.z));
      return true;
    }
    const [sx, sz] = this.toCell(s.x, s.z);
    const [tx, tz] = this.toCell(t.x, t.z);
    const w = this.w;
    const startI = sz * w + sx, goalI = tz * w + tx;
    this.gen++;
    if (this.gen > 0xfffffff0) {
      this.seen.fill(0);
      this.closed.fill(0);
      this.gen = 1;
    }
    const gen = this.gen;
    const heur = (i: number) => {
      const x = i % w, z = (i / w) | 0;
      const dx = Math.abs(x - tx), dz = Math.abs(z - tz);
      return (dx + dz) + (Math.SQRT2 - 2) * Math.min(dx, dz);
    };
    this.heapSize = 0;
    this.g[startI] = 0;
    this.f[startI] = heur(startI);
    this.parent[startI] = -1;
    this.seen[startI] = gen;
    this.push(startI);
    let expanded = 0;
    let found = false;
    const DX = [1, -1, 0, 0, 1, 1, -1, -1];
    const DZ = [0, 0, 1, -1, 1, -1, 1, -1];
    const COST = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];
    while (this.heapSize > 0) {
      const cur = this.pop();
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      if (cur === goalI) {
        found = true;
        break;
      }
      if (++expanded > maxExpand) break;
      const cx = cur % w, cz = (cur / w) | 0;
      for (let k = 0; k < 8; k++) {
        const nx = cx + DX[k], nz = cz + DZ[k];
        if (!this.walkableCell(nx, nz)) continue;
        if (k >= 4 && (!this.walkableCell(cx + DX[k], cz) || !this.walkableCell(cx, cz + DZ[k]))) continue; // no corner cutting
        const ni = nz * w + nx;
        if (this.closed[ni] === gen) continue;
        const ng = this.g[cur] + COST[k];
        if (this.seen[ni] !== gen || ng < this.g[ni]) {
          this.seen[ni] = gen;
          this.g[ni] = ng;
          this.f[ni] = ng + heur(ni) * 1.05;
          this.parent[ni] = cur;
          this.push(ni);
        }
      }
    }
    if (!found) return false;
    // Reconstruct
    const cells: number[] = [];
    for (let i = goalI; i !== -1; i = this.parent[i]) cells.push(i);
    cells.reverse();
    // String-pull smoothing
    const pts: THREE.Vector3[] = cells.map((i) => this.cellCenter(i % w, (i / w) | 0, new THREE.Vector3()));
    pts[pts.length - 1].set(t.x, 0, t.z);
    let anchor = new THREE.Vector3(s.x, 0, s.z);
    let i = 0;
    while (i < pts.length) {
      let j = pts.length - 1;
      while (j > i && !this.lineWalkable(anchor.x, anchor.z, pts[j].x, pts[j].z)) j--;
      out.push(pts[j].clone());
      anchor = pts[j];
      i = j + 1;
    }
    return true;
  }

  /** Random walkable point within radius of (x, z). */
  randomPointNear(x: number, z: number, radius: number, out: THREE.Vector3, tries = 12): boolean {
    for (let k = 0; k < tries; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = radius * Math.sqrt(Math.random());
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (this.isWalkable(px, pz)) {
        out.set(px, 0, pz);
        return true;
      }
    }
    return false;
  }

  /** Debug image of the grid (used by the minimap builder). */
  forEachBlocked(fn: (x: number, z: number) => void): void {
    for (let z = 0; z < this.h; z++) {
      for (let x = 0; x < this.w; x++) {
        if (this.block[z * this.w + x]) fn(this.minX + (x + 0.5) * this.cell, this.minZ + (z + 0.5) * this.cell);
      }
    }
  }
}
