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
  /** Legacy alias of Available (older clients and Slack's 👋 still send it); the hub folds it into Available. */
  open: {
    label: 'Available',
    short: 'Available',
    color: '#2fbf71',
    emoji: '🙂',
    interruptible: true,
    description: 'Around — come say hi.',
  },
  available: {
    label: 'Available',
    short: 'Available',
    color: '#2fbf71',
    emoji: '🙂',
    interruptible: true,
    description: 'Around — come say hi.',
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

export const SETTABLE_STATUSES: PresenceStatus[] = ['available', 'focused', 'meeting', 'away'];

export const EMOTES = {
  wave: { emoji: '👋', label: 'Wave' },
  clap: { emoji: '👏', label: 'Clap' },
  celebrate: { emoji: '🎉', label: 'Celebrate' },
  heart: { emoji: '💛', label: 'Heart' },
  thumbs: { emoji: '👍', label: 'Thumbs up' },
  laugh: { emoji: '😄', label: 'Laugh' },
  coffee: { emoji: '☕', label: 'Coffee?' },
  idea: { emoji: '💡', label: 'Idea' },
  dance: { emoji: '💃', label: 'Dance' },
} as const;
export type EmoteId = keyof typeof EMOTES;
export const EMOTE_IDS = Object.keys(EMOTES) as EmoteId[];
