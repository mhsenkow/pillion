import * as THREE from 'three';
import { REFERENCE_ART_URL } from '../core/constants';
import type { CouplePreset, PartTransform, ZombieKind } from '../core/types';
import { buildChibiCharacter } from '../art/chibiCharacterBuilder';
import { buildBikeRig, type BikeRig } from '../art/bikeBuilder';
import { buildZombie, buildRuinedCar } from '../art/zombieBuilder';
import { SteppedAnimator } from '../simulation/steppedAnimator';
import { downloadJson } from '../core/storage';
import { cloneCharacter } from '../art/palettes';

export type InspectorSubject =
  | 'full'
  | 'rider1'
  | 'rider2'
  | 'walker'
  | 'runner'
  | 'mutant'
  | 'car_clamber';

export interface InspectorCallbacks {
  onCoupleChange: (couple: CouplePreset) => void;
  onClose: () => void;
  onPlayingChange: (playing: boolean) => void;
}

const PART_KEYS = [
  'head',
  'beard',
  'glasses',
  'beanie',
  'earring',
  'torso',
  'harness',
  'leftArm',
  'rightArm',
  'weapon',
  'sidecarBody',
];

export class DevModelInspector {
  private overlay: HTMLElement;
  private studioGroup: THREE.Group;
  private couple: CouplePreset;
  private cbs: InspectorCallbacks;
  private subject: InspectorSubject = 'full';
  private stageRoot = new THREE.Group();
  private currentRig: BikeRig | null = null;
  private animator = new SteppedAnimator();
  private selectedPart = 'head';
  private orbitYaw = 0.6;
  private orbitPitch = 0.55;
  private orbitDist = 5.5;
  private showRef = true;
  private showWire = false;
  private dragging = false;
  private lastX = 0;

  constructor(app: HTMLElement, studioGroup: THREE.Group, couple: CouplePreset, cbs: InspectorCallbacks) {
    this.studioGroup = studioGroup;
    this.couple = JSON.parse(JSON.stringify(couple));
    this.cbs = cbs;
    this.studioGroup.add(this.stageRoot);
    this.overlay = document.createElement('div');
    this.overlay.className = 'modal-overlay hidden';
    this.overlay.style.background = 'transparent';
    this.overlay.style.pointerEvents = 'none';
    this.overlay.id = 'inspector-modal';
    app.appendChild(this.overlay);
    this.renderPanel();
  }

  open(couple: CouplePreset): void {
    this.couple = JSON.parse(JSON.stringify(couple));
    this.overlay.classList.remove('hidden');
    this.studioGroup.visible = true;
    this.animator.playing = true;
    this.rebuildSubject();
    this.renderPanel();
  }

  close(): void {
    this.overlay.classList.add('hidden');
    this.studioGroup.visible = false;
    this.clearStage();
    this.cbs.onClose();
  }

  isOpen(): boolean {
    return !this.overlay.classList.contains('hidden');
  }

  getAnimator(): SteppedAnimator {
    return this.animator;
  }

  getOrbitCamera(target: THREE.Vector3): { pos: THREE.Vector3; look: THREE.Vector3 } {
    const x = target.x + Math.sin(this.orbitYaw) * Math.cos(this.orbitPitch) * this.orbitDist;
    const y = target.y + Math.sin(this.orbitPitch) * this.orbitDist;
    const z = target.z + Math.cos(this.orbitYaw) * Math.cos(this.orbitPitch) * this.orbitDist;
    return { pos: new THREE.Vector3(x, y, z), look: target.clone() };
  }

  update(now: number): void {
    if (!this.isOpen()) return;
    this.animator.maybeStep(now, this.currentRig, [], 0, this.animator.pose === 'turret' ? this.animator.frame * 0.2 : Math.PI);
    // Slow turntable auto-spin when not dragging
    if (!this.dragging && this.animator.playing) this.orbitYaw += 0.004;
  }

