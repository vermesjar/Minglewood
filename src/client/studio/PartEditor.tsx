/**
 * A character part draft (hair, hat, top, pet): drawn on the standard frame by art/charkit.py, previewed on the
 * real avatar kit (every facing, both bodies, every skin tone and pose) and linted against the character
 * standard (avatarQa) before it's published to the part library.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AvatarLoadout } from '@shared/domain/types';
import { CLOTH_COLORS, HAIR_COLORS, SKIN_TONES } from '@shared/avatar';
import type { Facing } from '@shared/world/scene';
import HAIR_LIB from '../engine/sprites/hairLib.json';
import HAT_LIB from '../engine/sprites/hatLib.json';
import TOP_LIB from '../engine/sprites/topLib.json';
import PET_LIB from '../engine/sprites/petLib.json';
import { LAYER } from '../engine/sprites/avatarKit';
import { lintAvatar, POSES, renderAvatarLayers, type Issue } from '../engine/sprites/avatarQa';
import type { Pose } from '../engine/sprites/avatarFrame';
import { H, W } from '../engine/sprites/pixkit';
import { estimate, lab, type Draft, type PartKind, type PartSpec, type Placed, type Usage } from './api';
import { FACINGS } from './pixels';
import { Confirm, Field, RefsPanel, Takes } from './common';

/** The draft rides in the real libraries under this id, so the kit draws it exactly as the game will. */
const DRAFT_ID = 'labdraft';
type LibView = Placed;
type Lib = Record<string, { front?: LibView; back?: LibView; behindFront?: LibView | null }>;
const LIBS: Record<PartKind, Lib> = { hair: HAIR_LIB as unknown as Lib, hat: HAT_LIB as unknown as Lib, top: TOP_LIB as unknown as Lib, pet: PET_LIB as unknown as Lib };
const PART_LAYER: Record<PartKind, number[]> = { hair: [LAYER.hair, LAYER.hairBehind], hat: [LAYER.hat], top: [LAYER.torso], pet: [LAYER.pet] };
const KIND_HELP: Record<PartKind, string> = {
  hair: 'Drawn over the bald head; must cover the whole scalp from behind and leave the eyes and mouth clear.',
  hat: 'Sits on the crown; hair under it is trimmed to its edge.',
  top: 'The torso garment; sleeves follow the arms in every pose.',
  pet: 'A small buddy beside the feet (front view only).',
};
const VIEWS = (k: PartKind) => (k === 'pet' ? ['front'] : ['front', 'back']);

/**
 * The draft's entry in the part libraries, and who put it there. Editors come and go (switching drafts, hot
 * reloads): a leaving editor only removes its own entry, and every render re-asserts the current one.
 */
let active: { owner: object; kind: PartKind; entry: Lib[string] } | null = null;

function inject(d: Draft, owner: object) {
  const p = d.part!;
  for (const lib of Object.values(LIBS)) delete lib[DRAFT_ID];
  active = null;
  const front = d.views.front?.placed;
  const back = d.views.back?.placed;
  if (!front && !back) return;
  // a hairstyle needs both sides to be drawn from the library; until the back exists, the front stands in
  active = { owner, kind: p.kind, entry: { front: front ?? back, back: back ?? front, behindFront: d.views.front?.behind ?? undefined } };
  LIBS[p.kind][DRAFT_ID] = active.entry;
}

function ensureInjected() {
  if (active && LIBS[active.kind][DRAFT_ID] !== active.entry) LIBS[active.kind][DRAFT_ID] = active.entry;
}

function eject(owner: object) {
  if (active?.owner !== owner) return;
  delete LIBS[active.kind][DRAFT_ID];
  active = null;
}

