/**
 * AUTHORITATIVE WORLD LAYOUT for Halvern Bay — "the Shadow District".
 * Every module (world builder, landmarks, missions, minimap) reads positions from here.
 *
 * Conventions:
 *  - Units are meters. Y is up. Ground (road surface) is y = 0.
 *  - Block tops (sidewalks, lots, yards) are raised to y = CURB_H.
 *  - North is -Z, south is +Z (the sea is to the south), east is +X.
 *  - Yaw: rotation about +Y. A character with yaw θ faces (-sin θ, 0, -cos θ).
 *    yaw 0 faces north (-Z), yaw π faces south (+Z), yaw -π/2 faces east (+X), yaw π/2 faces west (-X).
 */

export const WORLD = {
  minX: -190,
  maxX: 190,
  minZ: -190,
  /** Quay edge; the sea lies beyond (except the pier). */
  quayZ: 170,
  seaLevel: -1.8,
} as const;

export const ROAD_HALF = 7;
export const SIDEWALK = 5;
export const CURB_H = 0.15;
/** Road centerline to block edge. */
export const ROAD_CLEAR = ROAD_HALF + SIDEWALK; // 12

export interface RoadDef {
  name: string;
  /** Centerline coordinate (z for east-west roads, x for north-south). */
  at: number;
  /** Extent along the road axis. */
  from: number;
  to: number;
}

/** East-west roads (constant z). */
export const ROADS_EW: RoadDef[] = [
  { name: 'Northgate Avenue', at: -130, from: WORLD.minX, to: WORLD.maxX },
  { name: 'Calder Avenue', at: -50, from: WORLD.minX, to: WORLD.maxX },
  { name: 'Harbor Boulevard', at: 30, from: WORLD.minX, to: WORLD.maxX },
  { name: 'Dock Road', at: 105, from: WORLD.minX, to: WORLD.maxX },
];

/** North-south roads (constant x). Foundry Street ends at Dock Road. */
export const ROADS_NS: RoadDef[] = [
  { name: 'Foundry Street', at: -130, from: WORLD.minZ, to: 105 + ROAD_HALF },
  { name: 'Meridian Street', at: -50, from: WORLD.minZ, to: WORLD.quayZ },
  { name: 'Lantern Street', at: 30, from: WORLD.minZ, to: WORLD.quayZ },
  { name: 'Pier Street', at: 110, from: WORLD.minZ, to: WORLD.quayZ },
];

export type District = 'highway' | 'downtown' | 'commercial' | 'industrial' | 'docks';

export interface BlockDef {
  id: string;
  /** Outer bounds including the sidewalk ring. */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  district: District;
  /** If set, a landmark builder owns this block's interior (generic buildings are not placed). */
  landmark?: string;
}

/**
 * City blocks. Bounds are the block edges at the curb (road centerline ± 12 m, i.e. they include the sidewalk ring
 * which is SIDEWALK wide on sides that face a road). Blocks on the map edge extend to the boundary walls.
 */
