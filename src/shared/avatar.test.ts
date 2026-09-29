import { describe, expect, it } from 'vitest';
import {
  AVATAR_ITEMS,
  DEFAULT_LOADOUT,
  ITEM_BY_ID,
  VIBES,
  applyVibe,
  hasUnlock,
  normalizeLoadout,
  randomLoadout,
  sanitizeLoadout,
} from './avatar';
import { buildSeed } from './seed/northstar';

describe('avatar catalog', () => {
  it('has unique item ids and a rich set of options', () => {
    const ids = AVATAR_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(AVATAR_ITEMS.filter((i) => i.slot === 'hair').length).toBeGreaterThanOrEqual(20);
  });

  it('migrates looks saved with the old single accessory slot', () => {
    const old = { ...DEFAULT_LOADOUT, accessory: 'acc.glasses' };
    for (const k of ['eyewear', 'headwear', 'neck'] as const) delete (old as Partial<typeof old>)[k];
    const n = normalizeLoadout(old);
    expect(n.eyewear).toBe('eye.round');
    expect(n.accessory).toBe('acc.none');
  });

  it('allows any hex color but rejects unknown or locked items', () => {
    const l = sanitizeLoadout({ ...DEFAULT_LOADOUT, topColor: '#123abc', hair: 'hair.nope', headwear: 'hat.party' }, []);
    expect(l.topColor).toBe('#123abc');
    expect(l.hair).toBe(DEFAULT_LOADOUT.hair);
    expect(l.headwear).toBe('hat.none');
    expect(sanitizeLoadout({ ...DEFAULT_LOADOUT, headwear: 'hat.party' }, ['acc.party-hat']).headwear).toBe('hat.party');
    expect(hasUnlock(['acc.party-hat'], 'hat.party')).toBe(true);
  });

  it('vibes change the outfit but keep who you are', () => {
    const me = { ...DEFAULT_LOADOUT, hair: 'hair.afro', skin: '#643721', facialHair: 'fh.beard' };
    for (const v of VIBES) {
      const l = applyVibe(me, v, []);
      expect(l.hair).toBe('hair.afro');
      expect(l.skin).toBe('#643721');
      expect(l.facialHair).toBe('fh.beard');
    }
  });

  it('random looks are always valid catalog items', () => {
    for (let i = 0; i < 200; i++) {
      const l = randomLoadout(`seed-${i}`);
      for (const [k, v] of Object.entries(l)) {
        if (typeof v === 'string' && v.includes('.') && !v.startsWith('#')) expect(ITEM_BY_ID.has(v), `${k}=${v}`).toBe(true);
      }
      expect(sanitizeLoadout(l, [])).toEqual(l);
    }
  });

  it('every seeded coworker has a valid look', () => {
    for (const m of buildSeed().members) {
      const clean = sanitizeLoadout(m.avatar, m.unlockedItems);
      expect(clean, m.id).toEqual(normalizeLoadout(m.avatar));
    }
  });
});