function lookFor(kind: PartKind, o: { body: string; skin: string; colour: string }): AvatarLoadout {
  const base: AvatarLoadout = { skin: o.skin, body: o.body, hair: 'hair.bob', hairColor: HAIR_COLORS[1], top: 'top.tee', topColor: CLOTH_COLORS[3], bottom: 'bottom.jeans', shoes: 'shoes.sneakers' } as AvatarLoadout;
  if (kind === 'hair') return { ...base, hair: `hair.${DRAFT_ID}`, hairColor: o.colour };
  if (kind === 'hat') return { ...base, headwear: `hat.${DRAFT_ID}`, headwearColor: o.colour };
  if (kind === 'top') return { ...base, top: `top.${DRAFT_ID}`, topColor: o.colour };
  return { ...base, pet: `pet.${DRAFT_ID}`, petColor: o.colour };
}

function paint(canvas: HTMLCanvasElement | null, px: Uint8ClampedArray, z: number, crop?: [number, number, number, number]) {
  if (!canvas) return;
  const [cx, cy, cw, ch] = crop ?? [0, 0, W, H];
  const src = document.createElement('canvas');
  src.width = W;
  src.height = H;
  src.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(px), W, H), 0, 0);
  canvas.width = cw * z;
  canvas.height = ch * z;
  const c = canvas.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  c.drawImage(src, cx, cy, cw, ch, 0, 0, cw * z, ch * z);
}

