import * as THREE from 'three';

export interface SmokePuff {
  sprite: THREE.Sprite;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  baseScale: number;
}

let _smokeTex: THREE.Texture | null = null;

function smokeTexture(): THREE.Texture | null {
  if (_smokeTex || typeof document === 'undefined') return _smokeTex;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  if (!g) return null;
  const grad = g.createRadialGradient(32, 36, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(220,220,220,0.55)');
  grad.addColorStop(0.45, 'rgba(120,120,120,0.35)');
  grad.addColorStop(1, 'rgba(40,40,40,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  _smokeTex = new THREE.CanvasTexture(canvas);
  _smokeTex.colorSpace = THREE.SRGBColorSpace;
  return _smokeTex;
}

/** Tall smoke columns readable from the diorama camera pull-back. */
export class SmokeField {
  readonly puffs: SmokePuff[] = [];
  private maxPuffs = 48;

  spawnColumn(wx: number, wz: number, parent: THREE.Object3D, intensity = 1): void {
    const tex = smokeTexture();
    if (!tex) return;
    const count = Math.min(6, Math.ceil(intensity * 4));
    for (let i = 0; i < count; i++) {
      if (this.puffs.length >= this.maxPuffs) break;
      const mat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        opacity: 0.65,
        color: 0xd4d4d8,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.position.set(wx + (Math.random() - 0.5) * 0.6, 0.5 + i * 0.35, wz + (Math.random() - 0.5) * 0.6);
      const baseScale = 2.4 + intensity * 1.6 + Math.random() * 0.8;
      sprite.scale.set(baseScale, baseScale * 1.35, 1);
      sprite.renderOrder = 5;
      parent.add(sprite);
      const maxLife = 3.5 + intensity * 2.2 + Math.random();
      this.puffs.push({
        sprite,
        vx: (Math.random() - 0.5) * 0.35,
        vy: 1.1 + intensity * 0.55 + Math.random() * 0.4,
        vz: (Math.random() - 0.5) * 0.35,
        life: maxLife,
        maxLife,
        baseScale,
      });
    }
  }

  update(dt: number, windX = 0.15, reduceMotion = false): void {
    const riseMul = reduceMotion ? 0.55 : 1;
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const puff = this.puffs[i];
      puff.life -= dt;
      puff.sprite.position.x += (puff.vx + windX) * dt;
      puff.sprite.position.y += puff.vy * riseMul * dt;
      puff.sprite.position.z += puff.vz * dt;
      const t = 1 - puff.life / puff.maxLife;
      const scale = puff.baseScale * (1 + t * 2.8);
      puff.sprite.scale.set(scale, scale * 1.4, 1);
      const mat = puff.sprite.material as THREE.SpriteMaterial;
      mat.opacity = Math.max(0, (puff.life / puff.maxLife) * 0.72);
      if (puff.life <= 0) {
        puff.sprite.removeFromParent();
        mat.dispose();
        this.puffs.splice(i, 1);
      }
    }
  }

  clear(): void {
    while (this.puffs.length) {
      const puff = this.puffs.pop()!;
      puff.sprite.removeFromParent();
      (puff.sprite.material as THREE.SpriteMaterial).dispose();
    }
  }
}