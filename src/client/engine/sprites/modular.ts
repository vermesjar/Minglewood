/**
 * Modular, tiling furniture drawn in code at 2× density: pieces that must line up pixel-perfectly in a run
 * (counters today; shelving and bars next). Generated art is used for standalone objects; these are the
 * architecture they stand on. Every piece has all four rotations: front and back are drawn, and the other
 * two are their mirrors.
 */
import type { Facing } from '@shared/world/scene';
import { IsoPainter, makeCanvas, rng, type Sprite } from './painter';

interface CounterStyle {
  front: string;
  side: string;
  groove: string;
  lite: string;
  base: string;
  top: string;
  topSide: string;
  vein: string;
  rail: string;
}

const STYLES: Record<string, CounterStyle> = {
  cafe: {
    front: '#b07442',
    side: '#8a5530',
    groove: '#7a4a2e',
    lite: '#d39a60',
    base: '#5a3522',
    top: '#e9e2da',
    topSide: '#cfc5c0',
    vein: '#dcd3d4',
    rail: '#d99a2b',
  },
};

/** One tile of counter, running along x with its front on the +y side (facing sw); other facings mirror. */
function counterFront(style: CounterStyle, back: boolean): Sprite {
  const P = new IsoPainter(1, 1, 30, 3, 0, 2);
  const H = 18;
  const y0 = 0.14;
  const y1 = 0.86;
  const q = 1 / 32; // one sprite pixel along a face, in tiles
  // body
  P.box(0, y0, 0, 1, y1 - y0, H, style.front, { left: style.front, right: style.side, top: style.side });
  // plinth shadow along the floor
  P.faceRect('left', y1, 0, 0, 1, 1.5, style.base);
  P.faceRect('right', 1, y0, 0, y1 - y0, 1.5, style.base);
  if (!back) {
    // tongue-and-groove panelling
    for (let u = 0.06; u < 1; u += 0.2) {
      P.faceRect('left', y1, u, 2, q, H - 4.5, style.groove);
      P.faceRect('left', y1, u + q, 2, q, H - 4.5, style.lite);
    }
    // top trim band under the marble
    P.faceRect('left', y1, 0, H - 2.5, 1, 2.5, style.side);
    P.faceRect('left', y1, 0, H - 1, 1, 0.5, style.lite);
    // brass kick rail with brackets
    P.faceRect('left', y1, 0, 3, 1, 1.5, style.rail);
    P.faceRect('left', y1, 0, 4, 1, 0.5, '#ffe89a');
    P.faceRect('left', y1, 0, 2.5, 1, 0.5, '#a8661a');
    for (const u of [0.2, 0.7]) P.faceRect('left', y1, u, 1.5, q * 3, 2.5, '#a8661a');
  } else {
    // barista side: an open shelf of cups over two drawers
    P.faceRect('left', y1, 0.06, 8, 0.88, 7.5, '#4a2c20');
    P.faceRect('left', y1, 0.06, 10.5, 0.88, 1, style.lite);
    const r = rng(7);
    for (let u = 0.12; u < 0.88; u += 0.13) {
      P.faceRect('left', y1, u, 11.5, 0.07, 2.5, '#fbf7f0');
      P.faceRect('left', y1, u, 11.5, 0.07, 0.5, '#d9d2cc');
      if (r() > 0.5) P.faceRect('left', y1, u, 14, 0.07, 1, '#fbf7f0');
    }
    for (const u of [0.06, 0.52]) {
      P.faceRect('left', y1, u, 2, 0.42, 5, style.groove);
      P.faceRect('left', y1, u + q, 2.5, 0.42 - 2 * q, 4, style.front);
      P.faceRect('left', y1, u + 0.16, 4.5, 0.1, 1, style.rail);
    }
    P.faceRect('left', y1, 0, H - 2.5, 1, 2.5, style.side);
  }
  // the visible end: an inset panel (hidden by the next segment in a run)
  P.faceRect('right', 1, y0 + 0.08, 3, y1 - y0 - 0.16, H - 7, style.groove);
  P.faceRect('right', 1, y0 + 0.08 + q, 3.5, y1 - y0 - 0.16 - 2 * q, H - 8, style.side);
  // marble top, overhanging the front a touch
  P.box(0, y0 - 0.04, H, 1, y1 - y0 + 0.1, 2.5, style.top, { top: style.top, left: style.topSide, right: '#c8bfc6' });
  // one soft, unbroken vein per segment (dotted veins read as stray pixels once things stand on the top)
  const vr = rng(back ? 11 : 5);
  let u = 0.1 + vr() * 0.2;
  let w = y0 + 0.2 + vr() * 0.3;
  while (u < 0.9) {
    P.px(u, w, H + 2.5, 0, 0, 0.5, 0.5, style.vein);
    u += q;
    w += (vr() - 0.5) * q * 1.4;
  }
  // polished front edge
  P.faceRect('left', y1 + 0.06, 0, H + 2, 1, 0.5, '#ffffff');
  return P.finish({ outline: false });
}

function mirror(s: Sprite): Sprite {
  const { width: w, height: h } = s.canvas;
  const canvas = makeCanvas(w, h);
  const c = canvas.getContext('2d')!;
  c.translate(w, 0);
  c.scale(-1, 1);
  c.drawImage(s.canvas, 0, 0);
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mask[y * w + x] = s.mask[y * w + (w - 1 - x)];
  return { canvas, ax: w - s.ax, ay: s.ay, mask, scale: s.scale };
}

/** A counter segment. sw: front toward the room along x; se: along y; ne/nw: the barista side faces us. */
export function counterModule(facing: Facing, variant: string): Sprite | null {
  const style = STYLES[variant];
  if (!style) return null;
  const back = facing === 'ne' || facing === 'nw';
  const base = counterFront(style, back);
  return facing === 'se' || facing === 'nw' ? mirror(base) : base;
}
