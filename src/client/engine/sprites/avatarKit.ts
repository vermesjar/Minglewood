/**
 * Avatar kit v2: bases and parts built on the character frame (avatarFrame.ts).
 *
 * A BASE is a complete, hand-shaped body — head silhouette, face, skin, limbs — for one body type. PARTS
 * (hair, clothes, glasses, hats, held things) are layered on top and read every position from the frame's
 * anchors, never from their own numbers. Heads are authored as explicit pixel maps; the face is hand-placed
 * pixels at the frame's eye/nose/mouth anchors.
 */
import type { AvatarLoadout } from '@shared/domain/types';
import { ITEM_BY_ID, normalizeLoadout, type FullLoadout } from '@shared/avatar';
import { frameFor, type Body, type Frame, type Pose, type View } from './avatarFrame';
import type { SitLegs } from '@shared/world/sitLegs';
import { GOLD, H, LINE, M, PINK, PLUM, Pix, W, WHITE, hx, lightOf, lineOf, lum, mix, outline, paint, shadowOf, type RGB } from './pixkit';
import TOP_LIB from './topLib.json';
import HAT_LIB from './hatLib.json';
import { HAIR, HAIR_ORIGIN, formBackHair, type PlacedMap } from './avatarHair';
import HAIR_LIB from './hairLib.json';
import FACE_LIB from './faceLib.json';
import PET_LIB from './petLib.json';

/**
 * Paint a hand-drawn tone map at (x0, y0): '#' base, 'h' light, 's' shade, 'd' deep, '.' empty, tinted from
 * `base` (or from a part's own ramp, `tones`); every pixel on the map's boundary becomes the line colour, so pieces
 * are outlined like the rest.
 */
function paintMap(
  P: Pix,
  x0: number,
  y0: number,
  rows: string[],
  base: RGB,
  tint?: (x: number, y: number, c: RGB) => RGB,
  clip?: (x: number, y: number) => boolean,
  tones?: Record<string, RGB>,
) {
  // clipped pixels count as empty, so the part's own edge line follows the clip
  const at = (r: number, c: number) => (rows[r]?.[c] ?? '.') !== '.' && !clip?.(x0 + c, y0 + r);
  const tone: Record<string, RGB> = tones ?? { '#': base, h: lightOf(base), s: shadowOf(base), d: mix(base, LINE, 0.55), l: mix(base, LINE, 0.8) };
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      const ch = row[c];
      if (ch === '.' || clip?.(x0 + c, y0 + r)) continue;
      const edge = !at(r - 1, c) || !at(r + 1, c) || !at(r, c - 1) || !at(r, c + 1);
      let col = edge ? lineOf(base) : (tone[ch] ?? base);
      if (!edge && tint) col = tint(x0 + c, y0 + r, col);
      P.set(x0 + c, y0 + r, col);
    }
  });
}

/**
 * A part library view (art/charkit.py): either a bare map at the part's fixed origin, or a placed map that
 * carries its own top-left corner in stand-pose frame coordinates (generated parts spill past any fixed box).
 */
type LibView = string[] | { x: number; y: number; rows: string[] };
type Lib = Record<string, { front?: LibView; back?: LibView; behindFront?: LibView }>;

function placed(v: LibView, origin: [number, number], shift: [number, number]) {
  return Array.isArray(v) ? { x: origin[0], y: origin[1], rows: v } : { x: v.x + shift[0], y: v.y + shift[1], rows: v.rows };
}

/** How far the head has moved from its stand-pose box (34, 36) in this pose. */
const headShift = (F: Frame): [number, number] => [F.head[0] - 34, F.head[1] - 36];
const hairOrigin = (F: Frame): [number, number] => [F.head[0] + HAIR_ORIGIN.dx, F.head[1] + HAIR_ORIGIN.dy];

/** Generated faces (art/facekit.py): eyes and mouths as placed maps on the standard's anchors. */
type Placed = { x: number; y: number; rows: string[] };
const FACES = FACE_LIB as unknown as { eyes: Record<string, Placed>; mouth: Record<string, Placed> };
const USE_GENERATED_EYES = false;
/** Generated mouths read lopsided or smudged at 1:1; the hand shapes are cleaner. */
const USE_GENERATED_MOUTHS = false;

/** Generated hairstyles (art/charkit.py) take precedence over the hand-drawn maps. */
const GENERATED = HAIR_LIB as unknown as Lib;

type HairLook = { front: LibView; back: LibView; behindFront?: LibView; behindBack?: LibView };

function hairStyle(L: FullLoadout): HairLook | null {
  const id = L.hair.replace('hair.', '');
  if (id === 'none') return null;
  const g = GENERATED[id];
  if (g?.front && g.back) return { front: g.front, back: g.back, behindFront: g.behindFront };
  return HAIR[id] ?? HAIR.short;
}

/**
 * Two-tone tips: the lower part of the style's own length takes the highlight colour, in two steps (as a
 * pixel artist would blend), so short styles show it at the ends and long styles along the lengths.
 */
function hairTint(L: FullLoadout, top: number, height: number, back?: { x: number; ends: number[][] }) {
  if (!L.hairHighlight) return undefined;
  const tip = hx(L.hairHighlight);
  if (back) {
    // seen from behind the back-view form says where the ends are, and the tip colour carries the hair's own
    // shading (its locks and creases read through it, never a flat band)
    const base = lum(hx(L.hairColor));
    return (x: number, y: number, c: RGB) => {
      const k = back.ends[y - top]?.[x - back.x] ?? 0;
      if (!k) return c;
      const f = lum(c) / Math.max(0.06, base);
      return mix(c, [Math.min(255, tip[0] * f), Math.min(255, tip[1] * f), Math.min(255, tip[2] * f)], k);
    };
  }
  return (_x: number, y: number, c: RGB) => {
    const t = (y - top) / Math.max(1, height);
    return t > 0.78 ? mix(c, tip, 0.72) : t > 0.6 ? mix(c, tip, 0.38) : c;
  };
}

/** Back-view hair forms by style and hat, relative to the head box. */
const BACK_FORMS = new Map<string, PlacedMap>();

function drawHair(P: Pix, F: Frame, L: FullLoadout, layer: 'behind' | 'front') {
  const st = hairStyle(L);
  if (!st) return;
  const v = layer === 'behind' ? (F.view === 'front' ? st.behindFront : st.behindBack) : F.view === 'front' ? st.front : st.back;
  if (!v) return;
  const clip = underHat(F, L);
  let m: PlacedMap = placed(v, hairOrigin(F), headShift(F));
  // seen from behind, the hair is given form by the standard's shading pass (avatarHair.ts formBackHair); it sits
  // on the head box, so it depends only on the style and the hat over it: made once, placed on the head each time
  const back = F.view === 'back' && layer === 'front';
  if (back) {
    const [x0, y0] = F.head;
    // keyed by the maps themselves (the Design Lab edits drafts in place of a library entry)
    const hat = clip ? HATS[L.headwear.replace('hat.', '')]?.[F.view] : undefined;
    const rowsOf = (lv?: LibView) => (!lv ? '' : Array.isArray(lv) ? lv.join('/') : `${lv.x},${lv.y}:${lv.rows.join('/')}`);
    const key = `${L.hair}|${m.x - x0},${m.y - y0}|${rowsOf(v)}|${clip ? L.headwear : ''}|${rowsOf(hat)}`;
    let f = BACK_FORMS.get(key);
    if (!f) {
      const made = formBackHair(m, F, L.hair.replace('hair.', ''), clip);
      f = { ...made, x: made.x - x0, y: made.y - y0 };
      if (BACK_FORMS.size > 400) BACK_FORMS.clear();
      BACK_FORMS.set(key, f);
    }
    m = { ...f, x: f.x + x0, y: f.y + y0 };
  }
  // the scalp tint ('k') shows where hair is clipped to the skin (a buzz's fade, a mohawk's sides)
  const scalp = mix(hx(L.skin), hx(L.hairColor), 0.6);
  const tones = back ? { ...hairTones(hx(L.hairColor)), k: scalp, K: shadowOf(scalp) } : undefined;
  const tint = hairTint(L, m.y, m.rows.length, back && m.ends ? { x: m.x, ends: m.ends } : undefined);
  paintMap(P, m.x, m.y, m.rows, hx(L.hairColor), tint, clip, tones);
}

/**
 * The hair ramp, relative to the player's colour and spaced so every step reads on any colour: pale blonde
 * gets a near-white sheen and firm shade; near-black hair is lifted a touch so its shade and lock lines can
 * read below it (the way black hair is drawn as a very dark grey with a sheen).
 */
function hairTones(base: RGB): Record<string, RGB> {
  const toward = (c: RGB, target: RGB, v: number) => {
    const d = lum(target) - lum(c);
    return Math.abs(d) < 1e-6 ? c : mix(c, target, Math.max(0, Math.min(1, (v - lum(c)) / d)));
  };
  const LIFT: RGB = [168, 160, 172];
  const body = lum(base) < 0.15 ? toward(base, LIFT, 0.15) : base;
  const v = lum(body);
  const down = (dv: number) => {
    const want = Math.max(lum(LINE) + 0.01, v - dv);
    return toward(body, want > lum(PLUM) + 0.02 ? PLUM : LINE, want);
  };
  const up = (dv: number) => toward(body, CREAM_LIGHT, Math.min(0.96, v + dv));
  return {
    '#': body,
    h: up(Math.max(0.07, (1 - v) * 0.18)),
    H: up(Math.max(0.1, (1 - v) * 0.32)),
    s: down(Math.max(0.06, v * 0.2)),
    d: down(Math.max(0.09, v * 0.34)),
    l: down(Math.max(0.1, v * 0.48)),
  };
}
const CREAM_LIGHT: RGB = [255, 250, 232];

