/**
 * The space's conversation, right above where you type. When the space is linked to a channel, this *is*
 * that channel: its recent history, what people post there live, and what's said here (which goes there
 * too). Also shows your voice link: in the space's voice channel, or one click to join it.
 */
import { useEffect, useRef } from 'react';
import { TOWN_ID } from '@shared/world';
import type { ChatEntry } from '@shared/domain/types';
import { setState, toast, useStore } from '../app/store';
import { openLink } from '../discord/activity';
import { Photo } from './Photo';

const PROVIDER_NAME: Record<string, string> = { discord: 'Discord', slack: 'Slack', demo: 'demo' };

function time(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function Line({ e, meId, photo }: { e: ChatEntry; meId?: string; photo?: string }) {
  const mine = e.memberId && e.memberId === meId;
  return (
    <li className={`chat-line ${mine ? 'mine' : ''}`}>
      <span className="chat-who">
        <Photo url={e.avatarUrl ?? photo} size={16} />
        {e.source !== 'world' && (
          <span className={`chat-src ${e.source}`} title={`Posted in ${PROVIDER_NAME[e.source] ?? e.source}`}>
            {e.source === 'discord' ? 'D' : e.source === 'slack' ? 'S' : '•'}
          </span>
        )}
        <strong>{mine ? 'You' : e.name}</strong>
      </span>{' '}
      <span className="chat-text">{e.text}</span> <time className="chat-time">{time(e.at)}</time>
    </li>
  );
}

function VoiceLink() {
  const sceneId = useStore((s) => s.sceneId);
  const bindings = useStore((s) => s.boot?.bindings);
  const meId = useStore((s) => s.boot?.me.id);
  const myVoice = useStore((s) => (meId ? s.occupants[meId]?.voice : undefined));
  const follow = useStore((s) => s.boot?.me.settings.voiceFollow !== false);
  const talkLight = useStore((s) => !!s.prefs.talkLight);
  const occupants = useStore((s) => s.occupants);
  const voice = bindings?.find((b) => b.roomId === sceneId && b.kind !== 'text');
  if (!voice) return null;
  const here = myVoice?.providerChannelId === voice.externalChannelId;
  // Someone in the room is in this channel's call already: the direct link goes straight in (Slack's huddle link).
  const running = Object.values(occupants).some((o) => o.voice?.providerChannelId === voice.externalChannelId);
  const joinUrl = (running && voice.join.liveWebUrl) || voice.join.webUrl;
  /** Slack has no link that starts a huddle: the channel opens, and its headphones button is the one click left. */
  const startHint = () => {
    if (slack && !running) toast(`Opened ${name} in Slack. Press the headphones button at the top right there to start its huddle — once it’s running, this button joins it in one click.`, 'info', undefined, 9000);
  };
  // Slack can't move you between huddles (Discord can move you between voice channels): there, switching is one click.
  const slack = voice.provider === 'slack';
  const canFollow = follow && voice.provider === 'discord';
  const name = voice.label.replace(/^(🔊|🎧)\s*/, '');
  const inWords = slack ? `In the huddle · ${name}` : `In voice · ${name}`;
  const mic = (
    <button
      className={`mic-toggle ${talkLight ? 'on' : ''}`}
      aria-pressed={talkLight}
      onClick={() => setState((s) => ({ prefs: { ...s.prefs, talkLight: !s.prefs.talkLight } }))}
      title={
        talkLight
          ? 'Showing when you talk (from your mic level on this device — no audio leaves your computer). Click to stop.'
          : 'Light up your avatar when you talk in voice. Uses your mic level on this device only; no audio is recorded or sent.'
      }
    >
      {talkLight ? '🎙️ On' : '🎙️'}
    </button>
  );
  if (here) {
    return (
      <span className="voice-wrap">
        <span className="voice-link on" title={slack ? "You're in this space's huddle" : "You're in this space's voice channel"}>
          🔊 {inWords}
          {myVoice?.muted ? ' (muted)' : ''}
        </span>
        {mic}
      </span>
    );
  }
  if (myVoice) {
    return (
      <button
        className="voice-link moving"
        onClick={() => {
          if (joinUrl) openLink(joinUrl);
          startHint();
        }}
        title={slack ? (running ? 'Slack can’t move you between huddles — one click here switches you.' : 'Slack can’t move you between huddles — this opens the channel; the headphones button starts its huddle.') : "Open this space's voice channel in Discord"}
      >
        {canFollow ? '🎧 Moving your voice here…' : slack ? (running ? `🎧 Switch to the room’s huddle (${name})` : `🎧 Start the room’s huddle in Slack (${name})`) : `🎧 Switch voice to ${name}`}
      </button>
    );
  }
  const join = (
    <button
      className="voice-link join"
      onClick={() => {
        if (joinUrl) openLink(joinUrl);
        else toast(voice.join.explainer, 'info', undefined, 6000);
        startHint();
        if (canFollow) toast('Join the voice channel in Discord once — after that your voice follows you as you walk between spaces.', 'info', undefined, 7000);
      }}
      title={voice.join.explainer}
    >
      {slack ? (running ? '🎧 Join the room’s huddle' : '🎧 Start the room’s huddle in Slack') : '🎧 Join voice'}
    </button>
  );
  // The demo has no real voice: the talk light can still be tried there.
  return voice.provider === 'demo' ? (
    <span className="voice-wrap">
      {join}
      {mic}
    </span>
  ) : (
    join
  );
}

export function ChatPanel() {
  const chat = useStore((s) => s.chat);
  const sceneId = useStore((s) => s.sceneId);
  const meId = useStore((s) => s.boot?.me.id);
  const members = useStore((s) => s.membersById);
  const rooms = useStore((s) => s.boot?.rooms);
  const collapsed = useStore((s) => !!s.prefs.chatCollapsed);
  const list = useRef<HTMLOListElement>(null);
  const room = rooms?.find((r) => r.id === sceneId);
  const entries = chat.sceneId === sceneId ? chat.entries : [];

  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length, collapsed]);

  if (!sceneId || room?.quiet) return null;
  const place = sceneId === TOWN_ID ? 'Town' : (room?.name ?? 'Here');
  const channel = chat.sceneId === sceneId ? chat.channel : undefined;
  const toggle = () => setState((s) => ({ prefs: { ...s.prefs, chatCollapsed: !s.prefs.chatCollapsed } }));

  return (
    <section className={`chat-panel card ${collapsed ? 'collapsed' : ''}`} aria-label={`${place} conversation`}>
      <header className="chat-head">
        <button className="chat-title" onClick={toggle} aria-expanded={!collapsed} title={collapsed ? 'Show the conversation' : 'Fold the conversation'}>
          <span aria-hidden>💬</span>{' '}
          {channel ? (
            <>
              <strong>{channel.name}</strong> <span className="muted">· {PROVIDER_NAME[channel.provider] ?? channel.provider}</span>
            </>
          ) : (
            <>
              <strong>{place}</strong> <span className="muted">· only people here see this</span>
            </>
          )}
          {collapsed && entries.length > 0 && <span className="chat-count">{entries.length}</span>}
        </button>
        <VoiceLink />
      </header>
      {!collapsed && (
        <ol className="chat-log" ref={list} aria-live="polite">
          {entries.length === 0 ? (
            <li className="chat-empty muted">
              {channel ? `Nothing in ${channel.name} yet — say hi (Enter).` : 'Quiet so far. What you say is heard by everyone in this space.'}
            </li>
          ) : (
            entries.slice(-40).map((e) => <Line key={e.id} e={e} meId={meId} photo={e.memberId ? members.get(e.memberId)?.avatarUrl : undefined} />)
          )}
        </ol>
      )}
    </section>
  );
}
