/**
 * How people sit in it, in the Design Lab: the seat's MODEL (the seat model standard, src/shared/world/seatModels.ts)
 * — a few 3D boxes and a sitting point per cushion, one model for all four facings — from which the game draws
 * people in the seat (sprites/seatLayers.ts): what of it goes over them, where each one sits, how their legs lie.
 *
 * Auto-fit seeds it from the drawings (seatModelFit.ts fitModel: the fitter scripts/seat-model.ts --fit runs). Per
 * facing, the drawing is shown with the model's boxes over it and what goes over its sitters tinted red: a box is
 * tuned by its sliders or dragged on the drawing (drag moves it across the seat, shift-drag raises or lowers its top);
 * dragging a sitting point nudges it in that view only (the model's `views`), and its sliders move the shared point
 * in every view. Every facing previews exactly as the game draws it (seatLayers.ts composeSeat: play scale and 4×,
 * three looks, every cushion taken) with THE check (seatLayers.ts seatProblems, the gate's). The reviewer passes it
 * once every facing holds; publishing waits for that (scripts/lab-model.ts checks it again on the staged drawings),
 * and the model goes into art/seat-models.json with the piece.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Facing } from '@shared/world/scene';
import type { SitStyle } from '@shared/world/seats';
import {
  behindView,
  boxEdges,
  cushionTop,
  drawingAt,
  MODEL_FACINGS,
  modelShapeProblems,
  PART_KINDS,
  projectLocal,
  SEAT_LOOKS,
  tidyModel,
  viewSits,
  worldToLocal,
  type ModelPart,
  type PartKind,
  type SeatModel,
  type SitPoint,
} from '@shared/world/seatModels';
import { kneeV, THIGH_R } from '@shared/world/sitLegs';
import { composeSeat, layerTiles, seatLayers, seatProblems } from '../engine/sprites/seatLayers';
import { silhouetteFit, type ModelView } from '../engine/sprites/seatModel';
import { fitModel, placeSits } from '../engine/sprites/seatModelFit';
import type { Draft, DraftModel, FurnitureSpec } from './api';
import { checker } from './pixels';
import { drawingsSignature, loadDrawings, seatArt, type Drawings, type SeatArt } from './seatLab';

export type ModelStatus = 'loading' | 'none' | 'stale' | 'bad' | 'unreviewed' | 'ok';

type Pt = [number, number];
type LabView = ModelView & { mirrored: boolean };
type Arts = Partial<Record<Facing, { art: SeatArt; mirrored: boolean }>>;
interface FacingCheck {
  problems: string[];
  iou: number;
}

const today = () => new Date().toISOString().slice(0, 10);
const COLOUR: Record<PartKind, string> = { seat: '#5aeb78', back: '#ff50dc', arm: '#ffaa28', leg: '#5ad2ff', base: '#7882ff', wrap: '#c878ff', other: '#fff05a' };
const FLOOR = '#c9a47e';

/** Every facing of a draft seat with a model, as the game will draw it. */
function viewsOf(arts: Arts, model: SeatModel, style: SitStyle): Partial<Record<Facing, LabView>> {
  const out: Partial<Record<Facing, LabView>> = {};
  for (const f of MODEL_FACINGS) {
    const a = arts[f];
    if (a) out[f] = { art: a.art, facing: f, model, style, mirrored: a.mirrored };
  }
  return out;
}

/** What's wrong with a model as a whole, before any facing: its shape, and its size against the piece's. */
function modelIssues(m: SeatModel, footprint: readonly [number, number]): string[] {
  const out = modelShapeProblems(m, Math.round(footprint[0] * footprint[1]));
  if (m.size[0] !== footprint[0] || m.size[1] !== footprint[1]) out.push(`the model is ${m.size.join('×')}, the piece ${footprint.join('×')}: Auto-fit again`);
  return out;
}

