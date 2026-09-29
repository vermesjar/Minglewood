/** Places to sit and things to play with: beach, campfire, commons, and indoor lounge pieces. */
import type { Facing } from '@shared/world/scene';
import { darken, lighten } from './color';
import { IsoPainter, rng, type Sprite } from './painter';

const WOOD = '#b98250';
const DARK_WOOD = '#7a4f2e';
const METAL = '#3a3a46';

/** Which edge of a 1×1 seat the backrest sits on, for a sitter facing `f`. */
function backEdge(f: Facing): 'x0' | 'y0' | 'x1' | 'y1' {
  return f === 'se' ? 'x0' : f === 'sw' ? 'y0' : f === 'nw' ? 'x1' : 'y1';
}

function backrest(P: IsoPainter, f: Facing, z: number, h: number, color: string, t = 0.14) {
  const e = backEdge(f);
  if (e === 'x0') P.box(0.08, 0.1, z, t, 0.8, h, color);
  else if (e === 'x1') P.box(0.92 - t, 0.1, z, t, 0.8, h, color);
  else if (e === 'y0') P.box(0.1, 0.08, z, 0.8, t, h, color);
  else P.box(0.1, 0.92 - t, z, 0.8, t, h, color);
}

/** Draw the back first when it's behind the seat, last when it's in front. */
const backIsFar = (f: Facing) => f === 'se' || f === 'sw';

export function loungerSprite(f: Facing, variant = 'teal'): Sprite {
  const P = new IsoPainter(1, 1, 22);
  const cloth = { teal: '#2bb3a3', coral: '#f07f6a', sun: '#f2c14e', blue: '#5b9bd5' }[variant] ?? '#2bb3a3';
  const frame = '#f4efe6';
  const draw = () => {
    for (const [x, y] of [[0.15, 0.15], [0.8, 0.15], [0.15, 0.8], [0.8, 0.8]]) P.box(x, y, 0, 0.05, 0.05, 4, frame);
    P.box(0.12, 0.12, 4, 0.76, 0.76, 2, cloth, { top: lighten(cloth, 0.1) });
    // stripes
    for (let i = 0; i < 3; i++) P.box(0.2 + i * 0.25, 0.14, 6, 0.08, 0.72, 0.5, '#fffaf0');
  };
  if (backIsFar(f)) backrest(P, f, 5, 9, cloth, 0.12);
  draw();
  if (!backIsFar(f)) backrest(P, f, 5, 9, cloth, 0.12);
  return P.finish();
}

export function beachUmbrellaSprite(variant = 'a'): Sprite {
  const P = new IsoPainter(1, 1, 40);
  P.cylinder(0.5, 0.5, 0, 0.03, 26, '#e8e2d6');
  const [cx, cy] = P.p(0.5, 0.5, 26);
  const [a, b] = variant === 'b' ? ['#f2c14e', '#fffaf0'] : variant === 'c' ? ['#5b9bd5', '#fffaf0'] : ['#e24c9c', '#fffaf0'];
  const c = P.ctx;
  for (let i = 0; i < 10; i++) {
    const a0 = (i / 10) * Math.PI * 2;
    const a1 = ((i + 1) / 10) * Math.PI * 2;
    c.fillStyle = i % 2 ? b : a;
    c.beginPath();
    c.moveTo(cx, cy - 7);
    c.lineTo(cx + Math.cos(a0) * 19, cy + Math.sin(a0) * 9);
    c.lineTo(cx + Math.cos(a1) * 19, cy + Math.sin(a1) * 9);
    c.closePath();
    c.fill();
  }
  return P.finish();
}

export function campfireSprite(): Sprite {
  const P = new IsoPainter(1, 1, 16);
  const rand = rng(21);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const x = 0.5 + Math.cos(a) * 0.36;
    const y = 0.5 + Math.sin(a) * 0.36;
    P.box(x - 0.07, y - 0.07, 0, 0.14, 0.14, 3, rand() > 0.5 ? '#9a948a' : '#b5ab98');
  }
  P.box(0.25, 0.44, 0, 0.5, 0.12, 3, DARK_WOOD);
  P.box(0.44, 0.25, 1, 0.12, 0.5, 3, darken(DARK_WOOD, 0.1));
  P.px(0.5, 0.5, 3, -3, -3, 6, 3, '#ff8a3d');
  P.px(0.5, 0.5, 3, -2, -6, 4, 3, '#ffd23f');
  P.px(0.5, 0.5, 3, -1, -8, 2, 2, '#fff4b0');
  return P.finish();
}

