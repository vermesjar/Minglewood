/**
 * HUD lab (dev only): the canvas HUD through the real WorldView — speech bubbles, name tags, hover and
 * selection, the "You" marker, NPC tags and the town's building badges — staged and rendered synchronously
 * for before/after review. From /lab.html:
 *   const h = await import('/lab/hudLab.ts');
 *   await h.room({ scene: 'cafe', talk: 4, hover: 3, name: 'hud-cafe' });
 *   await h.town({ zoom: 1, name: 'hud-town-1x' });
 */
import { getScene, TOWN_ID } from '@shared/world';
import { isoToScreen } from '@shared/iso';
import type { Occupant } from '@shared/protocol';
import { WalkGrid } from '@shared/world/walkGrid';
import { isSeat, type Facing } from '@shared/world/scene';
import { buildSeed } from '@shared/seed/northstar';
import { WorldView, type BuildingBadge } from '../engine/WorldView';
import { loadArt } from '../engine/sprites/art';
import { clearSpriteCache } from '../engine/sprites/registry';
import { setSkyOverride } from '../engine/weather';

const seed = buildSeed();
const noop = () => undefined;
const ready = loadArt().then(clearSpriteCache);

const LINES = [
  'Lisbon offsite photos are on the HQ wall now 📸',
  'I finally finished that climbing route!',
  'Anyone up for the 3pm demo?',
  'Oat flat white, please ☕',
  'Ship it 🚀',
  'Who left the rocket on the stairs',
  'brb',
];

interface Internals {
  actors: Map<string, { occ: Occupant; bubble?: { text: string; start: number; until: number }; sx: number; sy: number }>;
  hover: { kind: 'actor' | 'object'; id: string } | null;
  selectedActor: string | null;
  meId: string;
  camera: { zoom: number; tzoom: number; x: number; y: number; jump(x: number, y: number, z: number): void };
  ground: { finishNow?: () => void } | null;
  update(dt: number): void;
  draw(): void;
  destroy(): void;
}

function setup(w: number, h: number) {
  document.body.replaceChildren();
  const canvas = document.createElement('canvas');
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  document.body.append(canvas);
  const view = new WorldView(canvas, {
    onGroundClick: noop,
    onActorClick: noop,
    onObjectClick: noop,
    onObjectActivate: noop,
    nameOf: (id) => seed.members.find((m) => m.id === id)?.displayName ?? 'Someone',
  });
  return { canvas, view };
}

