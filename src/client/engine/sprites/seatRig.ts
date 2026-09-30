/**
 * A seat rig, composed (src/shared/world/seatRigs.ts): a seat drawing with its sitters, drawn exactly as the game
 * draws them (WorldView) — the seat; then each sitter, back to front, followed by the seat's front layer over
 * them (the drawing's pixels inside the rig's front polygons), kept off every sitter's upper body above the
 * rig's cover. Pure: pixels in, pixels and measurements out, for the rig tools (scripts/seat-rig.ts: sheets and
 * the check) and the Design Lab.
 */
import type { AvatarLoadout } from '@shared/domain/types';
import type { Facing } from '@shared/world/scene';
import { BACK_COVER_UP, CROUCH_UNTIL, sitMotion, sitterLift, sitterPoint, SIT_POSE_OF, type SeatProfile, type SitStyle } from '@shared/world/seats';
import {
  coveredPose,
  coverRow,
  drawingToWorld,
  FIG,
  figAx,
  figSeatRow,
  figSeatRowFor,
  fromBehind,
  frontLayers,
  frontMask,
  poseDrop,
  rigFeet,
  rigShapeProblems,
  tidyRig,
  worldToDrawing,
  type SeatRig,
} from '@shared/world/seatRigs';
import { backrestMask, inDiamond, mirrorLine } from './seatFit';
import { segment } from './pieces';
import { traceMask } from './rigTrace';
import { renderAvatarLayers } from './avatarQa';
import { LAYER } from './avatarKit';
import { frameFor, type Pose } from './avatarFrame';
import type { Pixels } from './footing';

/**
 * The people every rig is checked and shown with: short hair and a tee; long hair; a bulky coat and a wide hat
 * (the widest, tallest silhouette the wardrobe makes).
 */
export const RIG_LOOKS: AvatarLoadout[] = [
  { hair: 'hair.short', hairColor: '#3b2518', top: 'top.tee', topColor: '#e0503f', bottom: 'bottom.jeans', bottomColor: '#1f2a44' } as AvatarLoadout,
  { hair: 'hair.long', hairColor: '#d9a35b', top: 'top.hoodie', topColor: '#2bb3a3', bottom: 'bottom.chinos', bottomColor: '#3a3a46', body: 'body.b' } as AvatarLoadout,
  {
    hair: 'hair.curly',
    hairColor: '#241812',
    top: 'top.puffer',
    topColor: '#7a5cc4',
    bottom: 'bottom.cargo',
    bottomColor: '#4a4a36',
    headwear: 'hat.cowboy',
    headwearColor: '#8a5a2b',
    skin: '#8d5a3b',
  } as AvatarLoadout,
];

/** The cushions of a seat placed facing a way (seatSpots order: a long seat runs across the way it faces). */
export function rigCushions(footprint: readonly [number, number], facing: Facing): Array<{ x: number; y: number }> {
  const long = Math.max(...footprint);
  const across = facing === 'ne' || facing === 'sw';
  const w = across ? long : Math.min(...footprint);
  const d = across ? Math.min(...footprint) : long;
  const out: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < d; y++) for (let x = 0; x < w; x++) out.push({ x, y });
  return out;
}

/** One view of a seat, as the game draws it: the drawing it uses in this facing, and what the model says it is. */
export interface RigView {
  art: RigArt;
  facing: Facing;
  footprint: readonly [number, number];
  style: SitStyle;
  /** The cushion's height (the seat profile's `seat`, world px). */
  seat: number;
  backrest: boolean;
  arms: boolean;
  /** Seen from behind, the whole seat wraps its sitter (a beanbag): it shows no seat surface from there. */
  wraps?: boolean;
}

/** Everyone seated in a view: look `k + i` on cushion i, at the rig's hips. */
export function seatedSitters(v: RigView, rig: SeatRig, looks: AvatarLoadout[], k = 0): RigSitter[] {
  return rigCushions(v.footprint, v.facing).map((c, i) => ({
    look: looks[(k + i) % looks.length],
    facing: v.facing,
    pose: SIT_POSE_OF[v.style] as Pose,
    feet: rigFeet(rig.hips[i] ?? [0, 0], v.style),
    depth: c.x + c.y,
  }));
}

