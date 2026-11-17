import * as THREE from 'three';
import type { RendererBundle } from './DioramaRenderer';

export type GfxQuality = 'low' | 'balanced' | 'cinematic';

export interface PostFxFlags {
  enableBloom: boolean;
  enableAO: boolean;
  quality: GfxQuality;
}

export interface PostFxRendererHints {
  enableBloom: boolean;
  enableAO: boolean;
  exposure: number;
  fogDensity: number;
  /** CSS multiply vignette for SSAO-like corner darkening stub. */
  aoOverlayOpacity: number;
  /** CSS screen blend for bloom stub. */
  bloomOverlayOpacity: number;
}

const STORAGE_KEY = 'pillion.postfx';

const DEFAULTS: PostFxFlags = {
  enableBloom: true,
  enableAO: true,
  quality: 'balanced',
};

export function getDefaultPostFxFlags(): PostFxFlags {
  return { ...DEFAULTS };
}

export function loadPostFxFlags(): PostFxFlags {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultPostFxFlags();
    const parsed = JSON.parse(raw) as Partial<PostFxFlags>;
    return {
      enableBloom: parsed.enableBloom ?? DEFAULTS.enableBloom,
      enableAO: parsed.enableAO ?? DEFAULTS.enableAO,
      quality: parsed.quality ?? DEFAULTS.quality,
    };
  } catch {
    return getDefaultPostFxFlags();
  }
}

export function savePostFxFlags(partial: Partial<PostFxFlags>): PostFxFlags {
  const next = { ...loadPostFxFlags(), ...partial };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
  return next;
}

/** Quality presets — no EffectComposer; stubs tune exposure, fog, and DOM overlays. */
export function computePostFxHints(
  flags: PostFxFlags,
  baseExposure = 1.15,
  baseFog = 0.0042,
): PostFxRendererHints {
  const qMul =
    flags.quality === 'cinematic' ? 1.0 : flags.quality === 'balanced' ? 0.85 : 0.65;
  let exposure = baseExposure;
  let fogDensity = baseFog;
  let aoOverlayOpacity = 0;
  let bloomOverlayOpacity = 0;

  if (flags.enableAO) {
    aoOverlayOpacity = 0.28 * qMul;
    exposure *= 1 - 0.06 * qMul;
    fogDensity *= 1 + 0.12 * qMul;
  }
  if (flags.enableBloom) {
    bloomOverlayOpacity = 0.18 * qMul;
    exposure *= 1 + 0.08 * qMul;
  }

  return {
    enableBloom: flags.enableBloom,
    enableAO: flags.enableAO,
    exposure,
    fogDensity,
    aoOverlayOpacity,
    bloomOverlayOpacity,
  };
}

/** Apply stub post-FX by adjusting renderer tone mapping and scene fog (GameApp may read hints separately). */
export function applyPostFxToBundle(bundle: RendererBundle, flags: PostFxFlags): PostFxRendererHints {
  const hints = computePostFxHints(flags);
  bundle.renderer.toneMappingExposure = hints.exposure;
  const fog = bundle.scene.fog;
  if (fog instanceof THREE.FogExp2) fog.density = hints.fogDensity;
  return hints;
}

const OVERLAY_ID = 'pillion-postfx-overlay';

export function ensurePostFxOverlay(parent: HTMLElement = document.body): HTMLDivElement {
  let el = document.getElementById(OVERLAY_ID) as HTMLDivElement | null;
  if (el) return el;
  el = document.createElement('div');
  el.id = OVERLAY_ID;
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText =
    'pointer-events:none;position:fixed;inset:0;z-index:2;mix-blend-mode:multiply;opacity:0;background:radial-gradient(ellipse 85% 75% at 50% 48%,transparent 35%,rgba(0,0,0,0.75) 100%)';
  parent.appendChild(el);
  return el;
}

export function syncPostFxOverlay(overlay: HTMLElement, hints: PostFxRendererHints): void {
  overlay.style.opacity = String(hints.aoOverlayOpacity);
  overlay.style.display = hints.enableAO && hints.aoOverlayOpacity > 0.01 ? 'block' : 'none';
  if (hints.enableBloom && hints.bloomOverlayOpacity > 0.01) {
    overlay.style.boxShadow = `inset 0 0 120px rgba(255, 220, 160, ${hints.bloomOverlayOpacity})`;
  } else {
    overlay.style.boxShadow = 'none';
  }
}