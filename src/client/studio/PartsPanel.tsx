/**
 * How people sit in it: the seat's PARTS (src/client/engine/sprites/seatParts.ts), a click-to-confirm job. Each drawn
 * view is split into its natural colour regions; "Propose (AI)" asks a vision model which are the back, the seat, an
 * arm or a leg (art/designlab.py propose-parts; the key stays in Python, each call capped), or "Copy parts from…" takes
 * a piece drawn in the same shape; you fix it by clicking a region to cycle its part, painting (brush or polygon, colour
 * aware) where a region runs across two parts, and dragging a hip dot per cushion. Fixed rules compile the parts into
 * the rig on every change (what of the seat is drawn over a sitter), and every facing previews live — three looks,
 * every cushion taken, play scale and 4× — with the rig's checks and a "looks right" tick. Publishing waits for a part
 * map in every drawn view, compiled, holding, and ticked in all four facings.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Facing } from '@shared/world/scene';
import { fromBehind, RIG_FACINGS, RIG_MIRROR, tidyRig, type Pt, type SeatRig } from '@shared/world/seatRigs';
import { checkRigView, inferRig, rigCushions } from '../engine/sprites/seatRig';
import {
  armSides,
  compileFront,
  compileRig,
  decodeParts,
  isCompiled,
  likeColour,
  nextPart,
  paintPixels,
  paintPoly,
  PART,
  PART_NAMES,
  PART_RGB,
  partsFromString,
  partsToString,
  regionPart,
  regions,
  setRegion,
  transferParts,
  type PartName,
} from '../engine/sprites/seatParts';
import { lab, type Draft, type DraftParts, type FurnitureSpec, type Usage } from './api';
import { Confirm, usd } from './common';
import { checker } from './pixels';
import { FacingPreview, pixelsOf, rigSignature } from './rigPreview';
import { labProfile, labViews, ownFacings, rigOf, type DraftRig, type LabView } from './rigLab';
import { seatArt, type Drawings } from './seatLab';

export type PartsStatus = 'loading' | 'none' | 'stale' | 'uncompiled' | 'bad' | 'unticked' | 'ok';

type Tool = 'click' | 'brush' | 'poly';
type Note = NonNullable<DraftParts['proposal']>[Facing];

const today = () => new Date().toISOString().slice(0, 10);
const zoomFor = (w: number, h: number) => Math.max(4, Math.min(10, Math.floor(Math.min(640 / w, 560 / h))));
const rgba = (part: number, a: number) => `rgba(${PART_RGB[part].join(', ')}, ${a})`;
const HINT: Record<PartName, string> = {
  back: 'from behind: always in front',
  seat: 'from behind: in front below the hips',
  arm: 'the near arm, below its top: in front',
  leg: 'from behind: in front below the hips',
  other: 'never in front',
};

export function PartsPanel({ draft, usage, onPatch, onStatus, onUsage }: { draft: Draft; usage: Usage | null; onPatch: (p: Partial<FurnitureSpec>) => void; onStatus: (s: PartsStatus) => void; onUsage: () => void }) {
  const f = draft.furniture!;
  const sig = rigSignature(draft);
  const [drawings, setDrawings] = useState<Drawings | null>(null);
  const [sel, setSel] = useState<Facing | null>(null);
  const [tool, setTool] = useState<Tool>('click');
  const [paint, setPaint] = useState<number>(PART.back);
  const [brush, setBrush] = useState(1);
  const [like, setLike] = useState(false);
  const [show, setShow] = useState<'parts' | 'front'>('parts');
  const [hover, setHover] = useState<Pt | null>(null);
  const [drag, setDrag] = useState<{ i: number; at: Pt } | null>(null);
  const [poly, setPoly] = useState<Pt[]>([]);
  const [stroke, setStroke] = useState<{ parts: Uint8Array; only?: (p: number) => boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [catalog, setCatalog] = useState<Record<string, Facing[]> | null>(null);
  const [copyKey, setCopyKey] = useState('');
  const editor = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let live = true;
    setDrawings(null);
    void (async () => {
      const out: Drawings = {};
      for (const [name, v] of Object.entries(draft.views)) {
        if (!v.file) continue;
        const px = await pixelsOf(lab.fileUrl(draft.id, v.file, String(v.take)));
        out[name as keyof Drawings] = { px, anchor: [(v.anchor?.[0] ?? 0) + (v.nudge?.[0] ?? 0), (v.anchor?.[1] ?? 0) + (v.nudge?.[1] ?? 0)] };
      }
      if (live) setDrawings(out);
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.id, sig]);
  useEffect(() => {
    void lab.seatParts().then(setCatalog, () => setCatalog({}));
  }, []);

  const profile = labProfile(draft.key, f);
  const views = useMemo(() => (drawings ? labViews(drawings, f.footprint, profile) : {}), [drawings, f.footprint, profile.seat, profile.sitStyle, profile.backrest, profile.arms]); // eslint-disable-line react-hooks/exhaustive-deps
  const own = ownFacings(views);
  const facing = sel && own.includes(sel) ? sel : own[0];
  const staleParts = !!f.seatParts && f.seatParts.for !== sig;
  const stored: DraftParts | null = f.seatParts && !staleParts ? f.seatParts : null;
  const rig: DraftRig | null = f.seatRig && f.seatRig.for === sig ? f.seatRig : null;

  // each own view's regions, part map, near arms and hips
  const labs = useMemo(() => {
    const out: Partial<Record<Facing, Int32Array>> = {};
    for (const g of own) out[g] = regions(views[g]!.art.px);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [views]);
  const partsMap = useMemo(() => {
    const out: Partial<Record<Facing, Uint8Array | null>> = {};
    for (const g of own) {
      const { w, h } = views[g]!.art.px;
      const t = stored?.views[g];
      out[g] = t ? partsFromString(t, w * h) : null;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [views, JSON.stringify(stored?.views ?? {})]);
  const hipsOf = (g: Facing): Pt[] => {
    const v = views[g]!;
    const n = rigCushions(v.footprint, g).length;
    const have = rig?.views[g]?.hips;
    return have && have.length === n ? have : inferRig(v, profile, v.mirrored).rig.hips;
  };

  // the checks: every facing's rig (its own, or its partner's mirrored) by the standard
  const problems = useMemo(() => {
    const out: Partial<Record<Facing, string[]>> = {};
    for (const g of RIG_FACINGS) {
      const v = views[g];
      if (!v) continue;
      const r = rigOf(draft.key, rig, views, g);
      out[g] = r ? checkRigView(v, r) : [];
    }
    return out;
  }, [draft.key, rig, views]);
  const compiled = (g: Facing) => {
    const p = partsMap[g];
    const r = rig?.views[g];
    const { w, h } = views[g]!.art.px;
    return !!p && !!r && isCompiled(r, g, w, h, p);
  };
  const complete = own.length > 0 && own.every((g) => partsMap[g]);
  const allCompiled = complete && own.every(compiled);
  const anyBad = RIG_FACINGS.some((g) => views[g] && (problems[g]?.length ?? 0) > 0);
  const allTicked = RIG_FACINGS.every((g) => !views[g] || rig?.ok[g]);
  const status: PartsStatus = !drawings ? 'loading' : staleParts ? 'stale' : !complete ? 'none' : !allCompiled ? 'uncompiled' : anyBad ? 'bad' : !allTicked ? 'unticked' : 'ok';
  useEffect(() => onStatus(status), [status, onStatus]);

  /**
   * Change parts and hips, and compile: each changed view's rig is its part map through the rules (hips kept), and a
   * view whose rig changes loses its tick, and so does the facing drawn as its mirror.
   */
  function commit(changes: Partial<Record<Facing, { parts?: Uint8Array; hips?: Pt[] }>>, notes: Partial<Record<Facing, Note>> = {}) {
    const next: DraftParts = { views: { ...(stored?.views ?? {}) }, for: sig };
    const proposal = { ...(stored?.proposal ?? {}), ...notes };
    if (Object.keys(proposal).length) next.proposal = proposal;
    const r: DraftRig = rig ? structuredClone(rig) : { views: {}, ok: {}, for: sig };
    r.for = sig;
    for (const [g, c] of Object.entries(changes) as Array<[Facing, { parts?: Uint8Array; hips?: Pt[] }]>) {
      const v = views[g]!;
      const { w, h } = v.art.px;
      const parts = c.parts ?? partsMap[g] ?? null;
      if (c.parts) next.views[g] = partsToString(c.parts);
      const before = r.views[g];
      const base: SeatRig = { ...(before ?? { front: [], legs: fromBehind(g) ? 'hide' : 'show' }), hips: c.hips ?? hipsOf(g) };
      const rigNow = parts ? compileRig(base, g, w, h, parts).rig : tidyRig(base);
      const same = before && JSON.stringify(before.front) === JSON.stringify(rigNow.front) && JSON.stringify(before.hips) === JSON.stringify(rigNow.hips) && before.legs === rigNow.legs;
      r.views[g] = rigNow;
      if (!same) {
        delete r.ok[g];
        if (views[RIG_MIRROR[g]]?.mirrored) delete r.ok[RIG_MIRROR[g]];
      }
    }
    onPatch({ seatParts: next, seatRig: r });
  }

  /* ------------------------------------------------------------------ the proposal and the copy */

  const perView = usage?.parts?.estimate ?? null;
  const est = perView === null ? null : perView * own.length;

  async function propose() {
    setAsking(false);
    setError(null);
    const changes: Partial<Record<Facing, { parts: Uint8Array }>> = {};
    const notes: Partial<Record<Facing, Note>> = {};
    try {
      for (const [i, g] of own.entries()) {
        setBusy(`Asking ${usage?.parts?.model ?? 'the vision model'} about the ${g} view (${i + 1} of ${own.length})…`);
        const res = await lab.proposeParts(draft.id, g);
        const { w, h } = views[g]!.art.px;
        const parts = res.w === w && res.h === h ? partsFromString(res.parts, w * h) : null;
        if (!parts) throw new Error(`the ${g} proposal doesn't fit its drawing: reload and try again`);
        changes[g] = { parts };
        notes[g] = { by: 'ai', at: today(), usd: res.usd, model: res.model, ...(res.notes ? { notes: res.notes } : {}) };
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (Object.keys(changes).length) commit(changes, notes);
      setBusy(null);
      onUsage();
    }
  }

  const sources = useMemo(
    () =>
      Object.entries(catalog ?? {})
        .filter(([, fs]) => own.every((g) => fs.includes(g)))
        .map(([k]) => k)
        .sort((a, b) => Number(b.split('.')[0] === draft.key.split('.')[0]) - Number(a.split('.')[0] === draft.key.split('.')[0]) || a.localeCompare(b)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalog, own.join()],
  );

  /** A piece drawn in the same shape (a colour variant) gives its part maps: each pixel the nearest labelled one's part. */
  async function copyFrom(key: string) {
    setError(null);
    setBusy(`Copying the parts of ${key}…`);
    try {
      const base = lab.artBase(draft.id);
      const m = (await (await fetch(`${base}/art/manifest.json`)).json()) as { sprites: Record<string, { file?: string; anchor?: [number, number]; footprint: [number, number]; facings?: Record<string, { file: string; anchor?: [number, number] }> }> };
      const e = m.sprites[key];
      if (!e) throw new Error(`no ${key} in the catalog`);
      const src: Drawings = {};
      if (e.facings) for (const [name, rec] of Object.entries(e.facings)) src[name as Facing] = { px: await pixelsOf(`${base}/art/sprites/${rec.file}`), anchor: rec.anchor ?? [0, 0] };
      else if (e.file) src.one = { px: await pixelsOf(`${base}/art/sprites/${e.file}`), anchor: e.anchor ?? [0, 0] };
      const changes: Partial<Record<Facing, { parts: Uint8Array }>> = {};
      const notes: Partial<Record<Facing, Note>> = {};
      const skipped: string[] = [];
      for (const g of own) {
        const s = seatArt(src, e.footprint, g);
        if (!s || s.mirrored || !catalog?.[key]?.includes(g)) {
          skipped.push(g);
          continue;
        }
        const map = decodeParts(await pixelsOf(lab.seatPartUrl(key, g)));
        if (map.length !== s.art.px.w * s.art.px.h) {
          skipped.push(g);
          continue;
        }
        changes[g] = { parts: transferParts(map, s.art.px, views[g]!.art.px) };
        notes[g] = { by: 'copy', at: today(), from: key };
      }
      if (skipped.length) setError(`${key} has no part map for ${skipped.join(', ')} in the same shape: those views are unchanged`);
      if (Object.keys(changes).length) commit(changes, notes);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  /* ------------------------------------------------------------------ the editor */

  const cur: LabView | undefined = facing ? views[facing] : undefined;
  const curLab = facing ? labs[facing] : undefined;
  const curParts = stroke?.parts ?? (facing ? (partsMap[facing] ?? null) : null);
  const curHips = facing && cur ? hipsOf(facing).map((h, i) => (drag?.i === i ? drag.at : h)) : [];
  const Z = cur ? zoomFor(cur.art.px.w, cur.art.px.h) : 6;
  const front = useMemo(() => (cur && facing && curParts ? compileFront(facing, cur.art.px.w, cur.art.px.h, curParts, curHips) : null), [cur, facing, curParts, JSON.stringify(curHips)]); // eslint-disable-line react-hooks/exhaustive-deps
  const near = useMemo(() => (cur && facing && curParts ? armSides(facing, cur.art.px.w, cur.art.px.h, curParts, curHips) : null), [cur, facing, curParts, JSON.stringify(curHips)]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => {
    const n = new Array<number>(6).fill(0);
    if (curParts) for (const p of curParts) n[p]++;
    return n;
  }, [curParts]);

  useEffect(() => {
    const c = editor.current;
    if (!c || !cur || !curLab) return;
    const { px } = cur.art;
    c.width = px.w * Z;
    c.height = px.h * Z;
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    checker(g, c.width, c.height, 4 * Z);
    const tmp = document.createElement('canvas');
    tmp.width = px.w;
    tmp.height = px.h;
    tmp.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(px.d), px.w, px.h), 0, 0);
    g.drawImage(tmp, 0, 0, c.width, c.height);
    const hk = hover && hover[0] >= 0 && hover[1] >= 0 && hover[0] < px.w && hover[1] < px.h ? curLab[Math.floor(hover[1]) * px.w + Math.floor(hover[0])] : 0;
    for (let y = 0; y < px.h; y++)
      for (let x = 0; x < px.w; x++) {
        const i = y * px.w + x;
        if (!curLab[i]) continue;
        if (show === 'parts' && curParts?.[i]) {
          g.fillStyle = rgba(curParts[i], 0.5);
          g.fillRect(x * Z, y * Z, Z, Z);
          // a near arm (in front below its top) hatched
          if (near?.[i] && (x + y) % 3 === 0) {
            g.fillStyle = 'rgba(10, 60, 20, 0.55)';
            g.fillRect(x * Z, y * Z, Z, Z);
          }
        } else if (show === 'front') {
          g.fillStyle = front?.[i] ? 'rgba(255, 150, 40, 0.75)' : 'rgba(20, 16, 28, 0.5)';
          g.fillRect(x * Z, y * Z, Z, Z);
        }
        if (tool === 'click' && hk && curLab[i] === hk) {
          g.fillStyle = 'rgba(255, 255, 255, 0.35)';
          g.fillRect(x * Z, y * Z, Z, Z);
        }
        // region borders
        g.fillStyle = 'rgba(20, 16, 28, 0.55)';
        if (x + 1 < px.w && curLab[i + 1] && curLab[i + 1] !== curLab[i]) g.fillRect((x + 1) * Z - 1, y * Z, 1, Z);
        if (y + 1 < px.h && curLab[i + px.w] && curLab[i + px.w] !== curLab[i]) g.fillRect(x * Z, (y + 1) * Z - 1, Z, 1);
      }
    // the polygon being drawn
    if (poly.length) {
      g.strokeStyle = rgba(paint, 1);
      g.fillStyle = rgba(paint, 0.25);
      g.lineWidth = 2;
      g.beginPath();
      poly.forEach(([x, y], k) => (k ? g.lineTo(x * Z, y * Z) : g.moveTo(x * Z, y * Z)));
      if (hover) g.lineTo(hover[0] * Z, hover[1] * Z);
      g.closePath();
      g.fill();
      g.stroke();
      for (const [x, y] of poly) g.fillRect(x * Z - 3, y * Z - 3, 6, 6);
    }
    // the hips, one per cushion
    g.font = 'bold 11px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    curHips.forEach(([x, y], i) => {
      g.strokeStyle = '#2a1f2d';
      g.lineWidth = 4;
      g.beginPath();
      g.arc(x * Z, y * Z, 8, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = '#ffd23f';
      g.beginPath();
      g.arc(x * Z, y * Z, 7, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#2a1f2d';
      g.fillText(String(i + 1), x * Z, y * Z + 0.5);
    });
  }, [cur, curLab, curParts, near, front, hover, poly, paint, show, tool, Z, JSON.stringify(curHips)]); // eslint-disable-line react-hooks/exhaustive-deps

  const at = (e: React.MouseEvent<HTMLCanvasElement>): Pt => {
    const r = e.currentTarget.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * (e.currentTarget.width / Z), ((e.clientY - r.top) / r.height) * (e.currentTarget.height / Z)];
  };
  const hipNear = (p: Pt) => curHips.findIndex(([x, y]) => Math.hypot(x - p[0], y - p[1]) * Z < 12);
  /** The part map to edit: the view's own, or every region "other" to start from. */
  const editable = (): Uint8Array => (curParts ? curParts.slice() : Uint8Array.from(curLab!, (l) => (l ? PART.other : 0)));
  /** Only pixels like the colour under `p` (the colour-aware paint), when it's on. */
  const onlyAt = (p: Pt) => {
    if (!like || !cur) return undefined;
    const i = (Math.floor(p[1]) * cur.art.px.w + Math.floor(p[0])) * 4;
    const d = cur.art.px.d;
    return d[i + 3] ? likeColour(cur.art.px, [d[i], d[i + 1], d[i + 2]]) : undefined;
  };

  function closePoly(pts = poly) {
    if (!facing || !cur || !curLab || pts.length < 3) return setPoly([]);
    const next = paintPoly(editable(), curLab, cur.art.px.w, pts, paint, onlyAt(pts[0]));
    setPoly([]);
    commit({ [facing]: { parts: next } });
  }

  function down(e: React.MouseEvent<HTMLCanvasElement>) {
    e.currentTarget.focus();
    if (!cur || !facing || !curLab || busy) return;
    const p = at(e);
    const h = hipNear(p);
    if (h >= 0 && tool !== 'poly') return setDrag({ i: h, at: p });
    const { w, h: H } = cur.art.px;
    const x = Math.floor(p[0]);
    const y = Math.floor(p[1]);
    if (tool === 'poly') {
      if (poly.length >= 3 && Math.hypot(p[0] - poly[0][0], p[1] - poly[0][1]) * Z < 10) closePoly();
      else setPoly([...poly, [Math.round(p[0] * 2) / 2, Math.round(p[1] * 2) / 2]]);
      return;
    }
    if (x < 0 || y < 0 || x >= w || y >= H) return;
    if (tool === 'brush') {
      const only = onlyAt(p);
      setStroke({ parts: paintPixels(editable(), curLab, w, H, [p], paint, brush - 1, only), only });
      return;
    }
    const k = curLab[y * w + x];
    if (!k) return;
    const parts = editable();
    // click: the next part; shift-click: the part picked in the palette; right-click: the one before
    const was = regionPart(parts, curLab, k);
    const to = e.shiftKey ? paint : e.button === 2 ? PART[PART_NAMES[(PART_NAMES.findIndex((n) => PART[n] === was) + PART_NAMES.length - 1) % PART_NAMES.length]] : nextPart(was);
    commit({ [facing]: { parts: setRegion(parts, curLab, k, to) } });
  }
  function move(e: React.MouseEvent<HTMLCanvasElement>) {
    const p = at(e);
    setHover(p);
    if (drag) setDrag({ ...drag, at: p });
    if (stroke && cur && curLab) setStroke({ ...stroke, parts: paintPixels(stroke.parts.slice(), curLab, cur.art.px.w, cur.art.px.h, [p], paint, brush - 1, stroke.only) });
  }
  function up() {
    if (drag && facing) {
      const hips = hipsOf(facing).map((h, i) => (i === drag.i ? ([Math.round(drag.at[0] * 2) / 2, Math.round(drag.at[1] * 2) / 2] as Pt) : h));
      commit({ [facing]: { hips } });
    }
    setDrag(null);
    if (stroke && facing) commit({ [facing]: { parts: stroke.parts } });
    setStroke(null);
  }
  function key(e: React.KeyboardEvent) {
    const n = Number(e.key);
    if (n >= 1 && n <= 5) setPaint(PART[PART_NAMES[n - 1]]);
    else if (e.key === 'Escape') setPoly([]);
    else if (e.key === 'Enter') closePoly();
    else if (e.key === 'Backspace') setPoly(poly.slice(0, -1));
    else return;
    e.preventDefault();
  }

  const chip: [string, string] =
    status === 'ok'
      ? ['good', 'parts compiled · every facing holds and is ticked']
      : status === 'loading'
        ? ['', 'loading…']
        : status === 'stale'
          ? ['bad', 'the drawings changed: propose again']
          : status === 'none'
            ? ['bad', `no parts for ${own.filter((g) => !partsMap[g]).join(', ') || 'it'} yet: Propose (AI) or copy them`]
            : status === 'uncompiled'
              ? ['bad', 'the rig isn’t what the parts compile to: press Compile']
              : status === 'bad'
                ? ['bad', `${RIG_FACINGS.filter((g) => (problems[g]?.length ?? 0) > 0).length} facing(s) break the standard`]
                : ['soft', `${RIG_FACINGS.filter((g) => views[g] && !rig?.ok[g]).length} facing(s) to tick “looks right”`];
  const note = facing ? stored?.proposal?.[facing] : undefined;
  const hoverAt = hover && cur && curLab && hover[0] >= 0 && hover[1] >= 0 && hover[0] < cur.art.px.w && hover[1] < cur.art.px.h ? Math.floor(hover[1]) * cur.art.px.w + Math.floor(hover[0]) : -1;
  const hoverPart = hoverAt >= 0 && curParts ? PART_NAMES.find((n) => PART[n] === curParts[hoverAt]) : undefined;

  return (
    <section className="lab-card rig-panel parts-panel">
      <header className="card-head">
        <h3>How people sit in it</h3>
        <span className={`chip ${chip[0]}`} data-status={status}>
          {chip[1]}
        </span>
        <span className="muted">its parts — back, seat, arms, legs — and fixed rules give what of the seat is drawn over a seated person</span>
      </header>
      <div className="rig-actions">
        <button className="btn primary small" disabled={!drawings || !own.length || !!busy} onClick={() => setAsking(true)} title="a vision model labels every region; you check it">
          {complete ? 'Propose again (AI)' : 'Propose (AI)'} <small>{perView === null ? 'cost: first call' : `≈ ${usd(perView, 3)} a view × ${own.length}`}</small>
        </button>
        <span className="copy-from">
          <select value={copyKey} onChange={(e) => setCopyKey(e.target.value)} disabled={!!busy || !sources.length} title="a piece drawn in the same shape, e.g. another colour of it">
            <option value="">{sources.length ? 'Copy parts from…' : 'no part maps to copy yet'}</option>
            {sources.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <button className="btn ghost small" disabled={!copyKey || !!busy || !drawings} onClick={() => void copyFrom(copyKey)}>
            Copy
          </button>
        </span>
        {status === 'uncompiled' && (
          <button className="btn ghost small" onClick={() => commit(Object.fromEntries(own.map((g) => [g, {}])))}>
            Compile
          </button>
        )}
        {busy && (
          <span className="muted small">
            <span className="spinner" /> {busy}
          </span>
        )}
        {error && <span className="bad small">{error}</span>}
      </div>
      {!drawings ? (
        <div className="lab-empty small">loading the drawings…</div>
      ) : !own.length ? (
        <div className="lab-empty small">no drawings yet</div>
      ) : (
        <div className="rig-body">
          <div className="rig-edit parts-edit">
            <div className="parts-bar">
              <div className="seg">
                {own.map((g) => (
                  <button key={g} className={g === facing ? 'on' : ''} onClick={() => (setSel(g), setPoly([]))} title={partsMap[g] ? 'has its parts' : 'no parts yet'}>
                    {g} {fromBehind(g) ? '(behind)' : '(front)'} <span className={`dot ${partsMap[g] ? 'good' : 'bad'}`} />
                  </button>
                ))}
              </div>
              <div className="seg">
                {(
                  [
                    ['click', 'Regions', 'click a region: its next part · shift-click: the picked part · right-click: the one before'],
                    ['brush', 'Brush', 'drag to paint the picked part'],
                    ['poly', 'Polygon', 'click the corners, then click the first (or Enter) to paint the picked part inside; Esc cancels'],
                  ] as Array<[Tool, string, string]>
                ).map(([t, label, title]) => (
                  <button key={t} className={tool === t ? 'on' : ''} title={title} onClick={() => (setTool(t), setPoly([]))}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="seg">
                <button className={show === 'parts' ? 'on' : ''} onClick={() => setShow('parts')} title="the parts, tinted">
                  Parts
                </button>
                <button className={show === 'front' ? 'on' : ''} onClick={() => setShow('front')} title="what the rules put in front of a sitter (orange)">
                  In front
                </button>
              </div>
            </div>
            <div className="parts-palette">
              {PART_NAMES.map((n, k) => (
                <button key={n} className={`part-swatch ${paint === PART[n] ? 'on' : ''}`} onClick={() => setPaint(PART[n])} title={`${k + 1}: ${HINT[n]}`}>
                  <i style={{ background: rgba(PART[n], 1) }} /> {n} <span className="muted">{counts[PART[n]] || ''}</span>
                </button>
              ))}
              {tool === 'brush' && (
                <label className="check" title="brush size">
                  size
                  <input type="range" min={1} max={4} value={brush} onChange={(e) => setBrush(Number(e.target.value))} />
                </label>
              )}
              {tool !== 'click' && (
                <label className="check" title="paint only pixels like the colour where you start (the first corner, or the first brush dab): a spindle among slats, a frame in the fabric">
                  <input type="checkbox" checked={like} onChange={(e) => setLike(e.target.checked)} /> only this colour
                </label>
              )}
            </div>
            <canvas
              ref={editor}
              tabIndex={0}
              className="clickable rig-canvas parts-canvas"
              data-zoom={Z}
              onMouseDown={down}
              onMouseMove={move}
              onMouseUp={up}
              onMouseLeave={() => {
                setHover(null);
                up();
              }}
              onKeyDown={key}
              onContextMenu={(e) => e.preventDefault()}
            />
            <p className="small muted">
              {tool === 'click'
                ? 'Click a region to cycle it: back → seat → arm → leg → other. Shift-click sets the picked part; right-click goes back one. Drag the yellow hips (one per cushion) onto where each sitter’s seat rests.'
                : tool === 'brush'
                  ? 'Drag to paint the picked part (keys 1–5 pick it) where a region runs across two parts.'
                  : 'Click corners around the pixels to set, then click the first corner (or Enter). Backspace drops a corner, Esc cancels.'}
              {hoverAt >= 0 ? ` · ${Math.floor(hover![0])}, ${Math.floor(hover![1])} · region ${curLab![hoverAt] || '—'}${hoverPart ? ` · ${hoverPart}` : ''}${near?.[hoverAt] ? ' (near arm)' : ''}` : ''}
            </p>
            {note && (
              <p className="small">
                {note.by === 'ai' ? `Proposed by ${note.model} on ${note.at}${note.usd !== undefined ? ` (${usd(note.usd, 4)})` : ''}.` : `Copied from ${note.from} on ${note.at}.`}{' '}
                {note.notes ? <span className="muted">“{note.notes}”</span> : null}
              </p>
            )}
            <p className="small muted">
              The rules: from behind, the back is in front of a sitter, and so are the near arm (below its top) and the seat and legs below the hips; from the front, only the near arm (below its top). The hatched arm is the near one.
            </p>
          </div>
          <div className="rig-facings">
            {RIG_FACINGS.filter((g) => views[g]).map((g) => {
              const v = views[g]!;
              const src = v.mirrored ? RIG_MIRROR[g] : g;
              const passed: string[] = [];
              const wrong: string[] = [];
              if (views[src] && !views[src]!.mirrored) {
                if (!partsMap[src]) wrong.push(`no part map${v.mirrored ? ` (for ${src}, whose mirror it is)` : ''} yet`);
                else if (!compiled(src)) wrong.push('the rig isn’t what the parts compile to');
                else passed.push(`parts compiled${v.mirrored ? ` (${src}’s, mirrored)` : ''}`);
              }
              const found = problems[g] ?? [];
              if (partsMap[src] && !found.length) passed.push('holds by the standard: hips on their cushions, heads show, no holes');
              return (
                <FacingPreview
                  key={g}
                  v={v}
                  rig={rigOf(draft.key, rig, views, g)}
                  problems={[...wrong, ...found]}
                  passed={passed}
                  ok={!!rig?.ok[g]}
                  mirrorOf={v.mirrored ? RIG_MIRROR[g] : undefined}
                  onTick={(on) => {
                    const r: DraftRig = rig ? structuredClone(rig) : { views: {}, ok: {}, for: sig };
                    if (on) r.ok[g] = today();
                    else delete r.ok[g];
                    onPatch({ seatRig: r });
                  }}
                />
              );
            })}
          </div>
        </div>
      )}
      {asking && (
        <Confirm
          title="Propose the parts?"
          usage={usage}
          est={est}
          verb="propose"
          note={`Each view goes to ${usage?.parts?.model ?? 'the vision model'} as the drawing and its numbered regions (about ten seconds a view); no call can cost more than ${usd(usage?.parts?.cap ?? 0.05, 2)}. The key stays on the server.`}
          onCancel={() => setAsking(false)}
          onOk={() => void propose()}
        >
          <p>
            A vision model labels every region of {own.length === 1 ? 'the drawing' : `its ${own.length} drawn views (${own.join(', ')})`} as back, seat, arm, leg or other. You check it here, a click at a time.
            {complete ? ' It replaces the parts you have now.' : ''}
          </p>
        </Confirm>
      )}
    </section>
  );
}
