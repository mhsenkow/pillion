/**
 * Co-op smoke: boot Emmett TV seat, open a ride, join gun pad, fire once.
 * Requires: npm i -D playwright && npx playwright install chromium
 * Run: node scripts/playwright-coop.mjs
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 5173;
const BASE = `http://127.0.0.1:${PORT}`;

async function waitReady(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404) return;
    } catch {
      /* retry */
    }
    await sleep(500);
  }
  throw new Error('dev server did not start');
}

const vite = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT)], {
  stdio: 'pipe',
  shell: true,
});

try {
  await waitReady(BASE);
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const tv = await browser.newPage();
  await tv.goto(`${BASE}/?tv=1`, { waitUntil: 'networkidle', timeout: 60000 });
  await tv.waitForSelector('#btn-share-ride', { timeout: 30000 });
  await tv.click('#btn-share-ride');
  await sleep(800);
  const status = await tv.locator('#coop-status').innerText();
  const codeMatch = status.match(/([A-Z0-9]{4})/i);
  if (!codeMatch) throw new Error(`no room code in status: ${status}`);
  const code = codeMatch[1].toLowerCase();
  const phone = await browser.newPage();
  await phone.goto(`${BASE}/gun?coop=${code}`, { waitUntil: 'networkidle', timeout: 60000 });
  await phone.waitForSelector('#btn-fire', { timeout: 20000 });
  const go = phone.locator('#gun-tutorial-go');
  if (await go.count()) await go.click();
  await phone.locator('#btn-fire').dispatchEvent('pointerdown');
  await sleep(400);
  await phone.locator('#btn-fire').dispatchEvent('pointerup');
  await sleep(600);
  console.log('playwright-coop OK', code);
  await browser.close();
  process.exitCode = 0;
} catch (err) {
  console.error('playwright-coop FAILED', err);
  process.exitCode = 1;
} finally {
  vite.kill('SIGTERM');
}