/** Hats that sit over the crown: hair can't rise above them (a bun, a quiff or a mohawk goes under the hat). */
const CROWN_HATS = new Set(['cap', 'capback', 'beanie', 'bucket', 'cowboy', 'beret', 'sun-hat']);

/**
 * The hide rule for crown hats: in every column the hat spans, hair above the hat's top edge is not drawn.
 * Hair-top accessories (headphones, bows, crowns, ears, flowers, party hats) leave the hair alone.
 */
function underHat(F: Frame, L: FullLoadout): ((x: number, y: number) => boolean) | undefined {
  const id = L.headwear.replace('hat.', '');
  if (!CROWN_HATS.has(id)) return undefined;
  const map = HATS[id]?.[F.view];
  if (!map) return undefined;
  const m = placed(map, hairOrigin(F), headShift(F));
  const top = new Map<number, number>();
  m.rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) if (row[c] !== '.' && !top.has(m.x + c)) top.set(m.x + c, m.y + r);
  });
  // a column's top is the highest hat pixel in it or its neighbours (so the clip line is smooth)
  const topAt = (x: number) => Math.min(top.get(x) ?? Infinity, (top.get(x - 1) ?? Infinity) + 1, (top.get(x + 1) ?? Infinity) + 1);
  return (x, y) => y < topAt(x);
}

/** Glasses sit on the frame's eyes: a ring round each, a bridge between, an arm back to the ear. */
function drawGlasses(P: Pix, F: Frame, L: FullLoadout) {
  const kind = L.eyewear.replace('eye.', '');
  if (kind === 'none' || F.view !== 'front') return;
  const frame: RGB =
    kind === 'heart' ? [226, 76, 156] : kind === 'star' || kind === 'monocle' ? [242, 193, 78] : kind === 'goggles' ? [58, 62, 74] : [34, 26, 36];
  const lens: RGB | null = kind === 'sun' ? [30, 26, 40] : kind === '3d' ? [224, 60, 70] : null;
  const [nx, ny] = F.eyeNear;
  const [fx, fy] = F.eyeFar;
  const ring = (x0: number, y0: number, w: number, h: number, fill: RGB | null, alpha = 255) => {
    for (let y = y0; y < y0 + h; y++)
      for (let x = x0; x < x0 + w; x++) {
        const border = y === y0 || y === y0 + h - 1 || x === x0 || x === x0 + w - 1;
        const corner = (y === y0 || y === y0 + h - 1) && (x === x0 || x === x0 + w - 1);
        if (corner && (kind === 'round' || kind === 'monocle' || kind === 'goggles')) continue;
        if (border) P.set(x, y, frame);
        else if (fill) P.set(x, y, fill, alpha);
      }
  };
  if (kind === 'monocle') {
    ring(fx - 1, fy - 2, 4, 5, null);
    for (let k = 0; k < 6; k++) P.set(fx + 2 + (k > 2 ? 1 : 0), fy + 3 + k, GOLD);
    return;
  }
  if (kind === 'goggles') {
    // a strap round the head at eye level, and two big tinted lenses
    for (let x = F.head[0] + 1; x < nx - 2; x++) {
      P.set(x, ny - 1, frame);
      P.set(x, ny, frame);
    }
    ring(nx - 3, ny - 3, 6, 6, [120, 200, 220], 110);
    ring(fx - 1, fy - 3, 5, 6, [120, 200, 220], 110);
    P.set(nx + 3, ny - 1, frame);
    P.set(fx - 2, ny - 1, frame);
    return;
  }
  ring(nx - 2, ny - 2, 5, 5, lens);
  ring(fx - 1, fy - 2, 4, 5, kind === '3d' ? [60, 190, 220] : lens);
  for (let x = nx + 3; x < fx - 1; x++) P.set(x, ny - 1, frame);
  for (let x = F.ear[0] + 1; x < nx - 2; x++) P.set(x, ny - 1, frame);
}

/* ------------------------------------------------------------------ head silhouettes (22 × 22) */

// '#' = head. Round crown; the face and chin swing toward the side we face (right); the back of the
// skull curves in below the ear on the left.
const HEAD_FRONT = [
  '......##########......',
  '....##############....',
  '...################...',
  '..##################..',
  '.####################.',
  '.####################.',
  '######################',
  '######################',
  '######################',
  '######################',
  '######################',
  '######################',
  '.#####################',
  '..####################',
  '...###################',
  '....##################',
  '.....################.',
  '......###############.',
  '.......#############..',
  '........###########...',
  '.........#########....',
  '...........#####......',
];

const HEAD_BACK = [
  '......##########......',
  '....##############....',
  '...################...',
  '..##################..',
  '.####################.',
  '.####################.',
  '######################',
  '######################',
  '######################',
  '######################',
  '######################',
  '######################',
  '######################',
  '.####################.',
  '.####################.',
  '..##################..',
  '...################...',
  '....##############....',
  '......##########......',
  '........######........',
  '......................',
  '......................',
];

export function headMaskOf(F: Frame) {
  const rows = F.view === 'front' ? HEAD_FRONT : HEAD_BACK;
  const m = M();
  const [x0, y0] = F.head;
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) if (row[c] === '#') m.rect(x0 + c, y0 + r, x0 + c + 1, y0 + r + 1);
  });
  return m;
}

/* ------------------------------------------------------------------ the base */

export type BaseId = 'classic';

function skinTones(L: FullLoadout) {
  const skin = hx(L.skin);
  return { skin, shade: shadowOf(skin), light: lightOf(skin) };
}

function limb(P: Pix, a: [number, number], m: [number, number], b: [number, number], r1: number, r2: number, c: RGB, shade = 0) {
  paint(P, M().capsule(a[0], a[1], m[0], m[1], r1).capsule(m[0], m[1], b[0], b[1], r2), c, { shade });
}

function drawHeadBase(P: Pix, F: Frame, L: FullLoadout) {
  const { skin, shade, light } = skinTones(L);
  const [x0, y0] = F.head;
  // neck in shadow under the chin
  paint(P, M().rrect(F.hx - 4, y0 + 17, F.hx + 5, F.shoulderY + 2, 2), shade, { flat: true });
  const head = headMaskOf(F);
  paint(P, head, skin, { flat: true });
  // hand-placed shading: light across the upper-left crown, shade down the far cheek and under the jaw
  for (let r = 0; r < 22; r++)
    for (let c = 0; c < 22; c++) {
      const x = x0 + c;
      const y = y0 + r;
      if (!head.has(x, y) || !head.has(x + 1, y) || !head.has(x - 1, y) || !head.has(x, y + 1) || !head.has(x, y - 1)) continue;
      if (F.view === 'front') {
        if (r >= 19) P.set(x, y, shade);
        else if (r >= 1 && r <= 5 && c >= 4 && c <= 10 && c + r <= 13) P.set(x, y, light);
      } else {
        if (c >= 17 || r >= 16) P.set(x, y, shade);
        else if (r <= 5 && c <= 9 && c + r <= 11) P.set(x, y, light);
      }
    }
  if (F.view === 'front') {
    // ear on the near side, with a fold line
    const [ex, ey] = F.ear;
    paint(P, M().rrect(ex - 2, ey - 3, ex + 2, ey + 3, 1.5), skin, { flat: true });
    P.set(ex - 1, ey - 1, shade);
    P.set(ex - 1, ey, shade);
    P.set(ex, ey + 1, shade);
    // the nose tip breaks the cheek outline
    const [nx, ny] = F.noseTip;
    P.stamp(nx - 1, ny - 1, ['s', 'sl', 'l'], { s: skin, l: lineOf(skin) });
    P.set(nx, ny - 1, lineOf(skin));
  } else if (!ITEM_BY_ID.get(L.headwear)?.coversEars) {
    // seen from behind, the far ear shows at the side of the head (unless it's wrapped, as in a hijab)
    const [ex, ey] = F.ear;
    paint(P, M().rrect(ex - 1, ey - 3, ex + 3, ey + 3, 1.5), skin, { flat: true });
  }
}

