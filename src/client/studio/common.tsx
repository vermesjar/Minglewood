/** Pieces both editors share: labelled fields, the spend confirmation, reference images and the take history. */
import { useRef, useState, type ReactNode } from 'react';
import { lab, type Draft, type Usage } from './api';

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export const usd = (v: number | null | undefined, digits = 2) => (v === null || v === undefined ? '—' : `$${v.toFixed(digits)}`);

/** Every generation asks first: what it makes, what it likely costs, and what's left. */
export function Confirm(props: { title: string; usage: Usage | null; est: number | null; onOk: () => void; onCancel: () => void; children: ReactNode }) {
  const left = props.usage ? props.usage.cap - props.usage.total : null;
  const over = left !== null && props.est !== null && props.est > left;
  return (
    <div className="modal-back" onClick={props.onCancel}>
      <div className="modal lab-card" role="dialog" aria-modal onClick={(e) => e.stopPropagation()}>
        <h3 className="pixel">{props.title}</h3>
        {props.children}
        <dl className="cost">
          <dt>Likely cost</dt>
          <dd>{props.est === null ? 'unknown (no history for this size yet)' : `≈ ${usd(props.est, 3)}`}</dd>
          <dt>Spent today</dt>
          <dd>{usd(props.usage?.today)}</dd>
          <dt>Left in the budget</dt>
          <dd className={over ? 'bad' : ''}>
            {usd(left)} of {usd(props.usage?.cap, 0)}
          </dd>
        </dl>
        <p className="muted small">Drawings take 30–90 seconds. The key stays on the server; nothing leaves this machine but the prompt and references.</p>
        <div className="row end">
          <button className="btn ghost" onClick={props.onCancel}>
            Cancel
          </button>
          <button className="btn primary" autoFocus disabled={over} onClick={props.onOk}>
            Spend {props.est === null ? '' : `≈ ${usd(props.est, 3)}`} and draw
          </button>
        </div>
      </div>
    </div>
  );
}

/** Reference images: drop or pick up to six; they go to the model beside the guide, for look only. */
export function RefsPanel({ draft, onDraft, onError }: { draft: Draft; onDraft: (d: Draft) => void; onError: (m: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);

  async function add(files: FileList | File[]) {
    setBusy(true);
    try {
      let d = draft;
      for (const f of [...files].slice(0, 6)) d = (await lab.addRef(draft.id, f)).draft;
      onDraft(d);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`refs ${over ? 'over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void add(e.dataTransfer.files);
      }}
    >
      <span className="field-label">Reference images</span>
      <div className="ref-row">
        {draft.refs.map((r) => (
          <figure key={r} className="ref">
            <img src={lab.fileUrl(draft.id, `refs/${r}`)} alt="" />
            <button
              className="x"
              title="Remove"
              onClick={() => void lab.removeRef(draft.id, r).then(onDraft, (e: Error) => onError(e.message))}
            >
              ×
            </button>
          </figure>
        ))}
        <button className="ref add" disabled={busy || draft.refs.length >= 6} onClick={() => input.current?.click()}>
          {busy ? '…' : '+'}
        </button>
      </div>
      <span className="field-hint">PNG, JPEG or WebP, up to 8 MB, six at most. Drop them here. Used for look only; the guide sets size and angle.</span>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void add(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}

export function Takes({ draft }: { draft: Draft }) {
  if (!draft.takes.length) return null;
  const spent = draft.takes.reduce((s, t) => s + (t.usd ?? 0), 0);
  return (
    <section className="lab-card">
      <header className="card-head">
        <h3>Takes</h3>
        <span className="muted">{usd(spent, 3)} on this draft</span>
      </header>
      <ol className="takes">
        {[...draft.takes].reverse().map((t) => (
          <li key={t.n}>
            <b>#{t.n}</b> {t.views.join(', ')} <span className="muted">{t.at.replace('T', ' ').slice(5, 16)}</span>
            {t.usd !== undefined && <span className="muted"> · {usd(t.usd, 3)}</span>}
            {t.note && <div className="muted small">“{t.note}”</div>}
          </li>
        ))}
      </ol>
    </section>
  );
}