/** The part mirrored across the seat (u → W − u), and which part is a part's twin (-1: none; itself: centred). */
function twinOf(parts: ModelPart[], i: number, W: number): number {
  const p = parts[i];
  const near = (a: number, b: number) => Math.abs(a - b) < 0.011;
  if (near(p.u[0] + p.u[1], W)) return i;
  return parts.findIndex((q, k) => k !== i && q.part === p.part && near(q.u[0], W - p.u[1]) && near(q.u[1], W - p.u[0]) && near(q.v[0], p.v[0]) && near(q.v[1], p.v[1]) && near(q.z[0], p.z[0]) && near(q.z[1], p.z[1]));
}

/** A facing's own sitting points as its `views` list (one [u, v] per cushion), from what it draws now. */
function viewList(m: SeatModel, f: Facing): Pt[] {
  return m.views?.[f]?.map((q) => [q[0], q[1]] as Pt) ?? viewSits(m, f).map((s, i): Pt => (s ? [s[0], s[1]] : [m.sits[i]?.[0] ?? 0.5, m.sits[i]?.[1] ?? 0.5]));
}

/** A model without a facing's own sitting points (`views`) or traced over layer (`over`). */
function withoutView(m: SeatModel, f: Facing, field: 'views' | 'over'): SeatModel {
  const out: SeatModel = { ...m };
  if (field === 'views') {
    const rest = { ...m.views };
    delete rest[f];
    if (Object.keys(rest).length) out.views = rest;
    else delete out.views;
  } else {
    const rest = { ...m.over };
    delete rest[f];
    if (Object.keys(rest).length) out.over = rest;
    else delete out.over;
  }
  return out;
}

/* ------------------------------------------------------------------ preview */

/**
 * A seat with someone on every cushion, as the game draws it (composeSeat), once per look: the three pictures cropped
 * alike (to what any of them covers) on the floor's colour, one drawing px per canvas px.
 */
function seatCells(v: ModelView): HTMLCanvasElement[] {
  const n = layerTiles(v).length;
  const comps = SEAT_LOOKS.map((_, k) => composeSeat(v, Array.from({ length: n }, (_, c) => ({ look: SEAT_LOOKS[(k + c) % SEAT_LOOKS.length], cushion: c }))).px);
  const { w, h } = comps[0];
  let l = w;
  let t = h;
  let r = -1;
  let b = -1;
  for (const p of comps)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (p.d[(y * w + x) * 4 + 3]) {
          l = Math.min(l, x);
          r = Math.max(r, x);
          t = Math.min(t, y);
          b = Math.max(b, y);
        }
  if (r < 0) return [];
  l = Math.max(0, l - 4);
  t = Math.max(0, t - 4);
  r = Math.min(w - 1, r + 4);
  b = Math.min(h - 1, b + 4);
  return comps.map((p) => {
    const tmp = document.createElement('canvas');
    tmp.width = w;
    tmp.height = h;
    tmp.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(p.d), w, h), 0, 0);
    const c = document.createElement('canvas');
    c.width = r - l + 1;
    c.height = b - t + 1;
    const g = c.getContext('2d')!;
    g.fillStyle = FLOOR;
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(tmp, l, t, c.width, c.height, 0, 0, c.width, c.height);
    return c;
  });
}

/** A picture at a whole-pixel scale, crisp. */
function Pix({ src, scale }: { src: HTMLCanvasElement; scale: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = src.width * scale;
    c.height = src.height * scale;
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.drawImage(src, 0, 0, c.width, c.height);
  }, [src, scale]);
  return <canvas ref={ref} />;
}

/** Which way a sitter facing this way looks on screen. */
const FACING_ARROW: Record<string, string> = { se: '↘', sw: '↙', ne: '↗', nw: '↖' };