export const BLOCKS: BlockDef[] = [
  // North strip (against the elevated highway wall)
  { id: 'N-W', minX: -188, maxX: -142, minZ: -188, maxZ: -142, district: 'highway' },
  { id: 'N-C1', minX: -118, maxX: -62, minZ: -188, maxZ: -142, district: 'highway' },
  { id: 'N-C2', minX: -38, maxX: 18, minZ: -188, maxZ: -142, district: 'highway' },
  { id: 'N-C3', minX: 42, maxX: 98, minZ: -188, maxZ: -142, district: 'highway' },
  { id: 'N-E', minX: 122, maxX: 188, minZ: -188, maxZ: -142, district: 'highway' },
  // Row 1 — downtown
  { id: 'R1-W', minX: -188, maxX: -142, minZ: -118, maxZ: -62, district: 'downtown' },
  { id: 'R1-C1', minX: -118, maxX: -62, minZ: -118, maxZ: -62, district: 'downtown' },
  { id: 'R1-C2', minX: -38, maxX: 18, minZ: -118, maxZ: -62, district: 'downtown', landmark: 'halvernTower' },
  { id: 'R1-C3', minX: 42, maxX: 98, minZ: -118, maxZ: -62, district: 'downtown', landmark: 'parkingGarage' },
  { id: 'R1-E', minX: 122, maxX: 188, minZ: -118, maxZ: -62, district: 'downtown' },
  // Row 2 — commercial
  { id: 'R2-W', minX: -188, maxX: -142, minZ: -38, maxZ: 18, district: 'commercial' },
  { id: 'R2-C1', minX: -118, maxX: -62, minZ: -38, maxZ: 18, district: 'commercial', landmark: 'safehouse' },
  { id: 'R2-C2', minX: -38, maxX: 18, minZ: -38, maxZ: 18, district: 'commercial', landmark: 'calderPlaza' },
  { id: 'R2-C3', minX: 42, maxX: 98, minZ: -38, maxZ: 18, district: 'commercial' },
  { id: 'R2-E', minX: 122, maxX: 188, minZ: -38, maxZ: 18, district: 'commercial', landmark: 'gasStation' },
  // Row 3 — industrial
  { id: 'R3-W', minX: -188, maxX: -142, minZ: 42, maxZ: 93, district: 'industrial', landmark: 'factory' },
  { id: 'R3-C1', minX: -118, maxX: -62, minZ: 42, maxZ: 93, district: 'industrial', landmark: 'warehouse7' },
  { id: 'R3-C2', minX: -38, maxX: 18, minZ: 42, maxZ: 93, district: 'industrial', landmark: 'construction' },
  { id: 'R3-C3', minX: 42, maxX: 98, minZ: 42, maxZ: 93, district: 'industrial' },
  { id: 'R3-E', minX: 122, maxX: 188, minZ: 42, maxZ: 93, district: 'industrial', landmark: 'substation' },
  // Row 4 — docks (the container yard spans the west and C1 columns: Foundry Street ends at Dock Road)
  { id: 'R4-YARD', minX: -188, maxX: -62, minZ: 117, maxZ: 170, district: 'docks', landmark: 'containerYard' },
  { id: 'R4-C2', minX: -38, maxX: 18, minZ: 117, maxZ: 170, district: 'docks', landmark: 'dryDock' },
  { id: 'R4-C3', minX: 42, maxX: 98, minZ: 117, maxZ: 170, district: 'docks', landmark: 'lantern' },
  { id: 'R4-E', minX: 122, maxX: 188, minZ: 117, maxZ: 170, district: 'docks', landmark: 'ferryTerminal' },
];

type V3 = [number, number, number];

/** Named spawn points / anchors (feet positions). */
export const SPAWNS = {
  /** Mission 1 start: in front of Kade's safehouse, facing south toward Harbor Boulevard. */
  safehouseDoor: { pos: [-92, CURB_H, 15] as V3, yaw: Math.PI },
  /** Mission 2 start: Warehouse 7 front yard. */
  warehouseYard: { pos: [-90, CURB_H, 47] as V3, yaw: Math.PI },
  /** Mission 3 start: Dock Road near the dry dock, west of the Lantern compound. */
  dryDockRoad: { pos: [-20, 0, 105] as V3, yaw: -Math.PI / 2 },
  /** Free roam start. */
  freeRoam: { pos: [-92, CURB_H, 15] as V3, yaw: Math.PI },
  /** Drivable car parking spot on Harbor Boulevard (north curb lane), facing east. */
  playerCar: { pos: [-106, 0, 26] as V3, yaw: -Math.PI / 2 },
};

