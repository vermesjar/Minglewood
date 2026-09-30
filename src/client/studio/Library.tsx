/** Everything published: each catalog piece in all four rotations with the review's verdict, and the part libraries. */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AvatarLoadout } from '@shared/domain/types';
import { CLOTH_COLORS, HAIR_COLORS } from '@shared/avatar';
import { artSprite, loadArt } from '../engine/sprites/art';
import { renderAvatarLayers } from '../engine/sprites/avatarQa';
import { H, W } from '../engine/sprites/pixkit';
import { lab, type Facing, type LibraryPiece, type PartKind, type Rotation } from './api';
import { drawView, FACINGS, footprintFor } from './pixels';

function PieceView({ p, facing }: { p: LibraryPiece; facing: Facing }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [none, setNone] = useState(false);
  useEffect(() => {
    const rotation = (p.rotation ?? (p.facings.length ? 'mirror' : 'radial')) as Rotation;
    const [w, d] = p.wall ? p.footprint : footprintFor({ footprint: p.footprint, rotation }, facing);
    const s = artSprite({ id: `lib-${p.key}`, sprite: p.key, x: 0, y: 0, w, d, facing });
    if (!s || !ref.current) return setNone(true);
    drawView(ref.current, s.canvas, p.wall ? [0, 0] : [s.ax, s.ay], [w, d], { maxW: p.wall ? 300 : 150, maxH: 150, pad: 4, bare: p.wall });
  }, [p, facing]);
  return none ? <div className="lab-empty tiny">—</div> : <canvas ref={ref} />;
}

function PartThumb({ kind, name }: { kind: PartKind; name: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const base = { hair: 'hair.bob', hairColor: HAIR_COLORS[2], top: 'top.tee', topColor: CLOTH_COLORS[3], bottom: 'bottom.jeans', shoes: 'shoes.sneakers' } as AvatarLoadout;
    const look: AvatarLoadout =
      kind === 'hair'
        ? { ...base, hair: `hair.${name}` }
        : kind === 'hat'
          ? { ...base, headwear: `hat.${name}`, headwearColor: CLOTH_COLORS[5] }
          : kind === 'top'
            ? { ...base, top: `top.${name}`, topColor: CLOTH_COLORS[6] }
            : { ...base, pet: `pet.${name}`, petColor: '#e8a15a' };
    const c = ref.current!;
    c.width = W * 2;
    c.height = H;
    const g = c.getContext('2d')!;
    ['se', 'ne'].forEach((f, i) => g.putImageData(new ImageData(new Uint8ClampedArray(renderAvatarLayers(look, f as Facing, 'stand').px), W, H), i * W, 0));
  }, [kind, name]);
  return <canvas ref={ref} className="part-thumb" />;
}

