/**
 * Avatar QA — the character standard and its checker.
 *
 * Like the figure systems of classic social games, every avatar is one fixed template (the frame: head,
 * torso and limbs per view and pose) with parts layered on as add-ons. The STANDARD says, per view and pose,
 * which template zones a part must cover and which it must leave alone:
 *
 *   scalp     the skull every hairstyle covers (above the hairline in front; the whole back of the head
 *             down to the nape behind). Hair — or a hat that hides hair — must cover all of it.
 *   features  eyes and mouth (front). Nothing but eyewear may cover them.
 *   head      the head silhouette; holes inside the head region are never allowed.
 *
 * The kit records which layer painted each pixel (Pix.owner), so the checks are exact: "is a scalp pixel
 * still painted by the bare head?" rather than guessing from colours. Used by the review CLI
 * (scripts/avatar-review.ts) and by the roster / random-look tests.
 */
import type { AvatarLoadout } from '@shared/domain/types';
import type { Facing } from '@shared/world/scene';
import { ITEM_BY_ID, normalizeLoadout } from '@shared/avatar';
import { LAYER, drawAvatarV2, headMaskOf } from './avatarKit';
import { frameFor, type Frame, type Pose } from './avatarFrame';
import { H, M, W, type Mask } from './pixkit';

export const FACINGS: Facing[] = ['se', 'sw', 'ne', 'nw'];
export const POSES: Pose[] = ['stand', 'walk1', 'walk2', 'sit', 'wave', 'work'];

export interface Rendered {
  /** RGBA, W × H, exactly what the game blits. */
  px: Uint8ClampedArray;
  /** Layer id per pixel (LAYER). */
  owner: Uint8Array;
}

/** A look rendered as the game does it (kit + mirroring for sw/nw), with its layer map. */
export function renderAvatarLayers(look: AvatarLoadout, facing: Facing, pose: Pose): Rendered {
  const view = facing === 'se' || facing === 'sw' ? 'front' : 'back';
  const P = drawAvatarV2(look, view, pose);
  if (facing === 'se' || facing === 'ne') return { px: P.d, owner: P.owner };
  const px = new Uint8ClampedArray(P.d.length);
  const owner = new Uint8Array(P.owner.length);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const s = y * W + x;
      const d = y * W + (W - 1 - x);
      owner[d] = P.owner[s];
      for (let k = 0; k < 4; k++) px[d * 4 + k] = P.d[s * 4 + k];
    }
  return { px, owner };
}

export function renderAvatar(look: AvatarLoadout, facing: Facing, pose: Pose): Uint8ClampedArray {
  return renderAvatarLayers(look, facing, pose).px;
}

/* ------------------------------------------------------------------ the standard */

export interface Zones {
  head: Mask;
  scalp: Mask;
  features: Mask;
  /** Chest: what any top must cover (below the shoulders, above the waist). */
  chest: Mask;
  /** The waist seam between top and bottoms: never see-through. */
  waist: Mask;
  /** Feet: what any shoes must cover. */
  feet: Mask;
}

/** The standard's zones for a frame (stand-pose coordinates shift with the frame). */
export function zonesFor(F: Frame): Zones {
  const head = headMaskOf(F);
  const [x0, y0] = F.head;
  const scalp = M();
  const scalpRows = F.view === 'front' ? 6 : 15;
  for (let y = y0; y < y0 + scalpRows; y++)
    for (let x = x0; x < x0 + 22; x++) {
      if (F.view === 'back' && x >= x0 + 20) continue; // the ear stays clear
      if (head.has(x, y) && head.has(x, y - 1) && head.has(x - 1, y) && head.has(x + 1, y)) scalp.rect(x, y, x + 1, y + 1);
    }
  const features = M();
  if (F.view === 'front') {
    const [nx, ny] = F.eyeNear;
    const [fx] = F.eyeFar;
    const [mx, my] = F.mouth;
    features.rect(nx - 1, ny - 1, fx + 2, ny + 2);
    features.rect(mx - 2, my, mx + 3, my + 2);
  }
  // body: the frame's own torso outline, inset one pixel (its edge belongs to the outline)
  const torso = M().poly(F.torso);
  const chest = M();
  for (let y = F.shoulderY + 3; y < F.waistY - 1; y++)
    for (let x = 0; x < W; x++)
      if (torso.has(x, y) && torso.has(x - 1, y) && torso.has(x + 1, y) && torso.has(x, y - 1) && torso.has(x, y + 1)) chest.rect(x, y, x + 1, y + 1);
  const waist = M();
  for (let y = F.waistY - 1; y <= F.waistY + 1; y++) for (let x = F.hx - 6; x <= F.hx + 6; x++) waist.rect(x, y, x + 1, y + 1);
  const feet = M();
  for (const leg of [F.legNear, F.legFar]) {
    const [ax, ay] = leg.b;
    feet.rect(ax - 1, ay + 1, ax + 2, ay + 3);
  }
  return { head, scalp, features, chest, waist, feet };
}

/* ------------------------------------------------------------------ the checker */

export interface Issue {
  kind: 'bald' | 'face-covered' | 'head-hole' | 'speck' | 'torso-gap' | 'waist-gap' | 'bare-feet';
  detail: string;
}

const HAIRISH: number[] = [LAYER.hair, LAYER.hat];