function drawFace(P: Pix, F: Frame, L: FullLoadout, expr?: Expression) {
  if (F.view !== 'front') return;
  // the face follows the moment: a laugh screws the eyes shut into a grin, a cheer and a heart smile with
  // happy eyes, looking at a phone lowers the lids
  if (F.pose === 'laugh1' || F.pose === 'laugh2') L = { ...L, eyes: 'eyes.happy', mouth: 'mouth.grin' };
  else if (F.pose === 'cheer1' || F.pose === 'cheer2') L = { ...L, eyes: 'eyes.happy', mouth: 'mouth.grin' };
  else if (F.pose === 'heart') L = { ...L, eyes: 'eyes.happy', mouth: 'mouth.smile' };
  else if (F.pose === 'phone') L = { ...L, eyes: 'eyes.sleepy', mouth: 'mouth.neutral' };
  if (expr === 'blink') L = { ...L, eyes: 'eyes.blink' };
  if (expr === 'talk') L = { ...L, mouth: L.mouth === 'mouth.o' ? 'mouth.neutral' : 'mouth.talk' };
  // 'blank' (internal): the bare head template the face art is generated on
  if (L.eyes === 'eyes.blank') return;
  const { skin } = skinTones(L);
  const iris = hx(L.eyeColor);
  // The eye colour only tints the pupil: at 1:1 an eye is two pixels, and a light pupil on light skin
  // simply disappears. Every pupil is dark enough to read.
  let pupil = mix(iris, LINE, 0.55);
  if (lum(pupil) > 0.2) pupil = mix(pupil, LINE, 0.5);
  const lid = mix(skin, [64, 36, 30], 0.6);
  const brow = mix(hx(L.hairColor), LINE, 0.5);
  const [nx, ny] = F.eyeNear;
  const [fx, fy] = F.eyeFar;
  const eyes = L.eyes.replace('eyes.', '');
  // Each eye: a lid pixel above, then a white and a pupil looking the way we face. Closed and happy eyes
  // are a dark line or arc in the pupil colour, never lid-brown diagonals (those read as scratches).
  const near: Record<string, string[]> = {
    dot: ['.b', 'wk', 'wk'],
    wide: ['.bb', 'wwk', 'wwk'],
    lashes: ['kb', 'wk', 'wk'],
    happy: ['.c.', 'c.c'],
    sleepy: ['bb', 'wk'],
    blink: ['..', '..', 'cc'],
    wink: ['.b', 'wk', 'wk'],
    sparkle: ['.b', 'kw', 'kk'],
  };
  const far: Record<string, string[]> = {
    dot: ['b.', 'wk', 'wk'],
    wide: ['bb', 'wk', 'wk'],
    lashes: ['bk', 'wk', 'wk'],
    happy: ['.c.', 'c.c'],
    sleepy: ['bb', 'wk'],
    blink: ['..', '..', 'cc'],
    wink: ['..', '..', 'cc'],
    sparkle: ['b.', 'kw', 'kk'],
  };
  // closed and happy eyes are pure line so they still read on the darkest skin
  const pal = { k: pupil, w: WHITE, b: lid, c: LINE };
  const [sx, sy] = headShift(F);
  // Eyes stay simple and identical in shape (generated eyes varied near vs far and read as crooked); what
  // matters is where they sit, which the frame's anchors decide.
  const gen = USE_GENERATED_EYES ? FACES.eyes[eyes] : undefined;
  if (gen) {
    // generated eyes (art/facekit.py), conformed to the eye anchors: lash line and pupil, white, iris in the
    // eye colour, highlight, lid crease
    const tones: Record<string, RGB> = { k: mix(LINE, iris, 0.12), w: WHITE, i: iris, h: WHITE, s: mix(skin, [96, 52, 40], 0.45) };
    gen.rows.forEach((row, r) => {
      for (let c = 0; c < row.length; c++) if (tones[row[c]]) P.set(gen.x + c + sx, gen.y + r + sy, tones[row[c]]);
    });
  } else {
    const n = near[eyes] ?? near.dot;
    const f = far[eyes] ?? far.dot;
    P.stamp(nx - 1 - (n[0].length > 2 ? 1 : 0), ny - 1, n, pal);
    P.stamp(fx, fy - 1, f, pal);
  }
  // brows
  const by = F.browY;
  if (L.brows === 'brows.bold') {
    P.stamp(nx - 2, by - 1, ['bbbb', '.bb.'], { b: brow });
    P.stamp(fx - 1, by - 1, ['bbb'], { b: brow });
  } else if (L.brows !== 'brows.none') {
    P.stamp(nx - 1, by, ['bbb'], { b: brow });
    P.stamp(fx, by, ['bb'], { b: brow });
  }
  // the nose is only the bump on the cheek's outline (drawHeadBase) — no line inside the face
  // cheeks
  if (L.faceDetail === 'fd.blush') {
    const blush = mix(skin, [255, 110, 130], 0.45);
    P.stamp(nx - 3, ny + 3, ['bb'], { b: blush });
    P.set(fx + 1, fy + 3, blush);
  }
  if (L.faceDetail === 'fd.freckles') {
    const fr = mix(skin, [120, 70, 40], 0.45);
    P.stamp(nx - 3, ny + 3, ['f.f'], { f: fr });
    P.set(fx + 1, fy + 3, fr);
  }
  if (L.faceDetail === 'fd.mole') P.set(fx + 2, F.mouth[1] - 1, mix(skin, [70, 40, 30], 0.7));
  if (L.faceDetail === 'fd.bandaid') P.stamp(nx - 1, ny + 3, ['bbb', 'bcb'], { b: [238, 204, 158], c: [206, 164, 118] });
  drawFacialHair(P, F, L);
  // mouth (a beard darkens it so it still reads through the hair)
  const [mx, my] = F.mouth;
  const bearded = L.facialHair === 'fh.beard' || L.facialHair === 'fh.goatee';
  const mc = bearded ? mix(hx(L.hairColor), LINE, 0.75) : mix(skin, LINE, 0.72);
  // Small, symmetric mouths on the mouth anchor (mx-2..mx+2): simple shapes read best at 1:1.
  const mouths: Record<string, string[]> = {
    smile: ['m...m', '.mmm.'],
    // a wide open smile showing a row of teeth
    grin: ['mmmmm', 'mwwwm', '.mmm.'],
    neutral: ['.mmm.'],
    smirk: ['....m', '.mmm.'],
    // a small round "ooh": a ring around a dark opening
    o: ['.mm.', 'mddm', '.mm.'],
    // cheeky: a smile with the tip of the tongue out
    tongue: ['m...m', '.mmm.', '..t..'],
    talk: ['.mmm.', 'mdddm', '.mmm.'],
  };
  const gm = USE_GENERATED_MOUTHS ? FACES.mouth[L.mouth.replace('mouth.', '')] : undefined;
  if (gm) {
    const tones: Record<string, RGB> = { k: mc, w: WHITE, p: [226, 104, 124] };
    gm.rows.forEach((row, r) => {
      for (let c = 0; c < row.length; c++) if (tones[row[c]]) P.set(gm.x + c + sx, gm.y + r + sy, tones[row[c]]);
    });
    return;
  }
  const shape = mouths[L.mouth.replace('mouth.', '')] ?? mouths.smile;
  P.stamp(mx - 2, my, shape, { m: mc, w: WHITE, t: [226, 104, 124], d: mix(mc, LINE, 0.5) });
  // On deep skin a dark line alone disappears: a warm lower-lip highlight under the mouth keeps it readable.
  if (lum(skin) < 0.32 && !bearded && L.mouth !== 'mouth.tongue') {
    const lip = mix(skin, [236, 150, 130], 0.4);
    const below = my + shape.length;
    for (let c = 1; c < 4; c++) if (!P.get(mx - 2 + c, below)?.every((v, k) => Math.abs(v - mc[k]) < 2)) P.set(mx - 2 + c, below, lip);
  }
}

/** Facial hair on the lower face, tinted from the hair colour; drawn under the mouth. */
function drawFacialHair(P: Pix, F: Frame, L: FullLoadout) {
  const kind = L.facialHair.replace('fh.', '');
  if (kind === 'none') return;
  const skin = hx(L.skin);
  const hair = hx(L.hairColor);
  const [mx, my] = F.mouth;
  const [x0, y0] = F.head;
  const head = headMaskOf(F);
  const inside = (x: number, y: number) => head.has(x, y) && head.has(x - 1, y) && head.has(x + 1, y) && head.has(x, y + 1) && head.has(x, y - 1);
  const c = mix(hair, LINE, 0.15);
  if (kind === 'stubble') {
    // a dithered shadow along the jaw, chin and upper lip
    const s = mix(skin, mix(hair, LINE, 0.4), 0.38);
    for (let y = my - 1; y <= y0 + 21; y++)
      for (let x = x0 + 6; x <= x0 + 21; x++) if (inside(x, y) && (x + y) % 2 === 0) P.set(x, y, s);
    return;
  }
  if (kind === 'beard') {
    // jaw and chin from the sideburns round to the far cheek, lips left clear
    for (let y = y0 + 11; y <= y0 + 21; y++)
      for (let x = x0 + 3; x <= x0 + 21; x++) {
        if (!inside(x, y)) continue;
        const side = x <= x0 + 5;
        if (!side && y < my - 1) continue;
        if (y >= my && y <= my + 1 && x >= mx - 2 && x <= mx + 2) continue;
        P.set(x, y, (x + 2 * y) % 5 === 0 ? mix(c, WHITE, 0.18) : y >= y0 + 19 ? shadowOf(c) : c);
      }
    return;
  }
  // mustache (and goatee)
  P.stamp(mx - 3, my - 1, ['.hhhhh.', 'h.....h'], { h: c });
  if (kind === 'goatee') P.stamp(mx - 2, my + 2, ['.hhh.', '.hhh.', '..h..'], { h: c });
}

/* ------------------------------------------------------------------ clothes & body on the frame */

const TOPS = TOP_LIB as unknown as Lib;
const PETS = PET_LIB as unknown as Lib;
const HATS = HAT_LIB as unknown as Lib;
/** Where generated torso garments sit: the torso zone's corner (stand pose), shifted with the frame. */
const TORSO_ORIGIN = { x: 34, y: 57 };

const LONG_SLEEVES = new Set([
  'top.hoodie',
  'top.shirt',
  'top.sweater',
  'top.turtleneck',
  'top.flannel',
  'top.cardigan',
  'top.puffer',
  'top.blazer',
  'top.kimono',
  'top.raincoat',
  'top.labcoat',
  'top.northstar-hoodie',
]);

function topColorOf(L: FullLoadout): RGB {
  return L.top === 'top.labcoat' ? [246, 244, 240] : hx(L.topColor);
}

/** Sleeves are the garment's colour, except under an apron, where they're the tee's. */
function sleeveColorOf(L: FullLoadout): RGB {
  return L.top === 'top.apron' ? hx(L.topAccent) : topColorOf(L);
}

/** A small printed motif (3×3) repeated on a 6-px grid, alternate rows offset. */
function motif(shape: string[], ink: RGB) {
  return (x: number, y: number, c: RGB): RGB => {
    const row = Math.floor(y / 6);
    const lx = (((x + (row % 2) * 3) % 6) + 6) % 6;
    const ly = ((y % 6) + 6) % 6;
    return lx >= 1 && lx <= 3 && ly >= 1 && ly <= 3 && shape[ly - 1][lx - 1] === 'a' ? ink : c;
  };
}

