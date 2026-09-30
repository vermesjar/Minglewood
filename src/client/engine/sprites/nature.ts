/** Outdoor sprites: trees, shrubs, street furniture, landmarks. */
import { darken, lighten } from './color';
import { IsoPainter, rng, type Sprite } from './painter';

function blob(P: IsoPainter, x: number, y: number, z: number, r: number, color: string, seed: number, speckle = true) {
  const [cx, cy] = P.p(x, y, z);
  const c = P.ctx;
  const circle = (dx: number, dy: number, rr: number, fill: string) => {
    c.fillStyle = fill;
    c.beginPath();
    c.arc(cx + dx, cy + dy, rr, 0, Math.PI * 2);
    c.fill();
  };
  circle(2, 3, r, darken(color, 0.28));
  circle(0, 0, r - 1, color);
  circle(-r * 0.3, -r * 0.35, r * 0.55, lighten(color, 0.18));
  if (speckle) {
    const rand = rng(seed);
    for (let i = 0; i < r * 1.5; i++) {
      const a = rand() * Math.PI * 2;
      const d = rand() * (r - 2);
      c.fillStyle = rand() > 0.5 ? lighten(color, 0.3) : darken(color, 0.2);
      c.fillRect(Math.round(cx + Math.cos(a) * d), Math.round(cy + Math.sin(a) * d * 0.9), 1, 1);
    }
  }
}

export function treeSprite(kind: string, variant: string): Sprite {
  const seed = kind.length * 31 + variant.charCodeAt(0);
  if (kind === 'pine') {
    const P = new IsoPainter(1, 1, 48);
    P.box(0.44, 0.44, 0, 0.14, 0.14, 9, '#7a4f2e');
    const g = variant === 'a' ? '#2f7d5b' : '#3b8a55';
    const [cx, cy] = P.p(0.5, 0.5, 0);
    const layer = (z: number, rw: number, th: number) => {
      const c = P.ctx;
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(cx - rw, cy - z);
      c.lineTo(cx, cy - z - th);
      c.lineTo(cx, cy - z + 3);
      c.closePath();
      c.fill();
      c.fillStyle = darken(g, 0.25);
      c.beginPath();
      c.moveTo(cx + rw, cy - z);
      c.lineTo(cx, cy - z - th);
      c.lineTo(cx, cy - z + 3);
      c.closePath();
      c.fill();
      c.fillStyle = lighten(g, 0.25);
      c.fillRect(cx - rw + 3, cy - z - 2, 2, 1);
      c.fillRect(cx - 3, cy - z - th + 5, 1, 2);
    };
    layer(8, 12, 17);
    layer(17, 10, 15);
    layer(26, 7, 13);
    return P.finish();
  }
  if (kind === 'birch') {
    const P = new IsoPainter(1, 1, 46);
    P.box(0.46, 0.46, 0, 0.1, 0.1, 22, '#f2efe6');
    for (let z = 4; z < 20; z += 5) P.px(0.46, 0.46, z, 0, 0, 2, 1, '#3a3a46');
    const g = variant === 'a' ? '#a6cf5e' : '#c2d86a';
    blob(P, 0.5, 0.5, 26, 8, g, seed);
    blob(P, 0.35, 0.6, 20, 6, darken(g, 0.05), seed + 1);
    return P.finish();
  }
  if (kind === 'oak-big') {
    const P = new IsoPainter(2, 2, 76, 4, 6);
    P.box(0.8, 0.8, 0, 0.4, 0.4, 20, '#6e4526');
    P.box(0.6, 0.9, 0, 0.3, 0.25, 4, '#6e4526');
    const g = '#4f9a48';
    blob(P, 0.7, 1.2, 30, 14, darken(g, 0.05), seed);
    blob(P, 1.4, 0.8, 34, 14, g, seed + 1);
    blob(P, 1, 1, 44, 16, lighten(g, 0.05), seed + 2);
    // anniversary lanterns
    const rand = rng(99);
    for (let i = 0; i < 7; i++) {
      const [x, y] = P.p(1, 1, 30 + rand() * 18);
      P.ctx.fillStyle = '#ffcf5a';
      P.ctx.fillRect(Math.round(x - 14 + rand() * 28), Math.round(y), 2, 3);
    }
    return P.finish();
  }
  // round
  const P = new IsoPainter(1, 1, 40);
  P.box(0.44, 0.44, 0, 0.13, 0.13, 11, '#7a4f2e');
  const g = variant === 'a' ? '#5aa04a' : '#6db55a';
  blob(P, 0.5, 0.5, 21, 11, g, seed);
  if (variant === 'b') {
    const rand = rng(seed + 5);
    const [cx, cy] = P.p(0.5, 0.5, 21);
    for (let i = 0; i < 6; i++) {
      P.ctx.fillStyle = '#ff9eb5';
      P.ctx.fillRect(Math.round(cx - 7 + rand() * 14), Math.round(cy - 7 + rand() * 12), 2, 2);
    }
  }
  return P.finish();
}

