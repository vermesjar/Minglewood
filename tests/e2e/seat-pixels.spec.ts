/** Evidence capture, NOT a visual approval. Captures the actual game's masked sprite and its inputs. */
import { test, expect, SHOTS } from './helpers';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const look = JSON.parse(readFileSync('tests/fixtures/seating-cardigan.json','utf8'));

const root = process.cwd().replace(/\\/g, '/');
const out = `${SHOTS}/pixels`;
mkdirSync(out, { recursive: true });

const rooms = (process.env.SEAT_PIXEL_ROOMS ?? 'cafe,seatlab-bench,seatlab-bench-garden.teal,seatlab-couch.green,seatlab-armchair.mustard,seatlab-chair-bistro.sage,seatlab-chair.office').split(',');
for (const room of rooms) test(`pixel evidence ${room}`, async ({ player: p }) => {
  test.setTimeout(240_000);
  const scene = await p.roomScene(room);
  await p.ev(l => (window as any).__mw.rt.send({t:'avatar',loadout:l}),look);
  await p.page.waitForFunction(() => {const g=(window as any).__mw;return g.world.actors.get(g.meId).occ.avatar.top==='top.cardigan';});
  const records = [];
  const seats = scene.objects.filter(o => o.actions?.some(a => a.kind === 'sit'));
  expect(seats.length).toBeGreaterThan(0);
  for (const seat of seats) for (const spot of await p.seatSpots(seat.id)) {
    const occupant = await p.ev(({id,x,y}) => {const g=(window as any).__mw;
      const a=[...g.world.actors.values()].find((a:any)=>a.occ.memberId!==g.meId&&a.occ.sittingOn===id&&a.occ.x===x&&a.occ.y===y) as any;
      return a?.occ.memberId as string|undefined; },{id:seat.id,x:spot.x,y:spot.y});
    if (!occupant) {
    await p.reset();
    await p.settle();
    await p.ev(id => { const w=(window as any).__mw.world,st=w.statics.find((s:any)=>s.obj.id===id);
      w.camera.jump(st.dx+st.sprite.canvas.width/4,st.dy+st.sprite.canvas.height/4-16,2); },seat.id);
    await p.page.waitForTimeout(100);
    const point = await p.objectPoint(seat.id, { x: spot.x, y: spot.y, z: 10 });
    expect(point).toBeTruthy();
    await p.click(point!);
    const arrived = await p.until(m => m.sittingOn === seat.id && m.server?.x === spot.x && m.server?.y === spot.y && !m.moving, 20_000);
    expect(arrived.ok, JSON.stringify({seat:seat.id,spot,me:arrived.me})).toBe(true);
    await p.page.mouse.move(4,4);
    await p.page.waitForTimeout(700);
    }
    const record = await p.ev(async ({ id, root, occupant }) => {
      const g = (window as any).__mw, w = g.world, a = w.actors.get(occupant || g.meId);
      const st = w.statics.find((s: any) => s.obj.id === id);
      const mv = w.modelOf(st.obj, a.onSeat.facing);
      const { seatDepth } = await import(`/@fs/${root}/src/client/engine/sprites/seatModel.ts`);
      const { sitterMask } = await import(`/@fs/${root}/src/client/engine/sprites/seatLayers.ts`);
      const { avatarSprite } = await import(`/@fs/${root}/src/client/engine/sprites/avatar.ts`);
      const { renderAvatarLayers } = await import(`/@fs/${root}/src/client/engine/sprites/avatarQa.ts`);
      const { FIG, poseDrop } = await import(`/@fs/${root}/src/shared/world/seatFigure.ts`);
      const pose = w.pose(a), facing = w.viewFacing(a), look = w.look(a), legs = w.legsOf(a);
      const feet = [((a.at?.x ?? a.sx) - st.dx) * 2, ((a.at?.y ?? a.sy) - st.dy) * 2];
      const height = (a.lift ?? 0) - (st.obj.z ?? 0) + (FIG.feet - FIG.hip - poseDrop(pose)) / 2;
      const mask = sitterMask(mv, look, facing, pose, feet, legs, height);
      const sprite = avatarSprite(look, facing, pose, undefined, legs), actual = w.figureOf(a);
      const rgba = (s: any) => Array.from(s.canvas.getContext('2d').getImageData(0, 0, s.canvas.width, s.canvas.height).data);
      const depth = seatDepth(mv), figure = renderAvatarLayers(look, facing, pose, legs);
      const previous = { reducedMotion:w.reducedMotion, overlays:w.drawActorOverlays, camera:{...w.camera} };
      w.hover = null; w.hoverTile = null; w.reducedMotion = true;
      w.drawActorOverlays = () => undefined;
      w.camera.maxZoom = 4; w.camera.jump(a.sx, a.sy - 20, 4);
      w.draw();
      const result = { id, object: st.obj, facing, pose, look, legs, feet, height, model: mv.model,
        art: { w: mv.art.px.w, h: mv.art.px.h, rgba: Array.from(mv.art.px.d) },
        figure: { w: sprite.canvas.width, h: sprite.canvas.height, ax: sprite.ax, ay: sprite.ay,
          rgba: rgba(sprite), actual: rgba(actual), owner: Array.from(figure.owner), mask: Array.from(mask) },
        depth: { part: Array.from(depth.part), face: Array.from(depth.face), z: Array.from(depth.z), how: Array.from(depth.how) },
        screenshot: w.ctx.canvas.toDataURL('image/png'), visualStatus: 'UNREVIEWED' };
      w.reducedMotion=previous.reducedMotion;w.drawActorOverlays=previous.overlays;Object.assign(w.camera,previous.camera);
      return result;
    }, { id: seat.id, root, occupant });
    // Assert that these are the exact pixels used in-game, not a different preview compositor.
    const f = record.figure;
    expect(f.actual.length).toBe(f.rgba.length);
    const mismatches = f.mask.flatMap((masked, i) => f.actual[i * 4 + 3] !== (masked ? 0 : f.rgba[i * 4 + 3]) ? [i] : []);
    expect(mismatches, 'diagnostic mask must exactly match the live sprite').toEqual([]);
    records.push({ ...record, cushion: spot.index });
    writeFileSync(`${out}/${room}.json`, JSON.stringify(records));
  }
  writeFileSync(`${out}/${room}.json`, JSON.stringify(records));
});
