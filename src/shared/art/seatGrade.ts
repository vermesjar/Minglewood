/**
 * THE SEAT GRADE: how a seat is judged, per facing and per cushion, before it reaches the game. Every rule is a
 * measurement on the model, the render or the composition — never an eye's guess — and every one must pass:
 *
 *   MODEL   the build is well-formed (seatSpec.ts buildProblems); each cushion's sitting point is on its cushion top;
 *           the pelvis sits between 35% and 85% into the cushion's depth; the knees stand past the front edge; the
 *           soles are on the floor (or the footrest) to a quarter px; no part of the seat intrudes into the sitter's
 *           torso or thighs (an armrest may run under a forearm); with a back, the back's face is at the sitter's
 *           back (SIT_GAP, within a tenth of a tile).
 *   RENDER  every solid pixel lies inside the model's projected parts (plus its one-pixel outline) and the parts'
 *           projection is solid (IoU ≥ 0.97); the four facings agree on the seat's height to a pixel; the anchor is
 *           the footprint's back vertex; nothing is drawn below the floor line.
 *   COMPOSE for each of the review looks (SEAT_LOOKS) on each cushion: no pixel of the sitter shows where the seat is
 *           nearer (the compositor is exact, this proves it); the whole head shows from the front and at least 90%
 *           of it from behind; from the front the torso is at least 70% visible and the shoes at least half; nothing
 *           of the sitter is drawn outside the composition.
 *   FILES   (in the tool) the PNG in the catalog is the render, pixel for pixel, and the manifest entry matches.
 *
 * Pure: the tool (scripts/seat-grade.ts), the gate and the Design Lab share it.
 */
import type { Facing } from '../world/scene';
import { backFace, boxHull, cushionTop, frontEdge, bodyVolume, hull, intrusions, projectLocal, sitsByCushion, type SeatModel, type SitPoint } from '../world/seatModels';
import { buildProblems, KNEE_OUT, SIT_GAP, type BuiltPart, type SeatBuild } from '../world/seatSpec';
import { kneeV, legsFor, soleZ, type SitLegs } from '../world/sitLegs';
import { FIG } from '../world/seatFigure';
import { SIT_DROP } from '../world/seats';
import { composeSeat, figureDepth, placeFigure, DEPTH_EPS, type Figure } from './seatCompose';
import type { SeatArt } from './seatRender';

export interface Grade {
  key: string;
  facing: Facing;
  /** What failed, in words; empty means the seat passes in this facing. */
  problems: string[];
  /** Measurements, for the report. */
  measured: Record<string, number | string>;
}

/** The kit's layers (avatarKit.ts LAYER) by body part: the head is the skull, face, hair on it, hat and glasses (not hair hanging down the back). */
const HEAD = new Set([10, 11, 12, 13, 14]);
const TORSO = new Set([8, 9]);
const SHOES = new Set([7]);

export const FACINGS: Facing[] = ['se', 'sw', 'ne', 'nw'];

/** The model's problems, facing-independent. */
export function gradeModel(b: SeatBuild): string[] {
  const out = buildProblems(b);
  const m = b.model;
  m.sits.forEach((s, i) => {
    const [u, v, z] = s;
    const top = cushionTop(m, u, v);
    if (top === null || Math.abs(top - z) > 1e-6) out.push(`cushion ${i}: the sitting point isn't on the cushion top (z ${z}, cushion ${top ?? 'none'})`);
    const legs = legsFor(m, s, b.style);
    const front = frontEdge(m, u);
    if (kneeV(s, legs) > front - KNEE_OUT + 1e-6) out.push(`cushion ${i}: the knees (v ${kneeV(s, legs).toFixed(3)}) aren't past the front edge (${front})`);
    const floor = m.rest ?? 0;
    if (Math.abs(soleZ(s, legs) - floor) > 0.25) out.push(`cushion ${i}: the soles are at z ${soleZ(s, legs).toFixed(2)}, not on the ${m.rest !== undefined ? 'footrest' : 'floor'} (${floor})`);
    const body = bodyVolume(s, legs.reach, 13.5, 3);
    for (const hit of intrusions(m, body)) {
      const p = m.parts[hit.part] as BuiltPart;
      out.push(`cushion ${i}: ${p.label ?? p.part} intrudes into the ${hit.into} by ${hit.by.map((n) => n.toFixed(2)).join('×')}`);
    }
    const back = backFace(m, u, z);
    if (back !== null && (back - v < SIT_GAP - 0.01 || back - v > SIT_GAP + 0.1)) out.push(`cushion ${i}: the back's face is ${(back - v).toFixed(2)} behind the pelvis (SIT_GAP ${SIT_GAP} … ${SIT_GAP + 0.1})`);
  });
  return out;
}

