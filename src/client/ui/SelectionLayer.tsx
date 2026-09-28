import { STATUS_META } from '@shared/presence';
import { findObject } from '@shared/world';
import { game } from '../app/game';
import { setState, useStore } from '../app/store';
import { AvatarCanvas, Popover, StatusDot, formatDate, formatTime, localTime, tenureLabel, timeAgo } from './common';

const ARTIFACT_KIND: Record<string, string> = {
  launch: '🚀 Launch',
  award: '🏆 Award',
  offsite: '🧳 Offsite',
  milestone: '⭐ Milestone',
  tenure: '🎖️ Tenure',
  tradition: '🌳 Tradition',
};

function close() {
  setState({ selection: null });
  game.world?.setSelected(null);
}

function ProfileCard({ id, x, y }: { id: string; x: number; y: number }) {
  const m = useStore((s) => s.membersById.get(id));
  const boot = useStore((s) => s.boot);
  const entry = useStore((s) => s.directory[id]);
  const occ = useStore((s) => s.occupants[id]);
  if (!m || !boot) return null;
  const me = boot.me;
  const isMe = id === me.id;
  const team = boot.teams.find((t) => t.id === m.teamId);
  const dept = boot.departments.find((d) => d.id === m.departmentId);
  const manager = m.managerId ? boot.members.find((x) => x.id === m.managerId) : undefined;
  const room = boot.rooms.find((r) => r.id === entry?.sceneId);
  const status = occ?.status ?? entry?.status ?? 'offline';
  const note = occ?.note ?? entry?.note;
  const shared = m.interests.filter((i) => me.interests.map((x) => x.toLowerCase()).includes(i.toLowerCase()));
  const sameRoom = !!occ;
  const first = m.displayName.split(' ')[0];
  const reachable = status !== 'offline';

  return (
    <Popover x={x} y={y} onClose={close} label={`${m.displayName} profile`}>
      <div className="profile">
        <div className="profile-head">
          <div className="profile-avatar" style={{ background: `${dept?.color ?? '#ccc'}33` }}>
            <AvatarCanvas loadout={m.avatar} scale={2} />
          </div>
          <div>
            <h3>
              {m.displayName} {isMe && <span className="tag">you</span>}
            </h3>
            {m.pronouns && <p className="muted small">{m.pronouns}</p>}
            <p className="title">{m.title}</p>
            <p className="team-line">
              <span className="dept-chip" style={{ background: dept?.color }}>
                {dept?.name}
              </span>
              {team && (
                <span>
                  {team.emoji} {team.name}
                </span>
              )}
            </p>
          </div>
        </div>
        <p className="status-line">
          <StatusDot status={status} /> <strong>{STATUS_META[status].label}</strong>
          {note && <span className="muted"> — “{note}”</span>}
          {entry?.until && <span className="muted"> · until {formatTime(entry.until)}</span>}
        </p>
        <ul className="facts">
          {room ? (
            <li>
              📍 In {room.emoji} {room.name}
            </li>
          ) : entry?.sceneId === 'town' ? (
            <li>📍 Out in town</li>
          ) : null}
          <li>
            🕒 {localTime(m.timezone)} for {first} · {m.location}
          </li>
          <li>🌱 {tenureLabel(m.startDate)}</li>
          {manager && <li>🤝 Works with {manager.displayName.split(' ')[0]}</li>}
        </ul>
        {m.bio && <p className="bio">{m.bio}</p>}
        {m.askMeAbout.length > 0 && (
          <div className="chip-group">
            <span className="chip-label">Ask me about</span>
            <div className="chips tight">
              {m.askMeAbout.map((a) => (
                <span key={a} className="chip static">
                  {a}
                </span>
              ))}
            </div>
          </div>
        )}
        {m.interests.length > 0 && (
          <div className="chip-group">
            <span className="chip-label">Into</span>
            <div className="chips tight">
              {m.interests.map((a) => (
                <span key={a} className={`chip static ${shared.includes(a) && !isMe ? 'shared' : ''}`}>
                  {a}
                  {shared.includes(a) && !isMe && ' ✨'}
                </span>
              ))}
            </div>
          </div>
        )}
        {!isMe ? (
          <div className="profile-actions">
            {sameRoom && (
              <button className="btn" onClick={() => game.emote('wave', id)}>
                👋 Wave
              </button>
            )}
            <button className="btn primary" disabled={!reachable} onClick={() => game.knock(id, 'chat')} title={STATUS_META[status].interruptible ? 'Ask if they have a minute' : 'They’ll see it when they’re free'}>
              🚪 Knock
            </button>
            <button className="btn" disabled={!reachable} onClick={() => game.knock(id, 'coffee')}>
              ☕ Coffee?
            </button>
            {!sameRoom && entry?.sceneId && (
              <button className="btn" onClick={() => game.goToMember(id)}>
                📍 Go to {first}
              </button>
            )}
          </div>
        ) : (
          <div className="profile-actions">
            <button className="btn" onClick={() => setState({ panel: 'avatar', selection: null })}>
              👕 Wardrobe
            </button>
            <button className="btn" onClick={() => setState({ panel: 'profile', selection: null })}>
              🪪 Edit profile
            </button>
          </div>
        )}
        {!isMe && !STATUS_META[status].interruptible && reachable && (
          <p className="fineprint">{first} is {STATUS_META[status].label.toLowerCase()} — knocks are held until they’re free.</p>
        )}
      </div>
    </Popover>
  );
}

