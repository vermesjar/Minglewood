/**
 * A draft seat's drawings as the game draws them, for the Design Lab's seat model (ModelPanel.tsx): which drawing
 * each facing uses (its own, its partner's mirrored, or the one drawing), mirrored where it is, and anchored where the
 * game anchors it (a small piece centred on its footprint). The seat's model is fitted, checked and previewed on
 * exactly these pixels, so what the Lab passes is what the game (sprites/seatLayers.ts) draws.
 */
import type { Facing } from '@shared/world/scene';
import { MODEL_FACINGS } from '@shared/world/seatModels';
import { centredAnchor, type Pixels } from '../engine/sprites/footing';
import { lab, type Draft } from './api';
import { loadImg, MIRROR } from './pixels';

/** A drawing and its anchor (the footprint's back vertex), as it will be published. */
export interface Drawing {
  px: Pixels;
  anchor: [number, number];
}
/** A seat's drawings: one per drawn facing, or a single one ('one'). */
export type Drawings = Partial<Record<Facing | 'one', Drawing>>;

/** A drawing placed as the game draws it: its pixels (mirrored where it is) and its anchor in them. */
export interface SeatArt {
  px: Pixels;
  ax: number;
  ay: number;
}

/** An image's RGBA pixels. */
export async function pixelsOf(url: string): Promise<Pixels> {
  const img = await loadImg(url);
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  return { w: img.width, h: img.height, d: g.getImageData(0, 0, img.width, img.height).data };
}

/** Which drawings (and where they stand) a model was made on: any change and it's checked again. */
export function drawingsSignature(d: Draft): string {
  return JSON.stringify(
    Object.entries(d.views)
      .filter(([, v]) => v.file)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, v.file, v.anchor, v.nudge ?? [0, 0]]),
  );
}

/** Every drawing of a draft, with its anchor as it will be published (the drawn anchor plus its nudge). */
export async function loadDrawings(d: Draft): Promise<Drawings> {
  const out: Drawings = {};
  for (const [name, v] of Object.entries(d.views)) {
    if (!v.file) continue;
    const px = await pixelsOf(lab.fileUrl(d.id, v.file, String(v.take)));
    out[name as keyof Drawings] = { px, anchor: [(v.anchor?.[0] ?? 0) + (v.nudge?.[0] ?? 0), (v.anchor?.[1] ?? 0) + (v.nudge?.[1] ?? 0)] };
  }
  return out;
}

export function mirrorPixels(p: Pixels): Pixels {
  const d = new Uint8ClampedArray(p.d.length);
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      const s = (y * p.w + x) * 4;
      const t = (y * p.w + (p.w - 1 - x)) * 4;
      for (let k = 0; k < 4; k++) d[t + k] = p.d[s + k];
    }
  return { w: p.w, h: p.h, d };
}

/** A seat's placement in a facing: its footprint as placed (a long seat runs across the way it faces). */
function placement(footprint: readonly [number, number], f: Facing): { w: number; d: number } {
  const long = Math.max(...footprint);
  const across = f === 'ne' || f === 'sw';
  return { w: across ? long : Math.min(...footprint), d: across ? Math.min(...footprint) : long };
}

/**
 * The drawing the game uses for a seat facing `f` (art.ts; scripts/lib/seats.ts viewArt): its own, else its partner's
 * mirrored, else the one drawing (mirrored when a long piece turns); a small seat is centred on its footprint.
 */
export function seatArt(drawings: Drawings, footprint: readonly [number, number], f: Facing): { art: SeatArt; mirrored: boolean; drawn: Facing } | null {
  const { w, d } = placement(footprint, f);
  let rec = drawings.one;
  let mirror = !!rec && footprint[0] !== footprint[1] && w === footprint[1] && d === footprint[0];
  let drawn = f;
  if (!rec) {
    rec = drawings[f];
    if (!rec && drawings[MIRROR[f]]) {
      rec = drawings[MIRROR[f]];
      mirror = true;
      drawn = MIRROR[f];
    }
    if (!rec) {
      const first = MODEL_FACINGS.find((g) => drawings[g]);
      if (!first) return null;
      rec = drawings[first];
      drawn = first;
    }
  }
  const px = mirror ? mirrorPixels(rec!.px) : rec!.px;
  const c = centredAnchor(px, w, d, 2);
  const [x, ay] = c ?? rec!.anchor;
  // mirroring swaps the footprint's axes; its back vertex stays the top vertex, reflected
  const ax = !c && mirror ? px.w - x : x;
  return { art: { px, ax, ay }, mirrored: mirror, drawn };
}
