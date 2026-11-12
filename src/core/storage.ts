import { RUN_STORAGE_KEY, STORAGE_KEY } from './constants';
import type { CouplePreset } from './types';

export interface RunSave {
  scrap: number;
  kills: number;
  blocksTraversed: number;
  baseLat: number;
  baseLon: number;
  locationName: string;
  biomeHint: string;
  repairDiscount: number;
  unlockedTeslaBoost: boolean;
  fuelSiphon?: boolean;
}

export function loadPresets(): CouplePreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as CouplePreset[];
  } catch {
    return [];
  }
}

export function savePresets(presets: CouplePreset[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

export function saveActiveCouple(couple: CouplePreset): void {
  localStorage.setItem(`${STORAGE_KEY}:active`, JSON.stringify(couple));
}

export function loadActiveCouple(): CouplePreset | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}:active`);
    if (!raw) return null;
    return JSON.parse(raw) as CouplePreset;
  } catch {
    return null;
  }
}

export function exportCoupleJson(couple: CouplePreset): string {
  return JSON.stringify(couple, null, 2);
}

export function importCoupleJson(json: string): CouplePreset {
  return JSON.parse(json) as CouplePreset;
}

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function loadRun(): RunSave | null {
  try {
    const raw = localStorage.getItem(RUN_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as RunSave;
  } catch {
    return null;
  }
}

export function saveRun(run: RunSave): void {
  localStorage.setItem(RUN_STORAGE_KEY, JSON.stringify(run));
}

export function clearRun(): void {
  localStorage.removeItem(RUN_STORAGE_KEY);
}
