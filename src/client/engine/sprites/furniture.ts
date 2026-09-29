/** Interior furniture sprites. Footprints match the scene data (w×d tiles). */
import type { Facing } from '@shared/world/scene';
import { darken, lighten } from './color';
import { IsoPainter, rng, type Sprite } from './painter';
import { rocketStatueSprite, seatSprite } from './nature';

const WOOD = '#b07a4a';
const COLORS: Record<string, string> = {
  green: '#5f9f6e',
  blue: '#4f7fc4',
  purple: '#8b62c9',
  mustard: '#e0b03f',
  rust: '#c56a3f',
  orange: '#ff8a3d',
  pink: '#e27ca7',
  cyan: '#3ec7e0',
  lime: '#8fd14f',
  gold: '#e8b93f',
  red: '#c6412f',
  wood: WOOD,
  office: '#3a3a46',
  light: '#e9d7b8',
};
const col = (v: string | undefined, fallback: string) => (v && COLORS[v]) || fallback;

export function chairSprite(facing: Facing, variant?: string): Sprite {
  if (variant === 'office') return seatSprite(facing, { color: '#3a3a46', seat: '#5b5fc7' });
  if (variant === 'red') return seatSprite(facing, { color: '#9e3a2e', seat: '#c6412f' });
  return seatSprite(facing, { color: WOOD, seat: lighten(WOOD, 0.1) });
}

export function stoolSprite(): Sprite {
  const P = new IsoPainter(1, 1, 16);
  P.cylinder(0.5, 0.5, 0, 0.05, 9, '#3a3a46');
  P.cylinder(0.5, 0.5, 9, 0.22, 2, '#e0b03f');
  return P.finish();
}

export function couchSprite(w: number, d: number, facing: Facing, variant?: string): Sprite {
  const P = new IsoPainter(w, d, 24);
  const c = col(variant, '#5f9f6e');
  const along = facing === 'ne' || facing === 'sw' ? 'x' : 'y';
  const back = () => {
    if (facing === 'se') P.box(0.05, 0.05, 0, 0.25, d - 0.1, 14, darken(c, 0.05));
    if (facing === 'sw') P.box(0.05, 0.05, 0, w - 0.1, 0.25, 14, darken(c, 0.05));
    if (facing === 'nw') P.box(w - 0.3, 0.05, 0, 0.25, d - 0.1, 14, darken(c, 0.05));
    if (facing === 'ne') P.box(0.05, d - 0.3, 0, w - 0.1, 0.25, 14, darken(c, 0.05));
  };
  if (facing === 'se' || facing === 'sw') back();
  P.box(0.08, 0.08, 0, w - 0.16, d - 0.16, 7, c);
  // cushions seams
  if (along === 'x') P.box(w / 2 - 0.02, 0.1, 7, 0.04, d - 0.2, 0, darken(c, 0.2));
  else P.box(0.1, d / 2 - 0.02, 7, w - 0.2, 0.04, 0, darken(c, 0.2));
  // arms
  if (along === 'x') {
    P.box(0.02, 0.05, 0, 0.2, d - 0.1, 10, darken(c, 0.08));
    P.box(w - 0.22, 0.05, 0, 0.2, d - 0.1, 10, darken(c, 0.08));
  } else {
    P.box(0.05, 0.02, 0, w - 0.1, 0.2, 10, darken(c, 0.08));
    P.box(0.05, d - 0.22, 0, w - 0.1, 0.2, 10, darken(c, 0.08));
  }
  if (facing === 'ne' || facing === 'nw') back();
  return P.finish();
}

export function armchairSprite(facing: Facing, variant?: string): Sprite {
  return couchSprite(1, 1, facing, variant);
}

export function tableRoundSprite(): Sprite {
  const P = new IsoPainter(1, 1, 22);
  P.cylinder(0.5, 0.5, 0, 0.18, 1, '#3a3a46');
  P.cylinder(0.5, 0.5, 1, 0.05, 11, '#3a3a46');
  P.cylinder(0.5, 0.5, 12, 0.42, 2, WOOD, lighten(WOOD, 0.2));
  P.px(0.5, 0.5, 14, -5, -3, 2, 3, '#fffaf0');
  P.px(0.5, 0.5, 14, 3, -2, 2, 3, '#fffaf0');
  P.px(0.5, 0.5, 14, 3, -3, 2, 1, '#6b4428');
  return P.finish();
}

export function tableLowSprite(w: number, d: number): Sprite {
  const P = new IsoPainter(w, d, 12);
  P.box(0.15, 0.15, 0, w - 0.3, d - 0.3, 6, WOOD);
  P.px(w / 2, d / 2, 6, -3, -2, 5, 2, '#e27ca7');
  return P.finish();
}

