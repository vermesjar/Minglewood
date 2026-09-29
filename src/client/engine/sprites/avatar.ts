/**
 * Composable pixel avatars. Every slot is a layer drawn in a fixed order, so a new catalog item is
 * usually a handful of pixels or a tiny pixel map — or a drop-in sprite sheet later.
 *
 * Coordinates below are "body space": the head spans columns 8–17, rows 6–15; feet rest on row 35.
 * The canvas adds padding (OX, T) for hats, umbrellas, pets and wheelchairs. Drawn facing
 * screen-right (3/4 front = "se", 3/4 back = "ne"); the engine mirrors for "sw"/"nw".
 */
import type { AvatarLoadout } from '@shared/domain/types';
import type { Facing } from '@shared/world/scene';
import { ITEM_BY_ID, normalizeLoadout, type FullLoadout } from '@shared/avatar';
import { darken, lighten, mix, INK } from './color';
import { finishSprite, makeCanvas, type Sprite } from './painter';

export type Pose = 'stand' | 'walk1' | 'walk2' | 'sit' | 'wave';
type View = 'front' | 'back';

const OX = 7; // horizontal padding (left side holds the pet)
const T = 10; // vertical padding (hats, balloons, umbrellas)
const W = 40;
const H = 50;
export const AVATAR_ANCHOR = { x: 20, y: 46 };

/** Crop rectangles (canvas px) for UI previews. */
export const AVATAR_CROPS = {
  head: { x: 12, y: 9, w: 16, h: 16 },
  face: { x: 13, y: 10, w: 14, h: 14 },
  bust: { x: 10, y: 9, w: 20, h: 24 },
  torso: { x: 11, y: 21, w: 18, h: 20 },
  legs: { x: 11, y: 31, w: 18, h: 17 },
  /** The person without the extra padding (pets and umbrellas may be clipped). */
  body: { x: 8, y: 8, w: 24, h: 40 },
  full: { x: 0, y: 0, w: W, h: H },
};

type Px = (x: number, y: number, w: number, h: number, c: string) => void;

const WHITE = '#fffaf0';
const GOLD = '#ffd23f';
const PINK = '#ff8fc1';

/** Draws a small pixel map. '.' is transparent; other chars look up the palette. */
function map(px: Px, x0: number, y0: number, rows: string[], pal: Record<string, string>) {
  rows.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) {
      const c = pal[row[dx]];
      if (c) px(x0 + dx, y0 + dy, 1, 1, c);
    }
  });
}

const tone = (c: string) => ({ c, s: darken(c, 0.22), l: lighten(c, 0.3), k: INK, w: WHITE, y: GOLD, p: PINK });

/* ================================================================== pets & mobility (behind) */

const PETS: Record<string, string[]> = {
  cat: ['......c.c', '......ccc', 'c.....kck', 'c.ccccccp', '.cccccccc', '.c.c..c.c'],
  dog: ['......ss..', '.....cccc.', 'c....ckccn', 'c.ccccccc.', '.ccccccc..', '.c.c..c.c.'],
  duck: ['......cc..', '......ckoo', 'c.....cc..', '.ccccccc..', '.cccsccc..', '..o..o....'],
  bunny: ['.....c.c.', '.....c.c.', '.....ccc.', '.....ckcc', 'w...ccccp', '.cccccccc', '..cc..cc.'],
  frog: ['.....cc.cc', '.....ck.ck', '...ccccccc', '..cclllccc', '..cc....cc'],
};

function drawPet(px: Px, L: FullLoadout, pose: Pose) {
  const kind = L.pet.replace('pet.', '');
  const rows = PETS[kind];
  if (!rows) return;
  const hop = pose === 'walk1' ? -1 : 0;
  const pal = { ...tone(L.petColor), o: '#ff9f1c', n: INK };
  map(px, -6, 36 - rows.length + hop, rows, pal);
}

function drawWheelchairBack(px: Px) {
  const frame = '#3a3f4b';
  const metal = '#9aa0a8';
  // backrest, push handle and seat sit behind the person
  px(8, 20, 2, 11, frame);
  px(7, 19, 2, 1, metal);
  px(10, 30, 7, 2, frame);
}

/** The big wheel sits beside the person, in front of the near thigh; spokes turn while rolling. */
function drawWheelchairFront(px: Px, pose: Pose) {
  const tire = '#2f3542';
  const rim = '#8e96a3';
  const metal = '#c9ced6';
  const cx = 11;
  const cy = 32;
  for (let a = 0; a < 32; a++) {
    const t = (a / 32) * Math.PI * 2;
    px(Math.round(cx + Math.cos(t) * 5.5), Math.round(cy + Math.sin(t) * 5.5), 1, 1, tire);
  }
  for (let a = 0; a < 24; a++) {
    const t = (a / 24) * Math.PI * 2;
    px(Math.round(cx + Math.cos(t) * 4.2), Math.round(cy + Math.sin(t) * 4.2), 1, 1, rim);
  }
  const spin = pose === 'walk1' ? 1 : pose === 'walk2' ? 2 : 0;
  for (let k = 0; k < 2; k++) {
    const t = ((k + spin / 3) / 2) * Math.PI;
    for (let r = 1; r < 4; r++) {
      px(Math.round(cx + Math.cos(t) * r), Math.round(cy + Math.sin(t) * r), 1, 1, metal);
      px(Math.round(cx - Math.cos(t) * r), Math.round(cy - Math.sin(t) * r), 1, 1, metal);
    }
  }
  px(cx, cy, 1, 1, tire);
  // front frame, footrest and caster
  px(16, 32, 1, 4, rim);
  px(16, 37, 3, 1, rim);
  px(18, 38, 2, 1, tire);
}

/* ================================================================== hair */

interface HairCtx {
  px: Px;
  h: string;
  hs: string;
  hl: string;
  skin: string;
  y: (r: number) => number;
}

function cap(c: HairCtx, top: number) {
  const { px, h, hl, y } = c;
  if (top <= 4) px(10, y(4), 6, 1, h);
  if (top <= 5) px(9, y(5), 8, 1, h);
  px(8, y(6), 10, 3, h);
  px(10, y(5), 3, 1, hl);
}

function afroShape(c: HairCtx, front: boolean) {
  const { px, h, hs, hl, y } = c;
  const rows: Array<[number, number, number]> = [
    [1, 10, 6],
    [2, 8, 10],
    [3, 6, 14],
    [4, 5, 16],
    [5, 4, 18],
    [6, 4, 18],
    [7, 4, 18],
    [8, 4, 18],
    [9, 4, 18],
    [10, 4, 18],
    [11, 5, 16],
    [12, 6, 14],
  ];
  for (const [r, x, w] of rows) {
    if (front && r >= 9) {
      px(x, y(r), 11 - x, 1, h);
      px(18, y(r), x + w - 18, 1, h);
    } else px(x, y(r), w, 1, h);
  }
  for (const [dx, dy] of [[7, 3], [12, 2], [16, 4], [5, 7], [19, 8], [9, 5], [14, 6]]) px(dx, y(dy), 1, 1, hs);
  px(9, y(3), 2, 1, hl);
  px(13, y(2), 2, 1, hl);
}

