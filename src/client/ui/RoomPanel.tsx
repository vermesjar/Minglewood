import { STATUS_META } from '@shared/presence';
import { game } from '../app/game';
import { setState, toast, useStore } from '../app/store';
import { openLink } from '../discord/activity';
import { AvatarCanvas, StatusDot, formatDate } from './common';
import type { BindingView } from '@shared/api';

const PURPOSE: Record<string, string> = {
  hq: 'Company HQ',
  social: 'Social space',
  team: 'Team space',
  project: 'Project room',
  event: 'Event hall',
  focus: 'Quiet space',
  recreation: 'Recreation',
};

function JoinConversation({ binding, speaking }: { binding: BindingView; speaking: number }) {
  const demo = binding.provider === 'demo';
  const slack = binding.provider === 'slack';
  const join = () => {
    if (binding.join.kind === 'deeplink' && binding.join.webUrl) openLink(binding.join.webUrl);
    else toast('Demo mode: in a connected workspace this opens the Discord voice channel for this room. Here the chatter is simulated.', 'info', undefined, 8000);
  };
  return (
    <div className="convo">
      <div className="convo-head">
        <span className={`voice-orb ${speaking ? 'live' : ''}`} aria-hidden>
          🔊
        </span>
        <div>
          <strong>{binding.label}</strong>
          <p className="muted small">
            {demo
              ? 'Demo voice channel (simulated)'
              : slack
                ? `Slack ${binding.kind === 'text' ? 'channel' : 'huddle'}`
                : `Discord ${binding.kind === 'stage' ? 'stage' : binding.kind} channel`}
            {speaking > 0 && ` · ${speaking} talking`}
          </p>
        </div>
      </div>
      <button className="btn primary full" onClick={join}>
        {slack ? (binding.kind === 'text' ? 'Open in Slack' : 'Join in Slack') : binding.kind === 'text' ? 'Open channel' : 'Join the conversation'}
      </button>
      <p className="fineprint">{binding.join.explainer}</p>
    </div>
  );
}

export function RoomPanel() {
  const sceneId = useStore((s) => s.sceneId);
  const boot = useStore((s) => s.boot);
  const occupants = useStore((s) => s.occupants);
  const members = useStore((s) => s.membersById);
  const events = useStore((s) => s.events);
  if (!boot || !sceneId) return null;
  const room = boot.rooms.find((r) => r.id === sceneId);
  if (!room) return null;
  const binding = boot.bindings.find((b) => b.roomId === room.id);
  const owner = boot.teams.find((t) => t.id === room.ownerTeamId);
  const now = Date.now();
  const ev = events.find((e) => e.roomId === room.id && Date.parse(e.startsAt) <= now && now < Date.parse(e.endsAt));
  const people = Object.values(occupants).sort((a, b) => a.memberId.localeCompare(b.memberId));
  const speaking = people.filter((p) => p.speaking).length;
  const artifacts = boot.artifacts.filter((a) => a.sceneId === room.id);
  const openArtifact = (artifactId: string) => {
    const o = game.scene(room.id)?.objects.find((x) => x.artifactId === artifactId);
    if (!o) return;
    game.quest('artifact');
    setState({ selection: { kind: 'object', sceneId: room.id, objectId: o.id, x: window.innerWidth - 380, y: 260 } });
  };

  return (
    <aside className="room-panel card" aria-label={`${room.name} details`}>
      <header>
        <span className="room-emoji" aria-hidden>
          {room.emoji}
        </span>
        <div>
          <h2 className="pixel">{room.name}</h2>
          <p className="muted small">
            {PURPOSE[room.purpose]}
            {owner && (
              <>
                {' '}
                · home of {owner.emoji} {owner.name}
              </>
            )}
          </p>
        </div>
      </header>
      <p className="room-desc">{room.description}</p>
      {owner &&
        (game.canDecorate(room.id) ? (
          <button className="btn small decorate-btn" onClick={() => game.setDecorate({ itemId: 'plant-small' })}>
            🌿 Decorate our space
          </button>
        ) : (
          <p className="muted small">
            {owner.emoji} {owner.name} made this room their own.
          </p>
        ))}

      {ev && (
        <div className="event-card festive compact">
          <strong>{ev.title}</strong>
          <p className="muted small">{ev.description}</p>
          <div className="row">
            <button className="btn small" onClick={() => game.emote('celebrate')}>
              🎉 Celebrate
            </button>
            {ev.rewardItemId && !boot.me.unlockedItems.includes(ev.rewardItemId) && (
              <button className="btn small primary" onClick={() => game.claimReward(ev.id)}>
                🎁 Grab a party hat
              </button>
            )}
          </div>
        </div>
      )}

      {room.quiet ? (
        <div className="quiet-note">
          <strong>🤫 Quiet space</strong>
          <p className="muted small">Everyone here shows as focused. Knocks wait until they come up for air. No voice channel — on purpose.</p>
        </div>
      ) : binding ? (
        <JoinConversation binding={binding} speaking={speaking} />
      ) : (
        <p className="muted small">No conversation channel is bound to this room yet. Admins can add one.</p>
      )}

      <h3 className="section-title">Here now · {people.length}</h3>
      <ul className="people-list">
        {people.map((p) => {
          const m = members.get(p.memberId);
          if (!m) return null;
          const me = p.memberId === boot.me.id;
          return (
            <li key={p.memberId}>
              <button
                className="person-row"
                onClick={(e) => {
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  game.selectMember(p.memberId, { x: r.left - 10, y: r.top + 20 });
                }}
              >
                <span className={`head ${p.speaking ? 'speaking' : ''}`}>
                  <AvatarCanvas loadout={p.avatar} head scale={2} />
                </span>
                <span className="person-text">
                  <strong>
                    {me ? 'You' : m.displayName}
                    {p.via === 'provider' && <em className="tag">{binding?.provider === 'slack' ? 'in the Slack huddle' : 'in Discord voice'}</em>}
                  </strong>
                  <small>
                    <StatusDot status={p.status} size={8} /> {p.note ?? STATUS_META[p.status].label}
                  </small>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {artifacts.length > 0 && (
        <>
          <h3 className="section-title">History in this room</h3>
          <ul className="artifact-list">
            {artifacts.map((a) => (
              <li key={a.id}>
                <button className="link-row" onClick={() => openArtifact(a.id)}>
                  <span>🏺 {a.title}</span>
                  <small className="muted">{formatDate(a.occurredAt)}</small>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <button className="btn full ghost-btn" onClick={() => game.exitToTown()}>
        ← Back to town
      </button>
    </aside>
  );
}
