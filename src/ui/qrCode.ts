import QRCode from 'qrcode';

export async function drawQrToCanvas(canvas: HTMLCanvasElement, text: string): Promise<void> {
  await QRCode.toCanvas(canvas, text, {
    width: Math.min(canvas.width || 280, 320),
    margin: 2,
    color: { dark: '#0b0d12', light: '#f8fafc' },
  });
}
