/**
 * Seat calibration: click the centre of the cushion in the front drawing (as the game shows it facing se), and
 * the seat standard fits the seat to it — height, hip depth, the back views' depth — then sits someone on
 * every cushion in all four facings and checks them (seatLab.ts, the same maths as scripts/seat-fit.ts).
 * Publishing waits until every facing sits right.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Pixels } from '../engine/sprites/footing';
import { profileFromPoint, seatPlacement } from '../engine/sprites/seatCheck';
import { lab, type Draft, type FurnitureSpec } from './api';
import { checker, loadImg } from './pixels';
import { fitSeat, seatArt, type Drawings, type SeatFit } from './seatLab';

export type SeatStatus = 'none' | 'loading' | 'stale' | 'bad' | 'ok';

/** Big enough to aim at a cushion: 6× for a chair, less for a sofa. */
const zoomFor = (w: number) => Math.max(3, Math.min(6, Math.floor(420 / Math.max(1, w))));

/** Which drawings (and where they stand) a calibration was made on: any change means clicking again. */
export function drawingsSignature(d: Draft): string {
  return JSON.stringify(
    Object.entries(d.views)
      .filter(([, v]) => v.file)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, v.file, v.anchor, v.nudge ?? [0, 0]]),
  );
}

async function pixelsOf(url: string): Promise<Pixels> {
  const img = await loadImg(url);
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  return { w: img.width, h: img.height, d: g.getImageData(0, 0, img.width, img.height).data };
}

function paintPixels(canvas: HTMLCanvasElement | null, px: Pixels, z: number, bad = false) {
  if (!canvas) return;
  canvas.width = px.w * z;
  canvas.height = px.h * z;
  const g = canvas.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  checker(g, canvas.width, canvas.height, 4 * z);
  const src = document.createElement('canvas');
  src.width = px.w;
  src.height = px.h;
  src.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(px.d), px.w, px.h), 0, 0);
  g.drawImage(src, 0, 0, px.w * z, px.h * z);
  if (bad) {
    g.strokeStyle = '#e0503f';
    g.lineWidth = 4;
    g.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
  }
}

function Cell({ px, bad }: { px: Pixels; bad: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => paintPixels(ref.current, px, 2, bad), [px, bad]);
  return <canvas ref={ref} />;
}

