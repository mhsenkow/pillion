import * as THREE from 'three';

export interface DebrisParticle {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  spin: number;
  settled: boolean;
}

const _sharedGeo: THREE.BoxGeometry | null =
  typeof THREE !== 'undefined' ? new THREE.BoxGeometry(0.18, 0.18, 0.18) : null;
const _mats = new Map<number, THREE.MeshStandardMaterial>();

function debrisMat(hex: number): THREE.MeshStandardMaterial {
  let m = _mats.get(hex);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.85, metalness: 0.05 });
    _mats.set(hex, m);
  }
  return m;
}

/** Falling voxel chunks from structural collapse; they settle as ground rubble. */
export class DebrisField {
  readonly particles: DebrisParticle[] = [];

  spawnBurst(
    wx: number,
    wy: number,
    wz: number,
    parent: THREE.Object3D,
    count = 8,
    color = 0x78716c,
    speed = 4.5,
  ): void {
    if (!_sharedGeo) return;
    const mat = debrisMat(color);
    const n = Math.max(1, count);
    for (let i = 0; i < n; i++) {
      const mesh = new THREE.Mesh(_sharedGeo, mat);
      mesh.position.set(wx + (Math.random() - 0.5) * 0.4, wy + Math.random() * 0.35, wz + (Math.random() - 0.5) * 0.4);
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      parent.add(mesh);
      const angle = Math.random() * Math.PI * 2;
      const spd = (0.35 + Math.random() * 0.65) * speed;
      this.particles.push({
        mesh,
        vx: Math.cos(angle) * spd,
        vy: 1.8 + Math.random() * speed * 0.6,
        vz: Math.sin(angle) * spd,
        life: 2.2 + Math.random() * 1.4,
        spin: (Math.random() - 0.5) * 9,
        settled: false,
      });
    }
  }

  update(dt: number, reduceMotion = false): number {
    let settled = 0;
    const grav = reduceMotion ? 12 : 22;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (!p.settled) {
        p.vy -= grav * dt;
        p.mesh.position.x += p.vx * dt;
        p.mesh.position.y += p.vy * dt;
        p.mesh.position.z += p.vz * dt;
        p.mesh.rotation.x += p.spin * dt;
        p.mesh.rotation.z += p.spin * dt * 0.7;
        if (p.mesh.position.y <= 0.1) {
          p.mesh.position.y = 0.08 + Math.random() * 0.04;
          p.vx *= 0.35;
          p.vz *= 0.35;
          p.vy = 0;
          p.settled = true;
          p.mesh.scale.setScalar(0.55 + Math.random() * 0.25);
          settled++;
        }
      } else if (p.life <= 0) {
        p.mesh.removeFromParent();
        this.particles.splice(i, 1);
        continue;
      }
      if (p.life <= 0) {
        p.mesh.removeFromParent();
        this.particles.splice(i, 1);
      }
    }
    return settled;
  }

  clear(): void {
    while (this.particles.length) {
      const p = this.particles.pop()!;
      p.mesh.removeFromParent();
    }
  }
}