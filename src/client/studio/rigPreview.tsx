/**
 * A seat's rig, previewed the way the game draws it (src/client/engine/sprites/seatRig.ts composeRig: the seat, each
 * sitter back to front, its front layer over them): per facing, three looks — short hair and a tee, long hair, a bulky
 * coat and a hat — with every cushion taken, at play scale and 4×, and the sit-down → seated → stand-up loop; the
 * view's checks and its "looks right" tick. The Parts panel (PartsPanel.tsx) and the model panel share it.
 */
import { useEffect, useMemo, useRef } from 'react';
import type { Facing } from '@shared/world/scene';
import { FIG, figAx, fromBehind, type SeatRig } from '@shared/world/seatRigs';
import type { Pixels } from '../engine/sprites/footing';
import { composeRig, RIG_LOOKS, seatedSitters, sitFrames, type RigSitter } from '../engine/sprites/seatRig';
import type { Draft } from './api';
import { loadImg } from './pixels';
import type { LabView } from './rigLab';

/** Which drawings (and where they stand) a rig or a part map was made on: any change and it's redone. */
export function rigSignature(d: Draft): string {
  return JSON.stringify(
    Object.entries(d.views)
      .filter(([, v]) => v.file)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, v.file, v.anchor, v.nudge ?? [0, 0]]),
  );
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

function boundsOf(v: LabView, sets: RigSitter[][]) {
  let l = 0;
  let t = 0;
  let r = v.art.px.w;
  let b = v.art.px.h;
  for (const s of sets.flat()) {
    const ax = figAx(s.facing);
    l = Math.min(l, s.feet[0] - ax + 16);
    r = Math.max(r, s.feet[0] - ax + FIG.w - 16);
    t = Math.min(t, s.feet[1] - FIG.feet + 22);
    b = Math.max(b, s.feet[1] - FIG.feet + FIG.h - 4);
  }
  return { l: l - 4, t: t - 4, r: r + 4, b: b + 4 };
}

function cellCanvas(v: LabView, rig: SeatRig, sitters: RigSitter[], box: ReturnType<typeof boundsOf>): HTMLCanvasElement {
  const W = box.r - box.l;
  const H = box.b - box.t;
  const comp = composeRig(v.art, rig, sitters, { size: [W, H], origin: [-box.l, -box.t] });
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

/** One facing: three looks at play scale and 4×, the sit-down → seated → stand-up loop, its checks and its tick. */
export function FacingPreview({
  v,
  rig,
  problems,
  passed = [],
  ok,
  mirrorOf,
  onTick,
}: {
  v: LabView;
  rig: SeatRig | null;
  /** What's wrong with it (the tick waits until there's nothing). */
  problems: string[];
  /** What holds (shown ticked). */
  passed?: string[];
  ok: boolean;
  mirrorOf?: Facing;
  onTick: (on: boolean) => void;
}) {
  const still = useRef<HTMLCanvasElement>(null);
  const loop = useRef<HTMLCanvasElement>(null);
  const frames = useMemo(() => {
    if (!rig || rig.hips.length === 0) return null;
    const sets = RIG_LOOKS.map((_, k) => seatedSitters(v, rig, RIG_LOOKS, k));
    const moves = sitFrames(v, rig, RIG_LOOKS[0]);
    const box = boundsOf(v, [...sets, moves]);
    const others = seatedSitters(v, rig, RIG_LOOKS, 1).slice(1);
    return { cells: sets.map((s) => cellCanvas(v, rig, s, box)), film: moves.map((m) => cellCanvas(v, rig, [m, ...others], box)) };
  }, [v, rig]);
  useEffect(() => {
    const c = still.current;
    if (!c || !frames) return;
    const { cells } = frames;
    // play scale (one drawing px per screen px, the game at zoom 2) on top, 4× under it
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
    if (!c || !frames) return;
    const { film } = frames;
    c.width = film[0].width * 2;
    c.height = film[0].height * 2;
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    // a frame every 160 ms, holding a while on the seated frame (the 7th) and the standing ones at the ends
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
    <figure className={`rig-facing ${problems.length ? 'bad' : ok ? 'good' : ''}`} data-facing={v.facing}>
      <figcaption>
        <b>{v.facing}</b> {fromBehind(v.facing) ? 'from behind' : 'from the front'}
        {mirrorOf && <span className="muted"> · mirror of {mirrorOf}</span>}
        <label className="check tick" title={problems.length ? 'fix what the checks find first' : 'you looked at every look, still and moving, and it reads right'}>
          <input type="checkbox" checked={ok} disabled={!rig || problems.length > 0} onChange={(e) => onTick(e.target.checked)} /> looks right
        </label>
      </figcaption>
      {rig && frames ? (
        <div className="rig-preview">
          <canvas ref={still} />
          <canvas ref={loop} className="rig-loop" title="sit down, sit, stand up" />
        </div>
      ) : (
        <div className="lab-empty tiny">no rig yet</div>
      )}
      {(problems.length > 0 || passed.length > 0) && (
        <ul className="rig-checks">
          {problems.slice(0, 6).map((p) => (
            <li key={p} className="bad">
              {p}
            </li>
          ))}
          {problems.length > 6 && <li className="bad">…and {problems.length - 6} more</li>}
          {passed.map((p) => (
            <li key={p} className="good">
              {p}
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}
