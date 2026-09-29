/**
 * /minglewood — the world from inside Slack. Replies are ephemeral (only the person who typed sees them) and
 * respect everyone's location sharing: someone who doesn't share where they are is never revealed.
 *
 *   /minglewood               who's around and where
 *   /minglewood where @maya   where Maya is
 *   /minglewood join @maya    a link that drops you next to Maya
 *   /minglewood wave @maya    wave at Maya (she sees it in the world)
 *   /minglewood knock @maya   knock for a chat (add "coffee" for a coffee)
 *   /minglewood room café     a link into a room
 */
import { STATUS_META } from '@shared/presence';
import { TOWN_ID } from '@shared/world';
import type { Member } from '@shared/domain/types';
import { config } from '../config';
import type { OrgHub } from '../realtime/orgHub';
import type { Store } from '../store/store';

export interface CommandReply {
  response_type: 'ephemeral';
  text: string;
}

export const roomLink = (roomId: string) => `${config.publicUrl}/?room=${encodeURIComponent(roomId)}`;
export const personLink = (memberId: string) => `${config.publicUrl}/?to=${encodeURIComponent(memberId)}`;

const reply = (text: string): CommandReply => ({ response_type: 'ephemeral', text });

const HELP = [
  '*/minglewood* — who’s around and where',
  '*/minglewood where @someone* — where they are',
  '*/minglewood join @someone* — a link that drops you next to them',
  '*/minglewood wave @someone* — wave at them in the world',
  '*/minglewood knock @someone* — knock for a chat (add `coffee` for a coffee)',
  '*/minglewood room <name>* — a link into a room',
].join('\n');

export class SlackCommands {
  constructor(
    private readonly hub: OrgHub,
    private readonly store: Store,
  ) {}

  private first = (m: Member) => m.displayName.split(' ')[0];

  /** A member from `<@U123|name>`, `<@U123>`, `@name` or a plain name. */
  findMember(text: string): Member | undefined {
    const orgId = this.hub.orgId;
    const mention = /<@([A-Z0-9]+)(?:\|[^>]*)?>/.exec(text);
    if (mention) {
      const id = this.store.identity(orgId, 'slack', mention[1]);
      return id ? this.store.member(orgId, id.memberId) : undefined;
    }
    const q = text.replace(/^@/, '').trim().toLowerCase();
    if (!q) return undefined;
    const members = this.store.members(orgId);
    return (
      members.find((m) => m.displayName.toLowerCase() === q) ??
      members.find((m) => m.displayName.toLowerCase().split(' ')[0] === q) ??
      members.find((m) => m.displayName.toLowerCase().startsWith(q))
    );
  }

  /** Where someone is, as `asker` may see it: a room id, 'town', or undefined (not around / not shared). */
  private whereIs(m: Member, asker?: Member): { sceneId?: string; around: boolean } {
    const p = this.hub.presenceOf(m.id);
    const around = p.status !== 'offline' || !!p.voice;
    const vis = m.settings.locationVisibility;
    const shared = vis === 'everyone' || (vis === 'team' && !!asker && asker.teamId === m.teamId);
    return { sceneId: shared ? p.sceneId : undefined, around };
  }

  private placeName(sceneId: string): string {
    if (sceneId === TOWN_ID) return 'out in town';
    const room = this.store.get(this.hub.orgId).rooms.find((r) => r.id === sceneId);
    return room ? `in ${room.emoji} *${room.name}*` : 'somewhere in the world';
  }

  handle(text: string, caller: Member | undefined): CommandReply {
    const [verb = '', ...restParts] = text.trim().split(/\s+/);
    const rest = restParts.join(' ');
    switch (verb.toLowerCase()) {
      case '':
      case 'who':
      case 'around':
        return this.around(caller);
      case 'help':
        return reply(HELP);
      case 'where':
        return this.where(rest.replace(/^is\s+/i, ''), caller);
      case 'join':
        return this.join(rest, caller);
      case 'wave':
        return this.wave(rest, caller);
      case 'knock':
        return this.knock(rest, caller);
      case 'room':
      case 'go':
        return this.room(rest);
      default:
        return reply(`I didn’t catch that.\n${HELP}`);
    }
  }

