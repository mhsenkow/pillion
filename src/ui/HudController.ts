import * as THREE from 'three';
import { LOCATION_PRESETS } from '../geo/emmettGis';
import { WEAPONS } from '../core/constants';
import type { GameState, OsmData } from '../core/types';
import { worldToGrid, gridToWorld, idx } from '../geo/voxelizer';
import { TILE } from '../core/constants';
import type { LootCrate, ZombieEntity } from '../core/types';

export interface HudCallbacks {
  onPresetChange: (lat: number, lon: number, name: string, biome: string) => void;
  onSearchPlace: (q: string) => void;
  onGpsDrop: (lat: number, lon: number) => void;
  onGeolocate: () => void;
  onAlignToggle: () => void;
  onResyncOsm: () => void;
  onSteerMode: () => void;
  onInvertSteer: (v: boolean) => void;
  onWeapon: (i: 0 | 1 | 2) => void;
  onAimMode: () => void;
  onDof: (v: number) => void;
  onPitch: (v: number) => void;
  onFlowDebug: () => void;
  onMapLayer: () => void;
  onTime: () => void;
  onRepair: () => void;
  onOvercharge: () => void;
  onOpenCreator: () => void;
  onOpenInspector: () => void;
  onToast?: (msg: string) => void;
  onReduceMotion?: (v: boolean) => void;
  onMute?: () => void;
  onShareRide?: () => void;
  onAutoFire?: () => void;
  onCinema?: () => void;
  onPhotoMode?: () => void;
  onSetDestination?: (q: string) => void;
}

type PanelId = 'nav' | 'vitals' | 'loadout' | 'radar';

const PANEL_STORAGE_KEY = 'pillion.hud.panels.v2';

function headingCardinal(headingRad: number): string {
  // Bike heading: 0 faces -Z (north on the diorama)
  const deg = ((headingRad * 180) / Math.PI + 360) % 360;
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}

export class HudController {
  private root: HTMLElement;
  private radarCanvas: HTMLCanvasElement;
  private radarCtx: CanvasRenderingContext2D;
  private cbs: HudCallbacks;
  private collapsed = new Set<PanelId>();
  private menusHidden = false;
  private goalGx: number | null = null;
  private goalGz: number | null = null;
  private radarDirty = true;
  private radarSurfaceKey = '';
  private radarBase: ImageData | null = null;

  constructor(app: HTMLElement, cbs: HudCallbacks) {
    this.cbs = cbs;
    this.root = document.createElement('div');
    this.root.id = 'hud-root';
    app.appendChild(this.root);
    this.root.innerHTML = this.template();
    this.radarCanvas = this.root.querySelector('#radar-canvas') as HTMLCanvasElement;
    this.radarCtx = this.radarCanvas.getContext('2d')!;
    this.restorePanelState();
    this.bind();
    this.applyPanelState();
  }

  private dock(
    id: PanelId,
    title: string,
    position: string,
    body: string,
    width?: string,
  ): string {
    return `
      <div class="hud-layer hud-dock" data-panel="${id}" style="${position}${width ? `;${width}` : ''}">
        <div class="hud-panel" data-panel-card>
          <div class="hud-panel-head">
            <span class="mono hud-panel-title">${title}</span>
            <button type="button" class="hud-icon-btn" data-collapse="${id}" title="Collapse panel" aria-label="Collapse ${title}">−</button>
          </div>
          <div class="hud-panel-body">${body}</div>
        </div>
        <button type="button" class="hud-panel-chip hidden" data-expand="${id}" title="Open ${title}">${title}</button>
      </div>
    `;
  }

