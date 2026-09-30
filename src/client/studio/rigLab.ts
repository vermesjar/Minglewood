/**
 * Rigging a seat in the Design Lab (the seat rig standard, src/shared/world/seatRigs.ts), made a confirm-and-nudge
 * job: the drawing is split into its natural pieces, a proposal says which pieces sit in front of a seated person
 * and where each cushion's hips go (a vision model's answer, checked against today's inference), and you fix it a
 * click at a time. Pure: pixels in, pieces, masks and rigs out (RigPanel.tsx draws and edits them).
 */
import type { Facing } from '@shared/world/scene';
import { frontMask, regionPts, rigForView, RIG_FACINGS, type FrontRegion, type Pt, type SeatRig } from '@shared/world/seatRigs';
import { seatProfile, type SeatProfile } from '@shared/world/seats';
import type { Pixels } from '../engine/sprites/footing';
import { maskToPolys } from '../engine/sprites/rigTrace';
import { checkRigView, inferRig, wrapsSitter, type RigView } from '../engine/sprites/seatRig';
import { seatArt, type Drawings } from './seatLab';

/** What a draft keeps of its rig (devLab.ts cleanSeatRig): each own view's rig, the ticks, the proposals, the cuts. */
export interface DraftRig {
  /** Each view with a drawing of its own (a mirrored view derives from its partner). */
  views: Partial<Record<Facing, SeatRig>>;
  /** Per facing, all four: the day someone ticked "looks right" (a mirrored view has its own tick). */
  ok: Partial<Record<Facing, string>>;
  /** Where each own view's rig came from, and where the model and the inference disagreed. */
  proposal?: Partial<Record<Facing, { by: 'model' | 'inference'; at: string; disagree?: string[]; usd?: number; notes?: string }>>;
  /** Splits made to the pieces of each own view: [x, y, 'h' | 'v'] through that pixel. */
  cuts?: Partial<Record<Facing, Array<[number, number, 'h' | 'v']>>>;
  /** The drawings it was made on (SeatPanel drawingsSignature): any change and it's stale. */
  for: string;
}

/* ------------------------------------------------------------------ pieces (engine/sprites/pieces.ts) */

export { segment, type Pieces } from '../engine/sprites/pieces';
import type { Pieces } from '../engine/sprites/pieces';

/** The pieces mostly (by at least half their pixels) inside a mask. */
export function piecesIn(p: Pieces, mask: ArrayLike<number>): Set<number> {
  const inside = new Array<number>(p.n + 1).fill(0);
  for (let i = 0; i < p.labels.length; i++) if (p.labels[i] && mask[i]) inside[p.labels[i]]++;
  const out = new Set<number>();
  for (let k = 1; k <= p.n; k++) if (inside[k] * 2 >= p.size[k]) out.add(k);
  return out;
}

/** A mask of whole pieces. */
export function maskOf(p: Pieces, ids: Iterable<number>): Uint8Array {
  const set = new Set(ids);
  const m = new Uint8Array(p.labels.length);
  for (let i = 0; i < m.length; i++) if (set.has(p.labels[i])) m[i] = 1;
  return m;
}

/** The rig's front layer as a mask over its drawing, and a mask as the rig's (exact) front polygons. */
export const rigMask = (rig: SeatRig, px: Pixels) => frontMask(px.w, px.h, rig.front);
export const maskFront = (m: ArrayLike<number>, px: Pixels): Pt[][] => maskToPolys(m, px.w, px.h);

/* ------------------------------------------------------------------ per-region covers */

/** Where a front pixel's cover comes from: the rig's (a plain polygon), or a region's own (null: no cap). */
export type RegionCover = 'rig' | number | null;
const regionSource = (g: FrontRegion): RegionCover => (Array.isArray(g) || g.cover === undefined ? 'rig' : g.cover);
const capOf = (c: number | null | undefined) => (c === null || c === undefined ? Infinity : c);

/**
 * Each front pixel's cover source, as the renderer resolves it (seatRigs.ts frontLayers: the most generous region
 * wins; on a tie, the rig's own cover, so it keeps following the rig's knob). Undefined off the front layer.
 */
export function coverSources(rig: SeatRig, px: Pixels): Array<RegionCover | undefined> {
  const n = px.w * px.h;
  const best = new Float64Array(n).fill(-1);
  const src = new Array<RegionCover | undefined>(n);
  for (const g of rig.front) {
    const s = regionSource(g);
    const v = s === 'rig' ? capOf(rig.cover) : capOf(s);
    const m = frontMask(px.w, px.h, [regionPts(g)]);
    for (let i = 0; i < n; i++)
      if (m[i] && (v > best[i] || (v === best[i] && s === 'rig'))) {
        best[i] = v;
        src[i] = s;
      }
  }
  return src;
}