export function Library({ onOpen }: { onOpen: (draftId: string) => void }) {
  const [pieces, setPieces] = useState<LibraryPiece[] | null>(null);
  const [parts, setParts] = useState<Record<PartKind, string[]> | null>(null);
  const [q, setQ] = useState('');
  const [onlyBad, setOnlyBad] = useState(false);
  const [rot, setRot] = useState<string>('all');
  const [tab, setTab] = useState<'furniture' | 'parts'>('furniture');
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        await loadArt('');
        const [lib, pt] = await Promise.all([lab.library(), lab.parts()]);
        setPieces(lib.pieces.sort((a, b) => a.key.localeCompare(b.key)));
        setParts(pt);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  const shown = useMemo(
    () =>
      (pieces ?? []).filter(
        (p) => (!q || `${p.key} ${p.name ?? ''} ${p.category ?? ''}`.toLowerCase().includes(q.toLowerCase())) && (!onlyBad || p.issues.length) && (rot === 'all' || (rot === 'wall' ? p.wall : (p.rotation ?? 'unset') === rot)),
      ),
    [pieces, q, onlyBad, rot],
  );
  const bad = (pieces ?? []).filter((p) => p.issues.length).length;

  async function open(key: string) {
    setOpening(key);
    try {
      onOpen((await lab.fromCatalog(key)).id);
    } catch (e) {
      setError((e as Error).message);
      setOpening(null);
    }
  }

  return (
    <div className="library">
      <div className="toolbar lab-card">
        <div className="seg">
          <button className={tab === 'furniture' ? 'on' : ''} onClick={() => setTab('furniture')}>
            Furniture {pieces ? `(${pieces.length})` : ''}
          </button>
          <button className={tab === 'parts' ? 'on' : ''} onClick={() => setTab('parts')}>
            Character parts {parts ? `(${Object.values(parts).flat().length})` : ''}
          </button>
        </div>
        {tab === 'furniture' && (
          <>
            <input className="search" placeholder="Search names, keys, categories…" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="seg">
              {['all', 'radial', 'mirror', 'full', 'wall', 'unset'].map((r) => (
                <button key={r} className={rot === r ? 'on' : ''} onClick={() => setRot(r)}>
                  {r}
                </button>
              ))}
            </div>
            <label className="check">
              <input type="checkbox" checked={onlyBad} onChange={(e) => setOnlyBad(e.target.checked)} /> Only problems ({bad})
            </label>
          </>
        )}
      </div>
      {error && <div className="banner bad">{error}</div>}
      {!pieces && !error && <div className="lab-empty">Reading the catalog and reviewing every piece…</div>}
      {tab === 'furniture' && pieces && (
        <div className="lib-grid">
          {shown.map((p) => (
            <article key={p.key} className={`lab-card piece ${p.issues.length ? 'has-issues' : ''}`}>
              <header className="card-head">
                <b>{p.name ?? p.key}</b>
                <span className="mono small muted">{p.key}</span>
                <span className={`chip ${p.issues.length ? 'bad' : 'good'}`}>{p.issues.length ? `${p.issues.length} issue${p.issues.length > 1 ? 's' : ''}` : 'meets the standard'}</span>
                {p.rig && (
                  <span className={`chip ${p.rig === 'audited' ? 'good' : p.rig === 'proposed' ? 'soft' : 'bad'}`} title="how people sit in it: art/seat-rigs.json (the seat rig standard)">
                    rig: {p.rig}
                  </span>
                )}
              </header>
              <div className="piece-meta muted small">
                {p.category ?? 'no category'} · {p.wall ? 'wall art' : (p.rotation ?? 'no rotation set')} · {p.footprint.join('×')}
                {p.seat !== null ? ` · seat ${p.seat}` : ''}
              </div>
              <div className={`rotations ${p.wall ? 'one' : ''}`}>
                {(p.wall ? (['se'] as Facing[]) : FACINGS).map((f) => (
                  <figure key={f}>
                    <PieceView p={p} facing={f} />
                    {!p.wall && <figcaption>{f}</figcaption>}
                  </figure>
                ))}
              </div>
              {p.issues.length > 0 && (
                <ul className="issues">
                  {p.issues.slice(0, 4).map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              )}
              <button className="btn ghost small" disabled={opening === p.key} onClick={() => void open(p.key)}>
                {opening === p.key ? 'Opening…' : p.rig ? 'Open to re-rig' : 'Open as draft'}
              </button>
            </article>
          ))}
        </div>
      )}
      {tab === 'parts' && parts && (
        <div className="parts">
          {(Object.keys(parts) as PartKind[]).map((k) => (
            <section key={k} className="lab-card">
              <header className="card-head">
                <h3>{k}</h3>
                <span className="muted">{parts[k].length} in {k}Lib.json</span>
              </header>
              <div className="part-grid">
                {parts[k].map((n) => (
                  <figure key={n}>
                    <PartThumb kind={k} name={n} />
                    <figcaption className="mono">{n}</figcaption>
                  </figure>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