async function snap(canvas: HTMLCanvasElement, name: string) {
  const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/png'));
  const res = await fetch(`/api/dev/snapshot?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: blob });
  return (await res.json()) as { path: string };
}

/** People for a room: every other one on a seat, the rest standing near each other (so bubbles collide). */
function roomPeople(sceneId: string, n: number): Occupant[] {
  const scene = getScene(sceneId)!;
  const grid = new WalkGrid(scene);
  const seats = scene.objects.filter(isSeat);
  const out: Occupant[] = [];
  const facings: Facing[] = ['se', 'sw', 'ne', 'nw'];
  seed.members.slice(0, n).forEach((m, i) => {
    const seat = i % 2 === 0 ? seats[i / 2] : undefined;
    let x = 0;
    let y = 0;
    if (seat) ({ x, y } = seat);
    else
      for (let k = 0; k < 400; k++) {
        const tx = (i * 7 + k * 3) % scene.width;
        const ty = (i * 5 + k * 5) % scene.height;
        if (grid.walkable(tx, ty) && !out.some((o) => o.x === tx && o.y === ty)) {
          x = tx;
          y = ty;
          break;
        }
      }
    out.push({ memberId: m.id, x, y, facing: seat?.facing ?? facings[i % 4], sittingOn: seat?.id, status: 'available', avatar: m.avatar, via: 'sim' });
  });
  return out;
}

/**
 * A room with its HUD. `talk`: how many of the closest-together people are mid-sentence (staggered ages, so
 * the newest and oldest bubbles both show). `hover` / `select` / `me`: indices into the room's people.
 */
export async function room(o: { scene?: string; people?: number; talk?: number; hover?: number; select?: number; me?: number; zoom?: number; w?: number; h?: number; name: string }) {
  await ready;
  setSkyOverride({ phase: 'day', weather: 'clear', sun: 0.8, lamp: 0.2 });
  const sceneId = o.scene ?? 'cafe';
  const scene = getScene(sceneId)!;
  const { canvas, view } = setup(o.w ?? 1920, o.h ?? 1080);
  const people = roomPeople(sceneId, o.people ?? 12);
  const meId = o.me !== undefined ? people[o.me].memberId : '';
  view.loadScene(scene, people, { meId, activeDecor: new Set(), festiveRooms: new Set(), party: false });
  view.setNpcs(scene, (scene.npcs ?? []).map((n) => ({ id: n.id, x: n.spots[0].x, y: n.spots[0].y, facing: n.spots[0].facing })));
  const v = view as unknown as Internals;
  if (o.zoom) v.camera.zoom = v.camera.tzoom = o.zoom;
  v.update(0.016);
  // the talkers: the people standing closest together
  const ids = people.map((p) => p.memberId);
  const byCrowd = [...ids].sort((a, b) => crowd(people, b) - crowd(people, a));
  const now = performance.now();
  byCrowd.slice(0, o.talk ?? 0).forEach((id, k) => {
    const a = v.actors.get(id);
    if (a) a.bubble = { text: LINES[k % LINES.length], start: now - 400 - k * 1200, until: now + 6000 };
  });
  const npc = [...v.actors.keys()].find((k) => k.startsWith('npc:'));
  if (npc && (o.talk ?? 0) > 0) {
    const a = v.actors.get(npc)!;
    a.bubble = { text: 'Welcome in! What can I get you?', start: now - 200, until: now + 6000 };
  }
  if (o.hover !== undefined) v.hover = { kind: 'actor', id: ids[o.hover] };
  if (o.select !== undefined) v.selectedActor = ids[o.select];
  v.draw();
  const r = await snap(canvas, o.name);
  v.destroy();
  setSkyOverride(null);
  return r;
}

function crowd(people: Occupant[], id: string) {
  const p = people.find((q) => q.memberId === id)!;
  return people.filter((q) => q !== p && Math.abs(q.x - p.x) + Math.abs(q.y - p.y) <= 3).length;
}

/** The town with building badges: a few buildings occupied, the rest empty. */
export async function town(o: { zoom?: number; at?: [number, number]; w?: number; h?: number; name: string }) {
  await ready;
  setSkyOverride({ phase: 'day', weather: 'clear' });
  const { canvas, view } = setup(o.w ?? 1920, o.h ?? 1080);
  const scene = getScene(TOWN_ID)!;
  view.loadScene(scene, [], { meId: '', activeDecor: new Set(), festiveRooms: new Set(), party: false });
  const v = view as unknown as Internals;
  const badges = new Map<string, BuildingBadge>();
  const faces = seed.members.map((m) => m.avatar);
  const counts: Record<string, number> = { cafe: 4, hq: 3, events: 11 };
  for (const b of scene.objects.filter((x) => x.building && x.roomId)) {
    const id = b.roomId!;
    const n = counts[id] ?? 0;
    badges.set(id, { name: b.label ?? id, emoji: '🏠', count: n, faces: faces.slice(0, n), openCount: id === 'cafe' ? 2 : 0, event: id === 'events' ? 'Party now!' : undefined });
  }
  view.setBadges(badges);
  const z = o.zoom ?? 1;
  const at = o.at ?? [40, 40];
  const p = isoToScreen(at[0], at[1]);
  v.camera.jump(p.x, p.y, z);
  v.ground?.finishNow?.();
  v.update(0.016);
  v.draw();
  const r = await snap(canvas, o.name);
  v.destroy();
  setSkyOverride(null);
  return r;
}