/**
 * Sitting down → seated → standing up on cushion 0, frame by frame, the way WorldView moves a sitter: from their
 * feet on the cushion's tile, crouching, up into the seat (seats.ts sitMotion) and back — for the rig sheets and
 * the Design Lab's live preview.
 */
export function sitFrames(v: RigView, rig: SeatRig, look: AvatarLoadout): RigSitter[] {
  const c = rigCushions(v.footprint, v.facing)[0];
  const anchor: [number, number] = [v.art.ax, v.art.ay];
  const L = sitterLift({ seat: v.seat, sitStyle: v.style, backrest: v.backrest, seatDepth: 0, backDepth: 0 }, v.facing);
  const feet = rigFeet(rig.hips[0] ?? [0, 0], v.style);
  const hip = drawingToWorld(anchor, feet[0], feet[1], L);
  const foot = { x: c.x + 0.5, y: c.y + 0.5 };
  const ks: Array<[number, boolean]> = [
    [0, true],
    [0.2, true],
    [0.34, true],
    [0.45, true],
    [0.6, true],
    [0.8, true],
    [1, true],
    [0.8, false],
    [0.55, false],
    [0.36, false],
    [0.2, false],
    [0, false],
  ];
  return ks.map(([k, down]) => {
    const m = sitMotion(k, down, L);
    const [px, py] = worldToDrawing(anchor, foot.x + (hip.x - foot.x) * k, foot.y + (hip.y - foot.y) * k, m.lift);
    const pose: Pose = k <= 0 ? 'stand' : k < CROUCH_UNTIL ? 'crouch' : (SIT_POSE_OF[v.style] as Pose);
    return { look, facing: v.facing, pose, feet: [Math.round(px), Math.round(py)] as [number, number], depth: c.x + c.y };
  });
}

/**
 * Today's inference as a first draft of a rig (unaudited): the hips where the seat profile puts them, and as the
 * front layer the backrest mask seen from behind (seatFit.backrestMask) or, seen from the front, the strip of the
 * footprint along the near side from the floor to a little over the cushion (the near arm) for a seat with arms.
 * Returns the rig (simplified polygons) and the exact pixel mask it came from.
 */
export function inferRig(v: RigView, p: SeatProfile, mirrored: boolean): { rig: SeatRig; mask: Uint8Array } {
  const anchor: [number, number] = [v.art.ax, v.art.ay];
  const hips = rigCushions(v.footprint, v.facing).map((c) => {
    const hp = sitterPoint({ x: c.x, y: c.y, facing: v.facing }, p);
    const [fx, fy] = worldToDrawing(anchor, hp.x, hp.y, sitterLift(p, v.facing));
    return [Math.round(fx), Math.round(fy - FIG.feet + figSeatRowFor(p.sitStyle))] as [number, number];
  });
  const long = Math.max(...v.footprint);
  const across = v.facing === 'ne' || v.facing === 'sw';
  const w = across ? long : Math.min(...v.footprint);
  const d = across ? Math.min(...v.footprint) : long;
  const { px } = v.art;
  let mask: Uint8Array = new Uint8Array(px.w * px.h);
  let cover: number | undefined;
  if (fromBehind(v.facing) && p.backrest) {
    const drawnLine = p.backLine?.[(mirrored ? (v.facing === 'ne' ? 'nw' : 'ne') : v.facing) as 'ne' | 'nw'];
    const line = drawnLine && mirrored ? mirrorLine(drawnLine, px.w) : drawnLine;
    mask = backrestMask({ px, ax: v.art.ax, ay: v.art.ay }, w, d, p, v.facing as 'ne' | 'nw', line);
    cover = 2 * BACK_COVER_UP + FIG.thigh;
  } else if (!fromBehind(v.facing) && p.arms) {
    const box = v.facing === 'se' ? { x0: 0, x1: w, y0: d - 0.22, y1: d } : { x0: w - 0.22, x1: w, y0: 0, y1: d };
    const corners: Array<[number, number]> = [];
    for (const x of [box.x0, box.x1]) for (const y of [box.y0, box.y1]) for (const z of [0, p.seat + 9]) corners.push(worldToDrawing(anchor, x, y, z));
    const hullMask = frontMask(px.w, px.h, [hull(corners)]);
    for (let i = 0; i < mask.length; i++) mask[i] = hullMask[i] && px.d[i * 4 + 3] ? 1 : 0;
  }
  const front = traceMask(mask, px.w, px.h);
  return { rig: tidyRig({ hips, front, ...(cover !== undefined ? { cover } : {}), legs: fromBehind(v.facing) ? 'hide' : 'show' }), mask };
}