function drawHairBehind(c: HairCtx, style: string) {
  const { px, h, hs, y } = c;
  switch (style) {
    case 'long':
    case 'bangs':
      px(7, y(9), 4, 13, hs);
      break;
    case 'wavy':
      for (let r = 9; r < 23; r++) px(6 + ((r >> 1) % 2), y(r), 4, 1, hs);
      break;
    case 'ponytail':
      px(5, y(8), 3, 9, hs);
      px(6, y(17), 2, 2, hs);
      break;
    case 'mullet':
      px(7, y(9), 3, 8, hs);
      px(7, y(17), 2, 2, hs);
      break;
    case 'braids':
      for (let r = 9; r < 22; r++) px(7, y(r), 2, 1, r % 2 ? h : hs);
      break;
    case 'locs':
      for (const [x, len] of [[6, 11], [8, 13], [9, 10]] as const)
        for (let r = 9; r < 9 + len; r++) px(x, y(r), 1, 1, r % 3 ? hs : h);
      break;
    case 'afro':
      afroShape(c, false);
      break;
  }
}

function drawHairFront(c: HairCtx, style: string, view: View) {
  const { px, h, hs, hl, skin, y } = c;
  const shaved = mix(h, skin, 0.55);
  if (view === 'back') {
    switch (style) {
      case 'none':
        px(11, y(7), 2, 1, lighten(skin, 0.3));
        return;
      case 'buzz':
        px(8, y(6), 10, 5, mix(h, skin, 0.4));
        return;
      case 'mohawk':
        px(8, y(6), 10, 5, shaved);
        px(11, y(1), 4, 8, h);
        return;
      case 'undercut':
        cap(c, 3);
        px(8, y(9), 10, 3, shaved);
        return;
      case 'afro':
        afroShape(c, false);
        return;
      case 'curly':
      case 'curlyshort': {
        const long = style === 'curly';
        for (const x of [9, 12, 15]) px(x, y(3), 2, 1, h);
        px(7, y(4), 12, long ? 11 : 8, h);
        if (long) {
          px(6, y(8), 1, 2, h);
          px(19, y(8), 1, 2, h);
        }
        px(8, y(5), 2, 1, hl);
        return;
      }
      case 'bob':
        cap(c, 4);
        px(7, y(6), 12, 10, h);
        px(7, y(14), 12, 2, hs);
        return;
      case 'long':
      case 'bangs':
      case 'wavy':
        cap(c, 4);
        px(7, y(6), 12, 16, h);
        px(7, y(19), 12, 3, hs);
        if (style === 'wavy') for (let r = 12; r < 22; r += 2) px(style === 'wavy' ? 6 : 7, y(r), 1, 1, h);
        return;
      case 'mullet':
        cap(c, 4);
        px(8, y(6), 10, 12, h);
        px(9, y(16), 8, 2, hs);
        return;
      case 'ponytail':
        cap(c, 4);
        px(8, y(6), 10, 6, h);
        px(11, y(12), 4, 7, hs);
        px(12, y(19), 2, 1, hs);
        return;
      case 'pigtails':
        cap(c, 4);
        px(8, y(6), 10, 6, h);
        px(5, y(10), 2, 7, hs);
        px(19, y(10), 2, 7, hs);
        px(6, y(9), 2, 1, PINK);
        px(18, y(9), 2, 1, PINK);
        return;
      case 'bun':
        px(11, y(1), 4, 4, h);
        cap(c, 5);
        px(8, y(6), 10, 6, h);
        return;
      case 'spacebuns':
        cap(c, 4);
        px(8, y(6), 10, 6, h);
        px(7, y(2), 3, 3, h);
        px(16, y(2), 3, 3, h);
        return;
      case 'braids':
        cap(c, 4);
        px(8, y(6), 10, 6, h);
        for (let r = 12; r < 22; r++) {
          px(10, y(r), 2, 1, r % 2 ? h : hs);
          px(14, y(r), 2, 1, r % 2 ? h : hs);
        }
        return;
      case 'locs':
        cap(c, 4);
        px(8, y(6), 10, 6, h);
        for (let x = 8; x < 18; x += 2) for (let r = 12; r < 19 + (x % 4); r++) px(x, y(r), 1, 1, r % 3 ? h : hs);
        return;
      default:
        cap(c, 4);
        px(8, y(6), 10, 6, h);
        px(8, y(11), 10, 1, hs);
        return;
    }
  }

  switch (style) {
    case 'none':
      px(11, y(7), 2, 1, lighten(skin, 0.3));
      break;
    case 'short':
      cap(c, 4);
      px(8, y(9), 2, 4, h);
      px(11, y(9), 4, 1, h);
      px(17, y(9), 1, 2, hs);
      break;
    case 'crop':
      cap(c, 5);
      px(8, y(9), 2, 3, h);
      px(17, y(9), 1, 1, hs);
      break;
    case 'pixie':
      cap(c, 4);
      px(8, y(9), 2, 3, h);
      px(11, y(9), 6, 1, h);
      px(12, y(10), 1, 1, h);
      px(15, y(10), 1, 1, hs);
      break;
    case 'sidepart':
      cap(c, 4);
      px(11, y(4), 1, 3, hs);
      px(12, y(9), 6, 1, h);
      px(16, y(8), 2, 1, h);
      px(8, y(9), 2, 4, h);
      px(13, y(6), 3, 1, hl);
      break;
    case 'swoop':
      cap(c, 4);
      px(12, y(7), 7, 2, h);
      px(15, y(9), 3, 1, h);
      px(8, y(9), 2, 4, h);
      px(13, y(6), 4, 1, hl);
      break;
    case 'undercut':
      px(9, y(3), 8, 2, h);
      px(8, y(5), 10, 3, h);
      px(8, y(8), 2, 4, shaved);
      px(13, y(8), 6, 1, h);
      px(16, y(9), 2, 1, h);
      px(11, y(4), 4, 1, hl);
      break;
    case 'mohawk':
      px(8, y(6), 10, 3, shaved);
      px(8, y(9), 2, 3, shaved);
      px(12, y(0), 2, 1, h);
      px(11, y(1), 4, 7, h);
      px(12, y(1), 1, 3, hl);
      break;
    case 'buzz':
      px(8, y(6), 10, 2, mix(h, skin, 0.45));
      px(8, y(8), 1, 4, mix(h, skin, 0.45));
      break;
    case 'curlyshort':
      for (const x of [9, 11, 13, 15]) px(x, y(4), 1, 1, h);
      px(8, y(5), 10, 4, h);
      for (const x of [9, 11, 15, 17]) px(x, y(9), 1, 1, h);
      px(8, y(9), 1, 3, h);
      for (const [x, r] of [[10, 6], [13, 7], [16, 5]]) px(x, y(r), 1, 1, hs);
      px(10, y(5), 2, 1, hl);
      break;
    case 'curly':
      for (const x of [9, 12, 15]) px(x, y(3), 2, 1, h);
      px(8, y(4), 10, 1, h);
      px(7, y(5), 12, 4, h);
      px(7, y(9), 4, 6, h);
      px(6, y(10), 1, 1, h);
      px(6, y(12), 1, 1, h);
      for (const x of [11, 13, 15]) px(x, y(9), 1, 1, h);
      px(17, y(9), 2, 1, h);
      px(9, y(5), 2, 1, hl);
      px(14, y(4), 2, 1, hl);
      break;
    case 'afro':
      afroShape(c, true);
      break;
    case 'bob':
    case 'long':
    case 'wavy':
      cap(c, 4);
      px(7, y(6), 12, 3, h);
      px(7, y(9), 4, 7, h);
      px(17, y(9), 2, style === 'bob' ? 6 : 10, h);
      px(11, y(9), 6, 1, h);
      px(16, y(10), 1, 1, h);
      px(7, y(13), 3, 3, hs);
      if (style === 'wavy') for (let r = 11; r < 19; r += 2) px(19, y(r), 1, 1, h);
      break;
    case 'bangs':
      cap(c, 4);
      px(7, y(6), 12, 3, h);
      px(7, y(9), 11, 1, h);
      px(7, y(10), 3, 9, h);
      px(18, y(9), 1, 9, h);
      px(7, y(9), 11, 1, h);
      px(9, y(9), 1, 1, hs);
      px(13, y(9), 1, 1, hs);
      break;
    case 'mullet':
      cap(c, 4);
      px(8, y(9), 2, 3, h);
      px(11, y(9), 4, 1, h);
      break;
    case 'ponytail':
      cap(c, 4);
      px(8, y(9), 2, 3, h);
      px(11, y(9), 5, 1, h);
      px(7, y(8), 1, 1, '#e0503f');
      break;
    case 'pigtails':
      cap(c, 4);
      px(8, y(9), 2, 3, h);
      px(11, y(9), 5, 1, h);
      px(5, y(10), 2, 7, hs);
      px(19, y(10), 2, 7, h);
      px(6, y(9), 2, 1, PINK);
      px(18, y(9), 2, 1, PINK);
      break;
    case 'bun':
      px(12, y(1), 2, 1, h);
      px(11, y(2), 4, 2, h);
      px(12, y(4), 2, 1, hs);
      cap(c, 5);
      px(8, y(9), 2, 3, h);
      px(11, y(9), 3, 1, h);
      break;
    case 'spacebuns':
      cap(c, 4);
      px(7, y(2), 3, 3, h);
      px(16, y(2), 3, 3, h);
      px(8, y(2), 1, 1, hl);
      px(17, y(2), 1, 1, hl);
      px(8, y(9), 2, 3, h);
      px(11, y(9), 4, 1, h);
      break;
    case 'braids':
      cap(c, 4);
      px(8, y(9), 2, 3, h);
      px(11, y(9), 2, 1, h);
      for (let r = 9; r < 22; r++) px(17, y(r), 2, 1, r % 2 ? h : hs);
      px(17, y(22), 2, 1, PINK);
      break;
    case 'locs':
      cap(c, 4);
      px(8, y(9), 2, 3, h);
      px(11, y(9), 1, 2, h);
      px(14, y(9), 1, 1, h);
      for (const [x, len] of [[17, 9], [18, 11]] as const) for (let r = 9; r < 9 + len; r++) px(x, y(r), 1, 1, r % 3 ? h : hs);
      break;
  }
}

