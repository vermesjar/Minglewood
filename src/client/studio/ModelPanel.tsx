/**
 * The seat model, in the Design Lab (the seat model standard, src/shared/world/seatModels.ts): the seat's 3D proxy —
 * a few boxes and a sitting point per cushion, shared by all four facings — fitted to its drawings and tuned by eye.
 * Auto-fit seeds it (the same fitter as scripts/seat-model.ts --fit); then every box is drawn over the drawing, and
 * the selected one is tuned by its sliders or dragged on the drawing (drag moves it across the seat, shift-drag raises
 * or lowers its top), the sitting points dragged along the cushion. Every facing previews live by z-buffer, exactly as
 * the game draws it — play scale and 4×, three looks, every cushion taken, the sit-down loop — with the standard's
 * checks. The reviewer passes it once it holds in every facing; publishing waits for that (scripts/lab-model.ts), and
 * the model goes into art/seat-models.json with the piece.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Facing } from '@shared/world/scene';
import { FIG, figAx } from '@shared/world/seatRigs';
import {
  behindView,
  boxEdges,
  cushionTop,
  drawingAt,
  MODEL_FACINGS,
  PART_KINDS,
  projectLocal,
  SEAT_LOOKS,
  sitsByCushion,
  tidyModel,
  worldToLocal,
  type ModelPart,
  type PartKind,
  type SeatModel,
  type SitPoint,
} from '@shared/world/seatModels';
import { composeModel, modelFindings, modelSitFrames, modelSitters, type ModelSitter, type ModelView } from '../engine/sprites/seatModel';
import { fitModel, placeSits } from '../engine/sprites/seatModelFit';
import type { Pixels } from '../engine/sprites/footing';
import { lab, type Draft, type DraftModel, type FurnitureSpec } from './api';
import { checker, loadImg } from './pixels';
import { seatArt, type Drawings } from './seatLab';
import { labProfile } from './rigLab';
import { rigSignature } from './rigPreview';

export type ModelStatus = 'loading' | 'none' | 'stale' | 'bad' | 'unreviewed' | 'ok';

const today = () => new Date().toISOString().slice(0, 10);
const COLOUR: Record<PartKind, string> = { seat: '#5aeb78', back: '#ff50dc', arm: '#ffaa28', leg: '#5ad2ff', base: '#7882ff', wrap: '#c878ff', other: '#fff05a' };

async function pixelsOf(url: string): Promise<Pixels> {
  const img = await loadImg(url);
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  return { w: img.width, h: img.height, d: g.getImageData(0, 0, img.width, img.height).data };
}

/** Every facing of a draft seat as the game will draw it, with a model. */
function modelViews(drawings: Drawings, footprint: readonly [number, number], model: SeatModel, style: ModelView['style']): Partial<Record<Facing, ModelView & { mirrored: boolean }>> {
  const out: Partial<Record<Facing, ModelView & { mirrored: boolean }>> = {};
  for (const f of MODEL_FACINGS) {
    const r = seatArt(drawings, footprint, f);
    if (r) out[f] = { art: r.art, facing: f, model, style, mirrored: r.mirrored };
  }
  return out;
}

/** The part mirrored across the seat (u → W − u), and which part is a part's twin (-1: none; itself: centred). */
function twinOf(parts: ModelPart[], i: number, W: number): number {
  const p = parts[i];
  const near = (a: number, b: number) => Math.abs(a - b) < 0.011;
  if (near(p.u[0] + p.u[1], W)) return i;
  return parts.findIndex((q, k) => k !== i && q.part === p.part && near(q.u[0], W - p.u[1]) && near(q.u[1], W - p.u[0]) && near(q.v[0], p.v[0]) && near(q.v[1], p.v[1]) && near(q.z[0], p.z[0]) && near(q.z[1], p.z[1]));
}

/* ------------------------------------------------------------------ preview */