/** Check one rendered frame against the standard. */
export function lintAvatar(look: AvatarLoadout, facing: Facing, pose: Pose, r = renderAvatarLayers(look, facing, pose)): Issue[] {
  const L = normalizeLoadout(look);
  const view = facing === 'se' || facing === 'sw' ? 'front' : 'back';
  const mirrored = facing === 'sw' || facing === 'nw';
  // the same frame the kit draws with (a wheelchair user waves from the sitting frame)
  const F = frameFor(view, L.mobility === 'mob.wheelchair' ? 'sit' : pose);
  const Z = zonesFor(F);
  const at = (x: number, y: number) => (y * W + (mirrored ? W - 1 - x : x)) as number;
  const issues: Issue[] = [];
  const hat = ITEM_BY_ID.get(L.headwear);
  const covered = L.hair !== 'hair.none' || !!hat?.coversHair;

  const count = (m: Mask, pred: (owner: number) => boolean) => {
    let n = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (m.has(x, y) && pred(r.owner[at(x, y)])) n++;
    return n;
  };
  if (covered) {
    const bare = count(Z.scalp, (o) => o === LAYER.head);
    if (bare > 1) issues.push({ kind: 'bald', detail: `${bare} scalp px uncovered` });
  }
  if (view === 'front') {
    const over = count(Z.features, (o) => HAIRISH.includes(o));
    if (over > 0) issues.push({ kind: 'face-covered', detail: `${over} eye/mouth px under hair or hat` });
  }
  // holes: see-through pixels enclosed by the figure, within the head region
  const solid = (i: number) => r.px[i * 4 + 3] > 0;
  const outside = new Uint8Array(W * H);
  const stack: number[] = [];
  for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
  while (stack.length) {
    const i = stack.pop()!;
    if (outside[i] || solid(i)) continue;
    outside[i] = 1;
    const x = i % W;
    const y = (i / W) | 0;
    if (x > 0) stack.push(i - 1);
    if (x < W - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - W);
    if (y < H - 1) stack.push(i + W);
  }
  // body: tops cover the chest, nothing shows through at the waist, shoes cover the feet
  const chestGap = count(Z.chest, (o) => o === LAYER.none || o === LAYER.armBack || (o === LAYER.legs && !F.sitting));
  if (chestGap > 0) issues.push({ kind: 'torso-gap', detail: `${chestGap} chest px not covered by the top` });
  const waistGap = count(Z.waist, (o) => o === LAYER.none || o === LAYER.armBack);
  if (waistGap > 0) issues.push({ kind: 'waist-gap', detail: `${waistGap} see-through px at the waist` });
  if (L.shoes !== 'shoes.none' && L.mobility !== 'mob.wheelchair') {
    // bare = leg (skin / trouser) or nothing where a shoe belongs; hair or a held thing hiding the feet is fine
    const bare = count(Z.feet, (o) => o === LAYER.legs || o === LAYER.none);
    if (bare > 2) issues.push({ kind: 'bare-feet', detail: `${bare} foot px not covered by shoes` });
  }

  // Enclosed see-through pockets in the head region. A waving arm really does frame open air beside the
  // head; that gap is fine when it is a gap (more than a crack), so pockets it frames are only flagged when
  // small enough to read as a crack.
  const [hx0, hy0, hx1, hy1] = F.head;
  const seen = new Uint8Array(W * H);
  let holes = 0;
  for (let y = hy0 - 6; y <= hy1 + 2; y++)
    for (let x = hx0 - 6; x <= hx1 + 6; x++) {
      if (y < 0 || y >= H || x < 0 || x >= W) continue;
      const s0 = at(x, y);
      if (solid(s0) || outside[s0] || seen[s0]) continue;
      const pocket: number[] = [];
      const q = [s0];
      seen[s0] = 1;
      let byArm = false;
      while (q.length) {
        const i = q.pop()!;
        pocket.push(i);
        const px = i % W;
        for (const j of [px > 0 ? i - 1 : -1, px < W - 1 ? i + 1 : -1, i - W, i + W]) {
          if (j < 0 || j >= W * H) continue;
          if (solid(j)) {
            // the arm's own edge is drawn by the outline pass, so look one pixel further for the arm itself
            const nearArm = (k: number) => r.owner[k] === LAYER.armFront || r.owner[k] === LAYER.armBack || r.owner[k] === LAYER.held;
            if (nearArm(j) || (r.owner[j] === LAYER.outline && [j - 1, j + 1, j - W, j + W].some((k) => k >= 0 && k < W * H && nearArm(k))))
              byArm = true;
          } else if (!seen[j] && !outside[j]) {
            seen[j] = 1;
            q.push(j);
          }
        }
      }
      // open air framed by a waving arm or a held umbrella / balloon string is a real gap, not a crack
      if (byArm && pocket.length > 8) continue;
      holes += pocket.length;
    }
  if (holes > 0) issues.push({ kind: 'head-hole', detail: `${holes} see-through px in the head` });
  // specks: small pieces not attached to the figure
  const comp = new Int32Array(W * H).fill(-1);
  const sizes: number[] = [];
  for (let s = 0; s < W * H; s++) {
    if (!solid(s) || comp[s] >= 0) continue;
    const id = sizes.length;
    let n = 0;
    const q = [s];
    comp[s] = id;
    while (q.length) {
      const i = q.pop()!;
      n++;
      const x = i % W;
      const y = (i / W) | 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const X = x + dx;
          const Y = y + dy;
          if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
          const j = Y * W + X;
          if (solid(j) && comp[j] < 0) {
            comp[j] = id;
            q.push(j);
          }
        }
    }
    sizes.push(n);
  }
  const specks = sizes.filter((n) => n < 12);
  if (specks.length) issues.push({ kind: 'speck', detail: `${specks.length} detached bit(s): ${specks.join(', ')} px` });
  return issues;
}
