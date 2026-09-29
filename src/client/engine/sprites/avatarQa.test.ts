import { describe, expect, it } from 'vitest';
import type { AvatarLoadout } from '@shared/domain/types';
import { randomLoadout } from '@shared/avatar';
import { buildSeed } from '@shared/seed/northstar';
import { LAYER } from './avatarKit';
import { frameFor } from './avatarFrame';
import { W } from './pixkit';
import { FACINGS, POSES, lintAvatar, renderAvatarLayers, zonesFor } from './avatarQa';

const looks = [
  ...buildSeed().members.map((m) => ({ name: m.displayName, look: m.avatar })),
  ...Array.from({ length: 40 }, (_, k) => ({ name: `random ${k}`, look: randomLoadout(`qa-${k}`) })),
];

describe('character standard', () => {
  it('every roster and random look passes in every facing and pose', () => {
    const failures: string[] = [];
    for (const { name, look } of looks)
      for (const f of FACINGS)
        for (const p of POSES) for (const is of lintAvatar(look, f, p)) failures.push(`${name} ${f} ${p}: ${is.kind} (${is.detail})`);
    expect(failures).toEqual([]);
  }, 120_000);

  // The checks must actually catch what they're for: corrupt a clean frame and expect each rule to fire.
  const look = { hair: 'hair.short', top: 'top.tee', shoes: 'shoes.sneakers' } as AvatarLoadout;
  const zones = (view: 'front' | 'back') => zonesFor(frameFor(view, 'stand'));
  const corrupt = (facing: 'se' | 'ne', zone: 'scalp' | 'chest' | 'waist' | 'feet' | 'features', owner: number, clear = false) => {
    const r = renderAvatarLayers(look, facing, 'stand');
    const m = zones(facing === 'se' ? 'front' : 'back')[zone];
    for (let i = 0; i < r.owner.length; i++)
      if (m.has(i % W, Math.floor(i / W))) {
        r.owner[i] = owner;
        if (clear) r.px[i * 4 + 3] = 0;
      }
    return lintAvatar(look, facing, 'stand', r).map((i) => i.kind);
  };

  it('flags an uncovered scalp', () => expect(corrupt('ne', 'scalp', LAYER.head)).toContain('bald'));
  it('flags hair over the eyes', () => expect(corrupt('se', 'features', LAYER.hair)).toContain('face-covered'));
  it('flags a hole in the chest', () => expect(corrupt('se', 'chest', LAYER.none, true)).toContain('torso-gap'));
  it('flags a see-through waist', () => expect(corrupt('se', 'waist', LAYER.none, true)).toContain('waist-gap'));
  it('flags bare feet', () => expect(corrupt('se', 'feet', LAYER.legs)).toContain('bare-feet'));
});
