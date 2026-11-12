/**
 * One-minute playtest.
 * Automated: flow field finishes, a map corner stays on the grid, a sample OSM file parses, the dev server answers.
 * Then, in the browser: boot Emmett, drive, fire, cross one edge, drop one other town, reload.
 */
import { createServer } from 'vite';

const checks = [];

function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`${mark}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const vite = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});

try {
  const flow = await vite.ssrLoadModule('/src/simulation/flowField.ts');
  const proj = await vite.ssrLoadModule('/src/geo/projection.ts');
  const osm = await vite.ssrLoadModule('/src/geo/osmParse.ts');
  const constants = await vite.ssrLoadModule('/src/core/constants.ts');

  const width = constants.GRID_W;
  const length = constants.GRID_L;
  const cells = width * length;
  const surface = new Uint8Array(cells);
  surface.fill(constants.TILE.FIELD);
  for (let gz = 0; gz < length; gz++) surface[gz * width + 20] = constants.TILE.BUILDING;
  const distance = new Float32Array(cells);
  const dirX = new Float32Array(cells);
  const dirZ = new Float32Array(cells);
  const started = performance.now();
  flow.computeDijkstraFlowField(surface, distance, dirX, dirZ, 8, 8);
  const ms = performance.now() - started;
  const start = 8 + 8 * width;
  const open = 4 + 40 * width;
  const sealed = 70 + 80 * width;
  check(
    'flow field finishes on 80×160',
    cells === 80 * 160 && distance[start] < 1 && distance[open] < 9999 && distance[sealed] === 9999 && ms < 250,
    `${ms.toFixed(1)}ms, open ${distance[open].toFixed(1)}, sealed ${distance[sealed].toFixed(0)}`,
  );

  const bbox = proj.bboxFromCenter(42.9906, -82.7649);
  const [gx, gz] = proj.latLonToGrid(
    bbox.north - (bbox.north - bbox.south) * 0.02,
    bbox.west + (bbox.east - bbox.west) * 0.02,
    bbox,
  );
  check(
    'northwest corner projects inside the grid',
    gx >= 0 && gx < width && gz >= 0 && gz < length && gz < length * 0.2 && gx < width * 0.2,
    `gx ${gx.toFixed(1)}, gz ${gz.toFixed(1)}`,
  );

  const sample = {
    elements: [
      { type: 'node', id: 1, lat: bbox.curLat, lon: bbox.curLon },
      { type: 'node', id: 2, lat: bbox.curLat + 0.0004, lon: bbox.curLon + 0.0004 },
      { type: 'way', id: 3, nodes: [1, 2], tags: { highway: 'residential', name: 'Main Street' } },
    ],
  };
  const parsed = osm.parseOverpassJson(sample, bbox.curLat, bbox.curLon, bbox);
  check(
    'sample OSM file parses',
    !!parsed && Array.isArray(parsed.roads) && parsed.roads.length === 1 && parsed.roads[0].name === 'Main Street',
    parsed ? `${parsed.roads.length} road` : 'null',
  );
} finally {
  await vite.close();
}

let server = '';
try {
  const res = await fetch('http://127.0.0.1:5173/', { signal: AbortSignal.timeout(4000) });
  server = `${res.status}`;
  check('dev server answers', res.ok, server);
} catch (err) {
  check('dev server answers', false, err instanceof Error ? err.message : String(err));
}

console.log(`
Manual minute, in the already-open Chrome tab at http://127.0.0.1:5173/ :
  1. Boot lands on Emmett. The ground is one sheet. The bike reads large. Panels are hidden. The objective line is readable.
  2. Hold W. The tank does not drain. Space while moving spends fuel.
  3. Click to fire. A kill throws a puff and the word ASH.
  4. Ride off one edge. The next block is already there or arrives without a long hitch.
  5. Drop another town from the nav panel (H opens it). A dense city stays capped. A thin map still has a track or trees.
  6. Press P to pause. Press 0 to clear the run and return to Emmett. Reload the tab.
`);

const failed = checks.filter((row) => !row.ok);
if (failed.length) {
  console.error(`${failed.length} check(s) failed.`);
  process.exit(1);
}
console.log(`${checks.length} automated checks passed.`);
