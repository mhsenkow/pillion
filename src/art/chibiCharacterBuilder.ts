import * as THREE from 'three';
import type { CharacterConfig, PartTransform } from '../core/types';
import { hexToNumber } from './palettes';
import { getHarnessTexture, getTattooTexture } from './tattooTextures';

export interface ChibiRig {
  root: THREE.Group;
  head: THREE.Group;
  torso: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  weapon: THREE.Group;
  scarf?: THREE.Group;
  parts: Record<string, THREE.Object3D>;
}

function box(
  sx: number,
  sy: number,
  sz: number,
  color: number | string,
  opts: { roughness?: number; metalness?: number; map?: THREE.Texture | null } = {},
): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({
    color: typeof color === 'string' ? hexToNumber(color) : color,
    roughness: opts.roughness ?? 0.7,
    metalness: opts.metalness ?? 0.05,
    map: opts.map ?? null,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function applyTweak(obj: THREE.Object3D, tweak?: PartTransform): void {
  if (!tweak) return;
  obj.position.add(new THREE.Vector3(...tweak.offset));
  obj.scale.multiply(new THREE.Vector3(...tweak.scale));
  obj.rotation.x += tweak.rotation[0];
  obj.rotation.y += tweak.rotation[1];
  obj.rotation.z += tweak.rotation[2];
}

function physiqueScale(p: CharacterConfig['physique']): number {
  if (p === 'muscular') return 1.12;
  if (p === 'lean') return 0.92;
  return 1.0;
}

function buildWeapon(kind: CharacterConfig['weapon']): THREE.Group {
  const g = new THREE.Group();
  g.name = 'weapon';
  if (kind === 'wood_shotgun') {
    const stock = box(0.1, 0.14, 0.28, '#7c4a27', { roughness: 0.85 });
    stock.position.set(0, 0, 0.18);
    const barrel = box(0.08, 0.08, 0.55, '#334155', { metalness: 0.7, roughness: 0.35 });
    barrel.position.set(0, 0.02, -0.22);
    const pump = box(0.12, 0.1, 0.14, '#1e293b');
    pump.position.set(0, -0.02, -0.05);
    g.add(stock, barrel, pump);
  } else if (kind === 'tactical_shotgun') {
    const body = box(0.1, 0.12, 0.5, '#18181b', { metalness: 0.5, roughness: 0.4 });
    const barrel = box(0.07, 0.07, 0.4, '#27272a', { metalness: 0.8, roughness: 0.3 });
    barrel.position.set(0, 0.02, -0.28);
    const grip = box(0.09, 0.16, 0.1, '#0f172a');
    grip.position.set(0, -0.1, 0.12);
    g.add(body, barrel, grip);
  } else if (kind === 'tesla') {
    const body = box(0.12, 0.14, 0.4, '#0e7490', { metalness: 0.6, roughness: 0.3 });
    const coil = box(0.18, 0.18, 0.18, '#67e8f9', { metalness: 0.9, roughness: 0.2 });
    coil.position.set(0, 0.08, -0.28);
    g.add(body, coil);
  } else {
    const tube = box(0.1, 0.1, 0.45, '#be123c', { metalness: 0.4 });
    const tip = box(0.14, 0.14, 0.1, '#fb7185');
    tip.position.set(0, 0, -0.28);
    g.add(tube, tip);
  }
  return g;
}

export function buildChibiCharacter(cfg: CharacterConfig): ChibiRig {
  const root = new THREE.Group();
  root.name = cfg.id;
  const ps = physiqueScale(cfg.physique);
  const parts: Record<string, THREE.Object3D> = {};

  // Legs / pants
  const legs = new THREE.Group();
  legs.name = 'legs';
  const pantL = box(0.16 * ps, 0.32, 0.16, cfg.pantsColor);
  pantL.position.set(-0.1, 0.16, 0);
  const pantR = box(0.16 * ps, 0.32, 0.16, cfg.pantsColor);
  pantR.position.set(0.1, 0.16, 0);
  legs.add(pantL, pantR);
  root.add(legs);
  parts.legs = legs;

  // Torso
  const torso = new THREE.Group();
  torso.name = 'torso';
  torso.position.y = 0.42;
  const torsoW = 0.42 * ps;
  const torsoH = 0.46 * (cfg.physique === 'muscular' ? 1.08 : 1);
  let torsoColor: string = cfg.skinTone;
  let torsoMap: THREE.Texture | null = null;
  if (cfg.torsoStyle === 'tshirt_harness') torsoColor = '#1e293b';
  if (cfg.torsoStyle === 'armored') torsoColor = '#475569';
  if (cfg.torsoStyle === 'vest') torsoColor = '#44403c';
  if (cfg.torsoStyle === 'shirtless_harness') {
    torsoMap = getHarnessTexture(cfg.harnessColor);
  }
  const torsoMesh = box(torsoW, torsoH, 0.28 * ps, torsoColor, { map: torsoMap, roughness: 0.65 });
  torsoMesh.position.y = torsoH * 0.35;
  torso.add(torsoMesh);
  parts.torso = torsoMesh;

  // Harness straps (extra geometry for shirtless)
  if (cfg.torsoStyle === 'shirtless_harness' || cfg.torsoStyle === 'tshirt_harness') {
    const strap = box(0.08, torsoH * 0.9, 0.04, cfg.harnessColor, { roughness: 0.9 });
    strap.position.set(-torsoW * 0.28, torsoH * 0.35, 0.15);
    const strap2 = strap.clone();
    strap2.position.x = torsoW * 0.28;
    const buckle = box(0.1, 0.08, 0.05, '#c0a080', { metalness: 0.8, roughness: 0.3 });
    buckle.position.set(torsoW * 0.28, torsoH * 0.7, 0.16);
    const chestStrap = box(torsoW * 0.85, 0.06, 0.04, cfg.harnessColor);
    chestStrap.position.set(0, torsoH * 0.55, 0.15);
    torso.add(strap, strap2, buckle, chestStrap);
    parts.harness = strap;
  }

  // Abs / pecs hint for shirtless muscular
  if (cfg.torsoStyle === 'shirtless_harness' && cfg.physique !== 'lean') {
    const pec = box(torsoW * 0.35, 0.1, 0.06, cfg.skinTone, { roughness: 0.55 });
    pec.position.set(-0.1, torsoH * 0.55, 0.14);
    const pec2 = pec.clone();
    pec2.position.x = 0.1;
    torso.add(pec, pec2);
  }

  root.add(torso);

  // Head group
  const head = new THREE.Group();
  head.name = 'head';
  head.position.y = 0.42 + torsoH * 0.75 + 0.22;
  const headMesh = box(0.44, 0.44, 0.44, cfg.skinTone, { roughness: 0.5 });
  head.add(headMesh);
  parts.head = headMesh;

  // Eyes
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
  const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.04), eyeMat);
  eyeL.position.set(-0.1, 0.04, -0.22);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.1;
  head.add(eyeL, eyeR);

  // Smile
  const smile = box(0.12, 0.03, 0.03, '#5c3317');
  smile.position.set(0, -0.08, -0.22);
  head.add(smile);

  // Beard
  if (cfg.beard !== 'clean') {
    const beardGroup = new THREE.Group();
    beardGroup.name = 'beard';
    const h = cfg.beard === 'full' ? 0.2 : cfg.beard === 'stubble' ? 0.08 : 0.06;
    const beard = box(0.36, h, 0.2, cfg.beardColor, { roughness: 0.95 });
    beard.position.set(0, -0.18, -0.08);
    beardGroup.add(beard);
    if (cfg.beard === 'full' || cfg.beard === 'mustache') {
      const stache = box(0.22, 0.05, 0.08, cfg.beardColor);
      stache.position.set(0, -0.06, -0.22);
      beardGroup.add(stache);
    }
    head.add(beardGroup);
    parts.beard = beardGroup;
  }

  // Hair / beanie / helmet
  if (cfg.hair === 'beanie') {
    const beanie = box(0.48, 0.22, 0.48, cfg.beanieColor, { roughness: 0.95 });
    beanie.position.y = 0.28;
    const cuff = box(0.5, 0.08, 0.5, cfg.beanieColor);
    cuff.position.y = 0.18;
    const hairBit = box(0.3, 0.1, 0.12, cfg.hairColor);
    hairBit.position.set(0, 0.12, 0.18);
    head.add(beanie, cuff, hairBit);
    parts.beanie = beanie;
  } else if (cfg.hair === 'swept') {
    const hair = box(0.46, 0.18, 0.46, cfg.hairColor);
    hair.position.set(0, 0.26, 0.02);
    head.add(hair);
    parts.hair = hair;
  } else if (cfg.hair === 'mohawk') {
    const hawk = box(0.12, 0.28, 0.4, cfg.hairColor);
    hawk.position.set(0, 0.34, 0);
    head.add(hawk);
    parts.hair = hawk;
  } else if (cfg.hair === 'helmet') {
    const helm = box(0.5, 0.36, 0.5, '#1e293b', { metalness: 0.4, roughness: 0.45 });
    helm.position.y = 0.18;
    const visor = box(0.42, 0.12, 0.08, '#0ea5e9', { metalness: 0.6, roughness: 0.2 });
    visor.position.set(0, 0.1, -0.24);
    head.add(helm, visor);
    parts.helmet = helm;
  }
  // Bald: subtle dome highlight via lighter top voxel
  if (cfg.hair === 'bald') {
    const shine = box(0.3, 0.06, 0.3, cfg.skinTone, { roughness: 0.25, metalness: 0.15 });
    shine.position.y = 0.24;
    head.add(shine);
  }

  // Glasses
  if (cfg.glasses !== 'none') {
    const glasses = new THREE.Group();
    glasses.name = 'glasses';
    if (cfg.glasses === 'round') {
      const rim = box(0.38, 0.12, 0.04, '#27272a', { metalness: 0.7, roughness: 0.3 });
      rim.position.set(0, 0.04, -0.24);
      const lensL = box(0.12, 0.1, 0.02, '#94a3b8', { metalness: 0.9, roughness: 0.15 });
      lensL.position.set(-0.1, 0.04, -0.25);
      const lensR = lensL.clone();
      lensR.position.x = 0.1;
      const bridge = box(0.06, 0.03, 0.03, '#27272a');
      bridge.position.set(0, 0.04, -0.24);
      glasses.add(rim, lensL, lensR, bridge);
    } else if (cfg.glasses === 'aviators') {
      const frame = box(0.4, 0.1, 0.03, '#fbbf24', { metalness: 0.8 });
      frame.position.set(0, 0.04, -0.24);
      glasses.add(frame);
    } else {
      const gog = box(0.42, 0.14, 0.1, '#0f172a', { roughness: 0.4 });
      gog.position.set(0, 0.04, -0.22);
      glasses.add(gog);
    }
    head.add(glasses);
    parts.glasses = glasses;
  }

  // Earring
  if (cfg.earring !== 'none') {
    const side = cfg.earringSide === 'right' ? 0.24 : -0.24;
    const earring = new THREE.Group();
    earring.name = 'earring';
    if (cfg.earring === 'cross') {
      const v = box(0.03, 0.12, 0.03, '#18181b', { metalness: 0.5 });
      const h = box(0.08, 0.03, 0.03, '#18181b', { metalness: 0.5 });
      h.position.y = -0.02;
      earring.add(v, h);
    } else if (cfg.earring === 'hoop') {
      earring.add(box(0.08, 0.08, 0.02, '#fbbf24', { metalness: 0.9 }));
    } else {
      earring.add(box(0.04, 0.04, 0.04, '#e2e8f0', { metalness: 0.8 }));
    }
    earring.position.set(side, -0.06, 0);
    head.add(earring);
    parts.earring = earring;
  }

  root.add(head);

  // Arms
  const leftArm = new THREE.Group();
  leftArm.name = 'leftArm';
  leftArm.position.set(-torsoW * 0.55, 0.55, 0);
  const rightArm = new THREE.Group();
  rightArm.name = 'rightArm';
  rightArm.position.set(torsoW * 0.55, 0.55, 0);

  const leftTattoo = cfg.tattoos.leftArm ?? 'none';
  const rightTattoo = cfg.tattoos.rightArm ?? 'none';
  const leftTex = getTattooTexture(leftTattoo, cfg.tattooDensity);
  const rightTex = getTattooTexture(rightTattoo, cfg.tattooDensity);

  const upperL = box(0.16 * ps, 0.28, 0.16, cfg.skinTone, {
    map: leftTex,
    roughness: 0.6,
  });
  upperL.position.y = -0.05;
  const lowerL = box(0.14 * ps, 0.26, 0.14, cfg.skinTone);
  lowerL.position.y = -0.28;
  const handL = box(0.12, 0.1, 0.12, '#18181b'); // glove
  handL.position.y = -0.42;
  leftArm.add(upperL, lowerL, handL);
  parts.leftArm = leftArm;

  const upperR = box(0.16 * ps, 0.28, 0.16, cfg.skinTone, {
    map: rightTex,
    roughness: 0.6,
  });
  upperR.position.y = -0.05;
  const lowerR = box(0.14 * ps, 0.26, 0.14, cfg.skinTone);
  lowerR.position.y = -0.28;
  const handR = box(0.12, 0.1, 0.12, '#18181b');
  handR.position.y = -0.42;
  rightArm.add(upperR, lowerR, handR);
  parts.rightArm = rightArm;

  root.add(leftArm, rightArm);

  // Weapon attached to right arm by default (can reparent)
  const weapon = buildWeapon(cfg.weapon);
  weapon.position.set(0.05, -0.35, -0.35);
  rightArm.add(weapon);
  parts.weapon = weapon;

  // Scarf
  let scarf: THREE.Group | undefined;
  if (cfg.scarf) {
    scarf = new THREE.Group();
    scarf.name = 'scarf';
    for (let s = 0; s < 3; s++) {
      const seg = box(0.14, 0.12, 0.18, cfg.scarfColor);
      seg.position.set(0.16, 0.95 - s * 0.03, 0.18 + s * 0.16);
      scarf.add(seg);
    }
    root.add(scarf);
    parts.scarf = scarf;
  }

  // Apply part tweaks
  for (const [name, tweak] of Object.entries(cfg.partTweaks)) {
    if (parts[name] && tweak) applyTweak(parts[name], tweak);
  }

  return { root, head, torso, leftArm, rightArm, weapon, scarf, parts };
}

export function disposeChibi(rig: ChibiRig): void {
  rig.root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      const m = obj.material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else m.dispose();
    }
  });
}
