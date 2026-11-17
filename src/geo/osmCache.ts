import type { OsmData } from '../core/types';
import { bboxKey, type GeoBBox } from './projection';

/**
 * Client block cache keys (IndexedDB / localStorage).
 *
 * Block key: `block:${chunkX}:${chunkZ}:${bboxKey(bbox)}`
 *
 * Cloudflare Worker KV (when bound) uses the same bbox suffix:
 *   `osm:v1:${bboxKey(bbox)}`
 * See `worker/osmCacheKv.ts` and `osmKvCacheKey`.
 */
export function osmBlockCacheKey(chunkX: number, chunkZ: number, bbox: GeoBBox): string {
  return `block:${chunkX}:${chunkZ}:${bboxKey(bbox)}`;
}

export function osmKvCacheKey(bbox: GeoBBox): string {
  return `osm:v1:${bboxKey(bbox)}`;
}

const LS_PREFIX = 'pillion.osm.mem.';
const DB_NAME = 'pillion-osm';
const DB_VERSION = 1;
const STORE = 'blocks';
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface CacheEnvelope {
  savedAt: number;
  data: OsmData;
}

const memory = new Map<string, CacheEnvelope>();

function lsKey(key: string): string {
  return LS_PREFIX + key;
}

function readLs(key: string, ttlMs: number): OsmData | null {
  try {
    const raw = localStorage.getItem(lsKey(key));
    if (!raw) return null;
    const env = JSON.parse(raw) as CacheEnvelope;
    if (Date.now() - env.savedAt > ttlMs) {
      localStorage.removeItem(lsKey(key));
      return null;
    }
    return env.data;
  } catch {
    return null;
  }
}

function writeLs(key: string, data: OsmData): void {
  try {
    const env: CacheEnvelope = { savedAt: Date.now(), data };
    localStorage.setItem(lsKey(key), JSON.stringify(env));
  } catch {
    /* quota */
  }
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => resolve(null);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
    });
  }
  return dbPromise;
}

async function idbGet(key: string, ttlMs: number): Promise<OsmData | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const req = store.get(key);
    req.onsuccess = () => {
      const env = req.result as CacheEnvelope | undefined;
      if (!env || Date.now() - env.savedAt > ttlMs) {
        resolve(null);
        return;
      }
      resolve(env.data);
    };
    req.onerror = () => resolve(null);
  });
}

async function idbPut(key: string, data: OsmData): Promise<void> {
  const db = await openDb();
  if (!db) return;
  const env: CacheEnvelope = { savedAt: Date.now(), data };
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(env, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

/** Read OSM parse results from memory → localStorage → IndexedDB. */
export async function getOsmCached(key: string, ttlMs = DEFAULT_TTL_MS): Promise<OsmData | null> {
  const mem = memory.get(key);
  if (mem && Date.now() - mem.savedAt <= ttlMs) return mem.data;

  const fromLs = readLs(key, ttlMs);
  if (fromLs) {
    memory.set(key, { savedAt: Date.now(), data: fromLs });
    return fromLs;
  }

  const fromIdb = await idbGet(key, ttlMs);
  if (fromIdb) {
    memory.set(key, { savedAt: Date.now(), data: fromIdb });
    return fromIdb;
  }
  return null;
}

/** Persist parsed OSM for a world block. */
export async function putOsmCached(key: string, data: OsmData): Promise<void> {
  const env: CacheEnvelope = { savedAt: Date.now(), data };
  memory.set(key, env);
  writeLs(key, data);
  await idbPut(key, data);
}

export function clearOsmMemoryCache(): void {
  memory.clear();
}