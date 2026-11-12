import type { WEAPONS } from './constants';

export type HairStyle = 'bald' | 'beanie' | 'swept' | 'mohawk' | 'helmet';
export type BeardStyle = 'full' | 'stubble' | 'mustache' | 'clean';
export type GlassesStyle = 'round' | 'aviators' | 'goggles' | 'none';
export type EarringStyle = 'cross' | 'hoop' | 'stud' | 'none';
export type Physique = 'lean' | 'toned' | 'muscular';
export type TorsoStyle = 'shirtless_harness' | 'tshirt_harness' | 'armored' | 'vest';
export type TattooStyle = 'geometric' | 'tribal' | 'biomech' | 'none';
export type TattooSlot = 'leftArm' | 'rightArm' | 'chest';
export type WeaponVisual = 'wood_shotgun' | 'tactical_shotgun' | 'tesla' | 'bioflare';
export type ChassisType = 'sidecar' | 'tandem';
export type SidecarPattern = 'stripes' | 'chevron' | 'rust' | 'solid';
export type SteerMode = 'SCREEN' | 'BIKE';
export type ZombieKind = 'walker' | 'runner' | 'clamberer' | 'mutant';

export interface PartTransform {
  offset: [number, number, number];
  scale: [number, number, number];
  rotation: [number, number, number];
}

export interface CharacterConfig {
  id: string;
  label: string;
  skinTone: string;
  physique: Physique;
  torsoStyle: TorsoStyle;
  hair: HairStyle;
  hairColor: string;
  beanieColor: string;
  beard: BeardStyle;
  beardColor: string;
  glasses: GlassesStyle;
  earring: EarringStyle;
  earringSide: 'left' | 'right';
  scarf: boolean;
  scarfColor: string;
  harnessColor: string;
  pantsColor: string;
  tattoos: Partial<Record<TattooSlot, TattooStyle>>;
  tattooDensity: number;
  weapon: WeaponVisual;
  partTweaks: Partial<Record<string, PartTransform>>;
}

export interface BikeConfig {
  chassis: ChassisType;
  sidecarPattern: SidecarPattern;
  tankColor: string;
  frameColor: string;
  stripeColor: string;
  seatColor: string;
  headlightColor: string;
  sidecarSide: 'right' | 'left';
  metallic: number;
  roughness: number;
}

export interface CouplePreset {
  name: string;
  rider1: CharacterConfig;
  rider2: CharacterConfig;
  bike: BikeConfig;
  seatsSwapped: boolean;
}

export interface ZombieVariantConfig {
  kind: ZombieKind;
  skin: string;
  shirt: string;
  eyeColor: string;
  scale: number;
}

export interface WeaponDef {
  name: string;
  cooldown: number;
  pellets: number;
  spread: number;
  speed: number;
  damage: number;
  color: number;
  explosive: boolean;
  /** 0 leaves the building. 1 opens that column. 2+ is a blast radius in cells. */
  breach: number;
  ignites: boolean;
}

export type WeaponIndex = 0 | 1 | 2;
export type WeaponList = typeof WEAPONS;

export interface BikeState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  speed: number;
  heading: number;
  steerAngle: number;
  leanAngle: number;
  drifting: boolean;
  driftCharge: number;
  hp: number;
  fuel: number;
}

export interface PartnerState {
  aimAngle: number;
  weaponIndex: WeaponIndex;
  lastFireTime: number;
  autoAim: boolean;
  driverFiring: boolean;
}

export interface TransitionState {
  active: boolean;
  progress: number;
  offsetX: number;
  offsetZ: number;
}

export interface GisPin {
  label: string;
  wx: number;
  wy: number;
  wz: number;
  type: 'road' | 'building' | 'addr' | 'poi';
  el?: HTMLElement;
}

export interface OsmRoad {
  points: [number, number][];
  /** Half-width in grid cells (converted from meters at parse time). */
  halfWidth: number;
  name: string;
  primary?: boolean;
  /** Thin walkways — paint as sidewalk, not drivable asphalt. */
  footpath?: boolean;
}

export type BuildingClass = 'generic' | 'church' | 'garage' | 'apartments' | 'retail' | 'industrial' | 'school';

export interface OsmBuilding {
  poly: [number, number][];
  inners?: [number, number][][];
  levels: number;
  name: string;
  buildingClass: BuildingClass;
  housenumber?: string;
  colour?: number;
}

export type OsmPoiKind =
  | 'fuel'
  | 'parking'
  | 'shop'
  | 'park'
  | 'toxic'
  | 'school'
  | 'worship'
  | 'cafe'
  | 'hospital'
  | 'addr';

export interface OsmPoi {
  kind: OsmPoiKind;
  gx: number;
  gz: number;
  name: string;
  /** Optional footprint for area POIs (parking lots, parks). */
  poly?: [number, number][];
}

export type OsmLanduseKind = 'residential' | 'commercial' | 'industrial' | 'park' | 'forest';

export interface OsmLanduse {
  kind: OsmLanduseKind;
  poly: [number, number][];
  name: string;
}

export interface OsmData {
  roads: OsmRoad[];
  buildings: OsmBuilding[];
  railways: { points: [number, number][]; name: string }[];
  waterways: { points: [number, number][] }[];
  streetNames: string[];
  pois: OsmPoi[];
  landuse: OsmLanduse[];
}

export interface VoxelSpec {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  color: number;
}

export interface ZombieEntity {
  mesh: import('three').Group;
  x: number;
  z: number;
  vx: number;
  vz: number;
  hp: number;
  speed: number;
  kind: ZombieKind;
  phase: number;
  steppedY: number;
  steppedRotZ: number;
}

export interface Projectile {
  mesh: import('three').Mesh;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  life: number;
  damage: number;
  color: number;
  explosive: boolean;
  breach: number;
  ignites: boolean;
}

export type LootKind = 'mixed' | 'fuel' | 'scrap' | 'med';

export interface LootCrate {
  mesh: import('three').Mesh;
  x: number;
  z: number;
  kind: LootKind;
}

export interface Particle {
  mesh: import('three').Object3D;
  vx: number;
  vy: number;
  vz: number;
  life: number;
}

export interface GameState {
  baseLat: number;
  baseLon: number;
  locationName: string;
  biomeHint: string;
  chunkX: number;
  chunkZ: number;
  blocksTraversed: number;
  kills: number;
  scrap: number;
  repairDiscount: number;
  unlockedTeslaBoost: boolean;
  fuelSiphon: boolean;
  flareOverchargeUntil: number;
  reduceMotion: boolean;
  objective: string;
  showMapLayer: boolean;
  showFlowDebug: boolean;
  steerMode: SteerMode;
  invertAD: boolean;
  cameraPitchDeg: number;
  cameraYawOffset: number;
  cameraZoom: number;
  timeOfDayIndex: number;
  surfaceGrid: Uint8Array;
  heightGrid: Uint8Array;
  flowDistance: Float32Array;
  flowDirX: Float32Array;
  flowDirZ: Float32Array;
  bike: BikeState;
  partner: PartnerState;
  transition: TransitionState;
  keys: { up: boolean; down: boolean; left: boolean; right: boolean; space: boolean };
  mouseDown: boolean;
  rightMouseDown: boolean;
  lastMouseX: number;
  mouseWorldPos: import('three').Vector3;
  activePins: GisPin[];
  osmCache: Map<string, OsmData>;
  /** Live OSM for the current chunk (null when sync failed / using cadastral-only). */
  activeOsm: OsmData | null;
  couple: CouplePreset;
  paused: boolean;
  studioMode: 'none' | 'creator' | 'inspector';
}