export function tableLongSprite(w: number, d: number, variant?: string): Sprite {
  const P = new IsoPainter(w, d, 22);
  const top = variant === 'light' ? '#e9d7b8' : '#f1ede6';
  for (const [x, y] of [[0.15, 0.15], [w - 0.25, 0.15], [0.15, d - 0.25], [w - 0.25, d - 0.25]])
    P.box(x, y, 0, 0.1, 0.1, 11, '#3a3a46');
  P.box(0.05, 0.05, 11, w - 0.1, d - 0.1, 2, top);
  const rand = rng(w * 7 + d);
  for (let i = 0; i < w * 2; i++) {
    const x = 0.3 + rand() * (w - 0.8);
    const y = 0.3 + rand() * (d - 0.8);
    if (rand() > 0.5) P.box(x, y, 13, 0.35, 0.25, 1, '#3a3a46', { top: '#9fd0ff' });
    else P.box(x, y, 13, 0.25, 0.3, 0, '#fffaf0');
  }
  return P.finish();
}

export function counterSprite(w: number, d: number): Sprite {
  const P = new IsoPainter(w, d, 34);
  P.box(0.05, 0.1, 0, w - 0.1, d - 0.2, 14, '#8a5a3b');
  P.faceRect('left', d - 0.1, 0.1, 3, w - 0.3, 2, '#6b4428');
  P.box(0, 0.05, 14, w, d - 0.1, 2, '#efe6d6');
  // pastry case
  P.box(0.2, 0.2, 16, 1.4, d - 0.4, 8, '#cfe9f2', { top: '#e9f7fb' });
  const rand = rng(3);
  for (let i = 0; i < 6; i++) P.px(0.4 + i * 0.2, d / 2, 18, 0, -2, 3, 2, rand() > 0.5 ? '#e8b35a' : '#e27ca7');
  // espresso machine
  P.box(2.2, 0.2, 16, 0.9, d - 0.4, 12, '#c9ced6');
  P.px(2.6, d - 0.2, 22, 0, -2, 2, 2, '#e0503f');
  P.box(2.3, d - 0.35, 16, 0.2, 0.1, 3, '#3a3a46');
  // cups and jar
  for (let i = 0; i < 3; i++) P.box(3.5 + i * 0.35, 0.4, 16, 0.2, 0.2, 4, '#fffaf0');
  P.box(w - 1, 0.3, 16, 0.3, 0.3, 6, '#bfe9ff');
  return P.finish();
}

export function receptionSprite(w: number, d: number): Sprite {
  const P = new IsoPainter(w, d, 30);
  P.box(0.05, 0.1, 0, w - 0.1, d - 0.2, 16, '#4a7ea3');
  P.box(0, 0.05, 16, w, d - 0.1, 2, '#efe6d6');
  const [sx, sy] = P.p(w / 2, d - 0.1, 9);
  P.ctx.fillStyle = '#ffd23f';
  P.ctx.fillRect(sx - 1, sy - 4, 3, 9);
  P.ctx.fillRect(sx - 4, sy - 1, 9, 3);
  P.box(w - 0.6, 0.3, 18, 0.25, 0.25, 5, '#c95a3f');
  P.px(w - 0.5, 0.4, 23, -3, -5, 6, 5, '#5f9f4c');
  P.box(0.4, 0.3, 18, 0.2, 0.2, 2, '#e8b93f');
  return P.finish();
}

export function deskSprite(w: number, d: number, variant?: string): Sprite {
  const P = new IsoPainter(w, d, 34);
  const top = variant === 'wood' ? WOOD : variant === 'light' ? '#e9d7b8' : '#f1ede6';
  for (const [x, y] of [[0.1, 0.1], [w - 0.18, 0.1], [0.1, d - 0.18], [w - 0.18, d - 0.18]])
    P.box(x, y, 0, 0.08, 0.08, 12, '#3a3a46');
  P.box(0.02, 0.05, 12, w - 0.04, d - 0.1, 2, top);
  const rand = rng(w * 13 + (variant?.length ?? 0));
  for (let i = 0; i < w; i++) {
    const x = i + 0.2;
    P.box(x + 0.25, 0.25, 14, 0.1, 0.1, 5, '#3a3a46');
    P.box(x, 0.2, 18, 0.6, 0.1, 11, '#2a2f3a');
    const screen = rand() > 0.3 ? '#9fe3e0' : '#ffd9a0';
    P.faceRect('left', 0.3, x + 0.05, 19, 0.5, 9, screen);
    for (let k = 0; k < 3; k++) P.faceRect('left', 0.3, x + 0.1, 21 + k * 2.5, 0.15 + rand() * 0.25, 1, darken(screen, 0.4));
    P.box(x + 0.1, 0.55, 14, 0.4, 0.15, 1, '#e8e2d6');
    if (rand() > 0.5) P.box(x + 0.62, 0.55, 14, 0.12, 0.12, 3, '#e0503f');
  }
  return P.finish();
}