export function logSeatSprite(f: Facing): Sprite {
  const P = new IsoPainter(1, 1, 12);
  const along = f === 'se' || f === 'nw' ? 'y' : 'x';
  if (along === 'x') {
    P.box(0.05, 0.3, 0, 0.9, 0.4, 6, '#8a5a3b', { top: '#c9a078' });
    P.px(0.05, 0.5, 3, -1, -2, 2, 2, '#e3c79c');
  } else {
    P.box(0.3, 0.05, 0, 0.4, 0.9, 6, '#8a5a3b', { top: '#c9a078' });
  }
  return P.finish();
}

export function stumpSprite(): Sprite {
  const P = new IsoPainter(1, 1, 12);
  P.cylinder(0.5, 0.5, 0, 0.26, 6, '#8a5a3b', '#d9b58a');
  P.ellipse(0.5, 0.5, 6, 0.12, '#c49a6c');
  return P.finish();
}

export function iceCreamCartSprite(): Sprite {
  const P = new IsoPainter(1, 1, 44);
  P.box(0.1, 0.2, 5, 0.8, 0.6, 12, '#fffaf0', { right: '#e8dfd0' });
  P.box(0.1, 0.2, 9, 0.8, 0.02, 3, '#ff9ec3');
  P.cylinder(0.25, 0.8, 0, 0.12, 6, METAL);
  P.cylinder(0.75, 0.8, 0, 0.12, 6, METAL);
  P.box(0.15, 0.25, 17, 0.08, 0.08, 16, '#e8e2d6');
  P.box(0.77, 0.25, 17, 0.08, 0.08, 16, '#e8e2d6');
  for (let i = 0; i < 5; i++) P.box(0.05 + i * 0.18, 0.15, 33, 0.18, 0.7, 2, i % 2 ? '#fffaf0' : '#ff9ec3');
  P.px(0.5, 0.5, 18, -5, -3, 3, 3, '#ffe0a8');
  P.px(0.5, 0.5, 18, -1, -4, 3, 3, '#9fe3e0');
  P.px(0.5, 0.5, 18, 3, -3, 3, 3, '#ff9ec3');
  return P.finish();
}

export function telescopeSprite(): Sprite {
  const P = new IsoPainter(1, 1, 30);
  P.box(0.3, 0.45, 0, 0.04, 0.04, 14, '#6b7280');
  P.box(0.62, 0.45, 0, 0.04, 0.04, 14, '#6b7280');
  P.box(0.46, 0.7, 0, 0.04, 0.04, 14, '#6b7280');
  const c = P.ctx;
  const [x0, y0] = P.p(0.3, 0.6, 16);
  const [x1, y1] = P.p(0.8, 0.3, 26);
  c.strokeStyle = '#3e6cb3';
  c.lineWidth = 5;
  c.beginPath();
  c.moveTo(x0, y0);
  c.lineTo(x1, y1);
  c.stroke();
  c.strokeStyle = '#ffd23f';
  c.lineWidth = 5;
  c.beginPath();
  c.moveTo(x1 - 2, y1 + 1);
  c.lineTo(x1, y1);
  c.stroke();
  return P.finish();
}

export function chessTableSprite(): Sprite {
  const P = new IsoPainter(1, 1, 16);
  P.cylinder(0.5, 0.5, 0, 0.12, 8, '#b5ab98');
  P.box(0.1, 0.1, 8, 0.8, 0.8, 2, '#d8d0c0');
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if ((i + j) % 2) P.box(0.18 + i * 0.16, 0.18 + j * 0.16, 10, 0.16, 0.16, 0.2, '#2a1f2d');
  P.px(0.35, 0.35, 10, 0, -3, 1, 3, '#fffaf0');
  P.px(0.65, 0.6, 10, 0, -4, 1, 4, '#2a1f2d');
  return P.finish();
}

/** A hoop on the back edge of its tile, facing +y (into the court). */
export function hoopSprite(): Sprite {
  const P = new IsoPainter(1, 1, 60);
  P.box(0.44, 0.2, 0, 0.12, 0.12, 40, '#4b5563');
  P.box(0.47, 0.3, 36, 0.06, 0.2, 3, '#4b5563');
  // backboard with the classic red square
  P.box(0.1, 0.46, 34, 0.8, 0.06, 20, '#fffaf0');
  P.faceRect('left', 0.52, 0.34, 38, 0.32, 9, '#e0503f');
  P.faceRect('left', 0.52, 0.38, 40, 0.24, 6, '#fffaf0');
  // rim and net
  const c = P.ctx;
  const [rx, ry] = P.p(0.5, 0.74, 37);
  c.strokeStyle = '#ff8a3d';
  c.lineWidth = 2;
  c.beginPath();
  c.ellipse(rx, ry, 7, 3.5, 0, 0, Math.PI * 2);
  c.stroke();
  c.strokeStyle = 'rgba(255,255,255,0.9)';
  c.lineWidth = 1;
  for (let i = -5; i <= 5; i += 2.5) {
    c.beginPath();
    c.moveTo(rx + i, ry + 2);
    c.lineTo(rx + i * 0.5, ry + 9);
    c.stroke();
  }
  return P.finish();
}

