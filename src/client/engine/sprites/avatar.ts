/**
 * Composable pixel avatars. Each slot (hair, top, bottom, shoes, accessory) is a layer function,
 * so new catalog items are a few lines of pixels — or a drop-in sprite sheet later.
 *
 * Canvas: 26×44. Drawn facing screen-right (3/4 front = "se", 3/4 back = "ne"); the engine
 * mirrors for "sw"/"nw". Feet anchor at (13, 40).
 */
import type { AvatarLoadout } from '@shared/domain/types';
import type { Facing } from '@shared/world/scene';
import { darken, lighten, mix, INK } from './color';
import { finishSprite, makeCanvas, type Sprite } from './painter';

export type Pose = 'stand' | 'walk1' | 'walk2' | 'sit' | 'wave';
type View = 'front' | 'back';

const W = 26;
const H = 44;
const T = 4; // top padding for hats
export const AVATAR_ANCHOR = { x: 13, y: 40 };

type Px = (x: number, y: number, w: number, h: number, c: string) => void;

const LONG_SLEEVES = new Set(['top.hoodie', 'top.shirt', 'top.sweater', 'top.blazer', 'top.northstar-hoodie']);

function drawHairBack(px: Px, L: AvatarLoadout, view: View, dy: number) {
  const h = L.hairColor;
  const hs = darken(h, 0.2);
  if (view === 'front') {
    if (L.hair === 'hair.long') {
      px(7, 9 + dy, 4, 12, hs);
      px(18, 9 + dy, 1, 10, h);
    }
    if (L.hair === 'hair.ponytail') {
      px(5, 8 + dy, 3, 9, hs);
      px(6, 17 + dy, 2, 2, hs);
    }
  }
}

function drawHead(px: Px, L: AvatarLoadout, view: View, dy: number) {
  const s = L.skin;
  const ss = darken(s, 0.14);
  px(9, 6 + dy, 8, 1, s);
  px(8, 7 + dy, 10, 8, s);
  px(9, 15 + dy, 8, 1, ss);
  px(12, 16 + dy, 2, 1, ss); // neck
  if (view === 'front') {
    px(8, 7 + dy, 1, 8, ss);
    px(10, 10 + dy, 1, 2, ss); // ear
    px(13, 10 + dy, 1, 2, INK);
    px(16, 10 + dy, 1, 2, INK);
    px(14, 13 + dy, 2, 1, mix(s, '#8a3b3b', 0.45));
    px(12, 12 + dy, 1, 1, mix(s, '#ff7a7a', 0.35));
    px(17, 12 + dy, 1, 1, mix(s, '#ff7a7a', 0.35));
  } else {
    px(17, 7 + dy, 1, 8, ss);
    px(9, 10 + dy, 1, 2, ss);
  }
}