/** WAREHOUSE 7 (Meridian Freight) — block R3-C1. */
export const WAREHOUSE7 = {
  /** Building shell (outer bounds). */
  minX: -110, maxX: -70, minZ: 58, maxZ: 88, height: 9, wallThickness: 0.5,
  /** Yard fence along z = 44 with a gate gap. */
  fenceZ: 44, fenceMinX: -116, fenceMaxX: -64, gateMinX: -96, gateMaxX: -86,
  /** Openings in the shell. */
  rollerDoor: { wall: 'north', minX: -94, maxX: -88, height: 5 }, // north wall at z = 58, open (raised)
  sideDoor: { wall: 'east', minZ: 70, maxZ: 71.6, height: 2.3 },   // east wall at x = -70
  backDoor: { wall: 'south', minX: -104, maxX: -102.4, height: 2.3 }, // south wall at z = 88
  /** Foreman's office inside the SE corner (interior walls 0.2 thick). */
  office: { minX: -80, maxX: -70.5, minZ: 78, maxZ: 87.5, doorWall: 'north', doorMinX: -77, doorMaxX: -75.6, height: 3 },
  keycard: [-74, CURB_H + 0.95, 84] as V3, // on the foreman's desk
  shotgunPickup: [-100, CURB_H + 0.95, 66] as V3, // on a crate inside
  /** Pallet racks run east-west inside; these lanes must stay clear (z ranges). */
  center: [-90, CURB_H, 73] as V3,
};

/** CONTAINER YARD — block R4-YARD. */
export const CONTAINER_YARD = {
  minX: -186, maxX: -64, minZ: 119, maxZ: 169,
  /** North fence along Dock Road's south sidewalk edge. */
  fenceZ: 118.5,
  /** Keycard-locked sliding gate in the north fence. */
  northGate: { id: 'yardNorth', minX: -104, maxX: -96, z: 118.5 },
  keypad: [-106.5, CURB_H + 1.2, 117.6] as V3,
  /** East gate (always open) in the east fence at x = -63.5. */
  eastGate: { minZ: 148, maxZ: 158, x: -63.5 },
  /** Two-storey shipping office (ground floor enterable, door on its east wall). */
  office: { minX: -172, maxX: -160, minZ: 124, maxZ: 133, height: 6.5, doorMinZ: 127.5, doorMaxZ: 129 },
  package: [-166, CURB_H + 0.95, 128.5] as V3,
  /** Gantry crane straddles this x range across the yard. */
  gantry: { minX: -142, maxX: -122, height: 26 },
  /** Keep these lanes free of containers. */
  mainLaneZ: [138, 143] as [number, number],
  gateApproach: { minX: -108, maxX: -92, minZ: 119, maxZ: 130 },
};

export type ContainerSize = '40' | '20';
export interface ContainerPlacement {
  x: number; z: number;
  /** 0 = long axis along X, 1 = long axis along Z. */
  axis: 0 | 1;
  size: ContainerSize;
  /** Stack level: 0 on the ground, 1 on top of another, 2 third tier. */
  level: number;
  color: number;
}

export const CONTAINER_DIMS = {
  '40': { length: 12.2, width: 2.44, height: 2.6 },
  '20': { length: 6.1, width: 2.44, height: 2.6 },
} as const;

const C = { red: 0x8c2f24, blue: 0x24476b, green: 0x2f5a3a, orange: 0xb3601f, grey: 0x5d6266, teal: 0x1f5c5c, yellow: 0xb08a22, white: 0xb9b9b2 };

/**
 * Container placements (center of footprint; the base sits at y = CURB_H + level * 2.6).
 * Stacks are explicit so missions can put marksmen on known perches.
 */