/* ================================================================== face */

function drawFace(px: Px, L: FullLoadout, dy: number) {
  const y = (r: number) => r + dy;
  const s = L.skin;
  const e = L.eyeColor;
  const mouth = mix(s, '#8a3b3b', 0.5);
  const mouthDark = '#6e2a2a';
  const brow = darken(L.hairColor, 0.1);
  // cheeks (always a hint of warmth)
  px(12, y(12), 1, 1, mix(s, '#ff7a7a', 0.3));
  px(17, y(12), 1, 1, mix(s, '#ff7a7a', 0.3));
  // brows
  if (L.brows === 'brows.soft') {
    px(13, y(9), 1, 1, brow);
    px(16, y(9), 1, 1, brow);
  } else if (L.brows === 'brows.bold') {
    px(12, y(9), 2, 1, brow);
    px(15, y(9), 2, 1, brow);
  }
  // eyes
  const dot = (x: number) => {
    px(x, y(10), 1, 1, e === INK ? INK : darken(e, 0.1));
    px(x, y(11), 1, 1, INK);
  };
  const caret = (x: number) => {
    px(x - 1, y(11), 1, 1, INK);
    px(x, y(10), 1, 1, INK);
    px(x + 1, y(11), 1, 1, INK);
  };
  switch (L.eyes) {
    case 'eyes.wide':
      for (const x of [12, 15]) {
        px(x, y(10), 1, 2, WHITE);
        px(x + 1, y(10), 1, 1, e);
        px(x + 1, y(11), 1, 1, INK);
      }
      break;
    case 'eyes.sparkle':
      for (const x of [12, 15]) {
        px(x, y(10), 1, 1, WHITE);
        px(x + 1, y(10), 1, 1, INK);
        px(x, y(11), 1, 1, INK);
        px(x + 1, y(11), 1, 1, e);
      }
      break;
    case 'eyes.lashes':
      dot(13);
      dot(16);
      px(14, y(9), 1, 1, INK);
      px(17, y(9), 1, 1, INK);
      break;
    case 'eyes.happy':
      caret(13);
      caret(16);
      break;
    case 'eyes.sleepy':
      px(12, y(11), 2, 1, INK);
      px(15, y(11), 2, 1, INK);
      px(12, y(10), 2, 1, darken(s, 0.12));
      px(15, y(10), 2, 1, darken(s, 0.12));
      break;
    case 'eyes.wink':
      dot(13);
      caret(16);
      break;
    default:
      dot(13);
      dot(16);
  }
  // face details
  switch (L.faceDetail) {
    case 'fd.blush':
      px(11, y(12), 2, 1, mix(s, '#ff6f8a', 0.55));
      px(17, y(12), 1, 1, mix(s, '#ff6f8a', 0.55));
      break;
    case 'fd.freckles':
      for (const [fx, fy] of [[11, 12], [12, 13], [17, 13], [16, 12]]) px(fx, y(fy), 1, 1, mix(s, '#7a4a2d', 0.45));
      break;
    case 'fd.mole':
      px(16, y(13), 1, 1, darken(s, 0.55));
      break;
    case 'fd.bandaid':
      px(16, y(12), 2, 1, '#f2d0a0');
      px(16, y(12), 1, 1, '#e6b98a');
      break;
  }
  // facial hair (under the mouth)
  const h = L.hairColor;
  switch (L.facialHair) {
    case 'fh.stubble':
      for (const [fx, fy] of [[11, 13], [12, 14], [13, 15], [15, 15], [16, 14], [17, 13], [10, 12]])
        px(fx, y(fy), 1, 1, mix(s, h, 0.4));
      break;
    case 'fh.mustache':
      px(13, y(12), 4, 1, h);
      break;
    case 'fh.goatee':
      px(14, y(14), 2, 2, h);
      px(13, y(12), 4, 1, darken(h, 0.1));
      break;
    case 'fh.beard':
      px(10, y(11), 1, 4, h);
      px(11, y(13), 1, 2, h);
      px(12, y(14), 6, 1, h);
      px(9, y(15), 9, 1, darken(h, 0.1));
      px(17, y(12), 1, 2, h);
      px(13, y(12), 4, 1, h);
      break;
  }
  // mouth
  switch (L.mouth) {
    case 'mouth.grin':
      px(13, y(13), 1, 1, mouthDark);
      px(14, y(13), 2, 1, WHITE);
      px(16, y(13), 1, 1, mouthDark);
      px(14, y(14), 2, 1, mouthDark);
      break;
    case 'mouth.neutral':
      px(14, y(13), 2, 1, darken(s, 0.3));
      break;
    case 'mouth.smirk':
      px(14, y(13), 2, 1, mouth);
      px(16, y(12), 1, 1, mouth);
      break;
    case 'mouth.o':
      px(14, y(13), 2, 2, mouthDark);
      break;
    case 'mouth.tongue':
      px(14, y(13), 2, 1, mouth);
      px(15, y(14), 1, 1, '#ff7f9a');
      break;
    default:
      px(14, y(13), 2, 1, mouth);
  }
}

