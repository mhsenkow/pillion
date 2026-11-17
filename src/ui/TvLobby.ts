import { drawQrToCanvas } from './qrCode';
import { coopShareUrl } from '../net/coopProtocol';

/** Big QR + room code card for the TV while waiting for a phone gunner. */
export class TvLobby {
  private root: HTMLElement;
  private codeEl: HTMLElement;
  private canvas: HTMLCanvasElement;
  private joinEl: HTMLElement;
  private visible = false;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'tv-lobby';
    this.root.className = 'tv-lobby hidden';
    this.root.innerHTML = `
      <div class="tv-lobby-card">
        <div class="tv-lobby-kicker mono">COUCH RIDE</div>
        <h2>Scan to be the gunner</h2>
        <p class="tv-lobby-sub">Cast this screen. Someone opens the link on their phone.</p>
        <canvas id="tv-lobby-qr" width="280" height="280"></canvas>
        <div class="tv-lobby-code mono" id="tv-lobby-code">————</div>
        <p class="tv-lobby-join mono">or type the code at /join</p>
        <div class="tv-lobby-joined mono" id="tv-lobby-joined"></div>
      </div>
    `;
    parent.appendChild(this.root);
    this.codeEl = this.root.querySelector('#tv-lobby-code') as HTMLElement;
    this.canvas = this.root.querySelector('#tv-lobby-qr') as HTMLCanvasElement;
    this.joinEl = this.root.querySelector('#tv-lobby-joined') as HTMLElement;
  }

  async show(code: string): Promise<void> {
    this.visible = true;
    this.root.classList.remove('hidden');
    this.codeEl.textContent = code.toUpperCase();
    this.joinEl.textContent = '';
    try {
      await drawQrToCanvas(this.canvas, coopShareUrl(code));
    } catch {
      /* QR optional */
    }
  }

  hide(): void {
    this.visible = false;
    this.root.classList.add('hidden');
  }

  announceJoin(name: string, color: string): void {
    this.joinEl.textContent = `${name.toUpperCase()} JOINED · GUNNER`;
    this.joinEl.style.color = color;
    window.setTimeout(() => this.hide(), 2200);
  }

  get isOpen(): boolean {
    return this.visible;
  }
}
