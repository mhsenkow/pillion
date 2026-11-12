import { defineConfig } from 'vite';
import { resolve } from 'path';
import type { Plugin } from 'vite';
import { buildOverpassQueryFromBBox } from './src/geo/overpassQuery';
import { bboxFromCenter, padBBox } from './src/geo/projection';

const OVERPASS_MIRRORS = [
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

function osmDevProxy(): Plugin {
  return {
    name: 'pillion-osm-dev-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/osm')) return next();
        try {
          const url = new URL(req.url, 'http://localhost');
          const s = parseFloat(url.searchParams.get('s') || '');
          const w = parseFloat(url.searchParams.get('w') || '');
          const n = parseFloat(url.searchParams.get('n') || '');
          const e = parseFloat(url.searchParams.get('e') || '');
          const lat = parseFloat(url.searchParams.get('lat') || '');
          const lon = parseFloat(url.searchParams.get('lon') || '');
          const bbox =
            [s, w, n, e].every(Number.isFinite)
              ? { south: s, west: w, north: n, east: e, curLat: Number.isFinite(lat) ? lat : (s + n) / 2, curLon: Number.isFinite(lon) ? lon : (w + e) / 2 }
              : Number.isFinite(lat) && Number.isFinite(lon)
                ? padBBox(bboxFromCenter(lat, lon))
                : null;
          if (!bbox) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'lat/lon or s,w,n,e required' }));
            return;
          }
          const query = buildOverpassQueryFromBBox(bbox);

          let payload: string | null = null;
          for (const mirror of OVERPASS_MIRRORS) {
            try {
              const ctrl = new AbortController();
              const timer = setTimeout(() => ctrl.abort(), 8000);
              const upstream = await fetch(mirror, {
                method: 'POST',
                body: new URLSearchParams({ data: query }),
                headers: {
                  'User-Agent': 'pillion-dev/1.0',
                },
                signal: ctrl.signal,
              });
              clearTimeout(timer);
              if (upstream.ok) {
                payload = await upstream.text();
                break;
              }
            } catch {
              /* next */
            }
          }

          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          if (!payload) {
            res.statusCode = 502;
            res.end(JSON.stringify({ error: 'overpass_unavailable', elements: [] }));
            return;
          }
          res.statusCode = 200;
          res.end(payload);
        } catch (err) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: String(err) }));
        }
      });
    },
  };
}

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  plugins: [osmDevProxy()],
  server: {
    port: 5173,
    strictPort: true,
    host: true,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