function boundsOf(v: ModelView, sets: ModelSitter[][]) {
  let l = 0;
  let t = 0;
  let r = v.art.px.w;
  let b = v.art.px.h;
  for (const s of sets.flat()) {
    const x0 = s.feet[0] - figAx(s.facing);
    l = Math.min(l, x0 + 16);
    r = Math.max(r, x0 + FIG.w - 16);
    t = Math.min(t, s.feet[1] - FIG.feet + 22);
    b = Math.max(b, s.feet[1] - FIG.feet + FIG.h - 4);
  }
  return { l: l - 4, t: t - 4, r: r + 4, b: b + 4 };
}

function cellCanvas(v: ModelView, sitters: ModelSitter[], box: ReturnType<typeof boundsOf>): HTMLCanvasElement {
  const W = box.r - box.l;
  const H = box.b - box.t;
  const comp = composeModel(v, sitters, { size: [W, H], origin: [-box.l, -box.t] });
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#c9a47e';
  g.fillRect(0, 0, W, H);
  const tmp = document.createElement('canvas');
  tmp.width = W;
  tmp.height = H;
  tmp.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(comp.cell.d), W, H), 0, 0);
  g.drawImage(tmp, 0, 0);
  return c;
}

/** One facing, by z-buffer as the game draws it: three looks at play scale and 4×, and the sit-down loop. */
function FacingPreview({ v, problems, iou, mirrored }: { v: ModelView; problems: string[]; iou: number; mirrored: boolean }) {
  const still = useRef<HTMLCanvasElement>(null);
  const loop = useRef<HTMLCanvasElement>(null);
  const frames = useMemo(() => {
    const sets = SEAT_LOOKS.map((_, k) => modelSitters(v, SEAT_LOOKS, k));
    const moves = modelSitFrames(v, SEAT_LOOKS[0]);
    const box = boundsOf(v, [...sets, moves]);
    const others = modelSitters(v, SEAT_LOOKS, 1).slice(1);
    return { cells: sets.map((s) => cellCanvas(v, s, box)), film: moves.map((m) => cellCanvas(v, [m, ...others], box)) };
  }, [v]);
  useEffect(() => {
    const c = still.current;
    if (!c || !frames.cells.length) return;
    const { cells } = frames;
    const cw = cells[0].width;
    const ch = cells[0].height;
    c.width = cw * 2 * 3 + 8 * 2;
    c.height = ch + 8 + ch * 2;
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, c.width, c.height);
    cells.forEach((cell, i) => g.drawImage(cell, i * (cw + 8), 0));
    cells.forEach((cell, i) => g.drawImage(cell, i * (cw * 2 + 8), ch + 8, cw * 2, ch * 2));
  }, [frames]);
  useEffect(() => {
    const c = loop.current;
    const { film } = frames;
    if (!c || !film.length) return;
    c.width = film[0].width * 2;
    c.height = film[0].height * 2;
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    let i = 0;
    let t: ReturnType<typeof setTimeout>;
    const draw = () => {
      const k = i % film.length;
      g.drawImage(film[k], 0, 0, c.width, c.height);
      i++;
      t = setTimeout(draw, k === 6 ? 900 : k === 0 || k === film.length - 1 ? 500 : 160);
    };
    draw();
    return () => clearTimeout(t);
  }, [frames]);
  return (
    <figure className={`rig-facing ${problems.length ? 'bad' : 'good'}`}>
      <figcaption>
        <b>{v.facing}</b> {behindView(v.facing) ? 'from behind' : 'from the front'}
        {mirrored && <span className="muted"> · drawing mirrored</span>}
        <span className="muted"> · IoU {iou.toFixed(3)}</span>
      </figcaption>
      <div className="rig-preview">
        <canvas ref={still} />
        <canvas ref={loop} className="rig-loop" title="sit down, sit, stand up" />
      </div>
      {problems.length > 0 && (
        <ul className="issues">
          {problems.slice(0, 6).map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
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

export function ModelPanel({ draft, onPatch, onStatus }: { draft: Draft; onPatch: (p: Partial<FurnitureSpec>) => void; onStatus: (s: ModelStatus) => void }) {
  const f = draft.furniture!;
  const sig = rigSignature(draft);
  const [drawings, setDrawings] = useState<Drawings | null>(null);
  const [sel, setSel] = useState<Facing>('se');
  const [part, setPart] = useState(0);
  const [symmetric, setSymmetric] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ kind: 'box' | 'sit'; i: number; from: [number, number]; start: SeatModel; shift: boolean } | null>(null);
  const [live, setLive] = useState<SeatModel | null>(null);
  const editor = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let on = true;
    setDrawings(null);
    void (async () => {
      const out: Drawings = {};
      for (const [name, v] of Object.entries(draft.views)) {
        if (!v.file) continue;
        const px = await pixelsOf(lab.fileUrl(draft.id, v.file, String(v.take)));
        out[name as keyof Drawings] = { px, anchor: [(v.anchor?.[0] ?? 0) + (v.nudge?.[0] ?? 0), (v.anchor?.[1] ?? 0) + (v.nudge?.[1] ?? 0)] };
      }
      if (on) setDrawings(out);
    })();
    return () => {
      on = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.id, sig]);

  const profile = labProfile(draft.key, f);
  const stale = !!f.seatModel && f.seatModel.for !== sig;
  const stored: DraftModel | null = f.seatModel && !stale ? f.seatModel : null;
  // while dragging, the model being dragged; else the stored one
  const model = live ?? stored?.model ?? null;
  const W = f.footprint[0];
  const views = useMemo(() => (drawings && model ? modelViews(drawings, f.footprint, model, profile.sitStyle) : {}), [drawings, model, f.footprint, profile.sitStyle]);
  const findings = useMemo(() => {
    const out: Partial<Record<Facing, ReturnType<typeof modelFindings>>> = {};
    if (!live) for (const g of MODEL_FACINGS) if (views[g]) out[g] = modelFindings(views[g]!, SEAT_LOOKS);
    return out;
  }, [views, live]);
  const anyBad = MODEL_FACINGS.some((g) => (findings[g]?.problems.length ?? 0) > 0);
  const status: ModelStatus = !drawings ? 'loading' : stale ? 'stale' : !stored ? 'none' : anyBad ? 'bad' : !stored.reviewed ? 'unreviewed' : 'ok';
  useEffect(() => onStatus(status), [status, onStatus]);

  /** Store a model: a changed model is no longer passed. */
  const save = (m: SeatModel, reviewed?: string) => onPatch({ seatModel: { model: tidyModel(m), for: sig, ...(reviewed ? { reviewed } : {}) } });

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
    if (!drawings) return;
    setBusy('Fitting the proxy to every facing…');
    await new Promise((r) => setTimeout(r, 30));
    try {
      const fitViews = MODEL_FACINGS.map((g) => ({ facing: g, art: seatArt(drawings, f.footprint, g)?.art })).filter((v): v is { facing: Facing; art: NonNullable<typeof v.art> } => !!v.art);
      const r = fitModel({ key: draft.key, size: [f.footprint[0], f.footprint[1]], seat: profile.seat, style: profile.sitStyle, backrest: profile.backrest, arms: !!profile.arms, views: fitViews }, undefined, { shakes: 24 });
      save(r.model);
      setPart(0);
    } finally {
      setBusy(null);
    }
  }

  /* -------------------------------------------------------------- the editor canvas */

  const cur = views[sel];
  const Z = cur ? Math.max(4, Math.min(8, Math.floor(Math.min(560 / cur.art.px.w, 520 / cur.art.px.h)))) : 6;
  const PAD = 12;
  useEffect(() => {
    const c = editor.current;
    if (!c || !cur || !model) return;
    const { px, ax, ay } = cur.art;
    c.width = px.w * Z + 2 * PAD;
    c.height = px.h * Z + 2 * PAD;
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    checker(g, c.width, c.height, Z);
    const tmp = document.createElement('canvas');
    tmp.width = px.w;
    tmp.height = px.h;
    tmp.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(px.d), px.w, px.h), 0, 0);
    g.drawImage(tmp, PAD, PAD, px.w * Z, px.h * Z);
    const X = (x: number) => PAD + x * Z;
    const Y = (y: number) => PAD + y * Z;
    model.parts.forEach((p, k) => {
      g.strokeStyle = COLOUR[p.part];
      for (const e of boxEdges([ax, ay], model.size, sel, p)) {
        g.lineWidth = k === part ? 3 : e.hidden ? 1 : 2;
        g.setLineDash(e.hidden ? [4, 4] : []);
        g.beginPath();
        g.moveTo(X(e.a[0]), Y(e.a[1]));
        g.lineTo(X(e.b[0]), Y(e.b[1]));
        g.stroke();
      }
      g.setLineDash([]);
      // the handle: the middle of its top face
      const [hx, hy] = projectLocal([ax, ay], model.size, sel, (p.u[0] + p.u[1]) / 2, (p.v[0] + p.v[1]) / 2, p.z[1]);
      g.fillStyle = COLOUR[p.part];
      g.fillRect(X(hx) - (k === part ? 6 : 4), Y(hy) - (k === part ? 6 : 4), k === part ? 12 : 8, k === part ? 12 : 8);
      g.fillStyle = '#000';
      g.font = '11px sans-serif';
      g.fillText(String(k), X(hx) - 3, Y(hy) + 4);
    });
    sitsByCushion(model, sel).forEach((s, i) => {
      if (!s) return;
      const [hx, hy] = projectLocal([ax, ay], model.size, sel, s[0], s[1], s[2]);
      g.strokeStyle = '#ffe628';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(X(hx) - 12, Y(hy));
      g.lineTo(X(hx) + 12, Y(hy));
      g.moveTo(X(hx), Y(hy) - 12);
      g.lineTo(X(hx), Y(hy) + 12);
      g.stroke();
      g.fillStyle = '#ffe628';
      g.fillText(`S${i}`, X(hx) + 6, Y(hy) + 14);
    });
  }, [cur, model, sel, part, Z]);

  const at = (e: React.MouseEvent<HTMLCanvasElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    const k = e.currentTarget.width / r.width;
    return [((e.clientX - r.left) * k - PAD) / Z, ((e.clientY - r.top) * k - PAD) / Z];
  };
  function down(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!cur || !model) return;
    const p = at(e);
    const { ax, ay } = cur.art;
    // the nearest handle within 8 drawing px: a sitting point, else a box's top
    let best: { kind: 'box' | 'sit'; i: number; d: number } | null = null;
    sitsByCushion(model, sel).forEach((s) => {
      if (!s) return;
      const [hx, hy] = projectLocal([ax, ay], model.size, sel, s[0], s[1], s[2]);
      const d = Math.hypot(hx - p[0], hy - p[1]);
      const i = model.sits.indexOf(s);
      if (d < 8 && (!best || d < best.d)) best = { kind: 'sit', i, d };
    });
    model.parts.forEach((q, i) => {
      const [hx, hy] = projectLocal([ax, ay], model.size, sel, (q.u[0] + q.u[1]) / 2, (q.v[0] + q.v[1]) / 2, q.z[1]);
      const d = Math.hypot(hx - p[0], hy - p[1]);
      if (d < 6 && (!best || d < best.d - 0.5)) best = { kind: 'box', i, d };
    });
    const b = best as { kind: 'box' | 'sit'; i: number; d: number } | null;
    if (!b) return;
    if (b.kind === 'box') setPart(b.i);
    setDrag({ kind: b.kind, i: b.i, from: p, start: model, shift: e.shiftKey });
  }
  function move(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!drag || !cur) return;
    const p = at(e);
    const { ax, ay } = cur.art;
    const m = drag.start;
    if (drag.kind === 'sit') {
      // along the cushion: the point under the pointer at the cushion's height
      const s = m.sits[drag.i];
      const w = drawingAt([ax, ay], p[0], p[1], s[2]);
      const l = worldToLocal(m.size, sel, w.x, w.y);
      const z = cushionTop(m, l.u, l.v) ?? s[2];
      const sits = m.sits.map((q, k) => (k === drag.i ? ([l.u, l.v, z] as SitPoint) : q));
      setLive({ ...m, sits });
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
    const a = worldToLocal(m.size, sel, drawingAt([ax, ay], drag.from[0], drag.from[1], q.z[1]).x, drawingAt([ax, ay], drag.from[0], drag.from[1], q.z[1]).y);
    const b = worldToLocal(m.size, sel, drawingAt([ax, ay], p[0], p[1], q.z[1]).x, drawingAt([ax, ay], p[0], p[1], q.z[1]).y);
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
          ? ['bad', 'the drawings changed: fit again']
          : status === 'none'
            ? ['bad', 'no model: press Auto-fit']
            : status === 'bad'
              ? ['bad', `${MODEL_FACINGS.filter((g) => (findings[g]?.problems.length ?? 0) > 0).length} facing(s) break the standard`]
              : ['soft', 'holds in every facing: the reviewer passes it'];
  const cp = model?.parts[part];

  return (
    <section className="lab-card rig-panel">
      <header className="card-head">
        <h3>How people sit in it</h3>
        <span className={`chip ${chip[0]}`}>{chip[1]}</span>
        <span className="muted">the seat model: its shape in 3D, one for all four facings, and where each cushion is sat on</span>
      </header>
      <div className="rig-actions">
        <button className="btn primary small" disabled={!drawings || !!busy} onClick={() => void autoFit()}>
          {busy ? 'Fitting…' : stored ? 'Auto-fit again' : 'Auto-fit'}
        </button>
        <button className="btn ghost small" disabled={!stored || anyBad || !!stored.reviewed} onClick={() => stored && save(stored.model, today())} title="the reviewer: every facing read at play scale and 4×, and it reads right">
          {stored?.reviewed ? `Passed ${stored.reviewed}` : 'Pass it (reviewer)'}
        </button>
        <label className="check small">
          <input type="checkbox" checked={symmetric} onChange={(e) => setSymmetric(e.target.checked)} /> keep it mirror-symmetric
        </label>
        {busy && <span className="muted small">{busy}</span>}
      </div>
      {!drawings ? (
        <div className="lab-empty small">loading the drawings…</div>
      ) : !model ? (
        <div className="lab-empty small">{stale ? 'The drawings changed since the model was fitted: Auto-fit again.' : 'No model yet: press Auto-fit to seed one from the drawings.'}</div>
      ) : (
        <div className="rig-body">
          <div className="rig-edit">
            <div className="seg">
              {MODEL_FACINGS.filter((g) => views[g]).map((g) => (
                <button key={g} className={g === sel ? 'on' : ''} onClick={() => setSel(g)}>
                  {g} {behindView(g) ? '(behind)' : '(front)'}
                </button>
              ))}
            </div>
            <canvas ref={editor} className="clickable rig-canvas" onMouseDown={down} onMouseMove={move} onMouseUp={up} onMouseLeave={up} />
            <p className="small muted">
              Drag a box&apos;s square to move it across the seat; shift-drag to raise or lower its top. Drag a yellow sitting point along the cushion. Colours: seat green, back magenta, arm orange, leg blue, base violet, wrap purple; dashed
              edges are hidden.
            </p>
            <div className="rig-knobs" style={{ display: 'grid', gap: 4 }}>
              <div className="seg">
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
                title="the standard: bottom back against the backrest (the middle of a backless seat), on the cushion top"
                onClick={() => save({ ...model, sits: placeSits(model.parts, model.size, model.sits.length > 1 ? model.sits.map((q) => q[0]) : undefined) })}
              >
                Sit them back against the backrest (the standard)
              </button>
              {model.sits.map((s, i) => (
                <div key={i}>
                  <b className="small">sitting point S{i}</b>
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
            {MODEL_FACINGS.filter((g) => views[g]).map((g) => (
              <FacingPreview key={g} v={views[g]!} problems={findings[g]?.problems ?? []} iou={findings[g]?.fit.iou ?? 0} mirrored={views[g]!.mirrored} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