function drawHead(px: Px, L: FullLoadout, view: View, dy: number) {
  const s = L.skin;
  const ss = darken(s, 0.14);
  const y = (r: number) => r + dy;
  px(9, y(6), 8, 1, s);
  px(8, y(7), 10, 8, s);
  px(9, y(15), 8, 1, ss);
  px(12, y(16), 2, 1, ss); // neck
  if (view === 'front') {
    px(8, y(7), 1, 8, ss);
    px(10, y(10), 1, 2, ss); // ear
    drawFace(px, L, dy);
  } else {
    px(17, y(7), 1, 8, ss);
    px(9, y(10), 1, 2, ss);
  }
}

/* ================================================================== clothes */

const LONG_SLEEVES = new Set([
  'top.hoodie',
  'top.shirt',
  'top.sweater',
  'top.blazer',
  'top.northstar-hoodie',
  'top.turtleneck',
  'top.flannel',
  'top.cardigan',
  'top.puffer',
  'top.raincoat',
  'top.labcoat',
]);

function drawPattern(px: Px, pattern: string, base: string, a: string, y: (r: number) => number) {
  switch (pattern) {
    case 'pat.stripes':
      for (const r of [19, 21, 23]) px(9, y(r), 8, 1, a);
      break;
    case 'pat.dots':
      for (const [x, r] of [[10, 18], [13, 19], [16, 18], [15, 21], [11, 22], [14, 24], [9, 20]]) px(x, y(r), 1, 1, a);
      break;
    case 'pat.check':
      for (let r = 18; r <= 24; r++) for (let x = 9; x <= 16; x++) if (((x >> 1) + (r >> 1)) % 2 === 0) px(x, y(r), 1, 1, mix(base, a, 0.65));
      break;
    case 'pat.stars':
      for (const [x, r] of [[11, 20], [15, 22]]) {
        px(x, y(r), 1, 1, a);
        px(x - 1, y(r), 3, 1, a);
        px(x, y(r - 1), 1, 3, a);
      }
      break;
    case 'pat.hearts':
      for (const [x, r] of [[10, 19], [14, 22]]) {
        px(x, y(r), 1, 1, a);
        px(x + 2, y(r), 1, 1, a);
        px(x, y(r + 1), 3, 1, a);
        px(x + 1, y(r + 2), 1, 1, a);
      }
      break;
  }
}

function drawTop(px: Px, L: FullLoadout, pose: Pose, view: View, dy: number, held: boolean) {
  const top = L.top;
  const front = view === 'front';
  const c = top === 'top.aurora-tee' ? '#1f2a44' : top === 'top.overalls' ? L.topAccent : L.topColor;
  const a = L.topAccent;
  const cs = darken(c, 0.2);
  const cl = lighten(c, 0.3);
  const s = L.skin;
  const y = (r: number) => r + dy;
  const long = LONG_SLEEVES.has(top);
  const wide = top === 'top.kimono';
  const bare = top === 'top.tank';
  const sitting = pose === 'sit';

  const backArmX = front ? 8 : 17;
  const frontArmX = front ? 17 : 8;
  const swing = pose === 'walk1' ? 1 : pose === 'walk2' ? -1 : 0;
  const arm = (x: number, shade: boolean, off: number) => {
    const sleeve = shade ? cs : c;
    const skin = darken(s, shade ? 0.1 : 0);
    if (bare) {
      px(x, y(17 + off), 1, 7, skin);
    } else if (wide) {
      px(front ? (x === 8 ? 7 : 17) : x === 17 ? 17 : 7, y(17 + off), 2, 5, sleeve);
      px(x, y(22 + off), 1, 2, skin);
    } else if (long) {
      px(x, y(17 + off), 1, 6, sleeve);
      px(x, y(23 + off), 1, 1, skin);
    } else {
      px(x, y(17 + off), 1, 3, sleeve);
      px(x, y(20 + off), 1, 4, skin);
      if (top === 'top.jersey') px(x, y(19 + off), 1, 1, a);
    }
  };
  arm(backArmX, true, sitting ? 0 : -swing > 0 ? 1 : 0);

  // torso
  px(9, y(17), 8, 8, c);
  if (top !== 'top.flannel') drawPattern(px, L.topPattern, c, a, y);
  px(front ? 16 : 9, y(18), 1, 7, cs);
  px(9, y(24), 8, 1, cs);

  switch (top) {
    case 'top.tee':
      px(11, y(17), 4, 1, cs);
      break;
    case 'top.tank':
      px(11, y(17), 4, 1, s);
      px(10, y(17), 1, 1, c);
      break;
    case 'top.hoodie':
    case 'top.northstar-hoodie':
      px(10, y(17), 6, 1, cs);
      if (front) {
        px(12, y(18), 1, 2, cl);
        px(14, y(18), 1, 2, cl);
        px(11, y(22), 4, 2, cs);
        if (top === 'top.northstar-hoodie') {
          px(13, y(19), 1, 1, GOLD);
          px(12, y(20), 3, 1, GOLD);
          px(13, y(21), 1, 1, GOLD);
        }
      } else px(10, y(17), 6, 3, cs);
      break;
    case 'top.shirt':
      if (front) {
        px(11, y(17), 1, 1, cl);
        px(14, y(17), 1, 1, cl);
        for (let r = 18; r < 24; r += 2) px(13, y(r), 1, 1, cs);
      } else px(11, y(17), 4, 1, cl);
      break;
    case 'top.sweater':
      px(9, y(19), 8, 1, cl);
      px(9, y(22), 8, 1, cl);
      px(9, y(24), 8, 1, cs);
      break;
    case 'top.turtleneck':
      px(9, y(24), 8, 1, cs);
      break;
    case 'top.flannel':
      for (let r = 17; r <= 24; r++)
        for (let x = 9; x <= 16; x++) if (x % 3 === 0 || r % 3 === 0) px(x, y(r), 1, 1, mix(c, a, 0.55));
      if (front) px(13, y(17), 1, 8, cs);
      break;
    case 'top.cardigan':
      if (front) {
        px(12, y(17), 2, 8, a);
        px(11, y(17), 1, 8, cs);
        px(11, y(19), 1, 1, cl);
        px(11, y(22), 1, 1, cl);
      }
      break;
    case 'top.jersey':
      px(11, y(17), 4, 1, a);
      if (front) {
        px(12, y(19), 3, 1, a);
        px(14, y(20), 1, 1, a);
        px(13, y(21), 1, 2, a);
      } else {
        px(11, y(19), 4, 1, a);
        px(14, y(20), 1, 2, a);
      }
      break;
    case 'top.puffer':
      for (const r of [19, 21, 23]) px(9, y(r), 8, 1, cs);
      px(10, y(17), 6, 1, cl);
      if (front) px(13, y(18), 1, 7, cs);
      break;
    case 'top.overalls': {
      const o = L.topColor;
      px(10, y(19), 6, 6, o);
      px(10, y(17), 1, 2, o);
      px(15, y(17), 1, 2, o);
      if (front) {
        px(10, y(19), 1, 1, GOLD);
        px(15, y(19), 1, 1, GOLD);
        px(11, y(21), 4, 1, darken(o, 0.15));
      }
      break;
    }
    case 'top.blazer':
      if (front) {
        px(12, y(17), 2, 5, a);
        px(11, y(18), 1, 2, cs);
        px(14, y(18), 1, 2, cs);
      }
      break;
    case 'top.kimono':
      if (front) for (let i = 0; i < 4; i++) px(10 + i, y(17 + i), 1, 1, a);
      px(9, y(22), 8, 2, a);
      break;
    case 'top.aurora-tee':
      if (front) {
        px(13, y(19), 1, 2, WHITE);
        px(12, y(21), 1, 1, '#e0503f');
        px(14, y(21), 1, 1, '#e0503f');
        px(13, y(21), 1, 1, '#ff8a3d');
        px(13, y(22), 1, 1, GOLD);
      }
      break;
    case 'top.dress':
      px(9, y(22), 8, 1, cs);
      break;
    case 'top.raincoat':
      px(10, y(17), 6, 1, cs);
      if (front) for (const r of [19, 22]) px(12, y(r), 1, 1, INK);
      break;
    case 'top.labcoat':
      if (front) {
        px(12, y(17), 2, 8, a);
        px(11, y(18), 1, 3, cs);
        px(10, y(21), 1, 1, cs);
      }
      break;
  }

  // long garments continue below the waist
  if (top === 'top.dress' || top === 'top.raincoat' || top === 'top.labcoat') {
    const end = sitting ? 28 : 29;
    for (let r = 25; r <= end; r++) {
      const flare = top === 'top.dress' ? (r >= 27 ? 1 : 0) : 0;
      if (top === 'top.labcoat' && front) {
        px(9 - flare, y(r), 3, 1, c);
        px(14, y(r), 3 + flare, 1, c);
      } else px(9 - flare, y(r), 8 + flare * 2, 1, r === end ? cs : c);
    }
    if (top === 'top.raincoat' && front) px(12, y(25), 1, 1, INK);
    if (top === 'top.dress') drawPattern(px, L.topPattern, c, a, (r) => y(r + 8));
  }

  // front arm (or waving arm)
  if (pose === 'wave') {
    const x = front ? 18 : 7;
    px(frontArmX, y(17), 1, 1, bare ? s : c);
    px(x, y(13), 1, 4, long ? c : s);
    px(x, y(11), 1, 2, s);
    px(x + (front ? 1 : -1), y(11), 1, 1, s);
  } else {
    arm(frontArmX, false, sitting ? 0 : swing > 0 ? 1 : 0);
  }
  void held;
}