export function bookshelfSprite(variant?: string): Sprite {
  const P = new IsoPainter(1, 1, 44);
  const wood = variant === 'b' ? '#8a5a3b' : '#9c6a42';
  P.box(0.05, 0.05, 0, 0.9, 0.45, 38, wood);
  const rand = rng(variant === 'b' ? 5 : 9);
  const books = ['#e0503f', '#3f8fd8', '#f2c14e', '#7cc576', '#9b6bd6', '#f4efe6', '#2bb3a3'];
  for (let shelf = 0; shelf < 4; shelf++) {
    const z = 3 + shelf * 9;
    P.faceRect('left', 0.5, 0.1, z, 0.8, 7, darken(wood, 0.45));
    let u = 0.12;
    while (u < 0.85) {
      const bw = 0.06 + rand() * 0.05;
      const bh = 4 + Math.round(rand() * 3);
      P.faceRect('left', 0.5, u, z, bw, bh, books[Math.floor(rand() * books.length)]);
      u += bw + 0.01;
    }
    P.faceRect('left', 0.5, 0.05, z - 1, 0.9, 1, lighten(wood, 0.15));
  }
  return P.finish();
}

export function serverRackSprite(): Sprite {
  const P = new IsoPainter(1, 1, 40);
  P.box(0.15, 0.1, 0, 0.7, 0.55, 32, '#2a2f3a');
  const rand = rng(2);
  for (let i = 0; i < 7; i++) {
    P.faceRect('left', 0.65, 0.2, 4 + i * 4, 0.6, 2, '#3a404d');
    P.faceRect('left', 0.65, 0.25 + rand() * 0.4, 4.5 + i * 4, 0.04, 1, rand() > 0.3 ? '#7cf57c' : '#ffb347');
  }
  P.faceRect('left', 0.65, 0.3, 30, 0.35, 1, '#ffd23f');
  return P.finish();
}

