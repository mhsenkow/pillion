/// <reference lib="webworker" />
import { handleVoxelWorkerRequest, type VoxelWorkerRequest } from './voxelWorkerCore';

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (ev: MessageEvent<VoxelWorkerRequest>) => {
  const res = handleVoxelWorkerRequest(ev.data);
  self.postMessage(res);
};