/** Turtlenecks sit over the neck; drawn after the head. */
function drawCollar(px: Px, L: FullLoadout, dy: number) {
  if (L.top !== 'top.turtleneck') return;
  px(11, 15 + dy, 4, 2, L.topColor);
  px(10, 16 + dy, 6, 1, darken(L.topColor, 0.1));
}

function drawBottom(px: Px, L: FullLoadout, pose: Pose, view: View) {
  const c = L.bottomColor;
  const cs = darken(c, 0.2);
  const cl = lighten(c, 0.2);
  const s = L.skin;
  const sh = L.shoesColor;
  const shs = darken(sh, 0.25);
  const topItem = ITEM_BY_ID.get(L.top);
  const underDress = L.top === 'top.dress';
  const b = L.bottom;
  const legsBare = underDress ? b !== 'bottom.leggings' : b === 'bottom.shorts' || b === 'bottom.skirt';
  const legCol = underDress && b === 'bottom.leggings' ? c : s;
  const sole = (x: number, yy: number, w: number) => px(x, yy, w, 1, L.shoes === 'shoes.sneakers' || L.shoes === 'shoes.hightops' ? WHITE : darken(sh, 0.35));

  if (pose === 'sit') {
    const fx = view === 'front' ? 0 : -2;
    const thigh = legsBare && !underDress ? s : underDress ? legCol : c;
    px(11 + fx, 29, 7, 3, thigh);
    px(11 + fx, 31, 7, 1, darken(thigh, 0.2));
    if (b === 'bottom.skirt' || b === 'bottom.longskirt') px(10 + fx, 28, 8, 3, c);
    const shin = legsBare || b === 'bottom.skirt' ? legCol : b === 'bottom.longskirt' ? c : c;
    px(16 + fx, 32, 2, 3, shin);
    drawShoe(px, L, 16 + fx, 35, true, false);
    void cl;
    void topItem;
    return;
  }

  const legs: Array<[number, number]> =
    pose === 'walk1' ? [[9, 0], [14, 1]] : pose === 'walk2' ? [[11, 1], [12, 0]] : [[10, 0], [13, 0]];
  const [frontLeg, backLeg] = view === 'front' ? [legs[1], legs[0]] : [legs[0], legs[1]];
  for (const [lx, lift] of [backLeg, frontLeg]) {
    const isBack = lx === backLeg[0];
    const bottomY = 33 - lift;
    const col = isBack ? cs : c;
    if (legsBare || b === 'bottom.longskirt') {
      if (b === 'bottom.shorts') px(lx, 25, 3, 4, col);
      px(lx + 1, b === 'bottom.shorts' ? 29 : 30, 2, bottomY - (b === 'bottom.shorts' ? 28 : 29), isBack ? darken(legCol, 0.1) : legCol);
    } else if (b === 'bottom.leggings') {
      px(lx + 1, 25, 2, bottomY - 24, col);
      px(lx + 1, 26, 1, 3, isBack ? col : cl);
    } else {
      px(lx, 25, 3, bottomY - 24, col);
      if (b === 'bottom.jeans') px(lx + 2, 26, 1, bottomY - 25, cs);
      if (b === 'bottom.cargo') px(isBack ? lx : lx + 2, 28, 1, 2, darken(c, 0.3));
      if (b === 'bottom.joggers') px(lx, bottomY, 3, 1, darken(c, 0.3));
    }
    drawShoe(px, L, lx, bottomY + 1, false, isBack);
  }
  if (!underDress) {
    if (b === 'bottom.skirt') {
      px(10, 25, 6, 1, c);
      px(9, 26, 8, 4, c);
      px(9, 29, 8, 1, cs);
    } else if (b === 'bottom.longskirt') {
      px(10, 25, 6, 1, c);
      px(9, 26, 8, 3, c);
      px(8, 29, 10, 4, c);
      px(8, 32, 10, 1, cs);
    } else if (b !== 'bottom.leggings') {
      px(10, 25, 6, 1, cs);
    }
  }
  void sole;
  void shs;
}