  private around(caller?: Member): CommandReply {
    const byPlace = new Map<string, string[]>();
    let hidden = 0;
    for (const m of this.store.members(this.hub.orgId)) {
      const w = this.whereIs(m, caller);
      if (!w.around) continue;
      if (!w.sceneId) {
        hidden++;
        continue;
      }
      byPlace.set(w.sceneId, [...(byPlace.get(w.sceneId) ?? []), this.first(m)]);
    }
    if (!byPlace.size && !hidden) return reply(`Nobody’s in ${config.publicUrl ? `<${config.publicUrl}|Minglewood>` : 'Minglewood'} right now.`);
    const lines = [...byPlace.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([scene, names]) => `• ${this.placeName(scene)} — ${names.slice(0, 8).join(', ')}${names.length > 8 ? ` +${names.length - 8}` : ''}`);
    if (hidden) lines.push(`• ${hidden} more around, not sharing where`);
    return reply(`*Around now*\n${lines.join('\n')}`);
  }

  private where(who: string, caller?: Member): CommandReply {
    const m = this.findMember(who);
    if (!m) return reply(`I don’t know who “${who || '…'}” is in Minglewood yet.`);
    const w = this.whereIs(m, caller);
    const p = this.hub.presenceOf(m.id);
    if (!w.around) return reply(`${m.displayName} isn’t in Minglewood right now.`);
    const label = STATUS_META[p.status].label;
    const status = `${label}${p.note && p.note.toLowerCase() !== label.toLowerCase() ? ` — “${p.note}”` : ''}`;
    if (!w.sceneId) return reply(`${m.displayName} is around (${status}) but isn’t sharing where.`);
    return reply(`${m.displayName} is ${this.placeName(w.sceneId)} (${status}). <${personLink(m.id)}|Join ${this.first(m)}>`);
  }

  private join(who: string, caller?: Member): CommandReply {
    const m = this.findMember(who);
    if (!m) return reply(`I don’t know who “${who || '…'}” is in Minglewood yet.`);
    const w = this.whereIs(m, caller);
    if (!w.around) return reply(`${m.displayName} isn’t in Minglewood right now — try \`/minglewood knock\`.`);
    if (!w.sceneId) return reply(`${m.displayName} isn’t sharing where they are, so I can’t take you there.`);
    return reply(`<${personLink(m.id)}|Join ${this.first(m)} ${this.placeName(w.sceneId).replace(/\*/g, '')} →>`);
  }

  private wave(who: string, caller?: Member): CommandReply {
    if (!caller) return reply('Sign in to Minglewood with Slack once, then you can wave from here.');
    const m = this.findMember(who);
    if (!m) return reply(`I don’t know who “${who || '…'}” is in Minglewood yet.`);
    if (m.id === caller.id) return reply('👋 Hi, you!');
    if (!this.hub.isLive(m.id)) return reply(`${m.displayName} isn’t in the world right now, so they wouldn’t see a wave.`);
    this.hub.notify(m.id, `${this.first(caller)} waved at you from Slack 👋`);
    return reply(`👋 Waved at ${this.first(m)}.`);
  }

  private knock(rest: string, caller?: Member): CommandReply {
    if (!caller) return reply('Sign in to Minglewood with Slack once, then you can knock from here.');
    const coffee = /\bcoffee\b/i.test(rest);
    const m = this.findMember(rest.replace(/\bcoffee\b/i, '').trim());
    if (!m) return reply(`I don’t know who that is in Minglewood yet.`);
    if (m.id === caller.id) return reply('You can’t knock on your own door.');
    this.hub.knock(caller.id, m.id, coffee ? 'coffee' : 'chat');
    return reply(`${coffee ? '☕' : '🚪'} Knocked on ${this.first(m)}’s door. They’ll see it in Minglewood${this.hub.isLive(m.id) ? '' : ' — or as a Slack DM if they’ve turned that on'}.`);
  }

  private room(name: string): CommandReply {
    const q = name.trim().toLowerCase();
    const rooms = this.store.get(this.hub.orgId).rooms;
    const room = q ? rooms.find((r) => r.name.toLowerCase() === q) ?? rooms.find((r) => r.name.toLowerCase().includes(q) || r.id === q) : undefined;
    if (!room) return reply(`Rooms: ${rooms.map((r) => `${r.emoji} ${r.name}`).join(', ')}`);
    return reply(`<${roomLink(room.id)}|Go to ${room.emoji} ${room.name} →>`);
  }
}
