import { GRID_W, GRID_L, TILE } from '../core/constants';
import { idx, gridToWorld } from '../geo/voxelizer';
import * as THREE from 'three';

export function computeDijkstraFlowField(
  surfaceGrid: Uint8Array,
  flowDistance: Float32Array,
  flowDirX: Float32Array,
  flowDirZ: Float32Array,
  targetX: number,
  targetZ: number,
): void {
  const cells = GRID_W * GRID_L;
  const tx = Math.max(0, Math.min(GRID_W - 1, targetX | 0));
  const tz = Math.max(0, Math.min(GRID_L - 1, targetZ | 0));
  const startIdx = idx(tx, tz);

  // Integer costs so a cell is only updated when the path actually gets shorter.
  // Float costs on a Float32Array were re-queueing the same cells until the
  // heap threw "Invalid array length" and the game failed to boot.
  const INF = 1_000_000_000;
  const dist = new Int32Array(cells);
  dist.fill(INF);
  dist[startIdx] = 0;

  const stepCost = (tile: number): number => {
    if (tile === TILE.BUILDING || tile === TILE.WATER) return -1;
    if (tile === TILE.TOXIC) return 64;
    if (tile === TILE.RUBBLE) return 48;
    if (tile === TILE.PARKING) return 18;
    if (tile === TILE.FIELD) return 23;
    return 20;
  };

  const cap = cells * 8;
  const heapD = new Int32Array(cap);
  const heapI = new Int32Array(cap);
  let n = 0;
  const swap = (a: number, b: number) => {
    const td = heapD[a];
    heapD[a] = heapD[b];
    heapD[b] = td;
    const ti = heapI[a];
    heapI[a] = heapI[b];
    heapI[b] = ti;
  };
  const push = (d: number, i: number) => {
    if (n >= cap) return;
    let k = n++;
    heapD[k] = d;
    heapI[k] = i;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heapD[p] <= heapD[k]) break;
      swap(p, k);
      k = p;
    }
  };
  const pop = (): [number, number] => {
    const d = heapD[0];
    const i = heapI[0];
    n -= 1;
    heapD[0] = heapD[n];
    heapI[0] = heapI[n];
    let k = 0;
    while (true) {
      const l = k * 2 + 1;
      const r = l + 1;
      let s = k;
      if (l < n && heapD[l] < heapD[s]) s = l;
      if (r < n && heapD[r] < heapD[s]) s = r;
      if (s === k) break;
      swap(k, s);
      k = s;
    }
    return [d, i];
  };

  push(0, startIdx);
  const dirs: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  while (n > 0) {
    const [curDist, cIdx] = pop();
    if (curDist !== dist[cIdx]) continue;
    const cx = cIdx % GRID_W;
    const cz = (cIdx / GRID_W) | 0;
    for (let i = 0; i < 4; i++) {
      const nx = cx + dirs[i][0];
      const nz = cz + dirs[i][1];
      if (nx < 0 || nx >= GRID_W || nz < 0 || nz >= GRID_L) continue;
      const nIdx = idx(nx, nz);
      const step = stepCost(surfaceGrid[nIdx]);
      if (step < 0) continue;
      const next = curDist + step;
      if (next < dist[nIdx]) {
        dist[nIdx] = next;
        push(next, nIdx);
      }
    }
  }

  for (let i = 0; i < cells; i++) {
    flowDistance[i] = dist[i] >= INF ? 9999 : dist[i] / 20;
  }
  flowDirX.fill(0);
  flowDirZ.fill(0);

  for (let gz = 0; gz < GRID_L; gz++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      const cIdx = idx(gx, gz);
      if (flowDistance[cIdx] >= 9999) continue;
      let bestDx = 0;
      let bestDz = 0;
      let minD = flowDistance[cIdx];
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const nx = gx + dx;
          const nz = gz + dz;
          if (nx < 0 || nx >= GRID_W || nz < 0 || nz >= GRID_L) continue;
          const d = flowDistance[idx(nx, nz)];
          if (d < minD) {
            minD = d;
            bestDx = dx;
            bestDz = dz;
          }
        }
      }
      const len = Math.hypot(bestDx, bestDz) || 1;
      flowDirX[cIdx] = bestDx / len;
      flowDirZ[cIdx] = bestDz / len;
    }
  }
}

export function rebuildFlowDebugOverlay(
  group: THREE.Group,
  show: boolean,
  flowDistance: Float32Array,
  flowDirX: Float32Array,
  flowDirZ: Float32Array,
): void {
  while (group.children.length) {
    const c = group.children.pop()!;
    if (c instanceof THREE.InstancedMesh) {
      c.geometry.dispose();
      (c.material as THREE.Material).dispose();
    }
  }
  if (!show) return;

  const dotGeo = new THREE.BoxGeometry(0.14, 0.06, 0.34);
  const dotMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
  const inst = new THREE.InstancedMesh(dotGeo, dotMat, (GRID_W / 2) * (GRID_L / 2));
  const dummy = new THREE.Object3D();
  let count = 0;
  for (let gz = 0; gz < GRID_L; gz += 2) {
    for (let gx = 0; gx < GRID_W; gx += 2) {
      const cIdx = idx(gx, gz);
      if (flowDistance[cIdx] >= 9999) continue;
      const { wx, wz } = gridToWorld(gx, gz);
      dummy.position.set(wx, 0.16, wz);
      dummy.rotation.set(0, Math.atan2(-flowDirX[cIdx], -flowDirZ[cIdx]), 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      inst.setMatrixAt(count++, dummy.matrix);
    }
  }
  inst.count = count;
  inst.instanceMatrix.needsUpdate = true;
  group.add(inst);
}
