import { describe, expect, it } from 'vitest';
import { suggest } from './serendipity';
import { buildSeed, ROOMS } from './seed/northstar';
import type { DirectoryEntry } from './protocol';
import { MockCalendarProvider, presenceFromCalendar } from './calendar';

const now = Date.parse('2026-09-28T15:00:00Z');
const seed = buildSeed(new Date(now));
const me = { ...seed.members.find((m) => m.id === 'm-arjun')!, interests: ['climbing'] };

function dir(entries: Array<Partial<DirectoryEntry> & { memberId: string }>): DirectoryEntry[] {
  return entries.map((e) => ({ status: 'available', online: true, ...e }));
}

describe('serendipity', () => {
  it('suggests joining a lively social room with an explanation', () => {
    const d = dir([
      { memberId: 'm-maya', sceneId: 'cafe' },
      { memberId: 'm-chris', sceneId: 'cafe' },
      { memberId: 'm-sofia', sceneId: 'cafe' },
    ]);
    const s = suggest({ me, members: seed.members, directory: d, events: [], rooms: ROOMS, now, dismissed: new Set(), greeted: new Set() });
    const busy = s.find((x) => x.id.startsWith('busy:cafe'));
    expect(busy).toBeDefined();
    expect(busy!.why.length).toBeGreaterThan(10);
  });

  it('uses only interests people chose to share, and respects dismissals', () => {
    const d = dir([{ memberId: 'm-maya', status: 'open', sceneId: 'cafe' }]);
    const s = suggest({ me, members: seed.members, directory: d, events: [], rooms: ROOMS, now, dismissed: new Set(), greeted: new Set() });
    const hit = s.find((x) => x.id.startsWith('interest:m-maya'));
    expect(hit?.text).toContain('climbing');
    const s2 = suggest({ me, members: seed.members, directory: d, events: [], rooms: ROOMS, now, dismissed: new Set([hit!.id]), greeted: new Set() });
    expect(s2.find((x) => x.id === hit!.id)).toBeUndefined();
  });

  it('never suggests quiet rooms as hangouts', () => {
    const d = dir(['m-ben', 'm-lena', 'm-sam'].map((memberId) => ({ memberId, sceneId: 'focus', status: 'focused' as const })));
    const s = suggest({ me, members: seed.members, directory: d, events: [], rooms: ROOMS, now, dismissed: new Set(), greeted: new Set() });
    expect(s.some((x) => x.id.includes('focus'))).toBe(false);
  });

  it('highlights active celebrations first', () => {
    const s = suggest({ me, members: seed.members, directory: [], events: seed.events, rooms: ROOMS, now: now + 60_000, dismissed: new Set(), greeted: new Set() });
    expect(s[0]?.id).toBe('event:ev-jonah-bday');
  });
});

describe('calendar presence', () => {
  it('derives a meeting status from a busy block and clears it after', () => {
    const cal = new MockCalendarProvider([{ memberIds: ['m-noor'], title: 'Product review', offsetMin: 0, durationMin: 30 }], now);
    const during = presenceFromCalendar(cal.blocksFor('m-noor', now, now + 1), now + 5 * 60_000);
    expect(during?.status).toBe('meeting');
    expect(during?.note).toBe('Product review');
    const after = presenceFromCalendar(cal.blocksFor('m-noor', now + 40 * 60_000, now + 41 * 60_000), now + 40 * 60_000);
    expect(after).toBeNull();
  });
});