  private template(): string {
    const presets = LOCATION_PRESETS.map(
      (p, i) =>
        `<option value="${i}" data-lat="${p.lat}" data-lon="${p.lon}" data-biome="${p.biome}" data-name="${p.name.replace(/"/g, '&quot;')}" ${i === 0 ? 'selected' : ''}>${p.name}</option>`,
    ).join('');

    const navBody = `
      <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:8px;margin-bottom:8px">
        <div>
          <div style="font-weight:700;letter-spacing:0.04em">PILLION <span class="mono" style="color:#fbbf24;font-size:11px">// GRIDFALL 1:1</span></div>
          <div id="hud-street-banner" class="mono" style="font-size:10px;color:#fcd34d;margin-top:2px">EMMETT, MI</div>
        </div>
        <span id="osm-badge" class="mono" style="font-size:10px;padding:2px 8px;border-radius:6px;background:rgba(6,182,212,0.2);color:#67e8f9;border:1px solid rgba(6,182,212,0.3)">GIS + OSM</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;background:rgba(0,0,0,0.35);padding:8px;border-radius:8px;margin-bottom:8px">
        <div><div class="mono" style="font-size:9px;color:#94a3b8">GPS</div><div id="hud-latlon" class="mono" style="font-size:11px;color:#fcd34d;font-weight:700">42.9906°N</div></div>
        <div style="border-left:1px solid rgba(255,255,255,0.1);padding-left:8px"><div class="mono" style="font-size:9px;color:#94a3b8">GRID</div><div id="hud-chunk" class="mono" style="font-size:11px;color:#67e8f9;font-weight:700">80×160</div><div id="hud-scale" class="mono" style="font-size:8px;color:#94a3b8;margin-top:2px">1.4m · 112×224m</div></div>
        <div style="border-left:1px solid rgba(255,255,255,0.1);padding-left:8px"><div class="mono" style="font-size:9px;color:#94a3b8">BIOME</div><div id="hud-biome" class="mono" style="font-size:11px;color:#a7f3d0;font-weight:700">EMMETT</div></div>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:6px">
        <select id="preset-select" style="flex:1">${presets}</select>
        <button class="hud-btn" id="btn-resync" title="Re-sync OSM">↻</button>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:6px">
        <input id="input-place" type="text" placeholder="Search any place..." style="flex:1" />
        <button class="hud-btn" id="btn-find" style="background:#06b6d4;color:#0f172a">FIND</button>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:6px">
        <input id="input-dest" type="text" placeholder="Road trip to Detroit / Chicago…" style="flex:1" />
        <button class="hud-btn" id="btn-dest" style="background:#a78bfa;color:#0f172a">GO</button>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:8px">
        <input id="input-lat" type="number" step="0.0001" value="42.9906" style="width:50%" />
        <input id="input-lon" type="number" step="0.0001" value="-82.7649" style="width:50%" />
        <button class="hud-btn" id="btn-gps" style="background:#f59e0b;color:#0f172a">DROP</button>
        <button class="hud-btn" id="btn-here" title="Use my location" style="background:#22d3ee;color:#0f172a">MY LOC</button>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:6px">
        <span class="mono" style="font-size:10px;color:#94a3b8">STEER</span>
        <button class="hud-btn active" id="btn-steer">SCREEN-SPACE WASD</button>
        <label id="lbl-invert" class="mono" style="font-size:10px;color:#94a3b8;display:flex;gap:4px;align-items:center" title="Invert A/D only applies in BIKE-RELATIVE steer mode"><input id="chk-invert" type="checkbox" /> INV A/D <span style="opacity:0.55">(BIKE)</span></label>
      </div>
      <div style="display:flex;gap:6px">
        <button class="hud-btn" id="btn-creator" style="flex:1;background:rgba(245,158,11,0.2);border-color:rgba(245,158,11,0.5);color:#fde68a">[C] COUPLE & RIDE</button>
        <button class="hud-btn" id="btn-inspector" style="flex:1;background:rgba(56,189,248,0.15);border-color:rgba(56,189,248,0.4);color:#7dd3fc">[I] DEV INSPECT</button>
      </div>
    `;

    const vitalsBody = `
      <div style="display:flex;justify-content:space-between"><span class="mono" style="font-size:10px;color:#94a3b8">HULL</span><span id="hud-hp-text" class="mono" style="color:#34d399;font-weight:700">100%</span></div>
      <div class="bar" style="margin:4px 0 10px"><div id="hud-hp-bar" style="width:100%;background:linear-gradient(90deg,#10b981,#2dd4bf)"></div></div>
      <div style="display:flex;justify-content:space-between"><span class="mono" style="font-size:10px;color:#94a3b8">FUEL</span><span id="hud-fuel-text" class="mono" style="font-size:10px;color:#fbbf24;font-weight:700">100%</span></div>
      <div class="bar" style="margin:4px 0 10px"><div id="hud-fuel-bar" style="width:100%;background:linear-gradient(90deg,#f59e0b,#fde047)"></div></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;text-align:center;background:rgba(0,0,0,0.35);padding:8px;border-radius:8px;margin-bottom:6px">
        <div><div class="mono" style="font-size:9px;color:#94a3b8">BLOCKS</div><div id="hud-blocks" class="mono" style="font-weight:800">1</div></div>
        <div style="border-left:1px solid rgba(255,255,255,0.1)"><div class="mono" style="font-size:9px;color:#94a3b8">SCRAP</div><div id="hud-scrap" class="mono" style="font-weight:800;color:#fcd34d">25</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;text-align:center;background:rgba(0,0,0,0.35);padding:8px;border-radius:8px">
        <div><div class="mono" style="font-size:9px;color:#94a3b8">KILLS</div><div id="hud-kills" class="mono" style="font-weight:800;color:#fb7185">0</div></div>
        <div style="border-left:1px solid rgba(255,255,255,0.1)"><div class="mono" style="font-size:9px;color:#94a3b8">HORDE</div><div id="hud-horde" class="mono" style="font-weight:800;color:#f87171">0</div></div>
      </div>
      <div class="mono" style="font-size:9px;color:#94a3b8;margin-top:6px;text-align:center">THREAT <span id="hud-threat" style="color:#fbbf24;font-weight:800">GREEN</span></div>
      <div id="hud-perk" class="mono" style="font-size:9px;color:#67e8f9;margin-top:6px;text-align:center">PERK: —</div>
      <div class="mono" style="font-size:9px;color:#94a3b8;margin-top:6px;text-align:center">HEADING <span id="hud-heading" style="color:#fcd34d;font-weight:700">N</span></div>
    `;

    const loadoutBody = `
      <div style="display:flex;justify-content:space-between;margin-bottom:8px">
        <span class="mono" style="font-size:10px;color:#94a3b8">WEAPONS</span>
        <button class="hud-btn" id="btn-aim">AIM: AUTO + CURSOR</button>
        <button class="hud-btn active" id="btn-autofire" title="Keep shooting at the aim without holding click">AUTO FIRE: ON</button>
      </div>
      <div class="mono" style="font-size:8px;color:#94a3b8;margin:-2px 0 8px;line-height:1.35">CAST THIS TO THE TV · SHARE PHONE GUN sends a controller link · auto fire on</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:10px">
        ${WEAPONS.map(
          (w, i) =>
            `<button class="hud-btn weapon-btn ${i === 0 ? 'weapon-active' : ''}" data-weapon="${i}"><div class="mono" style="font-weight:700">[${i + 1}] ${w.name}</div></button>`,
        ).join('')}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div><div class="mono" style="font-size:9px;color:#94a3b8">TILT DOF</div><input id="slider-dof" type="range" min="0" max="14" value="6" /></div>
        <div><div class="mono" style="font-size:9px;color:#94a3b8">LENS PITCH</div><input id="slider-pitch" type="range" min="35" max="62" value="48" /></div>
      </div>
      <div style="display:flex;gap:6px;margin-top:8px">
        <button class="hud-btn" id="btn-flow" style="flex:1">FLOW: OFF</button>
        <button class="hud-btn active" id="btn-map" style="flex:1">MAP: ON</button>
        <button class="hud-btn" id="btn-align" style="flex:1">ALIGN: OFF</button>
        <button class="hud-btn" id="btn-time" style="flex:1">☀ GOLDEN</button>
      </div>
      <div style="display:flex;gap:6px;margin-top:8px;align-items:center">
        <label class="mono" style="font-size:10px;color:#94a3b8;display:flex;gap:6px;align-items:center;flex:1">
          <input id="chk-reduce-motion" type="checkbox" /> REDUCE MOTION
        </label>
        <button class="hud-btn" id="btn-mute" style="flex:0.7" title="Mute audio [M]">AUDIO</button>
      </div>
    `;

    const radarBody = `
      <div style="display:flex;gap:12px;align-items:center">
        <div style="width:110px">
          <div class="mono" style="font-size:9px;color:#94a3b8">VELOCITY</div>
          <div><span id="hud-speed" class="mono" style="font-size:28px;font-weight:800">0</span><span class="mono" style="font-size:10px;color:#94a3b8"> KM/H</span></div>
          <div id="hud-drift-badge" class="mono" style="font-size:9px;padding:2px 6px;border-radius:4px;background:#1e293b;color:#94a3b8;display:inline-block;margin-top:4px">TRACTION</div>
          <div id="radar-poi-label" class="mono" style="font-size:9px;color:#fcd34d;margin-top:8px;font-weight:700">M-19</div>
          <button class="hud-btn" id="btn-repair" style="width:100%;margin-top:6px;background:rgba(16,185,129,0.2);border-color:rgba(16,185,129,0.4);color:#a7f3d0">[R] PATCH</button>
          <button class="hud-btn" id="btn-overcharge" style="width:100%;margin-top:4px;background:rgba(244,63,94,0.18);border-color:rgba(244,63,94,0.4);color:#fda4af" title="Spend 40 scrap. Firebomb blasts wider and the fire spreads farther.">[F] FIREBOMB OC · 40</button>
        </div>
          <div>
            <div class="mono" style="font-size:8px;color:#fbbf24;text-align:center;margin-bottom:2px">N ▲ LIVE GIS RADAR</div>
            <canvas id="radar-canvas" width="120" height="192" style="display:block;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:#090d16"></canvas>
            <div id="radar-source-tag" class="mono" style="font-size:8px;color:#67e8f9;text-align:center;margin-top:2px">80×160</div>
            <div id="radar-accuracy" class="mono" style="font-size:7px;color:#94a3b8;text-align:center;margin-top:2px;line-height:1.35">SYNCING…</div>
          </div>
      </div>
    `;

    return `
      <div class="tilt-shift-top" id="tilt-top"></div>
      <div class="tilt-shift-bottom" id="tilt-bottom"></div>
      <div class="lens-vignette"></div>
      <div id="crosshair">
        <svg viewBox="0 0 36 36" fill="none"><circle cx="18" cy="18" r="11" stroke="#fbbf24" stroke-width="1.8" stroke-dasharray="4 3"/><circle cx="18" cy="18" r="2.5" fill="#f87171"/><path d="M18 2V7M18 29V34M2 18H7M29 18H34" stroke="#fbbf24" stroke-width="1.8" stroke-linecap="round"/></svg>
      </div>
      <div id="chunk-toast" class="toast"><div class="hud-panel" style="padding:8px 18px;border-radius:999px;border-color:rgba(245,158,11,0.4)"><span id="chunk-toast-text" class="mono" style="font-size:11px;letter-spacing:0.08em;color:#fde68a;font-weight:700">ENTERING SECTOR</span></div></div>
      <div id="objective-banner" class="mono">SCAN FOR SUPPLY CACHES</div>
      <div id="kill-feed" class="mono"></div>
      <div id="damage-vignette"></div>
      <div id="gis-labels-container" style="position:fixed;inset:0;pointer-events:none;z-index:10"></div>
      <canvas id="align-overlay" width="1" height="1"></canvas>

      <div class="hud-chrome">
        <button type="button" class="hud-btn" id="btn-hide-menus" title="Hide or show all HUD panels">HIDE MENUS [H]</button>
        <button type="button" class="hud-btn" id="btn-share-ride" title="Copy a phone gunner link. Cast this screen to the TV; they only get a controller.">SHARE PHONE GUN</button>
        <button type="button" class="hud-btn" id="btn-cinema" title="Cinema mode">CINEMA</button>
        <button type="button" class="hud-btn" id="btn-photo" title="Photo mode">PHOTO</button>
        <span id="coop-status" class="mono" style="font-size:9px;color:#7dd3fc;margin-left:8px"></span>
      </div>
      <div id="tv-subtitle" class="tv-subtitle mono"></div>
      <div id="dest-hud" class="dest-hud mono hidden"></div>
      <div id="town-card" class="town-card hidden"></div>
      <div id="gunner-badge" class="mono" style="position:fixed;bottom:18%;left:50%;transform:translateX(-50%);z-index:22;font-size:12px;color:#7dd3fc;opacity:0;transition:opacity .3s"></div>

      ${this.dock('nav', 'NAV', 'top:12px;left:12px', navBody, 'width:min(94vw,380px)')}
      ${this.dock('vitals', 'VITALS', 'top:12px;right:12px', vitalsBody, 'width:min(280px,90vw)')}
      ${this.dock('loadout', 'LOADOUT', 'bottom:12px;left:12px', loadoutBody, 'width:min(92vw,340px)')}
      ${this.dock('radar', 'RADAR', 'bottom:12px;right:12px', radarBody)}

      <div id="touch-left" class="touch-zone"><div class="touch-knob" id="knob-left"></div></div>
      <div id="touch-right" class="touch-zone"><div class="touch-knob" id="knob-right"></div></div>
    `;
  }

