import {
  ARTWORK_COUPLE,
  BUILTIN_PRESETS,
  SKIN_TONES,
  cloneCharacter,
} from '../art/palettes';
import type {
  BikeConfig,
  CharacterConfig,
  CouplePreset,
  HairStyle,
  BeardStyle,
  GlassesStyle,
  EarringStyle,
  Physique,
  TorsoStyle,
  TattooStyle,
  WeaponVisual,
  ChassisType,
  SidecarPattern,
} from '../core/types';
import { REFERENCE_ART_URL } from '../core/constants';
import { downloadJson, importCoupleJson, saveActiveCouple } from '../core/storage';

export interface CreatorCallbacks {
  onChange: (couple: CouplePreset) => void;
  onClose: () => void;
}

export class CoupleBikeCreatorModal {
  private overlay: HTMLElement;
  private couple: CouplePreset;
  private tab: 'rider1' | 'rider2' | 'bike' = 'rider1';
  private cbs: CreatorCallbacks;

  constructor(app: HTMLElement, couple: CouplePreset, cbs: CreatorCallbacks) {
    this.couple = JSON.parse(JSON.stringify(couple));
    this.cbs = cbs;
    this.overlay = document.createElement('div');
    this.overlay.className = 'modal-overlay hidden';
    this.overlay.id = 'creator-modal';
    app.appendChild(this.overlay);
    this.render();
  }

  open(couple: CouplePreset): void {
    this.couple = JSON.parse(JSON.stringify(couple));
    this.overlay.classList.remove('hidden');
    this.render();
  }

  close(): void {
    this.overlay.classList.add('hidden');
    this.cbs.onClose();
  }

  isOpen(): boolean {
    return !this.overlay.classList.contains('hidden');
  }

  private activeRider(): CharacterConfig {
    return this.tab === 'rider2' ? this.couple.rider2 : this.couple.rider1;
  }

  private setActiveRider(c: CharacterConfig): void {
    if (this.tab === 'rider2') this.couple.rider2 = c;
    else this.couple.rider1 = c;
  }

  private commit(): void {
    saveActiveCouple(this.couple);
    this.cbs.onChange(JSON.parse(JSON.stringify(this.couple)));
  }

