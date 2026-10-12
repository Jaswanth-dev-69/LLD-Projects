/**
 * STUB — the character module replaces this file with detailed procedural weapon models.
 * Contract: weapon local space has the barrel along -Z, up = +Y, origin at the right (trigger) hand grip.
 */
import * as THREE from 'three';
import type { WeaponId } from './weaponDefs';

export interface WeaponModel {
  id: WeaponId;
  group: THREE.Group;
  /** Muzzle tip (child of group). */
  muzzle: THREE.Object3D;
  /** Right-hand grip anchor (at the group origin). */
  gripRight: THREE.Object3D;
  /** Left-hand support anchor (handguard / pump / pistol off-hand). */
  gripLeft: THREE.Object3D;
  /** Detachable magazine (rifle/pistol) for reload animation, null for the shotgun. */
  magazine: THREE.Object3D | null;
  /** Pump slide (shotgun) or pistol slide, animated on fire. */
  slide: THREE.Object3D | null;
  ejectPort: THREE.Object3D;
  dispose(): void;
}

export function createWeaponModel(id: WeaponId): WeaponModel {
  const group = new THREE.Group();
  const mk = (name: string, z: number) => {
    const o = new THREE.Object3D();
    o.name = name;
    o.position.set(0, 0, z);
    group.add(o);
    return o;
  };
  return {
    id,
    group,
    muzzle: mk('muzzle', -0.7),
    gripRight: mk('gripRight', 0),
    gripLeft: mk('gripLeft', -0.35),
    magazine: null,
    slide: null,
    ejectPort: mk('eject', -0.1),
    dispose: () => {},
  };
}
