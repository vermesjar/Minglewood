/**
 * Serendipity: small, deterministic, explainable nudges toward human contact.
 *
 * Rules only use what a coworker could notice by walking around an office: who's in which
 * public room, who says they're open to chat, shared interests people chose to list on their
 * profile, and company events. No behavioral profiling, no hidden signals. Every suggestion
 * carries a plain-language `why` and can be dismissed.
 */
import type { Member, OrgEvent, Room } from './domain/types';
import type { DirectoryEntry } from './protocol';

export type SuggestionAction =
  | { kind: 'goto'; sceneId: string }
  | { kind: 'knock'; memberId: string }
  | { kind: 'profile'; memberId: string };

export interface Suggestion {
  id: string;
  icon: string;
  text: string;
  why: string;
  action: SuggestionAction;
  cta: string;
  priority: number;
}

type Person = Omit<Member, 'settings'>;

export interface SerendipityInput {
  me: Person;
  members: Person[];
  directory: DirectoryEntry[];
  events: OrgEvent[];
  rooms: Room[];
  now: number;
  mySceneId?: string;
  dismissed: ReadonlySet<string>;
  /** People I've already greeted this session (kept client-side, never sent anywhere). */
  greeted: ReadonlySet<string>;
}

const DAY = 24 * 3600_000;
const first = (name: string) => name.split(' ')[0];

export function daysSince(iso: string, now: number): number {
  return Math.floor((now - new Date(iso + (iso.length === 10 ? 'T12:00:00' : '')).getTime()) / DAY);
}

export function suggest(input: SerendipityInput, limit = 4): Suggestion[] {
  const { me, members, directory, events, rooms, now, mySceneId, dismissed, greeted } = input;
  const byId = new Map(members.map((m) => [m.id, m]));
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const out: Suggestion[] = [];
  const online = directory.filter((d) => d.online && d.memberId !== me.id);
  const occupancy = new Map<string, DirectoryEntry[]>();
  for (const d of online) {
    if (!d.sceneId) continue;
    occupancy.set(d.sceneId, [...(occupancy.get(d.sceneId) ?? []), d]);
  }
  const isOpen = (d: DirectoryEntry) => d.status === 'open';

  // 1. Something is being celebrated right now.
  for (const ev of events) {
    const start = Date.parse(ev.startsAt);
    const end = Date.parse(ev.endsAt);
    if (now < start || now > end || mySceneId === ev.roomId) continue;
    const count = occupancy.get(ev.roomId)?.length ?? 0;
    const room = roomById.get(ev.roomId);
    out.push({
      id: `event:${ev.id}`,
      icon: ev.kind === 'birthday' ? '🎂' : '🎉',
      text: `${ev.title} is happening in ${room?.name ?? 'town'}${count ? ` — ${count} people there` : ''}.`,
      why: 'A company event is on right now. Dropping by is always optional.',
      action: { kind: 'goto', sceneId: ev.roomId },
      cta: 'Stop by',
      priority: 100,
    });
  }

  // 2. New hires, from their own manager's perspective as well as everyone else's.
  const myDays = daysSince(me.startDate, now);
  if (myDays <= 30) {
    const manager = me.managerId ? byId.get(me.managerId) : undefined;
    const mgrDir = manager && online.find((d) => d.memberId === manager.id);
    if (manager && mgrDir?.sceneId && !greeted.has(manager.id)) {
      out.push({
        id: `meet-manager:${manager.id}`,
        icon: '🤝',
        text: `Your manager ${first(manager.displayName)} is in ${roomById.get(mgrDir.sceneId)?.name ?? 'town'}.`,
        why: 'You joined recently — saying hi to your manager in person is a great first step.',
        action: { kind: 'goto', sceneId: mgrDir.sceneId },
        cta: 'Go say hi',
        priority: 90,
      });
    }
  }
  for (const m of members) {
    if (m.id === me.id || greeted.has(m.id)) continue;
    const d = daysSince(m.startDate, now);
    const dir = online.find((e) => e.memberId === m.id);
    if (d > 14 || !dir) continue;
    out.push({
      id: `newhire:${m.id}`,
      icon: '🌱',
      text:
        d <= 0
          ? `${first(m.displayName)} joined today and is exploring — say hi?`
          : `${first(m.displayName)} joined ${d} day${d === 1 ? '' : 's'} ago. A wave goes a long way.`,
      why: 'New coworkers meet people faster when others say hello first.',
      action: { kind: 'profile', memberId: m.id },
      cta: 'Say hi',
      priority: 80 - d,
    });
  }

  // 3. A lively social room you're not in.
  for (const [sceneId, list] of occupancy) {
    const room = roomById.get(sceneId);
    if (!room || room.quiet || sceneId === mySceneId || list.length < 3) continue;
    if (room.purpose !== 'social' && room.purpose !== 'recreation') continue;
    const names = list.slice(0, 2).map((d) => first(byId.get(d.memberId)?.displayName ?? ''));
    out.push({
      id: `busy:${sceneId}:${Math.min(list.length, 6)}`,
      icon: room.emoji,
      text: `${names.join(', ')} and ${list.length - names.length} others are hanging out in ${room.name}.`,
      why: 'A few people in a social space is the easiest conversation to drop into.',
      action: { kind: 'goto', sceneId },
      cta: 'Join them',
      priority: 60 + list.length,
    });
  }

  // 4. Shared interests with someone open to chat — preferring people outside your team.
  for (const d of online.filter(isOpen)) {
    const m = byId.get(d.memberId);
    if (!m || greeted.has(m.id)) continue;
    const shared = m.interests.find((i) => me.interests.map((x) => x.toLowerCase()).includes(i.toLowerCase()));
    if (!shared) continue;
    const crossTeam = m.departmentId !== me.departmentId;
    out.push({
      id: `interest:${m.id}:${shared}`,
      icon: '✨',
      text: `You and ${first(m.displayName)} both like ${shared}. ${first(m.displayName)} is open to chat.`,
      why: `You both listed “${shared}” on your profiles, and ${first(m.displayName)} set their status to open.`,
      action: { kind: 'knock', memberId: m.id },
      cta: 'Knock',
      priority: crossTeam ? 70 : 55,
    });
  }

  // 5. A teammate who's open to chat.
  for (const d of online.filter(isOpen)) {
    const m = byId.get(d.memberId);
    if (!m || m.teamId !== me.teamId || greeted.has(m.id)) continue;
    out.push({
      id: `teammate:${m.id}`,
      icon: '💬',
      text: `${first(m.displayName)} from your team is open to chat${d.note ? ` — “${d.note}”` : ''}.`,
      why: `${first(m.displayName)} set their status to “Open to chat”.`,
      action: { kind: 'knock', memberId: m.id },
      cta: 'Knock',
      priority: 50,
    });
  }

  const seen = new Set<string>();
  return out
    .filter((s) => !dismissed.has(s.id))
    .sort((a, b) => b.priority - a.priority)
    .filter((s) => {
      const key = s.action.kind === 'goto' ? s.action.sceneId : s.action.memberId;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}
