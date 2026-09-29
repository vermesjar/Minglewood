/**
 * Town lab (dev only): review renders and frame-time measurements of the outdoor world through the real
 * WorldView, at any camera position, time of day and moment. Load it from the sprite lab page:
 *   const t = await import('/src/client/lab/townLab.ts');
 *   await t.render({ at: [45, 60], zoom: 2, sky: { phase: 'night' }, name: 'town-night' });
 *   await t.perf({ zoom: 1 });
 */
import { getScene, TOWN_ID } from '@shared/world';
import { isoToScreen } from '@shared/iso';
import type { Occupant } from '@shared/protocol';
import { WalkGrid } from '@shared/world/walkGrid';
import { buildSeed } from '@shared/seed/northstar';
import { WorldView } from '../engine/WorldView';
import { findPath } from '@shared/world/pathfinding';
import { groundStats } from '../engine/ground';
import { loadArt } from '../engine/sprites/art';
import { clearSpriteCache } from '../engine/sprites/registry';
import { setSkyOverride, type Sky } from '../engine/weather';

const seed = buildSeed();
const noop = () => undefined;
const ready = loadArt().then(clearSpriteCache);

interface View {
  ground: { finishNow?: () => void; done?: Promise<void> } | null;
  camera: { zoom: number; tzoom: number; jump(x: number, y: number, z: number): void };
  update(dt: number): void;
  draw(): void;
  drawActorOverlays(): void;
  destroy(): void;
}

/** People scattered on walkable tiles near the plaza and lanes. */
function people(n: number): Occupant[] {
  const scene = getScene(TOWN_ID)!;
  const grid = new WalkGrid(scene);
  const out: Occupant[] = [];
  const facings = ['se', 'sw', 'ne', 'nw'] as const;
  seed.members.slice(0, n).forEach((m, i) => {
    for (let k = 0; k < 800; k++) {
      const tx = 26 + ((i * 7 + k * 3) % 30);
      const ty = 24 + ((i * 5 + k * 5) % 40);
      if (grid.walkable(tx, ty) && !out.some((o) => o.x === tx && o.y === ty)) {
        out.push({ memberId: m.id, x: tx, y: ty, facing: facings[i % 4], status: 'available', avatar: m.avatar, via: 'sim' });
        break;
      }
    }
  });
  return out;
}

function setup(o: { w?: number; h?: number; people?: number }) {
  document.body.replaceChildren();
  const canvas = document.createElement('canvas');
  canvas.style.width = `${o.w ?? 1600}px`;
  canvas.style.height = `${o.h ?? 1000}px`;
  document.body.append(canvas);
  const view = new WorldView(canvas, {
    onGroundClick: noop,
    onActorClick: noop,
    onObjectClick: noop,
    onObjectActivate: noop,
    nameOf: (id) => seed.members.find((m) => m.id === id)?.displayName ?? 'Someone',
  });
  view.loadScene(getScene(TOWN_ID)!, people(o.people ?? 16), { meId: '', activeDecor: new Set(), festiveRooms: new Set(), party: false });
  return { canvas, view: view as unknown as View };
}

