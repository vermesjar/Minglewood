import { useMemo, useState } from 'react';
import { STATUS_META } from '@shared/presence';
import { TOWN_ID } from '@shared/world';
import { game } from '../app/game';
import { setState, useStore } from '../app/store';
import { AvatarCanvas, Modal, StatusDot } from './common';
import { Photo } from './Photo';

type Filter = 'all' | 'available' | 'here' | 'team';

/** Accessible, list-based equivalent of the world: everyone, where they are, how to reach them. */
export function PeoplePanel() {
  const boot = useStore((s) => s.boot);
  const members = useStore((s) => s.membersById);
  const directory = useStore((s) => s.directory);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');

  const groups = useMemo(() => {
    if (!boot) return [];
    const query = q.toLowerCase();
    const list = [...members.values()].filter((m) => {
      const d = directory[m.id];
      if (query && !`${m.displayName} ${m.title}`.toLowerCase().includes(query)) return false;
      if (filter === 'available') return d?.online && (d.status === 'available' || d.status === 'open');
      if (filter === 'here') return d?.online && !!d.sceneId;
      if (filter === 'team') return m.teamId === boot.me.teamId;
      return true;
    });
    return boot.departments
      .map((dep) => ({
        dep,
        people: list
          .filter((m) => m.departmentId === dep.id)
          .sort((a, b) => Number(!!directory[b.id]?.online) - Number(!!directory[a.id]?.online) || a.displayName.localeCompare(b.displayName)),
      }))
      .filter((g) => g.people.length);
  }, [boot, members, directory, filter, q]);

  if (!boot) return null;
  const close = () => setState({ panel: null });
  const where = (id: string) => {
    const d = directory[id];
    if (!d?.online) return 'Offline';
    if (!d.sceneId) return STATUS_META[d.status].label;
    if (d.sceneId === TOWN_ID) return `${STATUS_META[d.status].label} · out in town`;
    return `${STATUS_META[d.status].label} · ${boot.rooms.find((r) => r.id === d.sceneId)?.name}`;
  };

  return (
    <Modal onClose={close} label="People directory" wide>
      <div className="people-panel">
        <h2 className="pixel">People of {boot.org.name}</h2>
        <div className="row wrap">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name or title" aria-label="Filter people" />
          <div className="seg" role="radiogroup" aria-label="Show">
            {(
              [
                ['all', 'Everyone'],
                ['available', 'Available'],
                ['here', 'Around now'],
                ['team', 'My team'],
              ] as Array<[Filter, string]>
            ).map(([k, label]) => (
              <button key={k} role="radio" aria-checked={filter === k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="people-groups">
          {groups.map(({ dep, people }) => (
            <section key={dep.id}>
              <h3 className="dep-title">
                <span className="dept-chip" style={{ background: dep.color }}>
                  {dep.name}
                </span>
                <span className="muted small">{people.length}</span>
              </h3>
              <ul>
                {people.map((m) => {
                  const d = directory[m.id];
                  const team = boot.teams.find((t) => t.id === m.teamId);
                  const isMe = m.id === boot.me.id;
                  return (
                    <li key={m.id} className="person-card">
                      <AvatarCanvas loadout={m.avatar} head scale={2} />
                      <Photo url={m.avatarUrl} size={16} className="corner" />
                      <div className="pc-text">
                        <strong>
                          {m.displayName} {isMe && <span className="tag">you</span>}
                        </strong>
                        <small>
                          {m.title} · {team?.emoji} {team?.name}
                        </small>
                        <small className="muted">
                          <StatusDot status={d?.online ? d.status : 'offline'} size={8} /> {where(m.id)}
                          {d?.note && ` — “${d.note}”`}
                        </small>
                      </div>
                      {!isMe && (
                        <div className="pc-actions">
                          {d?.sceneId && (
                            <button className="btn small" onClick={() => game.goToMember(m.id)}>
                              Go to
                            </button>
                          )}
                          <button className="btn small" disabled={!d?.online} onClick={() => game.knock(m.id, 'chat')}>
                            Knock
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </Modal>
  );
}