function hull(pts: Array<[number, number]>): Array<[number, number]> {
  const s = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: Array<[number, number]> = [];
  for (const q of s) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  const up: Array<[number, number]> = [];
  for (const q of s.reverse()) {
    while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
    up.push(q);
  }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}

/**
 * What's wrong with a rig for a view, by the standard (empty = it holds):
 *   - well-formed, one hip per cushion
 *   - each hip on its own cushion: on the drawing, and over its cushion's tile at the cushion's height
 *   - arms or a back facing the camera: something drawn over the sitter
 *   - with every cushion taken, for each look: the head, shoulders and upper back show (seen from behind, at
 *     least 90%; from the front, 95%); legs that show do (at least half of them), legs a seat hides are hidden (at
 *     least 90% under its front layer)
 *   - no holes: every pixel of a sitter ends up theirs, another sitter's or the seat's front layer — never the
 *     seat drawn behind them or nothing; and the seat is drawn over a sitter only inside its front polygons
 */
export function checkRigView(v: RigView, rig: SeatRig, looks: AvatarLoadout[] = RIG_LOOKS): string[] {
  return rigFindings(v, rig, looks).problems;
}

/**
 * A view's seat SURFACE — the cushion's top plane, what a sitter rests on: the rig's own (`surface` polygons over
 * the drawing's pixels) where it has one; else read off the drawing. The cushion's footprint projected at the
 * seat's height gives where the plane can be; within it, the drawing's natural pieces (pieces.ts) that stay in
 * that plane are its surface — a piece that rises above it (a backrest, solid or open; an arm) is not, and seen
 * from behind a seat that wraps its sitter (a beanbag: all of it covers them) shows no surface at all. Seen from
 * the front, where the pieces can't tell (a sofa all one fabric), the whole projected plane counts.
 */
const surfaces = new WeakMap<object, Map<string, Uint8Array>>();
export function rigSurface(v: RigView, rig?: SeatRig): Uint8Array {
  const { px } = v.art;
  if (rig?.surface) {
    const m = frontMask(px.w, px.h, rig.surface);
    for (let i = 0; i < m.length; i++) if (!px.d[i * 4 + 3]) m[i] = 0;
    return m;
  }
  let memo = surfaces.get(px);
  if (!memo) surfaces.set(px, (memo = new Map()));
  const key = `${v.facing}|${v.seat}|${v.wraps ? 1 : 0}`;
  const had = memo.get(key);
  if (had) return had;
  const W = px.w;
  const H = px.h;
  const out = new Uint8Array(W * H);
  const behind = fromBehind(v.facing);
  if (!(behind && v.wraps)) {
    const long = Math.max(...v.footprint);
    const across = v.facing === 'ne' || v.facing === 'sw';
    const w = across ? long : Math.min(...v.footprint);
    const d = across ? Math.min(...v.footprint) : long;
    const art = { px, ax: v.art.ax, ay: v.art.ay };
    const plane = new Uint8Array(W * H);
    const top = new Int32Array(W).fill(H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (px.d[(y * W + x) * 4 + 3] && inDiamond(art, x, y, w, d, v.seat)) {
          plane[y * W + x] = 1;
          top[x] = Math.min(top[x], y);
        }
    const pieces = segment(px);
    const size = new Array<number>(pieces.n + 1).fill(0);
    const inside = new Array<number>(pieces.n + 1).fill(0);
    const above = new Array<number>(pieces.n + 1).fill(0);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const k = pieces.labels[y * W + x];
        if (!k) continue;
        size[k]++;
        if (plane[y * W + x]) inside[k]++;
        else if (y < top[x]) above[k]++;
      }
    // seen from behind, the backrest stands between us and the seat, and where it's split into pieces some of
    // them lie wholly in the plane: backrest MATERIAL is told by colour too — a colour that shows above the plane
    // (in its own column) at least half as often as in it is the backrest's, not the cushion's
    let backLike: (i: number) => boolean = () => false;
    if (behind) {
      const key = (i: number) => ((px.d[i * 4] >> 3) << 10) | ((px.d[i * 4 + 1] >> 3) << 5) | (px.d[i * 4 + 2] >> 3);
      const hist = () => new Map<number, [number, number, number, number]>();
      const up = hist();
      const inn = hist();
      let nUp = 0;
      let nIn = 0;
      const add = (m: ReturnType<typeof hist>, i: number) => {
        const e = m.get(key(i));
        if (e) e[3]++;
        else m.set(key(i), [px.d[i * 4], px.d[i * 4 + 1], px.d[i * 4 + 2], 1]);
      };
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          if (!px.d[i * 4 + 3]) continue;
          if (plane[i]) {
            add(inn, i);
            nIn++;
          } else if (y < top[x]) {
            add(up, i);
            nUp++;
          }
        }
      const share = (m: ReturnType<typeof hist>, total: number, c: readonly number[]) => {
        let sum = 0;
        for (const e of m.values()) if ((e[0] - c[0]) ** 2 + (e[1] - c[1]) ** 2 + (e[2] - c[2]) ** 2 < 26 * 26) sum += e[3];
        return total ? sum / total : 0;
      };
      const verdict = new Map<number, boolean>();
      for (const [k, e] of inn) verdict.set(k, nUp > 0 && share(up, nUp, e) >= 0.5 * share(inn, nIn, e));
      backLike = (i) => verdict.get(key(i)) ?? false;
    }
    for (let i = 0; i < W * H; i++) {
      const k = pieces.labels[i];
      if (k && plane[i] && inside[k] >= 0.6 * size[k] && above[k] <= Math.max(2, 0.08 * size[k]) && !backLike(i)) out[i] = 1;
    }
    planes.set(out, plane);
  }
  memo.set(key, out);
  return out;
}

