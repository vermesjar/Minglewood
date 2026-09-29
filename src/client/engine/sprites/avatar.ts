/**
 * Avatar sprites for the world and the UI. Drawing lives in the avatar kit (avatarKit.ts): a character
 * frame (avatarFrame.ts), a base body, and parts layered on top — generated hairstyles, garments and hats
 * that sit on the frame's anchors, plus code-drawn limbs, faces and accessories.
 *
 * The kit draws two views facing screen-right: "front" (3/4 front, facing se) and "back" (3/4 back, facing
 * ne); sw and nw are their mirrors.
 */
import type { AvatarLoadout } from '@shared/domain/types';
import type { Facing } from '@shared/world/scene';
import { normalizeLoadout, type FullLoadout } from '@shared/avatar';
import { makeCanvas, type Sprite } from './painter';
import { drawAvatarV2, type Expression } from './avatarKit';
import type { Pose } from './avatarFrame';
import { H, W } from './pixkit';

export type { Pose } from './avatarFrame';

/** Canvas pixels per art pixel. */
export const AVATAR_DENSITY = 2;
/** The feet, in canvas pixels. */
export const AVATAR_ANCHOR = { x: 45, y: 104 };

/** Crop rectangles (canvas px) for UI previews. */
export const AVATAR_CROPS = {
  head: { x: 27, y: 26, w: 38, h: 36 },
  // the face itself (brows to chin), for the wardrobe's face tiles shown at 2×
  face: { x: 35, y: 41, w: 22, h: 18 },
  bust: { x: 24, y: 26, w: 44, h: 50 },
  torso: { x: 26, y: 54, w: 40, h: 30 },
  legs: { x: 26, y: 74, w: 40, h: 32 },
  /** The person without the extra padding (pets and umbrellas may be clipped). */
  body: { x: 18, y: 20, w: 56, h: 88 },
  full: { x: 0, y: 0, w: W, h: H },
};

export type { Expression } from './avatarKit';

export function drawAvatarCanvas(input: AvatarLoadout, facing: Facing, pose: Pose, expr?: Expression): HTMLCanvasElement {
  const view = facing === 'se' || facing === 'sw' ? 'front' : 'back';
  const P = drawAvatarV2(input, view, pose, expr);
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const img = ctx.createImageData(W, H);
  img.data.set(P.d);
  ctx.putImageData(img, 0, 0);
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

const cache = new Map<string, Sprite>();

export function avatarKey(L: AvatarLoadout): string {
  const n = normalizeLoadout(L);
  return Object.keys(n)
    .sort()
    .map((k) => n[k as keyof FullLoadout])
    .join('|');
}

/**
 * The sprite for a look, facing and pose. `expr` is a momentary expression the world can flash on top: a
 * blink every few seconds when idle, the mouth moving while a speech bubble is up.
 */
export function avatarSprite(L: AvatarLoadout, facing: Facing, pose: Pose, expr?: Expression): Sprite {
  const key = `${avatarKey(L)}|${facing}|${pose}|${expr ?? ''}`;
  let s = cache.get(key);
  if (!s) {
    const canvas = drawAvatarCanvas(L, facing, pose, expr);
    const data = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
    const mask = new Uint8Array(W * H);
    for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3] ? 1 : 0;
    const ax = facing === 'sw' || facing === 'nw' ? W - AVATAR_ANCHOR.x : AVATAR_ANCHOR.x;
    s = { canvas, ax, ay: AVATAR_ANCHOR.y, mask, scale: AVATAR_DENSITY };
    cache.set(key, s);
    if (cache.size > 3000) cache.clear();
  }
  return s;
}

export function usesWheelchair(L: AvatarLoadout): boolean {
  return L.mobility === 'mob.wheelchair';
}
