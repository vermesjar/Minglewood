import { useEffect, useRef, useState } from 'react';
import { lab, type Facing, type SeatMotionFrames } from './api';

/** Scrub original screenshots, including failures, without composing a new preview. */
export function SeatMotionViewer({ id }: { id: string }) {
  const [facing, setFacing] = useState<Facing>('se'), [look, setLook] = useState(0), [zoom, setZoom] = useState(2);
  const [film, setFilm] = useState<SeatMotionFrames | null>(null), [index, setIndex] = useState(0);
  const [error, setError] = useState(''), [pixel, setPixel] = useState('');
  const [renderError, setRenderError] = useState(''), [loadedFrame, setLoadedFrame] = useState<object | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null), frame = film?.frames[index];
  useEffect(() => {
    let active = true; setFilm(null); setIndex(0); setError(''); setPixel('');
    void lab.seatMotionFrames(id, facing, look).then(value => { if (active) setFilm(value); }, (e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [id, facing, look]);
  useEffect(() => {
    if (!frame || !canvas.current) return;
    let active = true; const c = canvas.current, image = new Image();
    c.width = frame.rect.width; c.height = frame.rect.height; setPixel(''); setRenderError(''); setLoadedFrame(null);
    image.onload = () => {
      if (!active) return;
      if (image.width !== c.width || image.height !== c.height) { setRenderError('Recorded image dimensions do not match the capture.'); return; }
      c.getContext('2d')!.drawImage(image, 0, 0);
      setLoadedFrame(frame);
    };
    image.onerror = () => { if (active) setRenderError('The recorded screenshot could not be read.'); };
    image.src = frame.png;
    return () => { active = false; };
  }, [frame]);
  return <div>
    <p>Inspect the original game frames through approach, sitting, cushion changes and standing up. The review status above determines whether this recording passed.</p>
    <div className="row">
      <label>Direction <select value={facing} onChange={e => setFacing(e.target.value as Facing)}><option value="se">Front right</option><option value="sw">Front left</option><option value="ne">Rear right</option><option value="nw">Rear left</option></select></label>
      <label>Outfit <select value={look} onChange={e => setLook(Number(e.target.value))}>{[0, 1, 2, 3].map(i => <option key={i} value={i}>{i + 1}</option>)}</select></label>
      <label>Zoom <select value={zoom} onChange={e => setZoom(Number(e.target.value))}>{[1, 2, 4, 8].map(i => <option key={i} value={i}>{i}×</option>)}</select></label>
    </div>
    {error && <p role="alert">{error}</p>}
    {renderError && <p role="alert">{renderError}</p>}
    {!film && !error && <p role="status">Loading recorded movement…</p>}
    {film && frame && <>
      <div className="row">
        <button className="btn ghost small" disabled={index === 0} onClick={() => setIndex(i => i - 1)}>Previous frame</button>
        <label>Frame {index + 1} / {film.frames.length} <input aria-label="Recorded movement frame" type="range" min={0} max={film.frames.length - 1} value={index} onChange={e => setIndex(Number(e.target.value))} /></label>
        <button className="btn ghost small" disabled={index === film.frames.length - 1} onClick={() => setIndex(i => i + 1)}>Next frame</button>
      </div>
      <p>{frame.phase} · {frame.pose}{frame.cushion !== null ? ` · Cushion ${frame.cushion + 1}` : ''}</p>
      <div style={{ overflow: 'auto', maxHeight: 560 }}><canvas ref={canvas} data-film-sha256={film.filmSha256} role="img" aria-label={`Original recorded seating movement pixels, frame ${index + 1}, ${frame.phase}, ${frame.pose}`} style={{ width: frame.rect.width * zoom, height: frame.rect.height * zoom, imageRendering: 'pixelated', maxWidth: 'none' }} onMouseMove={event => {
        if (loadedFrame !== frame) return;
        const c = event.currentTarget, b = c.getBoundingClientRect(), x = Math.floor((event.clientX - b.left) * c.width / b.width), y = Math.floor((event.clientY - b.top) * c.height / b.height);
        if (x < 0 || y < 0 || x >= c.width || y >= c.height) return;
        const rgba = c.getContext('2d')!.getImageData(x, y, 1, 1).data;
        setPixel(`Screen pixel ${frame.rect.x + x}, ${frame.rect.y + y} · RGBA ${Array.from(rgba).join(', ')}`);
      }} /></div>
      <p aria-live="polite">{pixel || 'Move over the image to inspect a captured pixel.'}</p>
    </>}
  </div>;
}
