/**
 * The spaces a company's channels map to, and how a space recognises a channel as its own by name.
 * Shared by the Discord and Slack one-click setups: the town is the company's "general", each room
 * that talks gets a channel named after it, and quiet rooms are quiet on purpose (no channels).
 */
import type { Room } from '@shared/domain/types';
import { TOWN_ID } from '@shared/world';

export interface Space {
  id: string;
  name: string;
}

export const slug = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** The town and every room that talks (quiet rooms are quiet on purpose: no channels). */
export function spacesOf(rooms: Pick<Room, 'id' | 'name' | 'quiet'>[]): Space[] {
  return [{ id: TOWN_ID, name: 'Town' }, ...rooms.filter((r) => !r.quiet).map((r) => ({ id: r.id, name: r.name }))];
}

/** What a space's channels are called when we create them, and the names we'd recognise as its own. */
export function namesFor(space: Space): { text: string; voice: string; aliases: string[] } {
  if (space.id === TOWN_ID) return { text: 'general', voice: 'General', aliases: ['general', 'town', 'town-square', 'lobby', 'hangout'] };
  const main = slug(space.name);
  const words = main.split('-').filter((w) => w.length >= 4 && !['room', 'studio', 'hall', 'lab', 'labs'].includes(w));
  return { text: main, voice: space.name, aliases: [...new Set([main, slug(space.id), ...words])] };
}

/** How well a channel name fits a space: 3 exact, 2 a known alias, 1 a word in common, 0 no. */
export function scoreChannelName(space: Space, channelName: string): number {
  const n = slug(channelName);
  if (!n) return 0;
  const names = namesFor(space);
  if (n === names.aliases[0]) return 3;
  if (names.aliases.includes(n)) return 2;
  if (names.aliases.some((a) => a.length >= 4 && (n.includes(a) || a.includes(n)) && n.length >= 3)) return 1;
  return 0;
}
