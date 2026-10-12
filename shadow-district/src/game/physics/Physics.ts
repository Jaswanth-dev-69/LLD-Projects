import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export type Surface = 'concrete' | 'metal' | 'wood' | 'glass' | 'dirt' | 'flesh' | 'water';

// Interaction group bits.
export const G_WORLD = 0x0001;
export const G_PLAYER = 0x0002;
export const G_ENEMY = 0x0004;
export const G_VEHICLE = 0x0008;
export const G_TRIGGER = 0x0010;
export const G_CAMERA_BLOCK = 0x0020;

export function groups(membership: number, filter: number): number {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}

/** Query masks. */
export const MASK_SHOTS = groups(0xffff, G_WORLD | G_VEHICLE);
export const MASK_LOS = groups(0xffff, G_WORLD | G_VEHICLE);
export const MASK_CAMERA = groups(0xffff, G_WORLD | G_VEHICLE | G_CAMERA_BLOCK);
export const MASK_PLAYER_MOVE = groups(0xffff, G_WORLD | G_ENEMY | G_VEHICLE);
export const MASK_ENEMY_MOVE = groups(0xffff, G_WORLD | G_PLAYER | G_ENEMY | G_VEHICLE);
export const MASK_VEHICLE_MOVE = groups(0xffff, G_WORLD | G_ENEMY | G_VEHICLE);
export const MASK_GROUND = groups(0xffff, G_WORLD | G_VEHICLE);

export interface RayHit {
  distance: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  collider: RAPIER.Collider;
  surface: Surface;
}

export interface CharacterBody {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  controller: RAPIER.KinematicCharacterController;
  radius: number;
  halfHeight: number;
}

let rapierReady: Promise<void> | null = null;
export function initRapier(): Promise<void> {
  if (!rapierReady) rapierReady = RAPIER.init();
  return rapierReady;
}