function ObjectCard({ sceneId, objectId, x, y }: { sceneId: string; objectId: string; x: number; y: number }) {
  const boot = useStore((s) => s.boot);
  const directory = useStore((s) => s.directory);
  const members = useStore((s) => s.membersById);
  const events = useStore((s) => s.events);
  const o = findObject(sceneId, objectId);
  if (!o || !boot) return null;

  const artAction = o.actions?.find((a): a is { kind: 'artifact'; artifactId: string } => a.kind === 'artifact');
  const artifactId = o.artifactId ?? artAction?.artifactId;
  const artifact = artifactId ? boot.artifacts.find((a) => a.id === artifactId) : undefined;
  if (artifact) {
    const people = artifact.contributorIds.map((id) => members.get(id)).filter(Boolean);
    const teams = artifact.teamIds.map((id) => boot.teams.find((t) => t.id === id)).filter(Boolean);
    return (
      <Popover x={x} y={y} onClose={close} label={artifact.title}>
        <div className="artifact">
          <p className="kicker">A piece of {boot.org.name} history</p>
          <h3>{artifact.title}</h3>
          <p className="muted small">
            <span className="tag">{ARTIFACT_KIND[artifact.kind]}</span> {formatDate(artifact.occurredAt)} · {timeAgo(artifact.occurredAt)}
          </p>
          <p className="story">{artifact.story}</p>
          {(people.length > 0 || teams.length > 0) && (
            <div className="contributors">
              {people.map((p) => (
                <button
                  key={p!.id}
                  className="contributor"
                  onClick={(e) => {
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    game.selectMember(p!.id, { x: r.right, y: r.top });
                  }}
                >
                  <AvatarCanvas loadout={p!.avatar} head scale={2} />
                  <span>{p!.displayName.split(' ')[0]}</span>
                </button>
              ))}
              {teams.map((t) => (
                <span key={t!.id} className="chip static">
                  {t!.emoji} {t!.name}
                </span>
              ))}
            </div>
          )}
          <p className="fineprint">Artifacts are added when the company celebrates something. Over the years, the town fills with them.</p>
        </div>
      </Popover>
    );
  }

  if (o.building && o.roomId) {
    const room = boot.rooms.find((r) => r.id === o.roomId);
    const here = Object.values(directory).filter((d) => d.online && d.sceneId === o.roomId);
    const now = Date.now();
    const ev = events.find((e) => e.roomId === o.roomId && Date.parse(e.startsAt) <= now && now < Date.parse(e.endsAt));
    const binding = boot.bindings.find((b) => b.roomId === o.roomId);
    return (
      <Popover x={x} y={y} onClose={close} label={room?.name ?? 'Building'}>
        <div className="building-card">
          <h3>
            {room?.emoji} {room?.name}
          </h3>
          <p className="muted">{room?.description}</p>
          {ev && <p className="event-inline">🎉 {ev.title} — happening now</p>}
          <p className="small">
            {here.length === 0 ? 'Nobody inside right now.' : `${here.length} ${here.length === 1 ? 'person' : 'people'} inside:`}
          </p>
          {here.length > 0 && (
            <div className="faces">
              {here.slice(0, 10).map((d) => {
                const m = members.get(d.memberId);
                return m ? (
                  <span key={d.memberId} className="face" title={`${m.displayName} — ${STATUS_META[d.status].label}`}>
                    <AvatarCanvas loadout={m.avatar} head scale={2} />
                    <StatusDot status={d.status} size={8} />
                  </span>
                ) : null;
              })}
              {here.length > 10 && <span className="muted">+{here.length - 10}</span>}
            </div>
          )}
          {binding && !room?.quiet && <p className="muted small">🔊 Conversation: {binding.label}</p>}
          <button className="btn primary full" onClick={() => game.enterRoom(o.roomId!)}>
            Go inside →
          </button>
          <p className="fineprint">Tip: double-click a building to walk right in.</p>
        </div>
      </Popover>
    );
  }

  const info = o.actions?.find((a) => a.kind === 'info' || a.kind === 'activity' || a.kind === 'link');
  if (info && (info.kind === 'info' || info.kind === 'activity' || info.kind === 'link')) {
    const title = info.kind === 'info' ? info.title : (o.label ?? info.label);
    return (
      <Popover x={x} y={y} onClose={close} label={title}>
        <div className="info-card">
          <h3>{title}</h3>
          <p>{info.body}</p>
          {info.kind === 'activity' && (
            <button className="btn full" disabled title="Coming soon">
              🕹️ Launch together in Discord — coming soon
            </button>
          )}
        </div>
      </Popover>
    );
  }
  return null;
}

export function SelectionLayer() {
  const sel = useStore((s) => s.selection);
  if (!sel) return null;
  if (sel.kind === 'member') return <ProfileCard key={sel.id} id={sel.id} x={sel.x} y={sel.y} />;
  return <ObjectCard key={sel.objectId} sceneId={sel.sceneId} objectId={sel.objectId} x={sel.x} y={sel.y} />;
}
