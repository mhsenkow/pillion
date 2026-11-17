/** Lightweight error reporting to Workers Analytics (best-effort POST). */

export function installErrorReporting(page: 'tv' | 'gun'): void {
  const send = (payload: Record<string, unknown>) => {
    try {
      void fetch('/api/errors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page, at: Date.now(), ...payload }),
        keepalive: true,
      });
    } catch {
      /* ignore */
    }
  };
  window.addEventListener('error', (e) => {
    send({ type: 'error', message: e.message, source: e.filename, line: e.lineno });
  });
  window.addEventListener('unhandledrejection', (e) => {
    send({ type: 'rejection', message: String(e.reason) });
  });
}
