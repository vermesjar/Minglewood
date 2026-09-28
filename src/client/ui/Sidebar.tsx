import { useEffect, useMemo, useState } from 'react';
import { suggest, type Suggestion } from '@shared/serendipity';
import { TOWN_ID } from '@shared/world';
import { game, QUESTS, daysSinceStart } from '../app/game';
import { getState, setState, useStore } from '../app/store';
import { formatTime } from './common';

function useNow(ms = 30_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

function SuggestionRow({ s }: { s: Suggestion }) {
  const [why, setWhy] = useState(false);
  const run = () => {
    const a = s.action;
    if (a.kind === 'goto') game.goTo(a.sceneId);
    else if (a.kind === 'knock') game.knock(a.memberId, 'chat');
    else {
      game.goToMember(a.memberId);
      setTimeout(() => {
        const p = game.world?.actorScreen(a.memberId);
        if (p) game.selectMember(a.memberId, p);
      }, 1200);
    }
  };
  return (
    <li className="suggestion">
      <span className="sg-icon" aria-hidden>
        {s.icon}
      </span>
      <div className="sg-body">
        <p>{s.text}</p>
        {why && <p className="why">{s.why}</p>}
        <div className="sg-actions">
          <button className="btn small primary" onClick={run}>
            {s.cta}
          </button>
          <button className="link" onClick={() => setWhy(!why)} aria-expanded={why}>
            Why?
          </button>
          <button className="link" onClick={() => game.dismissSuggestion(s.id)} aria-label={`Dismiss: ${s.text}`}>
            Not now
          </button>
        </div>
      </div>
    </li>
  );
}

export function Sidebar() {
  const boot = useStore((s) => s.boot);
  const directory = useStore((s) => s.directory);
  const events = useStore((s) => s.events);
  const sceneId = useStore((s) => s.sceneId);
  const dismissed = useStore((s) => s.dismissed);
  const greeted = useStore((s) => s.greeted);
  const quests = useStore((s) => s.quests);
  const open = useStore((s) => s.prefs.sidebarOpen);
  const members = useStore((s) => s.membersById);
  const [questsOpen, setQuestsOpen] = useState(true);
  const now = useNow();

  const suggestions = useMemo(() => {
    if (!boot) return [];
    return suggest({
      me: boot.me,
      members: [...members.values()],
      directory: Object.values(directory),
      events,
      rooms: boot.rooms,
      now,
      mySceneId: sceneId ?? undefined,
      dismissed: new Set(dismissed),
      greeted: new Set(greeted),
    });
  }, [boot, members, directory, events, now, sceneId, dismissed, greeted]);

  if (!boot) return null;
  const toggle = () => {
    setState((s) => ({ prefs: { ...s.prefs, sidebarOpen: !s.prefs.sidebarOpen } }));
    game.syncInsets();
  };
  if (!open) {
    return (
      <button className="btn sidebar-toggle collapsed" onClick={toggle} aria-label="Open sidebar">
        ☰ Happening now
      </button>
    );
  }

  const active = events.filter((e) => Date.parse(e.startsAt) <= now && now < Date.parse(e.endsAt));
  const upcoming = events.filter((e) => Date.parse(e.startsAt) > now).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)).slice(0, 3);
  const myTeam = boot.teams.find((t) => t.id === boot.me.teamId);
  const counts = new Map<string, { n: number; open: number }>();
  for (const d of Object.values(directory)) {
    if (!d.online || !d.sceneId) continue;
    const c = counts.get(d.sceneId) ?? { n: 0, open: 0 };
    c.n++;
    if (d.status === 'open') c.open++;
    counts.set(d.sceneId, c);
  }
  const townCount = counts.get(TOWN_ID)?.n ?? 0;
  const isNew = daysSinceStart(boot.me.startDate) <= 30;
  const done = QUESTS.filter((q) => quests[q.id]).length;
  const roomName = (id: string) => boot.rooms.find((r) => r.id === id)?.name ?? id;

  return (
    <aside className="sidebar card" aria-label="Happening now">
      <div className="sidebar-head">
        <h2 className="pixel">Happening now</h2>
        <button className="icon-btn ghost" onClick={toggle} aria-label="Collapse sidebar">
          ⟨
        </button>
      </div>
      <div className="sidebar-scroll">
        {active.map((e) => (
          <section key={e.id} className="event-card festive">
            <p className="event-kicker">{e.kind === 'birthday' ? '🎂 Celebration' : '🎉 Event'} · now</p>
            <h3>{e.title}</h3>
            <p className="muted">{e.description}</p>
            <div className="row">
              {sceneId === e.roomId ? (
                <>
                  <button className="btn small" onClick={() => game.emote('celebrate')}>
                    🎉 Celebrate
                  </button>
                  {e.rewardItemId && !boot.me.unlockedItems.includes(e.rewardItemId) && (
                    <button className="btn small primary" onClick={() => game.claimReward(e.id)}>
                      🎁 Grab a party hat
                    </button>
                  )}
                </>
              ) : (
                <button className="btn small primary" onClick={() => game.goTo(e.roomId)}>
                  Stop by {roomName(e.roomId)}
                </button>
              )}
            </div>
          </section>
        ))}

        {suggestions.length > 0 && (
          <section>
            <h3 className="section-title">For you</h3>
            <ul className="suggestions">
              {suggestions.map((s) => (
                <SuggestionRow key={s.id} s={s} />
              ))}
            </ul>
          </section>
        )}

        <section>
          <h3 className="section-title">Places</h3>
          <ul className="places">
            <li>
              <button className={`place ${sceneId === TOWN_ID ? 'here' : ''}`} onClick={() => game.goTo(TOWN_ID)}>
                <span aria-hidden>🏞️</span>
                <span className="place-name">Out in town</span>
                <span className="count">{townCount}</span>
              </button>
            </li>
            {boot.rooms.map((r) => {
              const c = counts.get(r.id);
              return (
                <li key={r.id}>
                  <button className={`place ${sceneId === r.id ? 'here' : ''}`} onClick={() => game.goTo(r.id)} aria-label={`${r.name}, ${c?.n ?? 0} people`}>
                    <span aria-hidden>{r.emoji}</span>
                    <span className="place-name">
                      {r.name}
                      {myTeam?.homeRoomId === r.id && <em className="tag">your team</em>}
                      {r.quiet && <em className="tag quiet">quiet</em>}
                    </span>
                    {!!c?.open && <span className="open-dot" title={`${c.open} open to chat`} />}
                    <span className="count">{c?.n ?? 0}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {isNew && (
          <section className="quests">
            <button className="section-title as-button" onClick={() => setQuestsOpen(!questsOpen)} aria-expanded={questsOpen}>
              Your first week <span className="muted">· {done}/{QUESTS.length}</span>
            </button>
            {questsOpen && (
              <>
                <p className="muted small">Optional little adventures. No deadlines, no scores.</p>
                <ul>
                  {QUESTS.map((q) => (
                    <li key={q.id} className={quests[q.id] ? 'done' : ''} title={q.hint}>
                      <span aria-hidden>{quests[q.id] ? '✅' : '◻️'}</span> {q.label}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}

        {upcoming.length > 0 && (
          <section>
            <h3 className="section-title">Coming up</h3>
            <ul className="upcoming">
              {upcoming.map((e) => (
                <li key={e.id}>
                  <strong>{e.title}</strong>
                  <span className="muted small">
                    {new Date(e.startsAt).toLocaleDateString([], { weekday: 'short' })} {formatTime(e.startsAt)} · {roomName(e.roomId)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <p className="sidebar-foot muted small">Presence here is live and never recorded.</p>
    </aside>
  );
}

// Keep `getState` tree-shaken import used for debugging in dev tools.
if (import.meta.env.DEV) (window as unknown as { mw: unknown }).mw = { getState, setState, game };