  private restorePanelState(): void {
    try {
      const raw = localStorage.getItem(PANEL_STORAGE_KEY);
      if (!raw) {
        this.menusHidden = true;
        return;
      }
      const parsed = JSON.parse(raw) as { collapsed?: PanelId[]; menusHidden?: boolean };
      (parsed.collapsed ?? []).forEach((id) => this.collapsed.add(id));
      this.menusHidden = !!parsed.menusHidden;
    } catch {
      /* ignore */
    }
  }

  private persistPanelState(): void {
    localStorage.setItem(
      PANEL_STORAGE_KEY,
      JSON.stringify({ collapsed: [...this.collapsed], menusHidden: this.menusHidden }),
    );
  }

  private applyPanelState(): void {
    (['nav', 'vitals', 'loadout', 'radar'] as PanelId[]).forEach((id) => {
      const dock = this.root.querySelector(`[data-panel="${id}"]`) as HTMLElement | null;
      if (!dock) return;
      const card = dock.querySelector('[data-panel-card]') as HTMLElement;
      const chip = dock.querySelector('[data-expand]') as HTMLElement;
      const hidden = this.menusHidden || this.collapsed.has(id);
      card.classList.toggle('hidden', hidden);
      chip.classList.toggle('hidden', !hidden || this.menusHidden);
    });
    const btn = this.$('#btn-hide-menus');
    btn.textContent = this.menusHidden ? 'SHOW MENUS [H]' : 'HIDE MENUS [H]';
    btn.classList.toggle('active', this.menusHidden);
    this.root.classList.toggle('menus-hidden', this.menusHidden);
  }