function drawHair(px: Px, L: AvatarLoadout, view: View, dy: number) {
  const h = L.hairColor;
  const hs = darken(h, 0.2);
  const hl = lighten(h, 0.22);
  const y = (r: number) => r + dy;
  const cap = (top: number) => {
    if (top <= 4) px(10, y(4), 6, 1, h);
    if (top <= 5) px(9, y(5), 8, 1, h);
    px(8, y(6), 10, 3, h);
    px(10, y(5), 3, 1, hl);
  };
  if (L.hair === 'hair.none') {
    px(11, y(7), 2, 1, lighten(L.skin, 0.3));
    return;
  }
  if (view === 'back') {
    switch (L.hair) {
      case 'hair.buzz':
        px(8, y(6), 10, 5, mix(h, L.skin, 0.4));
        return;
      case 'hair.bob':
        cap(4);
        px(7, y(6), 12, 10, h);
        px(7, y(14), 12, 2, hs);
        return;
      case 'hair.long':
        cap(4);
        px(7, y(6), 12, 16, h);
        px(7, y(19), 12, 3, hs);
        return;
      case 'hair.ponytail':
        cap(4);
        px(8, y(6), 10, 6, h);
        px(11, y(12), 4, 7, hs);
        px(12, y(19), 2, 1, hs);
        return;
      case 'hair.curly':
        px(9, y(3), 2, 1, h);
        px(12, y(3), 2, 1, h);
        px(15, y(3), 2, 1, h);
        px(7, y(4), 12, 11, h);
        px(6, y(8), 1, 2, h);
        px(19, y(8), 1, 2, h);
        px(8, y(5), 2, 1, hl);
        return;
      case 'hair.bun':
        px(11, y(1), 4, 4, h);
        cap(5);
        px(8, y(6), 10, 6, h);
        return;
      default:
        cap(4);
        px(8, y(6), 10, 6, h);
        px(8, y(11), 10, 1, hs);
        return;
    }
  }
  switch (L.hair) {
    case 'hair.short':
      cap(4);
      px(8, y(9), 2, 4, h);
      px(11, y(9), 4, 1, h);
      px(17, y(9), 1, 2, hs);
      break;
    case 'hair.crop':
      cap(5);
      px(8, y(9), 2, 3, h);
      px(17, y(9), 1, 1, hs);
      break;
    case 'hair.buzz':
      px(8, y(6), 10, 2, mix(h, L.skin, 0.45));
      px(8, y(8), 1, 4, mix(h, L.skin, 0.45));
      break;
    case 'hair.bob':
    case 'hair.long':
      cap(4);
      px(7, y(6), 12, 3, h);
      px(7, y(9), 4, 7, h);
      px(17, y(9), 2, 6, h);
      px(11, y(9), 6, 1, h);
      px(16, y(10), 1, 1, h);
      px(7, y(13), 3, 3, hs);
      break;
    case 'hair.ponytail':
      cap(4);
      px(8, y(9), 2, 3, h);
      px(11, y(9), 5, 1, h);
      px(7, y(8), 1, 1, '#e0503f');
      break;
    case 'hair.curly':
      px(9, y(3), 2, 1, h);
      px(12, y(3), 2, 1, h);
      px(15, y(3), 2, 1, h);
      px(8, y(4), 10, 1, h);
      px(7, y(5), 12, 4, h);
      px(7, y(9), 4, 6, h);
      px(6, y(10), 1, 1, h);
      px(6, y(12), 1, 1, h);
      px(11, y(9), 1, 1, h);
      px(13, y(9), 1, 1, h);
      px(15, y(9), 1, 1, h);
      px(17, y(9), 2, 1, h);
      px(9, y(5), 2, 1, hl);
      px(14, y(4), 2, 1, hl);
      break;
    case 'hair.bun':
      px(12, y(1), 2, 1, h);
      px(11, y(2), 4, 2, h);
      px(12, y(4), 2, 1, hs);
      cap(5);
      px(8, y(9), 2, 3, h);
      px(11, y(9), 3, 1, h);
      break;
    case 'hair.swoop':
      cap(4);
      px(12, y(7), 7, 2, h);
      px(15, y(9), 3, 1, h);
      px(8, y(9), 2, 4, h);
      px(13, y(6), 4, 1, hl);
      break;
  }
}

function drawBottom(px: Px, L: AvatarLoadout, pose: Pose, view: View) {
  const c = L.bottomColor;
  const cs = darken(c, 0.2);
  const s = L.skin;
  const sh = L.shoesColor;
  const shs = darken(sh, 0.25);
  const sole = L.shoes === 'shoes.sneakers' ? '#f4efe6' : darken(sh, 0.35);
  const bare = L.bottom === 'bottom.shorts' || L.bottom === 'bottom.skirt';

  if (pose === 'sit') {
    // thighs forward, shins down
    const fx = view === 'front' ? 0 : -2;
    px(11 + fx, 29, 7, 3, c);
    px(11 + fx, 31, 7, 1, cs);
    const shin = bare ? s : c;
    px(16 + fx, 32, 2, 3, shin);
    px(16 + fx, 35, 3, 2, sh);
    px(16 + fx, 36, 3, 1, sole);
    if (L.bottom === 'bottom.skirt') px(10 + fx, 28, 8, 2, c);
    return;
  }

  // Leg geometry per frame: [x, lift]
  const legs: Array<[number, number]> =
    pose === 'walk1' ? [[9, 0], [14, 1]] : pose === 'walk2' ? [[11, 1], [12, 0]] : [[10, 0], [13, 0]];
  const [front, back] = view === 'front' ? [legs[1], legs[0]] : [legs[0], legs[1]];
  for (const [lx, lift] of [back, front]) {
    const bottomY = 33 - lift;
    const isBack = lx === back[0];
    if (L.bottom === 'bottom.skirt') {
      px(lx + 1, 30, 2, bottomY - 29, s);
    } else if (L.bottom === 'bottom.shorts') {
      px(lx, 25, 3, 4, isBack ? cs : c);
      px(lx + 1, 29, 2, bottomY - 28, s);
    } else {
      px(lx, 25, 3, bottomY - 24, isBack ? cs : c);
      px(lx + 2, 26, 1, bottomY - 25, cs);
    }
    // shoes
    const toe = view === 'front' ? 1 : 0;
    const sy = bottomY + 1;
    if (L.shoes === 'shoes.boots') {
      px(lx, sy - 2, 3, 3, isBack ? shs : sh);
      px(lx, sy, 3 + toe, 1, isBack ? shs : sh);
      px(lx, sy + 1, 3 + toe, 1, sole);
    } else {
      px(lx, sy, 3 + toe, 1, isBack ? shs : sh);
      px(lx, sy + 1, 3 + toe, 1, sole);
    }
  }
  if (L.bottom === 'bottom.skirt') {
    px(10, 25, 6, 1, c);
    px(9, 26, 8, 4, c);
    px(9, 29, 8, 1, cs);
  } else {
    px(10, 25, 6, 1, cs); // waistband
  }
  void bare;
}