/** The box around the part itself (what its layers painted), across all four facings, padded. */
function partBox(kind: PartKind, look: AvatarLoadout): [number, number, number, number] {
  ensureInjected();
  let x0 = W,
    y0 = H,
    x1 = 0,
    y1 = 0;
  for (const f of FACINGS) {
    const r = renderAvatarLayers(look, f, 'stand');
    for (let i = 0; i < r.owner.length; i++)
      if (PART_LAYER[kind].includes(r.owner[i])) {
        const x = i % W;
        const y = (i / W) | 0;
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
  }
  if (x1 < x0) return [0, 0, W, H];
  const pad = 6;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  return [x0, y0, Math.min(W, x1 + pad + 1) - x0, Math.min(H, y1 + pad + 1) - y0];
}

function Frame({ look, facing, pose, z, crop, issues }: { look: AvatarLoadout; facing: Facing; pose: Pose; z: number; crop?: [number, number, number, number]; issues?: Issue[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = JSON.stringify([look, facing, pose, z, crop]);
  useEffect(() => {
    ensureInjected();
    paint(ref.current, renderAvatarLayers(look, facing, pose).px, z, crop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (
    <figure className={`frame ${issues?.length ? 'bad' : ''}`} title={issues?.map((i) => `${i.kind}: ${i.detail}`).join('\n')}>
      <canvas ref={ref} />
      <figcaption>
        {facing}
        {pose !== 'stand' ? ` · ${pose}` : ''}
      </figcaption>
    </figure>
  );
}

export function PartEditor({ id, usage, onUsage, onClose }: { id: string; usage: Usage | null; onUsage: () => void; onClose: () => void }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [started, setStarted] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'front' | 'back' | null>(null);
  const [body, setBody] = useState('body.a');
  const [skin, setSkin] = useState(SKIN_TONES[4]);
  const [colour, setColour] = useState<string>(HAIR_COLORS[2]);
  const [facing, setFacing] = useState<Facing>('se');
  const [catalogLine, setCatalogLine] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const [owner] = useState(() => ({}));

  useEffect(() => {
    void lab.draft(id).then(
      ({ draft }) => {
        setDraft(draft);
        // a colour that reads against the bob underneath: warm brown hair, sandy hats, a teal top, a ginger pet
        setColour({ hair: HAIR_COLORS[2], hat: CLOTH_COLORS[15], top: CLOTH_COLORS[6], pet: '#e8a15a' }[draft.part?.kind ?? 'hair']);
      },
      (e: Error) => setError(e.message),
    );
    return () => eject(owner);
  }, [id, owner]);
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [busy]);

  const views = draft ? VIEWS(draft.part!.kind) : [];
  const drawn = draft ? views.filter((v) => draft.views[v]?.placed) : [];
  const stamp = draft ? `${draft.updated}|${draft.takes.length}|${draft.part!.kind}` : '';
  // put the draft in the libraries before anything below renders it
  useMemo(() => draft && inject(draft, owner), [stamp]); // eslint-disable-line react-hooks/exhaustive-deps

  const kind = draft?.part?.kind ?? 'hair';
  const look = useMemo(() => lookFor(kind, { body, skin, colour }), [kind, body, skin, colour, stamp]); // eslint-disable-line react-hooks/exhaustive-deps
  const crop = useMemo(() => (drawn.length ? partBox(kind, look) : undefined), [look, drawn.length, kind]);

  /** The standard, checked on every body, facing and pose (skin and colour don't change coverage). */
  const lint = useMemo(() => {
    if (!drawn.length) return null;
    ensureInjected();
    const out: Array<{ body: string; facing: Facing; pose: Pose; issues: Issue[] }> = [];
    let frames = 0;
    for (const b of ['body.a', 'body.b'])
      for (const f of FACINGS)
        for (const p of POSES) {
          frames++;
          const issues = lintAvatar(lookFor(kind, { body: b, skin, colour }), f, p);
          if (issues.length) out.push({ body: b, facing: f, pose: p, issues });
        }
    return { frames, bad: out };
  }, [kind, drawn.length, stamp]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!draft) return <div className="lab-empty">{error ?? 'Opening the draft…'}</div>;
  const p = draft.part!;
  const allAccepted = views.every((v) => draft.views[v]?.accepted);

  function patch(v: Partial<PartSpec>) {
    const next = { ...draft!, part: { ...p, ...v } };
    setDraft(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void lab.update(id, { part: next.part }).then((d) => setDraft((cur) => (cur ? { ...cur, updated: d.updated } : d)), (e: Error) => setError(e.message));
    }, 450);
  }

  async function generate(view: 'front' | 'back') {
    setConfirm(null);
    setBusy(`Drawing the ${view} on the frame…`);
    setStarted(Date.now());
    setError(null);
    try {
      const r = await lab.generate(id, { view });
      setDraft(r.draft);
      setNote(`Done — $${r.usd.toFixed(3)}. Turn it around below, then accept.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      onUsage();
    }
  }

  async function publish() {
    setBusy('Publishing to the part library…');
    setStarted(Date.now());
    setError(null);
    try {
      const r = await lab.publish(id, !!draft!.origin);
      setCatalogLine(String(r.catalogLine ?? ''));
      setDraft((await lab.draft(id)).draft);
      setNote(`Published ${String(r.published)} to ${p.kind}Lib.json.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const palette = kind === 'hair' ? HAIR_COLORS : kind === 'pet' ? ['#e8a15a', '#f4efe6', '#8e8a84', '#3a3a46', '#c9b79a', '#6b4a33'] : CLOTH_COLORS;
  const est = estimate(usage, 'charkit', p.quality, '1024x1536');
  const lintBad = lint?.bad ?? [];
  const tally = lintBad.flatMap((b) => b.issues).reduce<Record<string, number>>((m, i) => ((m[i.kind] = (m[i.kind] ?? 0) + 1), m), {});

  return (
    <div className="editor">
      <aside className="lab-card spec">
        <header className="card-head">
          <button className="btn ghost small" onClick={onClose}>
            ← Drafts
          </button>
          <span className="chip">character part</span>
        </header>
        <h2 className="pixel">{draft.title}</h2>
        <Field label="Kind" hint={KIND_HELP[p.kind]}>
          <div className="seg wide">
            {(['hair', 'hat', 'top', 'pet'] as const).map((k) => (
              <button key={k} className={p.kind === k ? 'on' : ''} disabled={drawn.length > 0} onClick={() => patch({ kind: k })}>
                {k}
              </button>
            ))}
          </div>
        </Field>
        <div className="row">
          <Field label="Library name" hint="lowercase, a-z 0-9 -">
            <input value={p.name} onChange={(e) => patch({ name: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} />
          </Field>
          <Field label="Label">
            <input value={p.label} placeholder="Wavy bob" onChange={(e) => patch({ label: e.target.value })} />
          </Field>
        </div>
        <Field label="Prompt (front)" hint="shape and style only: the colour comes from the player's pick">
          <textarea rows={4} value={p.prompt} placeholder="A chin-length wavy bob with a deep side part and soft curls at the ends…" onChange={(e) => patch({ prompt: e.target.value })} />
        </Field>
        {p.kind !== 'pet' && (
          <Field label="Prompt (back, optional)" hint="blank = the front prompt, seen from behind">
            <textarea rows={2} value={p.backPrompt} onChange={(e) => patch({ backPrompt: e.target.value })} />
          </Field>
        )}
        <div className="row">
          {(p.kind === 'hair' || p.kind === 'top') && (
            <label className="check">
              <input type="checkbox" checked={p.long} onChange={(e) => patch({ long: e.target.checked })} /> {p.kind === 'hair' ? 'Long (past the shoulders)' : 'Long (coat length)'}
            </label>
          )}
          {p.kind === 'top' && (
            <label className="check">
              <input type="checkbox" checked={p.drape} onChange={(e) => patch({ drape: e.target.checked })} /> Drapes (open coat)
            </label>
          )}
        </div>
        <RefsPanel draft={draft} onDraft={setDraft} onError={setError} />
        <Field label="Quality">
          <div className="seg wide">
            {(['medium', 'high'] as const).map((q) => (
              <button key={q} className={p.quality === q ? 'on' : ''} onClick={() => patch({ quality: q })}>
                {q}
              </button>
            ))}
          </div>
        </Field>
        <div className="row">
          {views.map((v) => (
            <button key={v} className="btn primary" disabled={!!busy || !p.prompt.trim()} onClick={() => setConfirm(v as 'front' | 'back')}>
              ✦ {draft.views[v]?.placed ? `Redraw ${v}` : `Draw ${v}`}
            </button>
          ))}
        </div>
      </aside>

      <main className="work">
        {(busy || error || note) && (
          <div className={`banner ${error ? 'bad' : busy ? 'busy' : 'good'}`}>
            {busy ? (
              <>
                <span className="spinner" /> {busy} <span className="muted">{Math.round((now - started) / 1000)} s</span>
              </>
            ) : (
              (error ?? note)
            )}
            {!busy && (
              <button className="x" onClick={() => (setError(null), setNote(null))}>
                ×
              </button>
            )}
          </div>
        )}
        <section className="lab-card">
          <header className="card-head">
            <h3>Turnaround</h3>
            <span className="muted">the real avatar kit: exactly what the game draws</span>
          </header>
          {!drawn.length ? (
            <div className="lab-empty small">Draw the front first; it appears here on the standard figure from every side.</div>
          ) : (
            <>
              <div className="toolbar">
                <div className="seg">
                  {['body.a', 'body.b'].map((b) => (
                    <button key={b} className={body === b ? 'on' : ''} onClick={() => setBody(b)}>
                      {b === 'body.a' ? 'straight' : 'soft'}
                    </button>
                  ))}
                </div>
                <div className="swatches" aria-label="Skin">
                  {SKIN_TONES.map((s) => (
                    <button key={s} className={skin === s ? 'on' : ''} style={{ background: s }} onClick={() => setSkin(s)} title={s} />
                  ))}
                </div>
                <div className="swatches" aria-label="Colour">
                  {palette.slice(0, 20).map((c) => (
                    <button key={c} className={colour === c ? 'on' : ''} style={{ background: c }} onClick={() => setColour(c)} title={c} />
                  ))}
                </div>
              </div>
              <div className="turnaround">
                {FACINGS.map((f) => (
                  <Frame key={f} look={look} facing={f} pose="stand" z={3} />
                ))}
              </div>
              {crop && (
                <>
                  <h4>Close up</h4>
                  <div className="turnaround close">
                    {FACINGS.map((f) => (
                      <Frame key={f} look={look} facing={f} pose="stand" z={4} crop={crop} />
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </section>
        {drawn.length > 0 && (
          <section className="lab-card">
            <header className="card-head">
              <h3>Every pose</h3>
              <div className="seg">
                {FACINGS.map((f) => (
                  <button key={f} className={facing === f ? 'on' : ''} onClick={() => setFacing(f)}>
                    {f}
                  </button>
                ))}
              </div>
            </header>
            <div className="poses">
              {POSES.map((po) => (
                <Frame key={po} look={look} facing={facing} pose={po} z={2} issues={lintBad.find((b) => b.body === body && b.facing === facing && b.pose === po)?.issues} />
              ))}
            </div>
            <h4>Every skin tone</h4>
            <div className="poses">
              {SKIN_TONES.map((s) => (
                <Frame key={s} look={lookFor(kind, { body, skin: s, colour })} facing={facing} pose="stand" z={2} />
              ))}
            </div>
          </section>
        )}
      </main>

      <aside className="side">
        <section className="lab-card">
          <header className="card-head">
            <h3>Checks</h3>
          </header>
          {!lint ? (
            <p className="muted">The character standard runs on every body, facing and pose once there’s a drawing.</p>
          ) : (
            <ul className="checks">
              <li className={lintBad.length ? 'bad' : 'good'}>
                {lintBad.length ? `${lintBad.length} of ${lint.frames} frames break the standard` : `All ${lint.frames} frames meet the standard`}
              </li>
              {Object.entries(tally).map(([k, n]) => (
                <li key={k} className="bad">
                  <b>{k}</b> ×{n}
                </li>
              ))}
              {lintBad.slice(0, 8).map((b, i) => (
                <li key={i} className="warn small">
                  {b.body.replace('body.', '')} · {b.facing} · {b.pose}: {b.issues.map((x) => x.detail).join('; ')}
                </li>
              ))}
            </ul>
          )}
          {views.map((v) => (
            <label key={v} className="check">
              <input
                type="checkbox"
                disabled={!draft.views[v]?.placed}
                checked={!!draft.views[v]?.accepted}
                onChange={(e) => void lab.update(id, { views: { [v]: { accepted: e.target.checked } } }).then(setDraft, (er: Error) => setError(er.message))}
              />{' '}
              Accept the {v} {draft.views[v]?.take ? <span className="muted">(take {draft.views[v]?.take})</span> : <span className="muted">(not drawn)</span>}
            </label>
          ))}
          <button className="btn primary" disabled={!allAccepted || !!busy || lintBad.length > 0} onClick={() => void publish()}>
            {draft.published ? 'Publish again' : 'Publish to part library'}
          </button>
          {lintBad.length > 0 && allAccepted && <p className="muted small">Fix the standard’s problems (redraw with a note) before publishing.</p>}
          {(catalogLine ?? draft.catalogLine) && (
            <div className="catalog-line">
              <p className="small">
                Add it to the wardrobe: paste this into <code>src/shared/avatar.ts</code> (AVATAR_ITEMS, {p.kind} section):
              </p>
              <code className="copy" title="Click to copy" onClick={() => void navigator.clipboard?.writeText(catalogLine ?? draft.catalogLine ?? '')}>
                {catalogLine ?? draft.catalogLine}
              </code>
            </div>
          )}
          <div className="row actions">
            <a className="btn ghost small" href={lab.exportUrl(draft.id)}>
              Export draft (.zip)
            </a>
            <button
              className="btn ghost small danger"
              onClick={() => {
                if (window.confirm('Discard this draft? It moves to art/drafts/.trash and can be recovered from there.')) void lab.discard(draft.id).then(onClose);
              }}
            >
              Discard
            </button>
          </div>
        </section>
        <Takes draft={draft} />
      </aside>

      {confirm && (
        <Confirm title={`Draw the ${confirm}?`} usage={usage} est={est} onCancel={() => setConfirm(null)} onOk={() => void generate(confirm)}>
          <p>
            One {p.quality}-quality drawing of the {p.kind}’s {confirm}, painted on the standard figure
            {draft.refs.length ? ` with ${draft.refs.length} reference image${draft.refs.length > 1 ? 's' : ''}` : ''}, then cut to the kit’s tone map.
          </p>
        </Confirm>
      )}
    </div>
  );
}
