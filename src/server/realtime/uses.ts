/**
 * What happens when someone uses a thing (see src/shared/world/uses.ts): the server decides the outcome — the
 * song, the score, where the globe lands, whether the claw grabs anything — so everyone in the room sees the
 * same moment. Kept small and pure; the hub validates, rate-limits and broadcasts.
 */
import type { UseKind } from '@shared/world/scene';
import { NOTE_MAX_CHARS } from '@shared/protocol';

/** How long a thing takes before it can be used again (ms): a claw needs its full drop, a plant a moment. */
export const USE_COOLDOWN_MS: Record<UseKind, number> = {
  song: 4000,
  arcade: 3000,
  pool: 8000,
  hockey: 4000,
  claw: 3500,
  piano: 2500,
  feed: 5000,
  spin: 3000,
  water: 3000,
  wish: 2500,
  chime: 5000,
  reboot: 5000,
  rocket: 4000,
  toast: 6000,
};

/** One person can't use things faster than this (a double click, a spammed jukebox). */
export const USE_PERSON_GAP_MS = 1200;

/** One note per person on the boards this often. */
export const NOTE_GAP_MS = 20_000;

/**
 * A note as it goes on the board: one line, no control or direction-changing characters, no markup
 * brackets, trimmed to NOTE_MAX_CHARS. Empty if nothing's left.
 */
export function cleanNote(text: string): string {
  const one = [...text]
    .map((ch) => {
      const c = ch.codePointAt(0) ?? 0;
      const unseen = c < 0x20 || (c >= 0x7f && c <= 0x9f) || (c >= 0x200b && c <= 0x200f) || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069);
      return unseen ? ' ' : ch === '<' || ch === '>' ? '' : ch;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return [...one].slice(0, NOTE_MAX_CHARS).join('').trim();
}

/** The claw's drop, before you learn whether it grabbed anything. */
export const CLAW_DROP_MS = 1900;
/** Roughly one in four. */
export const CLAW_WIN_CHANCE = 0.25;

/** Made-up tracks for the arcade jukebox (no real songs). */
export const SONGS = [
  'Neon Harbor',
  'Pixel Pier Boogie',
  'Lakeside Lo-Fi',
  'Midnight Standup',
  'Ship It (Extended Mix)',
  'Coffee Break Bossa',
  'Merge Conflict Blues',
  'Lantern Hall Waltz',
  'Northstar Nights',
  'Retro Rainfall',
];

export const CITIES = [
  'Lisbon',
  'Kyoto',
  'Nairobi',
  'Reykjavík',
  'Buenos Aires',
  'Toronto',
  'Seoul',
  'Cape Town',
  'Oaxaca',
  'Tallinn',
  'Hobart',
  'Marrakesh',
  'Vancouver',
  'Hanoi',
];

const POOL_SUNK = ['🎱 Nothing dropped — tough table', '🎱 One down on the break', '🎱 Two down on the break', '🎱 Three down — clean break!'];
const HOCKEY_LINES: Record<string, string> = { goal: '🏒 Goal!', bank: '🏒 Off the wall and in!', blocked: '🏒 Blocked!' };

export interface UseOutcome {
  /** Shown by the moment (the score, the song, the city). */
  detail?: string;
  /** Said by the person who used it, for the room. */
  line?: string;
  /** The claw: whether it grabbed a prize (decided now, revealed after the drop). */
  win?: boolean;
}

export interface UseContext {
  rand: () => number;
  /** The company's name, for a toast. */
  org?: string;
  /** The best score on this cabinet so far, if any. */
  best?: { score: number; name: string };
}

const pick = <T>(xs: readonly T[], rand: () => number) => xs[Math.floor(rand() * xs.length) % xs.length];

export function outcomeOf(kind: UseKind, ctx: UseContext): UseOutcome {
  const { rand } = ctx;
  switch (kind) {
    case 'song': {
      const song = pick(SONGS, rand);
      return { detail: song, line: `🎵 Put on “${song}”` };
    }
    case 'arcade': {
      const score = Math.round((800 + rand() * rand() * 24000) / 10) * 10;
      const fmt = score.toLocaleString('en-US');
      const record = !ctx.best || score > ctx.best.score;
      return { detail: fmt, line: record ? `🏆 New high score: ${fmt}!` : `🕹️ Scored ${fmt} (best ${ctx.best!.score.toLocaleString('en-US')}, ${ctx.best!.name})` };
    }
    case 'pool': {
      // the table plays out what's decided here: how many drop, and whether the cue ball follows one in
      const r = rand();
      const sunk = r < 0.25 ? 0 : r < 0.6 ? 1 : r < 0.85 ? 2 : 3;
      const scratch = rand() < 0.15;
      return { detail: `${sunk}${scratch ? 's' : ''}`, line: scratch ? '🎱 Scratched… classic' : POOL_SUNK[sunk] };
    }
    case 'hockey': {
      const how = pick(['goal', 'goal', 'bank', 'blocked'], rand);
      return { detail: how, line: HOCKEY_LINES[how] };
    }
    case 'claw': {
      // the room sees a prize come up in the claw (or not) before the person's told
      const win = rand() < CLAW_WIN_CHANCE;
      return { win, detail: win ? 'win' : 'miss' };
    }
    case 'spin': {
      const city = pick(CITIES, rand);
      return { detail: city, line: `🌍 Spun the globe — ${city}!` };
    }
    case 'wish':
      return { line: '🪙 Made a wish' };
    case 'reboot':
      return { line: '🖥️ Turned it off and on again' };
    case 'toast': {
      const toasts = ['🥂 To the team!', '🥂 Cheers, everyone!', '🥂 To shipping it — carefully!', '🥂 To the next one!', ...(ctx.org ? [`🥂 To ${ctx.org}!`] : [])];
      return { line: pick(toasts, rand) };
    }
    default:
      // piano, feed, water, chime, rocket: the moment says it all
      return {};
  }
}
