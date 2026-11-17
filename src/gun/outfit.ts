/** Gunner cosmetic picks persisted for the phone gun pad seat. */

export type GunnerHelmet = 'none' | 'beanie' | 'full-face' | 'retro';
export type GunnerVest = 'hoodie' | 'plate' | 'sling' | 'nomad';
export type GunnerGloves = 'fingerless' | 'tactical' | 'racing';

export interface GunnerOutfitPick {
  helmet: GunnerHelmet;
  vest: GunnerVest;
  gloves: GunnerGloves;
  accent: string;
  patch: string;
}

const STORAGE_KEY = 'pillion.gunner.outfit';

export const OUTFIT_SLOTS = {
  helmet: ['none', 'beanie', 'full-face', 'retro'] as const satisfies readonly GunnerHelmet[],
  vest: ['hoodie', 'plate', 'sling', 'nomad'] as const satisfies readonly GunnerVest[],
  gloves: ['fingerless', 'tactical', 'racing'] as const satisfies readonly GunnerGloves[],
};

const DEFAULT_OUTFIT: GunnerOutfitPick = {
  helmet: 'beanie',
  vest: 'sling',
  gloves: 'tactical',
  accent: '#38bdf8',
  patch: '☠',
};

export const OUTFIT_PRESETS: Record<string, GunnerOutfitPick> = {
  street: { helmet: 'beanie', vest: 'hoodie', gloves: 'fingerless', accent: '#f472b6', patch: '★' },
  tactical: { helmet: 'full-face', vest: 'plate', gloves: 'tactical', accent: '#34d399', patch: '▲' },
  nomad: { helmet: 'retro', vest: 'nomad', gloves: 'racing', accent: '#fbbf24', patch: '◎' },
  default: { ...DEFAULT_OUTFIT },
};

export function getDefaultGunnerOutfit(): GunnerOutfitPick {
  return { ...DEFAULT_OUTFIT };
}

export function loadGunnerOutfit(): GunnerOutfitPick {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultGunnerOutfit();
    const parsed = JSON.parse(raw) as Partial<GunnerOutfitPick>;
    return {
      helmet: parsed.helmet ?? DEFAULT_OUTFIT.helmet,
      vest: parsed.vest ?? DEFAULT_OUTFIT.vest,
      gloves: parsed.gloves ?? DEFAULT_OUTFIT.gloves,
      accent: parsed.accent ?? DEFAULT_OUTFIT.accent,
      patch: parsed.patch?.slice(0, 4) ?? DEFAULT_OUTFIT.patch,
    };
  } catch {
    return getDefaultGunnerOutfit();
  }
}

export function saveGunnerOutfit(partial: Partial<GunnerOutfitPick>): GunnerOutfitPick {
  const next = { ...loadGunnerOutfit(), ...partial };
  if (next.patch) next.patch = next.patch.slice(0, 4);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

export function applyOutfitPreset(id: keyof typeof OUTFIT_PRESETS): GunnerOutfitPick {
  const preset = OUTFIT_PRESETS[id] ?? OUTFIT_PRESETS.default;
  return saveGunnerOutfit(preset);
}

export function cycleOutfitSlot(
  slot: 'helmet' | 'vest' | 'gloves',
  dir: -1 | 1 = 1,
): GunnerOutfitPick {
  const cur = loadGunnerOutfit();
  const list = [...OUTFIT_SLOTS[slot]];
  const idx = Math.max(0, list.indexOf(cur[slot]));
  const nextIdx = (idx + dir + list.length) % list.length;
  return saveGunnerOutfit({ [slot]: list[nextIdx] });
}