export function swingSprite(): Sprite {
  const P = new IsoPainter(1, 1, 38);
  P.box(0.05, 0.1, 0, 0.06, 0.06, 30, '#e0503f');
  P.box(0.05, 0.84, 0, 0.06, 0.06, 30, '#e0503f');
  P.box(0.89, 0.1, 0, 0.06, 0.06, 30, '#e0503f');
  P.box(0.89, 0.84, 0, 0.06, 0.06, 30, '#e0503f');
  P.box(0.05, 0.45, 30, 0.9, 0.1, 2, '#c6412f');
  P.box(0.3, 0.49, 8, 0.02, 0.02, 22, '#8e8a84');
  P.box(0.68, 0.49, 8, 0.02, 0.02, 22, '#8e8a84');
  P.box(0.28, 0.38, 6, 0.44, 0.24, 2, '#2bb3a3');
  return P.finish();
}

export function hammockSprite(): Sprite {
  const P = new IsoPainter(2, 1, 26);
  P.box(0.05, 0.45, 0, 0.1, 0.1, 18, DARK_WOOD);
  P.box(1.85, 0.45, 0, 0.1, 0.1, 18, DARK_WOOD);
  const c = P.ctx;
  const [ax, ay] = P.p(0.1, 0.5, 15);
  const [bx, by] = P.p(1.9, 0.5, 15);
  const [mx, my] = P.p(1, 0.5, 5);
  for (let k = 0; k < 5; k++) {
    c.strokeStyle = k % 2 ? '#f2c14e' : '#e0503f';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(ax, ay + k * 0.6);
    c.quadraticCurveTo(mx, my + k * 1.3, bx, by + k * 0.6);
    c.stroke();
  }
  return P.finish();
}

export function gardenBedSprite(variant = 'a'): Sprite {
  const P = new IsoPainter(2, 1, 22);
  P.box(0.05, 0.1, 0, 1.9, 0.8, 5, '#9c6a42', { top: '#6b4a32' });
  const rand = rng(variant === 'b' ? 8 : 3);
  const crops = variant === 'b' ? ['#e0503f', '#ffd23f'] : ['#ff8a3d', '#9b6bd6'];
  for (let i = 0; i < 7; i++) {
    const x = 0.25 + i * 0.25;
    const y = 0.35 + rand() * 0.3;
    P.px(x, y, 5, -1, -6, 3, 6, '#5e8f3a');
    P.px(x, y, 5, -2, -8, 2, 2, '#7cc576');
    if (rand() > 0.4) P.px(x, y, 5, 0, -4, 2, 2, crops[i % crops.length]);
  }
  return P.finish();
}

export function gazeboSprite(): Sprite {
  const P = new IsoPainter(3, 3, 64);
  P.box(0.1, 0.1, 0, 2.8, 2.8, 4, '#e8dfd0', { top: '#f4efe6' });
  for (const [x, y] of [[0.2, 0.2], [2.65, 0.2], [0.2, 2.65], [2.65, 2.65]]) P.box(x, y, 4, 0.15, 0.15, 30, '#fffaf0');
  // rail on the two visible sides, open at the front corner
  P.box(0.2, 2.72, 12, 1.0, 0.06, 2, '#fffaf0');
  P.box(2.72, 0.2, 12, 0.06, 1.0, 2, '#fffaf0');
  const c = P.ctx;
  const apex = P.p(1.5, 1.5, 58);
  const corners = [P.p(-0.05, -0.05, 34), P.p(3.05, -0.05, 34), P.p(3.05, 3.05, 34), P.p(-0.05, 3.05, 34)];
  const roof = ['#5e8f7a', '#4e7a67', '#6ba38b', '#5a8c77'];
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    c.fillStyle = roof[i];
    c.beginPath();
    c.moveTo(apex[0], apex[1]);
    c.lineTo(a[0], a[1]);
    c.lineTo(b[0], b[1]);
    c.closePath();
    c.fill();
  }
  c.fillStyle = '#ffd23f';
  c.fillRect(apex[0] - 1, apex[1] - 4, 2, 4);
  return P.finish();
}

export function fishingSpotSprite(): Sprite {
  const P = new IsoPainter(1, 1, 30);
  P.box(0.4, 0.4, 0, 0.1, 0.1, 10, DARK_WOOD);
  const c = P.ctx;
  const [x0, y0] = P.p(0.45, 0.45, 10);
  c.strokeStyle = '#8a5a3b';
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(x0, y0);
  c.lineTo(x0 + 12, y0 - 14);
  c.stroke();
  c.strokeStyle = 'rgba(255,255,255,0.8)';
  c.beginPath();
  c.moveTo(x0 + 12, y0 - 14);
  c.lineTo(x0 + 15, y0 + 4);
  c.stroke();
  P.cylinder(0.7, 0.72, 0, 0.12, 5, '#5b9bd5', '#3a6fa3');
  return P.finish();
}

