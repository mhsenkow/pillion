import type { GeoBBox } from '../src/geo/projection';
import { bboxKey } from '../src/geo/projection';

export const OSM_CACHE_TTL_SEC = 3600;

export function osmOverpassCacheKey(bbox: GeoBBox): string {
  return `osm:v1:${bboxKey(bbox)}`;
}

export interface MemoryCacheEntry {
  body: string;
  expiresAt: number;
}

export class OverpassMemoryCache {
  private map = new Map<string, MemoryCacheEntry>();

  constructor(private ttlMs = OSM_CACHE_TTL_SEC * 1000) {}

  get(key: string): string | null {
    const hit = this.map.get(key);
    if (!hit) return null;
    if (Date.now() > hit.expiresAt) {
      this.map.delete(key);
      return null;
    }
    return hit.body;
  }

  set(key: string, body: string): void {
    this.map.set(key, { body, expiresAt: Date.now() + this.ttlMs });
    if (this.map.size > 200) {
      const oldest = this.map.keys().next().value;
      if (oldest) this.map.delete(oldest);
    }
  }
}