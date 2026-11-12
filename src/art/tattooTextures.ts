import * as THREE from 'three';
import type { TattooStyle } from '../core/types';

const cache = new Map<string, THREE.CanvasTexture>();

function makeCanvas(size = 64): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  return [canvas, ctx];
}

function toTexture(canvas: HTMLCanvasElement, key: string): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}

export function getTattooTexture(style: TattooStyle, density = 0.85): THREE.CanvasTexture | null {
  if (style === 'none') return null;
  const key = `${style}_${density.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const [canvas, ctx] = makeCanvas(64);
  ctx.fillStyle = '#f5d0b0';
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = `rgba(10, 8, 6, ${0.55 + density * 0.4})`;

  if (style === 'geometric') {
    // Chevron bands + triangles (Partner left sleeve)
    for (let y = 4; y < 60; y += 10) {
      ctx.beginPath();
      ctx.moveTo(8, y);
      ctx.lineTo(32, y + 5);
      ctx.lineTo(56, y);
      ctx.lineTo(56, y + 3);
      ctx.lineTo(32, y + 8);
      ctx.lineTo(8, y + 3);
      ctx.closePath();
      ctx.fill();
    }
    for (let i = 0; i < 8; i++) {
      const x = 12 + (i % 4) * 12;
      const y = 8 + Math.floor(i / 4) * 28;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 8, y + 10);
      ctx.lineTo(x - 8, y + 10);
      ctx.closePath();
      ctx.fill();
    }
    // Dotwork
    for (let i = 0; i < 40 * density; i++) {
      ctx.fillRect(4 + Math.floor(Math.random() * 56), 4 + Math.floor(Math.random() * 56), 2, 2);
    }
  } else if (style === 'tribal') {
    // Polynesian curved bands (Driver shoulder)
    ctx.lineWidth = 4;
    ctx.strokeStyle = ctx.fillStyle as string;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.arc(32, 32, 8 + i * 6, Math.PI * 0.15, Math.PI * 1.1);
      ctx.stroke();
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(32, 32);
      ctx.lineTo(32 + Math.cos(a) * 28, 32 + Math.sin(a) * 28);
      ctx.stroke();
    }
    // Spearheads
    for (let i = 0; i < 4; i++) {
      const y = 10 + i * 14;
      ctx.beginPath();
      ctx.moveTo(48, y);
      ctx.lineTo(60, y + 6);
      ctx.lineTo(48, y + 12);
      ctx.closePath();
      ctx.fill();
    }
  } else if (style === 'biomech') {
    ctx.strokeStyle = `rgba(6, 182, 212, ${0.7 + density * 0.3})`;
    ctx.lineWidth = 2;
    for (let y = 6; y < 60; y += 8) {
      ctx.strokeRect(8, y, 48, 5);
      ctx.fillRect(14, y + 1, 8, 3);
      ctx.fillRect(36, y + 1, 12, 3);
    }
    ctx.fillStyle = 'rgba(168, 85, 247, 0.8)';
    for (let i = 0; i < 12; i++) {
      ctx.fillRect(10 + (i % 6) * 8, 12 + Math.floor(i / 6) * 28, 4, 4);
    }
  }

  return toTexture(canvas, key);
}

export function getHarnessTexture(leatherHex = '#2e1a12'): THREE.CanvasTexture {
  const key = `harness_${leatherHex}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [canvas, ctx] = makeCanvas(64);
  ctx.fillStyle = leatherHex;
  ctx.fillRect(0, 0, 64, 64);
  // Stitching
  ctx.strokeStyle = '#5c4030';
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 2]);
  ctx.strokeRect(4, 4, 56, 56);
  // Buckle
  ctx.fillStyle = '#c0c0c0';
  ctx.fillRect(26, 8, 12, 8);
  ctx.fillStyle = '#8b7355';
  ctx.fillRect(28, 10, 8, 4);
  // Strap highlight
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(0, 20, 64, 6);
  return toTexture(canvas, key);
}

export function disposeTattooCache(): void {
  cache.forEach((t) => t.dispose());
  cache.clear();
}