function drawShoe(px: Px, L: FullLoadout, lx: number, sy: number, sitting: boolean, isBack: boolean) {
  const sh = L.shoesColor;
  const col = isBack ? darken(sh, 0.2) : sh;
  const dark = darken(sh, 0.4);
  const toe = sitting ? 2 : 1;
  const w = 3 + toe;
  switch (L.shoes) {
    case 'shoes.hightops':
      px(lx, sy - 1, 3, 1, col);
      px(lx + 1, sy - 1, 1, 1, WHITE);
      px(lx, sy, w, 1, col);
      px(lx, sy + 1, w, 1, WHITE);
      break;
    case 'shoes.boots':
      px(lx, sy - 2, 3, 3, col);
      px(lx, sy, w, 1, col);
      px(lx, sy + 1, w, 1, dark);
      break;
    case 'shoes.rainboots':
      px(lx, sy - 3, 3, 4, col);
      px(lx, sy - 3, 1, 2, lighten(sh, 0.4));
      px(lx, sy, w, 1, col);
      px(lx, sy + 1, w, 1, dark);
      break;
    case 'shoes.loafers':
      px(lx, sy, w, 1, col);
      px(lx, sy + 1, w, 1, dark);
      px(lx + 2, sy, 1, 1, GOLD);
      break;
    case 'shoes.heels':
      px(lx + 1, sy, w - 1, 1, col);
      px(lx, sy + 1, 1, 1, dark);
      px(lx + 2, sy + 1, w - 2, 1, col);
      break;
    case 'shoes.sandals':
      px(lx, sy, w, 1, L.skin);
      px(lx + 1, sy, 1, 1, col);
      px(lx, sy + 1, w, 1, col);
      break;
    case 'shoes.slippers':
      px(lx - 1, sy - 1, w + 1, 1, lighten(sh, 0.3));
      px(lx - 1, sy, w + 1, 2, col);
      px(lx + w - 1, sy - 1, 1, 1, WHITE);
      break;
    case 'shoes.skates':
      px(lx, sy - 1, 3, 1, col);
      px(lx, sy, w, 1, col);
      px(lx, sy + 1, w, 1, dark);
      px(lx, sy + 2, 1, 1, INK);
      px(lx + w - 1, sy + 2, 1, 1, INK);
      break;
    default:
      px(lx, sy, w, 1, col);
      px(lx, sy + 1, w, 1, WHITE);
  }
}

/* ================================================================== neck, headwear, eyewear, extras */

function drawNeck(px: Px, L: FullLoadout, view: View, dy: number) {
  const c = L.neckColor;
  const t = tone(c);
  const y = (r: number) => r + dy;
  const front = view === 'front';
  switch (L.neck) {
    case 'neck.scarf':
      px(9, y(16), 8, 2, c);
      px(9, y(17), 8, 1, t.s);
      px(front ? 11 : 14, y(18), 2, 3, t.s);
      break;
    case 'neck.bowtie':
      if (front) map(px, 11, y(17), ['cc.cc', 'cckcc', 'cc.cc'].map((r) => r), { c, k: t.s });
      break;
    case 'neck.tie':
      if (front) {
        px(12, y(17), 2, 1, t.s);
        px(12, y(18), 2, 5, c);
        px(12, y(23), 1, 1, c);
      }
      break;
    case 'neck.necklace':
      if (front) {
        for (const [x, r] of [[10, 17], [11, 18], [12, 19], [13, 19], [14, 18], [15, 17]]) px(x, y(r), 1, 1, GOLD);
        px(12, y(20), 2, 1, '#9fe3e0');
      } else px(10, y(17), 6, 1, GOLD);
      break;
    case 'neck.bandana':
      px(9, y(16), 8, 1, c);
      if (front) {
        px(10, y(17), 6, 1, c);
        px(11, y(18), 4, 1, c);
        px(12, y(19), 2, 1, c);
        px(11, y(17), 1, 1, WHITE);
        px(14, y(18), 1, 1, WHITE);
      } else px(12, y(17), 2, 1, t.s);
      break;
    case 'neck.lanyard':
      if (front) {
        px(10, y(17), 1, 5, c);
        px(15, y(17), 1, 5, c);
        px(11, y(22), 4, 3, WHITE);
        px(11, y(22), 4, 1, c);
        px(12, y(24), 2, 1, '#8e8a84');
      } else px(10, y(16), 6, 1, c);
      break;
  }
}