  private clearStage(): void {
    while (this.stageRoot.children.length) {
      const c = this.stageRoot.children.pop()!;
      c.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const m = o.material;
          if (Array.isArray(m)) m.forEach((x) => x.dispose());
          else (m as THREE.Material).dispose();
        }
      });
    }
    this.currentRig = null;
  }

  private rebuildSubject(): void {
    this.clearStage();
    if (this.subject === 'full') {
      this.currentRig = buildBikeRig(this.couple.bike, this.couple.rider1, this.couple.rider2);
      this.stageRoot.add(this.currentRig.root);
    } else if (this.subject === 'rider1') {
      const r = buildChibiCharacter(this.couple.rider1);
      this.stageRoot.add(r.root);
    } else if (this.subject === 'rider2') {
      const r = buildChibiCharacter(this.couple.rider2);
      this.stageRoot.add(r.root);
    } else if (this.subject === 'car_clamber') {
      const car = buildRuinedCar();
      const z = buildZombie('clamberer');
      z.position.set(0, 0.55, -0.2);
      z.rotation.x = -0.4;
      this.stageRoot.add(car, z);
    } else {
      const kind = this.subject as ZombieKind;
      this.stageRoot.add(buildZombie(kind));
    }
    this.applyWireframe(this.showWire);
  }

  private applyWireframe(on: boolean): void {
    this.stageRoot.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) {
        o.material.wireframe = on;
      }
    });
  }

  private getTweak(): PartTransform {
    const rider = this.subject === 'rider2' ? this.couple.rider2 : this.couple.rider1;
    return (
      rider.partTweaks[this.selectedPart] ?? {
        offset: [0, 0, 0],
        scale: [1, 1, 1],
        rotation: [0, 0, 0],
      }
    );
  }

  private setTweak(t: PartTransform): void {
    const apply = (cfg: typeof this.couple.rider1) => {
      const c = cloneCharacter(cfg);
      c.partTweaks = { ...c.partTweaks, [this.selectedPart]: t };
      return c;
    };
    if (this.subject === 'rider2' || this.selectedPart === 'glasses' || this.selectedPart === 'beanie') {
      // Prefer editing the active solo subject; for full rig edit rider1 unless part is partner-ish
    }
    if (this.subject === 'rider2') this.couple.rider2 = apply(this.couple.rider2);
    else this.couple.rider1 = apply(this.couple.rider1);
    this.cbs.onCoupleChange(JSON.parse(JSON.stringify(this.couple)));
    this.rebuildSubject();
  }

  private renderPanel(): void {
    const t = this.getTweak();
    this.overlay.innerHTML = `
      <div style="pointer-events:auto;position:absolute;top:12px;right:12px;width:min(360px,94vw);max-height:calc(100% - 24px);overflow:auto" class="modal-card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div>
            <div style="font-weight:700">Dev Model Inspector</div>
            <div class="mono" style="font-size:10px;color:#67e8f9">12 FPS • TURNTABLE • PART TUNER</div>
          </div>
          <button class="hud-btn" id="insp-close">CLOSE ✕</button>
        </div>
        ${
          this.showRef
            ? `<div class="ref-loupe" style="margin-bottom:8px"><img src="${REFERENCE_ART_URL}" alt="ref"/></div>`
            : ''
        }
        <div class="field"><label>Subject</label>
          <select id="insp-subject">
            <option value="full" ${this.subject === 'full' ? 'selected' : ''}>Full Rig (Couple + Bike)</option>
            <option value="rider1" ${this.subject === 'rider1' ? 'selected' : ''}>Rider 1 Solo</option>
            <option value="rider2" ${this.subject === 'rider2' ? 'selected' : ''}>Rider 2 Solo</option>
            <option value="walker" ${this.subject === 'walker' ? 'selected' : ''}>Zombie Walker</option>
            <option value="runner" ${this.subject === 'runner' ? 'selected' : ''}>Zombie Runner</option>
            <option value="mutant" ${this.subject === 'mutant' ? 'selected' : ''}>Mutant Brute</option>
            <option value="car_clamber" ${this.subject === 'car_clamber' ? 'selected' : ''}>Car + Clamberer</option>
          </select>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
          <button class="hud-btn" id="insp-play">${this.animator.playing ? '⏸ PAUSE' : '▶ PLAY'}</button>
          <button class="hud-btn" id="insp-prev">−1 FRAME</button>
          <button class="hud-btn" id="insp-next">+1 FRAME</button>
        </div>
        <div class="field"><label>Anim Pose</label>
          <select id="insp-pose">
            ${['idle', 'drift_left', 'drift_right', 'fire', 'turret', 'lunge']
              .map((p) => `<option value="${p}" ${this.animator.pose === p ? 'selected' : ''}>${p}</option>`)
              .join('')}
          </select>
        </div>
        <div class="field"><label>Step Rate ${this.animator.hz} FPS</label>
          <input type="range" id="insp-hz" min="1" max="60" value="${this.animator.hz}" />
        </div>
        <div class="field"><label>Part</label>
          <select id="insp-part">${PART_KEYS.map((p) => `<option value="${p}" ${p === this.selectedPart ? 'selected' : ''}>${p}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Offset X ${t.offset[0].toFixed(2)}</label><input type="range" id="off-x" min="-50" max="50" value="${t.offset[0] * 100}" /></div>
        <div class="field"><label>Offset Y ${t.offset[1].toFixed(2)}</label><input type="range" id="off-y" min="-50" max="50" value="${t.offset[1] * 100}" /></div>
        <div class="field"><label>Offset Z ${t.offset[2].toFixed(2)}</label><input type="range" id="off-z" min="-50" max="50" value="${t.offset[2] * 100}" /></div>
        <div class="field"><label>Scale X ${t.scale[0].toFixed(2)}</label><input type="range" id="sc-x" min="50" max="200" value="${t.scale[0] * 100}" /></div>
        <div class="field"><label>Scale Y ${t.scale[1].toFixed(2)}</label><input type="range" id="sc-y" min="50" max="200" value="${t.scale[1] * 100}" /></div>
        <div class="field"><label>Scale Z ${t.scale[2].toFixed(2)}</label><input type="range" id="sc-z" min="50" max="200" value="${t.scale[2] * 100}" /></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0">
          <button class="hud-btn" id="insp-ref">${this.showRef ? 'HIDE REF' : 'SHOW REF'}</button>
          <button class="hud-btn" id="insp-wire">${this.showWire ? 'SOLID' : 'WIREFRAME'}</button>
          <button class="hud-btn" id="insp-copy" style="background:#f59e0b;color:#0f172a">COPY TS PRESET</button>
          <button class="hud-btn" id="insp-save">SAVE AS ACTIVE</button>
        </div>
        <div class="mono" style="font-size:9px;color:#64748b">Drag on the viewport to orbit. Scroll to zoom. Frame ${this.animator.frame}</div>
      </div>
    `;
    this.bindPanel();
  }

  private bindPanel(): void {
    this.overlay.querySelector('#insp-close')?.addEventListener('click', () => this.close());
    this.overlay.querySelector('#insp-subject')?.addEventListener('change', (e) => {
      this.subject = (e.target as HTMLSelectElement).value as InspectorSubject;
      this.rebuildSubject();
    });
    this.overlay.querySelector('#insp-play')?.addEventListener('click', () => {
      this.animator.playing = !this.animator.playing;
      this.cbs.onPlayingChange(this.animator.playing);
      this.renderPanel();
    });
    this.overlay.querySelector('#insp-prev')?.addEventListener('click', () => {
      this.animator.stepOnce(this.currentRig, [], 0, Math.PI, -1);
      this.renderPanel();
    });
    this.overlay.querySelector('#insp-next')?.addEventListener('click', () => {
      this.animator.stepOnce(this.currentRig, [], 0, Math.PI, 1);
      this.renderPanel();
    });
    this.overlay.querySelector('#insp-pose')?.addEventListener('change', (e) => {
      this.animator.pose = (e.target as HTMLSelectElement).value as typeof this.animator.pose;
    });
    this.overlay.querySelector('#insp-hz')?.addEventListener('input', (e) => {
      this.animator.hz = parseInt((e.target as HTMLInputElement).value, 10);
    });
    this.overlay.querySelector('#insp-part')?.addEventListener('change', (e) => {
      this.selectedPart = (e.target as HTMLSelectElement).value;
      this.renderPanel();
    });

    const bindSlider = (id: string, apply: (v: number, t: PartTransform) => void) => {
      this.overlay.querySelector(id)?.addEventListener('input', (e) => {
        const t = { ...this.getTweak(), offset: [...this.getTweak().offset] as [number, number, number], scale: [...this.getTweak().scale] as [number, number, number], rotation: [...this.getTweak().rotation] as [number, number, number] };
        apply(parseFloat((e.target as HTMLInputElement).value), t);
        this.setTweak(t);
      });
    };
    bindSlider('#off-x', (v, t) => (t.offset[0] = v / 100));
    bindSlider('#off-y', (v, t) => (t.offset[1] = v / 100));
    bindSlider('#off-z', (v, t) => (t.offset[2] = v / 100));
    bindSlider('#sc-x', (v, t) => (t.scale[0] = v / 100));
    bindSlider('#sc-y', (v, t) => (t.scale[1] = v / 100));
    bindSlider('#sc-z', (v, t) => (t.scale[2] = v / 100));

    this.overlay.querySelector('#insp-ref')?.addEventListener('click', () => {
      this.showRef = !this.showRef;
      this.renderPanel();
    });
    this.overlay.querySelector('#insp-wire')?.addEventListener('click', () => {
      this.showWire = !this.showWire;
      this.applyWireframe(this.showWire);
      this.renderPanel();
    });
    this.overlay.querySelector('#insp-copy')?.addEventListener('click', async () => {
      const ts = `export const CUSTOM_COUPLE = ${JSON.stringify(this.couple, null, 2)} as const;\n`;
      try {
        await navigator.clipboard.writeText(ts);
      } catch {
        downloadJson('couple-preset.ts.json', this.couple);
      }
    });
    this.overlay.querySelector('#insp-save')?.addEventListener('click', () => {
      this.cbs.onCoupleChange(JSON.parse(JSON.stringify(this.couple)));
    });
  }

  bindOrbit(dom: HTMLElement): void {
    dom.addEventListener('pointerdown', (e) => {
      if (!this.isOpen()) return;
      this.dragging = true;
      this.lastX = e.clientX;
    });
    window.addEventListener('pointerup', () => {
      this.dragging = false;
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.isOpen() || !this.dragging) return;
      const dx = e.clientX - this.lastX;
      this.lastX = e.clientX;
      this.orbitYaw -= dx * 0.01;
    });
    dom.addEventListener(
      'wheel',
      (e) => {
        if (!this.isOpen()) return;
        this.orbitDist = Math.max(2.5, Math.min(12, this.orbitDist + e.deltaY * 0.01));
      },
      { passive: true },
    );
  }
}