/** The cushion plane under a surface (its footprint at the seat's height), kept for the thigh check. */
const planes = new WeakMap<Uint8Array, Uint8Array>();

/**
 * Where a sitter's thighs may rest, seen from the front: the seat's surface, and wherever a column of the cushion
 * plane has none of it (a cushion drawn in one piece with the back or an arm, a seat all one fabric) the plane
 * itself there — lenient, since the question is only whether the thighs float above or sink below the seat.
 */
function thighBed(surface: Uint8Array, W: number, H: number): Uint8Array {
  const plane = planes.get(surface);
  if (!plane) return surface;
  const out = surface.slice();
  for (let x = 0; x < W; x++) {
    let has = false;
    for (let y = 0; y < H && !has; y++) has = out[y * W + x] === 1;
    if (!has) for (let y = 0; y < H; y++) if (plane[y * W + x]) out[y * W + x] = 1;
  }
  return out;
}

/** Whether a seat profile says the whole seat wraps its sitter from behind (a backrest line across the top). */
export function wrapsSitter(backLine: ReadonlyArray<readonly [number, number]> | undefined): boolean {
  return !!backLine && backLine.length === 2 && backLine[0][1] <= 0 && backLine[1][1] <= 0 && backLine[1][0] >= 999;
}

/**
 * The standard's findings for a rig in a view, and the pixels (the drawing's px) they're about, for the sheets to
 * show in red. See checkRigView for the rules; the seat SURFACE ones:
 *   (a) floating bust: seen from behind, a sitter's visible pixels reach down to their seat — below their lowest
 *       visible pixel, over their hips, only backrest frame (the front layer that isn't seat surface) may show,
 *       never more than 3 px of the seat's surface or nothing;
 *   (b) seat over their hips: the seat's surface is never drawn over a sitter's hips (their hip columns);
 *   (c) seen from the front, a sitter's thighs lie on the seat's surface: the underside of the near thigh, from the
 *       hip halfway to the knee, runs over the surface — not above its far edge, not below its near edge.
 */