export function bushSprite(variant: string): Sprite {
  const P = new IsoPainter(1, 1, 16);
  blob(P, 0.5, 0.5, 5, 7, '#5f9f4c', 3);
  if (variant === 'flower') {
    const rand = rng(7);
    const [cx, cy] = P.p(0.5, 0.5, 5);
    for (let i = 0; i < 6; i++) {
      P.ctx.fillStyle = i % 2 ? '#ffd23f' : '#ff8fc1';
      P.ctx.fillRect(Math.round(cx - 5 + rand() * 10), Math.round(cy - 5 + rand() * 8), 2, 2);
    }
  }
  return P.finish();
}

export function flowerbedSprite(variant: string): Sprite {
  const P = new IsoPainter(1, 1, 10);
  P.box(0.08, 0.08, 0, 0.84, 0.84, 3, '#8b5a36', { top: '#6b4428' });
  const col = variant === 'pink' ? '#ff8fc1' : variant === 'yellow' ? '#ffd23f' : '#7fb2ff';
  const rand = rng(variant.length * 13);
  for (let i = 0; i < 14; i++) {
    const x = 0.18 + rand() * 0.64;
    const y = 0.18 + rand() * 0.64;
    P.px(x, y, 3, 0, -3, 1, 3, '#4f8f3c');
    P.px(x, y, 3, -1, -5, 3, 2, i % 3 ? col : '#fffaf0');
  }
  return P.finish();
}

export function lampPostSprite(): Sprite {
  const P = new IsoPainter(1, 1, 40);
  P.box(0.38, 0.38, 0, 0.24, 0.24, 3, '#3a3a46');
  P.box(0.46, 0.46, 3, 0.08, 0.08, 24, '#3a3a46');
  P.box(0.36, 0.36, 27, 0.28, 0.28, 7, '#ffe7a0', { top: '#fff4c9' });
  P.box(0.32, 0.32, 34, 0.36, 0.36, 2, '#3a3a46');
  return P.finish();
}

export function fountainSprite(): Sprite {
  const P = new IsoPainter(2, 2, 30);
  P.cylinder(1, 1, 0, 0.9, 7, '#cfc6b6', '#e3dccf');
  P.ellipse(1, 1, 7, 0.78, '#6cbde6');
  P.ellipse(1, 1, 7, 0.55, '#8fd3f2');
  P.cylinder(1, 1, 7, 0.14, 12, '#cfc6b6');
  P.cylinder(1, 1, 18, 0.36, 3, '#cfc6b6', '#8fd3f2');
  return P.finish();
}