export function SeatPanel({ draft, onPatch, onStatus }: { draft: Draft; onPatch: (p: Partial<FurnitureSpec>) => void; onStatus: (s: SeatStatus) => void }) {
  const f = draft.furniture!;
  const cal = f.seatCalibration;
  const sig = drawingsSignature(draft);
  const [drawings, setDrawings] = useState<Drawings | null>(null);
  const [hover, setHover] = useState<[number, number] | null>(null);
  const front = useRef<HTMLCanvasElement>(null);

  // the draft's drawings as pixels, each with the anchor it will be published with
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

  const se = useMemo(() => (drawings ? seatArt(drawings, f.footprint, 'se') : null), [drawings, f.footprint]);
  const Z = se ? zoomFor(se.art.px.w) : 6;
  const stale = !!cal && cal.for !== sig;
  const fit: SeatFit | null = useMemo(
    () => (drawings && cal && !stale ? fitSeat(drawings, f.footprint, { sitStyle: f.sitStyle, backrest: f.backrest }, { cushion: cal.cushion, cover: cal.cover }) : null),
    [drawings, cal, stale, f.footprint, f.sitStyle, f.backrest],
  );
  const bad = fit ? fit.views.filter((v) => v.problems.length) : [];
  const status: SeatStatus = !drawings ? 'loading' : !cal ? 'none' : stale ? 'stale' : bad.length ? 'bad' : 'ok';
  useEffect(() => onStatus(status), [status, onStatus]);

  // keep the stored profile in step with the fit (sit style or backrest changed since the click)
  useEffect(() => {
    if (!fit || !cal) return;
    const p = fit.profile;
    const want = { seat: p.seat, seatDepth: p.seatDepth, backDepth: p.backDepth, ...(p.backLine ? { backLine: p.backLine as Record<'ne' | 'nw', Array<[number, number]>> } : {}) };
    if (JSON.stringify(cal.profile ?? null) !== JSON.stringify(want)) onPatch({ seatCalibration: { ...cal, profile: want }, seat: p.seat });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit]);

  // the front drawing, big, with its footprint, the clicked cushion centre and the hover readout
  useEffect(() => {
    const c = front.current;
    if (!c || !se) return;
    const { art } = se;
    paintPixels(c, art.px, Z);
    const g = c.getContext('2d')!;
    const { w, d } = seatPlacement(f.footprint, 'se');
    const V = (x: number, y: number): [number, number] => [(art.ax + (x - y) * 32) * Z, (art.ay + (x + y) * 16) * Z];
    g.strokeStyle = 'rgba(20, 140, 150, 0.9)';
    g.lineWidth = 2;
    g.beginPath();
    [V(0, 0), V(w, 0), V(w, d), V(0, d)].forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.stroke();
    const mark = (p: [number, number], color: string) => {
      const [x, y] = [p[0] * Z, p[1] * Z];
      g.strokeStyle = color;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x - 10, y);
      g.lineTo(x + 10, y);
      g.moveTo(x, y - 10);
      g.lineTo(x, y + 10);
      g.stroke();
      g.strokeRect(x - 4, y - 4, 8, 8);
    };
    // where every cushion's centre would be for the point under the pointer (same height, same depth)
    const guide = (p: [number, number], color: string) => {
      const { seat: h, seatDepth: t } = profileFromPoint(art, 'se', p);
      g.fillStyle = color;
      for (let i = 0; i < w; i++)
        for (let k = 0; k < d; k++) {
          const x = (art.ax + 32 * (i + t - k)) * Z;
          const y = (art.ay + 16 * (1 + i + t + k) - 2 * h) * Z;
          g.fillRect(x - 3, y - 3, 6, 6);
        }
      // the first cushion's centre line, front to back, at that height
      for (let s = -10; s <= 10; s++) {
        const u = s / 20;
        g.fillRect((art.ax + 32 * u) * Z - 1, (art.ay + 16 + 16 * u - 2 * h) * Z - 1, 2, 2);
      }
    };
    if (hover) {
      guide(hover, 'rgba(255, 210, 63, 0.95)');
      mark(hover, 'rgba(255, 210, 63, 0.95)');
    }
    if (cal && !stale) mark(cal.cushion, '#e0503f');
  }, [se, hover, cal, stale, f.footprint, Z]);

  const at = (e: React.MouseEvent<HTMLCanvasElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * e.currentTarget.width;
    const y = ((e.clientY - r.top) / r.height) * e.currentTarget.height;
    return [Math.round((x / Z) * 2) / 2, Math.round((y / Z) * 2) / 2];
  };
  const readout = (p: [number, number]) => {
    if (!se) return '';
    const r = profileFromPoint(se.art, 'se', p);
    return `seat ${r.seat.toFixed(1)} px up · hips ${r.seatDepth >= 0 ? '+' : ''}${r.seatDepth.toFixed(2)} tile forward`;
  };
  const place = (cushion: [number, number], cover = cal?.cover ?? false) => onPatch({ seatCalibration: { cushion, cover, for: sig } });

  return (
    <section className="lab-card seat-panel">
      <header className="card-head">
        <h3>Seat</h3>
        <span className={`chip ${status === 'ok' ? 'good' : status === 'loading' ? '' : 'bad'}`}>
          {status === 'ok' ? 'calibrated · every facing sits right' : status === 'none' ? 'not calibrated' : status === 'stale' ? 'drawing changed: click again' : status === 'bad' ? `${bad.length} facing${bad.length > 1 ? 's' : ''} wrong` : 'loading…'}
        </span>
        <span className="muted">click the centre of the first cushion’s top face, halfway front to back (yellow: where every cushion would be)</span>
      </header>
      <div className="seat-body">
        <div className="seat-front">
          {se ? (
            <canvas
              ref={front}
              className="clickable"
              onMouseMove={(e) => setHover(at(e))}
              onMouseLeave={() => setHover(null)}
              onClick={(e) => place(at(e))}
            />
          ) : (
            <div className="lab-empty small">{drawings ? 'no front drawing yet' : 'loading the drawings…'}</div>
          )}
          <p className="small mono">{hover ? `${hover[0]}, ${hover[1]} → ${readout(hover)}` : cal && !stale ? `${cal.cushion[0]}, ${cal.cushion[1]} → ${readout(cal.cushion)}` : ' '}</p>
          <label className="check">
            <input type="checkbox" checked={!!cal?.cover} disabled={!cal} onChange={(e) => cal && place(cal.cushion, e.target.checked)} /> From behind, the whole seat wraps its sitter (a beanbag; a sofa all one colour)
          </label>
          {fit && (
            <p className="small muted">
              Profile: seat {fit.profile.seat}, hips {fit.profile.seatDepth} (front) / {fit.profile.backDepth} (back), {fit.profile.sitStyle}
              {fit.profile.backrest ? ', backrest' : ', no backrest'}
            </p>
          )}
        </div>
        <div className="seat-views">
          {fit ? (
            fit.views.map((v) => (
              <figure key={v.facing} className={v.problems.length ? 'bad' : 'good'}>
                <Cell px={v.cell} bad={v.problems.length > 0} />
                <figcaption>
                  <b>{v.facing}</b> {v.problems.length ? v.problems.join(' · ') : 'sits right'}
                </figcaption>
              </figure>
            ))
          ) : (
            <div className="lab-empty small">{status === 'stale' ? 'The drawings changed since the seat was calibrated. Click the cushion again.' : 'Click the cushion: every facing appears here with someone sitting on every cushion.'}</div>
          )}
        </div>
      </div>
    </section>
  );
}
