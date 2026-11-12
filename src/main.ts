import './styles/main.css';
import { GameApp } from './game/GameApp';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app root missing');

try {
  new GameApp(app);
} catch (err) {
  const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
  const pre = document.createElement('pre');
  pre.style.cssText =
    'position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;margin:0;padding:12px;max-height:40vh;overflow:auto;background:#111827;color:#fca5a5;font:12px/1.45 ui-monospace,monospace;white-space:pre-wrap';
  pre.textContent = `PILLION failed to boot\n\n${msg}`;
  document.body.appendChild(pre);
  console.error(err);
}
