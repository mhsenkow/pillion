import { HALF_W, HALF_L, TILE } from '../core/constants';
import type { BikeState, GameState } from '../core/types';
import { idx, worldToGrid } from '../geo/voxelizer';

export interface PhysicsResult {
  chunkDx: number;
  chunkDz: number;
  crushedRubble: boolean;
  rubbleX: number;
  rubbleZ: number;
  bounced: boolean;
  bounceX: number;
  bounceZ: number;
  visualSteerTilt: number;
  onToxic: boolean;
}

export function updateBikePhysics(state: GameState, dt: number): PhysicsResult {
  const b = state.bike;
  const result: PhysicsResult = {
    chunkDx: 0,
    chunkDz: 0,
    crushedRubble: false,
    rubbleX: 0,
    rubbleZ: 0,
    bounced: false,
    bounceX: 0,
    bounceZ: 0,
    visualSteerTilt: 0,
    onToxic: false,
  };

  const rawUp = state.keys.up ? 1 : 0;
  const rawDown = state.keys.down ? 1 : 0;
  const rawLeft = state.keys.left ? 1 : 0;
  const rawRight = state.keys.right ? 1 : 0;

  b.drifting = state.keys.space && Math.hypot(b.vx, b.vz) > 3.0 && b.fuel > 1;
  let visualSteerTilt = 0;

  if (state.steerMode === 'SCREEN') {
    const inputX = rawRight - rawLeft;
    const inputZ = rawDown - rawUp;
    const inputMag = Math.hypot(inputX, inputZ);
    if (inputMag > 0.01) {
      const nx = inputX / inputMag;
      const nz = inputZ / inputMag;
      const cosY = Math.cos(state.cameraYawOffset);
      const sinY = Math.sin(state.cameraYawOffset);
      const worldDirX = nx * cosY + nz * sinY;
      const worldDirZ = -nx * sinY + nz * cosY;
      const desiredHeading = Math.atan2(-worldDirX, -worldDirZ);
      let angleDiff = desiredHeading - b.heading;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
      const turnSpeed = b.drifting ? 10.5 : 7.8;
      b.heading += angleDiff * Math.min(1, turnSpeed * dt);
      visualSteerTilt = Math.max(-1, Math.min(1, angleDiff * 1.8));
      const forwardX = -Math.sin(b.heading);
      const forwardZ = -Math.cos(b.heading);
      const engineForce = 25.0;
      b.vx += (forwardX * 0.75 + worldDirX * 0.25) * engineForce * dt;
      b.vz += (forwardZ * 0.75 + worldDirZ * 0.25) * engineForce * dt;
    }
  } else {
    const accelInput = rawUp - rawDown * 0.7;
    let steerSign = rawLeft - rawRight;
    if (state.invertAD) steerSign = -steerSign;
    const forwardX = -Math.sin(b.heading);
    const forwardZ = -Math.cos(b.heading);
    const forwardVel = b.vx * forwardX + b.vz * forwardZ;
    const turnRate = b.drifting ? 3.8 : 2.8;
    if (Math.abs(b.speed) > 0.15 || Math.abs(accelInput) > 0.01) {
      const reverseFlip = forwardVel < -0.25 ? -1 : 1;
      b.heading += steerSign * turnRate * reverseFlip * dt;
      visualSteerTilt = steerSign;
    }
    if (accelInput !== 0) {
      b.vx += forwardX * accelInput * 24.5 * dt;
      b.vz += forwardZ * accelInput * 24.5 * dt;
    }
  }

  const forwardX = -Math.sin(b.heading);
  const forwardZ = -Math.cos(b.heading);
  const forwardVel = b.vx * forwardX + b.vz * forwardZ;
  const rightX = Math.cos(b.heading);
  const rightZ = -Math.sin(b.heading);
  const lateralVel = b.vx * rightX + b.vz * rightZ;
  // Sidecar weight transfer: slightly more lateral grip loss when drifting
  const sidecarBias = state.couple.bike.chassis === 'sidecar' ? 0.85 : 1;
  const lateralGrip = (b.drifting ? 2.0 : 10.5) * sidecarBias;
  const newLateralVel = lateralVel * Math.max(0, 1 - lateralGrip * dt);
  const drag = 1 - 1.95 * dt;
  b.vx = (forwardVel * forwardX + newLateralVel * rightX) * drag;
  b.vz = (forwardVel * forwardZ + newLateralVel * rightZ) * drag;
  b.speed = Math.hypot(b.vx, b.vz) * (forwardVel >= -0.1 ? 1 : -1);

  if (b.drifting) {
    b.fuel = Math.max(0, b.fuel - dt * 8);
    b.driftCharge = Math.min(1.5, b.driftCharge + dt);
  } else if (b.driftCharge > 0.4) {
    b.vx += forwardX * 10;
    b.vz += forwardZ * 10;
    b.driftCharge = 0;
  } else {
    b.driftCharge = 0;
  }

  const nextX = b.x + b.vx * dt;
  const nextZ = b.z + b.vz * dt;

  if (nextX > HALF_W - 0.3) {
    result.chunkDx = 1;
    return result;
  }
  if (nextX < -HALF_W + 0.3) {
    result.chunkDx = -1;
    return result;
  }
  if (nextZ > HALF_L - 0.3) {
    result.chunkDz = 1;
    return result;
  }
  if (nextZ < -HALF_L + 0.3) {
    result.chunkDz = -1;
    return result;
  }

  const { gx, gz } = worldToGrid(nextX, nextZ);
  const cIdx = idx(gx, gz);
  const nextTile = state.surfaceGrid[cIdx];

  if (nextTile === TILE.BUILDING || nextTile === TILE.WATER) {
    b.vx *= -0.45;
    b.vz *= -0.45;
    result.bounced = true;
    result.bounceX = nextX;
    result.bounceZ = nextZ;
  } else if (nextTile === TILE.RUBBLE) {
    state.surfaceGrid[cIdx] = TILE.SIDEWALK;
    b.vx *= 0.72;
    b.vz *= 0.72;
    result.crushedRubble = true;
    result.rubbleX = nextX;
    result.rubbleZ = nextZ;
  } else if (nextTile === TILE.TOXIC) {
    b.x = nextX;
    b.z = nextZ;
    b.vx *= 0.92;
    b.vz *= 0.92;
    result.onToxic = true;
  } else if (nextTile === TILE.PARKING) {
    b.x = nextX;
    b.z = nextZ;
    // Slightly sticky asphalt
    b.vx *= 0.985;
    b.vz *= 0.985;
  } else {
    b.x = nextX;
    b.z = nextZ;
  }

  const targetLean =
    -visualSteerTilt * (b.drifting ? 0.46 : 0.28) * Math.min(1, Math.abs(b.speed) / 5);
  // Sidecar roll bias
  const sidecarRoll =
    state.couple.bike.chassis === 'sidecar'
      ? (state.couple.bike.sidecarSide === 'right' ? -0.04 : 0.04)
      : 0;
  b.leanAngle += (targetLean + sidecarRoll - b.leanAngle) * 10 * dt;
  result.visualSteerTilt = visualSteerTilt;
  return result;
}

export function freeBikeFromBuilding(bike: BikeState, surfaceGrid: Uint8Array): void {
  const { gx: bgx, gz: bgz } = worldToGrid(bike.x, bike.z);
  if (surfaceGrid[idx(bgx, bgz)] !== TILE.BUILDING) return;
  for (let r = 1; r < 30; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const tx = Math.max(2, Math.min(79 - 3, bgx + dx));
        const tz = Math.max(2, Math.min(159 - 3, bgz + dz));
        const t = surfaceGrid[idx(tx, tz)];
        if (t === TILE.ROAD || t === TILE.SIDEWALK || t === TILE.PARKING || t === TILE.FIELD) {
          const { wx, wz } = {
            wx: (tx + 0.5) * 0.45 - HALF_W,
            wz: (tz + 0.5) * 0.45 - HALF_L,
          };
          bike.x = wx;
          bike.z = wz;
          return;
        }
      }
    }
  }
}