export class Physics {
  readonly world: RAPIER.World;
  private surfaces = new Map<number, Surface>();
  private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  private ballCache = new Map<number, RAPIER.Ball>();
  private staticCount = 0;
  /** Colliders that can be removed per mission (gates, vans). */
  private dynamicStatics = new Set<number>();

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / 60;
  }

  get staticColliderCount(): number {
    return this.staticCount;
  }

  /** Axis-aligned (optionally yaw-rotated) static box. Position is the box center. */
  addBox(
    cx: number, cy: number, cz: number,
    hx: number, hy: number, hz: number,
    surface: Surface = 'concrete',
    rotY = 0,
    group = G_WORLD,
  ): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cuboid(Math.max(0.01, hx), Math.max(0.01, hy), Math.max(0.01, hz))
      .setTranslation(cx, cy, cz)
      .setCollisionGroups(groups(group, 0xffff))
      .setFriction(0.6);
    if (rotY !== 0) {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
      desc.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    }
    const c = this.world.createCollider(desc);
    this.surfaces.set(c.handle, surface);
    this.staticCount++;
    return c;
  }

  /** Static box with arbitrary rotation (used for ramps). */
  addOrientedBox(center: THREE.Vector3, half: THREE.Vector3, quat: THREE.Quaternion, surface: Surface = 'concrete'): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
      .setTranslation(center.x, center.y, center.z)
      .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
      .setCollisionGroups(groups(G_WORLD, 0xffff));
    const c = this.world.createCollider(desc);
    this.surfaces.set(c.handle, surface);
    this.staticCount++;
    return c;
  }

  addCylinder(cx: number, cy: number, cz: number, halfHeight: number, radius: number, surface: Surface = 'metal'): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cylinder(halfHeight, radius)
      .setTranslation(cx, cy, cz)
      .setCollisionGroups(groups(G_WORLD, 0xffff));
    const c = this.world.createCollider(desc);
    this.surfaces.set(c.handle, surface);
    this.staticCount++;
    return c;
  }

  /** Mark a collider as mission-scoped so it can be removed on reset. */
  markDynamicStatic(c: RAPIER.Collider): void {
    this.dynamicStatics.add(c.handle);
  }

  removeCollider(c: RAPIER.Collider | null | undefined): void {
    if (!c) return;
    if (!this.world.getCollider(c.handle)) return;
    this.surfaces.delete(c.handle);
    this.dynamicStatics.delete(c.handle);
    this.world.removeCollider(c, false);
  }

  setSurface(c: RAPIER.Collider, surface: Surface): void {
    this.surfaces.set(c.handle, surface);
  }

  surfaceOf(c: RAPIER.Collider): Surface {
    return this.surfaces.get(c.handle) ?? 'concrete';
  }

  createCharacter(
    radius: number,
    halfHeight: number,
    pos: THREE.Vector3,
    group: number,
  ): CharacterBody {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y + halfHeight + radius, pos.z),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(halfHeight, radius).setCollisionGroups(groups(group, 0xffff)),
      body,
    );
    this.surfaces.set(collider.handle, 'flesh');
    const controller = this.world.createCharacterController(0.03);
    controller.setUp({ x: 0, y: 1, z: 0 });
    controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    controller.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    controller.enableAutostep(0.42, 0.18, false);
    controller.enableSnapToGround(0.35);
    controller.setApplyImpulsesToDynamicBodies(false);
    controller.setSlideEnabled(true);
    return { body, collider, controller, radius, halfHeight };
  }

  /** Create a kinematic box body (vehicles) controlled by a character controller. */
  createKinematicBox(half: THREE.Vector3, pos: THREE.Vector3, group: number): CharacterBody {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y, pos.z),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setCollisionGroups(groups(group, 0xffff)),
      body,
    );
    this.surfaces.set(collider.handle, 'metal');
    const controller = this.world.createCharacterController(0.05);
    controller.setUp({ x: 0, y: 1, z: 0 });
    controller.setMaxSlopeClimbAngle((35 * Math.PI) / 180);
    controller.enableSnapToGround(0.5);
    controller.enableAutostep(0.3, 0.3, false);
    controller.setSlideEnabled(true);
    return { body, collider, controller, radius: half.x, halfHeight: half.y };
  }

  removeCharacter(ch: CharacterBody): void {
    this.surfaces.delete(ch.collider.handle);
    if (this.world.getRigidBody(ch.body.handle)) this.world.removeRigidBody(ch.body);
    this.world.removeCharacterController(ch.controller);
  }

  /** Move a character by desired delta; returns the corrected movement and grounded flag. */
  moveCharacter(ch: CharacterBody, desired: THREE.Vector3, mask: number, out: THREE.Vector3): boolean {
    ch.controller.computeColliderMovement(
      ch.collider,
      { x: desired.x, y: desired.y, z: desired.z },
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      mask,
    );
    const m = ch.controller.computedMovement();
    out.set(m.x, m.y, m.z);
    const t = ch.body.translation();
    ch.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
    return ch.controller.computedGrounded();
  }

  teleportCharacter(ch: CharacterBody, feet: THREE.Vector3): void {
    const y = feet.y + ch.halfHeight + ch.radius;
    ch.body.setTranslation({ x: feet.x, y, z: feet.z }, true);
    ch.body.setNextKinematicTranslation({ x: feet.x, y, z: feet.z });
  }

  raycast(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxDist: number,
    mask: number = MASK_SHOTS,
    exclude?: RAPIER.Collider,
  ): RayHit | null {
    this.ray.origin = { x: origin.x, y: origin.y, z: origin.z };
    this.ray.dir = { x: dir.x, y: dir.y, z: dir.z };
    const hit = this.world.castRayAndGetNormal(
      this.ray, maxDist, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, mask, exclude,
    );
    if (!hit) return null;
    const d = hit.timeOfImpact;
    return {
      distance: d,
      point: new THREE.Vector3(origin.x + dir.x * d, origin.y + dir.y * d, origin.z + dir.z * d),
      normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
      collider: hit.collider,
      surface: this.surfaceOf(hit.collider),
    };
  }

  /** Distance to the first obstacle along a ray (no allocation), or maxDist. */
  rayDistance(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, mask: number = MASK_LOS): number {
    this.ray.origin = { x: origin.x, y: origin.y, z: origin.z };
    this.ray.dir = { x: dir.x, y: dir.y, z: dir.z };
    const hit = this.world.castRay(this.ray, maxDist, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, mask);
    return hit ? hit.timeOfImpact : maxDist;
  }

  private tmpDir = new THREE.Vector3();
  /** True if the straight segment a→b is free of world geometry. */
  lineOfSight(a: THREE.Vector3, b: THREE.Vector3, mask: number = MASK_LOS): boolean {
    const d = this.tmpDir.subVectors(b, a);
    const len = d.length();
    if (len < 1e-4) return true;
    d.multiplyScalar(1 / len);
    return this.rayDistance(a, d, len, mask) >= len - 0.05;
  }

  /** Sphere sweep; returns travel distance before contact (or maxDist). */
  sphereCast(origin: THREE.Vector3, dir: THREE.Vector3, radius: number, maxDist: number, mask: number = MASK_CAMERA): number {
    let ball = this.ballCache.get(radius);
    if (!ball) {
      ball = new RAPIER.Ball(radius);
      this.ballCache.set(radius, ball);
    }
    const hit = this.world.castShape(
      { x: origin.x, y: origin.y, z: origin.z },
      { x: 0, y: 0, z: 0, w: 1 },
      { x: dir.x, y: dir.y, z: dir.z },
      ball,
      0,
      maxDist,
      true,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      mask,
    );
    return hit ? hit.time_of_impact : maxDist;
  }

  /** Height of the ground below a point (or null). */
  groundHeight(x: number, z: number, fromY = 60, mask = MASK_GROUND): number | null {
    this.ray.origin = { x, y: fromY, z };
    this.ray.dir = { x: 0, y: -1, z: 0 };
    const hit = this.world.castRay(this.ray, fromY + 20, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, mask);
    return hit ? fromY - hit.timeOfImpact : null;
  }

  step(dt: number): void {
    this.world.timestep = Math.min(1 / 30, Math.max(1 / 240, dt));
    this.world.step();
  }

  dispose(): void {
    this.world.free();
    this.surfaces.clear();
    this.ballCache.clear();
  }
}
