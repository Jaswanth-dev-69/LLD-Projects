/**
 * CROSS-MODULE CONTRACTS.
 *
 * Every subsystem is a class constructed as `new X(ctx: GameContext)` and is reached by other
 * subsystems ONLY through the `GameContext` interfaces below (never by importing another
 * subsystem's implementation file). Construction order is irrelevant: subsystems must not touch
 * other subsystems in their constructor — only in `init()` (called after everything exists, in the
 * order listed in Game.ts) and later.
 *
 * Frame update order (Game.update):
 *   cameraRig.updateLook → vehicles.update → player.update → weapons.update → enemies.update →
 *   physics.step → pickups.update → interactions (Game) → missions.update → world.update →
 *   atmosphere.update → effects.update → cameraRig.update → audio.updateListener → hud.update → render
 */
import type * as THREE from 'three';
import type { RenderSystem } from './engine/Renderer';
import type { Physics, CharacterBody } from './physics/Physics';
import type { EventBus } from './engine/Events';
import type { Input } from './engine/Input';
import type { TextureLibrary, FacadeStyle } from './world/textures';
import type { MaterialLibrary } from './world/materials';
import type { Combat, Hittable } from './engine/Combat';
import type { Interactions } from './engine/Interactions';
import type { NavGrid } from './world/NavGrid';
import type { CoverSystem } from './world/Cover';
import type { Settings, GraphicsSettings, AudioSettings, DIFFICULTY_TUNING } from './state/settings';
import type { Progress } from './state/save';
import type { WeaponId } from './weapons/weaponDefs';
import type { Surface } from './physics/Physics';
import type { BoxOpts } from './world/geom';
import type { Rng } from './engine/math';

export type DifficultyTuning = (typeof DIFFICULTY_TUNING)['normal'];

export interface GameClock {
  /** Gameplay seconds since the current session started (does not advance while paused). */
  time: number;
  /** Clamped frame delta in seconds (<= 1/20). */
  dt: number;
  frame: number;
}

export interface GameContext {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly render: RenderSystem;
  readonly physics: Physics;
  readonly events: EventBus;
  readonly input: Input;
  readonly textures: TextureLibrary;
  readonly materials: MaterialLibrary;
  readonly clock: GameClock;
  readonly combat: Combat;
  readonly interactions: Interactions;
  world: IWorld;
  atmosphere: IAtmosphere;
  effects: IEffects;
  audio: IAudio;
  player: IPlayer;
  cameraRig: ICameraRig;
  weapons: IWeaponSystem;
  enemies: IEnemyManager;
  pickups: IPickups;
  missions: IMissionManager;
  vehicles: IVehicleManager;
  hud: IHudBridge;
  settings(): Settings;
  difficulty(): DifficultyTuning;
  progress(): Progress;
  /** Mutate + persist campaign progress (collectibles, unlocks). */
  saveProgress(mutator: (p: Progress) => void): void;
  /** Game-flow hooks implemented by Game. */
  flow: IGameFlow;
}

export interface IGameFlow {
  /** Hide the HUD / disable player control while a camera cinematic plays. */
  setCinematic(active: boolean): void;
  /** True while gameplay is running (not paused, not in menus). */
  isPlaying(): boolean;
}

// ---------------------------------------------------------------------------
// WORLD

export interface LightFixture {
  pos: THREE.Vector3;
  color: THREE.Color;
  /** Point light intensity (candela, physically based; ~25–80 for a street lamp). */
  intensity: number;
  /** Light range in meters. */
  distance: number;
  kind: 'street' | 'interior' | 'neon' | 'flood';
  /** Interior lights stay on in daylight; street/flood/neon follow the night factor. */
  alwaysOn?: boolean;
}

