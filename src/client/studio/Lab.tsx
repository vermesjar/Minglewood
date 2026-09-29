/** The Design Lab shell: drafts, the library, and the spend meter. The URL hash remembers where you are. */
import { useCallback, useEffect, useState } from 'react';
import { CATEGORIES, type ModelCategory } from '@shared/models';
import { lab, NAME_MAX, type DraftSummary, type PartKind, type Rotation, type Usage } from './api';
import { usd } from './common';
import { FurnitureEditor } from './FurnitureEditor';
import { Library } from './Library';
import { PartEditor } from './PartEditor';

type Route = { page: 'drafts' } | { page: 'library' } | { page: 'draft'; id: string; kind: 'furniture' | 'part' };

function parse(hash: string): Route {
  const [page, id, kind] = hash.replace(/^#\/?/, '').split('/');
  if (page === 'library') return { page: 'library' };
  if (page === 'draft' && id) return { page: 'draft', id, kind: kind === 'part' ? 'part' : 'furniture' };
  return { page: 'drafts' };
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

function Meter({ usage }: { usage: Usage | null }) {
  if (!usage) return <div className="meter muted">spend: …</div>;
  const pct = Math.min(100, (usage.total / usage.cap) * 100);
  return (
    <div className="meter" title={`${usage.callsToday} image calls today · art/budget.json caps the total`}>
      <span>
        today <b>{usd(usage.today)}</b>
      </span>
      <span className="bar">
        <i style={{ width: `${pct}%` }} className={pct > 85 ? 'hot' : ''} />
      </span>
      <span>
        <b>{usd(usage.total)}</b> of {usd(usage.cap, 0)}
      </span>
    </div>
  );
}

function NewFurniture({ onMade }: { onMade: (id: string) => void }) {
  const [name, setName] = useState('');
  const [describe, setDescribe] = useState('');
  const [key, setKey] = useState('');
  const [category, setCategory] = useState<ModelCategory>('seating');
  const [rotation, setRotation] = useState<Rotation>('mirror');
  const [fp, setFp] = useState<[number, number]>([1, 1]);
  const [err, setErr] = useState<string | null>(null);
  // catalog keys are lowercase words joined by - (a variant after a dot): "bench-park.oak"
  const k = key || slug(name);
  return (
    <form
      className="lab-card new"
      onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        const flat = rotation === 'flat';
        void lab
          .create({
            kind: 'furniture',
            key: k,
            // the name is a short label of its own (blank: from the key); the description is the prompt
            furniture: { name: name.trim(), prompt: describe.trim(), category: flat ? 'wall-art' : category, rotation, footprint: fp, height: category === 'seating' ? 34 : 40 },
          })
          .then((d) => onMade(d.id), (x: Error) => setErr(x.message));
      }}
    >
      <h3 className="pixel">New furniture</h3>
      <input placeholder="Name: a few words (Oak park bench)" maxLength={NAME_MAX} value={name} onChange={(e) => setName(e.target.value)} />
      <input placeholder={`catalog key: ${k || 'bench-park.oak'}`} value={key} onChange={(e) => setKey(e.target.value.toLowerCase())} className="mono" />
      <textarea rows={2} placeholder="Describe it for the drawing (optional; you can add this later): materials, colours, details…" value={describe} onChange={(e) => setDescribe(e.target.value)} />
      <div className="row">
        <select value={rotation === 'flat' ? 'wall-art' : category} disabled={rotation === 'flat'} onChange={(e) => setCategory(e.target.value as ModelCategory)} style={{ width: 'auto' }}>
          {CATEGORIES.filter((c) => c !== 'building' && c !== 'wall-art').map((c) => (
            <option key={c}>{c}</option>
          ))}
          {rotation === 'flat' && <option>wall-art</option>}
        </select>
        <div className="seg">
          {(['radial', 'mirror', 'full', 'flat'] as const).map((r) => (
            <button type="button" key={r} className={rotation === r ? 'on' : ''} onClick={() => setRotation(r)}>
              {r}
            </button>
          ))}
        </div>
        <div className="seg">
          {(
            [
              [1, 1],
              [2, 1],
              [2, 2],
              [3, 1],
            ] as Array<[number, number]>
          ).map((f) => (
            <button type="button" key={f.join()} className={fp.join() === f.join() ? 'on' : ''} onClick={() => setFp(f)}>
              {f.join('×')}
            </button>
          ))}
        </div>
      </div>
      {err && <p className="bad small">{err}</p>}
      <button className="btn primary" disabled={!k}>
        Start the draft
      </button>
    </form>
  );
}

