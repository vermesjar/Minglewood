/** The harness itself works: we're in the world, can read state, and can click on things. */
import { expect, test } from './helpers';

test('boots into the world as a bot and reads live state', async ({ player }) => {
  const me = await player.me();
  expect(me.id).toMatch(/^m-/);
  expect(me.sceneId).toBeTruthy();
  await player.enter('cafe');
  const scene = await player.scene();
  expect(scene.id).toBe('cafe');
  const couch = scene.objects.find((o) => o.sprite === 'couch')!;
  expect((await player.seatSpots(couch.id)).length).toBe(2);
  expect(await player.objectPoint(couch.id)).not.toBeNull();
  await player.full('smoke-cafe');
});
