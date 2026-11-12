import * as THREE from 'three';
import type { ZombieKind } from '../core/types';
import { ZOMBIE_VARIANTS, hexToNumber } from './palettes';

function box(
  sx: number,
  sy: number,
  sz: number,
  color: string | number,
  opts: { roughness?: number; metalness?: number; basic?: boolean } = {},
): THREE.Mesh {
  const mat = opts.basic
    ? new THREE.MeshBasicMaterial({ color: typeof color === 'string' ? hexToNumber(color) : color })
    : new THREE.MeshStandardMaterial({
        color: typeof color === 'string' ? hexToNumber(color) : color,
        roughness: opts.roughness ?? 0.85,
        metalness: opts.metalness ?? 0.05,
      });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
  mesh.castShadow = false;
  return mesh;
}

export function buildZombie(kind: ZombieKind = 'walker'): THREE.Group {
  const cfg = ZOMBIE_VARIANTS[kind] ?? ZOMBIE_VARIANTS.walker;
  const g = new THREE.Group();
  g.name = `zombie_${kind}`;
  const s = cfg.scale;

  // Gaunt legs
  const legL = box(0.12 * s, 0.32 * s, 0.12 * s, cfg.skin);
  legL.position.set(-0.08 * s, 0.16 * s, 0);
  const legR = box(0.12 * s, 0.32 * s, 0.12 * s, cfg.skin);
  legR.position.set(0.08 * s, 0.16 * s, 0);
  g.add(legL, legR);

  // Tattered shirt torso
  const torso = box(0.36 * s, 0.42 * s, 0.24 * s, cfg.shirt, { roughness: 0.9 });
  torso.position.y = 0.42 * s;
  g.add(torso);

  // Torn flaps
  if (kind !== 'mutant') {
    const flap = box(0.1 * s, 0.16 * s, 0.04 * s, cfg.shirt);
    flap.position.set(0.18 * s, 0.28 * s, 0.05 * s);
    flap.rotation.z = 0.4;
    g.add(flap);
  }

  // Gaunt skull with sunken cheeks
  const head = box(0.38 * s, 0.4 * s, 0.36 * s, cfg.skin, { roughness: 0.7 });
  head.position.y = 0.78 * s;
  const cheekL = box(0.08 * s, 0.12 * s, 0.1 * s, '#5c5468');
  cheekL.position.set(-0.16 * s, 0.72 * s, -0.05 * s);
  const cheekR = cheekL.clone();
  cheekR.position.x = 0.16 * s;
  g.add(head, cheekL, cheekR);

  // Glowing eyes
  const eyeL = box(0.08 * s, 0.08 * s, 0.05 * s, cfg.eyeColor, { basic: true });
  eyeL.position.set(-0.1 * s, 0.8 * s, -0.18 * s);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.1 * s;
  g.add(eyeL, eyeR);

  // Reaching arms
  const armL = new THREE.Group();
  armL.position.set(-0.24 * s, 0.55 * s, 0);
  const upperL = box(0.12 * s, 0.28 * s, 0.12 * s, cfg.skin);
  const lowerL = box(0.1 * s, 0.28 * s, 0.1 * s, cfg.skin);
  lowerL.position.set(0, -0.26 * s, -0.08 * s);
  const handL = box(0.1 * s, 0.08 * s, 0.14 * s, cfg.skin);
  handL.position.set(0, -0.4 * s, -0.16 * s);
  armL.add(upperL, lowerL, handL);
  armL.rotation.x = kind === 'clamberer' ? -1.1 : -0.85;
  armL.rotation.z = 0.25;

  const armR = armL.clone();
  armR.position.x = 0.24 * s;
  armR.rotation.z = -0.25;
  if (kind === 'runner') {
    armR.rotation.x = -0.4;
    armL.rotation.x = -1.2;
  }
  g.add(armL, armR);

  if (kind === 'mutant') {
    const horn = box(0.08 * s, 0.2 * s, 0.08 * s, '#c026d3');
    horn.position.set(-0.12 * s, 1.05 * s, 0);
    const horn2 = horn.clone();
    horn2.position.x = 0.12 * s;
    g.add(horn, horn2);
  }

  return g;
}

export function buildRuinedCar(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'ruinedCar';
  const body = box(1.1, 0.45, 2.0, '#e7e5e4', { roughness: 0.7 });
  body.position.y = 0.35;
  const cabin = box(0.95, 0.4, 0.9, '#a8a29e');
  cabin.position.set(0, 0.7, -0.15);
  const window = box(0.7, 0.28, 0.05, '#334155');
  window.position.set(0, 0.72, -0.6);
  const wheelFL = box(0.18, 0.35, 0.35, '#18181b');
  wheelFL.position.set(-0.55, 0.18, -0.65);
  const wheelFR = wheelFL.clone();
  wheelFR.position.x = 0.55;
  const wheelRL = wheelFL.clone();
  wheelRL.position.z = 0.65;
  const wheelRR = wheelFR.clone();
  wheelRR.position.z = 0.65;
  // Rust patches
  const rust = box(0.3, 0.1, 0.4, '#9a3412');
  rust.position.set(0.4, 0.5, 0.3);
  g.add(body, cabin, window, wheelFL, wheelFR, wheelRL, wheelRR, rust);
  return g;
}

export function buildToxicBarrel(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'toxicBarrel';
  const drum = box(0.42, 0.7, 0.42, '#365314', { roughness: 0.55, metalness: 0.35 });
  drum.position.y = 0.38;
  const stripe = box(0.44, 0.12, 0.44, '#a3e635');
  stripe.position.y = 0.5;
  const lid = box(0.4, 0.06, 0.4, '#1a2e05');
  lid.position.y = 0.74;
  g.add(drum, stripe, lid);
  return g;
}

export function buildScrapPile(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'scrapPile';
  const a = box(0.55, 0.22, 0.4, '#78716c');
  a.position.set(0, 0.12, 0);
  const b = box(0.35, 0.18, 0.5, '#57534e');
  b.position.set(0.15, 0.28, 0.05);
  const c = box(0.25, 0.12, 0.25, '#f59e0b', { metalness: 0.5, roughness: 0.35 });
  c.position.set(-0.12, 0.22, -0.08);
  g.add(a, b, c);
  return g;
}

export function buildStreetLamp(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'streetLamp';
  const pole = box(0.08, 1.6, 0.08, '#475569', { metalness: 0.4, roughness: 0.45 });
  pole.position.y = 0.8;
  const arm = box(0.45, 0.06, 0.06, '#64748b', { metalness: 0.35, roughness: 0.4 });
  arm.position.set(0.18, 1.55, 0);
  const lamp = box(0.18, 0.1, 0.18, '#fde68a', { basic: true });
  lamp.position.set(0.36, 1.48, 0);
  g.add(pole, arm, lamp);
  return g;
}