/** Is a point inside a convex polygon? */
function inConvex(poly: ReadonlyArray<readonly [number, number]>, x: number, y: number): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % poly.length];
    const c = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (c === 0) continue;
    const s = Math.sign(c);
    if (!sign) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** A part's projected outline: a box's corners, or a cylinder's rims (24 points round each). */
function partHull(anchor: [number, number], size: readonly [number, number], f: Facing, p: BuiltPart): Array<[number, number]> {
  if (p.shape !== 'cyl' && p.shape !== 'ring') return boxHull(anchor, size, f, p);
  const cu = (p.u[0] + p.u[1]) / 2;
  const cv = (p.v[0] + p.v[1]) / 2;
  const ru = (p.u[1] - p.u[0]) / 2;
  const rv = (p.v[1] - p.v[0]) / 2;
  const pts: Array<[number, number]> = [];
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    for (const z of p.z) pts.push(projectLocal(anchor, size, f, cu + Math.cos(a) * ru, cv + Math.sin(a) * rv, z));
  }
  return hull(pts);
}

/** The render's problems in a facing: the pixels against the model. */
export function gradeRender(b: SeatBuild, art: SeatArt): { problems: string[]; measured: Record<string, number> } {
  const out: string[] = [];
  const m = b.model;
  const { w, h, d } = art.px;
  const anchor: [number, number] = [art.ax, art.ay];
  // the parts' projection (a ring's, with its hole, only bounds what may be drawn), dilated by the outline
  const proj = new Uint8Array(w * h);
  const may = new Uint8Array(w * h);
  for (const p of m.parts) {
    const ring = (p as BuiltPart).shape === 'ring';
    const poly = partHull(anchor, m.size, art.facing, p as BuiltPart);
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const [x, y] of poly) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(h - 1, Math.ceil(y1)); y++)
      for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(w - 1, Math.ceil(x1)); x++)
        if (inConvex(poly, x + 0.5, y + 0.5)) {
          may[y * w + x] = 1;
          if (!ring) proj[y * w + x] = 1;
        }
  }
  let solid = 0;
  let inter = 0;
  let uni = 0;
  let outside = 0;
  let below = 0;
  let top = h;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const s = d[i * 4 + 3] > 0;
      if (s) {
        solid++;
        top = Math.min(top, y);
        const near = may[i] || (x > 0 && may[i - 1]) || (x < w - 1 && may[i + 1]) || (y > 0 && may[i - w]) || (y < h - 1 && may[i + w]);
        if (!near) outside++;
      }
      if (s && proj[i]) inter++;
      if ((s && !(may[i] && !proj[i])) || proj[i]) uni++;
    }
  // nothing below the floor: the lowest floor-level point of any part
  let floorY = -Infinity;
  for (const p of m.parts) for (const u of p.u) for (const v of p.v) floorY = Math.max(floorY, boxHull(anchor, m.size, art.facing, { u: [u, u], v: [v, v], z: [0, 0] })[0][1]);
  for (let y = Math.ceil(floorY) + 2; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3]) below++;
  const iou = uni ? inter / uni : 0;
  if (!solid) out.push('nothing drawn');
  if (outside) out.push(`${outside} solid px lie outside the model's projection`);
  if (iou < 0.97) out.push(`the render covers the model's projection at IoU ${iou.toFixed(3)} (< 0.97)`);
  if (below) out.push(`${below} px drawn below the floor line`);
  return { problems: out, measured: { iou: Math.round(iou * 1000) / 1000, solid, topRow: top } };
}

export interface LookGrade {
  cushion: number;
  look: number;
  problems: string[];
  visible: { head: number; torso: number; shoes: number };
}

