import { SEAT_TYPES } from '@shared/world/seatTypes';
/** A furniture draft: its spec, references, every view with its checks, the sandbox, and publishing. */
import { useEffect, useRef, useState } from 'react';
import { CATEGORIES, heightClass, ROOM_KINDS, THEMES } from '@shared/models';
import { estimate, humanizeKey, lab, NAME_MAX, type CheckResult, type Draft, type Facing, type FurnitureSpec, type Usage } from './api';
import { drawView, drawnViews, FACINGS, footprintFor, gameAnchor, loadImg, sourceOf } from './pixels';
import { Sandbox } from './Sandbox';
import { ModelPanel, type ModelStatus } from './ModelPanel';
import { Confirm, Field, RefsPanel, Takes } from './common';

const ROTATION_HELP: Record<FurnitureSpec['rotation'], string> = {
  radial: 'Round: one drawing is true from every side (a round stool, a plant).',
  mirror: 'Symmetric: a front (se) and a back (nw) drawing; sw and ne are their mirror images (most chairs, couches, tables).',
  full: 'Handed: four drawings, because a detail sits on one side (a piano, a register, a cart, anything with text).',
  flat: 'Wall art: one drawing, painted on either wall and never mirrored.',
};

export function FurnitureEditor({ id, usage, onUsage, onClose }: { id: string; usage: Usage | null; onUsage: () => void; onClose: () => void }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [started, setStarted] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [checks, setChecks] = useState<CheckResult | null>(null);
  const [modelStatus, setModelStatus] = useState<ModelStatus>('loading');
  const [confirm, setConfirm] = useState<{ view?: string; note?: string } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    void lab.draft(id).then(({ draft }) => setDraft(draft), (e: Error) => setError(e.message));
  }, [id]);
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [busy]);
  useEffect(() => {
    if (draft && Object.keys(draft.views).length) void runChecks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.updated]);

  if (!draft) return <div className="lab-empty">{error ?? 'Opening the draft…'}</div>;
  const f = draft.furniture!;
  const version = `${draft.updated}|${draft.takes.length}`;
  const have = Object.keys(draft.views);
  const needed = drawnViews(f, have);
  const allAccepted = needed.every((v) => draft.views[v]?.accepted);

  /** What a blank Drawn width draws at: the footprint's width on screen (a 1×1 tile spans 64 art px). */
  const drawnPx = (f.footprint[0] + f.footprint[1]) * 32;

  function patch(p: Partial<FurnitureSpec>) {
    const next = { ...draft!, furniture: { ...f, ...p } };
    setDraft(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void lab.update(id, { furniture: next.furniture }).then((d) => setDraft((cur) => (cur ? { ...cur, updated: d.updated } : d)), (e: Error) => setError(e.message));
    }, 450);
  }

  async function setView(view: string, v: { nudge?: [number, number]; accepted?: boolean }) {
    try {
      setDraft(await lab.update(id, { views: { [view]: v } }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function runChecks() {
    try {
      setChecks(await lab.check(id));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function generate(view?: string, noteText?: string) {
    setConfirm(null);
    setBusy(view ? `Redrawing the ${view} view…` : `Drawing ${needed.length === 1 ? 'the piece' : `all ${needed.length} views`}…`);
    setStarted(Date.now());
    setError(null);
    try {
      const r = await lab.generate(id, { view, note: noteText });
      setDraft(r.draft);
      setNote(`Done — $${r.usd.toFixed(3)}. ${f.category === 'seating' ? 'Seating is built automatically. Review the drawings and occupied previews, then accept.' : 'Look at every view, nudge anchors if the footprint is off, then accept.'}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      onUsage();
    }
  }

  async function publish(overwrite = false) {
    setBusy('Publishing to the catalog…');
    setStarted(Date.now());
    setError(null);
    try {
      await lab.publish(id, overwrite);
      const { draft: d } = await lab.draft(id);
      setDraft(d);
      setNote(`Published “${draft!.key}” — it’s in the catalog and the decorate palette now.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const est = estimate(usage, 'build', f.quality, '1536x1024');
  const problems = checks?.problems ?? [];
  const placementBad = (checks?.placement ?? []).filter((p) => !p.ok);
  const seating = f.category === 'seating' && f.rotation !== 'flat';
  // a seat publishes with its model (How people sit in it): holding in every facing by the gate's check
  // (seatLayers.ts seatProblems); publishing checks it again on the staged drawings
  // (scripts/lab-model.ts) and stores it in art/seat-models.json
  const seatOk = !seating || modelStatus === 'ok';
  const canPublish = allAccepted && !problems.length && !placementBad.length && seatOk && !busy;

  return (
    <div className="editor">
      <aside className="lab-card spec">
        <header className="card-head">
          <button className="btn ghost small" onClick={onClose}>
            ← Drafts
          </button>
          <span className="chip">{draft.origin ? `from catalog: ${draft.origin}` : 'new piece'}</span>
        </header>
        <h2 className="pixel">{draft.title}</h2>
        <p className="key">
          catalog key <code>{draft.key}</code>
        </p>

        <h4>What it is</h4>
        <Field
          label="Name in the catalog"
          hint={f.name.length > 28 ? 'Keep it to a few words: it’s the label in the decorate palette. The description goes in the prompt.' : 'a few words; blank = from the key'}
        >
          <input
            value={f.name}
            maxLength={NAME_MAX}
            placeholder={humanizeKey(draft.key)}
            onChange={(e) => patch({ name: e.target.value })}
            onBlur={() => !f.name.trim() && patch({ name: humanizeKey(draft.key) })}
          />
        </Field>
        <Field label="Category" hint={f.rotation === 'flat' ? 'wall art is always wall-art' : undefined}>
          <select
            value={f.rotation === 'flat' ? 'wall-art' : f.category}
            disabled={f.rotation === 'flat'}
            onChange={(e) => patch({ category: e.target.value as FurnitureSpec['category'] })}
          >
            {CATEGORIES.filter((c) => c !== 'building' && (c !== 'wall-art' || f.rotation === 'flat')).map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Rooms it suits" hint="the decorate palette offers it there first">
          <div className="chips">
            {ROOM_KINDS.map((r) => (
              <button key={r} className={f.rooms.includes(r) ? 'on' : ''} onClick={() => patch({ rooms: f.rooms.includes(r) ? f.rooms.filter((x) => x !== r) : [...f.rooms, r] })}>
                {r}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Tags" hint="words to find it by: material, colour, style (blank = from the key)">
          <input value={f.tags.join(' ')} placeholder="oak wrought-iron park" onChange={(e) => patch({ tags: e.target.value.toLowerCase().split(/[\s,]+/).filter(Boolean) })} />
        </Field>
        <Field label="Moods (optional)" hint="only for rooms with these moods; none = any">
          <div className="chips">
            {THEMES.map((t) => (
              <button key={t} className={f.themes.includes(t) ? 'on' : ''} onClick={() => patch({ themes: f.themes.includes(t) ? f.themes.filter((x) => x !== t) : [...f.themes, t] })}>
                {t}
              </button>
            ))}
          </div>
        </Field>

        <h4>Size and turning</h4>
        <div className="row">
          {f.category !== 'seating' && <Field label="Footprint: width × depth" hint="tiles, as seen facing sw">
            <div className="pair">
              <input type="number" min={1} max={4} value={f.footprint[0]} onChange={(e) => patch({ footprint: [Number(e.target.value), f.footprint[1]] })} />
              <span>×</span>
              <input type="number" min={1} max={4} value={f.footprint[1]} onChange={(e) => patch({ footprint: [f.footprint[0], Number(e.target.value)] })} />
            </div>
          </Field>}
          <Field label={`Height · ${heightClass(f.height)}`} hint="art px: a chair ≈ 34, a person ≈ 50, a shelf ≈ 70; measured from the drawing">
            <input type="number" min={1} max={200} value={f.height} onChange={(e) => patch({ height: Number(e.target.value) })} />
          </Field>
        </div>
        <Field label="Drawn width (art px)" hint={`across the whole drawing, in art pixels (not tiles): the model doesn't keep scale, this fixes it. ${drawnPx} = its ${f.footprint[0]}×${f.footprint[1]} footprint, the default`}>
          <input
            type="number"
            min={16}
            max={400}
            value={f.width ?? drawnPx}
            onChange={(e) => {
              const n = Number(e.target.value);
              patch({ width: e.target.value && n !== drawnPx ? n : undefined });
            }}
          />
          {f.width !== undefined && f.width * 3 < drawnPx && (
            <span className="field-warn">
              {f.width} px would be a speck: a {f.footprint[0]}×{f.footprint[1]} piece is about {drawnPx} px across. Leave it blank.
            </span>
          )}
        </Field>
        <Field label="How it turns" hint={ROTATION_HELP[f.rotation]}>
          <div className="seg wide">
            {(['radial', 'mirror', 'full', 'flat'] as const).map((r) => (
              <button
                key={r}
                className={f.rotation === r ? 'on' : ''}
                onClick={() => patch({ rotation: r, ...(r === 'flat' ? { category: 'wall-art' as const } : f.category === 'wall-art' ? { category: 'decor' as const } : {}) })}
              >
                {r}
              </button>
            ))}
          </div>
        </Field>
        {f.rotation === 'mirror' && (
          <label className="check">
            <input type="checkbox" checked={f.sameFromBehind} onChange={(e) => patch({ sameFromBehind: e.target.checked })} /> Looks the same from behind (one drawing serves front and back)
          </label>
        )}

        <h4>What it does</h4>
        {f.rotation !== 'flat' && (
          <Field label="Stands on" hint="a counter-top piece is placed on a counter, never on the bare floor">
            <div className="seg wide">
              {(
                [
                  ['object', 'the floor'],
                  ['surface', 'a counter'],
                  ['floor', 'flat (a rug)'],
                ] as const
              ).map(([v, t]) => (
                <button key={v} className={f.layer === v ? 'on' : ''} onClick={() => patch({ layer: v })}>
                  {t}
                </button>
              ))}
            </div>
          </Field>
        )}
        {f.category === 'seating' && (
          <div className="seat-profile">
            <Field label="Seating type" hint="Sitting poses and furniture overlap are built automatically.">
              <select value={f.seatKind ?? ''} onChange={(e) => {
                const type = SEAT_TYPES.find((t) => t.kind === e.target.value);
                if (type) patch({ seatKind: type.kind, ...type.profile, arms: !!type.profile.arms, footprint: [type.width, 1], height: type.height, seatModel: f.seatModel?.model.surfaces !== undefined ? f.seatModel : null });
              }}>
                {!f.seatKind && <option value="">Choose a seating type</option>}
                {SEAT_TYPES.map((t) => <option key={t.kind} value={t.kind}>{t.label}</option>)}
              </select>
            </Field>
            {(f.seatKind === 'couch' || f.seatKind === 'bench') && <Field label="Number of seats">
              <select value={f.footprint[0]} onChange={(e) => patch({ footprint: [Number(e.target.value), 1], seatModel: f.seatModel?.model.surfaces !== undefined ? f.seatModel : null })}>
                {[2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </Field>}
            {(f.seatKind === 'chair' || f.seatKind === 'bench' || f.seatKind === 'stool') && <div className="row">
              <label className="check"><input type="checkbox" checked={f.backrest} onChange={(e) => patch({ backrest: e.target.checked, seatModel: f.seatModel?.model.surfaces !== undefined ? f.seatModel : null })} /> Backrest</label>
              <label className="check"><input type="checkbox" checked={!!f.arms} onChange={(e) => patch({ arms: e.target.checked, seatModel: f.seatModel?.model.surfaces !== undefined ? f.seatModel : null })} /> Armrests</label>
            </div>}
          </div>
        )}
        <Field label="Surface height (optional)" hint="things stand on it at this z (a counter ≈ 20.5)">
          <input type="number" value={f.surface ?? ''} placeholder="—" onChange={(e) => patch({ surface: e.target.value === '' ? null : Number(e.target.value) })} />
        </Field>
        <label className="check">
          <input type="checkbox" checked={!!f.light} onChange={(e) => patch({ light: e.target.checked ? { x: 0, y: 0, r: 40 } : null })} /> It lights up (switches on and off, lights the floor)
        </label>
        <div className="row">
          <Field label="Action when clicked">
            <select
              value={f.actions[0]?.kind ?? ''}
              onChange={(e) => {
                const k = e.target.value;
                patch({
                  actions:
                    k === 'info'
                      ? [{ kind: 'info', title: f.name || draft.title, body: 'Write what it says here.' }]
                      : k === 'vend'
                        ? [{ kind: 'vend', item: 'coffee', label: 'Get a coffee' }]
                        : k === 'ring'
                          ? [{ kind: 'ring', label: 'Ring it' }]
                          : [],
                });
              }}
            >
              <option value="">{f.category === 'seating' ? 'sit' : f.light ? 'switch on/off' : 'none'}</option>
              <option value="info">show a note</option>
              <option value="vend">hand something out</option>
              <option value="ring">ring for the room</option>
            </select>
          </Field>
          <Field label="Used from">
            <div className="seg wide">
              {(['front', 'any'] as const).map((v) => (
                <button key={v} className={f.useFace === v ? 'on' : ''} onClick={() => patch({ useFace: v })}>
                  {v === 'front' ? 'its front' : 'any side'}
                </button>
              ))}
            </div>
          </Field>
        </div>

        <h4>Describe it</h4>
        <Field label="Prompt" hint="what it is, materials, colours, era; the style block is added for you">
          <textarea rows={5} value={f.prompt} placeholder="A cosy two-seat park bench with oak slats and curly black wrought-iron ends…" onChange={(e) => patch({ prompt: e.target.value })} />
        </Field>
        {f.rotation === 'full' && (
          <details className="per-view">
            <summary>Per-view notes (where handed details go)</summary>
            {FACINGS.map((fc) => (
              <Field key={fc} label={fc}>
                <input value={f.prompts[fc] ?? ''} onChange={(e) => patch({ prompts: { ...f.prompts, [fc]: e.target.value } })} />
              </Field>
            ))}
          </details>
        )}
        <RefsPanel draft={draft} onDraft={setDraft} onError={setError} />
        <Field label="Quality">
          <div className="seg wide">
            {(['low', 'medium', 'high'] as const).map((q) => (
              <button key={q} className={f.quality === q ? 'on' : ''} onClick={() => patch({ quality: q })}>
                {q}
              </button>
            ))}
          </div>
        </Field>
        <button className="btn primary big" disabled={!!busy || !f.prompt.trim()} onClick={() => setConfirm({})}>
          {have.length ? '✦ Draw it again' : '✦ Draw it'} <small>{needed.length === 1 ? 'one drawing' : `${needed.length} views (${needed.join(' + ')})`}</small>
        </button>
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
            <h3>Every side</h3>
            <span className="muted">cyan: its footprint · square: the footprint’s centre · drawn views must be accepted to publish</span>
          </header>
          {have.length === 0 ? (
            <div className="lab-empty small">Describe the piece and draw it: every view it needs appears here.</div>
          ) : (
            <div className="views">
              {FACINGS.map((fc) => (
                <ViewCell
                  key={fc}
                  draft={draft}
                  facing={fc}
                  needed={needed}
                  checks={checks?.placement.find((p) => p.facing === fc)}
                  onNudge={(v, n) => void setView(v, { nudge: n })}
                  onAccept={(v, a) => void setView(v, { accepted: a })}
                  onRedraw={(v, n) => setConfirm({ view: v, note: n })}
                  busy={!!busy}
                />
              ))}
            </div>
          )}
        </section>
        {seating && have.length > 0 && <ModelPanel draft={draft} onPatch={patch} onStatus={setModelStatus} />}
        {have.length > 0 && <Sandbox draft={draft} version={version} onNote={setNote} />}
      </main>

      <aside className="side">
        <section className="lab-card">
          <header className="card-head">
            <h3>Checks</h3>
            <button className="btn ghost small" onClick={() => void runChecks()} disabled={!have.length}>
              Run again
            </button>
          </header>
          {!checks ? (
            <p className="muted">Checks run when the piece has drawings.</p>
          ) : (
            <ul className="checks">
              <li className={problems.length ? 'bad' : 'good'}>{problems.length ? problems.join(' · ') : `Four-way standard: ${f.rotation}, every drawing it needs`}</li>
              {checks.placement.map((p) => (
                <li key={p.facing} className={p.ok ? 'good' : 'bad'}>
                  <b>{p.facing}</b> {p.notes.length ? p.notes.join(' · ') : 'sits on its footprint, clean edges, no stray pixels'}
                </li>
              ))}
              {seating && (
                <li className={modelStatus === 'ok' ? 'good' : modelStatus === 'unreviewed' || modelStatus === 'loading' || modelStatus === 'stale' ? 'warn' : 'bad'}>
                  {modelStatus === 'ok'
                    ? 'Seating checks passed in every direction'
                    : modelStatus === 'bad'
                      ? 'Seating needs another take; see How people sit'
                      : 'Building and checking seating automatically?'}
                </li>
              )}
              <li className={allAccepted ? 'good' : 'warn'}>{allAccepted ? 'Every view accepted' : `Accept: ${needed.filter((v) => !draft.views[v]?.accepted).join(', ') || '—'}`}</li>
            </ul>
          )}
          <button className="btn primary" disabled={!canPublish} onClick={() => void publish(!!draft.origin)}>
            {draft.published ? 'Publish again' : 'Publish to catalog'}
          </button>
          {draft.published && <p className="muted small">Published {draft.published.replace('T', ' ')}</p>}
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
        <Confirm
          title={confirm.view ? `Redraw the ${confirm.view} view?` : 'Draw it?'}
          usage={usage}
          est={est}
          onCancel={() => setConfirm(null)}
          onOk={() => void generate(confirm.view, confirm.note)}
        >
          {confirm.view ? (
            <p>
              One new drawing of the <b>{confirm.view}</b> side, with the accepted views as references so it stays the same piece.
              {confirm.note && (
                <>
                  {' '}
                  Note: “{confirm.note}”
                </>
              )}
            </p>
          ) : (
            <p>
              One sheet with {needed.length === 1 ? 'the piece' : `its ${needed.length} views (${needed.join(', ')})`} at {f.quality} quality
              {draft.refs.length ? `, with ${draft.refs.length} reference image${draft.refs.length > 1 ? 's' : ''}` : ''}.
            </p>
          )}
        </Confirm>
      )}
    </div>
  );
}

function ViewCell(props: {
  draft: Draft;
  facing: Facing;
  needed: string[];
  checks?: { ok: boolean; notes: string[] };
  onNudge: (view: string, n: [number, number]) => void;
  onAccept: (view: string, a: boolean) => void;
  onRedraw: (view: string, note: string) => void;
  busy: boolean;
}) {
  const { draft, facing } = props;
  const f = draft.furniture!;
  const canvas = useRef<HTMLCanvasElement>(null);
  const src = sourceOf(f, Object.keys(draft.views), facing);
  const v = src ? draft.views[src.view] : undefined;
  const [redraw, setRedraw] = useState<string | null>(null);
  const [centred, setCentred] = useState(false);
  // redraw when the drawing, its anchor or nudge, the facing or the footprint changes
  const paintKey = JSON.stringify([draft.id, v, src, facing, f.footprint, f.rotation]);

  useEffect(() => {
    if (!v?.file || !canvas.current) return;
    let live = true;
    void loadImg(lab.fileUrl(draft.id, v.file, String(v.take))).then((img) => {
      if (!live || !canvas.current) return;
      const fp = footprintFor(f, facing);
      const given: [number, number] = [(v.anchor?.[0] ?? 0) + (v.nudge?.[0] ?? 0), (v.anchor?.[1] ?? 0) + (v.nudge?.[1] ?? 0)];
      const g = f.rotation === 'flat' ? { anchor: given, centred: false } : gameAnchor(img, given, fp, src!.mirrored);
      setCentred(g.centred);
      drawView(canvas.current, img, g.anchor, fp, { mirrored: src!.mirrored, maxW: 300, maxH: 260 });
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paintKey]);

  const drawn = !!src && !src.mirrored && (src.view === facing || (src.view === 'one' && facing === 'se'));
  const nudge = v?.nudge ?? [0, 0];
  return (
    <figure className={`view ${drawn ? 'drawn' : 'derived'} ${v?.accepted ? 'accepted' : ''}`}>
      <figcaption>
        <b>{facing}</b>
        <span className="chip">{!src ? 'missing' : src.view === 'one' ? 'one drawing' : src.mirrored ? `mirror of ${src.view}` : `drawn · take ${v?.take}`}</span>
        {centred && (
          <span className="chip soft" title="Small pieces stand centred on their footprint in game, whatever the anchor says">
            auto-centred
          </span>
        )}
        {props.checks && <span className={`dot ${props.checks.ok ? 'good' : 'bad'}`} title={props.checks.notes.join('\n') || 'ok'} />}
      </figcaption>
      <div className="view-canvas">{src ? <canvas ref={canvas} /> : <div className="lab-empty small">not drawn</div>}</div>
      {drawn && v && (
        <div className="view-tools">
          {f.category !== 'seating' && <div className={`nudge ${centred ? 'off' : ''}`} title={centred ? 'Centred automatically: nudging only matters for pieces that fill their footprint' : 'Move the drawing on its footprint (anchor, sprite px)'}>
            <button onClick={() => props.onNudge(src!.view, [nudge[0] + 1, nudge[1]])}>←</button>
            <button onClick={() => props.onNudge(src!.view, [nudge[0], nudge[1] + 1])}>↑</button>
            <button onClick={() => props.onNudge(src!.view, [nudge[0], nudge[1] - 1])}>↓</button>
            <button onClick={() => props.onNudge(src!.view, [nudge[0] - 1, nudge[1]])}>→</button>
            <span className="muted">
              {nudge[0]},{nudge[1]}
            </span>
          </div>}
          <label className="check">
            <input type="checkbox" checked={!!v.accepted} onChange={(e) => props.onAccept(src!.view, e.target.checked)} /> Accept
          </label>
          {redraw === null ? (
            <button className="btn ghost small" disabled={props.busy} onClick={() => setRedraw('')}>
              Redraw…
            </button>
          ) : (
            <form
              className="redraw"
              onSubmit={(e) => {
                e.preventDefault();
                props.onRedraw(src!.view, redraw);
                setRedraw(null);
              }}
            >
              <input autoFocus value={redraw} placeholder="what to change (optional)" onChange={(e) => setRedraw(e.target.value)} />
              <button className="btn small">Go</button>
            </form>
          )}
        </div>
      )}
      {props.checks && !props.checks.ok && <p className="view-note">{props.checks.notes.join(' · ')}</p>}
    </figure>
  );
}