/** The covers of a rig's own-cover regions, each once (numbers low to high, then no cap). */
export function ownCovers(rig: SeatRig): Array<number | null> {
  const set = new Set<number | null>();
  for (const g of rig.front) {
    const s = regionSource(g);
    if (s !== 'rig') set.add(s);
  }
  return [...set].sort((a, b) => capOf(a) - capOf(b));
}

/**
 * A new front layer from an edited mask, keeping each pixel's cover: pixels already in front keep their source
 * (a region's own cover stays that region's), new ones take the rig's; `give` re-sources the pixels of its mask.
 * Plain polygons for the rig's cover, {"pts", "cover"} regions for the others.
 */
export function editFront(rig: SeatRig, px: Pixels, next: ArrayLike<number>, give?: { mask: ArrayLike<number>; to: RegionCover }): FrontRegion[] {
  const src = coverSources(rig, px);
  const groups = new Map<RegionCover, Uint8Array>();
  for (let i = 0; i < next.length; i++) {
    if (!next[i]) continue;
    const s = give?.mask[i] ? give.to : (src[i] === undefined ? 'rig' : (src[i] as RegionCover));
    let m = groups.get(s);
    if (!m) groups.set(s, (m = new Uint8Array(px.w * px.h)));
    m[i] = 1;
  }
  const order = [...groups.keys()].sort((a, b) => (a === 'rig' ? -1 : b === 'rig' ? 1 : capOf(a) - capOf(b)));
  return order.flatMap((s) => maskFront(groups.get(s)!, px).map((pts): FrontRegion => (s === 'rig' ? pts : { pts, cover: s })));
}

/** Every region of one source moved to another (its cover changed; 'rig' makes them plain polygons again). */
export function recoverRegions(rig: SeatRig, from: RegionCover, to: RegionCover): FrontRegion[] {
  return rig.front.map((g) => (regionSource(g) !== from ? g : to === 'rig' ? regionPts(g) : { pts: regionPts(g), cover: to }));
}

/* ------------------------------------------------------------------ views */

export interface LabView extends RigView {
  /** Drawn as its partner mirrored: its rig is the partner's, mirrored. */
  mirrored: boolean;
}

/** Every facing of a draft seat as the game will draw it, with the seat's profile. */
export function labViews(drawings: Drawings, footprint: readonly [number, number], p: SeatProfile): Partial<Record<Facing, LabView>> {
  const out: Partial<Record<Facing, LabView>> = {};
  for (const f of RIG_FACINGS) {
    const r = seatArt(drawings, footprint, f);
    const wraps = (f === 'ne' || f === 'nw') && wrapsSitter(p.backLine?.[(r?.drawn ?? f) as 'ne' | 'nw']);
    if (r) out[f] = { art: r.art, facing: f, footprint, style: p.sitStyle, seat: p.seat, backrest: p.backrest, arms: !!p.arms, wraps, mirrored: r.mirrored };
  }
  return out;
}

/** The facings that need a rig of their own (their drawing isn't a partner's mirrored). */
export const ownFacings = (views: Partial<Record<Facing, LabView>>): Facing[] => RIG_FACINGS.filter((f) => views[f] && !views[f]!.mirrored);

/** The rig each facing is drawn with: its own, else its partner's mirrored. */
export function rigOf(key: string, rig: DraftRig | null | undefined, views: Partial<Record<Facing, LabView>>, f: Facing): SeatRig | null {
  const v = views[f];
  if (!v || !rig) return null;
  return rigForView({ [key]: rig.views }, key, f, { mirrored: v.mirrored, width: v.art.px.w })?.rig ?? null;
}

/**
 * A draft seat's profile: its calibration's values (or, opened from the catalog and not calibrated here, the catalog's
 * own; and the hand-set height) over its family's defaults.
 */
export function labProfile(
  key: string,
  f: { seat: number | null; sitStyle: SeatProfile['sitStyle']; backrest: boolean; arms?: boolean; seatCalibration?: { profile?: Partial<SeatProfile> } | null; catalogProfile?: Partial<SeatProfile> | null },
): SeatProfile {
  const c = f.seatCalibration?.profile ?? f.catalogProfile ?? undefined;
  return seatProfile(key.split('.')[0], { seat: c?.seat ?? f.seat ?? undefined, seatDepth: c?.seatDepth, backDepth: c?.backDepth, backLine: c?.backLine, sitStyle: f.sitStyle, backrest: f.backrest, arms: f.arms });
}

