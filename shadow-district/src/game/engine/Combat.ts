import * as THREE from 'three';
import type { Physics, Surface } from '../physics/Physics';
import { MASK_SHOTS } from '../physics/Physics';
import type { WeaponId } from '../weapons/weaponDefs';

export type HitPart = 'head' | 'body' | 'limb';
export type HittableKind = 'player' | 'enemy' | 'barrel' | 'vehicle';
export type DamageSource = 'player' | 'enemy' | 'explosion';

export interface DamageInfo {
  amount: number;
  part: HitPart;
  /** World-space impact point. */
  point: THREE.Vector3;
  /** Normalized travel direction of the bullet / blast. */
  dir: THREE.Vector3;
  /** Where the damage came from (shooter muzzle or blast center). */
  from: THREE.Vector3;
  source: DamageSource;
  weapon?: WeaponId;
  /** Hittable id of the attacker (-1 when unknown). */
  attackerId: number;
}

/** Anything bullets and explosions can damage (characters use analytic hitboxes). */
export interface Hittable {
  readonly id: number;
  readonly kind: HittableKind;
  readonly alive: boolean;
  /** Bounding sphere for cheap rejection. */
  readonly center: THREE.Vector3;
  readonly radius: number;
  /** Precise ray test against the hitbox; rd is normalized. */
  testRay(ro: THREE.Vector3, rd: THREE.Vector3, maxDist: number): { t: number; part: HitPart } | null;
  applyDamage(info: DamageInfo): void;
}

export interface CombatHit {
  distance: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  surface: Surface;
  /** The character/barrel hit, or null for world geometry. */
  target: Hittable | null;
  part: HitPart | null;
}

let hittableSeq = 1;
export function nextHittableId(): number {
  return hittableSeq++;
}

const _oc = new THREE.Vector3();

/**
 * Resolves shots against world geometry (Rapier) and character hitboxes (analytic).
 * Only the NEAREST intersection counts, so one ray can never damage the same target twice,
 * and walls in front of a target always stop the bullet.
 */
export class Combat {
  private hittables = new Set<Hittable>();
  constructor(private physics: Physics) {}

  register(h: Hittable): void {
    this.hittables.add(h);
  }

  unregister(h: Hittable): void {
    this.hittables.delete(h);
  }

  all(): Iterable<Hittable> {
    return this.hittables;
  }

  clearKind(kind: HittableKind): void {
    for (const h of Array.from(this.hittables)) if (h.kind === kind) this.hittables.delete(h);
  }

  raycast(
    ro: THREE.Vector3,
    rd: THREE.Vector3,
    maxDist: number,
    exclude: Hittable | null = null,
    ignoreKinds: HittableKind[] = [],
  ): CombatHit | null {
    const worldHit = this.physics.raycast(ro, rd, maxDist, MASK_SHOTS);
    let best = worldHit ? worldHit.distance : maxDist;
    let target: Hittable | null = null;
    let part: HitPart | null = null;
    for (const h of this.hittables) {
      if (h === exclude || !h.alive || ignoreKinds.includes(h.kind)) continue;
      // Bounding sphere reject.
      _oc.subVectors(h.center, ro);
      const tc = _oc.dot(rd);
      if (tc < -h.radius) continue;
      const d2 = _oc.lengthSq() - tc * tc;
      if (d2 > h.radius * h.radius) continue;
      const r = h.testRay(ro, rd, best);
      if (r && r.t < best) {
        best = r.t;
        target = h;
        part = r.part;
      }
    }
    if (target) {
      const point = ro.clone().addScaledVector(rd, best);
      return { distance: best, point, normal: rd.clone().negate(), surface: 'flesh', target, part };
    }
    if (worldHit) {
      return { distance: worldHit.distance, point: worldHit.point, normal: worldHit.normal, surface: worldHit.surface, target: null, part: null };
    }
    return null;
  }

  /**
   * Area damage with line-of-sight falloff. Targets fully behind walls take no damage.
   * Returns the hittables that were damaged.
   */
  radiusDamage(center: THREE.Vector3, radius: number, maxDamage: number, source: DamageSource, attackerId = -1): Hittable[] {
    const damaged: Hittable[] = [];
    const probe = new THREE.Vector3();
    for (const h of Array.from(this.hittables)) {
      if (!h.alive) continue;
      const dist = h.center.distanceTo(center);
      if (dist > radius + h.radius) continue;
      probe.copy(h.center);
      const visible = this.physics.lineOfSight(center, probe);
      if (!visible) continue;
      const falloff = 1 - Math.min(1, Math.max(0, dist - h.radius * 0.5) / radius);
      const amount = maxDamage * falloff * falloff;
      if (amount < 1) continue;
      const dir = probe.clone().sub(center);
      if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
      dir.normalize();
      h.applyDamage({
        amount,
        part: 'body',
        point: h.center.clone(),
        dir,
        from: center.clone(),
        source,
        attackerId,
      });
      damaged.push(h);
    }
    return damaged;
  }

  clear(): void {
    this.hittables.clear();
  }
}