export interface MinimapData {
  /** Pre-rendered top-down map (north up, -Z at the top). */
  canvas: HTMLCanvasElement;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface LandmarkLabel {
  id: string;
  name: string;
  x: number;
  z: number;
}

export interface IWorld {
  readonly nav: NavGrid;
  readonly cover: CoverSystem;
  readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  readonly minimap: MinimapData;
  readonly lightFixtures: LightFixture[];
  readonly landmarks: LandmarkLabel[];
  readonly spawnPoints: Map<string, { pos: THREE.Vector3; yaw: number }>;
  /** Build all geometry, colliders, nav grid and cover. Called once during boot. */
  build(onProgress: (label: string, frac: number) => void): Promise<void>;
  init(): void;
  setGate(id: string, open: boolean, instant?: boolean): void;
  isGateOpen(id: string): boolean;
  /** Restore mission-resettable state (explosive barrels, gates to defaults). */
  resetDynamic(): void;
  /** 0 = day, 1 = full night: drives window/neon/street-lamp glow. */
  setNightFactor(n: number): void;
  /** Ground height under (x, z) via raycast (0 if nothing). */
  groundY(x: number, z: number, fromY?: number): number;
  /**
   * Standalone (non-instanced, collider-less) copy of a prop model for scripted/moving objects
   * such as mission vans. Origin at the base center, facing -Z. Caller adds/removes it from the scene.
   */
  createPropObject(kind: PropKind, color?: number): THREE.Group;
  update(dt: number): void;
  dispose(): void;
}

export type PropKind =
  | 'crate' | 'crateLarge' | 'pallet' | 'barrel' | 'dumpster' | 'jerseyBarrier' | 'trafficCone' | 'bench'
  | 'hydrant' | 'trashBags' | 'car' | 'van' | 'truck' | 'forklift' | 'palletRack' | 'container40' | 'container20'
  | 'tree' | 'planter' | 'acUnit' | 'waterTower' | 'streetlight' | 'trafficLight' | 'busStop' | 'newsBox'
  | 'table' | 'chair' | 'desk' | 'shelf' | 'locker' | 'sandbags' | 'cableSpool' | 'generator' | 'portaPotty'
  | 'pipeStack' | 'tire' | 'phoneBooth' | 'bollard' | 'kiosk' | 'barCounter' | 'sofa' | 'speakerStack' | 'antenna';

export interface PropOpts {
  /** Base height (defaults to the ground under the prop). */
  y?: number;
  /** Tint (cars, containers, painted metal). */
  color?: number;
  scale?: number;
  /** Override the kind's default collider / cover / nav registration. */
  collide?: boolean;
  cover?: boolean;
  nav?: boolean;
}

/**
 * Builder API used by the city generator AND the landmark builders (structures/*).
 * All placement helpers add visuals (batched/instanced), a static collider, nav-grid blocking
 * and cover points as appropriate, unless disabled by options.
 */
export interface WorldBuilder {
  readonly scene: THREE.Scene;
  readonly physics: Physics;
  readonly nav: NavGrid;
  readonly cover: CoverSystem;
  readonly materials: MaterialLibrary;
  readonly textures: TextureLibrary;
  readonly rng: Rng;
  /** Generic textured box. y is the BASE height (default: CURB_H). */
  box(o: {
    x: number; y?: number; z: number; w: number; h: number; d: number; rotY?: number;
    material: THREE.Material; uv?: [number, number]; faces?: BoxOpts['faces'];
    collide?: boolean; nav?: boolean; cover?: boolean; castShadow?: boolean; surface?: Surface;
  }): void;
  /** Facade building: walls + roof + parapet, optional ground-floor storefront band and rooftop clutter. */
  building(o: {
    x: number; z: number; w: number; d: number; h: number; style: FacadeStyle;
    y?: number; storefront?: boolean | Array<'n' | 's' | 'e' | 'w'>; roofProps?: boolean; parapet?: boolean;
  }): void;
  /** Straight wall from (x1,z1) to (x2,z2) with door/window openings measured as distance along the wall. */
  wall(o: {
    x1: number; z1: number; x2: number; z2: number; thickness: number; height: number; y?: number;
    material: THREE.Material; uv?: [number, number]; surface?: Surface;
    openings?: Array<{ from: number; to: number; bottom?: number; top: number }>;
  }): void;
  /** Flat walkable slab (floors, platforms, decks) with collider; top surface at y + thickness. */
  slab(o: { x: number; z: number; w: number; d: number; y: number; thickness?: number; material: THREE.Material; uv?: [number, number]; rotY?: number; surface?: Surface }): void;
  /** Walkable ramp: rises `rise` meters over `length` along local -Z (rotY rotates it). */
  ramp(o: { x: number; z: number; y?: number; width: number; length: number; rise: number; rotY: number; material: THREE.Material; thickness?: number }): void;
  /** Staircase built as a smooth walkable ramp collider plus visible steps. Rises along local -Z. */
  stairs(o: { x: number; z: number; y?: number; width: number; length: number; rise: number; rotY: number; material: THREE.Material; rails?: boolean }): void;
  /** Merged static mesh without collider. */
  mesh(geo: THREE.BufferGeometry, material: THREE.Material, matrix?: THREE.Matrix4, opts?: { castShadow?: boolean; receiveShadow?: boolean }): void;
  /** Collider-only box (y = base). */
  collider(o: { x: number; y?: number; z: number; w: number; h: number; d: number; rotY?: number; surface?: Surface; nav?: boolean }): void;
  prop(kind: PropKind, x: number, z: number, rotY?: number, opts?: PropOpts): void;
  /** Chain-link fence with posts, collider and nav blocking; gaps are distances along the fence. */
  fence(o: { x1: number; z1: number; x2: number; z2: number; height?: number; gaps?: Array<{ from: number; to: number }> }): void;
  /** Metal railing (waist high) with collider. */
  railing(o: { x1: number; z1: number; x2: number; z2: number; y?: number }): void;
  /** Sliding gate (mission controlled via IWorld.setGate). */
  gate(o: { id: string; x1: number; z1: number; x2: number; z2: number; height: number; slide: [number, number]; startOpen: boolean }): void;
  neonSign(o: { text: string; color: string; sub?: string; x: number; y: number; z: number; rotY: number; width: number; height: number; flicker?: boolean; light?: boolean }): void;
  billboard(o: { kind: number; x: number; y: number; z: number; rotY: number; width: number; height: number; lit?: boolean }): void;
  graffiti(o: { kind: number; x: number; y: number; z: number; rotY: number; width: number; height: number }): void;
  /** Register a light for the dynamic light pool, with an optional visual fixture. */
  light(f: LightFixture & { visual?: 'hanging' | 'wallpack' | 'flood' | 'none' }): void;
  explosiveBarrel(x: number, z: number, y?: number): void;
  spawnPoint(id: string, x: number, y: number, z: number, yaw: number): void;
  landmark(id: string, name: string, x: number, z: number): void;
  /** Ground surface patch (visual only, slightly above the block slab to avoid z-fighting). */
  groundPatch(o: { x: number; z: number; w: number; d: number; y?: number; material: THREE.Material; uv?: [number, number] }): void;
  /** Register an animated object updated every frame by the world (cranes, fans, beacons). */
  animate(fn: (dt: number, time: number, night: number) => void): void;
  /** Minimap drawing hint: a filled footprint (buildings) or outline. */
  mapShape(o: { x: number; z: number; w: number; d: number; rotY?: number; kind: 'building' | 'structure' | 'water' | 'park' | 'yard' }): void;
}

// ---------------------------------------------------------------------------
// ATMOSPHERE (sky, sun/moon, fog, env map, weather, dynamic light pool)

export type WeatherKind = 'clear' | 'rain';

export interface IAtmosphere {
  readonly nightFactor: number;
  /** 0 = golden hour, 0.5 = dusk, 1 = night. */
  readonly timeOfDay: number;
  readonly weather: WeatherKind;
  /** When true, free roam slowly advances time of day (golden hour → night → loops back). */
  freeRoamCycle: boolean;
  init(): void;
  setTimeOfDay(t: number): void;
  setWeather(w: WeatherKind): void;
  /** Brief global flash (lightning, big explosion). */
  flash(intensity: number): void;
  applyQuality(g: GraphicsSettings): void;
  /** focus = point to center shadows / rain / dynamic lights on (camera target). */
  update(dt: number, focus: THREE.Vector3): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// EFFECTS

export interface IEffects {
  init(): void;
  muzzleFlash(pos: THREE.Vector3, dir: THREE.Vector3, scale: number, light: boolean): void;
  tracer(from: THREE.Vector3, to: THREE.Vector3, enemy?: boolean): void;
  /** Bullet impact: sparks / dust by surface, plus a decal on solid surfaces. */
  impact(point: THREE.Vector3, normal: THREE.Vector3, surface: Surface): void;
  /** Restrained dark-red hit puff for character hits. */
  bloodHit(point: THREE.Vector3, dir: THREE.Vector3): void;
  explosion(pos: THREE.Vector3, radius: number): void;
  shellEject(pos: THREE.Vector3, dir: THREE.Vector3, weapon: WeaponId): void;
  smoke(pos: THREE.Vector3, scale: number, dark?: boolean): void;
  dust(pos: THREE.Vector3, scale: number): void;
  /** Pooled point-light flash. */
  lightFlash(pos: THREE.Vector3, color: number, intensity: number, distance: number, duration: number): void;
  update(dt: number): void;
  /** Remove all transient particles / decals (mission restart). */
  clear(): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// AUDIO

export type SfxId =
  | 'rifle' | 'pistol' | 'shotgun' | 'enemyRifle' | 'enemyPistol' | 'enemyShotgun'
  | 'reloadStart' | 'reloadEnd' | 'shellInsert' | 'pump' | 'dryFire' | 'weaponSwitch'
  | 'impactConcrete' | 'impactMetal' | 'impactWood' | 'impactGlass' | 'impactDirt' | 'impactFlesh'
  | 'bulletWhiz' | 'footstep' | 'footstepEnemy' | 'land' | 'jump'
  | 'hitmarker' | 'kill' | 'headshot' | 'playerHurt' | 'armorHit' | 'enemyHurt' | 'enemyDeath' | 'enemyAlert' | 'enemyBark'
  | 'pickupHealth' | 'pickupAmmo' | 'pickupArmor' | 'pickupItem' | 'pickupWeapon' | 'collectible'
  | 'explosion' | 'uiHover' | 'uiClick' | 'uiBack' | 'uiConfirm'
  | 'objective' | 'missionStart' | 'missionComplete' | 'missionFailed' | 'radio' | 'thunder'
  | 'gateOpen' | 'keypad' | 'carDoor' | 'carHorn' | 'carImpact' | 'heartbeat';

export interface PlayOpts {
  /** World position → positional (HRTF/equal-power panned, distance attenuated). Omit for 2D UI/player sounds. */
  position?: THREE.Vector3;
  volume?: number;
  /** Playback rate multiplier (pitch). */
  rate?: number;
  /** Distance at which the sound is inaudible (positional only). */
  maxDistance?: number;
}

export type LoopId = 'carEngine' | 'helicopter' | 'fire' | 'alarm';

export interface LoopHandle {
  setPosition(p: THREE.Vector3): void;
  /** intensity 0..1 drives pitch/volume of engines etc. */
  setParams(intensity: number, volume?: number): void;
  stop(): void;
}

export type MusicState = 'off' | 'menu' | 'explore' | 'tension' | 'combat' | 'victory' | 'defeat';

export interface IAudio {
  /** Resume/create the AudioContext; must be called from a user gesture. Safe to call repeatedly. */
  unlock(): Promise<void>;
  readonly unlocked: boolean;
  init(): void;
  setVolumes(a: AudioSettings): void;
  play(id: SfxId, opts?: PlayOpts): void;
  loop(id: LoopId, opts?: { position?: THREE.Vector3; volume?: number }): LoopHandle;
  setMusic(state: MusicState): void;
  /** Ambience mix: rain 0..1, night 0..1, harbor proximity 0..1, combat 0..1. */
  setAmbience(a: { rain?: number; night?: number; harbor?: number; combat?: number }): void;
  /** Muffles world audio while the pause menu is open. */
  setPaused(paused: boolean): void;
  updateListener(camera: THREE.Camera): void;
  stopAllLoops(): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// CHARACTERS (implemented in player/Humanoid.ts — concrete class imported directly by Player and enemies)

export type EnemyArchetype = 'grunt' | 'enforcer' | 'marksman' | 'heavy';

// ---------------------------------------------------------------------------
// PLAYER, CAMERA, WEAPONS

export interface IPlayer {
  /** Feet position (authoritative, updated during player.update). */
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  readonly character: CharacterBody;
  readonly hittable: Hittable;
  /** Root object of the visual character (Humanoid.root). */
  readonly object: THREE.Object3D;
  health: number;
  readonly maxHealth: number;
  armor: number;
  readonly maxArmor: number;
  readonly alive: boolean;
  readonly crouched: boolean;
  readonly sprinting: boolean;
  /** Right mouse held (aim-down-sights). */
  readonly aiming: boolean;
  /** Weapon shouldered (ADS or fired recently). */
  readonly weaponRaised: boolean;
  readonly grounded: boolean;
  bodyYaw: number;
  inVehicle: boolean;
  /** False during cinematics / vehicle / death. */
  controlsEnabled: boolean;
  /** 0..1 how much noise the player makes (enemy hearing): crouch-walk ≈ 0.15, sprint = 1. */
  readonly noise: number;
  /** clock.time of the last damage taken. */
  readonly lastDamageTime: number;
  readonly damageTaken: number;
  init(): void;
  /** Full reset: position, health, armor, stance, revive. Teleports the physics body. */
  spawn(pos: THREE.Vector3, yaw: number): void;
  damage(amount: number, from: THREE.Vector3 | null, source: 'enemy' | 'explosion' | 'fall'): void;
  heal(amount: number): boolean;
  addArmor(amount: number): boolean;
  setVisible(v: boolean): void;
  /** Move the player (and physics body) without resetting state (vehicle exit). */
  teleport(pos: THREE.Vector3, yaw?: number): void;
  eyePosition(out: THREE.Vector3): THREE.Vector3;
  /** Point the humanoid weapon/arms use as the muzzle (world space). */
  muzzlePosition(out: THREE.Vector3): THREE.Vector3;
  update(dt: number): void;
  dispose(): void;
}

export interface CinematicShot {
  duration: number;
  /** t in [0,1]. Position/orient the camera directly. */
  update(t: number, camera: THREE.PerspectiveCamera, dt: number): void;
  onComplete?: () => void;
}

export interface ICameraRig {
  yaw: number;
  pitch: number;
  /** Center-screen aim ray (origin = camera position, updated in update()). */
  readonly aimOrigin: THREE.Vector3;
  readonly aimDir: THREE.Vector3;
  readonly inCinematic: boolean;
  init(): void;
  /** Mouse look. Called first each frame. */
  updateLook(dt: number): void;
  /** Follow target (player or active vehicle), collision, ADS zoom, shake. Called late each frame. */
  update(dt: number): void;
  snapBehind(yaw: number, pitch?: number): void;
  addTrauma(amount: number): void;
  addRecoil(pitchDeg: number, yawDeg: number): void;
  playCinematic(shot: CinematicShot): void;
  stopCinematic(): void;
}

export interface WeaponState {
  id: WeaponId;
  owned: boolean;
  mag: number;
  reserve: number;
}

export interface IWeaponSystem {
  readonly current: WeaponId;
  readonly states: Record<WeaponId, WeaponState>;
  readonly reloading: boolean;
  /** 0..1 while reloading. */
  readonly reloadProgress: number;
  readonly switching: boolean;
  /** Current spread cone half-angle in degrees (crosshair size). */
  readonly spread: number;
  /** clock.time of the last shot (for weaponRaised). */
  readonly lastShotTime: number;
  shotsFired: number;
  shotsHit: number;
  headshots: number;
  enabled: boolean;
  init(): void;
  /** Replace the inventory. Missing weapons are un-owned. Ammo resets to startReserve and a full mag. */
  setLoadout(weapons: WeaponId[]): void;
  give(id: WeaponId): void;
  /** Add reserve ammo; returns false if nothing could be added. amount defaults to def.ammoPickup. */
  addAmmo(id: WeaponId | 'current' | 'all', amount?: number): boolean;
  equip(id: WeaponId): void;
  resetStats(): void;
  update(dt: number): void;
}

// ---------------------------------------------------------------------------
// ENEMIES

export type AlertState = 'idle' | 'suspicious' | 'searching' | 'combat';

export interface EnemySpawn {
  archetype: EnemyArchetype;
  pos: THREE.Vector3;
  yaw?: number;
  /** Patrol loop (feet positions). */
  patrol?: THREE.Vector3[];
  /** Holds position (perches, rooftops): never paths, may crouch/stand and turn. */
  stationary?: boolean;
  /** Mission tag for objective counting, e.g. 'm1-crew'. */
  tag?: string;
  /** Alert-sharing group (defaults to tag). */
  group?: string;
  /** Spawn already in combat, aware of the player (reinforcements). */
  alerted?: boolean;
  weapon?: WeaponId;
  /** Drop an ammo pickup on death (default true). */
  dropAmmo?: boolean;
}

export interface EnemyView {
  readonly id: number;
  readonly archetype: EnemyArchetype;
  readonly tag: string;
  readonly position: THREE.Vector3;
  readonly headPosition: THREE.Vector3;
  readonly alive: boolean;
  readonly alertState: AlertState;
  /** 0..1 detection meter (1 = combat). */
  readonly awareness: number;
  readonly health: number;
  readonly maxHealth: number;
}

export interface IEnemyManager {
  init(): void;
  spawn(s: EnemySpawn): number;
  /** Remove every enemy (alive and dead bodies), unregister hittables, release cover. */
  clear(): void;
  list(): readonly EnemyView[];
  alive(tag?: string): number;
  /** Deaths since the last clear() (optionally filtered by tag). */
  killed(tag?: string): number;
  alertGroup(groupOrTag: string, pos: THREE.Vector3): void;
  anyInCombat(): boolean;
  update(dt: number): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// PICKUPS

export type PickupKind = 'health' | 'armor' | 'ammo' | 'weapon' | 'item' | 'collectible';

export interface PickupSpawn {
  id: string;
  kind: PickupKind;
  pos: THREE.Vector3;
  weapon?: WeaponId;
  /** Display name, e.g. "Access Keycard". */
  label?: string;
  amount?: number;
  /** Collected by walking over it (enemy ammo drops) instead of pressing E. */
  auto?: boolean;
  scope?: 'mission' | 'world';
  onCollect?: () => void;
}

export interface IPickups {
  init(): void;
  spawn(p: PickupSpawn): void;
  remove(id: string): void;
  has(id: string): boolean;
  clear(scope: 'mission' | 'all'): void;
  update(dt: number): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// MISSIONS

export interface MissionInfo {
  id: string;
  index: number;
  codename: string;
  title: string;
  description: string;
  location: string;
  timeLabel: string;
}

export interface MissionStats {
  time: number;
  kills: number;
  headshots: number;
  shotsFired: number;
  shotsHit: number;
  damageTaken: number;
}

export interface ObjectiveMarker {
  pos: THREE.Vector3;
  label: string;
}

export interface IMissionManager {
  readonly missions: MissionInfo[];
  /** Index of the running mission, or null (free roam / idle). */
  readonly activeIndex: number | null;
  readonly freeRoam: boolean;
  init(): void;
  /** Reset world/entities and start a mission. Emits 'missionComplete' / 'missionFailed' via EventBus. */
  startMission(index: number, fromCheckpoint?: boolean): void;
  startFreeRoam(): void;
  hasCheckpoint(): boolean;
  /** Tear down all mission-scoped entities (enemies, pickups, interactables, vans, markers). */
  stop(): void;
  update(dt: number): void;
  missionTitle(): string;
  objectiveText(): string;
  objectiveProgress(): string;
  timerText(): string | null;
  markers(): ObjectiveMarker[];
  stats(): MissionStats;
  /** Called by Game when the player dies in free roam: respawn at the nearest safe point. */
  respawnFreeRoam(): void;
}

// ---------------------------------------------------------------------------
// VEHICLES

export interface IVehicle {
  readonly group: THREE.Group;
  readonly position: THREE.Vector3;
  readonly yaw: number;
  /** Signed forward speed m/s. */
  readonly speed: number;
}

export interface IVehicleManager {
  /** Vehicle the player is driving, or null. */
  readonly active: IVehicle | null;
  init(): void;
  /** Spawn (or move) the player's drivable car. */
  spawnPlayerCar(pos: THREE.Vector3, yaw: number): void;
  /** Force the player out (death, mission restart). */
  exitVehicle(): void;
  clear(): void;
  update(dt: number): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// HUD BRIDGE (engine → DOM, per-frame, no React re-render)

export type HudElement =
  | 'crosshair' | 'hitmarker' | 'damageIndicators' | 'vignette' | 'objectiveMarkers' | 'enemyMarkers'
  | 'minimap' | 'compass' | 'lowHealth' | 'reloadRing' | 'fps' | 'speedometer';

export interface IHudBridge {
  register(name: HudElement, el: HTMLElement | null): void;
  init(): void;
  /** Per-frame DOM updates + throttled (≈12 Hz) zustand HUD snapshot. */
  update(dt: number): void;
  hitConfirm(kind: 'hit' | 'kill' | 'headshot'): void;
  damageFrom(pos: THREE.Vector3 | null, amount: number): void;
  reset(): void;
}

// ---------------------------------------------------------------------------
// GAME API used by the React UI

export interface MissionListEntry extends MissionInfo {
  locked: boolean;
  completed: boolean;
  bestTime: number | null;
}

export interface GameAPI {
  startMission(index: number): void;
  startFreeRoam(): void;
  resume(): void;
  pause(): void;
  /** Restart the current mission (from the last checkpoint when fromCheckpoint). */
  restart(fromCheckpoint: boolean): void;
  quitToMenu(): void;
  /** From the mission-complete screen: start the next mission, or return to the menu. */
  continueAfterMission(): void;
  respawnFreeRoam(): void;
  applySettings(s: Settings): void;
  resetProgress(): void;
  requestPointerLock(): void;
  uiSound(kind: 'hover' | 'click' | 'back' | 'confirm'): void;
  missionList(): MissionListEntry[];
  hasCheckpoint(): boolean;
  hud: IHudBridge;
}