export function rigFindings(v: RigView, rig: SeatRig, looks: AvatarLoadout[] = RIG_LOOKS): { problems: string[]; flagged: Array<[number, number]> } {
  const cushions = rigCushions(v.footprint, v.facing);
  const out = rigShapeProblems(rig, cushions.length);
  const flagged: Array<[number, number]> = [];
  if (out.length) return { problems: out, flagged };
  const { px, ax, ay } = v.art;
  const opaque = (x: number, y: number) => x >= 0 && y >= 0 && x < px.w && y < px.h && px.d[(y * px.w + x) * 4 + 3] > 0;
  rig.hips.forEach(([hx, hy], i) => {
    let n = 0;
    for (let y = Math.floor(hy) - 1; y <= Math.floor(hy) + 1; y++) for (let x = Math.floor(hx) - 1; x <= Math.floor(hx) + 1; x++) if (opaque(x, y)) n++;
    if (n < 5) out.push(`cushion ${i}: the hip point isn't on the drawing`);
    // where the hip lies at the cushion's height, in tiles from the footprint's back vertex
    const a = (hx - ax) / 32;
    const b = (hy - ay + 2 * v.seat) / 16;
    const X = (a + b) / 2;
    const Y = (b - a) / 2;
    const c = cushions[i];
    const M = 0.25;
    if (X < c.x - M || X > c.x + 1 + M || Y < c.y - M || Y > c.y + 1 + M) out.push(`cushion ${i}: the hip point is off its cushion (${X.toFixed(2)}, ${Y.toFixed(2)} for tile ${c.x}, ${c.y})`);
  });
  const behind = fromBehind(v.facing);
  const mask = frontMask(px.w, px.h, rig.front);
  let covers = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] && px.d[i * 4 + 3]) covers++;
  if (behind && v.backrest && !covers) out.push('seen from behind, its back faces the camera: the front layer is empty');
  if (!behind && v.arms && !covers) out.push('seen from the front, its near arm faces the camera: the front layer is empty');
  if (rig.front.length && !covers) out.push('the front polygons cover none of the drawing');
  const surface = rigSurface(v, rig);
  const onSurface = (x: number, y: number) => x >= 0 && y >= 0 && x < px.w && y < px.h && surface[y * px.w + x] === 1;
  const bed = behind ? surface : thighBed(surface, px.w, px.h);
  const onBed = (x: number, y: number) => x >= 0 && y >= 0 && x < px.w && y < px.h && bed[y * px.w + x] === 1;
  const OX = 100;
  const OY = 100;
  const size: [number, number] = [px.w + 200, px.h + 200];
  // every look on every cushion; each finding once per cushion, at its worst
  const worst = new Map<string, { n: number; text: (n: number) => string; bad: (n: number) => boolean; lo: boolean }>();
  const note = (key: string, n: number, lo: boolean, bad: (n: number) => boolean, text: (n: number) => string) => {
    const w = worst.get(key);
    if (!w) worst.set(key, { n, text, bad, lo });
    else w.n = lo ? Math.min(w.n, n) : Math.max(w.n, n);
  };
  const flag = new Set<string>();
  let stray = 0;
  for (let k = 0; k < looks.length; k++) {
    const sitters = seatedSitters(v, rig, looks, k);
    const c = composeRig(v.art, rig, sitters, { size, origin: [OX, OY], front: mask });
    stray = Math.max(stray, c.stray);
    const who = (x: number, y: number) => {
      const X = x + OX;
      const Y = y + OY;
      return X >= 0 && Y >= 0 && X < size[0] && Y < size[1] ? c.who[Y * size[0] + X] : 0;
    };
    c.sitters.forEach((s, i) => {
      // from behind, a back in front of someone hides what's behind it (never drawn over them): enough of the head
      // must show to read as a person seated there; from the front nearly all of the upper body must
      const want = behind ? (rig.tallBack ? 0 : 0.5) : 0.95;
      note(`${i} upper`, s.upper ? s.upperShown / s.upper : 1, true, (n) => n < want, (n) => `cushion ${i}: the seat hides their head, shoulders or upper back (${Math.round(n * 100)}% show)`);
      if (s.legs && rig.legs === 'show') note(`${i} legs`, s.legsShown / s.legs, true, (n) => n < 0.5, (n) => `cushion ${i}: their legs are lost (${Math.round(n * 100)}% show)`);
      // from behind and above, some of the legs shows past a low seat's sides or between a back's spindles: hiding them
      // is right while under half would show (the same line "lost" draws for showing them, so one of the two holds)
      if (s.legs && rig.legs === 'hide') note(`${i} legs`, s.legsShown / s.legs, false, (n) => n >= 0.5, (n) => `cushion ${i}: legs set to hide, but ${Math.round(n * 100)}% of them show`);
      note(`${i} holes`, s.holes, false, (n) => n > 0, (n) => `cushion ${i}: ${n} px of them see-through (the seat behind them or nothing shows)`);
      const fig = c.figures[i];
      const figAt = (x: number, y: number) => {
        const u = x + OX - fig.x0;
        const w = y + OY - fig.y0;
        return u >= 0 && w >= 0 && u < FIG.w && w < FIG.h && fig.px[(w * FIG.w + u) * 4 + 3] > 0;
      };
      const [hx, hy] = rigFeet(rig.hips[i], v.style).map((q, j) => (j ? q - FIG.feet + figSeatRow(poseDrop(sitters[i].pose)) : q));
      // (b) the seat's surface drawn over their hips
      let over = 0;
      for (let x = hx - 4; x <= hx + 4; x++)
        for (let y = hy - 22; y <= hy + 4; y++)
          if (figAt(x, y) && who(x, y) === 2 && onSurface(x, y)) {
            over++;
            flag.add(`${x},${y}`);
          }
      note(`${i} over`, over, false, (n) => n > 4, (n) => `cushion ${i}: the seat's surface is drawn over their hips (${n} px): only the backrest frame, the seat's back rim and the legs go over a sitter`);
      // (a) floating bust: seen from behind, what shows between their lowest visible pixel and their seat
      if (behind) {
        let floating = 0;
        let cols = 0;
        let worstGap = 0;
        for (let x = hx - 4; x <= hx + 4; x++) {
          let low = -1;
          for (let y = hy + 6; y >= hy - 45; y--)
            if (who(x, y) === 3 + i) {
              low = y;
              break;
            }
          if (low < 0) continue;
          cols++;
          let run = 0;
          let longest = 0;
          const gap: Array<[number, number]> = [];
          for (let y = low + 1; y <= hy; y++) {
            const w = who(x, y);
            // the seat's own pixels that aren't its top surface (backrest, frame, rim) cover their hips rightly
            const frame = (w === 1 || w === 2) && !onSurface(x, y);
            const mine = w === 3 + i;
            if (mine || frame) run = 0;
            else {
              run++;
              gap.push([x, y]);
              longest = Math.max(longest, run);
            }
          }
          if (longest > 3) {
            floating++;
            worstGap = Math.max(worstGap, longest);
            for (const [gx, gy] of gap) flag.add(`${gx},${gy}`);
          }
        }
        note(`${i} float`, cols && floating * 2 >= cols ? worstGap : 0, false, (n) => n > 3, (n) => `cushion ${i}: a floating bust: ${n} px of seat or nothing between their torso and the seat (from behind, only backrest frame may cover their hips)`);
      }
      // (c) seen from the front, the near thigh on the seat's surface
      if (!behind) {
        const F = frameFor('front', sitters[i].pose, looks[(k + i) % looks.length].body === 'body.b' ? 'b' : 'a');
        const mirrored = v.facing === 'sw';
        let off = 0;
        let n = 0;
        let above = 0;
        for (const t of [0.1, 0.25, 0.4, 0.55]) {
          const u = F.legNear.a[0] + (F.legNear.m[0] - F.legNear.a[0]) * t;
          const w = F.legNear.a[1] + (F.legNear.m[1] - F.legNear.a[1]) * t + FIG.thigh;
          const x = Math.floor(fig.x0 - OX + (mirrored ? FIG.w - u : u));
          const y = Math.round(fig.y0 - OY + w);
          let top = Infinity;
          let bottom = -Infinity;
          for (let yy = 0; yy < px.h; yy++)
            if (onBed(x, yy)) {
              top = Math.min(top, yy);
              bottom = Math.max(bottom, yy);
            }
          n++;
          if (y < top - 2 || y > bottom + 3) {
            off++;
            if (y < top - 2) above++;
            flag.add(`${x},${y}`);
            flag.add(`${x},${y - 1}`);
          }
        }
        note(`${i} thigh`, n ? off / n : 0, false, (q) => q > 0.4, (q) => `cushion ${i}: their thighs don't lie on the seat (${Math.round(q * 100)}% of the thigh ${above ? 'above' : 'below'} its surface)`);
      }
    });
  }
  for (const w of worst.values()) if (w.bad(w.n)) out.push(w.text(w.n));
  if (stray) out.push(`the seat is drawn over a sitter outside its front polygons (${stray} px)`);
  for (const k of flag) flagged.push(k.split(',').map(Number) as [number, number]);
  return { problems: [...new Set(out)], flagged };
}

