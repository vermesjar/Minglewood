/** Automatic seating compilation and a read-only preview of every occupied view. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { MODEL_FACINGS, SEAT_LOOKS } from '@shared/world/seatModels';
import type { Facing } from '@shared/world/scene';
import { compileSeat, seatCompileSignature, SEAT_COMPILER_VERSION } from '../engine/sprites/seatCompiler';
import { composeSeat, seatLayers, seatProblems } from '../engine/sprites/seatLayers';
import type { FitInput } from '../engine/sprites/seatModelFit';
import { lab, type Draft, type FurnitureSpec, type SeatReviewStatus } from './api';
import { drawingsSignature, loadDrawings, seatArt, type Drawings } from './seatLab';
import { SeatPixelViewer } from './SeatPixelViewer';
import { SeatMotionViewer } from './SeatMotionViewer';

export type ModelStatus = 'loading' | 'none' | 'stale' | 'bad' | 'unreviewed' | 'ok';
const DIRECTIONS: Record<Facing, string> = { se: 'Front right', sw: 'Front left', ne: 'Rear right', nw: 'Rear left' };

function Preview({ input, model, facing, cushion, scale }: {
  input: FitInput; model: NonNullable<FurnitureSpec['seatModel']>['model']; facing: Facing; cushion: number | null; scale: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const view = input.views.find((v) => v.facing === facing);
    if (!c || !view) return;
    const v = { ...view, model, style: input.style };
    const n = seatLayers(v).sits.length;
    const comps = SEAT_LOOKS.map((_, index) => composeSeat(v,
      Array.from({ length: n }, (_, i) => ({ cushion: i, look: SEAT_LOOKS[(index + i) % SEAT_LOOKS.length] }))
        .filter((s) => cushion === null || s.cushion === cushion), 48).px);
    let l = comps[0].w, t = comps[0].h, r = 0, b = 0;
    for (const p of comps) for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) if (p.d[(y * p.w + x) * 4 + 3]) {
      l = Math.min(l, x); t = Math.min(t, y); r = Math.max(r, x); b = Math.max(b, y);
    }
    const w = r - l + 9, h = b - t + 9;
    c.width = w * comps.length * scale;
    c.height = h * scale;
    const g = c.getContext('2d')!;
    g.fillStyle = '#cdb89a'; g.fillRect(0, 0, c.width, c.height); g.imageSmoothingEnabled = false;
    comps.forEach((p, i) => {
      const tmp = document.createElement('canvas'); tmp.width = p.w; tmp.height = p.h;
      tmp.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(p.d), p.w, p.h), 0, 0);
      g.drawImage(tmp, l - 4, t - 4, w, h, i * w * scale, 0, w * scale, h * scale);
    });
  }, [input, model, facing, cushion, scale]);
  return <canvas ref={ref} aria-label={`${DIRECTIONS[facing]}, ${cushion === null ? 'all cushions' : `cushion ${cushion + 1}`}, preview outfits`} />;
}

export function ModelPanel({ draft, onPatch, onStatus }: { draft: Draft; onPatch: (p: Partial<FurnitureSpec>) => void; onStatus: (s: ModelStatus) => void }) {
  const f = draft.furniture!;
  const sig = drawingsSignature(draft);
  const [loaded, setLoaded] = useState<{ sig: string; drawings: Drawings } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(2);
  const [cushion, setCushion] = useState<number | null>(null);
  const [review, setReview] = useState<SeatReviewStatus | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewRequest, setReviewRequest] = useState(0);
  const [checking, setChecking] = useState(false);
  const [viewPixels, setViewPixels] = useState(false);
  const [viewMotion, setViewMotion] = useState(false);
  const draftSignature = JSON.stringify([draft.furniture, draft.views]);
  useEffect(() => {
    let active = true;
    setReview(null); setReviewError(null);
    void lab.seatReview(draft.id).then(r => { if (active) setReview(r); }, (e: Error) => { if (active) setReviewError(e.message); });
    return () => { active = false; };
  }, [draft.id, draft.updated, draftSignature, reviewRequest]);
  const retryChecks = async () => {
    setChecking(true); setReviewError(null);
    try { const result = await lab.retrySeatReview(draft.id); if (result.draft.furniture) onPatch(result.draft.furniture); setReviewRequest(n => n + 1); }
    catch (error) { setReviewError(error instanceof Error ? error.message : String(error)); }
    finally { setChecking(false); }
  };
  const patch = useRef(onPatch); patch.current = onPatch;
  useEffect(() => {
    let active = true;
    setError(null);
    void loadDrawings(draft).then((drawings) => { if (active) setLoaded({ sig, drawings }); }, (e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
    // Drawings are content-addressed by take and file; other draft edits do not reload images.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.id, sig]);
  const declaration = JSON.stringify([draft.key, f.footprint, f.seat, f.sitStyle, f.backrest, f.arms, f.seatKind, f.sameFromBehind]);
  const input = useMemo((): FitInput | null => {
    if (loaded?.sig !== sig) return null;
    const views = MODEL_FACINGS.flatMap((facing) => {
      const a = seatArt(loaded.drawings, f.footprint, facing, f.sameFromBehind); return a ? [{ facing, art: a.art }] : [];
    });
    if (views.length !== 4) return null;
    return { key: draft.key, family: f.seatKind, size: f.footprint, seat: f.seat ?? 12, style: f.sitStyle, backrest: f.backrest, arms: !!f.arms, views };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, sig, declaration]);
  const source = input ? seatCompileSignature(input) : '';
  const model = f.seatModel?.model;
  const current = !!model && model.compiler?.version === SEAT_COMPILER_VERSION && model.compiler.source === source && !model.views && !model.over;
  useEffect(() => {
    if (!input || current) return;
    setError(null);
    const worker = new Worker(new URL('./seatCompiler.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<ReturnType<typeof compileSeat> & { error?: string }>) => {
      if (event.data.error) setError(event.data.error);
      else patch.current({ seatModel: { model: event.data.model, for: sig } });
      worker.terminate();
    };
    worker.onerror = (event) => { setError(event.message); worker.terminate(); };
    worker.postMessage({ ...input, ...(model?.surfaces !== undefined ? { surfaces: model.surfaces } : {}) });
    return () => worker.terminate();
  }, [input, current, sig, model?.surfaces]);
  const problems = useMemo(() => {
    if (!input || !model || !current) return [];
    try { return input.views.flatMap((v) => seatProblems({ ...v, model, style: input.style }).map((p) => `${v.facing}: ${p}`)); }
    catch (e) { return [e instanceof Error ? e.message : String(e)]; }
  }, [input, model, current]);
  const reviewedCurrent = review?.draftSignature === draftSignature;
  const status: ModelStatus = error ? 'bad' : !input || !current ? 'loading' : problems.length ? 'bad' : reviewedCurrent && review.accepted ? 'ok' : 'unreviewed';
  useEffect(() => onStatus(status), [status, onStatus]);
  return <section className="lab-card model-panel">
    <h3>How people sit</h3>
    <p>Seating is built automatically from the drawings. Review each direction and cushion here, then try it in the room.</p>
    {status === 'loading' && <p role="status">{input ? 'Building and checking seating in every direction…' : 'Generate the front and rear drawings to preview seating.'}</p>}
    {error && <p role="alert" className="bad">{error}</p>}
    {status === 'unreviewed' && <p role="status">Automatic seating review is pending. These previews have not passed the full pixel check yet.</p>}
    <div className="seat-evidence">
      <h4>In-game pixel review</h4>
      <button className="btn ghost small" onClick={() => setReviewRequest(n => n + 1)}>Refresh evidence</button>
      <button className="btn small" disabled={checking || !input || !current} onClick={() => void retryChecks()}>{checking ? 'Checking seating?' : 'Retry checks'}</button>
      {checking && <p role="status">Testing the drawings in every direction, then checking sitting down and standing up. This can take several minutes.</p>}
      {reviewError && <p role="alert" className="bad">Seating review: {reviewError}</p>}
      {!review && !reviewError && <p role="status">Checking saved renderer evidence…</p>}
      {review && <>
        <p className={status === 'ok' ? 'good' : 'bad'}>{status === 'ok' ? 'Seating evidence passed.' : 'Publication blocked until the current seat passes its complete review.'}</p>
        {!reviewedCurrent && <p>The draft has changed since this evidence check. Save and refresh to check the current version.</p>}
        <p>{review.contexts.some(c => c.captured) ? `${review.reviewedPixels.toLocaleString()} reviewed overlap pixels · ${review.failures} recorded pixel failures · ${review.unresolved} unresolved pixels. ${review.rendererReceipt}.` : 'No verified game captures are available yet. The review is incomplete.'}</p>
        <table><thead><tr><th>Direction / cushion</th><th>Captured outfits</th><th>Reviewed outfits</th></tr></thead><tbody>
          {MODEL_FACINGS.flatMap(facing => (model?.sits ?? []).map((_, i) => {
            const cases = review.contexts.filter(c => c.facing === facing && c.cushion === i);
            return <tr key={`${facing}-${i}`}><td>{DIRECTIONS[facing]} / {i + 1}</td><td>{cases.filter(c => c.captured).length} / 4</td><td>{cases.filter(c => c.reviewed && !c.unresolved).length} / 4</td></tr>;
          }))}
        </tbody></table>
        <p><strong>Movement review:</strong> {review.motion?.visualApproved ? 'All recorded directions, outfits and cushion changes passed the movement and appearance reviews.' : review.motion?.invariantsPassed ? `${review.motion.films} recorded direction/outfit films passed the movement pixel checks. Appearance during sitting down and standing up still needs independent review.` : 'Entry, cushion changes and exit still need a complete recorded review.'}</p>
        <p><strong>Clothing coverage:</strong> {review.wardrobe?.accepted ? `${review.wardrobe.looks.toLocaleString()} catalog outfit combinations have complete body-depth data in ${review.wardrobe.contexts} sampled poses. Appearance is reviewed separately using the four recorded outfits.` : 'Catalog clothing still needs a complete check against the recorded poses.'}</p>
        {review.contexts.some(c => c.captured) && <><button className="btn ghost small" onClick={() => setViewPixels(v => !v)}>{viewPixels ? 'Close pixel viewer' : 'Inspect actual game pixels'}</button>{viewPixels && <SeatPixelViewer id={draft.id} />}</>}
        {!!draft.seatMotionReview?.result && <><button className="btn ghost small" onClick={() => setViewMotion(v => !v)}>{viewMotion ? 'Close movement viewer' : 'Inspect recorded movement'}</button>{viewMotion && <SeatMotionViewer key={`${draft.id}-${draft.updated}-${reviewRequest}`} id={draft.id} />}</>}
        {!!review.problems.length && <details><summary>{review.problems.length} verification problems</summary><ul>{review.problems.slice(0, 50).map((p, i) => <li key={i}>{p}</li>)}</ul>{review.problems.length > 50 && <p>Showing the first 50; the evidence bundle contains the complete inputs.</p>}</details>}
        {!!review.evidence.length && <details><summary>Open exact evidence</summary><ul>{review.evidence.map((e, i) => <li key={i}><a href={lab.fileUrl(draft.id, e.path)} target="_blank" rel="noreferrer">{e.label}: {e.path}</a></li>)}</ul></details>}
      </>}
    </div>
    {draft.seatingSurfaceReview?.status === 'FAILED' && <p role="alert" className="bad">Surface identification needs another automatic pass. {draft.seatingSurfaceReview.error}</p>}
    {problems.length > 0 && <div className="bad"><p>This drawing needs another take before it can be published.</p><ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul></div>}
    {input && model && current && !problems.length && <>
      <div className="row">
        <label>Preview size <select value={scale} onChange={(e) => setScale(Number(e.target.value))}><option value={1}>Play scale</option><option value={2}>Enlarged</option></select></label>
        <label>Occupied cushions <select value={cushion ?? 'all'} onChange={(e) => setCushion(e.target.value === 'all' ? null : Number(e.target.value))}><option value="all">All</option>{model.sits.map((_, i) => <option key={i} value={i}>Cushion {i + 1}</option>)}</select></label>
      </div>
      <div className="rig-facings">{MODEL_FACINGS.map((facing) => <figure className="rig-facing" key={facing}><figcaption>{DIRECTIONS[facing]}</figcaption><Preview input={input} model={model} facing={facing} cushion={cushion} scale={scale} /></figure>)}</div>
      {status === 'ok' && <p className="good">Seating checks passed in every direction.</p>}
    </>}
  </section>;
}
