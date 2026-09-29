/**
 * What Minglewood says in Slack: previews of room and people links (unfurls), the optional daily "who's
 * around" note, and knock DMs. Every message respects location sharing as seen by *anyone* in a channel:
 * only people who share where they are with everyone are named with their place.
 */
import { STATUS_META } from '@shared/presence';
import { TOWN_ID } from '@shared/world';
import type { Member, OrgEvent } from '@shared/domain/types';
import { config } from '../config';
import type { OrgHub } from '../realtime/orgHub';
import type { Store } from '../store/store';
import { personLink, roomLink } from './commands';

type Block = Record<string, unknown>;

const first = (m: Member) => m.displayName.split(' ')[0];

/** Public presence: around, and where if they share it with everyone. */
function publicPlace(hub: OrgHub, m: Member): { around: boolean; sceneId?: string } {
  const p = hub.presenceOf(m.id);
  const around = p.status !== 'offline' || !!p.voice;
  return { around, sceneId: around && m.settings.locationVisibility === 'everyone' ? p.sceneId : undefined };
}

const button = (text: string, url: string): Block => ({
  type: 'actions',
  elements: [{ type: 'button', text: { type: 'plain_text', text, emoji: true }, url, style: 'primary' }],
});

/** The link a preview is for: a room (`?room=`) or a person (`?to=`) on this Minglewood. */
export function parseWorldLink(url: string): { room?: string; to?: string } | null {
  try {
    const u = new URL(url);
    const base = new URL(config.publicUrl);
    if (u.host !== base.host) return null;
    const room = u.searchParams.get('room') ?? undefined;
    const to = u.searchParams.get('to') ?? undefined;
    return room || to ? { room, to } : null;
  } catch {
    return null;
  }
}

/** A link preview (chat.unfurl's `unfurls[url]`), or null for links we don't recognise. */
export function unfurlFor(hub: OrgHub, store: Store, url: string): { blocks: Block[] } | null {
  const link = parseWorldLink(url);
  if (!link) return null;
  const d = store.get(hub.orgId);
  if (link.room) {
    const room = d.rooms.find((r) => r.id === link.room);
    if (!room) return null;
    const here = store.members(hub.orgId).filter((m) => publicPlace(hub, m).sceneId === room.id);
    const who = here.length ? `${here.length} here now: ${here.slice(0, 6).map(first).join(', ')}${here.length > 6 ? ` +${here.length - 6}` : ''}` : 'Nobody here right now — be the first.';
    return {
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: `*${room.emoji} ${room.name}*\n${room.description}` } },
        { type: 'context', elements: [{ type: 'mrkdwn', text: who }] },
        button(`Walk in →`, roomLink(room.id)),
      ],
    };
  }
  const m = link.to ? store.member(hub.orgId, link.to) : undefined;
  if (!m) return null;
  const w = publicPlace(hub, m);
  const p = hub.presenceOf(m.id);
  const place = !w.around
    ? 'isn’t in Minglewood right now'
    : w.sceneId === TOWN_ID
      ? 'is out in town'
      : w.sceneId
        ? `is in ${d.rooms.find((r) => r.id === w.sceneId)?.emoji ?? ''} ${d.rooms.find((r) => r.id === w.sceneId)?.name ?? 'a room'}`
        : 'is around';
  return {
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: `*${m.displayName}* ${place}${w.around ? ` · ${STATUS_META[p.status].label}` : ''}` } },
      ...(w.around && w.sceneId ? [button(`Join ${first(m)} →`, personLink(m.id))] : []),
    ],
  };
}

/** The daily "who's around" note for a channel. */
export function dailyNote(hub: OrgHub, store: Store, now = new Date()): { text: string; blocks: Block[] } {
  const d = store.get(hub.orgId);
  const around = store.members(hub.orgId).filter((m) => publicPlace(hub, m).around);
  const byRoom = new Map<string, string[]>();
  for (const m of around) {
    const s = publicPlace(hub, m).sceneId;
    if (s && s !== TOWN_ID) byRoom.set(s, [...(byRoom.get(s) ?? []), first(m)]);
  }
  const today = now.toISOString().slice(0, 10);
  const events = d.events.filter((e: OrgEvent) => e.startsAt.slice(0, 10) === today);
  const lines: string[] = [];
  lines.push(around.length ? `*${around.length}* ${around.length === 1 ? 'person is' : 'people are'} around in Minglewood.` : 'It’s quiet in Minglewood so far — drop in and say hi.');
  for (const [roomId, names] of [...byRoom.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 5)) {
    const room = d.rooms.find((r) => r.id === roomId);
    if (room) lines.push(`• ${room.emoji} ${room.name}: ${names.slice(0, 5).join(', ')}${names.length > 5 ? ` +${names.length - 5}` : ''}`);
  }
  for (const e of events.slice(0, 3)) {
    const room = d.rooms.find((r) => r.id === e.roomId);
    lines.push(`🎉 Today: *${e.title}*${room ? ` in ${room.emoji} ${room.name}` : ''} at ${e.startsAt.slice(11, 16)} UTC`);
  }
  const text = lines.join('\n');
  return {
    text,
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }, button('Open Minglewood →', config.publicUrl)],
  };
}

/** A knock delivered as a DM when the person isn't in the world. */
export function knockDm(from: Member, kind: 'chat' | 'coffee'): { text: string; blocks: Block[] } {
  const text = kind === 'coffee' ? `☕ ${from.displayName} knocked — up for a coffee?` : `🚪 ${from.displayName} knocked — they’d like to chat.`;
  return { text, blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }, button(`Join ${first(from)} in Minglewood →`, personLink(from.id))] };
}