/** Pattern overlays follow the garment's own pixels (stripes, dots, checks, stars, hearts). */
function patternTint(L: FullLoadout): ((x: number, y: number, c: RGB) => RGB) | undefined {
  const acc = hx(L.topAccent);
  switch (L.topPattern) {
    case 'pat.stripes':
      return (_x, y, c) => (y % 4 < 2 ? mix(c, acc, 0.85) : c);
    case 'pat.dots':
      // polka dots, every other row offset like printed fabric
      return (x, y, c) => ((x + (Math.floor(y / 4) % 2) * 2) % 4 === 1 && y % 4 === 1 ? acc : c);
    case 'pat.check':
      return (x, y, c) => ((Math.floor(x / 2) + Math.floor(y / 2)) % 2 ? mix(c, acc, 0.35) : c);
    case 'pat.stars':
      return motif(['.a.', 'aaa', '.a.'], acc);
    case 'pat.hearts':
      return motif(['a.a', 'aaa', '.a.'], [226, 76, 120]);
    default:
      return undefined;
  }
}

function drawArm(P: Pix, F: Frame, L: FullLoadout, near: boolean) {
  const arm = near ? F.armNear : F.armFar;
  const hand = near ? F.handNear : F.handFar;
  const skin = hx(L.skin);
  const shade = near ? 0 : 0.35;
  const long = LONG_SLEEVES.has(L.top);
  const bare = L.top === 'top.tank' || L.top === 'top.dress';
  limb(P, arm.a, arm.m, arm.b, 2.3, 2.1, skin, shade);
  if (!bare) {
    const c = sleeveColorOf(L);
    const tint = patternTint(L);
    const sleeve = long
      ? M().capsule(arm.a[0], arm.a[1], arm.m[0], arm.m[1], 2.9).capsule(arm.m[0], arm.m[1], arm.b[0], arm.b[1], 2.7)
      : M().capsule(arm.a[0], arm.a[1], arm.a[0] + (arm.m[0] - arm.a[0]) * 0.7, arm.a[1] + (arm.m[1] - arm.a[1]) * 0.7, 3);
    paint(P, sleeve, tint ? (x, y) => tint(x, y, c) : c, { shade });
  }
  paint(P, M().ellipse(hand[0], hand[1], 2.4, 2.6), skin, { shade });
  if (near && F.gesture) drawGesture(P, F, hand, skin);
}

/** A hand detail: a thumb up, a raised index finger, or a phone held with its screen lit. */
function drawGesture(P: Pix, F: Frame, [x, y]: [number, number], skin: RGB) {
  const edge = lineOf(skin);
  if (F.gesture === 'thumb' || F.gesture === 'finger') {
    // a thumb (out of the fist) or an index finger pointing straight up, outlined like the hand
    const hx0 = Math.round(x);
    const top = Math.round(y) - 7;
    for (let yy = top + 1; yy <= Math.round(y) - 3; yy++) {
      P.set(hx0, yy, skin);
      P.set(hx0 - 1, yy, edge);
      P.set(hx0 + 1, yy, edge);
    }
    P.set(hx0, top, edge);
  } else if (F.gesture === 'phone' && F.view === 'front') {
    // a dark phone in the hand, its screen glowing up at the face
    paint(P, M().rrect(x - 2, y - 6, x + 3, y + 1, 1), [44, 42, 56], { flat: true });
    P.stamp(Math.round(x - 1), Math.round(y - 5), ['ss', 'ss', 'sb'], { s: [150, 214, 255], b: [96, 170, 230] });
  }
}

/**
 * Seated and seen from behind, the legs run away from us on the far side of the body: the thighs show, out along the
 * seat, and past the knees a shoe, under the thigh; where the feet hang (a stool) the shins hang down to the shoes
 * (avatarFrame seatedLegs).
 */
export const seatedFromBehind = (F: Frame) => F.sitting && F.view === 'back';

function drawLegs(P: Pix, F: Frame, L: FullLoadout) {
  const skin = hx(L.skin);
  const pants = hx(L.bottomColor);
  const b = L.bottom.replace('bottom.', '');
  const skirt = b === 'skirt' || b === 'longskirt' || L.top === 'top.dress';
  const r = b === 'leggings' ? 2.6 : b === 'cargo' || b === 'joggers' ? 3.4 : 3.1;
  for (const [leg, far] of [
    [F.legFar, true],
    [F.legNear, false],
  ] as const) {
    const shade = far ? 0.35 : 0;
    // (from behind, a seated leg ends at the knee, its shoe past it under the thigh, unless the shins hang)
    const thighOnly = seatedFromBehind(F) && !F.shinsBehind;
    limb(P, leg.a, leg.m, thighOnly ? leg.m : leg.b, 2.7, 2.4, skin, shade);
    if (skirt) continue;
    const pm = M().capsule(leg.a[0], leg.a[1], leg.m[0], leg.m[1], r);
    if (seatedFromBehind(F)) {
      // the thigh out to the knee, and a hanging shin down to the shoe
      if (!thighOnly && b !== 'shorts') pm.capsule(leg.m[0], leg.m[1], leg.b[0], leg.b[1], r - 0.3);
      paint(P, pm, pants, { shade });
      continue;
    }
    if (b === 'shorts') pm.band(0, Math.round(leg.a[1] + (leg.m[1] - leg.a[1]) * 0.8));
    else pm.capsule(leg.m[0], leg.m[1], leg.b[0], leg.b[1] - (b === 'joggers' ? 1 : 0), r - 0.3);
    paint(P, pm, pants, { shade });
    // each style's signature, readable at 1:1
    const inside = (x: number, y: number) => pm.has(x, y) && pm.has(x - 1, y) && pm.has(x + 1, y) && pm.has(x, y - 1) && pm.has(x, y + 1);
    const base = far ? mix(pants, PLUM, 0.35 * 0.3) : pants;
    const along = (fn: (x: number, y: number, t: number) => void) => {
      // walk the leg from hip to ankle, t = 0..1
      const [ax, ay] = leg.a;
      const [mx, my] = leg.m;
      const [bx, by] = leg.b;
      for (let y = Math.round(ay); y <= Math.round(by); y++) {
        const t = (y - ay) / Math.max(1, by - ay);
        const x = y <= my ? ax + ((mx - ax) * (y - ay)) / Math.max(1, my - ay) : mx + ((bx - mx) * (y - my)) / Math.max(1, by - my);
        fn(Math.round(x), y, t);
      }
    };
    if (b === 'jeans') {
      // a lighter wash down the lit side of the thigh, and a turned-up cuff
      along((x, y, t) => {
        if (t > 0.15 && t < 0.55 && inside(x - 1, y)) P.set(x - 1, y, lightOf(base));
      });
      const cy = Math.round(leg.b[1]) - 2;
      for (let x = Math.round(leg.b[0]) - 3; x <= leg.b[0] + 3; x++) if (pm.has(x, cy) && pm.has(x - 1, cy) && pm.has(x + 1, cy)) P.set(x, cy, lightOf(pants));
    }
    if (b === 'chinos') {
      // a pressed crease down the front
      along((x, y, t) => {
        if (t > 0.1 && t < 0.92 && inside(x, y)) P.set(x, y, lightOf(base));
      });
    }
    if (b === 'joggers') {
      // gathered elastic cuffs
      const cy = Math.round(leg.b[1]) - 1;
      for (let y = cy - 1; y <= cy; y++)
        for (let x = Math.round(leg.b[0]) - 4; x <= leg.b[0] + 4; x++) if (pm.has(x, y)) P.set(x, y, y === cy - 1 ? shadowOf(base) : mix(base, LINE, 0.35));
    }
    if (b === 'leggings') {
      // a soft sheen on the lit side
      along((x, y, t) => {
        if (t > 0.2 && t < 0.8 && inside(x - 1, y)) P.set(x - 1, y, mix(base, [255, 255, 255], 0.18));
      });
    }
    if (b === 'shorts') {
      // a turned hem
      const hy = Math.round(leg.a[1] + (leg.m[1] - leg.a[1]) * 0.8) - 1;
      for (let x = Math.round(leg.a[0]) - 4; x <= leg.a[0] + 4; x++) if (pm.has(x, hy) && pm.has(x - 1, hy) && pm.has(x + 1, hy)) P.set(x, hy, lightOf(base));
    }
    if (b === 'cargo' && !far) paint(P, M().rrect(leg.m[0] - 3, leg.m[1] - 5, leg.m[0] + 1, leg.m[1] - 1, 1), shadowOf(pants), { flat: true });
  }
  if (!skirt) {
    const hips = M().rrect(F.hx - 9, F.waistY - 1, F.hx + 10, F.hipY + 3, 2);
    paint(P, hips, pants);
    for (let x = F.hx - 8; x < F.hx + 9; x++) if (hips.has(x, F.waistY + 1)) P.set(x, F.waistY + 1, shadowOf(pants));
    // joggers tie at the front
    if (b === 'joggers' && F.view === 'front') P.stamp(F.collar[0] - 1, F.waistY + 2, ['w.w', 'w.w'], { w: lightOf(lightOf(pants)) });
  }
  if (skirt || isCoat(L)) drawLowerGarment(P, F, L);
}

const isCoat = (L: FullLoadout) => L.top === 'top.raincoat' || L.top === 'top.labcoat';

/**
 * Skirts, dresses and coats below the waist, built on the frame: the hem follows the legs (it flares with a
 * stride, drapes over the lap when sitting). Dresses and skirts fall in soft fanned folds; coats open at the
 * front over the trousers, with pocket flaps, and show a vent from behind.
 */
