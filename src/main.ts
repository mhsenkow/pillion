import './styles/main.css';
import { GameApp } from './game/GameApp';
import { parseCoopQuery } from './net/coopProtocol';
import { installErrorReporting } from './core/errorReporting';

installErrorReporting('tv');
if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
}

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app root missing');

// Phone gunner links should open the light controller, not the full TV diorama.
const coop = parseCoopQuery();
if (coop && !new URLSearchParams(location.search).has('tv')) {
  location.replace(`/gun?coop=${encodeURIComponent(coop)}`);
} else try {
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