export function beanbagSprite(variant?: string): Sprite {
  const P = new IsoPainter(1, 1, 16);
  const c = col(variant, '#ff8a3d');
  const [cx, cy] = P.p(0.5, 0.5, 4);
  const ctx = P.ctx;
  ctx.fillStyle = darken(c, 0.25);
  ctx.beginPath();
  ctx.ellipse(cx + 1, cy + 1, 12, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.ellipse(cx, cy - 1, 11, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = lighten(c, 0.25);
  ctx.beginPath();
  ctx.ellipse(cx - 3, cy - 4, 5, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  return P.finish();
}

export function plantSprite(variant?: string): Sprite {
  const tall = variant === 'b';
  const P = new IsoPainter(1, 1, tall ? 44 : 26);
  P.cylinder(0.5, 0.5, 0, 0.22, 8, '#c9623f', '#8a4a2e');
  const [cx, cy] = P.p(0.5, 0.5, 8);
  const ctx = P.ctx;
  const rand = rng(tall ? 3 : 8);
  const leaves = tall ? 11 : 7;
  for (let i = 0; i < leaves; i++) {
    const a = -Math.PI / 2 + (rand() - 0.5) * 2.4;
    const len = (tall ? 12 : 7) + rand() * (tall ? 16 : 7);
    const lx = cx + Math.cos(a) * len * 0.6;
    const ly = cy + Math.sin(a) * len;
    ctx.fillStyle = i % 2 ? '#4f9a48' : '#6bb356';
    ctx.beginPath();
    ctx.ellipse(lx, ly, tall ? 5 : 4, tall ? 3 : 2.5, a, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3f7d3a';
    ctx.fillRect(Math.round((cx + lx) / 2), Math.round((cy + ly) / 2), 1, 2);
  }
  return P.finish();
}

export function lampSprite(): Sprite {
  const P = new IsoPainter(1, 1, 40);
  P.cylinder(0.5, 0.5, 0, 0.15, 2, '#3a3a46');
  P.box(0.47, 0.47, 2, 0.06, 0.06, 26, '#3a3a46');
  const [cx, cy] = P.p(0.5, 0.5, 28);
  const ctx = P.ctx;
  ctx.fillStyle = '#ffe3a3';
  ctx.beginPath();
  ctx.moveTo(cx - 5, cy - 8);
  ctx.lineTo(cx + 5, cy - 8);
  ctx.lineTo(cx + 8, cy + 1);
  ctx.lineTo(cx - 8, cy + 1);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#f7c86b';
  ctx.fillRect(cx - 8, cy, 16, 1);
  return P.finish();
}

export function trophyCaseSprite(w: number, d: number): Sprite {
  const P = new IsoPainter(w, d, 40);
  P.box(0.05, 0.05, 0, w - 0.1, d - 0.1, 6, '#6b4428');
  P.box(0.08, 0.08, 6, w - 0.16, d - 0.16, 24, '#cfe9f2', { top: '#eaf8fc', right: '#a9d3e3' });
  P.box(0.05, 0.05, 30, w - 0.1, d - 0.1, 3, '#6b4428');
  for (let i = 0; i < d * 2; i++) {
    const y = 0.3 + i * 0.45;
    P.px(w - 0.1, y, 14, -2, -6, 4, 5, '#e8b93f');
    P.px(w - 0.1, y, 14, -1, -1, 2, 3, '#b8892a');
    P.px(w - 0.1, y, 20, -2, -3, 4, 2, '#e8b93f');
  }
  return P.finish();
}

export function timeCapsuleSprite(): Sprite {
  const P = new IsoPainter(1, 1, 22);
  P.box(0.2, 0.2, 0, 0.6, 0.6, 3, '#6b7280');
  P.box(0.15, 0.15, 3, 0.7, 0.7, 11, '#8fa0ad', { top: '#b9c6cf' });
  P.faceRect('left', 0.85, 0.35, 7, 0.3, 3, '#e8b93f');
  P.px(0.5, 0.5, 14, -1, -2, 3, 2, '#e8b93f');
  return P.finish();
}

export function podiumSprite(): Sprite {
  const P = new IsoPainter(1, 1, 26);
  P.box(0.2, 0.25, 6, 0.6, 0.5, 14, '#5e3b5c');
  P.faceRect('left', 0.75, 0.4, 12, 0.2, 5, '#ffd23f');
  P.box(0.15, 0.2, 20, 0.7, 0.6, 2, '#7a4a78');
  P.box(0.48, 0.3, 22, 0.04, 0.04, 5, '#3a3a46');
  return P.finish();
}

export function speakerSprite(): Sprite {
  const P = new IsoPainter(1, 1, 34);
  P.box(0.2, 0.2, 6, 0.6, 0.5, 22, '#2a2f3a');
  const [x1, y1] = P.p(0.5, 0.7, 14);
  const [x2, y2] = P.p(0.5, 0.7, 23);
  const ctx = P.ctx;
  ctx.fillStyle = '#4a5261';
  ctx.beginPath();
  ctx.arc(x1 - 1, y1, 4, 0, Math.PI * 2);
  ctx.arc(x2 - 1, y2, 2.5, 0, Math.PI * 2);
  ctx.fill();
  return P.finish();
}

export function cakeTableSprite(w: number, d: number): Sprite {
  const P = new IsoPainter(w, d, 38);
  P.box(0.05, 0.1, 0, w - 0.1, d - 0.2, 12, '#fff4f8', { left: '#ffd9e8', right: '#f5bcd2' });
  P.faceRect('left', d - 0.1, 0.1, 4, w - 0.2, 2, '#e24c9c');
  P.cylinder(w / 2, d / 2, 12, 0.36, 6, '#f7c6da', '#fff4f8');
  P.cylinder(w / 2, d / 2, 18, 0.26, 5, '#fff4f8', '#ffd9e8');
  for (let i = -2; i <= 2; i++) {
    P.px(w / 2, d / 2, 23, i * 3, -5, 1, 4, i % 2 ? '#3ec7e0' : '#ffd23f');
    P.px(w / 2, d / 2, 23, i * 3, -7, 1, 2, '#ff8a3d');
  }
  P.box(0.3, 0.3, 12, 0.35, 0.28, 0, '#fffaf0');
  return P.finish();
}

export function easelSprite(facing: Facing, variant?: string): Sprite {
  const P = new IsoPainter(1, 1, 36);
  P.box(0.3, 0.45, 0, 0.05, 0.05, 26, '#8a5a3b');
  P.box(0.65, 0.45, 0, 0.05, 0.05, 26, '#8a5a3b');
  P.box(0.48, 0.2, 0, 0.05, 0.05, 24, '#8a5a3b');
  P.box(0.2, 0.5, 10, 0.6, 0.06, 18, '#fffaf0');
  const cols = variant === 'b' ? ['#3ec7e0', '#ffd23f', '#e27ca7'] : ['#e0503f', '#7cc576', '#3f8fd8'];
  cols.forEach((c, i) => P.faceRect('left', 0.56, 0.28 + i * 0.15, 13 + i * 4, 0.2, 5, c));
  void facing;
  return P.finish();
}

export function poolTableSprite(w: number, d: number): Sprite {
  const P = new IsoPainter(w, d, 20);
  for (const [x, y] of [[0.2, 0.2], [w - 0.35, 0.2], [0.2, d - 0.35], [w - 0.35, d - 0.35]])
    P.box(x, y, 0, 0.15, 0.15, 9, '#5a3824');
  P.box(0.05, 0.05, 9, w - 0.1, d - 0.1, 3, '#7a4a2e', { top: '#8a5a3b' });
  P.poly([[0.2, 0.2, 12], [w - 0.2, 0.2, 12], [w - 0.2, d - 0.2, 12], [0.2, d - 0.2, 12]], '#2e8b57');
  const balls = ['#fffaf0', '#e0503f', '#ffd23f', '#3f8fd8', '#2a1f2d', '#ff8a3d'];
  const rand = rng(4);
  balls.forEach((b) => P.px(0.4 + rand() * (w - 0.8), 0.4 + rand() * (d - 0.8), 12, 0, -1, 2, 2, b));
  return P.finish();
}

export function arcadeCabinetSprite(variant?: string): Sprite {
  const P = new IsoPainter(1, 1, 44);
  const c = col(variant, '#e27ca7');
  P.box(0.15, 0.1, 0, 0.7, 0.6, 30, darken(c, 0.1));
  P.box(0.15, 0.1, 30, 0.7, 0.3, 7, c);
  P.faceRect('left', 0.4, 0.2, 31, 0.6, 5, '#fff4c9');
  P.faceRect('left', 0.7, 0.22, 16, 0.56, 12, '#1a1330');
  P.faceRect('left', 0.7, 0.26, 17, 0.48, 10, variant === 'gold' ? '#ffd23f' : '#5ff3ff');
  P.faceRect('left', 0.7, 0.3, 19, 0.12, 2, '#ff5fd1');
  P.box(0.15, 0.7, 12, 0.7, 0.18, 3, '#2a2f3a');
  P.px(0.4, 0.8, 15, 0, -2, 1, 2, '#e0503f');
  P.px(0.6, 0.8, 15, 0, -1, 2, 1, '#ffd23f');
  return P.finish();
}

export function fireplaceSprite(): Sprite {
  const P = new IsoPainter(1, 1, 36);
  P.box(0.05, 0.05, 0, 0.9, 0.5, 26, '#9a8f84');
  P.box(0, 0, 26, 1, 0.6, 3, '#6b4428');
  P.faceRect('left', 0.55, 0.22, 2, 0.56, 13, '#2a1f2d');
  return P.finish();
}

export function rugTexture(variant: string): { base: string; border: string; accent: string } {
  switch (variant) {
    case 'terracotta':
      return { base: '#d9825b', border: '#b5603d', accent: '#f2c14e' };
    case 'logo':
      return { base: '#35587a', border: '#264460', accent: '#ffd23f' };
    case 'teal':
      return { base: '#3aa39a', border: '#2c7f78', accent: '#bdeee8' };
    case 'cream':
      return { base: '#eadfc9', border: '#c9b79a', accent: '#8a5a3b' };
    case 'mustard':
      return { base: '#e5b64a', border: '#c4952c', accent: '#fff4c9' };
    case 'navy':
      return { base: '#2f4a6b', border: '#1f3350', accent: '#d9a441' };
    case 'oxblood':
      return { base: '#7a2436', border: '#561828', accent: '#f2c14e' };
    case 'mission':
      return { base: '#26324f', border: '#1a2338', accent: '#ff8a3d' };
    case 'plum':
      return { base: '#6b3a5e', border: '#4e2745', accent: '#f2c14e' };
    case 'rose':
      return { base: '#d98a8f', border: '#b8636b', accent: '#fff1dc' };
    case 'neon':
      return { base: '#2a1f4a', border: '#1a1233', accent: '#ff5fd1' };
    case 'cyan':
      return { base: '#1f3f5c', border: '#152b40', accent: '#4fe3f0' };
    case 'sage':
      return { base: '#8fae8a', border: '#6d8d68', accent: '#f4efe0' };
    default:
      return { base: '#c96f5a', border: '#a8543f', accent: '#fff4c9' };
  }
}

export function rocketModelSprite(): Sprite {
  return rocketStatueSprite(0.75);
}
