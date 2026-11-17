import {
  decodeHostBinary,
  encodeHostBinary,
  type CoopEvent,
  type CoopGunInput,
  type CoopHostSnap,
  type CoopMessage,
  type CoopRole,
  type CoopRoomState,
  parseCoopMessage,
  validateIncoming,
} from './coopProtocol';

export interface CoopHandlers {
  onWelcome: (role: CoopRole, code: string, peers: number) => void;
  onPeer: (role: CoopRole, online: boolean, peers: number, name?: string, color?: string) => void;
  onHost: (snap: CoopHostSnap) => void;
  onGun: (gun: CoopGunInput) => void;
  onDrop: (lat: number, lon: number, name: string, biome: string) => void;
  onToast: (text: string) => void;
  onStatus: (text: string) => void;
  onEvent?: (evt: CoopEvent) => void;
  onState?: (state: CoopRoomState) => void;
  onError?: (code: string, text: string) => void;
  onRtt?: (ms: number) => void;
}

/** Thin WebSocket seat for a shared ride. */
export class CoopClient {
  private ws: WebSocket | null = null;
  private code = '';
  private role: CoopRole | null = null;
  private handlers: CoopHandlers;
  private closed = false;
  private retry = 0;
  private hbTimer: number | null = null;
  private lastPeerHb = 0;
  private useBinary = true;
  private connectOpts: { seat?: string; name?: string; color?: string } = {};

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

  get peerAway(): boolean {
    return this.lastPeerHb > 0 && performance.now() / 1000 - this.lastPeerHb > 3;
  }

  async createRoom(): Promise<string> {
    const res = await fetch('/api/coop/new');
    if (!res.ok) throw new Error('could not open a ride');
    const data = (await res.json()) as { code?: string };
    if (!data.code) throw new Error('empty ride code');
    return data.code;
  }

  connect(
    code: string,
    preferred: CoopRole | 'auto' = 'auto',
    opts: { seat?: string; name?: string; color?: string } = {},
  ): void {
    this.closed = false;
    this.code = code.toLowerCase();
    this.connectOpts = opts;
    this.handlers.onStatus('JOINING RIDE…');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const q = new URLSearchParams({
      code: this.code,
      role: preferred,
    });
    if (opts.seat) q.set('seat', opts.seat);
    if (opts.name) q.set('name', opts.name);
    if (opts.color) q.set('color', opts.color);
    const url = `${proto}://${location.host}/api/coop/ws?${q.toString()}`;
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.retry = 0;
      this.handlers.onStatus('RIDE LINK LIVE');
      this.startHeartbeat();
    });
    ws.addEventListener('message', (ev) => {
      if (typeof ev.data !== 'string') {
        if (!validateIncoming(ev.data)) return;
        const snap = decodeHostBinary(ev.data);
        if (snap) {
          this.lastPeerHb = performance.now() / 1000;
          this.handlers.onHost(snap);
        }
        return;
      }
      if (!validateIncoming(ev.data)) return;
      const msg = parseCoopMessage(ev.data);
      if (!msg) return;
      this.dispatch(msg);
    });
    ws.addEventListener('close', (ev) => {
      this.stopHeartbeat();
      this.ws = null;
      if (ev.code === 4000) {
        // reseated — reconnect soon
      }
      if (this.closed) {
        this.handlers.onStatus('RIDE CLOSED');
        return;
      }
      if (ev.code === 1008 || ev.reason === 'ride_full') {
        this.handlers.onError?.('ride_full', 'This ride is full. Ask for a new link.');
        this.handlers.onStatus('RIDE FULL');
        return;
      }
      this.handlers.onStatus('RECONNECTING…');
      const wait = Math.min(4000, 600 + this.retry * 700);
      this.retry++;
      window.setTimeout(() => {
        if (!this.closed) this.connect(this.code, this.role || preferred, this.connectOpts);
      }, wait);
    });
    ws.addEventListener('error', () => {
      this.handlers.onStatus('RIDE LINK ERROR');
    });

    // Catch HTTP 409 before upgrade when fetch-based probe is needed
    void this.probeFull(preferred);
  }

  private async probeFull(preferred: CoopRole | 'auto'): Promise<void> {
    try {
      const res = await fetch(
        `/api/coop/ws?code=${encodeURIComponent(this.code)}&role=${preferred}&probe=1`,
        { method: 'GET' },
      );
      if (res.status === 409) {
        this.handlers.onError?.('ride_full', 'Ask for a new link');
      }
    } catch {
      /* ws path may not support GET probe */
    }
  }

  disconnect(): void {
    this.closed = true;
    this.stopHeartbeat();
    this.ws?.close();
    this.ws = null;
    this.role = null;
  }

  send(msg: CoopMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (msg.t === 'host' && this.useBinary) {
      try {
        this.ws.send(encodeHostBinary(msg));
        return;
      } catch {
        this.useBinary = false;
      }
    }
    this.ws.send(JSON.stringify(msg));
  }

  sendEvent(kind: CoopEvent['kind'], text: string): void {
    this.send({ t: 'evt', kind, text, at: performance.now() / 1000 });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.hbTimer = window.setInterval(() => {
      if (!this.connected) return;
      this.send({ t: 'hb', at: performance.now() / 1000 });
    }, 1000);
  }

  private stopHeartbeat(): void {
    if (this.hbTimer != null) window.clearInterval(this.hbTimer);
    this.hbTimer = null;
  }

  private dispatch(msg: CoopMessage): void {
    switch (msg.t) {
      case 'welcome':
        this.role = msg.role;
        this.code = msg.code || this.code;
        this.handlers.onWelcome(msg.role, this.code, msg.peers);
        break;
      case 'peer':
        this.handlers.onPeer(msg.role, msg.online, msg.peers, msg.name, msg.color);
        break;
      case 'host':
        this.lastPeerHb = performance.now() / 1000;
        this.handlers.onHost(msg);
        break;
      case 'gun':
        this.lastPeerHb = performance.now() / 1000;
        this.handlers.onGun(msg);
        break;
      case 'drop':
        this.handlers.onDrop(msg.lat, msg.lon, msg.name, msg.biome);
        break;
      case 'toast':
        this.handlers.onToast(msg.text);
        break;
      case 'hb':
        this.lastPeerHb = performance.now() / 1000;
        if (msg.echo != null) {
          const rtt = (performance.now() / 1000 - msg.echo) * 1000;
          this.handlers.onRtt?.(rtt);
        }
        break;
      case 'evt':
        this.handlers.onEvent?.(msg);
        break;
      case 'state':
        this.handlers.onState?.(msg);
        break;
      case 'error':
        this.handlers.onError?.(msg.code, msg.text);
        break;
    }
  }
}