export function signpostSprite(): Sprite {
  const P = new IsoPainter(1, 1, 30);
  P.box(0.46, 0.46, 0, 0.08, 0.08, 22, '#7a4f2e');
  P.box(0.15, 0.45, 13, 0.7, 0.1, 9, '#e8c690');
  P.faceRect('left', 0.55, 0.22, 16, 0.5, 1, '#8a5a3b');
  P.faceRect('left', 0.55, 0.22, 18, 0.36, 1, '#8a5a3b');
  return P.finish();
}

export function umbrellaTableSprite(variant: string): Sprite {
  const P = new IsoPainter(1, 1, 36);
  P.cylinder(0.5, 0.5, 0, 0.06, 9, '#3a3a46');
  P.cylinder(0.5, 0.5, 9, 0.3, 2, '#f4efe6');
  P.cylinder(0.5, 0.5, 11, 0.03, 16, '#e8e2d6');
  const [cx, cy] = P.p(0.5, 0.5, 27);
  const colA = variant === 'red' ? '#e0503f' : '#2bb3a3';
  const c = P.ctx;
  for (let i = 0; i < 8; i++) {
    const a0 = (i / 8) * Math.PI * 2;
    const a1 = ((i + 1) / 8) * Math.PI * 2;
    c.fillStyle = i % 2 ? '#fff4e0' : colA;
    c.beginPath();
    c.moveTo(cx, cy - 6);
    c.lineTo(cx + Math.cos(a0) * 16, cy + Math.sin(a0) * 8);
    c.lineTo(cx + Math.cos(a1) * 16, cy + Math.sin(a1) * 8);
    c.closePath();
    c.fill();
  }
  return P.finish();
}

export function picnicSprite(): Sprite {
  const P = new IsoPainter(2, 1, 20);
  const wood = '#b98250';
  P.box(0.2, 0.3, 0, 0.08, 0.08, 9, darken(wood, 0.3));
  P.box(1.7, 0.3, 0, 0.08, 0.08, 9, darken(wood, 0.3));
  P.box(0.1, 0.05, 5, 1.8, 0.18, 2, wood);
  P.box(0.1, 0.25, 9, 1.8, 0.5, 2, wood);
  P.box(0.1, 0.8, 5, 1.8, 0.18, 2, wood);
  P.px(0.8, 0.5, 11, 0, -2, 3, 2, '#e0503f');
  P.px(1.2, 0.4, 11, 0, -2, 2, 2, '#ffd23f');
  return P.finish();
}

export function boatSprite(variant: string): Sprite {
  const P = new IsoPainter(1, 1, 14);
  const hull = variant === 'red' ? '#c95a3f' : '#e8b93f';
  P.box(0.05, 0.25, -3, 0.9, 0.5, 5, hull);
  P.box(0.15, 0.32, 1, 0.7, 0.36, 1, '#8a5a3b');
  P.box(0.45, 0.25, 2, 0.1, 0.5, 1, '#6b4428');
  return P.finish();
}

export function smallProp(kind: string): Sprite {
  const P = new IsoPainter(1, 1, 24);
  if (kind === 'mailbox') {
    P.box(0.45, 0.45, 0, 0.1, 0.1, 10, '#3a3a46');
    P.box(0.3, 0.35, 10, 0.4, 0.3, 7, '#3f6fd8');
    P.px(0.7, 0.35, 16, 0, -4, 1, 4, '#e0503f');
  } else if (kind === 'bike-rack') {
    for (let i = 0; i < 3; i++) P.box(0.2 + i * 0.25, 0.45, 0, 0.05, 0.1, 8, '#8e8a84');
    P.box(0.15, 0.45, 8, 0.7, 0.1, 1, '#8e8a84');
    P.box(0.3, 0.2, 0, 0.05, 0.6, 6, '#e0503f');
  } else if (kind === 'reeds') {
    const rand = rng(4);
    for (let i = 0; i < 6; i++) {
      const x = 0.25 + rand() * 0.5;
      const y = 0.25 + rand() * 0.5;
      const h = 6 + Math.round(rand() * 6);
      P.px(x, y, 0, 0, -h, 1, h, '#5e8f3a');
      if (i % 2) P.px(x, y, 0, 0, -h - 2, 1, 3, '#7a4f2e');
    }
    return P.finish({ outline: false });
  }
  return P.finish();
}