export const CONTAINERS: ContainerPlacement[] = [
  // West cluster (x -180 … -150)
  { x: -175, z: 150, axis: 0, size: '40', level: 0, color: C.blue },
  { x: -175, z: 150, axis: 0, size: '40', level: 1, color: C.red },
  { x: -175, z: 153, axis: 0, size: '40', level: 0, color: C.green },
  { x: -175, z: 160, axis: 0, size: '40', level: 0, color: C.grey },
  { x: -158, z: 150, axis: 0, size: '40', level: 0, color: C.orange },
  { x: -158, z: 153, axis: 0, size: '40', level: 0, color: C.teal },
  { x: -158, z: 153, axis: 0, size: '40', level: 1, color: C.white },
  { x: -158, z: 162, axis: 0, size: '20', level: 0, color: C.red },
  // Under / near the gantry (x -142 … -122)
  { x: -132, z: 130, axis: 0, size: '40', level: 0, color: C.blue },
  { x: -132, z: 133, axis: 0, size: '40', level: 0, color: C.yellow },
  { x: -132, z: 133, axis: 0, size: '40', level: 1, color: C.green },
  { x: -132, z: 150, axis: 0, size: '40', level: 0, color: C.red },
  { x: -132, z: 150, axis: 0, size: '40', level: 1, color: C.grey },
  { x: -132, z: 150, axis: 0, size: '40', level: 2, color: C.orange },
  { x: -132, z: 156, axis: 0, size: '40', level: 0, color: C.teal },
  // Middle cluster (x -118 … -100), south of the main lane
  { x: -112, z: 149, axis: 0, size: '40', level: 0, color: C.green },
  { x: -112, z: 149, axis: 0, size: '40', level: 1, color: C.blue },
  { x: -100, z: 156, axis: 0, size: '20', level: 0, color: C.white },
  { x: -112, z: 162, axis: 0, size: '40', level: 0, color: C.orange },
  // Gate-side cluster (east of the gate approach), north of the main lane
  { x: -84, z: 127, axis: 1, size: '40', level: 0, color: C.red },
  { x: -84, z: 127, axis: 1, size: '40', level: 1, color: C.teal },
  { x: -78, z: 127, axis: 1, size: '20', level: 0, color: C.grey },
  { x: -118, z: 128, axis: 1, size: '20', level: 0, color: C.yellow },
  // East cluster near the east gate
  { x: -88, z: 152, axis: 0, size: '40', level: 0, color: C.blue },
  { x: -88, z: 152, axis: 0, size: '40', level: 1, color: C.orange },
  { x: -80, z: 162, axis: 0, size: '40', level: 0, color: C.green },
];

/**
 * Perches on top of container stacks (feet positions). Accessible only to AI marksmen.
 * Each sits on a stack listed above (level 1 top = CURB_H + 5.2, level 2 top = CURB_H + 7.8).
 */
export const YARD_PERCHES: V3[] = [
  [-158, CURB_H + 5.2, 153],
  [-132, CURB_H + 7.8, 150],
  [-112, CURB_H + 5.2, 149],
  [-84, CURB_H + 5.2, 124],
  [-88, CURB_H + 5.2, 152],
];

/**
 * Metal stairs giving the PLAYER access to the top of the level-0 container at (-112, 162):
 * a straight flight centered on x = -112, rising toward +Z from zStart (ground, CURB_H) to zEnd (container top).
 */
export const YARD_PLAYER_STAIRS = { x: -112, zStart: 154.5, zEnd: 160.7, width: 1.4, rise: 2.6 };

/** DRY DOCK — block R4-C2. Mission 2 extraction is on Meridian Street at the van. */
export const DRY_DOCK = {
  extraction: [-50, 0, 150] as V3,
  extractionRadius: 5,
  vanPos: [-47.5, 0, 156] as V3,
  vanYaw: 0,
};

/** THE LANTERN (syndicate HQ in a converted cannery) — block R4-C3. */
export const LANTERN = {
  /** Compound wall bounds. */
  minX: 43.5, maxX: 97, minZ: 118.5, maxZ: 169,
  wallHeight: 3.2,
  /** Main gate in the north wall (Dock Road side). */
  mainGate: { minX: 62, maxX: 72, z: 118.5 },
  /** West gate on Lantern Street. */
  westGate: { minZ: 140, maxZ: 148, x: 43.5 },
  /** East gate toward Pier Street / the ferry terminal. */
  eastGate: { minZ: 124, maxZ: 132, x: 97 },
  /** Main hall building. */
  hall: { minX: 52, maxX: 92, minZ: 138, maxZ: 166, height: 12 },
  /** Front double doors in the hall's north wall (z = 138). */
  hallDoor: { minX: 68, maxX: 76, height: 4 },
  /** Office / vault room inside the SE corner; door on its west wall (x = 80). */
  office: { minX: 80, maxX: 91.5, minZ: 155, maxZ: 165.5, doorMinZ: 158, doorMaxZ: 160, height: 3.4 },
  ledger: [86, CURB_H + 0.95, 161] as V3,
  /** Courtyard between the north wall and the hall. */
  courtyard: { minX: 46, maxX: 95, minZ: 121, maxZ: 136 },
  /** Where reinforcement vans park after driving in through the main gate. */
  vanBays: [
    { pos: [56, 0, 128] as V3, yaw: Math.PI / 2 },
    { pos: [80, 0, 125] as V3, yaw: -Math.PI / 2 },
    { pos: [88, 0, 131] as V3, yaw: -Math.PI / 2 },
  ],
  /** Van entry path start (on Dock Road) for the reinforcement cinematic. */
  vanEntry: [67, 0, 100] as V3,
  /** The giant red lantern sign on the roof. */
  roofLantern: [72, 12, 152] as V3,
};