  setPanelCollapsed(id: PanelId, collapsed: boolean): void {
    if (collapsed) this.collapsed.add(id);
    else this.collapsed.delete(id);
    if (!collapsed) this.menusHidden = false;
    this.persistPanelState();
    this.applyPanelState();
  }

  toggleMenusHidden(): void {
    this.menusHidden = !this.menusHidden;
    if (!this.menusHidden) {
      // Expanding global hide restores previously open panels (keeps individual collapses)
    } else {
      // leave individual collapsed set intact so SHOW restores same layout
    }
    this.persistPanelState();
    this.applyPanelState();
  }

  private bind(): void {
    this.$('#preset-select').addEventListener('change', (e) => {
      const sel = e.target as HTMLSelectElement;
      const opt = sel.selectedOptions[0];
      if (!opt) return;
      const lat = parseFloat(opt.dataset.lat || '');
      const lon = parseFloat(opt.dataset.lon || '');
      const name = opt.dataset.name || opt.textContent || 'Drop';
      const biome = opt.dataset.biome || 'URBAN';
      if (Number.isFinite(lat) && Number.isFinite(lon)) this.cbs.onPresetChange(lat, lon, name, biome);
    });
    this.$('#btn-find').addEventListener('click', () => this.cbs.onSearchPlace((this.$('#input-place') as HTMLInputElement).value));
    this.$('#input-place').addEventListener('keydown', (e) => {
      e.stopPropagation();
      if ((e as KeyboardEvent).key === 'Enter') this.cbs.onSearchPlace((e.target as HTMLInputElement).value);
    });
    this.$('#btn-gps').addEventListener('click', () => {
      this.cbs.onGpsDrop(
        parseFloat((this.$('#input-lat') as HTMLInputElement).value),
        parseFloat((this.$('#input-lon') as HTMLInputElement).value),
      );
    });
    this.$('#btn-here').addEventListener('click', () => this.cbs.onGeolocate());
    this.$('#btn-resync').addEventListener('click', () => this.cbs.onResyncOsm());
    this.$('#btn-steer').addEventListener('click', () => this.cbs.onSteerMode());
    this.$('#chk-invert').addEventListener('change', (e) => this.cbs.onInvertSteer((e.target as HTMLInputElement).checked));
    this.root.querySelectorAll('.weapon-btn').forEach((btn) => {
      btn.addEventListener('click', () => this.cbs.onWeapon(parseInt((btn as HTMLElement).dataset.weapon!, 10) as 0 | 1 | 2));
    });
    this.$('#btn-aim').addEventListener('click', () => this.cbs.onAimMode());
    this.$('#btn-autofire').addEventListener('click', () => this.cbs.onAutoFire?.());
    this.$('#btn-share-ride').addEventListener('click', () => this.cbs.onShareRide?.());
    this.$('#btn-cinema')?.addEventListener('click', () => this.cbs.onCinema?.());
    this.$('#btn-photo')?.addEventListener('click', () => this.cbs.onPhotoMode?.());
    this.$('#btn-dest')?.addEventListener('click', () =>
      this.cbs.onSetDestination?.((this.$('#input-dest') as HTMLInputElement).value),
    );
    this.$('#input-dest')?.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if ((e as KeyboardEvent).key === 'Enter') {
        this.cbs.onSetDestination?.((e.target as HTMLInputElement).value);
      }
    });
    this.$('#slider-dof').addEventListener('input', (e) => this.cbs.onDof(parseFloat((e.target as HTMLInputElement).value)));
    this.$('#slider-pitch').addEventListener('input', (e) => this.cbs.onPitch(parseFloat((e.target as HTMLInputElement).value)));
    this.$('#btn-flow').addEventListener('click', () => this.cbs.onFlowDebug());
    this.$('#btn-map').addEventListener('click', () => this.cbs.onMapLayer());
    this.$('#btn-align').addEventListener('click', () => this.cbs.onAlignToggle());
    this.$('#btn-time').addEventListener('click', () => this.cbs.onTime());
    this.$('#chk-reduce-motion').addEventListener('change', (e) => {
      this.cbs.onReduceMotion?.((e.target as HTMLInputElement).checked);
    });
    this.$('#btn-mute').addEventListener('click', () => this.cbs.onMute?.());
    this.$('#btn-repair').addEventListener('click', () => this.cbs.onRepair());
    this.$('#btn-overcharge').addEventListener('click', () => this.cbs.onOvercharge());
    this.$('#btn-creator').addEventListener('click', () => this.cbs.onOpenCreator());
    this.$('#btn-inspector').addEventListener('click', () => this.cbs.onOpenInspector());
    this.$('#btn-hide-menus').addEventListener('click', () => this.toggleMenusHidden());

    this.root.querySelectorAll('[data-collapse]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.collapse as PanelId;
        this.setPanelCollapsed(id, true);
      });
    });
    this.root.querySelectorAll('[data-expand]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.expand as PanelId;
        this.setPanelCollapsed(id, false);
      });
    });

    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
      this.$('#touch-left').classList.add('show');
      this.$('#touch-right').classList.add('show');
    }
  }

  $(sel: string): HTMLElement {
    return this.root.querySelector(sel) as HTMLElement;
  }

  showToast(msg: string): void {
    const toast = this.$('#chunk-toast');
    this.$('#chunk-toast-text').textContent = msg;
    toast.classList.add('show');
    clearTimeout((toast as HTMLElement & { _t?: number })._t);
    (toast as HTMLElement & { _t?: number })._t = window.setTimeout(() => toast.classList.remove('show'), 2200);
    this.cbs.onToast?.(msg);
  }

  markRadarDirty(): void {
    this.radarDirty = true;
  }

  setOsmBadge(text: string, kind: 'ok' | 'sync' | 'fallback' = 'ok'): void {
    const el = this.$('#osm-badge');
    el.textContent = text;
    el.className = 'mono';
    el.style.cssText =
      'font-size:10px;padding:2px 8px;border-radius:6px;border:1px solid;' +
      (kind === 'sync'
        ? 'background:rgba(245,158,11,0.2);color:#fcd34d;border-color:rgba(245,158,11,0.3)'
        : kind === 'fallback'
          ? 'background:rgba(16,185,129,0.2);color:#6ee7b7;border-color:rgba(16,185,129,0.3)'
          : 'background:rgba(6,182,212,0.2);color:#67e8f9;border-color:rgba(6,182,212,0.3)');
  }

  update(state: GameState, zombies: ZombieEntity[], loot: LootCrate[], threat?: string): void {
    const b = state.bike;
    this.$('#hud-hp-text').textContent = `${Math.round(b.hp)}%`;
    (this.$('#hud-hp-bar') as HTMLElement).style.width = `${b.hp}%`;
    this.$('#hud-fuel-text').textContent = `${Math.round(b.fuel)}%`;
    (this.$('#hud-fuel-bar') as HTMLElement).style.width = `${b.fuel}%`;
    this.$('#hud-kills').textContent = String(state.kills);
    this.$('#hud-horde').textContent = String(zombies.length);
    const threatEl = this.$('#hud-threat');
    if (threatEl && threat) {
      threatEl.textContent = threat;
      threatEl.style.color =
        threat === 'BLACK'
          ? '#e2e8f0'
          : threat === 'RED'
            ? '#f87171'
            : threat === 'ORANGE'
              ? '#fb923c'
              : threat === 'YELLOW'
                ? '#facc15'
                : '#4ade80';
    }
    this.$('#hud-scrap').textContent = String(state.scrap);
    (this.$('#hud-scrap') as HTMLElement).style.color = state.scrap >= 40 ? '#86efac' : '#fcd34d';
    const ocBtn = this.$('#btn-overcharge');
    if (ocBtn) ocBtn.classList.toggle('active', state.scrap >= 40);
    this.$('#hud-blocks').textContent = String(state.blocksTraversed);
    const headingEl = this.$('#hud-heading');
    if (headingEl) headingEl.textContent = headingCardinal(state.bike.heading);
    const kph = Math.round(Math.abs(b.speed) * 6.5);
    this.$('#hud-speed').textContent = String(kph);
    (this.$('#hud-speed') as HTMLElement).style.color = b.drifting ? '#fbbf24' : kph > 40 ? '#67e8f9' : '#f3f4f6';
    const driftBadge = this.$('#hud-drift-badge');
    driftBadge.textContent = b.drifting ? '⚡ DRIFT' : state.steerMode === 'SCREEN' ? 'SCREEN OK' : 'BIKE OK';
    driftBadge.style.background = b.drifting ? 'rgba(245,158,11,0.35)' : '#1e293b';
    driftBadge.style.color = b.drifting ? '#fde68a' : '#94a3b8';
    const perk = this.$('#hud-perk');
    if (perk) {
      const bits: string[] = [];
      if (state.repairDiscount > 0) bits.push(`REPAIR -${state.repairDiscount}`);
      if (state.unlockedTeslaBoost) bits.push('TESLA +');
      if (state.fuelSiphon) bits.push('SIPHON');
      const now = performance.now() / 1000;
      if (state.flareOverchargeUntil > now) {
        bits.push(`FIREBOMB ${Math.ceil(state.flareOverchargeUntil - now)}s`);
      }
      perk.textContent = bits.length ? `PERK: ${bits.join(' · ')}` : 'PERK: —';
    }
    const inv = this.$('#lbl-invert');
    if (inv) inv.style.opacity = state.steerMode === 'BIKE' ? '1' : '0.45';

    const rw = this.radarCanvas.width;
    const rh = this.radarCanvas.height;
    const ctx = this.radarCtx;
    const cw = rw / 80;
    const ch = rh / 160;
    const surfaceKey = `${state.chunkX},${state.chunkZ},${state.activeOsm?.buildings.length ?? -1},${state.activeOsm?.roads.length ?? -1}`;

    if (this.radarDirty || this.radarSurfaceKey !== surfaceKey || !this.radarBase) {
      this.radarSurfaceKey = surfaceKey;
      this.radarDirty = false;
      ctx.fillStyle = '#0a100c';
      ctx.fillRect(0, 0, rw, rh);

      for (let gz = 0; gz < 160; gz++) {
        for (let gx = 0; gx < 80; gx++) {
          const t = state.surfaceGrid[idx(gx, gz)];
          if (t === TILE.BUILDING) ctx.fillStyle = '#c2410c';
          else if (t === TILE.WATER) ctx.fillStyle = '#0f766e';
          else if (t === TILE.RAIL) ctx.fillStyle = '#d6d3d1';
          else if (t === TILE.ROAD || t === TILE.BRIDGE) ctx.fillStyle = '#64748b';
          else if (t === TILE.SIDEWALK) ctx.fillStyle = '#475569';
          else if (t === TILE.TOXIC) ctx.fillStyle = '#4d7c0f';
          else if (t === TILE.RUBBLE) ctx.fillStyle = '#3f6212';
          else if (t === TILE.PARKING) ctx.fillStyle = '#334155';
          else ctx.fillStyle = '#1a2e14';
          ctx.fillRect(gx * cw, gz * ch, cw + 0.35, ch + 0.35);
        }
      }

      const osm = state.activeOsm;
      if (osm) {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.95)';
        osm.roads.forEach((road) => {
          if (road.points.length < 2) return;
          ctx.lineWidth = Math.max(1.2, road.halfWidth * 0.35);
          ctx.beginPath();
          road.points.forEach(([gx, gz], i) => {
            const x = gx * cw;
            const y = gz * ch;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.stroke();
        });
        ctx.fillStyle = 'rgba(248, 113, 113, 0.55)';
        osm.buildings.forEach((bldg) => {
          if (bldg.poly.length < 3) return;
          ctx.beginPath();
          bldg.poly.forEach(([gx, gz], i) => {
            const x = gx * cw;
            const y = gz * ch;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.closePath();
          ctx.fill();
        });
        ctx.strokeStyle = 'rgba(226, 232, 240, 0.85)';
        ctx.lineWidth = 1.4;
        osm.railways.forEach((rail) => {
          if (rail.points.length < 2) return;
          ctx.beginPath();
          rail.points.forEach(([gx, gz], i) => {
            const x = gx * cw;
            const y = gz * ch;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.stroke();
        });
      }
      this.radarBase = ctx.getImageData(0, 0, rw, rh);
    } else if (this.radarBase) {
      ctx.putImageData(this.radarBase, 0, 0);
    }

    const pois = state.activeOsm?.pois;
    if (pois) {
      for (const poi of pois) {
        const x = poi.gx * cw;
        const y = poi.gz * ch;
        ctx.fillStyle =
          poi.kind === 'fuel'
            ? '#fbbf24'
            : poi.kind === 'shop' || poi.kind === 'cafe'
              ? '#94a3b8'
              : poi.kind === 'park' || poi.kind === 'school'
                ? '#4ade80'
                : poi.kind === 'toxic'
                  ? '#a3e635'
                  : poi.kind === 'worship'
                    ? '#fdba74'
                    : poi.kind === 'hospital'
                      ? '#fb7185'
                      : poi.kind === 'addr'
                        ? '#e2e8f0'
                        : '#38bdf8';
        ctx.beginPath();
        ctx.arc(x, y, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.fillStyle = '#fbbf24';
    loot.forEach((c) => {
      const g = worldToGrid(c.x, c.z);
      ctx.fillRect(g.gx * cw - 1.5, g.gz * ch - 1.5, 3.5, 3.5);
    });
    zombies.forEach((z) => {
      const g = worldToGrid(z.x, z.z);
      ctx.fillStyle = z.kind === 'mutant' ? '#d946ef' : '#ef4444';
      ctx.fillRect(g.gx * cw - 1, g.gz * ch - 1, 2.2, 2.2);
    });
    if (this.goalGx != null && this.goalGz != null) {
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(this.goalGx * cw, this.goalGz * ch, 7, 0, Math.PI * 2);
      ctx.stroke();
    }
    const bg = worldToGrid(b.x, b.z);
    const px = bg.gx * cw;
    const pz = bg.gz * ch;
    ctx.strokeStyle = '#fde047';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, pz);
    ctx.lineTo(px - Math.sin(b.heading) * 10, pz - Math.cos(b.heading) * 10);
    ctx.stroke();
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(px, pz, 3.5, 0, Math.PI * 2);
    ctx.fill();

    const osm = state.activeOsm;
    const acc = this.$('#radar-accuracy');
    if (acc) {
      if (osm) {
        const poiN = osm.pois?.length ?? 0;
        acc.textContent = `VECTOR ${osm.roads.length}R · ${osm.buildings.length}B · ${poiN}POI`;
        acc.style.color = osm.buildings.length > 0 ? '#67e8f9' : '#fcd34d';
      } else {
        acc.textContent = 'NO VECTOR OSM — grid fallback';
        acc.style.color = '#fb7185';
      }
    }
  }

  moveCrosshair(x: number, y: number): void {
    const el = this.$('#crosshair');
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }

  pulseCrosshair(): void {
    const el = this.$('#crosshair');
    el.classList.remove('fire-pulse');
    void el.offsetWidth;
    el.classList.add('fire-pulse');
  }

  setReduceMotionChecked(v: boolean): void {
    const el = this.$('#chk-reduce-motion') as HTMLInputElement | null;
    if (el) el.checked = v;
  }

  setMuteLabel(muted: boolean): void {
    const btn = this.$('#btn-mute');
    if (!btn) return;
    btn.textContent = muted ? 'MUTED' : 'AUDIO';
    btn.classList.toggle('active', muted);
  }

  setGoal(gx: number | null, gz: number | null): void {
    this.goalGx = gx;
    this.goalGz = gz;
    this.markRadarDirty();
  }

  setObjective(text: string): void {
    const el = this.$('#objective-banner');
    if (el) el.textContent = text;
  }

  pushKillFeed(line: string): void {
    const feed = this.$('#kill-feed');
    if (!feed) return;
    const row = document.createElement('div');
    row.className = 'kill-feed-row';
    row.textContent = line;
    feed.prepend(row);
    while (feed.children.length > 5) feed.lastChild?.remove();
    window.setTimeout(() => row.classList.add('fade'), 1600);
    window.setTimeout(() => row.remove(), 2400);
  }

  setDamageVignette(intensity: number): void {
    const el = this.$('#damage-vignette');
    if (!el) return;
    const a = Math.max(0, Math.min(0.72, intensity));
    el.style.opacity = String(a);
  }

  setSteerLabel(mode: string): void {
    this.$('#btn-steer').textContent = mode;
  }

  setAimLabel(auto: boolean): void {
    this.$('#btn-aim').textContent = auto ? 'AIM: AUTO + CURSOR' : 'AIM: MANUAL';
  }

  setAutoFireLabel(on: boolean): void {
    const btn = this.$('#btn-autofire');
    btn.textContent = on ? 'AUTO FIRE: ON' : 'AUTO FIRE: OFF';
    btn.classList.toggle('active', on);
  }

  setCoopStatus(text: string): void {
    const el = this.$('#coop-status');
    if (el) el.textContent = text;
  }

  setShareRideLabel(text: string): void {
    const btn = this.$('#btn-share-ride');
    if (btn) btn.textContent = text;
  }

  setSubtitle(text: string): void {
    const el = this.$('#tv-subtitle');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('show', !!text);
    if (text) {
      clearTimeout((el as HTMLElement & { _t?: number })._t);
      (el as HTMLElement & { _t?: number })._t = window.setTimeout(() => {
        el.classList.remove('show');
      }, 2800);
    }
  }

  setDestHud(text: string | null): void {
    const el = this.$('#dest-hud');
    if (!el) return;
    if (!text) {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    el.textContent = text;
  }

  showTownCard(headline: string, sub: string): void {
    const el = this.$('#town-card');
    if (!el) return;
    el.innerHTML = `<strong>${headline}</strong><span>${sub}</span>`;
    el.classList.remove('hidden');
    clearTimeout((el as HTMLElement & { _t?: number })._t);
    (el as HTMLElement & { _t?: number })._t = window.setTimeout(() => el.classList.add('hidden'), 4200);
  }

  setGunnerBadge(name: string, color: string): void {
    const el = this.$('#gunner-badge');
    if (!el) return;
    el.textContent = `${name.toUpperCase()} · GUNNER`;
    el.style.color = color;
    el.style.opacity = '1';
  }

  enableTvHud(): void {
    this.root.classList.add('tv-hud');
    this.menusHidden = true;
    this.applyPanelState();
  }

  setWeapon(i: number): void {
    this.root.querySelectorAll('.weapon-btn').forEach((btn, idx) => {
      btn.classList.toggle('weapon-active', idx === i);
    });
  }

  setFlow(on: boolean): void {
    this.$('#btn-flow').textContent = on ? 'FLOW: ON' : 'FLOW: OFF';
  }

  setMap(on: boolean): void {
    this.$('#btn-map').textContent = on ? 'MAP: ON' : 'MAP: OFF';
    this.$('#btn-map').classList.toggle('active', on);
  }

  setAlign(on: boolean): void {
    const btn = this.$('#btn-align');
    btn.textContent = on ? 'ALIGN: ON' : 'ALIGN: OFF';
    btn.classList.toggle('active', on);
    const canvas = this.$('#align-overlay') as HTMLCanvasElement;
    canvas.classList.toggle('show', on);
    if (!on) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  setScale(text: string): void {
    const el = this.$('#hud-scale');
    if (el) el.textContent = text;
  }

  updateAlignOverlay(camera: THREE.Camera, osm: OsmData | null, show: boolean): void {
    const canvas = this.$('#align-overlay') as HTMLCanvasElement | null;
    if (!canvas) return;
    if (!show || !osm) {
      canvas.classList.remove('show');
      return;
    }
    canvas.classList.add('show');
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    const v = new THREE.Vector3();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.92)';
    for (const road of osm.roads) {
      if (road.points.length < 2) continue;
      ctx.lineWidth = road.footpath ? 1.2 : Math.max(1.6, road.halfWidth * 0.7);
      ctx.globalAlpha = road.footpath ? 0.45 : 0.9;
      ctx.beginPath();
      let started = false;
      for (const [gx, gz] of road.points) {
        const { wx, wz } = gridToWorld(gx, gz);
        v.set(wx, 0.18, wz).project(camera);
        if (v.z > 1) {
          started = false;
          continue;
        }
        const x = (v.x * 0.5 + 0.5) * w;
        const y = (-v.y * 0.5 + 0.5) * h;
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  setTimeLabel(label: string): void {
    this.$('#btn-time').textContent = label;
  }

  setLatLonInputs(lat: number, lon: number): void {
    (this.$('#input-lat') as HTMLInputElement).value = lat.toFixed(4);
    (this.$('#input-lon') as HTMLInputElement).value = lon.toFixed(4);
  }

  setBanner(banner: string, chunk: string, poi: string, source: string, latlon: string, biome?: string): void {
    this.$('#hud-street-banner').textContent = banner;
    this.$('#hud-chunk').textContent = chunk;
    this.$('#radar-poi-label').textContent = poi;
    this.$('#radar-source-tag').textContent = source;
    this.$('#hud-latlon').textContent = latlon;
    const biomeEl = this.$('#hud-biome');
    if (biomeEl && biome) biomeEl.textContent = biome;
  }
}

