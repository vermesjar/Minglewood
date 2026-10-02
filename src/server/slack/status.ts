/**
 * Slack status → Minglewood status. Slack statuses are free-form (emoji + text), so we read the common
 * conventions: Do Not Disturb is focus; the calendar integrations' ":spiral_calendar_pad: In a meeting" is a
 * meeting; vacation / out sick / lunch is away; headphones or "focus" is heads-down; ":wave: say hi" is open.
 * Anything else keeps you available with the Slack text as your note. An empty status has no opinion.
 */
import type { PresenceStatus } from '@shared/domain/types';

export interface SlackStatusInput {
  text?: string;
  emoji?: string;
  /** Unix seconds; 0 = doesn't expire. */
  expiration?: number;
  dnd?: boolean;
}

export interface MappedStatus {
  status: PresenceStatus;
  note?: string;
  /** ISO — when the Slack status expires (e.g. the meeting's end). */
  until?: string;
}

const MEETING_EMOJI = new Set([':spiral_calendar_pad:', ':calendar:', ':date:', ':spiral_calendar:', ':telephone_receiver:', ':phone:']);
const AWAY_EMOJI = new Set([':palm_tree:', ':airplane:', ':face_with_thermometer:', ':thermometer:', ':bus:', ':car:', ':knife_fork_plate:', ':hamburger:', ':sandwich:', ':sleeping:', ':baby_bottle:']);
const FOCUS_EMOJI = new Set([':headphones:', ':no_bell:', ':brain:', ':male-technologist:', ':female-technologist:', ':technologist:', ':computer:']);
const OPEN_EMOJI = new Set([':wave:', ':coffee:', ':speech_balloon:']);

const MEETING_TEXT = /\b(in a meeting|meeting|on a call|in a call|interview|1:1|standup|stand-up)\b/i;
const AWAY_TEXT = /\b(vacation|vacationing|ooo|out of (the )?office|out sick|sick|holiday|pto|parental leave|lunch|brb|be right back|commuting|away|afk)\b/i;
const FOCUS_TEXT = /\b(focus|focusing|heads[ -]?down|deep work|do not disturb|dnd|writing)\b/i;
const OPEN_TEXT = /\b(open to chat|say hi|come say hi|ping me|happy to chat)\b/i;

/** A Minglewood status as a Slack status (emoji + text + expiry); `null` means "clear it". The pairs round-trip through mapSlackStatus. */
export function slackStatusFor(status: PresenceStatus, note: string | undefined, until: string | undefined): { status_text: string; status_emoji: string; status_expiration: number } | null {
  const expiration = until ? Math.max(0, Math.floor(Date.parse(until) / 1000)) || 0 : 0;
  const text = (note ?? '').trim().slice(0, 100);
  switch (status) {
    case 'open':
      return { status_emoji: ':wave:', status_text: text || 'Open to chat', status_expiration: expiration };
    case 'focused':
      return { status_emoji: ':headphones:', status_text: text || 'Focused', status_expiration: expiration };
    case 'meeting':
      return { status_emoji: ':spiral_calendar_pad:', status_text: text || 'In a meeting', status_expiration: expiration };
    case 'away':
      return { status_emoji: ':palm_tree:', status_text: text || 'Away', status_expiration: expiration };
    case 'available':
      return text ? { status_emoji: ':speech_balloon:', status_text: text, status_expiration: expiration } : null;
    default:
      return null;
  }
}

export function mapSlackStatus(s: SlackStatusInput): MappedStatus | null {
  const text = (s.text ?? '').trim().slice(0, 80);
  const emoji = (s.emoji ?? '').trim();
  const until = s.expiration && s.expiration > 0 ? new Date(s.expiration * 1000).toISOString() : undefined;
  const note = text || undefined;
  if (s.dnd) return { status: 'focused', note: note ?? 'Do not disturb in Slack', until };
  if (!text && !emoji) return null;
  if (MEETING_EMOJI.has(emoji) || MEETING_TEXT.test(text)) return { status: 'meeting', note, until };
  if (AWAY_EMOJI.has(emoji) || AWAY_TEXT.test(text)) return { status: 'away', note, until };
  if (FOCUS_EMOJI.has(emoji) || FOCUS_TEXT.test(text)) return { status: 'focused', note, until };
  if (OPEN_EMOJI.has(emoji) || OPEN_TEXT.test(text)) return { status: 'open', note, until };
  return { status: 'available', note, until };
}
