/**
 * STUB — the character module replaces this file with the full procedural humanoid.
 * The exported API below is the contract used by Player.ts and the enemy module; keep it stable.
 */
import * as THREE from 'three';
import type { WeaponId } from '../weapons/weaponDefs';
import type { EnemyArchetype } from '../contracts';

export interface HumanoidAppearance {
  skin: number;
  hair: number;
  hairStyle: 'short' | 'buzz' | 'none';
  jacket: number;
  jacketStyle: 'jacket' | 'hoodie' | 'tactical' | 'coat';
  shirt: number;
  pants: number;
  shoes: number;
  gloves: number;
  headgear: 'none' | 'cap' | 'beanie' | 'balaclava' | 'helmet';
  headgearColor: number;
  vest: boolean;
  vestColor: number;
  /** Emissive accent color (enemy armband / visor strip) or null. */
  accent: number | null;
  beard: boolean;
  /** Overall height scale (~0.96–1.06). */
  scale: number;
  /** Girth multiplier (0.9–1.25; heavies are bulkier). */
  bulk: number;
}

/** Inputs the controller (player or AI) writes every frame; the humanoid animates from them. */
export interface AnimInput {
  /** World-space horizontal velocity (m/s). */
  moveVelocity: THREE.Vector3;
  /** Facing of the body (yaw convention: faces (-sin, 0, -cos)). */
  bodyYaw: number;
  /** Where the weapon points. */
  aimYaw: number;
  /** Radians, positive = up. */
  aimPitch: number;
  grounded: boolean;
  verticalSpeed: number;
  crouched: boolean;
  sprinting: boolean;
  /** Weapon shouldered and pointing along aim (aiming or firing); false = low-ready. */
  weaponRaised: boolean;
  /** Aim-down-sights (tighter, slightly lower stance). */
  ads: boolean;
  /** -1 when not reloading, else 0..1. */
  reloadProgress: number;
  /** -1 when not switching, else 0..1 (weapon swapped at 0.5). */
  switchProgress: number;
  /** In cover and crouched behind it (AI). */
  inCover: boolean;
}

/** World-space hitboxes, refreshed by update(). */
export interface Hitbox {
  head: THREE.Vector3;
  headRadius: number;
  torsoA: THREE.Vector3;
  torsoB: THREE.Vector3;
  torsoRadius: number;
  legsA: THREE.Vector3;
  legsB: THREE.Vector3;
  legsRadius: number;
}

export function defaultAnimInput(): AnimInput {
  return {
    moveVelocity: new THREE.Vector3(),
    bodyYaw: 0,
    aimYaw: 0,
    aimPitch: 0,
    grounded: true,
    verticalSpeed: 0,
    crouched: false,
    sprinting: false,
    weaponRaised: false,
    ads: false,
    reloadProgress: -1,
    switchProgress: -1,
    inCover: false,
  };
}

export class Humanoid {
  /** Root at the feet; position/rotation are written by update() from anim + setPosition. */
  readonly root = new THREE.Group();
  readonly anim: AnimInput = defaultAnimInput();
  readonly hitbox: Hitbox = {
    head: new THREE.Vector3(), headRadius: 0.13,
    torsoA: new THREE.Vector3(), torsoB: new THREE.Vector3(), torsoRadius: 0.24,
    legsA: new THREE.Vector3(), legsB: new THREE.Vector3(), legsRadius: 0.17,
  };
  dead = false;
  /** 0..1 progress of the death collapse. */
  deathProgress = 0;
  weapon: WeaponId | null = null;

  constructor(readonly appearance: HumanoidAppearance) {}

  /** Place the character's feet in the world. */
  setPosition(p: THREE.Vector3): void {
    this.root.position.copy(p);
  }
  setWeapon(id: WeaponId | null): void {
    this.weapon = id;
  }
  /** Recoil kick / shotgun pump / slide. */
  triggerFire(): void {}
  /** Flinch away from dir with strength 0..1. */
  triggerHit(dir: THREE.Vector3, strength: number): void {
    void dir; void strength;
  }
  /** Landing dip with impact 0..1. */
  triggerLand(impact: number): void {
    void impact;
  }
  /** Play the death collapse falling along dir. */
  die(dir: THREE.Vector3, headshot = false): void {
    void dir; void headshot;
    this.dead = true;
  }
  revive(): void {
    this.dead = false;
    this.deathProgress = 0;
  }
  update(dt: number): void {
    void dt;
  }
  getMuzzle(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.root.position).setY(this.root.position.y + 1.4);
  }
  getMuzzleDir(out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, 0, -1);
  }
  getHead(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.hitbox.head);
  }
  getChest(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.root.position).setY(this.root.position.y + 1.3);
  }
  /** World position of the shell ejection port. */
  getEjectPort(out: THREE.Vector3): THREE.Vector3 {
    return this.getMuzzle(out);
  }
  setVisible(v: boolean): void {
    this.root.visible = v;
  }
  /** Emissive accent pulse (enemy alerted state), 0..1. */
  setAlertGlow(v: number): void {
    void v;
  }
  dispose(): void {}
}

export const PLAYER_APPEARANCE: HumanoidAppearance = {
  skin: 0xc68c6a, hair: 0x1c1612, hairStyle: 'short', jacket: 0x2b2f36, jacketStyle: 'jacket', shirt: 0x6b6f75,
  pants: 0x2a2e36, shoes: 0x1a1a1a, gloves: 0x1d1d1d, headgear: 'none', headgearColor: 0x222222, vest: true,
  vestColor: 0x3b3a33, accent: null, beard: true, scale: 1, bulk: 1,
};

export const ENEMY_APPEARANCES: Record<EnemyArchetype, HumanoidAppearance> = {
  grunt: {
    skin: 0xb98a6a, hair: 0x221a14, hairStyle: 'buzz', jacket: 0x34363a, jacketStyle: 'hoodie', shirt: 0x222222,
    pants: 0x3a3a3c, shoes: 0x151515, gloves: 0x111111, headgear: 'beanie', headgearColor: 0x1f1f22, vest: false,
    vestColor: 0x2a2a2a, accent: 0xff3b2f, beard: false, scale: 1, bulk: 1,
  },
  enforcer: {
    skin: 0x8d5f45, hair: 0x111111, hairStyle: 'buzz', jacket: 0x4a1f1c, jacketStyle: 'jacket', shirt: 0x161616,
    pants: 0x26262a, shoes: 0x121212, gloves: 0x111111, headgear: 'balaclava', headgearColor: 0x141414, vest: true,
    vestColor: 0x2b2b2b, accent: 0xff3b2f, beard: false, scale: 1.04, bulk: 1.1,
  },
  marksman: {
    skin: 0xd2a07e, hair: 0x3a2a1d, hairStyle: 'short', jacket: 0x2e3a33, jacketStyle: 'coat', shirt: 0x1b1b1b,
    pants: 0x2b302c, shoes: 0x161616, gloves: 0x151515, headgear: 'cap', headgearColor: 0x1b1d1c, vest: false,
    vestColor: 0x2a2a2a, accent: 0xff7a2f, beard: false, scale: 0.98, bulk: 0.95,
  },
  heavy: {
    skin: 0xa77a5c, hair: 0x111111, hairStyle: 'none', jacket: 0x1f2124, jacketStyle: 'tactical', shirt: 0x111111,
    pants: 0x1d1f22, shoes: 0x0f0f0f, gloves: 0x0f0f0f, headgear: 'helmet', headgearColor: 0x23262a, vest: true,
    vestColor: 0x1a1c1e, accent: 0xff2a1f, beard: true, scale: 1.06, bulk: 1.25,
  },
};
