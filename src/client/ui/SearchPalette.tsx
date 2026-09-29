import { useMemo, useState, type ReactNode } from 'react';
import { STATUS_META } from '@shared/presence';
import { TOWN_ID } from '@shared/world';
import { game } from '../app/game';
import { setState, useStore } from '../app/store';
import { AvatarCanvas, Modal, StatusDot } from './common';

interface Result {
  key: string;
  group: 'People' | 'Places' | 'Teams' | 'Projects' | 'Events';
  icon: ReactNode;
  title: string;
  sub: string;
  score: number;
  run: () => void;
}

const PROJECTS = [{ name: 'Aurora 2.0', keywords: 'aurora launch offline sync onboarding project', roomId: 'launch', icon: '🚀' }];

function score(hay: string, q: string): number {
  const h = hay.toLowerCase();
  if (!q) return 1;
  if (h.startsWith(q)) return 3;
  if (h.includes(` ${q}`)) return 2;
  if (h.includes(q)) return 1;
  return 0;
}

export function SearchPalette() {
  const boot = useStore((s) => s.boot);
  const members = useStore((s) => s.membersById);
  const directory = useStore((s) => s.directory);
  const events = useStore((s) => s.events);
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);

  const results = useMemo(() => {
    if (!boot) return [];
    const query = q.trim().toLowerCase().replace(/^find\s+/, '');
    const out: Result[] = [];
    const close = () => setState({ panel: null });
    for (const m of members.values()) {
      if (m.id === boot.me.id) continue;
      const team = boot.teams.find((t) => t.id === m.teamId);
      const hay = [m.displayName, m.title, team?.name, ...m.askMeAbout, ...m.interests].join(' ');
      const s = score(hay, query) + (score(m.displayName, query) ? 2 : 0);
      if (!s) continue;
      const d = directory[m.id];
      const room = boot.rooms.find((r) => r.id === d?.sceneId);
      out.push({
        key: m.id,
        group: 'People',
        icon: <AvatarCanvas loadout={m.avatar} head scale={2} />,
        title: m.displayName,
        sub: `${m.title} · ${d?.online ? `${STATUS_META[d.status].label}${room ? ` in ${room.name}` : d.sceneId === TOWN_ID ? ' in town' : ''}` : 'Offline'}`,
        score: s + (d?.online ? 0.5 : 0),
        // a person opens their card (wherever they are); jumping to them is a choice made from the card
        run: () => {
          close();
          game.showMember(m.id);
        },
      });
    }
    for (const r of boot.rooms) {
      const s = score(`${r.name} ${r.description} ${r.purpose}`, query);
      if (!s) continue;
      const n = Object.values(directory).filter((d) => d.online && d.sceneId === r.id).length;
      out.push({ key: r.id, group: 'Places', icon: r.emoji, title: r.name, sub: `${n} here · ${r.description}`, score: s + 1, run: () => (close(), game.goTo(r.id)) });
    }
    for (const t of boot.teams) {
      const s = score(`${t.name} ${t.blurb} ${boot.departments.find((d) => d.id === t.departmentId)?.name}`, query);
      if (!s || !t.homeRoomId) continue;
      const room = boot.rooms.find((r) => r.id === t.homeRoomId);
      out.push({ key: t.id, group: 'Teams', icon: t.emoji, title: t.name, sub: `Hangs out in ${room?.name}`, score: s, run: () => (close(), game.goTo(t.homeRoomId!)) });
    }
    for (const p of PROJECTS) {
      const s = score(`${p.name} ${p.keywords}`, query);
      if (!s) continue;
      out.push({ key: p.name, group: 'Projects', icon: p.icon, title: p.name, sub: 'Project room: Launch Lab', score: s + 0.5, run: () => (close(), game.goTo(p.roomId)) });
    }
    for (const e of events) {
      const s = score(`${e.title} ${e.description}`, query);
      if (!s) continue;
      const room = boot.rooms.find((r) => r.id === e.roomId);
      const live = Date.parse(e.startsAt) <= Date.now() && Date.now() < Date.parse(e.endsAt);
      out.push({ key: e.id, group: 'Events', icon: live ? '🎉' : '📅', title: e.title, sub: `${live ? 'Happening now' : new Date(e.startsAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })} · ${room?.name}`, score: s, run: () => (close(), game.goTo(e.roomId)) });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 12);
  }, [q, boot, members, directory, events]);

  const pick = (r?: Result) => r?.run();
  let lastGroup = '';

  return (
    <Modal onClose={() => setState({ panel: null })} label="Search">
      <div className="search">
        <input
          autoFocus
          className="search-input"
          value={q}
          placeholder="Find Maya, Engineering, café, Aurora…"
          onChange={(e) => {
            setQ(e.target.value);
            setIdx(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIdx((i) => Math.min(results.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIdx((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter') pick(results[idx]);
          }}
          aria-label="Search people, places, teams, projects and events"
          aria-activedescendant={results[idx] ? `sr-${results[idx].key}` : undefined}
        />
        <ul className="results" role="listbox">
          {results.map((r, i) => {
            const header = r.group !== lastGroup ? <li className="group" role="presentation">{r.group}</li> : null;
            lastGroup = r.group;
            const d = r.group === 'People' ? directory[r.key] : undefined;
            return (
              <FragmentRow key={r.key} header={header}>
                <li id={`sr-${r.key}`} role="option" aria-selected={i === idx} className={`result ${i === idx ? 'on' : ''}`} onMouseEnter={() => setIdx(i)} onClick={() => pick(r)}>
                  <span className="r-icon">{r.icon}</span>
                  <span className="r-text">
                    <strong>
                      {r.title} {d && <StatusDot status={d.online ? d.status : 'offline'} size={8} />}
                    </strong>
                    <small>{r.sub}</small>
                  </span>
                  <span className="r-go" aria-hidden>
                    ↵
                  </span>
                </li>
              </FragmentRow>
            );
          })}
          {results.length === 0 && <li className="empty">No matches. Try a name, a team, or a place like “café”.</li>}
        </ul>
        <p className="fineprint">Pick someone to see their card — join them from there, no long walks.</p>
      </div>
    </Modal>
  );
}

function FragmentRow({ header, children }: { header: ReactNode; children: ReactNode }) {
  return (
    <>
      {header}
      {children}
    </>
  );
}
