import type { CharacterConfig, BikeConfig, CouplePreset, ZombieVariantConfig } from '../core/types';

export const SKIN_TONES = [
  '#8d5531', // bronze / Driver
  '#eab696', // peach / Partner
  '#c68642',
  '#f1c27d',
  '#6b3f2a',
  '#ffdbac',
  '#4a2c1a',
];

export const SUNSET = {
  skyTop: 0x1e3a5f,
  skyHorizon: 0xf59e0b,
  sun: 0xffdfa0,
  rim: 0x38bdf8,
  fog: 0x1a1020,
  ground: 0x0b0d12,
};

export const UNDEAD = {
  ashen: '#8c8299',
  dusk: '#736b80',
  pale: '#a89bb0',
  mutant: '#9333ea',
  eyeGlow: '#fef08a',
  mutantEye: '#f43f5e',
};

export function hexToNumber(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

export function cloneCharacter(c: CharacterConfig): CharacterConfig {
  return JSON.parse(JSON.stringify(c)) as CharacterConfig;
}

export const DRIVER_DEFAULT: CharacterConfig = {
  id: 'driver',
  label: 'Rider 1 — Driver',
  skinTone: '#8d5531',
  physique: 'muscular',
  torsoStyle: 'shirtless_harness',
  hair: 'bald',
  hairColor: '#1a1a1a',
  beanieColor: '#3f2e24',
  beard: 'full',
  beardColor: '#1a120c',
  glasses: 'none',
  earring: 'cross',
  earringSide: 'right',
  scarf: false,
  scarfColor: '#ef4444',
  harnessColor: '#2e1a12',
  pantsColor: '#1f242d',
  tattoos: { rightArm: 'tribal', chest: 'tribal' },
  tattooDensity: 0.85,
  weapon: 'tactical_shotgun',
  partTweaks: {},
};

export const PARTNER_DEFAULT: CharacterConfig = {
  id: 'partner',
  label: 'Rider 2 — Sidecar',
  skinTone: '#eab696',
  physique: 'toned',
  torsoStyle: 'shirtless_harness',
  hair: 'beanie',
  hairColor: '#3b2414',
  beanieColor: '#3f2e24',
  beard: 'full',
  beardColor: '#3b2414',
  glasses: 'round',
  earring: 'none',
  earringSide: 'left',
  scarf: false,
  scarfColor: '#ef4444',
  harnessColor: '#1a120c',
  pantsColor: '#1f242d',
  tattoos: { leftArm: 'geometric' },
  tattooDensity: 0.9,
  weapon: 'wood_shotgun',
  partTweaks: {},
};

export const BIKE_DEFAULT: BikeConfig = {
  chassis: 'sidecar',
  sidecarPattern: 'stripes',
  tankColor: '#b91c1c',
  frameColor: '#18181b',
  stripeColor: '#0a0a0a',
  seatColor: '#7f1d1d',
  headlightColor: '#fef08a',
  sidecarSide: 'right',
  metallic: 0.55,
  roughness: 0.4,
};

export const ARTWORK_COUPLE: CouplePreset = {
  name: 'Artwork Default (The Husbands)',
  rider1: DRIVER_DEFAULT,
  rider2: PARTNER_DEFAULT,
  bike: BIKE_DEFAULT,
  seatsSwapped: false,
};

export const NEON_RAIDERS: CouplePreset = {
  name: 'Midnight Neon Raiders',
  rider1: {
    ...cloneCharacter(DRIVER_DEFAULT),
    id: 'neon1',
    skinTone: '#c68642',
    hair: 'mohawk',
    hairColor: '#22d3ee',
    harnessColor: '#0e7490',
    scarf: true,
    scarfColor: '#22d3ee',
    weapon: 'tesla',
    tattoos: { leftArm: 'biomech', rightArm: 'biomech' },
  },
  rider2: {
    ...cloneCharacter(PARTNER_DEFAULT),
    id: 'neon2',
    skinTone: '#f1c27d',
    hair: 'swept',
    hairColor: '#a855f7',
    glasses: 'aviators',
    weapon: 'bioflare',
    tattoos: { leftArm: 'biomech' },
  },
  bike: {
    ...BIKE_DEFAULT,
    chassis: 'tandem',
    tankColor: '#06b6d4',
    stripeColor: '#a855f7',
    seatColor: '#1e1b4b',
    headlightColor: '#67e8f9',
  },
  seatsSwapped: false,
};

export const RUST_WASTELANDERS: CouplePreset = {
  name: 'Rust Wastelanders',
  rider1: {
    ...cloneCharacter(DRIVER_DEFAULT),
    id: 'rust1',
    physique: 'toned',
    torsoStyle: 'vest',
    hair: 'helmet',
    glasses: 'goggles',
    earring: 'stud',
    tattoos: { rightArm: 'none' },
    weapon: 'tactical_shotgun',
  },
  rider2: {
    ...cloneCharacter(PARTNER_DEFAULT),
    id: 'rust2',
    physique: 'lean',
    torsoStyle: 'tshirt_harness',
    hair: 'swept',
    glasses: 'none',
    tattoos: { leftArm: 'tribal' },
    weapon: 'wood_shotgun',
  },
  bike: {
    ...BIKE_DEFAULT,
    chassis: 'sidecar',
    sidecarPattern: 'rust',
    tankColor: '#92400e',
    frameColor: '#44403c',
    stripeColor: '#78350f',
    seatColor: '#292524',
  },
  seatsSwapped: false,
};

export const BUILTIN_PRESETS: CouplePreset[] = [ARTWORK_COUPLE, NEON_RAIDERS, RUST_WASTELANDERS];

export const ZOMBIE_VARIANTS: Record<string, ZombieVariantConfig> = {
  walker: { kind: 'walker', skin: UNDEAD.ashen, shirt: '#e7e5e4', eyeColor: UNDEAD.eyeGlow, scale: 1 },
  runner: { kind: 'runner', skin: UNDEAD.dusk, shirt: '#4d7c0f', eyeColor: UNDEAD.eyeGlow, scale: 0.95 },
  clamberer: { kind: 'clamberer', skin: UNDEAD.pale, shirt: '#78716c', eyeColor: '#fde68a', scale: 1.05 },
  mutant: { kind: 'mutant', skin: UNDEAD.mutant, shirt: '#581c87', eyeColor: UNDEAD.mutantEye, scale: 1.35 },
};