function drawLowerGarment(P: Pix, F: Frame, L: FullLoadout) {
  const b = L.bottom.replace('bottom.', '');
  const coat = isCoat(L);
  const dress = L.top === 'top.dress';
  const col = coat || dress ? topColorOf(L) : hx(L.bottomColor);
  const long = b === 'longskirt' && !coat && !dress;
  const top = F.waistY - 1;
  let poly: Array<[number, number]>;
  let hem: number;
  if (F.sitting && F.view === 'front') {
    // seated, seen from the front: it drapes from the waist over the thighs to the knees (sitLegs lays them toward us),
    // a longer one falling a little past them
    const fall = long ? 5 : coat ? 3 : 1;
    const [nx, ny] = F.legNear.m;
    const [fx, fy] = F.legFar.m;
    hem = Math.max(ny, fy) + 3 + fall;
    poly = [
      [F.hx - 9, top],
      [F.hx + 10, top],
      [Math.max(F.hx + 11, fx + 4), fy - 3],
      [fx + 4, fy + 2 + fall],
      [nx + 2, ny + 4 + fall],
      [nx - 4, ny + 3 + fall],
      [F.hx - 10, F.hipY + 3 + fall],
    ];
  } else if (F.sitting) {
    hem = F.hipY + (long ? 10 : coat ? 8 : 6);
    poly = [
      [F.hx - 9, top],
      [F.hx + 10, top],
      [F.hx + 16, hem],
      [F.hx - 9, hem],
    ];
  } else {
    hem = long ? 98 : coat ? 94 : dress ? 91 : 90;
    // the legs' x at the hem, so a stride flares the hem
    const legX = (l: Frame['legNear']) => {
      const [ax, ay] = l.m;
      const [bx, by] = l.b;
      const t = Math.max(0, Math.min(1, (hem - ay) / Math.max(1, by - ay)));
      return ax + (bx - ax) * t;
    };
    const xs = [legX(F.legNear), legX(F.legFar)];
    poly = [
      [F.hx - 9, top],
      [F.hx + 10, top],
      [Math.max(...xs) + 8, hem],
      [Math.min(...xs) - 7, hem],
    ];
  }
  const shape = M().poly(poly);
  const front = F.view === 'front';
  const split = F.collar[0];
  if (coat && front && !F.sitting) shape.cut(M().rect(split - 1, F.waistY + 1, split + 1, hem + 1));
  const shade = shadowOf(col);
  paint(P, shape, (x, y) => {
    if (coat) {
      // the coat's edges along the opening, pocket flaps, and the back vent
      if (front && !F.sitting && (x === split - 2 || x === split + 1) && y > F.waistY) return shade;
      if (front && y === F.waistY + 5 && ((x >= F.hx - 7 && x <= F.hx - 4) || (x >= F.hx + 5 && x <= F.hx + 8))) return shade;
      if (!front && x === split && y > hem - 7) return shade;
      return col;
    }
    // soft folds fanning out from the waist
    const t = (x - F.hx) / (y - top + 7);
    const f = t * 3.2 - Math.floor(t * 3.2);
    return f < 0.16 && y > top + 3 ? shade : col;
  });
}

function drawShoes(P: Pix, F: Frame, L: FullLoadout) {
  if (F.feetHidden) return;
  const kind = L.shoes.replace('shoes.', '');
  const c = hx(L.shoesColor);
  const front = F.view === 'front';
  for (const [leg, far, heel] of [
    [F.legFar, true, F.heelFar],
    [F.legNear, false, F.heelNear],
  ] as const) {
    const [ax, ay] = leg.b;
    const lift = heel ? 1 : 0;
    const x0 = ax - 3 - (front ? 0 : 2);
    const x1 = ax + 4 + (front ? 2 : 0);
    const y0 = ay - lift;
    const shade = far ? 0.35 : 0;
    const tall = kind === 'boots' ? 4 : kind === 'rainboots' ? 7 : kind === 'hightops' ? 2 : 0;
    const shoe = M().rrect(x0, y0, x1, y0 + 5, 2);
    if (tall) shoe.rect(ax - 3, y0 - tall, ax + 4, y0 + 2);
    if (kind === 'sandals') {
      paint(P, M().rrect(x0, y0 + 1, x1, y0 + 5, 2), hx(L.skin), { shade });
      P.stamp(x0 + 1, y0 + 2, ['cccc'], { c });
      continue;
    }
    if (kind === 'heels') {
      // a slim pointed pump: the toe box, an instep gap, and a thin heel under the back of the foot
      const back = front ? x0 : x1 - 2;
      const toe = front ? x1 : x0;
      const pump = M().rrect(Math.min(back, toe - (front ? 5 : 0)), y0 + 1, Math.max(back + 2, toe + (front ? 0 : 5)), y0 + 4, 1.5);
      paint(P, pump, c, { shade });
      const hx0 = front ? x0 + 1 : x1 - 3;
      paint(P, M().rect(hx0, y0 + 3, hx0 + 2, y0 + 6), mix(c, LINE, 0.35), { shade, flat: true });
      continue;
    }
    paint(P, shoe, kind === 'slippers' ? lightOf(c) : c, { shade });
    // seated and seen from behind, the shoe past the knee shows only below the thigh: a sole stripe or a toe stamp
    // there read as the sole turned up (Carter: "shoes are still like upside down when sitting"), so it's plain
    if (seatedFromBehind(F) && !F.shinsBehind) continue;
    const sole: RGB = kind === 'sneakers' || kind === 'hightops' || kind === 'skates' ? WHITE : [52, 38, 40];
    for (let x = x0 + 1; x < x1 - 1; x++) if (shoe.has(x, y0 + 3) && shoe.has(x, y0 + 4)) P.set(x, y0 + 3, sole);
    if (kind === 'sneakers' || kind === 'hightops') P.stamp(ax - 1, y0 + 1, ['ww'], { w: WHITE });
    if (kind === 'loafers') P.stamp(ax, y0 + 1, ['gg'], { g: GOLD });
    if (kind === 'slippers') {
      // a fluffy cuff round the opening
      const fluff = mix(lightOf(c), WHITE, 0.55);
      for (let x = x0; x < x1; x++) if (shoe.has(x, y0) || shoe.has(x, y0 + 1)) P.set(x, y0 + (x % 2), fluff);
    }
    if (kind === 'skates') for (const wx of [x0 + 1, x0 + 4, x0 + 7]) P.set(wx, y0 + 6, [255, 138, 61]);
  }
}

/** The loadout's body base ('body.b' → 'b'; anything else is the default straight base). */
export function bodyOf(L: FullLoadout): Body {
  return L.body === 'body.b' ? 'b' : 'a';
}

/** Each row's [left, right] extent of a torso outline. */
function torsoRows(F: Frame): Map<number, [number, number]> {
  const m = M().poly(F.torso);
  const rows = new Map<number, [number, number]>();
  for (let y = 0; y < H; y++) {
    let l = -1;
    let r = -1;
    for (let x = 0; x < W; x++)
      if (m.has(x, y)) {
        if (l < 0) l = x;
        r = x;
      }
    if (l >= 0) rows.set(y, [l, r]);
  }
  return rows;
}

/**
 * The mesh warp for body bases: a garment drawn on base A's torso is remapped row by row onto another torso,
 * each row's span stretched from A's outline to the target's (nearest pixel), so pockets, plackets and
 * prints stay put relative to the body. Rows above or below the torso keep the nearest torso row's warp.
 */
function warpToTorso(m: { x: number; y: number; rows: string[] }, from: Frame, to: Frame) {
  const A = torsoRows(from);
  const B = torsoRows(to);
  const ys = [...A.keys()];
  const near = (y: number) => ys.reduce((best, k) => (Math.abs(k - y) < Math.abs(best - y) ? k : best), ys[0]);
  const out: string[] = [];
  let minX = Infinity;
  const cells: Array<[number, number, string]> = [];
  m.rows.forEach((row, r) => {
    const y = m.y + r;
    const k = near(y);
    const [al, ar] = A.get(k)!;
    const [bl, br] = B.get(k) ?? A.get(k)!;
    const sx = (br - bl) / Math.max(1, ar - al);
    // map every target column back to a source column (inverse, so no gaps)
    const src = (x: number) => Math.round(al + (x - bl) / sx);
    const x0 = Math.floor(bl + (m.x - al) * sx);
    const x1 = Math.ceil(bl + (m.x + row.length - 1 - al) * sx);
    for (let x = x0; x <= x1; x++) {
      const c = row[src(x) - m.x];
      if (c && c !== '.') {
        cells.push([x, r, c]);
        minX = Math.min(minX, x);
      }
    }
  });
  if (!cells.length) return m;
  for (const [x, r, c] of cells) {
    const row = (out[r] ??= '');
    const i = x - minX;
    out[r] = row.padEnd(i, '.').slice(0, i) + c + row.slice(i + 1);
  }
  for (let r = 0; r < m.rows.length; r++) out[r] ??= '.';
  return { x: minX, y: m.y, rows: out };
}

/** Catalog tops drawn on a generated base garment (plus a print where they have one). */
const TOP_ALIAS: Record<string, string> = {
  'aurora-tee': 'tee',
  'northstar-hoodie': 'hoodie',
  dress: 'tank',
  raincoat: 'shirt',
  labcoat: 'blazer',
};

function drawPrint(P: Pix, F: Frame, L: FullLoadout) {
  if (F.view !== 'front') return;
  const [cx, cy] = F.collar;
  if (L.top === 'top.aurora-tee') P.stamp(cx - 2, cy + 5, ['.w.', 'wrw', 'www', '.o.'], { w: WHITE, r: [224, 80, 63], o: [255, 138, 61] });
  if (L.top === 'top.northstar-hoodie') P.stamp(cx - 2, cy + 5, ['.g.', 'ggg', 'g.g'], { g: GOLD });
}