function drawTop(px: Px, L: AvatarLoadout, pose: Pose, view: View, dy: number) {
  const top = L.top;
  const white = '#f4efe6';
  const c = top === 'top.aurora-tee' ? '#1f2a44' : top === 'top.overalls' ? white : L.topColor;
  const cs = darken(c, 0.2);
  const cl = lighten(c, 0.3);
  const s = L.skin;
  const y = (r: number) => r + dy;
  const long = LONG_SLEEVES.has(top);

  // arms (back arm first)
  const backArmX = view === 'front' ? 8 : 17;
  const frontArmX = view === 'front' ? 17 : 8;
  const swing = pose === 'walk1' ? 1 : pose === 'walk2' ? -1 : 0;
  const arm = (x: number, shade: boolean, off: number) => {
    const sleeve = shade ? cs : c;
    if (long) {
      px(x, y(17 + off), 1, 6, sleeve);
      px(x, y(23 + off), 1, 1, darken(s, shade ? 0.1 : 0));
    } else {
      px(x, y(17 + off), 1, 3, sleeve);
      px(x, y(20 + off), 1, 4, darken(s, shade ? 0.1 : 0));
    }
  };
  arm(backArmX, true, pose === 'sit' ? 0 : -swing > 0 ? 1 : 0);

  // torso
  px(9, y(17), 8, 8, c);
  px(view === 'front' ? 16 : 9, y(18), 1, 7, cs);
  px(9, y(24), 8, 1, cs);

  switch (top) {
    case 'top.tee':
      px(11, y(17), 4, 1, cs);
      break;
    case 'top.hoodie':
    case 'top.northstar-hoodie':
      px(10, y(17), 6, 1, cs);
      if (view === 'front') {
        px(12, y(18), 1, 2, cl);
        px(14, y(18), 1, 2, cl);
        px(11, y(22), 4, 2, cs);
        if (top === 'top.northstar-hoodie') {
          const st = '#ffd23f';
          px(13, y(19), 1, 1, st);
          px(12, y(20), 3, 1, st);
          px(13, y(21), 1, 1, st);
        }
      } else {
        px(10, y(17), 6, 3, cs);
      }
      break;
    case 'top.shirt':
      if (view === 'front') {
        px(11, y(17), 1, 1, cl);
        px(14, y(17), 1, 1, cl);
        for (let r = 18; r < 24; r += 2) px(13, y(r), 1, 1, cs);
      } else px(11, y(17), 4, 1, cl);
      break;
    case 'top.sweater':
      px(9, y(19), 8, 1, cl);
      px(9, y(22), 8, 1, cl);
      break;
    case 'top.overalls': {
      const o = L.topColor;
      px(10, y(19), 6, 6, o);
      px(10, y(17), 1, 2, o);
      px(15, y(17), 1, 2, o);
      if (view === 'front') {
        px(10, y(19), 1, 1, '#f2c14e');
        px(15, y(19), 1, 1, '#f2c14e');
        px(11, y(21), 4, 1, darken(o, 0.15));
      }
      break;
    }
    case 'top.blazer':
      if (view === 'front') {
        px(12, y(17), 2, 5, white);
        px(11, y(18), 1, 2, cs);
        px(14, y(18), 1, 2, cs);
      }
      break;
    case 'top.aurora-tee':
      if (view === 'front') {
        px(13, y(19), 1, 2, white);
        px(12, y(21), 1, 1, '#e0503f');
        px(14, y(21), 1, 1, '#e0503f');
        px(13, y(21), 1, 1, '#ff8a3d');
        px(13, y(22), 1, 1, '#f2c14e');
      }
      break;
  }

  // front arm (or waving arm)
  if (pose === 'wave') {
    const x = view === 'front' ? 18 : 7;
    px(frontArmX, y(17), 1, 1, c);
    px(x, y(13), 1, 4, long ? c : s);
    px(x, y(11), 1, 2, s);
    px(x + (view === 'front' ? 1 : -1), y(11), 1, 1, s);
  } else {
    arm(frontArmX, false, pose === 'sit' ? 0 : swing > 0 ? 1 : 0);
  }
}

