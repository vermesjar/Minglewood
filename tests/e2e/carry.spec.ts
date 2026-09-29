/**
 * "It's not clear I actually got a coffee": what you carry has to show, from every side. For each thing you
 * can be handed, each facing and each pose you can be in while holding it, draw the figure (the game's own
 * avatar renderer, on the people in the room) with and without it and count the pixels the item adds.
 * A contact sheet of every combination lands in art/review/playtest/carry-sheet.png.
 */
import { writeFileSync } from 'node:fs';
import { expect, SHOTS, test } from './helpers';

const ROOT = process.cwd().replace(/\\/g, '/');
const ITEMS = ['coffee', 'boba', 'soda', 'popcorn', 'icecream', 'plush', 'book'];
const FACINGS = ['se', 'sw', 'ne', 'nw'];
const POSES = ['stand', 'walk1', 'walk2', 'sit'];
/** Fewer added pixels than this (at the game's 1:1 art scale) and you can't tell it's there. */
const VISIBLE = 12;

test('what you carry shows from every side', async ({ player }) => {
  await player.enter('cafe');
  const out = await player.ev(
    async ([root, items, facings, poses]) => {
      const { avatarSprite } = await import(`/@fs/${root}/src/client/engine/sprites/avatar.ts`);
      const w = (window as any).__mw.world as any;
      const looks: Array<{ who: string; L: any }> = [];
      for (const [id, a] of w.actors as Map<string, any>)
        if (!id.startsWith('npc:') && looks.length < 4) looks.push({ who: id, L: a.occ.avatar });
      const px = (s: any) => {
        const c = s.canvas as HTMLCanvasElement;
        return {
          d: c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data,
          w: c.width,
          h: c.height,
        };
      };
      const rows: Array<{
        who: string;
        item: string;
        facing: string;
        pose: string;
        added: number;
      }> = [];
      // contact sheet: one row per item × pose, one column per facing × person
      const probe = avatarSprite(looks[0].L, 'se', 'stand');
      const cw = probe.canvas.width + 8;
      const ch = probe.canvas.height + 14;
      const sheet = document.createElement('canvas');
      sheet.width = facings.length * looks.length * cw;
      sheet.height = items.length * poses.length * ch;
      const g = sheet.getContext('2d')!;
      g.fillStyle = '#e9dfd0';
      g.fillRect(0, 0, sheet.width, sheet.height);
      items.forEach((item, ii) =>
        poses.forEach((pose, pi) =>
          looks.forEach((look, li) =>
            facings.forEach((facing, fi) => {
              const bare = px(avatarSprite({ ...look.L, held: 'held.none' }, facing, pose));
              const held = avatarSprite(
                { ...look.L, held: `held.${item}`, heldColor: look.L.heldColor ?? '#e0503f' },
                facing,
                pose,
              );
              const h = px(held);
              let added = 0;
              for (let i = 0; i < h.d.length; i += 4)
                if (
                  h.d[i] !== bare.d[i] ||
                  h.d[i + 1] !== bare.d[i + 1] ||
                  h.d[i + 2] !== bare.d[i + 2] ||
                  h.d[i + 3] !== bare.d[i + 3]
                )
                  added++;
              const k = held.scale ?? 1;
              // (in art pixels: the sprite is drawn at k× density)
              added = Math.round(added / (k * k));
              rows.push({ who: look.who, item, facing, pose, added });
              const x = (li * facings.length + fi) * cw;
              const y = (ii * poses.length + pi) * ch;
              g.drawImage(held.canvas, x + 4, y + 2);
              g.fillStyle = added < 12 ? '#d0342c' : '#4a4038';
              g.font = '9px monospace';
              g.fillText(`${item} ${pose} ${facing} ${added}`, x + 2, y + ch - 3);
            }),
          ),
        ),
      );
      return { rows, sheet: sheet.toDataURL('image/png') };
    },
    [ROOT, ITEMS, FACINGS, POSES] as const,
  );
  writeFileSync(`${SHOTS}/carry-sheet.png`, Buffer.from(out.sheet.split(',')[1], 'base64'));
  // per item, facing and pose: the worst case over the people drawn
  const worst = new Map<string, number>();
  for (const r of out.rows) {
    const key = `${r.item} ${r.pose} ${r.facing}`;
    worst.set(key, Math.min(worst.get(key) ?? Infinity, r.added));
  }
  const hidden = [...worst].filter(([, n]) => n < VISIBLE).map(([k, n]) => `${k}: ${n}px`);
  console.log(
    `[carry] ${worst.size} item × pose × facing combinations; hidden in ${hidden.length}`,
  );
  if (hidden.length)
    player.note({
      area: 'characters (CHARACTER LIFE agent)',
      what: `carried items can't be seen (fewer than ${VISIBLE} px of the item show) in: ${hidden.join(', ')}`,
      shot: `${SHOTS}/carry-sheet.png`,
    });
  expect.soft(hidden, 'item × pose × facing where what you carry is hidden').toEqual([]);
});
