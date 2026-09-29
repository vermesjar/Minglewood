import { useState } from 'react';
import { STATUS_META } from '@shared/presence';
import { carryMeta } from '@shared/carry';
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

/**
 * The person you clicked, docked bottom-right like an info stand: who they are and what you can do at a
 * glance, with the fuller profile one click away. It stays out of the way of the world.
 */
function ProfileCard({ id }: { id: string; x: number; y: number }) {
  const m = useStore((s) => s.membersById.get(id));
  const boot = useStore((s) => s.boot);
  const entry = useStore((s) => s.directory[id]);
  const occ = useStore((s) => s.occupants[id]);
  const interior = useStore((s) => !!s.boot?.rooms.some((r) => r.id === s.sceneId));
  const [more, setMore] = useState(false);
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
  const where = room ? `${room.emoji} ${room.name}` : entry?.sceneId === 'town' ? 'Out in town' : null;

  return (
    <aside className={`infostand card ${interior ? 'beside-panel' : ''}`} role="dialog" aria-label={`${m.displayName} profile`}>
      <button className="close-x" onClick={close} aria-label="Close">
        ×
      </button>
      <div className="profile">
        <div className="infostand-head">
          <div className="infostand-avatar" style={{ background: `${dept?.color ?? '#ccc'}33` }}>
            <AvatarCanvas loadout={m.avatar} crop="bust" scale={2} />
          </div>
          <div className="infostand-who">
            <h3>
              {m.displayName} {isMe && <span className="tag">you</span>}
            </h3>
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
        <p className="infostand-meta muted small">
          {where && <span>📍 {where}</span>}
          <span>
            🕒 {localTime(m.timezone)} · {m.location}
          </span>
        </p>
        {!isMe && shared.length > 0 && <p className="shared-line">✨ You’re both into {shared.join(', ')}</p>}
        {more && (
          <>
            {m.pronouns && <p className="muted small">{m.pronouns}</p>}
            <ul className="facts">
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
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
        {!isMe ? (
          <>
            {!sameRoom && entry?.sceneId && (
              <button className="btn small primary full join" onClick={() => game.goToMember(id)}>
                📍 {room ? `Join ${first}` : `Go to ${first}`}
              </button>
            )}
            <div className="profile-actions compact">
              {sameRoom && (
                <button className="btn small" onClick={() => game.emote('wave', id)}>
                  👋 Wave
                </button>
              )}
              <button
                className={`btn small ${sameRoom ? 'primary' : ''}`}
                disabled={!reachable}
                onClick={() => game.knock(id, 'chat')}
                title={STATUS_META[status].interruptible ? 'Ask if they have a minute' : 'They’ll see it when they’re free'}
              >
                🚪 Knock
              </button>
              <button className="btn small" disabled={!reachable} onClick={() => game.knock(id, 'coffee')}>
                ☕ Coffee?
              </button>
              <MoreButton more={more} setMore={setMore} who={first} />
            </div>
          </>
        ) : (
          <div className="profile-actions compact">
            <button className="btn small" onClick={() => setState({ panel: 'avatar', selection: null })}>
              👕 Wardrobe
            </button>
            <button className="btn small" onClick={() => setState({ panel: 'profile', selection: null })}>
              📝 Profile
            </button>
            <MoreButton more={more} setMore={setMore} who="you" />
          </div>
        )}
        {!isMe && !STATUS_META[status].interruptible && reachable && (
          <p className="fineprint">{first} is {STATUS_META[status].label.toLowerCase()} — knocks are held until they’re free.</p>
        )}
      </div>
    </aside>
  );
}

function MoreButton({ more, setMore, who }: { more: boolean; setMore: (f: (v: boolean) => boolean) => void; who: string }) {
  return (
    <button className="btn small ghost more" onClick={() => setMore((v) => !v)} aria-expanded={more} aria-label={more ? 'Show less' : `More about ${who}`} title={more ? 'Less' : 'More'}>
      {more ? '▴' : '⋯'}
    </button>
  );
}

function ObjectCard({ sceneId, objectId, x, y }: { sceneId: string; objectId: string; x: number; y: number }) {
  const boot = useStore((s) => s.boot);
  const directory = useStore((s) => s.directory);
  const members = useStore((s) => s.membersById);
  const events = useStore((s) => s.events);
  const o = game.object(sceneId, objectId);
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


/**
 * A room NPC (the café's barista), docked bottom-right like a person's card so the two feel like one system —
 * but clearly not a coworker: no presence, no profile, just who they are here and what they do.
 */
function NpcCard({ sceneId, npcId }: { sceneId: string; npcId: string; x: number; y: number }) {
  const interior = useStore((s) => !!s.boot?.rooms.some((r) => r.id === s.sceneId));
  const room = useStore((s) => s.boot?.rooms.find((r) => r.id === sceneId));
  const scene = game.scene(sceneId);
  const npc = scene?.npcs?.find((n) => n.id === npcId);
  if (!npc) return null;
  // what they make, from the machine they run: "Get a coffee", "Trade in your tickets"
  const vend = npc.serves ? scene?.objects.find((o) => o.sprite === npc.serves)?.actions?.find((a) => a.kind === 'vend') : undefined;
  const order = vend && vend.kind === 'vend' ? `${carryMeta(vend.item)?.emoji ?? '✨'} ${vend.label}` : null;
  return (
    <aside className={`infostand card npc-card ${interior ? 'beside-panel' : ''}`} role="dialog" aria-label={`${npc.name}, ${npc.role} (NPC)`}>
      <button className="close-x" onClick={close} aria-label="Close">
        ×
      </button>
      <div className="profile">
        <div className="infostand-head">
          <div className="infostand-avatar npc">
            <AvatarCanvas loadout={npc.avatar} crop="bust" scale={2} />
          </div>
          <div className="infostand-who">
            <h3>
              {npc.name} <span className="tag npc-tag">NPC</span>
            </h3>
            <p className="title">{npc.role}</p>
            {room && (
              <p className="team-line">
                <span>
                  {room.emoji} {room.name}
                </span>
              </p>
            )}
          </div>
        </div>
        <p className="npc-blurb">{npc.blurb}</p>
        {order && (
          <button className="btn small primary full" onClick={() => game.orderFrom(sceneId, npcId)}>
            {order}
          </button>
        )}
        <p className="fineprint">Part of the room — not a coworker.</p>
      </div>
    </aside>
  );
}

export function SelectionLayer() {
  const sel = useStore((s) => s.selection);
  if (!sel) return null;
  if (sel.kind === 'member') return <ProfileCard key={sel.id} id={sel.id} x={sel.x} y={sel.y} />;
  if (sel.kind === 'npc') return <NpcCard key={sel.npcId} sceneId={sel.sceneId} npcId={sel.npcId} x={sel.x} y={sel.y} />;
  return <ObjectCard key={sel.objectId} sceneId={sel.sceneId} objectId={sel.objectId} x={sel.x} y={sel.y} />;
}
