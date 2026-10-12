import * as THREE from 'three';

export interface CoverPoint {
  id: number;
  pos: THREE.Vector3;
  /** Horizontal unit vector pointing from the point toward the protecting obstacle. */
  toObstacle: THREE.Vector3;
  /** Low cover (crouch behind) vs high cover (peek around the edge). */
  low: boolean;
  occupant: number;
}

/** Cover points generated around obstacles, stored in a coarse spatial hash. */
export class CoverSystem {
  points: CoverPoint[] = [];
  private cells = new Map<string, CoverPoint[]>();
  private readonly cellSize = 12;
  private seq = 0;

  private key(x: number, z: number): string {
    return `${Math.floor(x / this.cellSize)},${Math.floor(z / this.cellSize)}`;
  }

  addPoint(pos: THREE.Vector3, toObstacle: THREE.Vector3, low: boolean): void {
    const p: CoverPoint = { id: this.seq++, pos: pos.clone(), toObstacle: toObstacle.clone().setY(0).normalize(), low, occupant: -1 };
    this.points.push(p);
    const k = this.key(pos.x, pos.z);
    let list = this.cells.get(k);
    if (!list) {
      list = [];
      this.cells.set(k, list);
    }
    list.push(p);
  }

  /**
   * Generate points around an oriented rectangular obstacle.
   * Low obstacles get points along every side; tall ones get points near corners.
   */
  addObstacle(cx: number, cz: number, hw: number, hd: number, rotY: number, height: number, isWalkable: (x: number, z: number) => boolean): void {
    const low = height < 1.5;
    if (height < 0.8) return; // too low to protect a crouched character
    const cos = Math.cos(rotY), sin = Math.sin(rotY);
    const toWorld = (lx: number, lz: number, out: THREE.Vector3) =>
      out.set(cx + lx * cos + lz * sin, 0, cz - lx * sin + lz * cos);
    const dirWorld = (lx: number, lz: number, out: THREE.Vector3) => out.set(lx * cos + lz * sin, 0, -lx * sin + lz * cos);
    const gap = 0.75;
    const p = new THREE.Vector3(), d = new THREE.Vector3();
    const sides: Array<[number, number, number, number, number]> = [
      // [nx, nz, half-length along side, offset, along axis (0 = x, 1 = z)]
      [0, 1, hw, hd, 0],
      [0, -1, hw, hd, 0],
      [1, 0, hd, hw, 1],
      [-1, 0, hd, hw, 1],
    ];
    for (const [nx, nz, halfLen, off] of sides) {
      const spots: number[] = [];
      if (low) {
        const count = Math.max(1, Math.floor((halfLen * 2) / 2.2));
        for (let i = 0; i < count; i++) spots.push(-halfLen + ((i + 0.5) / count) * halfLen * 2);
      } else {
        // corners only, slightly inset so a character can peek out
        if (halfLen > 0.8) spots.push(-halfLen + 0.55, halfLen - 0.55);
        else spots.push(0);
      }
      for (const s of spots) {
        const lx = nx !== 0 ? nx * (off + gap) : s;
        const lz = nz !== 0 ? nz * (off + gap) : s;
        toWorld(lx, lz, p);
        if (!isWalkable(p.x, p.z)) continue;
        dirWorld(-nx, -nz, d);
        this.addPoint(p, d, low);
      }
    }
  }

  query(x: number, z: number, radius: number, out: CoverPoint[]): CoverPoint[] {
    out.length = 0;
    const r2 = radius * radius;
    const c0x = Math.floor((x - radius) / this.cellSize), c1x = Math.floor((x + radius) / this.cellSize);
    const c0z = Math.floor((z - radius) / this.cellSize), c1z = Math.floor((z + radius) / this.cellSize);
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const list = this.cells.get(`${cx},${cz}`);
        if (!list) continue;
        for (const p of list) {
          const dx = p.pos.x - x, dz = p.pos.z - z;
          if (dx * dx + dz * dz <= r2) out.push(p);
        }
      }
    }
    return out;
  }

  releaseAll(): void {
    for (const p of this.points) p.occupant = -1;
  }

  release(occupant: number): void {
    for (const p of this.points) if (p.occupant === occupant) p.occupant = -1;
  }
}