/** The inference's proposal for an own view, snapped to whole pieces. */
export function inferredProposal(v: LabView, p: SeatProfile, pieces: Pieces): { rig: SeatRig; ids: Set<number> } {
  const { rig, mask } = inferRig(v, p, v.mirrored);
  const ids = piecesIn(pieces, mask);
  return { rig: { ...rig, front: maskFront(maskOf(pieces, ids), v.art.px) }, ids };
}

/**
 * Where a model's proposal and the inference disagree, in words: pieces one puts in front and the other doesn't,
 * hips more than 8 px apart.
 */
export function disagreements(model: { ids: Set<number>; hips: Pt[] }, inferred: { ids: Set<number>; hips: Pt[] }): string[] {
  const out: string[] = [];
  const onlyModel = [...model.ids].filter((k) => !inferred.ids.has(k));
  const onlyInferred = [...inferred.ids].filter((k) => !model.ids.has(k));
  if (onlyModel.length) out.push(`only the model puts piece${onlyModel.length > 1 ? 's' : ''} ${onlyModel.join(', ')} in front`);
  if (onlyInferred.length) out.push(`only the inference puts piece${onlyInferred.length > 1 ? 's' : ''} ${onlyInferred.join(', ')} in front`);
  model.hips.forEach((h, i) => {
    const g = inferred.hips[i];
    if (g && Math.hypot(h[0] - g[0], h[1] - g[1]) > 8) out.push(`cushion ${i}: the hips are ${Math.round(Math.hypot(h[0] - g[0], h[1] - g[1]))} px apart`);
  });
  return out;
}

/** Every facing's problems by the standard (seatRig.ts checkRigView). */
export function rigProblems(key: string, rig: DraftRig | null | undefined, views: Partial<Record<Facing, LabView>>): Partial<Record<Facing, string[]>> {
  const out: Partial<Record<Facing, string[]>> = {};
  for (const f of RIG_FACINGS) {
    const v = views[f];
    if (!v) continue;
    const r = rigOf(key, rig, views, f);
    out[f] = r ? checkRigView(v, r) : ['no rig yet'];
  }
  return out;
}

/* ------------------------------------------------------------------ the model's picture */

/** Draw the drawing at `z`×, its pieces outlined and numbered, and a coordinate grid, for the vision model. */
export function pieceSheet(px: Pixels, pieces: Pieces, z: number): HTMLCanvasElement {
  const M = 34;
  const c = document.createElement('canvas');
  c.width = px.w * z + M + 8;
  c.height = px.h * z + M + 8;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ece6da';
  g.fillRect(0, 0, c.width, c.height);
  g.imageSmoothingEnabled = false;
  const img = new ImageData(new Uint8ClampedArray(px.d), px.w, px.h);
  const tmp = document.createElement('canvas');
  tmp.width = px.w;
  tmp.height = px.h;
  tmp.getContext('2d')!.putImageData(img, 0, 0);
  g.drawImage(tmp, M, M, px.w * z, px.h * z);
  // grid every 10 px, labelled on the edges in drawing px
  g.font = '11px monospace';
  g.fillStyle = '#333';
  g.strokeStyle = 'rgba(0,0,0,0.18)';
  g.lineWidth = 1;
  for (let x = 0; x <= px.w; x += 10) {
    g.beginPath();
    g.moveTo(M + x * z + 0.5, M);
    g.lineTo(M + x * z + 0.5, M + px.h * z);
    g.stroke();
    g.fillText(String(x), M + x * z - 6, 12);
  }
  for (let y = 0; y <= px.h; y += 10) {
    g.beginPath();
    g.moveTo(M, M + y * z + 0.5);
    g.lineTo(M + px.w * z, M + y * z + 0.5);
    g.stroke();
    g.fillText(String(y), 2, M + y * z + 4);
  }
  // piece borders
  g.fillStyle = '#ff2fd0';
  const L = pieces.labels;
  for (let y = 0; y < px.h; y++)
    for (let x = 0; x < px.w; x++) {
      const k = L[y * px.w + x];
      if (!k) continue;
      if (x + 1 < px.w && L[y * px.w + x + 1] !== k) g.fillRect(M + (x + 1) * z - 1, M + y * z, 2, z);
      if (y + 1 < px.h && L[(y + 1) * px.w + x] !== k) g.fillRect(M + x * z, M + (y + 1) * z - 1, z, 2);
    }
  // numbers
  g.font = 'bold 12px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let k = 1; k <= pieces.n; k++) {
    const [x, y] = pieces.at[k];
    const X = M + x * z;
    const Y = M + y * z;
    const t = String(k);
    const tw = g.measureText(t).width + 6;
    g.fillStyle = 'rgba(20,16,28,0.85)';
    g.fillRect(X - tw / 2, Y - 8, tw, 16);
    g.fillStyle = '#fff';
    g.fillText(t, X, Y);
  }
  return c;
}