function drawAccessory(px: Px, L: AvatarLoadout, view: View, dy: number) {
  const y = (r: number) => r + dy;
  const a = L.accessory;
  const front = view === 'front';
  switch (a) {
    case 'acc.glasses':
      if (!front) {
        px(8, y(10), 1, 1, INK);
        px(17, y(10), 1, 1, INK);
        break;
      }
      px(12, y(10), 6, 1, INK);
      px(12, y(11), 1, 1, INK);
      px(14, y(11), 2, 1, INK);
      px(17, y(11), 1, 1, INK);
      px(10, y(10), 2, 1, INK);
      break;
    case 'acc.sunglasses':
      if (!front) {
        px(8, y(10), 1, 1, INK);
        px(17, y(10), 1, 1, INK);
        break;
      }
      px(12, y(10), 3, 2, INK);
      px(15, y(10), 3, 2, INK);
      px(13, y(10), 1, 1, '#6a6a7a');
      px(10, y(10), 2, 1, INK);
      break;
    case 'acc.headphones':
      px(10, y(4), 6, 1, '#3a3a46');
      px(9, y(5), 1, 2, '#3a3a46');
      px(16, y(5), 1, 2, '#3a3a46');
      if (front) px(9, y(9), 2, 4, '#ff8a3d');
      else px(16, y(9), 2, 4, '#ff8a3d');
      break;
    case 'acc.beanie': {
      const b = '#f2c14e';
      px(12, y(2), 2, 1, lighten(b, 0.4));
      px(9, y(3), 8, 2, b);
      px(8, y(5), 10, 3, b);
      px(8, y(8), 10, 1, darken(b, 0.2));
      break;
    }
    case 'acc.cap': {
      const b = '#3f8fd8';
      px(9, y(4), 8, 1, b);
      px(8, y(5), 10, 3, b);
      if (front) px(14, y(8), 6, 1, darken(b, 0.25));
      else px(8, y(8), 10, 1, darken(b, 0.25));
      px(12, y(4), 2, 1, lighten(b, 0.3));
      break;
    }
    case 'acc.scarf':
      px(9, y(16), 8, 2, '#e0503f');
      px(front ? 11 : 14, y(18), 2, 3, '#c6412f');
      break;
    case 'acc.flower':
      px(front ? 9 : 16, y(6), 2, 2, '#ff8fc1');
      px(front ? 10 : 16, y(6), 1, 1, '#ffd23f');
      break;
    case 'acc.party-hat': {
      const m = '#e24c9c';
      const cy = '#3ec7e0';
      px(12, y(-1), 2, 1, '#ffd23f');
      px(12, y(0), 2, 1, m);
      px(12, y(1), 3, 1, cy);
      px(11, y(2), 4, 1, m);
      px(11, y(3), 5, 1, cy);
      px(10, y(4), 6, 1, m);
      break;
    }
    case 'acc.five-year-pin':
      if (front) {
        const g = '#ffd23f';
        px(11, y(19), 1, 1, g);
        px(10, y(20), 3, 1, g);
        px(11, y(21), 1, 1, g);
      }
      break;
  }
}

export function drawAvatarCanvas(L: AvatarLoadout, facing: Facing, pose: Pose): HTMLCanvasElement {
  const view: View = facing === 'se' || facing === 'sw' ? 'front' : 'back';
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d')!;
  const px: Px = (x, y, w, h, color) => {
    if (w <= 0 || h <= 0) return;
    ctx.fillStyle = color;
    ctx.fillRect(x, y + T, w, h);
  };
  const dy = pose === 'sit' ? 4 : pose === 'walk1' || pose === 'walk2' ? -1 : 0;
  if (view === 'front') drawHairBack(px, L, view, dy);
  drawBottom(px, L, pose, view);
  drawTop(px, L, pose, view, dy);
  drawHead(px, L, view, dy);
  drawHair(px, L, view, dy);
  drawAccessory(px, L, view, dy);

  if (facing === 'sw' || facing === 'nw') {
    const m = makeCanvas(W, H);
    const mctx = m.getContext('2d')!;
    mctx.translate(W, 0);
    mctx.scale(-1, 1);
    mctx.drawImage(c, 0, 0);
    return m;
  }
  return c;
}

const cache = new Map<string, Sprite>();

export function avatarKey(L: AvatarLoadout): string {
  return [L.skin, L.hair, L.hairColor, L.top, L.topColor, L.bottom, L.bottomColor, L.shoes, L.shoesColor, L.accessory].join('|');
}

export function avatarSprite(L: AvatarLoadout, facing: Facing, pose: Pose): Sprite {
  const key = `${avatarKey(L)}|${facing}|${pose}`;
  let s = cache.get(key);
  if (!s) {
    const canvas = drawAvatarCanvas(L, facing, pose);
    // The mirrored anchor is W - 13 = 13 for W=26, so the anchor is symmetric.
    s = finishSprite(canvas, AVATAR_ANCHOR.x, AVATAR_ANCHOR.y + T - 4);
    cache.set(key, s);
    if (cache.size > 2000) cache.clear();
  }
  return s;
}
