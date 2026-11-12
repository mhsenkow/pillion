export const MACRO_W = 20;
export const MACRO_L = 40;
export const SUB_DIV = 4;
export const GRID_W = MACRO_W * SUB_DIV; // 80
export const GRID_L = MACRO_L * SUB_DIV; // 160
export const GRID_H = 64;
export const VOXEL_SIZE = 0.45;
export const WORLD_W = GRID_W * VOXEL_SIZE; // 36
export const WORLD_L = GRID_L * VOXEL_SIZE; // 72
export const HALF_W = WORLD_W / 2;
export const HALF_L = WORLD_L / 2;

/** ~1.4 m per voxel — 80×160 cells ≈ 112 m × 224 m playable slab. */
export const CELL_METERS = 1.4;
export const CHUNK_METERS_W = GRID_W * CELL_METERS; // 112
export const CHUNK_METERS_L = GRID_L * CELL_METERS; // 224
export const QUERY_PAD_METERS = 15;

/** @deprecated degree spans were Emmett-tuned; use projection.chunkBBoxFromOrigin */
export const CHUNK_LAT_SPAN = CHUNK_METERS_L / 111_320; // ~0.00201
export const CHUNK_LON_SPAN = 0.00136;

export const STEP_FPS = 12;
export const STEP_DT = 1 / STEP_FPS;

export const TILE = {
  ROAD: 0,
  SIDEWALK: 1,
  BUILDING: 2,
  RUBBLE: 3,
  WATER: 4,
  TOXIC: 5,
  BRIDGE: 6,
  RAIL: 7,
  FIELD: 8,
  PARKING: 9,
} as const;

export const WEAPONS = [
  { name: 'BREACH', cooldown: 0.4, pellets: 6, spread: 0.26, speed: 33, damage: 38, color: 0xfbbf24, explosive: false, breach: 1, ignites: false },
  { name: 'TESLA SMG', cooldown: 0.1, pellets: 1, spread: 0.07, speed: 42, damage: 19, color: 0x38bdf8, explosive: false, breach: 0, ignites: false },
  { name: 'FIREBOMB', cooldown: 0.72, pellets: 1, spread: 0.03, speed: 25, damage: 100, color: 0xf43f5e, explosive: true, breach: 3, ignites: true },
] as const;

export const STORAGE_KEY = 'pillion-gridfall-presets-v1';
export const RUN_STORAGE_KEY = 'pillion-gridfall-run-v1';
export const REFERENCE_ART_URL = '/assets/reference-couple.jpg';

/** Soft death downtime before hull/fuel restore. */
export const FIELD_TOW_DURATION = 1.35;

/** Post-tow invulnerability seconds. */
export const TOW_IFRAMES = 2.2;