/**
 * A sitter composed into the seat in a facing, graded: the compositor against the depth it was given, and what of the
 * sitter shows. `figures`: per look, the figure rendered for this facing and the cushion's legs (the caller renders
 * them: the kit lives with the client).
 */
export function gradeSitter(b: SeatBuild, art: SeatArt, cushion: number, look: number, fig: Figure): LookGrade {
  const m = b.model;
  const sits = sitsByCushion(m, art.facing);
  const sit = sits[cushion];
  const problems: string[] = [];
  if (!sit) return { cushion, look, problems: [`cushion ${cushion} has no sitting point over its tile`], visible: { head: 0, torso: 0, shoes: 0 } };
  const legs = legsFor(m, sit, b.style);
  const legsBy = sits.map((s) => (s ? legsFor(m, s, b.style) : null));
  const C = composeSeat(art, m, b.style, sits, legsBy, [{ cushion, fig }], 64);
  const P = placeFigure(art, m, art.facing, sit, legs, b.style);
  const behind = art.facing === 'ne' || art.facing === 'nw';
  // the head that must show: its rows from the crown to just under the eyes (the frame's head box starts at row 36 + the pose's drop)
  const headRows = 36 + SIT_DROP[b.style] + 14;
  let wrong = 0;
  let outsideComp = 0;
  const count = { head: 0, torso: 0, shoes: 0 };
  const seen = { head: 0, torso: 0, shoes: 0 };
  for (let fy = 0; fy < FIG.h; fy++)
    for (let fx = 0; fx < FIG.w; fx++) {
      const fi = fy * FIG.w + fx;
      if (!fig.px[fi * 4 + 3]) continue;
      const X = P.x0 + fx + C.origin[0];
      const Y = P.y0 + fy + C.origin[1];
      if (X < 0 || Y < 0 || X >= C.px.w || Y >= C.px.h) {
        outsideComp++;
        continue;
      }
      const shows = C.who[Y * C.px.w + X] === 0;
      const layer = fig.owner[fi];
      const kind = HEAD.has(layer) ? (fy <= headRows ? 'head' : null) : TORSO.has(layer) ? 'torso' : SHOES.has(layer) ? 'shoes' : null;
      if (kind) {
        count[kind]++;
        if (shows) seen[kind]++;
      }
      // a shown pixel where the seat is nearer, or a hidden one where it isn't: the compositor lied
      const ax = P.x0 + fx;
      const ay = P.y0 + fy;
      const sz = ax >= 0 && ay >= 0 && ax < art.px.w && ay < art.px.h ? art.z[ay * art.px.w + ax] : NaN;
      const bz = figureDepth(art, m, art.facing, sit, legs, P, fx, fy, layer);
      const seatNearer = !Number.isNaN(sz) && sz > bz + DEPTH_EPS;
      if (shows === seatNearer) wrong++;
    }
  const visible = { head: count.head ? seen.head / count.head : 1, torso: count.torso ? seen.torso / count.torso : 1, shoes: count.shoes ? seen.shoes / count.shoes : 1 };
  if (wrong) problems.push(`look ${look} cushion ${cushion}: ${wrong} figure px composed against their depth`);
  if (outsideComp) problems.push(`look ${look} cushion ${cushion}: ${outsideComp} figure px fall outside the composition`);
  if (visible.head < (behind ? 0.75 : 0.98)) problems.push(`look ${look} cushion ${cushion}: only ${pct(visible.head)} of the head shows`);
  if (!behind && visible.torso < 0.7) problems.push(`look ${look} cushion ${cushion}: only ${pct(visible.torso)} of the torso shows from the front`);
  if (!behind && visible.shoes < 0.5) problems.push(`look ${look} cushion ${cushion}: only ${pct(visible.shoes)} of the shoes show from the front`);
  return { cushion, look, problems, visible };
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** A cushion's sitting point and legs in a facing (for the tools' sheets). */
export function sittingIn(m: SeatModel, style: SeatBuild['style'], facing: Facing): Array<{ sit: SitPoint; legs: SitLegs } | null> {
  return sitsByCushion(m, facing).map((s) => (s ? { sit: s, legs: legsFor(m, s, style) } : null));
}