function NewPart({ onMade }: { onMade: (id: string) => void }) {
  const [kind, setKind] = useState<PartKind>('hair');
  const [label, setLabel] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const name = slug(label);
  return (
    <form
      className="lab-card new"
      onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        void lab
          .create({ kind: 'part', key: `${kind}-${name}`, title: label, part: { kind, name, label } })
          .then((d) => onMade(d.id), (x: Error) => setErr(x.message));
      }}
    >
      <h3 className="pixel">New character part</h3>
      <div className="seg wide">
        {(['hair', 'hat', 'top', 'pet'] as const).map((k) => (
          <button type="button" key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
            {k}
          </button>
        ))}
      </div>
      <input placeholder="Its name in the wardrobe (Wavy bob)" value={label} onChange={(e) => setLabel(e.target.value)} />
      <p className="muted small">
        Library name <code>{name || '…'}</code>. Drawn on the standard figure, front and back, then checked on every body, skin and pose.
      </p>
      {err && <p className="bad small">{err}</p>}
      <button className="btn primary" disabled={name.length < 2}>
        Start the draft
      </button>
    </form>
  );
}

function Drafts({ open }: { open: (id: string, kind: 'furniture' | 'part') => void }) {
  const [drafts, setDrafts] = useState<DraftSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    void lab.drafts().then(setDrafts, (e: Error) => setErr(e.message));
  }, []);
  return (
    <div className="home">
      <div className="new-row">
        <NewFurniture onMade={(id) => open(id, 'furniture')} />
        <NewPart onMade={(id) => open(id, 'part')} />
      </div>
      <h3 className="section">Drafts</h3>
      {err && <div className="banner bad">{err}</div>}
      {drafts && !drafts.length && <div className="lab-empty">No drafts yet. Start one above, or open a published piece from the Library.</div>}
      <div className="draft-grid">
        {(drafts ?? []).map((d) => (
          <button key={d.id} className="lab-card draft-card" onClick={() => open(d.id, d.kind)}>
            <div className="thumb">{d.thumb ? <img src={lab.fileUrl(d.id, d.thumb, d.updated)} alt="" /> : <span className="muted">{d.kind === 'part' ? '☺' : '▢'}</span>}</div>
            <b>{d.title}</b>
            <span className="mono small">{d.key}</span>
            <span className="muted small">
              {d.kind} · {d.published ? 'published' : 'draft'} · {d.updated.replace('T', ' ').slice(0, 16)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function Lab() {
  const [route, setRoute] = useState<Route>(() => parse(location.hash));
  const [usage, setUsage] = useState<Usage | null>(null);
  const [offline, setOffline] = useState<string | null>(null);

  const refreshUsage = useCallback(() => {
    lab.usage().then(
      (u) => {
        setUsage(u);
        setOffline(null);
      },
      (e: Error) => setOffline(e.message),
    );
  }, []);

  useEffect(() => {
    const on = () => setRoute(parse(location.hash));
    window.addEventListener('hashchange', on);
    refreshUsage();
    const t = setInterval(refreshUsage, 60_000);
    return () => {
      window.removeEventListener('hashchange', on);
      clearInterval(t);
    };
  }, [refreshUsage]);

  const go = (hash: string) => {
    location.hash = hash;
  };
  const openDraft = (id: string, kind: 'furniture' | 'part') => go(`#/draft/${id}/${kind}`);

  return (
    <div className="lab">
      <header className="lab-head">
        <a className="brand" href="#/">
          <span className="pixel">Minglewood</span> <b>Design Lab</b>
        </a>
        <span className="chip local" title="Served only to this machine; not in the production build">
          localhost only
        </span>
        <nav className="tabs">
          <button className={route.page !== 'library' ? 'on' : ''} onClick={() => go('#/')}>
            Drafts
          </button>
          <button className={route.page === 'library' ? 'on' : ''} onClick={() => go('#/library')}>
            Library
          </button>
        </nav>
        <span className="spacer" />
        <Meter usage={usage} />
      </header>
      {offline && (
        <div className="banner bad">
          The lab server isn’t answering ({offline}). Run <code>npm run dev</code> and open this page on localhost.
        </div>
      )}
      {route.page === 'drafts' && <Drafts open={openDraft} />}
      {route.page === 'library' && <Library onOpen={(id) => openDraft(id, 'furniture')} />}
      {route.page === 'draft' &&
        (route.kind === 'part' ? (
          <PartEditor key={route.id} id={route.id} usage={usage} onUsage={refreshUsage} onClose={() => go('#/')} />
        ) : (
          <FurnitureEditor key={route.id} id={route.id} usage={usage} onUsage={refreshUsage} onClose={() => go('#/')} />
        ))}
    </div>
  );
}