export function rocketStatueSprite(scale = 1): Sprite {
  const P = new IsoPainter(1, 1, 52 * scale);
  P.box(0.12, 0.12, 0, 0.76, 0.76, 7 * scale, '#cfc6b6');
  P.box(0.2, 0.2, 7 * scale, 0.6, 0.6, 1, '#b5ab98');
  const z0 = 8 * scale;
  P.box(0.28, 0.4, z0, 0.12, 0.2, 9 * scale, '#e0503f');
  P.box(0.6, 0.4, z0, 0.12, 0.2, 9 * scale, '#c6412f');
  P.cylinder(0.5, 0.5, z0 + 2, 0.18, 26 * scale, '#f4f1ea');
  const [cx, cy] = P.p(0.5, 0.5, z0 + 2 + 26 * scale);
  const c = P.ctx;
  c.fillStyle = '#e0503f';
  c.beginPath();
  c.moveTo(cx - 6 * scale, cy);
  c.lineTo(cx, cy - 12 * scale);
  c.lineTo(cx + 6 * scale, cy);
  c.closePath();
  c.fill();
  const [wx, wy] = P.p(0.5, 0.5, z0 + 16 * scale);
  c.fillStyle = '#3e6cb3';
  c.beginPath();
  c.arc(wx - 1, wy, 2.5 * scale, 0, Math.PI * 2);
  c.fill();
  return P.finish();
}

export function lighthouseSprite(): Sprite {
  const P = new IsoPainter(1, 1, 58);
  P.cylinder(0.5, 0.5, 0, 0.4, 6, '#b5ab98');
  for (let i = 0; i < 4; i++) P.cylinder(0.5, 0.5, 6 + i * 8, 0.3 - i * 0.02, 8, i % 2 ? '#e0503f' : '#f4f1ea');
  P.cylinder(0.5, 0.5, 38, 0.26, 3, '#3a3a46');
  P.cylinder(0.5, 0.5, 41, 0.2, 6, '#ffe38a');
  const [cx, cy] = P.p(0.5, 0.5, 47);
  P.ctx.fillStyle = '#c6412f';
  P.ctx.beginPath();
  P.ctx.moveTo(cx - 7, cy);
  P.ctx.lineTo(cx, cy - 7);
  P.ctx.lineTo(cx + 7, cy);
  P.ctx.closePath();
  P.ctx.fill();
  return P.finish();
}

export function balloonsSprite(variant: string): Sprite {
  const P = new IsoPainter(1, 1, 40);
  const sets: Record<string, string[]> = {
    a: ['#e24c9c', '#3ec7e0', '#ffd23f'],
    b: ['#7cc576', '#ff8a3d', '#9b6bd6'],
    c: ['#ffd23f', '#e0503f', '#3ec7e0'],
  };
  const cols = sets[variant] ?? sets.a;
  const [bx, by] = P.p(0.5, 0.5, 0);
  const c = P.ctx;
  P.box(0.4, 0.4, 0, 0.2, 0.2, 2, '#8e8a84');
  const pos: Array<[number, number]> = [[-6, -30], [4, -34], [0, -24]];
  pos.forEach(([dx, dy], i) => {
    c.strokeStyle = '#8e8a84';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(bx + 0.5, by - 2);
    c.lineTo(bx + dx + 0.5, by + dy + 5);
    c.stroke();
    c.fillStyle = cols[i];
    c.beginPath();
    c.ellipse(bx + dx, by + dy, 5, 6, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = lighten(cols[i], 0.5);
    c.fillRect(bx + dx - 2, by + dy - 3, 2, 2);
  });
  return P.finish();
}
