/**
 * Life lab (dev only): a room with a party on, rendered at a few moments in time side by side, to check that
 * people dance in their own time and never in unison. Load it from the sprite lab page:
 *   const l = await import('/lab/lifeLab.ts'); await l.party({ room: 'events' });
 */
import { getScene } from '@shared/world';
import type { Occupant } from '@shared/protocol';
import { WalkGrid } from '@shared/world/walkGrid';
import { buildSeed } from '@shared/seed/northstar';
import { WorldView } from '../engine/WorldView';
import { loadArt } from '../engine/sprites/art';
import { clearSpriteCache } from '../engine/sprites/registry';
import { setSkyOverride } from '../engine/weather';

const seed = buildSeed();
const noop = () => undefined;
const ready = loadArt().then(clearSpriteCache);

export async function party(o: { room?: string; zoom?: number; people?: number; moments?: number; gapMs?: number; name?: string } = {}) {
  await ready;
  setSkyOverride({ phase: 'day', weather: 'clear', sun: 0.8, lamp: 0.2 });
  const scene = getScene(o.room ?? 'events')!;
  const grid = new WalkGrid(scene);
  const occ: Occupant[] = [];
  const facings = ['se', 'sw', 'ne', 'nw'] as const;
  seed.members.slice(0, o.people ?? 14).forEach((m, i) => {
    for (let k = 0; k < 600; k++) {
      const x = (i * 5 + k * 3) % scene.width;
      const y = (i * 3 + k * 7) % scene.height;
      if (grid.walkable(x, y) && !occ.some((p) => p.x === x && p.y === y)) {
        occ.push({ memberId: m.id, x, y, facing: facings[i % 4], status: 'available', avatar: m.avatar, via: 'sim' });
        break;
      }
    }
  });
  const W = 1100;
  const H = 760;
  const moments = o.moments ?? 4;
  const sheet = document.createElement('canvas');
  sheet.width = W * moments;
  sheet.height = H;
  const sc = sheet.getContext('2d')!;
  document.body.replaceChildren();
  const canvas = document.createElement('canvas');
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  document.body.append(canvas);
  const view = new WorldView(canvas, { onGroundClick: noop, onActorClick: noop, onObjectClick: noop, onObjectActivate: noop, nameOf: () => '' });
  view.loadScene(scene, occ, { meId: '', activeDecor: new Set(['balloons', 'cake', 'bunting']), festiveRooms: new Set([scene.id]), party: true });
  const v = view as unknown as { camera: { zoom: number; tzoom: number }; update(dt: number): void; draw(): void; drawActorOverlays(): void };
  v.camera.zoom = v.camera.tzoom = o.zoom ?? 2;
  v.drawActorOverlays = noop;
  for (let i = 0; i < moments; i++) {
    if (i) await new Promise((r) => setTimeout(r, o.gapMs ?? 260));
    v.update(0.016);
    v.draw();
    sc.drawImage(canvas, i * W, 0, W, H);
  }
  view.destroy();
  setSkyOverride(null);
  const blob = await new Promise<Blob>((r) => sheet.toBlob((b) => r(b!), 'image/png'));
  const res = await fetch(`/api/dev/snapshot?name=${encodeURIComponent(o.name ?? 'life-party')}`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: blob });
  return (await res.json()) as { path: string };
}