/** A seat drawing as the game places it: pixels and its anchor (the footprint's back vertex). */
export interface RigArt {
  px: Pixels;
  ax: number;
  ay: number;
}

export interface RigSitter {
  look: AvatarLoadout;
  facing: Facing;
  pose: Pose;
  /** The figure's anchor (its feet) in the drawing's px, whole px. */
  feet: readonly [number, number];
  /** Back-to-front order (the cushion's x + y): the game draws the farther sitter first. */
  depth: number;
}

export interface SitterStats {
  /** Leg and shoe pixels of the figure, and how many of them show in the end. */
  legs: number;
  legsShown: number;
  /** The head, shoulders and upper back (every figure row above its upper back), and how much shows. */
  upper: number;
  upperShown: number;
  /** Rows of the figure (drawing px) where the upper body ends and where the seat point is. */
  upperEnd: number;
  seatRow: number;
  /** Pixels of their silhouette that end up see-through: the seat drawn behind them, or nothing. */
  holes: number;
}

export interface RigComposition {
  cell: Pixels;
  /** Each sitter's figure as placed (its top-left in the cell) with its pixels, in the order given. */
  figures: Array<{ x0: number; y0: number; px: Uint8ClampedArray }>;
  /** Per cell pixel: 0 nothing, 1 the seat, 2 the seat's front layer, 3 + k sitter k (in the order given). */
  who: Uint8Array;
  sitters: SitterStats[];
  /** Seat pixels drawn over a sitter outside the front polygons (never, by construction: the check keeps it so). */
  stray: number;
}