/** One facing as the game draws it: three looks, every cushion taken, at play scale and 4×, and its check. */
function FacingPreview({ v, check, on, onPick }: { v: LabView; check: FacingCheck; on: boolean; onPick: () => void }) {
  const cells = useMemo(() => seatCells(v), [v]);
  const { problems } = check;
  return (
    <figure className={`rig-facing ${problems.length ? 'bad' : 'good'} ${on ? 'on' : ''}`} data-facing={v.facing}>
      <figcaption>
        <b>{v.facing}</b> {behindView(v.facing) ? 'from behind' : 'from the front'}
        {/* a drawing filed under the wrong facing is mirrored the wrong way round in the game (armchair.mustard's front
            faced the wall while its sitter faced the table): the reviewer checks the seat faces its sitters' way */}
        <span className="facing-arrow" title="its sitters face this way on screen: the seat must face the same way">
          {' '}
          sitters face <b>{FACING_ARROW[v.facing]}</b>: the seat must too
        </span>
        {v.mirrored && <span className="muted"> · drawing mirrored</span>}
        {v.model.views?.[v.facing] && <span className="muted"> · sitting points nudged here</span>}
        {v.model.over?.[v.facing] && <span className="muted"> · over layer traced</span>}
        <button className="btn ghost small tick" disabled={on} onClick={onPick}>
          {on ? 'editing' : 'edit this view'}
        </button>
      </figcaption>
      {/* play scale (one drawing px per screen px: the game at zoom 2), then 4× */}
      <div className="rig-preview" title="play scale">
        {cells.map((c, i) => (
          <Pix key={i} src={c} scale={1} />
        ))}
      </div>
      <div className="rig-preview" title="4×">
        {cells.map((c, i) => (
          <Pix key={i} src={c} scale={2} />
        ))}
      </div>
      <ul className="rig-checks">
        {problems.slice(0, 6).map((p) => (
          <li key={p} className="bad">
            {p}
          </li>
        ))}
        {problems.length > 6 && <li className="bad">…and {problems.length - 6} more</li>}
        {!problems.length && <li className="good">holds: fits the drawing (IoU {check.iou.toFixed(3)}), a sitting point on every cushion, the legs clear of the seat and the floor</li>}
      </ul>
    </figure>
  );
}

