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

const PROVIDER_NAME: Record<string, string> = { discord: 'Discord', slack: 'Slack', demo: 'demo' };

function time(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function Line({ e, meId }: { e: ChatEntry; meId?: string }) {
  const mine = e.memberId && e.memberId === meId;
  return (
    <li className={`chat-line ${mine ? 'mine' : ''}`}>
      <span className="chat-who">
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
  const voice = bindings?.find((b) => b.roomId === sceneId && b.kind !== 'text');
  if (!voice) return null;
  const here = myVoice?.providerChannelId === voice.externalChannelId;
  if (here) {
    return (
      <span className="voice-link on" title="You're in this space's voice channel">
        🔊 In voice · {voice.label.replace(/^🔊\s*/, '')}
        {myVoice?.muted ? ' (muted)' : ''}
      </span>
    );
  }
  if (myVoice) {
    return (
      <button className="voice-link moving" onClick={() => voice.join.webUrl && openLink(voice.join.webUrl)} title="Open this space's voice channel in Discord">
        {follow ? '🎧 Moving your voice here…' : `🎧 Switch voice to ${voice.label.replace(/^🔊\s*/, '')}`}
      </button>
    );
  }
  return (
    <button
      className="voice-link join"
      onClick={() => {
        if (voice.join.webUrl) openLink(voice.join.webUrl);
        else toast(voice.join.explainer, 'info', undefined, 6000);
        if (voice.provider === 'discord' && follow) toast('Join the voice channel in Discord once — after that your voice follows you as you walk between spaces.', 'info', undefined, 7000);
      }}
      title={voice.join.explainer}
    >
      🎧 Join voice
    </button>
  );
}

export function ChatPanel() {
  const chat = useStore((s) => s.chat);
  const sceneId = useStore((s) => s.sceneId);
  const meId = useStore((s) => s.boot?.me.id);
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
            entries.slice(-40).map((e) => <Line key={e.id} e={e} meId={meId} />)
          )}
        </ol>
      )}
    </section>
  );
}