const figures = new Map<string, { px: Uint8ClampedArray; owner: Uint8Array }>();
function figure(look: AvatarLoadout, facing: Facing, pose: Pose) {
  const key = `${JSON.stringify(look)}|${facing}|${pose}`;
  let f = figures.get(key);
  if (!f) {
    f = renderAvatarLayers(look, facing, pose);
    figures.set(key, f);
    if (figures.size > 400) figures.clear();
  }
  return f;
}

const LEGS = new Set<number>([LAYER.legs, LAYER.shoes]);

/**
 * Compose a seat and its sitters into a cell `size` px square (or [w, h]), the drawing's (0, 0) at `origin`.
 * Sitters are drawn back to front by `depth`, each followed by the front layer, as the renderer does it.
 */
export function composeRig(art: RigArt, rig: SeatRig, sitters: RigSitter[], opts: { size: number | [number, number]; origin: [number, number]; front?: Uint8Array }): RigComposition {
  const [W, H] = typeof opts.size === 'number' ? [opts.size, opts.size] : opts.size;
  const [OX, OY] = opts.origin;
  const cell: Pixels = { w: W, h: H, d: new Uint8ClampedArray(W * H * 4) };
  const who = new Uint8Array(W * H);
  const { px } = art;
  const put = (X: number, Y: number, src: ArrayLike<number>, i: number, tag: number) => {
    if (X < 0 || Y < 0 || X >= W || Y >= H) return;
    const o = (Y * W + X) * 4;
    cell.d[o] = src[i];
    cell.d[o + 1] = src[i + 1];
    cell.d[o + 2] = src[i + 2];
    cell.d[o + 3] = 255;
    who[Y * W + X] = tag;
  };
  for (let y = 0; y < px.h; y++)
    for (let x = 0; x < px.w; x++) {
      const i = (y * px.w + x) * 4;
      if (px.d[i + 3]) put(OX + x, OY + y, px.d, i, 1);
    }
  // the front layer, split by cover (a region's own, else the rig's); the union for the checks
  const layers = frontLayers(px.w, px.h, rig);
  const mask = opts.front ?? frontMask(px.w, px.h, rig.front);
  const order = sitters.map((s, k) => ({ s, k })).sort((a, b) => a.s.depth - b.s.depth);
  // for each capped layer: every sitter's pixels above its cover, which that layer may not reach
  const keptFor = (cover: number) => {
    const kept = new Uint8Array(px.w * px.h);
    for (const s of sitters) {
      const f = figure(s.look, s.facing, s.pose);
      const x0 = s.feet[0] - figAx(s.facing);
      const y0 = s.feet[1] - FIG.feet;
      const top = coverRow(s.pose, cover);
      for (let y = 0; y < Math.min(FIG.h, top); y++)
        for (let x = 0; x < FIG.w; x++) {
          const X = x0 + x;
          const Y = y0 + y;
          if (f.px[(y * FIG.w + x) * 4 + 3] && X >= 0 && Y >= 0 && X < px.w && Y < px.h) kept[Y * px.w + X] = 1;
        }
    }
    return kept;
  };
  const kepts = layers.map((l) => (l.cover === undefined ? null : keptFor(l.cover)));
  const stats: SitterStats[] = sitters.map((s) => {
    const drop = poseDrop(s.pose);
    // the head, the shoulders and the top of the back: every row down to 5 px under the shoulder line
    return { legs: 0, legsShown: 0, upper: 0, upperShown: 0, upperEnd: 58 + drop + 5, seatRow: figSeatRow(drop), holes: 0 };
  });
  const placed: Array<{ k: number; x0: number; y0: number; f: ReturnType<typeof figure> }> = [];
  for (const { s, k } of order) {
    const f = figure(s.look, s.facing, s.pose);
    const x0 = s.feet[0] - figAx(s.facing);
    const y0 = s.feet[1] - FIG.feet;
    // the whole figure, always: a seat hides what it hides by drawing over it, never by cutting the person
    for (let y = 0; y < FIG.h; y++)
      for (let x = 0; x < FIG.w; x++) {
        const i = (y * FIG.w + x) * 4;
        if (f.px[i + 3]) put(OX + x0 + x, OY + y0 + y, f.px, i, 3 + k);
      }
    placed.push({ k, x0, y0, f });
    // seen from the front, someone still standing on the seat's tile (before they crouch to sit) isn't covered
    if (!fromBehind(s.facing) && !coveredPose(s.pose)) continue;
    // the front layer, over everyone so far, each layer off every sitter's upper body above its cover
    layers.forEach((l, li) => {
      const kept = kepts[li];
      for (let y = 0; y < px.h; y++)
        for (let x = 0; x < px.w; x++) {
          if (!l.mask[y * px.w + x]) continue;
          const i = (y * px.w + x) * 4;
          if (!px.d[i + 3]) continue;
          if (kept && kept[y * px.w + x]) continue;
          put(OX + x, OY + y, px.d, i, 2);
        }
    });
  }
  // what of each sitter the seat leaves showing (another sitter in front doesn't count against it)
  let stray = 0;
  const onSitter = new Uint8Array(W * H);
  for (const { k, x0, y0, f } of placed) {
    const st = stats[k];
    for (let y = 0; y < FIG.h; y++)
      for (let x = 0; x < FIG.w; x++) {
        const j = y * FIG.w + x;
        if (!f.px[j * 4 + 3]) continue;
        const X = OX + x0 + x;
        const Y = OY + y0 + y;
        if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
        const w = who[Y * W + X];
        const shown = w !== 2;
        onSitter[Y * W + X] = 1;
        if (w < 2) st.holes++;
        if (LEGS.has(f.owner[j])) {
          st.legs++;
          if (shown) st.legsShown++;
        }
        if (y < st.upperEnd) {
          st.upper++;
          if (shown) st.upperShown++;
        }
      }
  }
  for (let Y = 0; Y < H; Y++)
    for (let X = 0; X < W; X++) {
      if (who[Y * W + X] !== 2 || !onSitter[Y * W + X]) continue;
      const x = X - OX;
      const y = Y - OY;
      if (x < 0 || y < 0 || x >= px.w || y >= px.h || !mask[y * px.w + x]) stray++;
    }
  const figures = sitters.map((_, k) => {
    const p = placed.find((q) => q.k === k)!;
    return { x0: OX + p.x0, y0: OY + p.y0, px: p.f.px };
  });
  return { cell, who, sitters: stats, stray, figures };
}