/** A labelled slider with its number, for one bound. */
function Knob({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="small" style={{ display: 'grid', gridTemplateColumns: '2.4em 1fr 4.2em', gap: 6, alignItems: 'center' }}>
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <input type="number" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

/* ------------------------------------------------------------------ the panel */

interface Drag {
  kind: 'box' | 'sit';
  /** The part, or the cushion (seatSpots order). */
  i: number;
  from: Pt;
  start: SeatModel;
  shift: boolean;
  /** A sitting point: from the pointer to the point as grabbed (drawing px), and the height it's dragged at. */
  grab?: Pt;
  z?: number;
}

export function ModelPanel({ draft, onPatch, onStatus }: { draft: Draft; onPatch: (p: Partial<FurnitureSpec>) => void; onStatus: (s: ModelStatus) => void }) {
  const f = draft.furniture!;
  const sig = drawingsSignature(draft);
  const style = f.sitStyle as SitStyle;
  const [loaded, setLoaded] = useState<{ sig: string; drawings: Drawings } | null>(null);
  const [sel, setSel] = useState<Facing>('se');
  const [part, setPart] = useState(0);
  const [symmetric, setSymmetric] = useState(true);
  const [showOver, setShowOver] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [live, setLive] = useState<SeatModel | null>(null);
  const editor = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let on = true;
    void loadDrawings(draft).then((drawings) => on && setLoaded({ sig, drawings }));
    return () => {
      on = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.id, sig]);
  const drawings = loaded?.sig === sig ? loaded.drawings : null;

  // each facing's drawing as the game places it (stable while the drawings are: the layers are cached on its pixels)
  const arts = useMemo(() => {
    const out: Arts = {};
    if (drawings) for (const g of MODEL_FACINGS) out[g] = seatArt(drawings, f.footprint, g) ?? undefined;
    return out;
  }, [drawings, f.footprint]);

  const stored: DraftModel | null = f.seatModel ?? null;
  const stale = !!stored && stored.for !== sig;
  // while dragging, the model being dragged; else the stored one
  const model = live ?? stored?.model ?? null;
  const W = f.footprint[0];
  const issues = useMemo(() => (stored ? modelIssues(stored.model, f.footprint) : []), [stored, f.footprint]);
  // what's checked and previewed: the stored model (a drag checks once it's dropped)
  const settled = useMemo(() => (stored && !issues.length ? viewsOf(arts, stored.model, style) : {}), [arts, stored, issues, style]);
  const checks = useMemo(() => {
    const out: Partial<Record<Facing, FacingCheck>> = {};
    for (const g of MODEL_FACINGS) {
      const v = settled[g];
      if (v) out[g] = { problems: seatProblems(v), iou: silhouetteFit(v).iou };
    }
    return out;
  }, [settled]);
  const badFacings = MODEL_FACINGS.filter((g) => (checks[g]?.problems.length ?? 0) > 0);
  const anyBad = issues.length > 0 || badFacings.length > 0;
  const status: ModelStatus = !drawings ? 'loading' : !stored ? 'none' : stale ? 'stale' : anyBad ? 'bad' : !stored.reviewed ? 'unreviewed' : 'ok';
  useEffect(() => onStatus(status), [status, onStatus]);

  /** Store a model, made on these drawings: a changed model is no longer passed. */
  const save = (m: SeatModel, reviewed?: string) => onPatch({ seatModel: { model: tidyModel(m), for: sig, ...(reviewed ? { reviewed } : {}) } });

  // the drawings changed (a redraw, a nudge): the model is checked on the new ones, and passed again
  useEffect(() => {
    if (drawings && stored && stale) save(stored.model);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawings, stale]);

  /** Change a part (and, keeping the model symmetric, its twin mirrored; a centred part stays centred). */
  function changed(m: SeatModel, i: number, next: ModelPart): SeatModel {
    const parts = m.parts.map((p) => ({ ...p, u: [...p.u] as [number, number], v: [...p.v] as [number, number], z: [...p.z] as [number, number] }));
    const twin = symmetric ? twinOf(m.parts, i, W) : -1;
    if (twin === i) {
      // centred: whichever side moved, both sides follow
      const moved = next.u[0] !== m.parts[i].u[0] ? next.u[0] : W - next.u[1];
      next = { ...next, u: [Math.min(moved, W / 2), Math.max(W - moved, W / 2)] };
    }
    parts[i] = next;
    if (twin >= 0 && twin !== i) parts[twin] = { ...next, u: [W - next.u[1], W - next.u[0]] };
    return { ...m, parts };
  }

  async function autoFit() {
    setBusy('Fitting the model to every facing…');
    await new Promise((r) => setTimeout(r, 30));
    try {
      const views = MODEL_FACINGS.flatMap((g) => (arts[g] ? [{ facing: g, art: arts[g]!.art }] : []));
      if (!views.length) return;
      const r = fitModel({ key: draft.key, size: [f.footprint[0], f.footprint[1]], seat: f.seat ?? 12, style, backrest: f.backrest, arms: !!f.arms, views }, undefined, { shakes: 24 });
      save({ ...r.model, fitted: today() });
      setPart(0);
    } finally {
      setBusy(null);
    }
  }

  /* -------------------------------------------------------------- the editor canvas */

  const cur = useMemo(() => (model && !modelIssues(model, f.footprint).length ? (viewsOf(arts, model, style)[sel] ?? null) : null), [arts, model, style, sel, f.footprint]);
  const layers = useMemo(() => (cur ? seatLayers(cur) : null), [cur]);
  const Z = cur ? Math.max(4, Math.min(8, Math.floor(Math.min(560 / cur.art.px.w, 520 / cur.art.px.h)))) : 6;
  const PAD = 12;
  useEffect(() => {
    const c = editor.current;
    if (!c || !cur || !layers) return;
    const m = cur.model;
    const { px, ax, ay } = cur.art;
    c.width = px.w * Z + 2 * PAD;
    c.height = px.h * Z + 2 * PAD;
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    checker(g, c.width, c.height, Z);
    // the drawing, what goes over its sitters tinted red (the gate's sheet: scripts/seat-layers.ts)
    const d = new Uint8ClampedArray(px.d);
    if (showOver)
      for (let i = 0; i < layers.over.length; i++)
        if (layers.over[i]) {
          d[i * 4] = Math.round(d[i * 4] * 0.45 + 255 * 0.55);
          d[i * 4 + 1] = Math.round(d[i * 4 + 1] * 0.45 + 40 * 0.55);
          d[i * 4 + 2] = Math.round(d[i * 4 + 2] * 0.45 + 60 * 0.55);
        }
    const tmp = document.createElement('canvas');
    tmp.width = px.w;
    tmp.height = px.h;
    tmp.getContext('2d')!.putImageData(new ImageData(d, px.w, px.h), 0, 0);
    g.drawImage(tmp, PAD, PAD, px.w * Z, px.h * Z);
    const X = (x: number) => PAD + x * Z;
    const Y = (y: number) => PAD + y * Z;
    m.parts.forEach((p, k) => {
      g.strokeStyle = COLOUR[p.part];
      for (const e of boxEdges([ax, ay], m.size, sel, p)) {
        g.lineWidth = k === part ? 3 : e.hidden ? 1 : 2;
        g.setLineDash(e.hidden ? [4, 4] : []);
        g.beginPath();
        g.moveTo(X(e.a[0]), Y(e.a[1]));
        g.lineTo(X(e.b[0]), Y(e.b[1]));
        g.stroke();
      }
      g.setLineDash([]);
      // the handle: the middle of its top face
      const [hx, hy] = projectLocal([ax, ay], m.size, sel, (p.u[0] + p.u[1]) / 2, (p.v[0] + p.v[1]) / 2, p.z[1]);
      const s = k === part ? 6 : 4;
      g.fillStyle = COLOUR[p.part];
      g.fillRect(X(hx) - s, Y(hy) - s, s * 2, s * 2);
      g.fillStyle = '#000';
      g.font = '11px sans-serif';
      g.fillText(String(k), X(hx) - 3, Y(hy) + 4);
    });
    // each cushion's sitter as this view draws them: the hips (the sitting point: yellow, orange when nudged in this
    // view), the knees and the feet
    const nudged = !!m.views?.[sel];
    const dot = ([x, y]: Pt, colour: string) => {
      g.fillStyle = '#14101c';
      g.fillRect(X(x) - 4, Y(y) - 4, 9, 9);
      g.fillStyle = colour;
      g.fillRect(X(x) - 3, Y(y) - 3, 7, 7);
    };
    layers.sits.forEach((s, i) => {
      const hip = layers.hips[i];
      const legs = layers.legs[i];
      if (!s || !hip) return;
      if (legs) {
        const kv = kneeV(s, legs);
        const kz = s[2] + THIGH_R + legs.rise;
        dot(projectLocal([ax, ay], m.size, sel, s[0], kv, kz), '#fadc3c');
        dot(projectLocal([ax, ay], m.size, sel, s[0], kv - legs.toe, kz - legs.drop), '#46dcfa');
      }
      const colour = nudged ? '#ff9a3c' : '#ffe628';
      g.strokeStyle = '#14101c';
      g.lineWidth = 5;
      const cross = () => {
        g.beginPath();
        g.moveTo(X(hip[0]) - 12, Y(hip[1]));
        g.lineTo(X(hip[0]) + 12, Y(hip[1]));
        g.moveTo(X(hip[0]), Y(hip[1]) - 12);
        g.lineTo(X(hip[0]), Y(hip[1]) + 12);
        g.stroke();
      };
      cross();
      g.strokeStyle = colour;
      g.lineWidth = 3;
      cross();
      g.fillStyle = colour;
      g.font = 'bold 12px sans-serif';
      g.fillText(`S${i}`, X(hip[0]) + 6, Y(hip[1]) + 16);
    });
  }, [cur, layers, sel, part, Z, showOver]);

  const at = (e: React.MouseEvent<HTMLCanvasElement>): Pt => {
    const r = e.currentTarget.getBoundingClientRect();
    const k = e.currentTarget.width / r.width;
    return [((e.clientX - r.left) * k - PAD) / Z, ((e.clientY - r.top) * k - PAD) / Z];
  };
  function down(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!cur || !layers || !model) return;
    const p = at(e);
    const { ax, ay } = cur.art;
    // the nearest handle within 8 drawing px: a sitting point as this view draws it, else a box's top
    let best: { kind: 'box' | 'sit'; i: number; d: number } | null = null;
    layers.hips.forEach((h, i) => {
      if (!h) return;
      const d = Math.hypot(h[0] - p[0], h[1] - p[1]);
      if (d < 8 && (!best || d < best.d)) best = { kind: 'sit', i, d };
    });
    model.parts.forEach((q, i) => {
      const [hx, hy] = projectLocal([ax, ay], model.size, sel, (q.u[0] + q.u[1]) / 2, (q.v[0] + q.v[1]) / 2, q.z[1]);
      const d = Math.hypot(hx - p[0], hy - p[1]);
      if (d < 6 && (!best || d < best.d - 0.5)) best = { kind: 'box', i, d };
    });
    const b = best as { kind: 'box' | 'sit'; i: number; d: number } | null;
    if (!b) return;
    if (b.kind === 'box') {
      setPart(b.i);
      setDrag({ kind: 'box', i: b.i, from: p, start: model, shift: e.shiftKey });
      return;
    }
    const h = layers.hips[b.i]!;
    setDrag({ kind: 'sit', i: b.i, from: p, start: model, shift: false, grab: [h[0] - p[0], h[1] - p[1]], z: layers.sits[b.i]![2] });
  }
  function move(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!drag || !cur) return;
    const p = at(e);
    const { ax, ay } = cur.art;
    const m = drag.start;
    if (drag.kind === 'sit') {
      // a nudge in this view only: the point under the pointer at the cushion's height becomes this view's own
      const w = drawingAt([ax, ay], p[0] + drag.grab![0], p[1] + drag.grab![1], drag.z!);
      const l = worldToLocal(m.size, sel, w.x, w.y);
      const list = viewList(m, sel);
      list[drag.i] = [l.u, l.v];
      setLive({ ...m, views: { ...(m.views ?? {}), [sel]: list } });
      return;
    }
    const q = m.parts[drag.i];
    if (drag.shift) {
      // up and down: its top follows the pointer (2 drawing px per world px)
      const dz = (drag.from[1] - p[1]) / 2;
      setLive(changed(m, drag.i, { ...q, z: [q.z[0], Math.max(q.z[0] + 0.5, q.z[1] + dz)] }));
      return;
    }
    // across the seat: on the plane of its top
    const A = drawingAt([ax, ay], drag.from[0], drag.from[1], q.z[1]);
    const B = drawingAt([ax, ay], p[0], p[1], q.z[1]);
    const a = worldToLocal(m.size, sel, A.x, A.y);
    const b = worldToLocal(m.size, sel, B.x, B.y);
    const du = b.u - a.u;
    const dv = b.v - a.v;
    setLive(changed(m, drag.i, { ...q, u: [q.u[0] + du, q.u[1] + du], v: [q.v[0] + dv, q.v[1] + dv] }));
  }
  function up() {
    if (drag && live) save(live);
    setDrag(null);
    setLive(null);
  }

  const chip =
    status === 'ok'
      ? ['good', `passed ${stored?.reviewed}`]
      : status === 'loading'
        ? ['', 'loading…']
        : status === 'stale'
          ? ['soft', 'the drawings changed: checking it on the new ones']
          : status === 'none'
            ? ['bad', 'no model: press Auto-fit']
            : status === 'bad'
              ? ['bad', issues.length ? 'the model doesn’t fit the piece' : `${badFacings.length} facing(s) don’t hold`]
              : ['soft', 'holds in every facing: the reviewer passes it'];
  const cp = model?.parts[part];
  const facings = MODEL_FACINGS.filter((g) => arts[g]);

  return (
    <section className="lab-card rig-panel">
      <header className="card-head">
        <h3>How people sit in it</h3>
        <span className={`chip ${chip[0]}`}>{chip[1]}</span>
        <span className="muted">its 3D model: a few boxes and a sitting point per cushion, one for all four facings. The game draws people in the seat from it</span>
      </header>
      <div className="rig-actions">
        <button className="btn primary small" disabled={!drawings || !!busy} onClick={() => void autoFit()} title="the fitter: the family's boxes fitted to every facing's silhouette, the cushion at the seat height set in the spec; a fresh fit drops every view's nudges and traced layers">
          {busy ? 'Fitting…' : stored ? 'Auto-fit again' : 'Auto-fit'}
        </button>
        <button
          className="btn ghost small"
          disabled={status !== 'unreviewed'}
          onClick={() => stored && save(stored.model, today())}
          title="the reviewer: every facing read at play scale and 4×, and tried in the room below (sit down, sit, stand up), and it reads right"
        >
          {stored?.reviewed && !stale ? `Passed ${stored.reviewed}` : 'Pass it (reviewer)'}
        </button>
        <label className="check small">
          <input type="checkbox" checked={symmetric} onChange={(e) => setSymmetric(e.target.checked)} /> keep it mirror-symmetric
        </label>
        <label className="check small">
          <input type="checkbox" checked={showOver} onChange={(e) => setShowOver(e.target.checked)} /> tint what goes over the sitters
        </label>
        {busy && <span className="muted small">{busy}</span>}
      </div>
      {!drawings ? (
        <div className="lab-empty small">loading the drawings…</div>
      ) : !model ? (
        <div className="lab-empty small">No model yet: press Auto-fit to seed one from the drawings (it starts from the seat height, how it’s sat in, the backrest and the arms set in the spec).</div>
      ) : (
        <div className="rig-body">
          {issues.length > 0 && (
            <ul className="rig-checks">
              {issues.map((p) => (
                <li key={p} className="bad">
                  {p}
                </li>
              ))}
            </ul>
          )}
          <div className="rig-edit">
            <div className="seg">
              {facings.map((g) => (
                <button key={g} className={g === sel ? 'on' : ''} onClick={() => setSel(g)}>
                  {g} {behindView(g) ? '(behind)' : '(front)'}
                  {checks[g] ? (checks[g]!.problems.length ? ' ✗' : ' ✓') : ''}
                </button>
              ))}
            </div>
            <canvas ref={editor} className="clickable rig-canvas" onMouseDown={down} onMouseMove={move} onMouseUp={up} onMouseLeave={up} />
            <p className="small muted">
              Red: what of the seat is drawn over the people in it. Drag a box&apos;s square to move it across the seat; shift-drag to raise or lower its top. Drag a sitting point (the cross) to nudge where people sit in this view only;
              its sliders below move it in every view. Yellow and blue squares: the knees and the feet. Box colours: seat green, back magenta, arm orange, leg blue, base violet, wrap purple; dashed edges are hidden.
            </p>
            <div className="rig-actions">
              {model.views?.[sel] ? (
                <button className="btn ghost small" onClick={() => save(withoutView(model, sel, 'views'))} title="this view draws its sitters where the model's sitting points put them again">
                  Clear this view&apos;s nudge
                </button>
              ) : (
                <span className="muted small">{sel}: sitting points as the model puts them (no nudge)</span>
              )}
              {model.over?.[sel] && (
                <button className="btn ghost small" onClick={() => save(withoutView(model, sel, 'over'))} title="its over layer was traced by eye; without it the model's parts decide what goes over the sitters">
                  Use the parts for what goes over them ({model.over[sel]!.length} traced shape{model.over[sel]!.length > 1 ? 's' : ''})
                </button>
              )}
            </div>
            <div className="rig-knobs" style={{ display: 'grid', gap: 4 }}>
              <div className="seg" style={{ flexWrap: 'wrap' }}>
                {model.parts.map((p, k) => (
                  <button key={k} className={k === part ? 'on' : ''} onClick={() => setPart(k)} style={{ borderColor: COLOUR[p.part] }} title={`${p.part}: u ${p.u.join('–')}, v ${p.v.join('–')}, z ${p.z.join('–')}`}>
                    {k} {p.part}
                  </button>
                ))}
                <button onClick={() => save({ ...model, parts: [...model.parts, { part: 'other', u: [W / 2 - 0.1, W / 2 + 0.1], v: [0.4, 0.6], z: [0, 10] }] })}>+ box</button>
              </div>
              {cp && (
                <>
                  <label className="small">
                    part{' '}
                    <select value={cp.part} onChange={(e) => save(changed(model, part, { ...cp, part: e.target.value as PartKind }))}>
                      {PART_KINDS.map((k) => (
                        <option key={k}>{k}</option>
                      ))}
                    </select>{' '}
                    <button
                      className="btn ghost small"
                      onClick={() => {
                        save({ ...model, parts: model.parts.filter((_, k) => k !== part) });
                        setPart(0);
                      }}
                    >
                      delete
                    </button>
                  </label>
                  {(['u', 'v', 'z'] as const).map((ax) =>
                    [0, 1].map((j) => (
                      <Knob
                        key={`${ax}${j}`}
                        label={`${ax}${j}`}
                        value={cp[ax][j]}
                        min={ax === 'z' ? 0 : -0.3}
                        max={ax === 'z' ? 80 : ax === 'u' ? W + 0.3 : f.footprint[1] + 0.3}
                        step={ax === 'z' ? 0.25 : 0.005}
                        onChange={(x) => {
                          const span = [...cp[ax]] as [number, number];
                          span[j] = x;
                          if (span[0] > span[1]) return;
                          save(changed(model, part, { ...cp, [ax]: span }));
                        }}
                      />
                    )),
                  )}
                </>
              )}
              <button
                className="btn ghost small"
                title="the standard: from the front bottom back against the backrest (the middle of a backless seat), on the cushion top; from behind just in front of the backrest — in every view without a nudge of its own"
                onClick={() => save({ ...model, sits: placeSits(model.parts, model.size, model.sits.length > 1 ? model.sits.map((q) => q[0]) : undefined) })}
              >
                Sit them back against the backrest (the standard)
              </button>
              {model.sits.map((s, i) => (
                <div key={i}>
                  <b className="small">sitting point S{i} (every view without a nudge)</b>
                  {[0, 1, 2].map((j) => (
                    <Knob
                      key={j}
                      label={['u', 'v', 'z'][j]}
                      value={s[j]}
                      min={j === 2 ? 0 : -0.2}
                      max={j === 2 ? 60 : j === 0 ? W : f.footprint[1]}
                      step={j === 2 ? 0.05 : 0.005}
                      onChange={(x) => save({ ...model, sits: model.sits.map((q, k) => (k === i ? (q.map((c, n) => (n === j ? x : c)) as SitPoint) : q)) })}
                    />
                  ))}
                  <button className="btn ghost small" onClick={() => save({ ...model, sits: model.sits.map((q, k) => (k === i ? ([q[0], q[1], cushionTop(model, q[0], q[1]) ?? q[2]] as SitPoint) : q)) })}>
                    onto the cushion top
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div className="rig-facings">
            {facings.map((g) =>
              settled[g] && checks[g] ? <FacingPreview key={g} v={settled[g]!} check={checks[g]!} on={g === sel} onPick={() => setSel(g)} /> : null,
            )}
          </div>
        </div>
      )}
    </section>
  );
}