function drawTorso(P: Pix, F: Frame, L: FullLoadout) {
  const id = L.top.replace('top.', '');
  const c = topColorOf(L);
  const tint = patternTint(L);
  const map = (TOPS[id] ?? TOPS[TOP_ALIAS[id] ?? ''])?.[F.view];
  const dy = F.shoulderY - 58;
  if (map) {
    const sway = F.hx - 45; // the body sways with some poses (dance, a weight shift)
    const m0 = placed(map, [TORSO_ORIGIN.x + sway, TORSO_ORIGIN.y + dy], [sway, dy]);
    const m = F.body === 'a' ? m0 : warpToTorso(m0, frameFor(F.view, F.pose, 'a'), F);
    let t = tint;
    if (L.top === 'top.apron') {
      // Two colours: the apron in topColor, the tee around it in topAccent (same tone, recoloured). In front
      // the bib is a region; from behind the apron is just its straps and ties, drawn in the deep tone.
      const tee = hx(L.topAccent);
      const deep = mix(c, LINE, 0.55);
      const k = (col: RGB) => lum(col) / Math.max(0.01, lum(c));
      const asTee = (col: RGB) => tee.map((v) => Math.min(255, v * Math.min(1.25, k(col)))) as RGB;
      const apron =
        F.view === 'front'
          ? (x: number, y: number) => y >= F.shoulderY + 4 && x >= F.hx - 6 && x <= F.hx + 7
          : (_x: number, _y: number, col: RGB) => Math.abs(col[0] - deep[0]) + Math.abs(col[1] - deep[1]) + Math.abs(col[2] - deep[2]) < 6;
      t = (x, y, col) => (apron(x, y, col) ? (F.view === 'front' ? col : c) : asTee(col));
    }
    paintMap(P, m.x, m.y, m.rows, c, t);
    drawPrint(P, F, L);
    if (L.top === 'top.raincoat') {
      // a belt at the waist with a brass buckle
      const torso = M().poly(F.torso);
      for (let y = F.waistY - 2; y < F.waistY; y++)
        for (let x = F.hx - 11; x <= F.hx + 12; x++) if (torso.has(x, y)) P.set(x, y, y === F.waistY - 2 ? shadowOf(c) : mix(c, LINE, 0.45));
      if (F.view === 'front') P.stamp(F.collar[0] - 1, F.waistY - 2, ['gg', 'gg'], { g: GOLD });
    }
    if (L.top === 'top.labcoat' && F.view === 'front') P.stamp(F.collar[0] + 4, F.shoulderY + 5, ['b', 'b'], { b: [63, 111, 191] });
    return;
  }
  // Not generated yet: a simple garment on the torso so every look still renders.
  paint(P, M().poly(F.torso), tint ? (x, y) => tint(x, y, c) : c);
  if (F.view === 'front' && id !== 'turtleneck') {
    const [cx, cy] = F.collar;
    paint(P, M().ellipse(cx, cy, 3.5, 2.2).keep(M().poly(F.torso)), hx(L.skin), { edge: false, flat: true });
  }
}

function drawHat(P: Pix, F: Frame, L: FullLoadout) {
  const id = L.headwear.replace('hat.', '');
  if (id === 'none') return;
  const map = HATS[id]?.[F.view];
  if (!map) return;
  let m = placed(map, hairOrigin(F), headShift(F));
  // a hat that hides the hair (a hijab, a turban) wraps the whole back of the head down to the nape: skull its
  // map leaves open (generation can leave a hole where the neck was) is filled with its fabric
  if (F.view === 'back' && ITEM_BY_ID.get(L.headwear)?.coversHair) m = wrapSkull(m, F);
  paintMap(P, m.x, m.y, m.rows, hx(L.headwearColor));
}

/** A back-view map grown to cover the back of the skull down to the nape hairline (the scalp zone). */
function wrapSkull(m: { x: number; y: number; rows: string[] }, F: Frame) {
  const head = headMaskOf(F);
  const [x0, y0] = F.head;
  const x = Math.min(m.x, x0);
  const y = Math.min(m.y, y0);
  const w = Math.max(m.x + Math.max(...m.rows.map((r) => r.length)), x0 + 22) - x;
  const h = Math.max(m.y + m.rows.length, y0 + 18) - y;
  const g = Array.from({ length: h }, (_, r) => Array.from({ length: w }, (_, c) => m.rows[y + r - m.y]?.[x + c - m.x] ?? '.'));
  for (let yy = y0; yy < y0 + 18; yy++)
    for (let xx = x0; xx < x0 + 22; xx++) {
      if (!head.has(xx, yy)) continue;
      const ch = g[yy - y][xx - x];
      if (ch !== '.' && ch !== '#') continue;
      // the fabric over the skull is lit as the head is: from the upper left, shading round the far side and under
      const nx = Math.max(-1, Math.min(1, (xx - x0 - 10.5) / 11.5));
      const ny = Math.max(-1, Math.min(1, (yy - y0 - 10.5) / 11.5));
      const lit = -0.45 * nx - 0.5 * ny + 0.74 * Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      g[yy - y][xx - x] = lit > 0.95 ? 'h' : lit > 0.3 ? '#' : 's';
    }
  // its folds are fabric creases in shade, not drawn lines
  const on = (r: number, c: number) => (g[r]?.[c] ?? '.') !== '.';
  const inner = (r: number, c: number) => on(r, c) && on(r - 1, c) && on(r + 1, c) && on(r, c - 1) && on(r, c + 1);
  g.forEach((row, r) => row.forEach((ch, c) => ch === 'l' && inner(r, c) && (g[r][c] = 'd')));
  return { x, y, rows: g.map((r) => r.join('')) };
}

function drawNeckwear(P: Pix, F: Frame, L: FullLoadout) {
  const kind = L.neck.replace('neck.', '');
  if (kind === 'none') return;
  const c = hx(L.neckColor);
  const [cx, cy] = F.collar;
  const front = F.view === 'front';
  switch (kind) {
    case 'scarf':
      paint(P, M().rrect(cx - 7, cy - 3, cx + 7, cy + 2, 2), (x) => (x % 4 < 2 ? c : lightOf(c)));
      if (front) paint(P, M().rrect(cx - 5, cy + 1, cx - 2, cy + 11, 1), (_x, y) => (y % 4 < 2 ? c : lightOf(c)));
      break;
    case 'bowtie':
      if (front) paint(P, M().poly([[cx - 4, cy - 1], [cx, cy + 1], [cx - 4, cy + 3]]).poly([[cx + 4, cy - 1], [cx, cy + 1], [cx + 4, cy + 3]]), c);
      break;
    case 'tie':
      if (front) paint(P, M().poly([[cx - 1, cy], [cx + 1, cy], [cx + 2, cy + 12], [cx, cy + 14], [cx - 2, cy + 12]]), c);
      break;
    case 'necklace':
      if (front) for (let k = -4; k <= 4; k++) P.set(cx + k, cy + 2 + Math.round((k * k) / 8), GOLD);
      break;
    case 'bandana':
      if (front) paint(P, M().poly([[cx - 5, cy - 1], [cx + 6, cy - 1], [cx, cy + 6]]), (x, y) => ((x + y) % 4 === 0 ? WHITE : c));
      break;
    case 'lanyard':
      if (front) {
        for (let k = 0; k < 8; k++) {
          P.set(cx - 3 + Math.round(k * 0.3), cy + k, c);
          P.set(cx + 4 - Math.round(k * 0.3), cy + k, c);
        }
        paint(P, M().rrect(cx - 2, cy + 7, cx + 3, cy + 12, 1), WHITE, { flat: true });
      }
      break;
  }
}

function drawAccessory(P: Pix, F: Frame, L: FullLoadout) {
  const front = F.view === 'front';
  const [cx, cy] = F.collar;
  switch (L.accessory) {
    case 'acc.flower':
      P.stamp(F.head[0] - 1, F.head[1] + 3, ['.p.', 'pyp', '.p.'], { p: PINK, y: GOLD });
      break;
    case 'acc.earrings':
      if (front) P.stamp(F.ear[0], F.ear[1] + 3, ['g', 'g'], { g: GOLD });
      break;
    case 'acc.hearing-aid':
      P.stamp(F.ear[0] + (front ? -2 : 2), F.ear[1] - 2, ['t', 't'], { t: [43, 179, 163] });
      break;
    case 'acc.star-pin':
    case 'acc.five-year-pin':
      if (front) P.stamp(cx - 6, cy + 4, ['.y.', 'yyy', L.accessory === 'acc.five-year-pin' ? 'r.r' : '.y.'], { y: GOLD, r: [224, 80, 63] });
      break;
    case 'acc.rainbow-pin':
      if (front) P.stamp(cx - 7, cy + 4, ['rrr', 'y.y', 'b.b'], { r: [224, 80, 63], y: GOLD, b: [63, 143, 216] });
      break;
  }
}

/** Things you carry to show (held up in front of you); balloons, umbrellas and laptops are held low. */
const CARRIED = new Set(['held.coffee', 'held.boba', 'held.soda', 'held.popcorn', 'held.icecream', 'held.plush', 'held.book', 'held.plant', 'held.water', 'held.apple']);

