import {
  type CoopGunInput,
  type CoopHostSnap,
  type CoopMessage,
  type CoopRole,
  parseCoopMessage,
} from './coopProtocol';

export interface CoopHandlers {
  onWelcome: (role: CoopRole, code: string, peers: number) => void;
  onPeer: (role: CoopRole, online: boolean, peers: number) => void;
  onHost: (snap: CoopHostSnap) => void;
  onGun: (gun: CoopGunInput) => void;
  onDrop: (lat: number, lon: number, name: string, biome: string) => void;
  onToast: (text: string) => void;
  onStatus: (text: string) => void;
}

/** Thin WebSocket seat for a shared ride. */
export class CoopClient {
  private ws: WebSocket | null = null;
  private code = '';
  private role: CoopRole | null = null;
  private handlers: CoopHandlers;
  private closed = false;
  private retry = 0;

  constructor(handlers: CoopHandlers) {
    this.handlers = handlers;
  }

  get connected(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  get seat(): CoopRole | null {
    return this.role;
  }

  get roomCode(): string {
    return this.code;
  }

  async createRoom(): Promise<string> {
    const res = await fetch('/api/coop/new');
    if (!res.ok) throw new Error('could not open a ride');
    const data = (await res.json()) as { code?: string };
    if (!data.code) throw new Error('empty ride code');
    return data.code;
  }

  connect(code: string, preferred: CoopRole | 'auto' = 'auto'): void {
    this.closed = false;
    this.code = code.toLowerCase();
    this.handlers.onStatus('JOINING RIDE…');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/api/coop/ws?code=${encodeURIComponent(this.code)}&role=${preferred}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.retry = 0;
      this.handlers.onStatus('RIDE LINK LIVE');
    });
    ws.addEventListener('message', (ev) => {
      if (typeof ev.data !== 'string') return;
      const msg = parseCoopMessage(ev.data);
      if (!msg) return;
      this.dispatch(msg);
    });
    ws.addEventListener('close', () => {
      this.ws = null;
      if (this.closed) {
        this.handlers.onStatus('RIDE CLOSED');
        return;
      }
      this.handlers.onStatus('RECONNECTING…');
      const wait = Math.min(4000, 600 + this.retry * 700);
      this.retry++;
      window.setTimeout(() => {
        if (!this.closed) this.connect(this.code, this.role || preferred);
      }, wait);
    });
    ws.addEventListener('error', () => {
      this.handlers.onStatus('RIDE LINK ERROR');
    });
  }

  disconnect(): void {
    this.closed = true;
    this.ws?.close();
    this.ws = null;
    this.role = null;
  }

  send(msg: CoopMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  private dispatch(msg: CoopMessage): void {
    switch (msg.t) {
      case 'welcome':
        this.role = msg.role;
        this.code = msg.code || this.code;
        this.handlers.onWelcome(msg.role, this.code, msg.peers);
        break;
      case 'peer':
        this.handlers.onPeer(msg.role, msg.online, msg.peers);
        break;
      case 'host':
        this.handlers.onHost(msg);
        break;
      case 'gun':
        this.handlers.onGun(msg);
        break;
      case 'drop':
        this.handlers.onDrop(msg.lat, msg.lon, msg.name, msg.biome);
        break;
      case 'toast':
        this.handlers.onToast(msg.text);
        break;
    }
  }
}
