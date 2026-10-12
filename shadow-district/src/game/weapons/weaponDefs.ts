export type WeaponId = 'rifle' | 'pistol' | 'shotgun';

export interface WeaponDef {
  id: WeaponId;
  slot: 1 | 2 | 3;
  name: string;
  shortName: string;
  automatic: boolean;
  /** Seconds between shots. */
  fireInterval: number;
  damage: number;
  pellets: number;
  headshotMultiplier: number;
  magSize: number;
  startReserve: number;
  maxReserve: number;
  reloadTime: number;
  /** Shotgun-style shell-by-shell reload. */
  perShellReload: boolean;
  /** Cone half-angle in degrees. */
  spreadHip: number;
  spreadAds: number;
  spreadPerShot: number;
  spreadMax: number;
  spreadRecovery: number;
  recoilPitch: number;
  recoilYaw: number;
  range: number;
  falloffStart: number;
  falloffMinMultiplier: number;
  /** How far gunfire carries for AI hearing, meters. */
  loudness: number;
  equipTime: number;
  ammoPickup: number;
  /** Muzzle offset in weapon local space. */
  muzzle: [number, number, number];
  cameraKick: number;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  rifle: {
    id: 'rifle',
    slot: 1,
    name: 'VK-7 Carbine',
    shortName: 'CARBINE',
    automatic: true,
    fireInterval: 0.1,
    damage: 24,
    pellets: 1,
    headshotMultiplier: 2.4,
    magSize: 30,
    startReserve: 150,
    maxReserve: 270,
    reloadTime: 2.1,
    perShellReload: false,
    spreadHip: 1.6,
    spreadAds: 0.35,
    spreadPerShot: 0.32,
    spreadMax: 4.5,
    spreadRecovery: 9,
    recoilPitch: 0.55,
    recoilYaw: 0.28,
    range: 160,
    falloffStart: 45,
    falloffMinMultiplier: 0.6,
    loudness: 60,
    equipTime: 0.45,
    ammoPickup: 60,
    muzzle: [0, 0.035, -0.72],
    cameraKick: 0.12,
  },
  pistol: {
    id: 'pistol',
    slot: 2,
    name: 'M9 Warden',
    shortName: 'WARDEN',
    automatic: false,
    fireInterval: 0.17,
    damage: 34,
    pellets: 1,
    headshotMultiplier: 2.6,
    magSize: 12,
    startReserve: 60,
    maxReserve: 120,
    reloadTime: 1.35,
    perShellReload: false,
    spreadHip: 1.1,
    spreadAds: 0.2,
    spreadPerShot: 0.55,
    spreadMax: 3.5,
    spreadRecovery: 7,
    recoilPitch: 1.5,
    recoilYaw: 0.35,
    range: 90,
    falloffStart: 25,
    falloffMinMultiplier: 0.55,
    loudness: 45,
    equipTime: 0.32,
    ammoPickup: 24,
    muzzle: [0, 0.06, -0.2],
    cameraKick: 0.16,
  },
  shotgun: {
    id: 'shotgun',
    slot: 3,
    name: 'Breaker 12',
    shortName: 'BREAKER',
    automatic: false,
    fireInterval: 0.85,
    damage: 15,
    pellets: 9,
    headshotMultiplier: 1.5,
    magSize: 7,
    startReserve: 21,
    maxReserve: 42,
    reloadTime: 0.52,
    perShellReload: true,
    spreadHip: 5.2,
    spreadAds: 3.6,
    spreadPerShot: 1.5,
    spreadMax: 7,
    spreadRecovery: 5,
    recoilPitch: 4.2,
    recoilYaw: 0.9,
    range: 45,
    falloffStart: 9,
    falloffMinMultiplier: 0.25,
    loudness: 70,
    equipTime: 0.55,
    ammoPickup: 8,
    muzzle: [0, 0.03, -0.82],
    cameraKick: 0.38,
  },
};

export const WEAPON_ORDER: WeaponId[] = ['rifle', 'pistol', 'shotgun'];

export function damageAtDistance(def: WeaponDef, dist: number): number {
  if (dist <= def.falloffStart) return def.damage;
  const t = Math.min(1, (dist - def.falloffStart) / Math.max(1, def.range - def.falloffStart));
  return def.damage * (1 - t * (1 - def.falloffMinMultiplier));
}
