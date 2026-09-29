/**
 * Every interactive thing in every room, used the way a player does: click it and check it did its thing —
 * machines and counters hand you something you can see and put down, lamps switch, bells ring from where you
 * stand in front of them, boards and artifacts open, NPCs open their card. Then walk at the furniture: you
 * must never end up standing inside it.
 */
import { expect, test, type Obj, type Player } from './helpers';

test.describe.configure({ mode: 'parallel' });

const ROOMS = ['cafe', 'hq', 'eng', 'launch', 'events', 'focus', 'arcade', 'design'] as const;
const OPENS = new Set(['info', 'artifact', 'activity', 'link']);
const label = (o: Obj) => `${o.id} (${o.sprite}${o.variant ? '.' + o.variant : ''})`;

async function useEverything(player: Player, roomId: string) {
  const page = player.page;
  const scene = await player.roomScene(roomId);
  expect(scene.id).toBe(roomId);
  const objs = scene.objects.filter(
    (o) =>
      o.actions?.some((a) => ['vend', 'toggle', 'ring', 'use', ...OPENS].includes(a.kind)) &&
      !o.actions?.some((a) => a.kind === 'sit'),
  );
  for (const o of objs)
    await player.step(roomId, `using ${o.id}`, async () => {
      await player.reset();
      await page.keyboard.press('Escape');
      const kinds = new Set(o.actions!.map((a) => a.kind));
      const p = await player.objectPoint(o.id);
      if (!p) {
        player.note({
          area: 'objects (INTERACTIONS agent)',
          what: `${label(o)} in ${roomId}: nothing on screen to click (hidden behind something?)`,
          shot: await player.full(`unclickable-${roomId}-${o.id}`),
        });
        return;
      }
      const before = {
        on: await player.isOn(o.id),
        dialogs: await page.locator('[role=dialog]').count(),
      };
      await player.click(p);
      const tag = `${roomId}-${o.id}`;
      if (kinds.has('vend')) {
        const item = o.actions!.find((a) => a.kind === 'vend')!.item!;
        const r = await player.until((m) => m.carrying === item, 30_000);
        const shot = await player.shot(`carry-${tag}`, undefined, 240);
        if (!r.ok) {
          player.note({
            area: 'objects (INTERACTIONS agent)',
            what: `using ${label(o)} in ${roomId} never handed me ${item}`,
            shot,
            detail: r.me,
          });
          return;
        }
        const putDown = page.getByRole('button', { name: /put (it )?down/i }).first();
        if (!(await putDown.isVisible().catch(() => false)))
          player.note({
            area: 'HUD (main session)',
            what: `carrying ${item} but no Put down button in the action bar`,
            shot: await player.full(`noputdown-${tag}`),
          });
        else {
          await putDown.click();
          const d = await player.until((m) => !m.carrying, 6000);
          if (!d.ok)
            player.note({
              area: 'objects (INTERACTIONS agent)',
              what: `Put down didn't put the ${item} down`,
              shot,
            });
        }
      } else if (kinds.has('toggle')) {
        await page.waitForTimeout(2500);
        const after = await player.isOn(o.id);
        if (after === before.on)
          player.note({
            area: 'objects (INTERACTIONS agent)',
            what: `clicking ${label(o)} in ${roomId} didn't switch it`,
            shot: await player.shot(`toggle-${tag}`, p),
          });
        else {
          await player.click((await player.objectPoint(o.id)) ?? p);
          await page.waitForTimeout(1500);
          if ((await player.isOn(o.id)) !== before.on)
            player.note({
              area: 'objects (INTERACTIONS agent)',
              what: `${label(o)} in ${roomId} doesn't switch back`,
              shot: await player.shot(`toggle-back-${tag}`, p),
            });
        }
      } else if (kinds.has('ring') || kinds.has('use')) {
        const m = await player.still(15_000);
        const f = { x0: o.x, y0: o.y, x1: o.x + (o.w ?? 1), y1: o.y + (o.d ?? 1) };
        const dx = Math.max(f.x0 - m.tile[0], 0, m.tile[0] - (f.x1 - 1));
        const dy = Math.max(f.y0 - m.tile[1], 0, m.tile[1] - (f.y1 - 1));
        if (dx + dy === 0 || Math.hypot(dx, dy) > 1.6)
          player.note({
            area: 'objects (INTERACTIONS agent)',
            what: `using ${label(o)} in ${roomId}: I ended up ${dx + dy ? `${dx + dy} tiles away` : 'standing inside it'} instead of beside it`,
            shot: await player.shot(`use-${tag}`),
            detail: { me: m.tile },
          });
      } else {
        const opened = await page
          .waitForFunction(
            (n) => document.querySelectorAll('[role=dialog]').length > n,
            before.dialogs,
            { timeout: 8000 },
          )
          .then(() => true)
          .catch(() => false);
        if (!opened)
          player.note({
            area: 'objects (INTERACTIONS agent)',
            what: `clicking ${label(o)} in ${roomId} opened nothing`,
            shot: await player.full(`noopen-${tag}`),
          });
        await page.keyboard.press('Escape');
      }
    });
  // NPCs: clicking one opens their NPC card
  for (const npc of scene.npcs ?? [])
    await player.step(roomId, `clicking ${npc.name}`, async () => {
      await page.keyboard.press('Escape');
      const p = await player.actorPoint(`npc:${npc.id}`);
      if (!p) {
        player.note({
          area: 'NPCs (INTERACTIONS agent)',
          what: `${npc.name} (${roomId}) isn't clickable on screen`,
          shot: await player.full(`npc-hidden-${roomId}-${npc.id}`),
        });
        return;
      }
      await player.click(p);
      const card = page.locator(`[role=dialog][aria-label*="(NPC)"]`);
      if (!(await card.isVisible({ timeout: 5000 }).catch(() => false)))
        player.note({
          area: 'NPCs (INTERACTIONS agent)',
          what: `clicking ${npc.name} in ${roomId} didn't open an NPC card`,
          shot: await player.full(`npc-nocard-${roomId}-${npc.id}`),
        });
      else
        await player.shot(
          `npc-card-${roomId}-${npc.id}`,
          (await card
            .boundingBox()
            .then((b) => b && { x: b.x + b.width / 2, y: b.y + b.height / 2 })) ?? undefined,
          420,
        );
      await page.keyboard.press('Escape');
    });
  // walking at furniture never leaves you standing inside it
  const solid = scene.objects.filter(
    (o) => !o.wall && !o.flat && !o.actions?.some((a) => a.kind === 'sit') && o.sprite !== 'rug',
  );
  for (const o of solid)
    await player.step(roomId, `walking at ${o.id}`, async () => {
      await player.reset();
      const t = await player.floorPoint(o.x + 0.5, o.y + 0.5);
      await page.mouse.click(t.x, t.y);
      await page.keyboard.press('Escape');
      let m = await player.still(12_000);
      // (clicking there may have picked a seat drawn in front: then the sit lands when the server confirms it)
      if (!(await player.walkable(m.tile[0], m.tile[1])) && !m.sittingOn)
        m = (await player.until((x) => !!x.sittingOn, 4000)).me;
      if (!(await player.walkable(m.tile[0], m.tile[1])) && !m.sittingOn)
        player.note({
          area: 'blocking (ROTATION/INTERACTIONS agents)',
          what: `walking at ${label(o)} in ${roomId} left me standing inside furniture at ${m.tile}`,
          shot: await player.shot(`inside-${roomId}-${o.id}`),
          detail: { me: m },
        });
    });
  return { things: objs.length, npcs: scene.npcs?.length ?? 0, solid: solid.length };
}

for (const roomId of ROOMS) {
  test(`use everything: ${roomId}`, async ({ player }, info) => {
    test.setTimeout(900_000);
    const n = await useEverything(player, roomId);
    info.annotations.push({ type: 'coverage', description: JSON.stringify(n) });
    console.log(
      `[use] ${roomId}: ${JSON.stringify(n)} · ${player.findings.length} finding(s) · redone ${player.redone}`,
    );
    expect.soft(player.findings, player.findings.map((f) => f.what).join('\n')).toEqual([]);
  });
}
