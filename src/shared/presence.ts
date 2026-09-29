import type { PresenceStatus } from './domain/types';

export interface StatusMeta {
  label: string;
  short: string;
  color: string;
  emoji: string;
  /** Whether a knock should reach the person right away. */
  interruptible: boolean;
  description: string;
}

export const STATUS_META: Record<PresenceStatus, StatusMeta> = {
  open: {
    label: 'Open to chat',
    short: 'Open',
    color: '#2fbf71',
    emoji: '💬',
    interruptible: true,
    description: 'Come say hi — I’d love the company.',
  },
  available: {
    label: 'Available',
    short: 'Available',
    color: '#5fb0ff',
    emoji: '🙂',
    interruptible: true,
    description: 'Around and reachable.',
  },
  focused: {
    label: 'Focused',
    short: 'Focused',
    color: '#9b6bd6',
    emoji: '🎧',
    interruptible: false,
    description: 'Heads-down. Knocks wait until I’m back.',
  },
  meeting: {
    label: 'In a meeting',
    short: 'Meeting',
    color: '#f2a93b',
    emoji: '📅',
    interruptible: false,
    description: 'Busy for now.',
  },
  away: {
    label: 'Away',
    short: 'Away',
    color: '#b8b2a7',
    emoji: '🌙',
    interruptible: false,
    description: 'Stepped away.',
  },
  offline: {
    label: 'Offline',
    short: 'Offline',
    color: '#8e8a84',
    emoji: '💤',
    interruptible: false,
    description: 'Not around.',
  },
};

export const SETTABLE_STATUSES: PresenceStatus[] = ['open', 'available', 'focused', 'meeting', 'away'];

export const EMOTES = {
  wave: { emoji: '👋', label: 'Wave' },
  clap: { emoji: '👏', label: 'Clap' },
  celebrate: { emoji: '🎉', label: 'Celebrate' },
  heart: { emoji: '💛', label: 'Heart' },
  thumbs: { emoji: '👍', label: 'Thumbs up' },
  laugh: { emoji: '😄', label: 'Laugh' },
  coffee: { emoji: '☕', label: 'Coffee?' },
  idea: { emoji: '💡', label: 'Idea' },
  highfive: { emoji: '🙌', label: 'High five' },
  dance: { emoji: '💃', label: 'Dance' },
  plane: { emoji: '✈️', label: 'Paper plane' },
} as const;
export type EmoteId = keyof typeof EMOTES;
export const EMOTE_IDS = Object.keys(EMOTES) as EmoteId[];
