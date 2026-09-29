/**
 * Grid lab (dev only): the logical tile grid drawn over the real world, to check that what you see on the
 * ground (paving, planks, rugs) and what stands on it (furniture footprints, seat spots) line up with the
 * tiles the game actually uses.
 *   const g = await import('/lab/gridLab.ts');
 *   await g.render({ scene: 'town', at: [35.5, 36], zoom: 4, name: 'grid-plaza' });
 */
import { getScene } from '@shared/world';
import { isoToScreen } from '@shared/iso';
import type { Occupant } from '@shared/protocol';
import { footprint, isSeat } from '@shared/world/scene';
import { seatSpots } from '@shared/world/seats';
import { buildSeed } from '@shared/seed/northstar';
import { WorldView } from '../engine/WorldView';
import { loadArt } from '../engine/sprites/art';
import { clearSpriteCache } from '../engine/sprites/registry';
import { setSkyOverride } from '../engine/weather';

const seed = buildSeed();
const noop = () => undefined;
const ready = loadArt().then(clearSpriteCache);

interface View {
  ground: { finishNow?: () => void } | null;
  camera: { x: number; y: number; zoom: number; jump(x: number, y: number, z: number): void };
  update(dt: number): void;
  draw(): void;
  drawActorOverlays(): void;
  destroy(): void;
}

export async function render(o: { scene: string; at: [number, number]; zoom?: number; w?: number; h?: number; seated?: boolean; name: string }) {
  await ready;
  setSkyOverride({ phase: 'day', weather: 'clear' });
  const scene = getScene(o.scene)!;
  const occ: Occupant[] = [];
  if (o.seated) {
    let k = 0;
    for (const b of scene.objects.filter(isSeat))
      for (const s of seatSpots(b, scene)) {
        const m = seed.members[k++ % seed.members.length];
        occ.push({ memberId: m.id, x: s.x, y: s.y, facing: s.facing, sittingOn: b.id, status: 'available', avatar: m.avatar, via: 'sim' });
      }
  }
  document.body.replaceChildren();
  const canvas = document.createElement('canvas');
  const W = o.w ?? 1400;
  const H = o.h ?? 900;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  document.body.append(canvas);
  const view = new WorldView(canvas, { onGroundClick: noop, onActorClick: noop, onObjectClick: noop, onObjectActivate: noop, nameOf: () => '' });
  view.loadScene(scene, occ, { meId: '', activeDecor: new Set(), festiveRooms: new Set(), party: false });
  const v = view as unknown as View;
  const p = isoToScreen(o.at[0], o.at[1]);
  const z = o.zoom ?? 4;
  v.camera.jump(p.x, p.y, z);
  v.drawActorOverlays = noop;
  v.ground?.finishNow?.();
  v.update(0.05);
  v.draw();
  // overlay: tile edges (thin cyan), furniture footprints (yellow), seat spots (magenta dots)
  const dpr = window.devicePixelRatio || 1;
  const c = canvas.getContext('2d')!;
  c.setTransform(z * dpr, 0, 0, z * dpr, dpr * (W / 2 - v.camera.x * z), dpr * (H / 2 - v.camera.y * z));
  c.lineWidth = 1 / z;
  const S = (x: number, y: number) => isoToScreen(x, y);
  const r = 14;
  const [cx, cy] = o.at;
  c.strokeStyle = 'rgba(0,230,255,0.55)';
  for (let t = -r; t <= r; t++) {
    const a = S(cx - r, Math.floor(cy) + t);
    const b = S(cx + r, Math.floor(cy) + t);
    c.beginPath();
    c.moveTo(a.x, a.y);
    c.lineTo(b.x, b.y);
    c.stroke();
    const d = S(Math.floor(cx) + t, cy - r);
    const e = S(Math.floor(cx) + t, cy + r);
    c.beginPath();
    c.moveTo(d.x, d.y);
    c.lineTo(e.x, e.y);
    c.stroke();
  }
  for (const ob of scene.objects) {
    if (ob.wall || ob.flat) continue;
    const f = footprint(ob);
    if (Math.abs(f.x0 - cx) > r || Math.abs(f.y0 - cy) > r) continue;
    c.strokeStyle = isSeat(ob) ? 'rgba(255,60,200,0.95)' : 'rgba(255,220,60,0.9)';
    c.lineWidth = 2 / z;
    const a = S(f.x0, f.y0);
    const b = S(f.x1, f.y0);
    const d = S(f.x1, f.y1);
    const e = S(f.x0, f.y1);
    c.beginPath();
    c.moveTo(a.x, a.y);
    c.lineTo(b.x, b.y);
    c.lineTo(d.x, d.y);
    c.lineTo(e.x, e.y);
    c.closePath();
    c.stroke();
    for (const s of seatSpots(ob, scene)) {
      const m = S(s.x + 0.5, s.y + 0.5);
      c.fillStyle = 'rgba(255,60,200,1)';
      c.fillRect(m.x - 1.5, m.y - 1, 3, 2);
    }
  }
  const blob = await new Promise<Blob>((res) => canvas.toBlob((bb) => res(bb!), 'image/png'));
  const out = await fetch(`/api/dev/snapshot?name=${encodeURIComponent(o.name)}`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: blob });
  view.destroy();
  setSkyOverride(null);
  return (await out.json()) as { path: string };
}