export function stonePileSprite(): Sprite {
  const P = new IsoPainter(1, 1, 8);
  const rand = rng(12);
  for (let i = 0; i < 6; i++) P.ellipse(0.3 + rand() * 0.4, 0.3 + rand() * 0.4, 1 + i * 0.6, 0.1, i % 2 ? '#b5ab98' : '#8e8a84');
  return P.finish();
}

export function blanketSprite(variant = 'red'): Sprite {
  const P = new IsoPainter(1, 1, 6);
  const a = variant === 'blue' ? '#5b9bd5' : variant === 'green' ? '#7cc576' : '#e0503f';
  P.box(0.05, 0.05, 0, 0.9, 0.9, 1, a, { top: a });
  for (let i = 0; i < 3; i++) {
    P.box(0.05 + i * 0.3 + 0.1, 0.05, 1, 0.1, 0.9, 0.2, '#fffaf0');
    P.box(0.05, 0.05 + i * 0.3 + 0.1, 1, 0.9, 0.1, 0.2, '#fffaf0');
  }
  P.px(0.7, 0.3, 1, -2, -3, 4, 3, '#c9a078');
  return P.finish({ outline: false });
}

export function cushionSprite(variant = 'a'): Sprite {
  const P = new IsoPainter(1, 1, 10);
  const col = { a: '#e27c62', b: '#9fe3e0', c: '#f2c14e', d: '#9b6bd6' }[variant] ?? '#e27c62';
  P.cylinder(0.5, 0.5, 0, 0.3, 4, darken(col, 0.1), lighten(col, 0.15));
  P.px(0.5, 0.5, 4, 0, -1, 1, 1, darken(col, 0.3));
  return P.finish();
}

export function pianoSprite(f: Facing): Sprite {
  const P = new IsoPainter(1, 1, 34);
  const body = '#2a1f2d';
  const along = f === 'sw' || f === 'ne' ? 'x' : 'y';
  if (along === 'x') {
    P.box(0.05, 0.1, 0, 0.9, 0.45, 26, body, { top: '#3d3242' });
    P.box(0.05, 0.55, 12, 0.9, 0.25, 3, body, { top: '#fffaf0' });
    for (let i = 0; i < 6; i++) P.box(0.12 + i * 0.14, 0.56, 15, 0.06, 0.1, 0.5, '#2a1f2d');
  } else {
    P.box(0.1, 0.05, 0, 0.45, 0.9, 26, body, { top: '#3d3242' });
    P.box(0.55, 0.05, 12, 0.25, 0.9, 3, body, { top: '#fffaf0' });
    for (let i = 0; i < 6; i++) P.box(0.56, 0.12 + i * 0.14, 15, 0.1, 0.06, 0.5, '#2a1f2d');
  }
  P.px(0.5, 0.3, 26, -3, -4, 2, 4, '#fff4b0');
  return P.finish();
}

export function boardGamesSprite(): Sprite {
  const P = new IsoPainter(1, 1, 40);
  P.box(0.1, 0.2, 0, 0.8, 0.6, 32, WOOD, { top: lighten(WOOD, 0.1) });
  const cols = ['#e0503f', '#3ec7e0', '#ffd23f', '#7cc576', '#9b6bd6', '#ff8a3d'];
  for (let shelf = 0; shelf < 3; shelf++) {
    for (let i = 0; i < 4; i++) P.faceRect('left', 0.8, 0.14 + i * 0.18, 3 + shelf * 10, 0.15, 7 - (i % 2), cols[(shelf * 4 + i) % cols.length]);
  }
  return P.finish();
}

export function pingPongSprite(w: number, d: number): Sprite {
  const P = new IsoPainter(w, d, 20);
  for (const [x, y] of [[0.2, 0.2], [w - 0.3, 0.2], [0.2, d - 0.3], [w - 0.3, d - 0.3]]) P.box(x, y, 0, 0.08, 0.08, 9, METAL);
  P.box(0.1, 0.1, 9, w - 0.2, d - 0.2, 2, '#2f7d5b', { top: '#3a9a70' });
  P.box(w / 2 - 0.02, 0.1, 11, 0.04, d - 0.2, 0.3, '#fffaf0');
  P.box(w / 2 - 0.03, 0.05, 11, 0.06, d - 0.1, 3, 'rgba(255,255,255,0.7)');
  P.px(w / 2 + 0.4, d / 2, 11, 0, -3, 2, 2, '#ff8a3d');
  return P.finish();
}