/** FERRY TERMINAL + PIER + HELIPAD — block R4-E and over the water. */
export const PIER = {
  /** Pier deck (top at CURB_H). */
  minX: 134, maxX: 152, minZ: 168, maxZ: 214,
  /** Wider helipad platform at the end. */
  pad: { minX: 130, maxX: 156, minZ: 214, maxZ: 240 },
  helipad: [143, CURB_H, 227] as V3,
  extractionRadius: 6,
};

/** Other landmarks (centers). */
export const LANDMARKS = {
  halvernTower: { pos: [-10, 0, -90] as V3, footprint: 30, height: 126 },
  parkingGarage: { minX: 48, maxX: 92, minZ: -112, maxZ: -68, levelHeight: 3.5, levels: 3 },
  calderPlaza: { center: [-10, CURB_H, -10] as V3, clockTowerHeight: 28 },
  constructionCrane: { pos: [6, 0, 80] as V3, height: 46 },
  factory: { minX: -184, maxX: -146, minZ: 48, maxZ: 90 },
  gasStation: { center: [150, CURB_H, -10] as V3 },
  safehouse: { minX: -100, maxX: -84, minZ: -4, maxZ: 12, doorX: -92 },
  substation: { minX: 128, maxX: 182, minZ: 48, maxZ: 88 },
};

/**
 * Lantern Tokens — optional collectibles. All must be reachable on foot
 * (ground level or on a walkable structure provided by the landmark builders).
 */
export const COLLECTIBLES: Array<{ id: string; pos: V3; hint: string }> = [
  { id: 'token-alley', pos: [-150, CURB_H + 0.5, -10], hint: 'A narrow alley off Foundry Street' },
  { id: 'token-plaza', pos: [-10, CURB_H + 0.5, 6], hint: 'Beside the Calder Plaza fountain' },
  { id: 'token-garage', pos: [86, CURB_H + 3 * 3.5 + 0.5, -74], hint: 'Top deck of the parking garage' },
  { id: 'token-crane', pos: [-6, CURB_H + 0.5, 86], hint: 'At the foot of the tower crane' },
  { id: 'token-pier', pos: [150, CURB_H + 0.5, 236], hint: 'The very end of the pier' },
  { id: 'token-container', pos: [-112, CURB_H + 2.6 + 0.5, 162], hint: 'On top of a container in the yard' },
  { id: 'token-tower', pos: [8, CURB_H + 0.5, -72], hint: 'Behind Halvern Tower' },
  { id: 'token-gas', pos: [176, CURB_H + 0.5, -30], hint: 'Behind the gas station' },
  { id: 'token-highway', pos: [-60, CURB_H + 0.5, -183], hint: 'Under the elevated highway' },
  { id: 'token-substation', pos: [184, CURB_H + 0.5, 92], hint: 'Outside the substation fence' },
];

/** Free-roam hostile hangouts (missions module spawns small respawning groups here). */
export const HANGOUTS: Array<{ id: string; center: V3; radius: number }> = [
  { id: 'hangout-factory', center: [-150, CURB_H, 96], radius: 8 },
  { id: 'hangout-substation', center: [116, 0, 70], radius: 8 },
  { id: 'hangout-yard', center: [-120, CURB_H, 141], radius: 10 },
];

export function inRect(x: number, z: number, r: { minX: number; maxX: number; minZ: number; maxZ: number }, pad = 0): boolean {
  return x >= r.minX - pad && x <= r.maxX + pad && z >= r.minZ - pad && z <= r.maxZ + pad;
}