  private render(): void {
    const r = this.activeRider();
    const bike = this.couple.bike;
    this.overlay.innerHTML = `
      <div class="modal-shell">
        <div class="modal-card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <div>
              <div style="font-weight:700;font-size:18px">Couple & Ride Customizer</div>
              <div class="mono" style="font-size:10px;color:#94a3b8">FINESSE THE HUSBANDS • LIVE 3D PREVIEW IN WORLD</div>
            </div>
            <button class="hud-btn" id="creator-close">CLOSE ✕</button>
          </div>
          <div class="ref-loupe" style="margin-bottom:10px">
            <img src="${REFERENCE_ART_URL}" alt="Reference artwork" />
          </div>
          <div class="tab-row">
            <button class="hud-btn tab-btn ${this.tab === 'rider1' ? 'active' : ''}" data-tab="rider1">RIDER 1</button>
            <button class="hud-btn tab-btn ${this.tab === 'rider2' ? 'active' : ''}" data-tab="rider2">RIDER 2</button>
            <button class="hud-btn tab-btn ${this.tab === 'bike' ? 'active' : ''}" data-tab="bike">BIKE</button>
          </div>
          <button class="hud-btn" id="btn-swap" style="width:100%;margin-bottom:10px;background:rgba(168,85,247,0.2);border-color:rgba(168,85,247,0.45);color:#e9d5ff">⇄ SWAP SEATS</button>
          ${this.tab === 'bike' ? this.bikeFields(bike) : this.riderFields(r)}
        </div>
        <div class="modal-card">
          <div class="field">
            <label>Preset</label>
            <select id="preset-builtin">
              ${BUILTIN_PRESETS.map((p) => `<option value="${p.name}" ${p.name === this.couple.name ? 'selected' : ''}>${p.name}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>Preset Name</label>
            <input id="preset-name" type="text" value="${this.couple.name}" />
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">
            <button class="hud-btn" id="btn-apply-preset" style="background:#f59e0b;color:#0f172a">LOAD PRESET</button>
            <button class="hud-btn" id="btn-save-local">SAVE LOCAL</button>
            <button class="hud-btn" id="btn-export">EXPORT JSON</button>
            <button class="hud-btn" id="btn-import">IMPORT JSON</button>
          </div>
          <textarea id="import-json" rows="8" placeholder='Paste couple JSON here then Import…' style="width:100%;resize:vertical"></textarea>
          <div class="mono" style="font-size:10px;color:#64748b;margin-top:10px;line-height:1.5">
            Edits apply live to the diorama. Use Dev Inspector [I] for micro-voxel part offsets, 12 FPS pose scrubbing, and TypeScript export.
          </div>
        </div>
      </div>
    `;
    this.bind();
  }

  private riderFields(r: CharacterConfig): string {
    return `
      <div class="field"><label>Skin Tone</label>
        <div class="swatch-row" id="skin-swatches">
          ${SKIN_TONES.map((s) => `<button class="swatch ${s === r.skinTone ? 'selected' : ''}" data-skin="${s}" style="background:${s}"></button>`).join('')}
          <input type="color" id="skin-custom" value="${r.skinTone}" />
        </div>
      </div>
      <div class="field-row">
        <div class="field"><label>Physique</label>
          <select id="physique">${this.opts(['lean', 'toned', 'muscular'], r.physique)}</select>
        </div>
        <div class="field"><label>Torso</label>
          <select id="torso">${this.opts(['shirtless_harness', 'tshirt_harness', 'armored', 'vest'], r.torsoStyle)}</select>
        </div>
      </div>
      <div class="field-row">
        <div class="field"><label>Hair / Head</label>
          <select id="hair">${this.opts(['bald', 'beanie', 'swept', 'mohawk', 'helmet'], r.hair)}</select>
        </div>
        <div class="field"><label>Beard</label>
          <select id="beard">${this.opts(['full', 'stubble', 'mustache', 'clean'], r.beard)}</select>
        </div>
      </div>
      <div class="field-row">
        <div class="field"><label>Glasses</label>
          <select id="glasses">${this.opts(['none', 'round', 'aviators', 'goggles'], r.glasses)}</select>
        </div>
        <div class="field"><label>Earring</label>
          <select id="earring">${this.opts(['none', 'cross', 'hoop', 'stud'], r.earring)}</select>
        </div>
      </div>
      <div class="field-row">
        <div class="field"><label>Earring Side</label>
          <select id="earring-side">${this.opts(['left', 'right'], r.earringSide)}</select>
        </div>
        <div class="field"><label>Weapon Visual</label>
          <select id="weapon">${this.opts(['wood_shotgun', 'tactical_shotgun', 'tesla', 'bioflare'], r.weapon)}</select>
        </div>
      </div>
      <div class="field-row">
        <div class="field"><label>Left Arm Tattoo</label>
          <select id="tat-left">${this.opts(['none', 'geometric', 'tribal', 'biomech'], r.tattoos.leftArm ?? 'none')}</select>
        </div>
        <div class="field"><label>Right Arm Tattoo</label>
          <select id="tat-right">${this.opts(['none', 'geometric', 'tribal', 'biomech'], r.tattoos.rightArm ?? 'none')}</select>
        </div>
      </div>
      <div class="field">
        <label>Tattoo Density ${Math.round(r.tattooDensity * 100)}%</label>
        <input type="range" id="tat-density" min="0" max="100" value="${r.tattooDensity * 100}" />
      </div>
      <div class="field-row">
        <div class="field"><label>Harness Color</label><input type="color" id="harness" value="${r.harnessColor}" /></div>
        <div class="field"><label>Pants Color</label><input type="color" id="pants" value="${r.pantsColor}" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Hair / Beanie</label><input type="color" id="hair-color" value="${r.hairColor}" /></div>
        <div class="field"><label>Beanie Color</label><input type="color" id="beanie-color" value="${r.beanieColor}" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Beard Color</label><input type="color" id="beard-color" value="${r.beardColor}" /></div>
        <div class="field"><label>Scarf</label>
          <label style="display:flex;gap:6px;align-items:center;color:#e2e8f0;text-transform:none"><input type="checkbox" id="scarf" ${r.scarf ? 'checked' : ''}/> Enable</label>
        </div>
      </div>
    `;
  }

  private bikeFields(b: BikeConfig): string {
    return `
      <div class="field"><label>Chassis</label>
        <select id="chassis">${this.opts(['sidecar', 'tandem'], b.chassis)}</select>
      </div>
      <div class="field"><label>Sidecar Pattern</label>
        <select id="pattern">${this.opts(['stripes', 'chevron', 'rust', 'solid'], b.sidecarPattern)}</select>
      </div>
      <div class="field"><label>Sidecar Side</label>
        <select id="side">${this.opts(['right', 'left'], b.sidecarSide)}</select>
      </div>
      <div class="field-row">
        <div class="field"><label>Tank</label><input type="color" id="tank" value="${b.tankColor}" /></div>
        <div class="field"><label>Stripe / Accent</label><input type="color" id="stripe" value="${b.stripeColor}" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Frame</label><input type="color" id="frame" value="${b.frameColor}" /></div>
        <div class="field"><label>Seat</label><input type="color" id="seat" value="${b.seatColor}" /></div>
      </div>
      <div class="field"><label>Headlight</label><input type="color" id="headlight" value="${b.headlightColor}" /></div>
      <div class="field"><label>Metallic ${Math.round(b.metallic * 100)}%</label>
        <input type="range" id="metallic" min="0" max="100" value="${b.metallic * 100}" />
      </div>
      <div class="field"><label>Roughness ${Math.round(b.roughness * 100)}%</label>
        <input type="range" id="roughness" min="0" max="100" value="${b.roughness * 100}" />
      </div>
    `;
  }

  private opts(values: string[], current: string): string {
    return values.map((v) => `<option value="${v}" ${v === current ? 'selected' : ''}>${v}</option>`).join('');
  }

  private bind(): void {
    this.overlay.querySelector('#creator-close')?.addEventListener('click', () => this.close());
    this.overlay.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.tab = (btn as HTMLElement).dataset.tab as typeof this.tab;
        this.render();
      });
    });
    this.overlay.querySelector('#btn-swap')?.addEventListener('click', () => {
      const a = this.couple.rider1;
      this.couple.rider1 = this.couple.rider2;
      this.couple.rider2 = a;
      this.couple.seatsSwapped = !this.couple.seatsSwapped;
      this.commit();
      this.render();
    });

    this.overlay.querySelector('#btn-apply-preset')?.addEventListener('click', () => {
      const name = (this.overlay.querySelector('#preset-builtin') as HTMLSelectElement).value;
      const p = BUILTIN_PRESETS.find((x) => x.name === name) ?? ARTWORK_COUPLE;
      this.couple = JSON.parse(JSON.stringify(p));
      this.commit();
      this.render();
    });
    this.overlay.querySelector('#preset-name')?.addEventListener('change', (e) => {
      this.couple.name = (e.target as HTMLInputElement).value;
      this.commit();
    });
    this.overlay.querySelector('#btn-save-local')?.addEventListener('click', () => {
      saveActiveCouple(this.couple);
      this.commit();
    });
    this.overlay.querySelector('#btn-export')?.addEventListener('click', () => {
      downloadJson(`${this.couple.name.replace(/\s+/g, '_')}.json`, this.couple);
    });
    this.overlay.querySelector('#btn-import')?.addEventListener('click', () => {
      try {
        const raw = (this.overlay.querySelector('#import-json') as HTMLTextAreaElement).value;
        this.couple = importCoupleJson(raw);
        this.commit();
        this.render();
      } catch {
        alert('Invalid JSON');
      }
    });

    if (this.tab === 'bike') this.bindBike();
    else this.bindRider();
  }

  private bindRider(): void {
    const update = (mut: (c: CharacterConfig) => void) => {
      const c = cloneCharacter(this.activeRider());
      mut(c);
      this.setActiveRider(c);
      this.commit();
    };
    this.overlay.querySelectorAll('[data-skin]').forEach((el) => {
      el.addEventListener('click', () => {
        update((c) => {
          c.skinTone = (el as HTMLElement).dataset.skin!;
        });
        this.render();
      });
    });
    const bindSel = (id: string, fn: (c: CharacterConfig, v: string) => void) => {
      this.overlay.querySelector(id)?.addEventListener('change', (e) => {
        update((c) => fn(c, (e.target as HTMLSelectElement).value));
        this.render();
      });
    };
    bindSel('#physique', (c, v) => (c.physique = v as Physique));
    bindSel('#torso', (c, v) => (c.torsoStyle = v as TorsoStyle));
    bindSel('#hair', (c, v) => (c.hair = v as HairStyle));
    bindSel('#beard', (c, v) => (c.beard = v as BeardStyle));
    bindSel('#glasses', (c, v) => (c.glasses = v as GlassesStyle));
    bindSel('#earring', (c, v) => (c.earring = v as EarringStyle));
    bindSel('#earring-side', (c, v) => (c.earringSide = v as 'left' | 'right'));
    bindSel('#weapon', (c, v) => (c.weapon = v as WeaponVisual));
    bindSel('#tat-left', (c, v) => (c.tattoos.leftArm = v as TattooStyle));
    bindSel('#tat-right', (c, v) => (c.tattoos.rightArm = v as TattooStyle));

    const bindColor = (id: string, key: keyof CharacterConfig) => {
      this.overlay.querySelector(id)?.addEventListener('input', (e) => {
        update((c) => {
          (c as unknown as Record<string, string>)[key as string] = (e.target as HTMLInputElement).value;
        });
      });
    };
    bindColor('#skin-custom', 'skinTone');
    bindColor('#harness', 'harnessColor');
    bindColor('#pants', 'pantsColor');
    bindColor('#hair-color', 'hairColor');
    bindColor('#beanie-color', 'beanieColor');
    bindColor('#beard-color', 'beardColor');

    this.overlay.querySelector('#tat-density')?.addEventListener('input', (e) => {
      update((c) => {
        c.tattooDensity = parseFloat((e.target as HTMLInputElement).value) / 100;
      });
    });
    this.overlay.querySelector('#scarf')?.addEventListener('change', (e) => {
      update((c) => {
        c.scarf = (e.target as HTMLInputElement).checked;
      });
      this.render();
    });
  }

  private bindBike(): void {
    const update = (mut: (b: BikeConfig) => void) => {
      mut(this.couple.bike);
      this.commit();
    };
    this.overlay.querySelector('#chassis')?.addEventListener('change', (e) => {
      update((b) => (b.chassis = (e.target as HTMLSelectElement).value as ChassisType));
      this.render();
    });
    this.overlay.querySelector('#pattern')?.addEventListener('change', (e) => {
      update((b) => (b.sidecarPattern = (e.target as HTMLSelectElement).value as SidecarPattern));
      this.render();
    });
    this.overlay.querySelector('#side')?.addEventListener('change', (e) => {
      update((b) => (b.sidecarSide = (e.target as HTMLSelectElement).value as 'left' | 'right'));
      this.render();
    });
    const colors: [string, keyof BikeConfig][] = [
      ['#tank', 'tankColor'],
      ['#stripe', 'stripeColor'],
      ['#frame', 'frameColor'],
      ['#seat', 'seatColor'],
      ['#headlight', 'headlightColor'],
    ];
    colors.forEach(([id, key]) => {
      this.overlay.querySelector(id)?.addEventListener('input', (e) => {
        update((b) => {
          (b as unknown as Record<string, string>)[key] = (e.target as HTMLInputElement).value;
        });
      });
    });
    this.overlay.querySelector('#metallic')?.addEventListener('input', (e) => {
      update((b) => (b.metallic = parseFloat((e.target as HTMLInputElement).value) / 100));
    });
    this.overlay.querySelector('#roughness')?.addEventListener('input', (e) => {
      update((b) => (b.roughness = parseFloat((e.target as HTMLInputElement).value) / 100));
    });
  }
}
