import type { GameState } from '../core/types';
import { fitRenderer, type RendererBundle } from '../render/DioramaRenderer';

/** DOM wiring for the ride. GameApp keeps the actions; this file owns the listeners. */
export interface RideInput {
  state: GameState;
  bundle: RendererBundle;
  isTyping(): boolean;
  unlock(): void;
  weapon(index: 0 | 1 | 2): void;
  repair(): void;
  overcharge(): void;
  mute(): void;
  creator(): void;
  inspector(): void;
  hideMenus(): void;
  escape(): void;
  pause(): void;
  returnHome(): void;
  pointer(clientX: number, clientY: number): void;
  inspectorOpen(): boolean;
}

export function installRideInput(input: RideInput): void {
  window.addEventListener('pointerdown', () => input.unlock(), { once: true });
  window.addEventListener('keydown', () => input.unlock(), { once: true });

  window.addEventListener('keydown', (e) => {
    if (input.isTyping()) return;
    const k = e.key.toLowerCase();
    if (k === 'w' || e.key === 'ArrowUp') input.state.keys.up = true;
    if (k === 's' || e.key === 'ArrowDown') input.state.keys.down = true;
    if (k === 'a' || e.key === 'ArrowLeft') input.state.keys.left = true;
    if (k === 'd' || e.key === 'ArrowRight') input.state.keys.right = true;
    if (k === ' ') {
      e.preventDefault();
      input.state.keys.space = true;
    }
    if (k === '1' || k === '2' || k === '3') input.weapon((parseInt(k, 10) - 1) as 0 | 1 | 2);
    if (k === 'r') input.repair();
    if (k === 'f') input.overcharge();
    if (k === 'm') input.mute();
    if (k === 'c') input.creator();
    if (k === 'i' || e.key === 'F2') input.inspector();
    if (k === 'h') input.hideMenus();
    if (k === 'p') input.pause();
    if (k === '0') input.returnHome();
    if (k === 'escape') input.escape();
  });

  window.addEventListener('keyup', (e) => {
    if (input.isTyping()) return;
    const k = e.key.toLowerCase();
    if (k === 'w' || e.key === 'ArrowUp') input.state.keys.up = false;
    if (k === 's' || e.key === 'ArrowDown') input.state.keys.down = false;
    if (k === 'a' || e.key === 'ArrowLeft') input.state.keys.left = false;
    if (k === 'd' || e.key === 'ArrowRight') input.state.keys.right = false;
    if (k === ' ') input.state.keys.space = false;
  });

  const dom = input.bundle.renderer.domElement;
  window.addEventListener('mousemove', (e) => input.pointer(e.clientX, e.clientY));
  dom.addEventListener('mousedown', (e) => {
    input.unlock();
    if (e.button === 0) input.state.mouseDown = true;
    if (e.button === 2) {
      input.state.rightMouseDown = true;
      input.state.lastMouseX = e.clientX;
    }
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) input.state.mouseDown = false;
    if (e.button === 2) input.state.rightMouseDown = false;
  });
  window.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('wheel', (e) => {
    if (input.inspectorOpen()) return;
    input.state.cameraZoom = Math.max(28, Math.min(86, input.state.cameraZoom + e.deltaY * 0.03));
  });
  window.addEventListener('resize', () => {
    input.bundle.camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
    input.bundle.camera.updateProjectionMatrix();
    fitRenderer(input.bundle.renderer);
  });

  bindTouchStick(input, 'touch-left', true);
  bindTouchStick(input, 'touch-right', false);
}

function bindTouchStick(input: RideInput, id: string, isMove: boolean): void {
  const el = document.getElementById(id);
  if (!el) return;
  const knob = el.querySelector('.touch-knob') as HTMLElement | null;
  if (!knob) return;
  let active = false;
  const onMove = (e: TouchEvent) => {
    if (!active) return;
    const t = e.touches[0];
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = t.clientX - cx;
    let dy = t.clientY - cy;
    const max = rect.width * 0.35;
    const len = Math.hypot(dx, dy) || 1;
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      if (isMove) {
      input.state.keys.left = dx < -12;
      input.state.keys.right = dx > 12;
      input.state.keys.up = dy < -12;
      input.state.keys.down = dy > 12;
    } else {
      input.state.mouseWorldPos.set(input.state.bike.x + dx * 0.15, 0, input.state.bike.z + dy * 0.15);
      input.state.mouseDown = true;
    }
  };
  el.addEventListener('touchstart', (e) => {
    active = true;
    onMove(e);
  });
  el.addEventListener('touchmove', onMove);
  el.addEventListener('touchend', () => {
    active = false;
    knob.style.transform = 'translate(-50%, -50%)';
    if (isMove) {
      input.state.keys.left = false;
      input.state.keys.right = false;
      input.state.keys.up = false;
      input.state.keys.down = false;
    } else input.state.mouseDown = false;
  });
}
