/**
 * Two headless WebSocket clients join one local room and exchange 100 messages.
 * Start `npm run dev` first, or this script will spawn Vite briefly.
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import WebSocket from 'ws';

const BASE = 'http://127.0.0.1:5173';
let vite = null;

async function ensureServer() {
  try {
    const res = await fetch(`${BASE}/api/coop/new`);
    if (res.ok) return;
  } catch {
    /* start */
  }
  vite = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', '5173'], { shell: true, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) {
    await sleep(400);
    try {
      const res = await fetch(`${BASE}/api/coop/new`);
      if (res.ok) return;
    } catch {
      /* retry */
    }
  }
  throw new Error('vite not ready');
}

function open(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

await ensureServer();
const { code } = await (await fetch(`${BASE}/api/coop/new`)).json();
const driver = await open(`ws://127.0.0.1:5173/api/coop/ws?code=${code}&role=driver`);
const gunner = await open(`ws://127.0.0.1:5173/api/coop/ws?code=${code}&role=gunner&seat=test&name=Mom&color=%2338bdf8`);

let got = 0;
gunner.on('message', () => {
  got++;
});

await sleep(200);
for (let i = 0; i < 100; i++) {
  driver.send(JSON.stringify({ t: 'toast', text: `m${i}` }));
}
await sleep(800);
driver.close();
gunner.close();
if (vite) vite.kill('SIGTERM');

if (got < 100) {
  console.error(`coop-exchange FAILED: got ${got}/100`);
  process.exit(1);
}
console.log(`coop-exchange OK: ${got}/100`);
