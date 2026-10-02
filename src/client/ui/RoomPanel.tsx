import { useState } from 'react';
import { STATUS_META } from '@shared/presence';
import { game } from '../app/game';
import { badgeTitle, callLink, voiceBadge } from '../app/huddles';
import { setState, toast, useStore } from '../app/store';
import { openLink } from '../discord/activity';
import { AvatarCanvas, StatusDot, formatDate } from './common';
import { HuddleIcon } from './HuddleIcon';
import { Photo } from './Photo';
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

function JoinConversation({ binding, speaking, running }: { binding: BindingView; speaking: number; running: boolean }) {
  const demo = binding.provider === 'demo';
  const slack = binding.provider === 'slack';
  const url = (running && binding.join.liveWebUrl) || binding.join.webUrl;
  const join = () => {
    if (binding.join.kind === 'deeplink' && url) {
      openLink(url);
      // Slack has no link that starts a huddle: the channel opens, and its headphones button is the one click left
      if (slack && binding.kind !== 'text' && !running) toast(`Opened ${binding.label.replace(/^🎧\s*/, '')} in Slack. Press the headphones button at the top right there to start its huddle — once it’s running, this button joins it in one click.`, 'info', undefined, 9000);
    } else toast('Demo mode: in a connected workspace this opens the Discord voice channel for this room. Here the chatter is simulated.', 'info', undefined, 8000);
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
        {slack ? (binding.kind === 'text' ? 'Open in Slack' : running ? 'Join the huddle' : 'Start a huddle in Slack') : binding.kind === 'text' ? 'Open channel' : 'Join the conversation'}
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
  const [picked, setPicked] = useState<string[]>([]);
  if (!boot || !sceneId) return null;
  const room = boot.rooms.find((r) => r.id === sceneId);
  if (!room) return null;
  // The room panel is about being *in* the room: its voice channel / huddle first; the chat panel covers the text channel.
  const binding = boot.bindings.find((b) => b.roomId === room.id && b.kind !== 'text') ?? boot.bindings.find((b) => b.roomId === room.id);
  const owner = boot.teams.find((t) => t.id === room.ownerTeamId);
  const now = Date.now();
  const ev = events.find((e) => e.roomId === room.id && Date.parse(e.startsAt) <= now && now < Date.parse(e.endsAt));
  const people = Object.values(occupants).sort((a, b) => a.memberId.localeCompare(b.memberId));
  const slackConnected = !!boot.slackConnected;
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
        <JoinConversation binding={binding} speaking={speaking} running={people.some((p) => p.voice?.providerChannelId === binding.externalChannelId)} />
      ) : (
        <p className="muted small">No conversation channel is bound to this room yet. Admins can add one.</p>
      )}

      <h3 className="section-title">Here now · {people.length}</h3>
      <ul className="people-list">
        {people.map((p) => {
          const m = members.get(p.memberId);
          if (!m) return null;
          const me = p.memberId === boot.me.id;
          const roomChannel = binding && binding.kind !== 'text' ? binding.externalChannelId : undefined;
          const badge = voiceBadge(p, roomChannel, people);
          const with_ = badge?.kind === 'other' ? people.filter((o) => o.memberId !== p.memberId && o.voice?.callId === badge.callId).map((o) => members.get(o.memberId)?.displayName.split(' ')[0] ?? '…') : [];
          const link = badge?.kind === 'other' ? callLink(boot.bindings, p) : undefined;
          const mine = occupants[boot.me.id]?.voice?.callId;
          const together = !me && !!mine && mine === p.voice?.callId;
          return (
            <li key={p.memberId} className={picked.includes(p.memberId) ? 'picked' : ''}>
              {slackConnected && !me && (
                <input
                  type="checkbox"
                  className="pick"
                  checked={picked.includes(p.memberId)}
                  onChange={(e) => setPicked((cur) => (e.target.checked ? [...cur, p.memberId] : cur.filter((x) => x !== p.memberId)))}
                  aria-label={`Huddle with ${m.displayName.split(' ')[0]}`}
                  title="Pick people to start a huddle with"
                />
              )}
              <button
                className="person-row"
                onClick={(e) => {
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  game.selectMember(p.memberId, { x: r.left - 10, y: r.top + 20 });
                }}
              >
                <span className={`head ${p.speaking ? 'speaking' : ''}`}>
                  <AvatarCanvas loadout={p.avatar} head scale={2} />
                  <Photo url={m.avatarUrl} size={16} className="corner" />
                </span>
                <span className="person-text">
                  <strong>
                    {me ? 'You' : m.displayName}
                    <HuddleIcon badge={badge} title={badgeTitle(badge, with_)} size={15} />
                    {p.via === 'provider' && <em className="tag">{binding?.provider === 'slack' ? 'from Slack' : 'from Discord'}</em>}
                  </strong>
                  <small>
                    <StatusDot status={p.status} size={8} /> {p.note ?? STATUS_META[p.status].label}
                    {badge?.kind === 'other' && with_.length > 0 && <span className="muted"> · with {with_.join(', ')}</span>}
                  </small>
                </span>
              </button>
              {badge?.kind === 'other' && !me && !together && (
                <button
                  className="btn small huddle-act"
                  style={{ borderColor: badge.color }}
                  onClick={() => (link ? openLink(link) : void game.askToJoinHuddle(p.memberId))}
                  title={link ? 'Join their huddle in Slack' : 'They’re in a private huddle — ask, and any of them can invite you from Slack'}
                >
                  {link ? '🎧 Join' : '🙋 Ask to join'}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {slackConnected && picked.length > 0 && (
        <button className="btn small primary full" onClick={() => void game.startHuddle(picked).then(() => setPicked([]))}>
          🎧 Start a huddle with {picked.map((id) => members.get(id)?.displayName.split(' ')[0] ?? '…').join(picked.length === 2 ? ' and ' : ', ')}
        </button>
      )}
      {slackConnected && picked.length === 0 && people.length > 1 && <p className="fineprint">Tick people to start a huddle with just them (a table, a one-on-one).</p>}

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