function drawHeadwear(px: Px, L: FullLoadout, view: View, dy: number) {
  const c = L.headwearColor;
  const pal = tone(c);
  const y = (r: number) => r + dy;
  const front = view === 'front';
  switch (L.headwear) {
    case 'hat.beanie':
      map(px, 7, y(2), ['....ll......', '..cccccccc..', '.cccccccccc.', '.cscscscscs.', '.cccccccccc.', '.cccccccccc.', '.ssssssssss.'], pal);
      break;
    case 'hat.cap':
      map(px, 7, y(3), ['...cccccc.....', '..cccccccc....', '.ccccllcccc...', '.cccccccccc...'], pal);
      if (front) map(px, 8, y(7), ['ccccccccssss'], pal);
      else {
        px(8, y(7), 10, 1, c);
        px(12, y(6), 2, 1, INK);
      }
      break;
    case 'hat.capback':
      map(px, 7, y(3), ['...cccccc.....', '..cccccccc....', '.cccccccccc...', '.cccccccccc...'], pal);
      if (front) {
        px(5, y(7), 3, 1, pal.s);
        px(8, y(7), 10, 1, c);
        px(9, y(6), 2, 1, INK);
      } else px(8, y(7), 10, 1, c);
      break;
    case 'hat.bucket':
      map(px, 6, y(3), ['....cccccc....', '...cccccccc...', '..cccccccccc..', '..cllccccccc..', 'ssssssssssssss', '.s..........s.'], pal);
      break;
    case 'hat.beret':
      map(px, 8, y(2), ['....k......', '..cccccc...', '.cccccccccc', 'ccccccccccc', '.sssssss...'], pal);
      break;
    case 'hat.headband':
      px(8, y(7), 10, 1, c);
      px(9, y(7), 2, 1, pal.l);
      break;
    case 'hat.bow':
      map(px, front ? 13 : 7, y(3), ['cc..cc', 'cckkcc', 'cc..cc'], { ...pal, k: pal.s });
      break;
    case 'hat.catears':
      map(px, 8, y(2), ['c........c', 'cc......cc', 'cpc....cpc', 'cccc..cccc'], pal);
      break;
    case 'hat.flowers':
      map(px, 8, y(4), ['.p.y.p.y.p', 'pgygpgygpg'], { p: PINK, y: GOLD, g: '#5e9c4a' });
      break;
    case 'hat.headphones':
      px(10, y(4), 6, 1, '#3a3a46');
      px(9, y(5), 1, 2, '#3a3a46');
      px(16, y(5), 1, 2, '#3a3a46');
      if (front) {
        px(8, y(9), 2, 4, c);
        px(17, y(9), 1, 3, pal.s);
      } else {
        px(16, y(9), 2, 4, c);
        px(8, y(9), 1, 3, pal.s);
      }
      break;
    case 'hat.cowboy':
      map(px, 4, y(1), ['......cccccc......', '.....cccccccc.....', '.....cccccccc.....', '.....ssssssss.....', 'cccccccccccccccccc', '.cc............cc.'], pal);
      break;
    case 'hat.crown':
      map(px, 9, y(1), ['y..y..y.', 'yy.yy.yy', 'yyyyyyyy', 'yryyyryy'], { y: GOLD, r: '#e0503f' });
      break;
    case 'hat.party': {
      const m = '#e24c9c';
      const cy = '#3ec7e0';
      px(12, y(-1), 2, 1, GOLD);
      px(12, y(0), 2, 1, m);
      px(12, y(1), 3, 1, cy);
      px(11, y(2), 4, 1, m);
      px(11, y(3), 5, 1, cy);
      px(10, y(4), 6, 1, m);
      break;
    }
    case 'hat.turban':
      px(10, y(2), 6, 1, c);
      px(8, y(3), 10, 1, c);
      px(7, y(4), 12, 5, c);
      for (let i = 0; i < 5; i++) px(8 + i * 2, y(4 + i), 2, 1, pal.s);
      px(9, y(3), 3, 1, pal.l);
      if (front) px(8, y(9), 2, 1, c);
      break;
    case 'hat.hijab':
      if (front) {
        px(10, y(4), 6, 1, c);
        px(9, y(5), 8, 1, c);
        px(7, y(6), 12, 3, c);
        px(7, y(9), 4, 7, c);
        px(17, y(9), 2, 6, c);
        px(11, y(9), 6, 1, pal.s);
        px(9, y(15), 9, 1, c);
        px(8, y(16), 10, 3, c);
        px(9, y(19), 8, 1, pal.s);
        px(7, y(9), 1, 7, pal.s);
        px(8, y(7), 2, 1, pal.l);
      } else {
        px(10, y(4), 6, 1, c);
        px(9, y(5), 8, 1, c);
        px(7, y(6), 12, 13, c);
        px(8, y(19), 10, 1, pal.s);
        px(18, y(8), 1, 10, pal.s);
      }
      break;
  }
}

function drawEyewear(px: Px, L: FullLoadout, view: View, dy: number) {
  const y = (r: number) => r + dy;
  const e = L.eyewear;
  if (e === 'eye.none') return;
  if (view === 'back') {
    if (e !== 'eye.monocle') {
      px(8, y(10), 1, 1, e === 'eye.goggles' ? '#3a3a46' : INK);
      px(17, y(10), 1, 1, e === 'eye.goggles' ? '#3a3a46' : INK);
      if (e === 'eye.goggles') px(8, y(10), 10, 1, '#3a3a46');
    }
    return;
  }
  switch (e) {
    case 'eye.round':
      px(12, y(10), 6, 1, INK);
      px(12, y(11), 1, 1, INK);
      px(14, y(11), 2, 1, INK);
      px(17, y(11), 1, 1, INK);
      px(10, y(10), 2, 1, INK);
      break;
    case 'eye.square':
      px(11, y(9), 7, 1, INK);
      px(11, y(10), 1, 3, INK);
      px(14, y(10), 1, 3, INK);
      px(17, y(10), 1, 3, INK);
      px(11, y(12), 7, 1, INK);
      px(9, y(10), 2, 1, INK);
      break;
    case 'eye.sun':
      px(12, y(10), 3, 2, INK);
      px(15, y(10), 3, 2, INK);
      px(13, y(10), 1, 1, '#6a6a7a');
      px(10, y(10), 2, 1, INK);
      break;
    case 'eye.heart':
      for (const x of [12, 15]) map(px, x, y(10), ['p.p', 'ppp', '.p.'], { p: '#ff4f8b' });
      px(10, y(10), 2, 1, INK);
      break;
    case 'eye.star':
      for (const x of [12, 15]) map(px, x, y(9), ['.y.', 'yyy', '.y.'], { y: GOLD });
      px(10, y(10), 2, 1, INK);
      break;
    case 'eye.3d':
      px(11, y(9), 7, 1, WHITE);
      px(12, y(10), 2, 2, '#e0503f');
      px(15, y(10), 2, 2, '#3ec7e0');
      px(9, y(10), 3, 1, WHITE);
      break;
    case 'eye.monocle':
      map(px, 15, y(9), ['.y.', 'y.y', 'y.y', '.y.'], { y: GOLD });
      px(17, y(13), 1, 3, GOLD);
      break;
    case 'eye.goggles':
      px(8, y(9), 10, 1, '#3a3a46');
      for (const x of [12, 15]) {
        px(x, y(10), 3, 2, '#3a3a46');
        px(x + 1, y(10), 1, 1, '#bfe9ff');
        px(x + 1, y(11), 1, 1, '#9fd0ff');
      }
      break;
  }
}

function drawAccessory(px: Px, L: FullLoadout, view: View, dy: number) {
  const y = (r: number) => r + dy;
  const front = view === 'front';
  switch (L.accessory) {
    case 'acc.flower':
      px(front ? 9 : 16, y(6), 2, 2, PINK);
      px(front ? 10 : 16, y(6), 1, 1, GOLD);
      break;
    case 'acc.earrings':
      px(front ? 10 : 9, y(12), 1, 1, GOLD);
      if (!front) px(17, y(12), 1, 1, GOLD);
      break;
    case 'acc.hearing-aid':
      px(front ? 9 : 17, y(10), 1, 2, '#2bb3a3');
      break;
    case 'acc.star-pin':
      if (front) map(px, 10, y(18), ['.y.', 'yyy', '.y.'], { y: GOLD });
      break;
    case 'acc.rainbow-pin':
      if (front) {
        px(10, y(19), 1, 2, '#e0503f');
        px(11, y(19), 1, 2, GOLD);
        px(12, y(19), 1, 2, '#3f8fd8');
      }
      break;
    case 'acc.five-year-pin':
      if (front) {
        px(11, y(19), 1, 1, GOLD);
        px(10, y(20), 3, 1, GOLD);
        px(11, y(21), 1, 1, GOLD);
      }
      break;
  }
}

