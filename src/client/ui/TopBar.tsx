import { useEffect, useRef, useState } from 'react';
import { BRAND } from '@shared/brand';
import { SETTABLE_STATUSES, STATUS_META } from '@shared/presence';
import { VIBES, applyVibe } from '@shared/avatar';
import { TOWN_ID } from '@shared/world';
import type { PresenceStatus } from '@shared/domain/types';
import { game } from '../app/game';
import { setState, useStore } from '../app/store';
import { AvatarCanvas, StatusDot } from './common';

const NOTE_IDEAS = ['grabbing coffee ☕', 'deep work', 'happy to pair', 'lunch 🍜', 'reviewing PRs', 'back in 10'];

function useClickAway(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    window.addEventListener('mousedown', h);
    return () => window.removeEventListener('mousedown', h);
  }, [open, close]);
  return ref;
}

function StatusMenu() {
  const meId = useStore((s) => s.boot?.me.id);
  const entry = useStore((s) => (meId ? s.directory[meId] : undefined));
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const ref = useClickAway(open, () => setOpen(false));
  const status: PresenceStatus = entry?.status ?? 'available';
  useEffect(() => setNote(entry?.note ?? ''), [entry?.note]);

  const choose = (s: Exclude<PresenceStatus, 'offline'>, n = note) => {
    game.setStatus(s, n || undefined);
    setOpen(false);
  };

  return (
    <div className="menu-wrap" ref={ref}>
      <button className="btn status-btn" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}>
        <StatusDot status={status} />
        <span>{STATUS_META[status].short}</span>
        {entry?.note && <span className="status-note">· {entry.note}</span>}
      </button>
      {open && (
        <div className="card menu status-menu" role="menu">
          <p className="menu-title">How are you showing up?</p>
          {SETTABLE_STATUSES.map((s) => (
            <button key={s} role="menuitemradio" aria-checked={s === status} className={`menu-item ${s === status ? 'on' : ''}`} onClick={() => choose(s as Exclude<PresenceStatus, 'offline'>)}>
              <StatusDot status={s} />
              <span>
                <strong>{STATUS_META[s].label}</strong>
                <small>{STATUS_META[s].description}</small>
              </span>
            </button>
          ))}
          <form
            className="note-row"
            onSubmit={(e) => {
              e.preventDefault();
              choose(status === 'offline' ? 'available' : (status as Exclude<PresenceStatus, 'offline'>));
            }}
          >
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={60} placeholder="What are you up to? (optional)" aria-label="Status note" />
            <button className="btn small">Set</button>
          </form>
          <div className="chips tight">
            {NOTE_IDEAS.map((n) => (
              <button key={n} className="chip" onClick={() => choose(status === 'offline' ? 'available' : (status as Exclude<PresenceStatus, 'offline'>), n)}>
                {n}
              </button>
            ))}
          </div>
          <p className="menu-foot">Your status is visible to coworkers. Nothing about it is ever recorded.</p>
        </div>
      )}
    </div>
  );
}

function MeMenu() {
  const me = useStore((s) => s.boot?.me);
  const [open, setOpen] = useState(false);
  const ref = useClickAway(open, () => setOpen(false));
  if (!me) return null;
  const isAdmin = me.role === 'admin' || me.role === 'owner';
  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <div className="menu-wrap" ref={ref}>
      <button className="btn me-btn" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} aria-label="Your menu">
        <AvatarCanvas loadout={me.avatar} head scale={2} />
      </button>
      {open && (
        <div className="card menu" role="menu">
          <p className="menu-title">{me.displayName}</p>
          <button role="menuitem" className="menu-item" onClick={pick(() => setState({ panel: 'avatar' }))}>
            👕 Wardrobe & avatar
          </button>
          <div className="menu-vibes">
            <p className="menu-sub">Today’s vibe</p>
            <div className="chips tight">
              {(me.outfits ?? []).map((o) => (
                <button key={o.id} className="chip" onClick={pick(() => void game.wearLook(o.loadout, o.name))}>
                  {o.name}
                </button>
              ))}
              {VIBES.slice(0, me.outfits?.length ? 4 : 8).map((v) => (
                <button key={v.id} className="chip" onClick={pick(() => void game.wearLook(applyVibe(me.avatar, v, me.unlockedItems), v.name))}>
                  {v.emoji} {v.name}
                </button>
              ))}
            </div>
          </div>
          <button role="menuitem" className="menu-item" onClick={pick(() => setState({ panel: 'profile' }))}>
            📝 Profile, privacy & accessibility
          </button>
          <button role="menuitem" className="menu-item" onClick={pick(() => setState({ panel: 'people' }))}>
            👥 People directory
          </button>
          <button role="menuitem" className="menu-item" onClick={pick(() => setState({ tour: { active: true, step: 0 } }))}>
            🧭 Take the town tour
          </button>
          {isAdmin && (
            <button role="menuitem" className="menu-item" onClick={pick(() => (location.hash = '#/admin'))}>
              🛠️ Admin console
            </button>
          )}
          <button role="menuitem" className="menu-item" onClick={pick(() => void game.signOut())}>
            🚪 Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function TopBar() {
  const org = useStore((s) => s.boot?.org);
  const sceneId = useStore((s) => s.sceneId);
  const rooms = useStore((s) => s.boot?.rooms);
  const connection = useStore((s) => s.connection);
  const inDiscord = useStore((s) => s.inDiscord);
  const room = rooms?.find((r) => r.id === sceneId);

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="brand-chip card">
          <span aria-hidden>🌲</span>
          <span className="pixel">{BRAND.name}</span>
          <span className="org-name">{org?.name}</span>
          {inDiscord && <span className="demo-chip">in Discord</span>}
        </div>
        <nav className="crumbs card" aria-label="Location">
          {room ? (
            <>
              <button className="crumb-link" onClick={() => game.exitToTown()}>
                ← Town
              </button>
              <span className="crumb-sep">›</span>
              <span className="crumb-here">
                {room.emoji} {room.name}
              </span>
            </>
          ) : (
            <span className="crumb-here">🏞️ {sceneId === TOWN_ID ? 'Northstar Town' : '…'}</span>
          )}
        </nav>
      </div>
      <button className="btn search-btn" onClick={() => setState({ panel: 'search' })}>
        <span aria-hidden>🔎</span> Find people, places, teams… <kbd>Ctrl K</kbd>
      </button>
      <div className="topbar-right">
        {connection !== 'online' && (
          <span className="conn card" role="status">
            {connection === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
          </span>
        )}
        <button className="btn icon-btn" onClick={() => setState({ panel: 'people' })} aria-label="People directory" title="People directory">
          👥
        </button>
        <StatusMenu />
        <MeMenu />
      </div>
    </header>
  );
}
