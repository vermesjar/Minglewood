/**
 * Calendar-derived presence. Providers (Google, Outlook…) implement `CalendarProvider`;
 * presence logic only sees busy blocks — never titles unless the member opts in.
 */
import type { PresenceState } from './domain/types';

export interface CalendarBlock {
  memberId: string;
  title: string;
  start: number; // epoch ms
  end: number;
  /** Whether the title may be shown to coworkers (default: show "In a meeting" only). */
  shareTitle: boolean;
}

export interface CalendarProvider {
  readonly id: string;
  blocksFor(memberId: string, from: number, to: number): CalendarBlock[];
}

export function presenceFromCalendar(
  blocks: CalendarBlock[],
  now: number,
): Pick<PresenceState, 'status' | 'note' | 'until' | 'source'> | null {
  const active = blocks.find((b) => b.start <= now && now < b.end);
  if (!active) return null;
  return {
    status: 'meeting',
    note: active.shareTitle ? active.title : undefined,
    until: new Date(active.end).toISOString(),
    source: 'calendar',
  };
}

/** A deterministic demo calendar. Blocks recur daily relative to the time the server booted. */
export class MockCalendarProvider implements CalendarProvider {
  readonly id = 'mock';
  constructor(
    private readonly entries: Array<{ memberIds: string[]; title: string; offsetMin: number; durationMin: number }>,
    private readonly epoch: number,
  ) {}

  blocksFor(memberId: string, from: number, to: number): CalendarBlock[] {
    const out: CalendarBlock[] = [];
    const day = 24 * 3600_000;
    for (const e of this.entries) {
      if (!e.memberIds.includes(memberId)) continue;
      const base = this.epoch + e.offsetMin * 60_000;
      const k0 = Math.floor((from - base) / day);
      for (let k = k0; k <= k0 + 1; k++) {
        const start = base + k * day;
        const end = start + e.durationMin * 60_000;
        if (end > from && start < to) out.push({ memberId, title: e.title, start, end, shareTitle: true });
      }
    }
    return out;
  }
}
