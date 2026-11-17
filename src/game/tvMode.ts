import { isTvMode } from '../net/coopProtocol';

/** Apply 10-foot TV mode: larger HUD, safe area, hide cursor after idle. */
export function installTvMode(root: HTMLElement = document.documentElement): boolean {
  if (!isTvMode()) return false;
  document.body.classList.add('tv-mode');
  root.classList.add('tv-mode');
  const safe = document.createElement('div');
  safe.className = 'tv-safe';
  safe.id = 'tv-safe';
  document.body.appendChild(safe);

  let idle = 0;
  const bump = () => {
    idle = 0;
    document.body.classList.remove('tv-cursor-hidden');
  };
  window.addEventListener('mousemove', bump);
  window.addEventListener('mousedown', bump);
  window.setInterval(() => {
    idle += 1;
    if (idle >= 3) document.body.classList.add('tv-cursor-hidden');
  }, 1000);
  return true;
}

export function setCinemaMode(on: boolean): void {
  document.body.classList.toggle('cinema-mode', on);
  document.getElementById('hud-root')?.classList.toggle('cinema-mode', on);
}

export function setPhotoMode(on: boolean): void {
  document.body.classList.toggle('photo-mode', on);
}