function drawHeld(P: Pix, F: Frame, L: FullLoadout) {
  if (L.held === 'held.none') return;
  const [x, y] = F.hold;
  const c = hx(L.heldColor);
  switch (L.held) {
    case 'held.coffee':
      paint(P, M().rrect(x - 2, y - 6, x + 3, y + 1, 1), WHITE, { flat: true });
      paint(P, M().rect(x - 2, y - 4, x + 3, y - 2), [201, 160, 106], { flat: true, edge: false });
      paint(P, M().rrect(x - 3, y - 8, x + 4, y - 5, 1), [90, 60, 50], { flat: true });
      break;
    case 'held.boba':
      paint(P, M().rrect(x - 2, y - 7, x + 3, y + 1, 1), [236, 206, 170], { flat: true });
      P.stamp(x - 1, y - 2, ['k.k'], { k: [59, 37, 24] });
      for (let k = 0; k < 4; k++) P.set(x + 2, y - 8 - k, c);
      break;
    case 'held.laptop':
      // a closed laptop tucked against the side: a silver slab with a darker hinge edge and a small logo
      paint(P, M().rrect(x - 2, y - 8, x + 3, y + 3, 1), [201, 206, 214]);
      for (let yy = y - 7; yy <= y + 2; yy++) P.set(x - 1, yy, [150, 156, 168]);
      P.set(x + 1, y - 3, WHITE);
      break;
    case 'held.book':
      paint(P, M().rrect(x - 2, y - 6, x + 4, y + 1, 1), c);
      break;
    case 'held.plant':
      paint(P, M().rrect(x - 2, y - 3, x + 3, y + 2, 1), [201, 98, 63]);
      paint(P, M().ellipse(x - 1, y - 5, 2, 1.6).ellipse(x + 2, y - 6, 2, 1.6), [94, 156, 74]);
      break;
    case 'held.icecream':
      paint(P, M().poly([[x - 2, y - 3], [x + 3, y - 3], [x + 0.5, y + 3]]), [232, 179, 90]);
      paint(P, M().ellipse(x + 0.5, y - 5, 2.8, 2.6), c);
      break;
    case 'held.popcorn':
      // a striped carton brimming with popcorn
      paint(P, M().poly([[x - 3, y - 6], [x + 4, y - 6], [x + 3, y + 1], [x - 2, y + 1]]), (px) => ((px - x + 8) % 2 ? [236, 72, 72] : WHITE));
      paint(P, M().ellipse(x - 1, y - 7, 2, 1.6).ellipse(x + 2, y - 7, 2, 1.6).ellipse(x + 0.5, y - 9, 2, 1.6), [255, 236, 170], { flat: true });
      break;
    case 'held.soda':
      // a cup with a domed lid and a striped straw
      paint(P, M().poly([[x - 2, y - 6], [x + 3, y - 6], [x + 2, y + 1], [x - 1, y + 1]]), c);
      paint(P, M().rrect(x - 3, y - 8, x + 4, y - 5, 1), WHITE, { flat: true });
      for (let k = 0; k < 4; k++) P.set(x + 1 + (k > 1 ? 1 : 0), y - 9 - k, k % 2 ? WHITE : [236, 72, 72]);
      break;
    case 'held.water':
      // a clear cup from the cooler, the water in it catching the light
      paint(P, M().poly([[x - 2, y - 6], [x + 3, y - 6], [x + 2, y + 1], [x - 1, y + 1]]), [226, 240, 248], { flat: true });
      paint(P, M().poly([[x - 2, y - 3], [x + 3, y - 3], [x + 2, y + 1], [x - 1, y + 1]]), [90, 176, 240], { flat: true, edge: false });
      P.set(x - 1, y - 2, [205, 236, 255]);
      break;
    case 'held.apple':
      // a red apple: a shine, a stalk and a leaf
      paint(P, M().ellipse(x + 0.5, y - 2, 3.4, 3.1), [214, 48, 49], { shine: true });
      P.set(x + 1, y - 6, [96, 62, 38]);
      P.set(x + 1, y - 7, [96, 62, 38]);
      P.stamp(x + 2, y - 7, ['ll'], { l: [98, 176, 74] });
      break;
    case 'held.plush':
      // a little teddy prize: round ears, a muzzle, button eyes
      paint(P, M().ellipse(x + 0.5, y - 2, 4, 4).ellipse(x + 0.5, y - 9, 3.6, 3.3).ellipse(x - 2.6, y - 12, 1.6, 1.6).ellipse(x + 3.6, y - 12, 1.6, 1.6), c);
      P.set(x - 1, y - 10, LINE);
      P.set(x + 2, y - 10, LINE);
      P.stamp(x, y - 8, ['mm'], { m: mix(c, WHITE, 0.55) });
      P.stamp(x, y - 3, ['bb'], { b: mix(c, WHITE, 0.35) });
      break;
    case 'held.balloon':
      // floats above and beside the head, on a string that leans out from the hand
      // the string leans well out from the hand so it never runs along the head
      for (let k = 0; k < 40; k++) P.set(x - Math.round(k / 3.4), y - k, [142, 138, 132]);
      paint(P, M().ellipse(x - 13, y - 46, 5, 6), c, { shine: true });
      break;
    case 'held.umbrella':
      // the canopy opens above the head, never across the face
      {
        // the canopy opens centred over the head; the pole runs from the hand up to it
        const tx = F.hx - 1;
        const ty = F.head[1] - 5; // opens a little above the head
        const len = y - ty;
        for (let k = 0; k <= len; k++) P.set(Math.round(x + ((tx - x) * k) / len), y - k, [58, 40, 42]);
        paint(P, M().ellipse(tx, ty, 17, 8).band(0, ty + 1), (px) => (Math.floor((px - tx) / 5) % 2 ? c : lightOf(c)));
      }
      break;
  }
}

function drawPet(P: Pix, L: FullLoadout, pose: Pose) {
  const kind = L.pet.replace('pet.', '');
  if (kind === 'none') return;
  const c = hx(L.petColor);
  const hop = pose === 'walk1' ? -2 : 0;
  // generated buddies (art/charkit.py pet), conformed to the pet anchor beside the feet
  const gen = PETS[kind]?.front;
  if (gen) {
    const m = placed(gen, [0, 0], [0, hop]);
    paintMap(P, m.x, m.y, m.rows, c);
    return;
  }
  const x = 14;
  const y = 99 + hop;
  const eye: RGB = LINE;
  switch (kind) {
    case 'cat':
      paint(P, M().ellipse(x, y, 7, 4).capsule(x - 6, y - 2, x - 8, y - 9, 1.4), c);
      paint(P, M().ellipse(x + 6, y - 5, 4.2, 3.8).poly([[x + 3, y - 8], [x + 4, y - 12], [x + 6, y - 9]]).poly([[x + 7, y - 9], [x + 9, y - 12], [x + 9, y - 7]]), c);
      P.stamp(x + 6, y - 6, ['k.k'], { k: eye });
      break;
    case 'dog':
      paint(P, M().ellipse(x, y, 7.5, 4.5).capsule(x - 6, y - 2, x - 8, y - 6, 1.4), c);
      paint(P, M().ellipse(x + 6, y - 6, 4.2, 3.8).ellipse(x + 9, y - 4, 2.4, 1.8), c);
      paint(P, M().ellipse(x + 3, y - 6, 1.6, 3.2), shadowOf(c), { flat: true });
      P.set(x + 6, y - 7, eye);
      break;
    case 'duck':
      paint(P, M().ellipse(x, y - 1, 6, 4), c);
      paint(P, M().ellipse(x + 4, y - 7, 3.4, 3.4), c);
      P.stamp(x + 7, y - 7, ['oo'], { o: [255, 159, 28] });
      P.set(x + 5, y - 8, eye);
      break;
    case 'bunny':
      paint(P, M().ellipse(x, y, 6, 4).ellipse(x + 5, y - 5, 3.8, 3.4).capsule(x + 3, y - 8, x + 2, y - 14, 1.3).capsule(x + 6, y - 8, x + 7, y - 14, 1.3), c);
      P.set(x + 6, y - 6, eye);
      break;
    case 'frog':
      paint(P, M().ellipse(x, y - 1, 7, 4), c);
      paint(P, M().ellipse(x - 3, y - 5, 2.2, 2.2).ellipse(x + 3, y - 5, 2.2, 2.2), c);
      P.stamp(x - 3, y - 6, ['k.....k'], { k: eye });
      break;
  }
}

function drawWheelchair(P: Pix, F: Frame, part: 'back' | 'front') {
  const frame: RGB = [58, 63, 75];
  const metal: RGB = [201, 206, 214];
  if (part === 'back') {
    paint(P, M().rrect(F.hx - 15, F.shoulderY + 2, F.hx - 11, F.hipY + 8, 1.5), frame);
    paint(P, M().rrect(F.hx - 12, F.hipY + 4, F.hx + 13, F.hipY + 8, 1.5), frame);
    return;
  }
  const cx = F.hx - 6;
  const cy = F.hipY + 11;
  paint(P, M().ellipse(cx, cy, 10, 10).cut(M().ellipse(cx, cy, 8, 8)), [47, 53, 66]);
  paint(P, M().ellipse(cx, cy, 7.5, 7.5).cut(M().ellipse(cx, cy, 6.5, 6.5)), [142, 150, 163], { flat: true });
  const spin = F.pose === 'walk1' ? 0.5 : F.pose === 'walk2' ? 1 : 0;
  for (let k = 0; k < 3; k++) {
    const a = ((k + spin) / 3) * Math.PI;
    for (let r = -6; r <= 6; r++) P.set(cx + Math.cos(a) * r, cy + Math.sin(a) * r, metal);
  }
  paint(P, M().ellipse(F.hx + 14, 101, 2.2, 2.2), [47, 53, 66]);
  paint(P, M().rrect(F.hx + 10, 96, F.hx + 19, 98, 1), metal, { flat: true });
}

function drawCane(P: Pix, F: Frame) {
  const [x, y] = F.handNear;
  for (let yy = y; yy < 104; yy++) P.set(x - 1, yy, [138, 90, 59]);
  P.stamp(x - 1, y - 2, ['bbb', '..b'], { b: [107, 68, 40] });
}