async function snap(canvas: HTMLCanvasElement, name: string) {
  const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/png'));
  const res = await fetch(`/api/dev/snapshot?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: blob });
  return (await res.json()) as { path: string };
}

/** A still of the town: camera centred on tile `at`, the sky forced, `seconds` of ambient life run first. */
export async function render(o: { at?: [number, number]; zoom?: number; w?: number; h?: number; sky?: Partial<Sky>; seconds?: number; people?: number; name: string }) {
  await ready;
  setSkyOverride({ phase: 'day', weather: 'clear', ...(o.sky ?? {}) });
  const { canvas, view } = setup(o);
  const z = o.zoom ?? 2;
  if (o.at) {
    const p = isoToScreen(o.at[0], o.at[1]);
    view.camera.jump(p.x, p.y, z);
  } else view.camera.zoom = view.camera.tzoom = z;
  view.ground?.finishNow?.();
  // let smoke rise, spray fall, ducks paddle
  const steps = Math.round((o.seconds ?? 3) / 0.05);
  for (let i = 0; i < steps; i++) view.update(0.05);
  view.draw();
  const r = await snap(canvas, o.name);
  view.destroy();
  setSkyOverride(null);
  return r;
}

/** Frame time (update + draw) at a zoom over the whole town, the camera panning across it. */
export async function perf(o: { zoom?: number; w?: number; h?: number; frames?: number; sky?: Partial<Sky> } = {}) {
  await ready;
  setSkyOverride({ phase: 'day', weather: 'clear', ...(o.sky ?? {}) });
  const { view } = setup({ w: o.w ?? 1920, h: o.h ?? 1080 });
  view.ground?.finishNow?.();
  const z = o.zoom ?? 1;
  const n = o.frames ?? 60;
  const times: number[] = [];
  for (let i = 0; i < n; i++) {
    // sweep across the map so every district is drawn
    const tx = 10 + ((i * 7) % 56);
    const ty = 10 + ((i * 11) % 56);
    const p = isoToScreen(tx, ty);
    view.camera.jump(p.x, p.y, z);
    const t0 = performance.now();
    view.update(1 / 60);
    view.draw();
    times.push(performance.now() - t0);
  }
  view.destroy();
  setSkyOverride(null);
  times.sort((a, b) => a - b);
  const avg = times.reduce((a, b) => a + b, 0) / n;
  return { zoom: z, avg: +avg.toFixed(2), p50: +times[n >> 1].toFixed(2), p95: +times[Math.floor(n * 0.95)].toFixed(2), max: +times[n - 1].toFixed(2) };
}

/**
 * First-load cost of the town scene (ms): until the first frame is on screen (view, sprites, the ground's
 * flat coat), and until the ground has fully streamed in (in slices between frames). `cold` clears the
 * ground cache first by giving the scene a fresh id.
 */
export async function load() {
  await ready;
  clearSpriteCache();
  const t0 = performance.now();
  document.body.replaceChildren();
  const canvas = document.createElement('canvas');
  canvas.style.width = '1920px';
  canvas.style.height = '1080px';
  document.body.append(canvas);
  const view = new WorldView(canvas, { onGroundClick: noop, onActorClick: noop, onObjectClick: noop, onObjectActivate: noop, nameOf: () => '' });
  const scene = { ...getScene(TOWN_ID)!, id: `town-cold-${Date.now()}` };
  view.loadScene(scene, people(16), { meId: '', activeDecor: new Set(), festiveRooms: new Set(), party: false });
  const v = view as unknown as View;
  v.update(1 / 60);
  v.draw();
  const firstFrame = Math.round(performance.now() - t0);
  // keep drawing frames while the ground streams in, and time the longest one
  let longest = 0;
  let frames = 0;
  let done = false;
  void v.ground?.done?.then(() => (done = true));
  while (!done && performance.now() - t0 < 20000) {
    await new Promise((r) => setTimeout(r, 16));
    const f0 = performance.now();
    v.update(1 / 60);
    v.draw();
    longest = Math.max(longest, performance.now() - f0);
    frames++;
  }
  const complete = Math.round(performance.now() - t0);
  view.destroy();
  return { firstFrame, complete, framesWhileStreaming: frames, longestFrame: Math.round(longest) };
}

/** Long walks across the town: spawn / the far corners to each building's door (ms, path length). */
export function paths() {
  const scene = getScene(TOWN_ID)!;
  const grid = new WalkGrid(scene);
  const starts: Array<[string, [number, number]]> = [
    ['spawn', [scene.spawn.x, scene.spawn.y]],
    ['west woods', [8, 35]],
    ['south lane', [35, 70]],
  ];
  const res: Array<{ from: string; to: string; ms: number; steps: number }> = [];
  for (const [from, start] of starts)
    for (const b of scene.objects.filter((x) => x.building && x.door)) {
      const t0 = performance.now();
      const p = findPath(grid, start, [b.door!.x, b.door!.y]);
      res.push({ from, to: b.roomId!, ms: +(performance.now() - t0).toFixed(2), steps: p ? p.length : -1 });
    }
  return { worst: Math.max(...res.map((r) => r.ms)), unreachable: res.filter((r) => r.steps < 0), res };
}

/**
 * The ground's total CPU cost and its slice sizes (ms), measured by finishing it synchronously in slices of
 * the same budget the live scheduler uses — hidden tabs throttle timers, so this is the honest number.
 */
export async function groundCost() {
  await ready;
  const { view } = setup({ w: 1920, h: 1080 });
  const scene = { ...getScene(TOWN_ID)!, id: `town-cost-${Date.now()}` };
  (view as unknown as { loadScene: WorldView['loadScene'] }).loadScene(scene, [], { meId: '', activeDecor: new Set(), festiveRooms: new Set(), party: false });
  const flat = groundStats.flat;
  const t0 = performance.now();
  view.ground?.finishNow?.();
  const total = performance.now() - t0;
  view.destroy();
  return {
    flatCoat: Math.round(flat),
    totalCpu: Math.round(total),
    detail1x: Math.round(groundStats.raster),
    water: Math.round(groundStats.water),
    crisp2x: Math.round(groundStats.raster2),
    longestSlice: +groundStats.longestSlice.toFixed(1),
  };
}