function drawHeld(px: Px, L: FullLoadout, pose: Pose, view: View, dy: number) {
  if (L.held === 'held.none' || pose === 'wave') return;
  const front = view === 'front';
  const swing = pose === 'walk1' ? 1 : 0;
  const hx = front ? 18 : 3; // just beside the hand
  const hy = (pose === 'sit' ? 23 : 23 + swing) + dy;
  const c = L.heldColor;
  const pal = { ...tone(c), g: '#5e9c4a', o: '#c9623f', b: '#3b2518', n: '#e8b35a', r: '#8a5a3b' };
  switch (L.held) {
    case 'held.coffee':
      map(px, hx, hy - 3, ['kkk', 'www', 'rrr', 'www'], pal);
      break;
    case 'held.boba':
      map(px, hx, hy - 5, ['..k', '.k.', 'www', 'ncn', 'bnb', 'nnn'], { ...pal, c: lighten(c, 0.4) });
      break;
    case 'held.laptop':
      map(px, front ? 14 : 7, hy - 2, ['sssss', 'ccccc'], { c: '#c9ced6', s: '#8e8a84' });
      break;
    case 'held.book':
      map(px, hx, hy - 3, ['ccc', 'cwc', 'ccc', 'sss'], pal);
      break;
    case 'held.plant':
      map(px, hx, hy - 5, ['g.g.', '.gg.', 'ggg.', '.oo.', '.oo.'], pal);
      break;
    case 'held.icecream':
      map(px, hx, hy - 5, ['.l.', 'lcl', 'ccc', '.n.', '.n.'], { ...pal, c: PINK, l: WHITE });
      break;
    case 'held.balloon':
      for (let r = hy - 12; r < hy; r++) px(hx + (r < hy - 6 ? 1 : 0), r, 1, 1, '#8e8a84');
      map(px, hx - 1, hy - 18, ['.cc.', 'cllc', 'cccc', 'cccc', '.cc.', '..s.'], pal);
      break;
    case 'held.umbrella':
      px(front ? 17 : 8, hy - 21, 1, 22, INK);
      map(px, front ? 8 : 0, hy - 25, ['......ccccc......', '...ccccccccccc...', '.ccccccccccccccc.', 'cccccccccccccccc.', 's..s..s..s..s..s.'], pal);
      break;
  }
}

function drawCane(px: Px, view: View) {
  const x = view === 'front' ? 18 : 7;
  px(x - 1, 22, 2, 1, '#6b4428');
  px(x, 23, 1, 7, '#8a5a3b');
  px(x + (view === 'front' ? 1 : -1), 30, 1, 6, '#8a5a3b');
}

/* ================================================================== assembly */

export function drawAvatarCanvas(input: AvatarLoadout, facing: Facing, requested: Pose): HTMLCanvasElement {
  const L = normalizeLoadout(input);
  const view: View = facing === 'se' || facing === 'sw' ? 'front' : 'back';
  const wheelchair = L.mobility === 'mob.wheelchair';
  const pose: Pose = wheelchair ? (requested === 'wave' ? 'wave' : 'sit') : requested;
  const bodyPose: Pose = wheelchair && requested === 'wave' ? 'sit' : pose;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const px: Px = (x, y, w, h, color) => {
    if (w <= 0 || h <= 0) return;
    ctx.fillStyle = color;
    ctx.fillRect(x + OX, y + T, w, h);
  };
  const dy = bodyPose === 'sit' ? 4 : pose === 'walk1' || pose === 'walk2' ? -1 : 0;
  const walkFrame: Pose = wheelchair ? requested : pose;

  const coversHair = !!ITEM_BY_ID.get(L.headwear)?.coversHair;
  const hairStyle = L.hair.replace('hair.', '');
  const hc: HairCtx = { px, h: L.hairColor, hs: darken(L.hairColor, 0.2), hl: lighten(L.hairColor, 0.22), skin: L.skin, y: (r) => r + dy };

  drawPet(px, L, walkFrame);
  if (wheelchair) drawWheelchairBack(px);

  // Hair is drawn on its own layer so two-tone tips can be applied afterwards.
  const hairLayer = makeCanvas(W, H);
  const hctx = hairLayer.getContext('2d', { willReadFrequently: true })!;
  const hpx: Px = (x, y, w, h, color) => {
    if (w <= 0 || h <= 0) return;
    hctx.fillStyle = color;
    hctx.fillRect(x + OX, y + T, w, h);
  };
  const hairBehind = { ...hc, px: hpx };
  if (!coversHair && view === 'front') drawHairBehind(hairBehind, hairStyle);
  if (L.hairHighlight) tintTips(hairLayer, L.hairHighlight);
  ctx.drawImage(hairLayer, 0, 0);
  hctx.clearRect(0, 0, W, H);

  drawBottom(px, L, bodyPose, view);
  drawTop(px, L, pose === 'wave' ? 'wave' : bodyPose, view, dy, L.held !== 'held.none');
  drawNeck(px, L, view, dy);
  drawHead(px, L, view, dy);
  drawCollar(px, L, dy);
  if (!coversHair) {
    drawHairFront({ ...hc, px: hpx }, hairStyle, view);
    if (L.hairHighlight) tintTips(hairLayer, L.hairHighlight);
    ctx.drawImage(hairLayer, 0, 0);
  }
  drawHeadwear(px, L, view, dy);
  drawEyewear(px, L, view, dy);
  drawAccessory(px, L, view, dy);
  if (wheelchair) drawWheelchairFront(px, walkFrame);
  drawHeld(px, L, pose, view, dy);
  if (L.mobility === 'mob.cane' && pose !== 'sit') drawCane(px, view);

  if (facing === 'sw' || facing === 'nw') {
    const m = makeCanvas(W, H);
    const mctx = m.getContext('2d', { willReadFrequently: true })!;
    mctx.translate(W, 0);
    mctx.scale(-1, 1);
    mctx.drawImage(c, 0, 0);
    return m;
  }
  return c;
}

/** Two-tone hair: long hair gets ombré tips; short hair gets frosted tips on the crown. */
function tintTips(layer: HTMLCanvasElement, color: string) {
  const ctx = layer.getContext('2d')!;
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  let maxRow = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3]) maxRow = y;
  const long = maxRow - T >= 16;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  for (let y = 0; y < H; y++) {
    const row = y - T;
    const hit = long ? row >= 14 : row <= 5;
    if (!hit) continue;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (!d[i + 3]) continue;
      const k = long ? Math.min(1, (row - 13) / 5) : 0.85;
      d[i] = d[i] + (r - d[i]) * k;
      d[i + 1] = d[i + 1] + (g - d[i + 1]) * k;
      d[i + 2] = d[i + 2] + (b - d[i + 2]) * k;
    }
  }
  ctx.putImageData(img, 0, 0);
}

const cache = new Map<string, Sprite>();

export function avatarKey(L: AvatarLoadout): string {
  const n = normalizeLoadout(L);
  return Object.keys(n)
    .sort()
    .map((k) => n[k as keyof FullLoadout])
    .join('|');
}

export function avatarSprite(L: AvatarLoadout, facing: Facing, pose: Pose): Sprite {
  const key = `${avatarKey(L)}|${facing}|${pose}`;
  let s = cache.get(key);
  if (!s) {
    s = finishSprite(drawAvatarCanvas(L, facing, pose), AVATAR_ANCHOR.x, AVATAR_ANCHOR.y);
    cache.set(key, s);
    if (cache.size > 3000) cache.clear();
  }
  return s;
}

export function usesWheelchair(L: AvatarLoadout): boolean {
  return L.mobility === 'mob.wheelchair';
}
