import * as THREE from 'three';
import type { BikeConfig, CharacterConfig, ChassisType } from '../core/types';
import { buildChibiCharacter, type ChibiRig } from './chibiCharacterBuilder';
import { hexToNumber } from './palettes';

export interface BikeRig {
  root: THREE.Group;
  chassis: THREE.Group;
  sidecar?: THREE.Group;
  rider1: ChibiRig;
  rider2: ChibiRig;
  rider1Seat: THREE.Group;
  rider2Seat: THREE.Group;
  headlight: THREE.SpotLight;
  frontWheel: THREE.Mesh;
  rearWheel: THREE.Mesh;
  sidecarWheel?: THREE.Mesh;
  parts: Record<string, THREE.Object3D>;
}

function box(
  sx: number,
  sy: number,
  sz: number,
  color: number | string,
  opts: { roughness?: number; metalness?: number } = {},
): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({
    color: typeof color === 'string' ? hexToNumber(color) : color,
    roughness: opts.roughness ?? 0.55,
    metalness: opts.metalness ?? 0.35,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function stripeTexture(pattern: BikeConfig['sidecarPattern'], red: string, black: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  if (pattern === 'stripes') {
    for (let x = 0; x < 64; x += 12) {
      ctx.fillStyle = x % 24 === 0 ? red : black;
      ctx.fillRect(x, 0, 12, 64);
    }
  } else if (pattern === 'chevron') {
    ctx.fillStyle = black;
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = red;
    for (let y = 0; y < 64; y += 16) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(32, y + 8);
      ctx.lineTo(0, y + 16);
      ctx.closePath();
      ctx.fill();
    }
  } else if (pattern === 'rust') {
    ctx.fillStyle = '#78350f';
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#92400e';
    for (let i = 0; i < 30; i++) {
      ctx.fillRect(Math.random() * 64, Math.random() * 64, 6, 4);
    }
  } else {
    ctx.fillStyle = red;
    ctx.fillRect(0, 0, 64, 64);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildBikeRig(
  bike: BikeConfig,
  rider1Cfg: CharacterConfig,
  rider2Cfg: CharacterConfig,
): BikeRig {
  const root = new THREE.Group();
  root.name = 'bikeRig';
  const chassis = new THREE.Group();
  chassis.name = 'chassis';
  const parts: Record<string, THREE.Object3D> = {};

  const tireMat = { roughness: 0.9, metalness: 0.05 };
  const frontWheel = box(0.36, 0.55, 0.55, '#18181b', tireMat);
  frontWheel.position.set(0, 0.28, -0.72);
  const rearWheel = box(0.36, 0.55, 0.55, '#18181b', tireMat);
  rearWheel.position.set(0, 0.28, 0.68);
  chassis.add(frontWheel, rearWheel);
  parts.frontWheel = frontWheel;
  parts.rearWheel = rearWheel;

  // Frame
  const frame = box(0.38, 0.34, 1.4, bike.frameColor, {
    metalness: bike.metallic,
    roughness: bike.roughness,
  });
  frame.position.set(0, 0.48, 0);
  chassis.add(frame);
  parts.frame = frame;

  // Fuel tank — crimson with circular emblem
  const tank = box(0.48, 0.34, 0.58, bike.tankColor, {
    metalness: bike.metallic * 0.6,
    roughness: 0.35,
  });
  tank.position.set(0, 0.74, -0.22);
  const emblem = box(0.16, 0.16, 0.04, '#0a0a0a', { metalness: 0.7 });
  emblem.position.set(0.25, 0.74, -0.22);
  const emblemInner = box(0.1, 0.1, 0.03, bike.tankColor);
  emblemInner.position.set(0.26, 0.74, -0.22);
  chassis.add(tank, emblem, emblemInner);
  parts.tank = tank;

  // Handlebars
  const bars = box(0.7, 0.06, 0.06, '#a1a1aa', { metalness: 0.8, roughness: 0.3 });
  bars.position.set(0, 0.95, -0.55);
  const riser = box(0.06, 0.2, 0.06, '#71717a', { metalness: 0.7 });
  riser.position.set(0, 0.85, -0.55);
  chassis.add(bars, riser);

  // Exhaust
  const exhL = box(0.08, 0.08, 0.7, '#94a3b8', { metalness: 0.85, roughness: 0.25 });
  exhL.position.set(-0.28, 0.32, 0.35);
  const exhR = exhL.clone();
  exhR.position.x = 0.28;
  chassis.add(exhL, exhR);

  // Headlight
  const lamp = box(0.3, 0.28, 0.18, bike.headlightColor);
  lamp.position.set(0, 0.78, -0.85);
  const bezel = box(0.34, 0.32, 0.06, '#d4d4d8', { metalness: 0.9, roughness: 0.2 });
  bezel.position.set(0, 0.78, -0.74);
  chassis.add(lamp, bezel);
  parts.headlight = lamp;

  const headlight = new THREE.SpotLight(hexToNumber(bike.headlightColor), 2.2, 24, Math.PI / 5, 0.45, 1.2);
  headlight.position.set(0, 0.9, -0.8);
  headlight.target.position.set(0, 0.1, -9);
  chassis.add(headlight, headlight.target);

  // Seats
  const rider1Seat = new THREE.Group();
  rider1Seat.name = 'rider1Seat';
  const rider2Seat = new THREE.Group();
  rider2Seat.name = 'rider2Seat';

  let sidecar: THREE.Group | undefined;
  let sidecarWheel: THREE.Mesh | undefined;

  if (bike.chassis === 'sidecar') {
    // Driver seat on bike
    const seat = box(0.42, 0.14, 0.55, bike.seatColor, { roughness: 0.85 });
    seat.position.set(0, 0.68, 0.05);
    chassis.add(seat);
    rider1Seat.position.set(0, 0.75, -0.05);

    // Torpedo sidecar
    sidecar = new THREE.Group();
    sidecar.name = 'sidecar';
    const side = bike.sidecarSide === 'right' ? 1 : -1;
    sidecar.position.set(side * 0.95, 0, 0.15);

    const stripeTex = stripeTexture(bike.sidecarPattern, bike.tankColor, bike.stripeColor);
    const bodyMat = new THREE.MeshStandardMaterial({
      map: stripeTex,
      roughness: 0.45,
      metalness: bike.metallic * 0.5,
    });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, 1.35), bodyMat);
    body.position.set(0, 0.42, 0);
    body.castShadow = true;
    sidecar.add(body);
    parts.sidecarBody = body;

    // Nose cone
    const nose = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.4, 0.45),
      bodyMat,
    );
    nose.position.set(0, 0.38, -0.75);
    sidecar.add(nose);

    // Red plush seat
    const scSeat = box(0.5, 0.18, 0.55, bike.seatColor, { roughness: 0.9 });
    scSeat.position.set(0, 0.55, 0.1);
    const seatBack = box(0.5, 0.4, 0.12, bike.seatColor, { roughness: 0.9 });
    seatBack.position.set(0, 0.72, 0.4);
    sidecar.add(scSeat, seatBack);

    // Fender + wheel
    const fender = box(0.2, 0.35, 0.7, bike.frameColor, { metalness: 0.5 });
    fender.position.set(side * 0.42, 0.35, 0.1);
    sidecarWheel = box(0.22, 0.5, 0.5, '#18181b', tireMat);
    sidecarWheel.position.set(side * 0.55, 0.28, 0.15);
    sidecar.add(fender, sidecarWheel);
    parts.sidecarWheel = sidecarWheel;

    // Mount arm
    const mount = box(0.55, 0.08, 0.12, '#52525b', { metalness: 0.7 });
    mount.position.set(-side * 0.35, 0.45, 0);
    sidecar.add(mount);

    chassis.add(sidecar);
    rider2Seat.position.copy(sidecar.position);
    rider2Seat.position.y = 0.72;
    rider2Seat.position.z += 0.05;
  } else {
    // Tandem scrambler
    const seat = box(0.42, 0.16, 0.95, bike.seatColor, { roughness: 0.85 });
    seat.position.set(0, 0.68, 0.2);
    chassis.add(seat);
    rider1Seat.position.set(0, 0.75, -0.08);
    rider2Seat.position.set(0, 0.78, 0.48);
  }

  chassis.add(rider1Seat, rider2Seat);
  root.add(chassis);

  const rider1 = buildChibiCharacter(rider1Cfg);
  const rider2 = buildChibiCharacter(rider2Cfg);
  rider1Seat.add(rider1.root);
  rider2Seat.add(rider2.root);

  // Sidecar rider sits more upright / facing slightly out
  if (bike.chassis === 'sidecar') {
    rider2.root.rotation.y = bike.sidecarSide === 'right' ? -0.15 : 0.15;
    // Driver aims left arm out for one-handed shotgun pose
    rider1.leftArm.rotation.x = -0.6;
    rider1.leftArm.rotation.z = 0.4;
    rider1.weapon.position.set(0.1, -0.2, -0.5);
    rider1.leftArm.add(rider1.weapon);
  } else {
    rider2.root.rotation.y = Math.PI; // face rearward turret by default; sim will override
  }

  return {
    root,
    chassis,
    sidecar,
    rider1,
    rider2,
    rider1Seat,
    rider2Seat,
    headlight,
    frontWheel,
    rearWheel,
    sidecarWheel,
    parts,
  };
}

export function rebuildBikeRig(
  previous: BikeRig | null,
  parent: THREE.Object3D,
  bike: BikeConfig,
  r1: CharacterConfig,
  r2: CharacterConfig,
): BikeRig {
  if (previous) {
    parent.remove(previous.root);
    previous.root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const m = o.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else (m as THREE.Material).dispose();
      }
    });
  }
  const rig = buildBikeRig(bike, r1, r2);
  parent.add(rig.root);
  return rig;
}

export function chassisLabel(c: ChassisType): string {
  return c === 'sidecar' ? 'Torpedo Sidecar Rig' : 'Tandem Scrambler';
}
