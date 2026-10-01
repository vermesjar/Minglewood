import { useEffect, useRef, useState } from 'react';
import { lab, type Facing, type SeatReviewFrame } from './api';

/** Magnify the actual captured game canvas without smoothing or re-rendering the seat. */
export function SeatPixelViewer({ id }: { id: string }) {
  const [facing, setFacing] = useState<Facing>('se'), [look, setLook] = useState(0), [zoom, setZoom] = useState(1);
  const [frame, setFrame] = useState<SeatReviewFrame | null>(null), [error, setError] = useState(''), [pixel, setPixel] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let active = true; setFrame(null); setError(''); setPixel('');
    void lab.seatReviewFrame(id, facing, look).then(r => { if (active) setFrame(r); }, (e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [id, facing, look]);
  useEffect(() => {
    if (!frame || !canvas.current) return;
    const c = canvas.current; c.width = frame.rect.width; c.height = frame.rect.height;
    c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(frame.rgba), c.width, c.height), 0, 0);
  }, [frame]);
  return <div>
    <p>These are saved game-screen pixels, including any defects. Move over the image to inspect a pixel.</p>
    <div className="row">
      <label>Direction <select value={facing} onChange={e => setFacing(e.target.value as Facing)}><option value="se">Front right</option><option value="sw">Front left</option><option value="ne">Rear right</option><option value="nw">Rear left</option></select></label>
      <label>Outfit <select value={look} onChange={e => setLook(Number(e.target.value))}>{[0, 1, 2, 3].map(i => <option key={i} value={i}>{i + 1}</option>)}</select></label>
      <label>Zoom <select aria-label="Captured pixel zoom" value={zoom} onChange={e => setZoom(Number(e.target.value))}>{[1, 2, 4, 8].map(i => <option key={i} value={i}>{i}×</option>)}</select></label>
    </div>
    {error && <p role="status">{error}</p>}
    {frame && <div style={{ overflow: 'auto', maxHeight: 560 }}><canvas ref={canvas} aria-label="Actual captured seating pixels" style={{ width: frame.rect.width * zoom, height: frame.rect.height * zoom, imageRendering: 'pixelated', maxWidth: 'none' }} onMouseMove={event => {
      const bounds = event.currentTarget.getBoundingClientRect(), x = Math.floor((event.clientX - bounds.left) * frame.rect.width / bounds.width), y = Math.floor((event.clientY - bounds.top) * frame.rect.height / bounds.height);
      if (x < 0 || y < 0 || x >= frame.rect.width || y >= frame.rect.height) return;
      const rgba = frame.rgba.slice((y * frame.rect.width + x) * 4, (y * frame.rect.width + x) * 4 + 4);
      setPixel(`Screen pixel ${frame.rect.x + x}, ${frame.rect.y + y} · RGBA ${rgba.join(', ')}`);
    }} /></div>}
    <p aria-live="polite">{pixel || (frame ? 'Showing the original captured pixels.' : '')}</p>
  </div>;
}
