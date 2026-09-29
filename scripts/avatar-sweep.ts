/**
 * Pairwise sweep: every value of one slot against every value of each slot it can collide with, in every
 * facing and the stand / walk / sit / wave poses, checked against the character standard. Random looks can
 * miss rare pairings (a hijab over a beard, goggles under a beanie); this can't.
 *
 *   npx tsx scripts/avatar-sweep.ts
 *
 * Writes art/review/sweep.md (failures grouped by pair) and exits non-zero on any failure.
 */
import { writeFileSync } from 'node:fs';
import { AVATAR_ITEMS, type FullLoadout } from '@shared/avatar';
import type { AvatarLoadout } from '@shared/domain/types';
import { FACINGS, lintAvatar } from '../src/client/engine/sprites/avatarQa';
import type { Pose } from '../src/client/engine/sprites/avatarFrame';

const ids = (slot: string) => AVATAR_ITEMS.filter((i) => i.slot === slot).map((i) => i.id);
const base: AvatarLoadout = {
  skin: '#d99e74',
  hair: 'hair.short',
  hairColor: '#5a3825',
  top: 'top.tee',
  topColor: '#3f8fd8',
  bottom: 'bottom.jeans',
  bottomColor: '#1f2a44',
  shoes: 'shoes.sneakers',
  shoesColor: '#f4efe6',
};
const PAIRS: Array<[keyof FullLoadout, string, keyof FullLoadout, string]> = [
  ['hair', 'hair', 'headwear', 'headwear'],
  ['headwear', 'headwear', 'eyewear', 'eyewear'],
  ['hair', 'hair', 'eyewear', 'eyewear'],
  ['facialHair', 'facialHair', 'headwear', 'headwear'],
  ['top', 'top', 'neck', 'neck'],
  ['top', 'top', 'bottom', 'bottom'],
  ['hair', 'hair', 'held', 'held'],
  ['held', 'held', 'mobility', 'mobility'],
  ['top', 'top', 'mobility', 'mobility'],
  ['hair', 'hair', 'top', 'top'],
  ['top', 'top', 'body', 'body'],
  ['bottom', 'bottom', 'body', 'body'],
  ['hair', 'hair', 'body', 'body'],
  ['neck', 'neck', 'body', 'body'],
];
const POSES: Pose[] = ['stand', 'walk1', 'sit', 'wave'];
const lines: string[] = ['# Pairwise sweep', ''];
let frames = 0;
let fails = 0;
for (const [fa, sa, fb, sb] of PAIRS) {
  const bad: string[] = [];
  for (const a of ids(sa))
    for (const b of ids(sb)) {
      const look = { ...base, [fa]: a, [fb]: b } as AvatarLoadout;
      for (const f of FACINGS)
        for (const p of POSES) {
          frames++;
          const issues = lintAvatar(look, f, p);
          if (issues.length) bad.push(`- ${a} + ${b} ${f} ${p}: ${issues.map((i) => `${i.kind} (${i.detail})`).join('; ')}`);
        }
    }
  fails += bad.length;
  lines.push(`## ${sa} × ${sb} — ${bad.length ? `${bad.length} failing frame(s)` : 'clean'}`, ...bad.slice(0, 60), '');
}
lines.splice(1, 0, `${frames} frames, ${fails} failing.`, '');
writeFileSync('art/review/sweep.md', lines.join('\n'));
console.log(`${frames} frames, ${fails} failing → art/review/sweep.md`);
process.exit(fails ? 1 : 0);
