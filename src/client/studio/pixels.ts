/** Drawing helpers for the Design Lab: views on a checkerboard with their footprint, crisp at any zoom. */
import { footprintFacing } from '@shared/models';
import { centredAnchor } from '../engine/sprites/footing';
import type { Facing, FurnitureSpec } from './api';

const cache = new Map<string, Promise<HTMLImageElement>>();

export function loadImg(url: string): Promise<HTMLImageElement> {
  let p = cache.get(url);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`could not load ${url}`));
      img.src = url;
    });
    cache.set(url, p);
  }
  return p;
}

export const MIRROR: Record<Facing, Facing> = { se: 'sw', sw: 'se', ne: 'nw', nw: 'ne' };
export const FACINGS: Facing[] = ['se', 'sw', 'ne', 'nw'];
/** Turning a piece clockwise, as the R key does. */
export const TURN: Record<Facing, Facing> = { se: 'sw', sw: 'nw', nw: 'ne', ne: 'se' };

/** The drawings a piece needs (art/designlab.py views_of, studio.py lab-generate): a mirror piece's front is se. */
export function drawnViews(f: Pick<FurnitureSpec, 'rotation' | 'sameFromBehind'>): string[] {
  if (f.rotation === 'radial' || f.rotation === 'flat') return ['one'];
  if (f.rotation === 'full') return ['se', 'sw', 'ne', 'nw'];
  return f.sameFromBehind ? ['se'] : ['se', 'nw'];
}

/** The tiles a piece covers facing `facing` (models.ts footprintFacing): [width, depth] facing sw/ne, else turned. */
export function footprintFor(f: Pick<FurnitureSpec, 'footprint' | 'rotation'>, facing: Facing): [number, number] {
  if (f.rotation === 'flat' || f.rotation === 'radial') return [f.footprint[0], f.footprint[1]];
  return footprintFacing(f, facing);
}

/** Which drawing shows a facing, and whether it's mirrored (the client's rule in art.ts). */
export function sourceOf(f: Pick<FurnitureSpec, 'sameFromBehind'>, have: string[], facing: Facing): { view: string; mirrored: boolean } | null {
  if (have.includes('one')) return { view: 'one', mirrored: false };
  if (have.includes(facing)) return { view: facing, mirrored: false };
  if (have.includes(MIRROR[facing])) return { view: MIRROR[facing], mirrored: true };
  // a mirror piece that looks the same from behind: its one front drawing serves every side
  if (f.sameFromBehind && have.includes('se')) return { view: 'se', mirrored: facing === 'sw' || facing === 'nw' };
  return null;
}

export function checker(c: CanvasRenderingContext2D, w: number, h: number, size = 8) {
  c.fillStyle = '#efe4d2';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#e4d7c2';
  for (let y = 0; y < h; y += size) for (let x = (y / size) % 2 ? size : 0; x < w; x += size * 2) c.fillRect(x, y, size, size);
}

/** The anchor the game will use: small pieces are centred on their footprint whatever their anchor says (art.ts). */
export function gameAnchor(img: HTMLImageElement, anchor: [number, number], fp: [number, number], mirrored: boolean): { anchor: [number, number]; centred: boolean } {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d')!;
  if (mirrored) {
    g.translate(img.width, 0);
    g.scale(-1, 1);
  }
  g.drawImage(img, 0, 0);
  const auto = centredAnchor({ w: img.width, h: img.height, d: g.getImageData(0, 0, img.width, img.height).data }, fp[0], fp[1]);
  if (auto) return { anchor: auto, centred: true };
  return { anchor: [mirrored ? img.width - anchor[0] : anchor[0], anchor[1]], centred: false };
}

/**
 * Draw a view with its footprint diamond (cyan) and anchor (the footprint's back corner, already in the
 * drawn — possibly mirrored — image's space), `z` screen px per sprite px. The canvas fits drawing and diamond.
 */
export function drawView(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement | HTMLCanvasElement,
  anchor: [number, number],
  fp: [number, number],
  opts: { mirrored?: boolean; z?: number; maxW?: number; maxH?: number; pad?: number; bare?: boolean } = {},
) {
  const [w, d] = opts.bare ? [0, 0] : fp;
  const [ax, ay] = anchor;
  const left = Math.min(0, ax - 32 * d);
  const right = Math.max(img.width, ax + 32 * w);
  const bottom = Math.max(img.height, ay + 16 * (w + d));
  const top = Math.min(0, ay);
  const pad = opts.pad ?? 8;
  const spanW = right - left + pad * 2;
  const spanH = bottom - top + pad * 2;
  const z = opts.z ?? Math.max(1, Math.floor(Math.min((opts.maxW ?? 360) / spanW, (opts.maxH ?? 300) / spanH)));
  canvas.width = spanW * z;
  canvas.height = spanH * z;
  const c = canvas.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  checker(c, canvas.width, canvas.height, 4 * z);
  const ox = (pad - left) * z;
  const oy = (pad - top) * z;
  const V = (x: number, y: number): [number, number] => [ox + (ax + (x - y) * 32) * z, oy + (ay + (x + y) * 16) * z];
  const diamond = () => {
    c.beginPath();
    const q = [V(0, 0), V(w, 0), V(w, d), V(0, d)];
    c.moveTo(...q[0]);
    for (const p of q.slice(1)) c.lineTo(...p);
    c.closePath();
  };
  if (!opts.bare) {
    c.fillStyle = 'rgba(43, 179, 163, 0.16)';
    diamond();
    c.fill();
  }
  c.save();
  if (opts.mirrored) {
    c.translate(ox + img.width * z, oy);
    c.scale(-1, 1);
    c.drawImage(img, 0, 0, img.width * z, img.height * z);
  } else c.drawImage(img, ox, oy, img.width * z, img.height * z);
  c.restore();
  // wall art hangs on a wall: no floor footprint
  if (opts.bare) return z;
  c.strokeStyle = 'rgba(20, 140, 150, 0.95)';
  c.lineWidth = Math.max(1, z / 2);
  diamond();
  c.stroke();
  // the footprint's centre, where a small piece's base belongs
  const [cx, cy] = V(w / 2, d / 2);
  c.fillStyle = '#148c96';
  c.fillRect(cx - z, cy - z, z * 2, z * 2);
  return z;
}