/* ------------------------------------------------------------------ assembly */

/** Part layers, in the order they can appear; Pix.owner records which one painted each pixel. */
export const LAYER = {
  none: 0,
  pet: 1,
  chairBack: 2,
  hairBehind: 3,
  armBack: 4,
  held: 5,
  legs: 6,
  shoes: 7,
  torso: 8,
  neck: 9,
  head: 10,
  face: 11,
  hair: 12,
  hat: 13,
  glasses: 14,
  accessory: 15,
  armFront: 16,
  chairFront: 17,
  cane: 18,
  outline: 19,
} as const;

/** A momentary expression layered on the look: a blink, or the mouth open mid-sentence. */
export type Expression = 'blink' | 'talk';

/** The frame the kit draws a look with in a view and pose (what drawAvatarV2 hangs every part off). */
export function kitFrame(input: AvatarLoadout, view: View, requested: Pose, legs?: SitLegs): Frame {
  const L = normalizeLoadout(input);
  const wheelchair = L.mobility === 'mob.wheelchair';
  const pose: Pose = wheelchair && requested !== 'wave' ? 'sit' : requested;
  const body = bodyOf(L);
  // a wheelchair is its own seat: it keeps the side-on legs its footrest is drawn for
  const F = frameFor(view, pose, body, CARRIED.has(L.held), wheelchair ? 'legacy' : legs);
  if (wheelchair && pose === 'wave') {
    const sit = frameFor(view, 'sit', body, false, 'legacy');
    return { ...sit, pose: 'wave', armNear: F.armNear, handNear: F.handNear };
  }
  return F;
}

/** `legs`: how a sitter's legs lie on their seat (sitLegs.ts); a sitting pose without it takes its style's own. */
export function drawAvatarV2(input: AvatarLoadout, view: View, requested: Pose, expr?: Expression, legs?: SitLegs): Pix {
  const L = normalizeLoadout(input);
  const wheelchair = L.mobility === 'mob.wheelchair';
  const F = kitFrame(input, view, requested, legs);
  const coversHair = !!ITEM_BY_ID.get(L.headwear)?.coversHair;
  const P = new Pix();
  const on = (layer: number) => (P.layer = layer);
  on(LAYER.pet);
  drawPet(P, L, requested);
  on(LAYER.chairBack);
  if (wheelchair) drawWheelchair(P, F, 'back');
  on(LAYER.hairBehind);
  if (!coversHair) drawHair(P, F, L, 'behind');
  on(LAYER.armBack);
  // (both hands in front of the chest — a clap, hands on the heart — bring the far arm in front of the body)
  if (!F.farArmFront) drawArm(P, F, L, view !== 'front');
  // Seen from behind, the holding hand is in front of the body: what it holds hides behind the torso
  // (a balloon or umbrella still shows above it).
  on(LAYER.held);
  if (!F.holdInFront || L.held === 'held.balloon') drawHeld(P, F, L);
  // seated and seen from behind, the feet are out past the knees: the thighs go over them (hanging, they're below them)
  const feetUnder = seatedFromBehind(F) && !F.shinsBehind;
  on(LAYER.shoes);
  if (feetUnder) drawShoes(P, F, L);
  on(LAYER.legs);
  drawLegs(P, F, L);
  on(LAYER.shoes);
  if (!feetUnder) drawShoes(P, F, L);
  on(LAYER.torso);
  drawTorso(P, F, L);
  on(LAYER.head);
  drawHeadBase(P, F, L);
  // neckwear goes over the neck (it was hidden under it)
  on(LAYER.neck);
  drawNeckwear(P, F, L);
  on(LAYER.face);
  drawFace(P, F, L, expr);
  on(LAYER.hair);
  if (!coversHair) drawHair(P, F, L, 'front');
  on(LAYER.hat);
  drawHat(P, F, L);
  on(LAYER.glasses);
  drawGlasses(P, F, L);
  on(LAYER.accessory);
  drawAccessory(P, F, L);
  on(LAYER.armFront);
  if (F.farArmFront) drawArm(P, F, L, false);
  drawArm(P, F, L, view === 'front');
  on(LAYER.chairFront);
  if (wheelchair) drawWheelchair(P, F, 'front');
  on(LAYER.held);
  if (F.holdInFront && L.held !== 'held.balloon') drawHeld(P, F, L);
  on(LAYER.cane);
  if (L.mobility === 'mob.cane' && !F.sitting) drawCane(P, F);
  sealHairPockets(P, L);
  on(LAYER.outline);
  outline(P);
  sealPinholes(P);
  return P;
}

/**
 * The outline traces round concave edges (a curl, a notch) and can enclose single pixels; any small pocket
 * left fully enclosed after it is closed with the outline's own tone.
 */
function sealPinholes(P: Pix) {
  const solid = (i: number) => P.d[i * 4 + 3] > 0;
  const outside = new Uint8Array(W * H);
  const stack: number[] = [];
  for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
  while (stack.length) {
    const i = stack.pop()!;
    if (outside[i] || solid(i)) continue;
    outside[i] = 1;
    const x = i % W;
    if (x > 0) stack.push(i - 1);
    if (x < W - 1) stack.push(i + 1);
    if (i >= W) stack.push(i - W);
    if (i < W * (H - 1)) stack.push(i + W);
  }
  const seen = new Uint8Array(W * H);
  for (let s = 0; s < W * H; s++) {
    if (solid(s) || outside[s] || seen[s]) continue;
    const pocket: number[] = [];
    const q = [s];
    seen[s] = 1;
    const acc = [0, 0, 0, 0];
    let owner = LAYER.outline as number;
    while (q.length) {
      const i = q.pop()!;
      pocket.push(i);
      const x = i % W;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
        if (j < 0 || j >= W * H) continue;
        if (solid(j)) {
          acc[0] += P.d[j * 4];
          acc[1] += P.d[j * 4 + 1];
          acc[2] += P.d[j * 4 + 2];
          acc[3]++;
          if (P.owner[j] !== LAYER.outline) owner = P.owner[j];
        } else if (!seen[j] && !outside[j]) {
          seen[j] = 1;
          q.push(j);
        }
      }
    }
    if (pocket.length > 8 || !acc[3]) continue;
    const c = mix([acc[0] / acc[3], acc[1] / acc[3], acc[2] / acc[3]], LINE, 0.6);
    for (const i of pocket) {
      P.d.set([c[0], c[1], c[2], 255], i * 4);
      P.owner[i] = owner;
    }
  }
}

/**
 * Close see-through pockets that hair or a hat encloses against the head, neck or shoulders (under a bob,
 * inside a curl): they are painted as the part's own shadow, the way hair falls behind the neck. Gaps framed
 * by the body itself (a waving arm beside the head) stay open.
 */
function sealHairPockets(P: Pix, L: FullLoadout) {
  const solid = (i: number) => P.d[i * 4 + 3] > 0;
  const outside = new Uint8Array(W * H);
  const stack: number[] = [];
  for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
  while (stack.length) {
    const i = stack.pop()!;
    if (outside[i] || solid(i)) continue;
    outside[i] = 1;
    const x = i % W;
    if (x > 0) stack.push(i - 1);
    if (x < W - 1) stack.push(i + 1);
    if (i >= W) stack.push(i - W);
    if (i < W * (H - 1)) stack.push(i + W);
  }
  const seen = new Uint8Array(W * H);
  const hairy = new Set<number>([LAYER.hair, LAYER.hairBehind, LAYER.hat]);
  for (let s = 0; s < W * H; s++) {
    if (solid(s) || outside[s] || seen[s]) continue;
    const pocket: number[] = [];
    const q = [s];
    seen[s] = 1;
    let byHair = 0;
    let border = 0;
    let hatBorder = 0;
    while (q.length) {
      const i = q.pop()!;
      pocket.push(i);
      const x = i % W;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
        if (j < 0 || j >= W * H) continue;
        if (solid(j)) {
          border++;
          if (hairy.has(P.owner[j])) byHair++;
          if (P.owner[j] === LAYER.hat) hatBorder++;
        } else if (!seen[j] && !outside[j]) {
          seen[j] = 1;
          q.push(j);
        }
      }
    }
    // small notches (where hair meets the shoulders) are always sealed; bigger pockets only where hair or a
    // hat frames them
    if (pocket.length > 12 && (pocket.length > 40 || byHair < border * 0.4)) continue;
    if (byHair === 0 && pocket.length > 12) continue;
    const base = hatBorder > byHair / 2 ? hx(L.headwearColor) : hx(L.hairColor);
    const shade = mix(base, LINE, 0.55);
    const layer = hatBorder > byHair / 2 ? LAYER.hat : LAYER.hairBehind;
    for (const i of pocket) {
      P.d[i * 4] = shade[0];
      P.d[i * 4 + 1] = shade[1];
      P.d[i * 4 + 2] = shade[2];
      P.d[i * 4 + 3] = 255;
      P.owner[i] = layer;
    }
  }
}

/** Debug: the frame's anchor points, for the workbench. */
export function frameAnchors(view: View, pose: Pose): Array<[string, number, number]> {
  const F = frameFor(view, pose);
  return [
    ['crown', ...F.crown],
    ['eyeN', ...F.eyeNear],
    ['eyeF', ...F.eyeFar],
    ['nose', ...F.nose],
    ['tip', ...F.noseTip],
    ['mouth', ...F.mouth],
    ['ear', ...F.ear],
    ['chin', ...F.chin],
    ['collar', ...F.collar],
    ['handN', ...F.handNear],
    ['handF', ...F.handFar],
    ['kneeN', ...F.legNear.m],
    ['footN', ...F.legNear.b],
    ['footF', ...F.legFar.b],
  ];
}

export { W as AV_W, H as AV_H };
