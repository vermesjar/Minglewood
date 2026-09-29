/**
 * Sprite lab (dev only): renders rooms through the real WorldView, the sprite catalogue and the avatar
 * matrix, and saves each render to art/review/<name>.png via the dev snapshot endpoint — so art can be
 * reviewed at 1:1 even when no browser window is visible. Drive it from the console / automation:
 *   await lab.room('cafe', { zoom: 2 })     await lab.sprites()     await lab.avatars()
 */
import type { AvatarLoadout } from '@shared/domain/types';
import type { Occupant } from '@shared/protocol';
import { getScene } from '@shared/world';
import { isSeat, type Facing, type SceneObject } from '@shared/world/scene';
import { WalkGrid } from '@shared/world/walkGrid';
import { buildSeed } from '@shared/seed/northstar';
import { WorldView } from '../engine/WorldView';
import { loadArt } from '../engine/sprites/art';
import { clearSpriteCache, spriteFor } from '../engine/sprites/registry';
import { avatarSprite, type Pose } from '../engine/sprites/avatar';
import { blit } from '../engine/sprites/painter';
import { setSkyOverride, type Sky } from '../engine/weather';

const seed = buildSeed();
const noop = () => undefined;

async function snap(canvas: HTMLCanvasElement, name: string) {
  const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/png'));
  const res = await fetch(`/api/dev/snapshot?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png' },
    body: blob,
  });
  return (await res.json()) as { path: string };
}

function freshCanvas(w: number, h: number) {
  document.body.replaceChildren();
  const c = document.createElement('canvas');
  c.style.width = `${w}px`;
  c.style.height = `${h}px`;
  document.body.append(c);
  return c;
}

/** People for a room: every other one seated, the rest standing around. */
function peopleFor(sceneId: string, n: number): Occupant[] {
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
    else {
      for (let k = 0; k < 400; k++) {
        const tx = (i * 7 + k * 3) % scene.width;
        const ty = (i * 5 + k * 5) % scene.height;
        if (grid.walkable(tx, ty) && !out.some((o) => o.x === tx && o.y === ty)) {
          x = tx;
          y = ty;
          break;
        }
      }
    }
    out.push({
      memberId: m.id,
      x,
      y,
      facing: seat?.facing ?? facings[i % 4],
      sittingOn: seat?.id,
      status: 'available',
      avatar: m.avatar,
      via: 'sim',
    });
  });
  return out;
}

interface RoomOpts {
  zoom?: number;
  w?: number;
  h?: number;
  people?: number;
  names?: boolean;
  name?: string;
  footprints?: boolean;
}

async function room(sceneId: string, o: RoomOpts = {}) {
  const scene = getScene(sceneId);
  if (!scene) throw new Error(`no scene ${sceneId}`);
  const canvas = freshCanvas(o.w ?? 1400, o.h ?? 900);
  const view = new WorldView(canvas, {
    onGroundClick: noop,
    onActorClick: noop,
    onObjectClick: noop,
    onObjectActivate: noop,
    nameOf: (id) => seed.members.find((m) => m.id === id)?.displayName ?? 'Someone',
  });
  view.loadScene(scene, peopleFor(sceneId, o.people ?? 6), {
    meId: '',
    activeDecor: new Set(),
    festiveRooms: new Set(),
    party: false,
  });
  const v = view as unknown as {
    camera: { zoom: number; tzoom: number };
    update(dt: number): void;
    draw(): void;
    drawActorOverlays(): void;
  };
  if (o.zoom) v.camera.zoom = v.camera.tzoom = o.zoom;
  if (!o.names) v.drawActorOverlays = noop;
  v.update(0.016);
  v.draw();
  if (o.footprints) {
    // Debug: every object's true footprint (cyan) and blocked tiles, to check art against the tiles it owns.
    const cam = (view as unknown as { camera: { x: number; y: number; zoom: number } }).camera;
    const dpr = window.devicePixelRatio || 1;
    const vw = canvas.width / dpr;
    const vh = canvas.height / dpr;
    const c = canvas.getContext('2d')!;
    c.setTransform(cam.zoom * dpr, 0, 0, cam.zoom * dpr, dpr * (vw / 2 - cam.x * cam.zoom), dpr * (vh / 2 - cam.y * cam.zoom));
    c.lineWidth = 1 / cam.zoom;
    for (const ob of scene.objects) {
      if (ob.wall) continue;
      const w = ob.w ?? 1;
      const d = ob.d ?? 1;
      const P = (x: number, y: number) => [(x - y) * 16, (x + y) * 8 - (ob.z ?? 0)] as const;
      c.strokeStyle = ob.flat ? 'rgba(255,220,80,0.8)' : 'rgba(80,240,255,0.95)';
      c.beginPath();
      c.moveTo(...P(ob.x, ob.y));
      c.lineTo(...P(ob.x + w, ob.y));
      c.lineTo(...P(ob.x + w, ob.y + d));
      c.lineTo(...P(ob.x, ob.y + d));
      c.closePath();
      c.stroke();
    }
  }
  const r = await snap(canvas, o.name ?? `room-${sceneId}`);
  view.destroy();
  return r;
}

/** Every distinct interior object, drawn on a floor tile at 2× (1 art px = 2 screen px). */
async function sprites(o: { scenes?: string[]; name?: string } = {}) {
  const ids = o.scenes ?? ['cafe', 'hq', 'eng', 'launch', 'events', 'focus', 'arcade', 'design'];
  const seen = new Map<string, SceneObject>();
  for (const id of ids)
    for (const ob of getScene(id)?.objects ?? []) {
      if (ob.wall || ob.flat) continue;
      const k = `${ob.sprite}.${ob.variant ?? ''}.${ob.facing ?? ''}.${ob.w ?? 1}x${ob.d ?? 1}`;
      if (!seen.has(k)) seen.set(k, { ...ob, x: 0, y: 0 });
    }
  const list = [...seen.entries()];
  const cols = 8;
  const cell = 150;
  const Z = 2;
  const W = cols * cell;
  const H = Math.ceil(list.length / cols) * cell;
  const canvas = freshCanvas(W, H);
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  c.fillStyle = '#2d2538';
  c.fillRect(0, 0, W, H);
  list.forEach(([k, ob], i) => {
    const cx = (i % cols) * cell + cell / 2;
    const cy = Math.floor(i / cols) * cell + cell - 34;
    const w = ob.w ?? 1;
    const d = ob.d ?? 1;
    c.setTransform(Z, 0, 0, Z, cx, cy);
    c.fillStyle = '#b98256';
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(w * 16, w * 8);
    c.lineTo((w - d) * 16, (w + d) * 8);
    c.lineTo(-d * 16, d * 8);
    c.closePath();
    c.fill();
    const s = spriteFor(ob);
    if (s) blit(c, s, 0, 0);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#f6ead6';
    c.font = '11px system-ui';
    c.fillText(k.replace(/\.+/g, '.'), (i % cols) * cell + 4, Math.floor(i / cols) * cell + 12);
  });
  return snap(canvas, o.name ?? 'sprites');
}

/** Avatars: every facing × pose for a few looks, at 3× so faces can be judged. */
interface AvatarOpts {
  looks?: AvatarLoadout[];
  name?: string;
  zoom?: number;
  from?: number;
  count?: number;
  facings?: Facing[];
  poses?: Pose[];
}

async function avatars(o: AvatarOpts = {}) {
  const looks = o.looks ?? seed.members.slice(o.from ?? 0, (o.from ?? 0) + (o.count ?? 6)).map((m) => m.avatar);
  const facings: Facing[] = o.facings ?? ['se', 'sw', 'ne', 'nw'];
  const poses: Pose[] = o.poses ?? ['stand', 'walk1', 'walk2', 'sit', 'wave'];
  const Z = o.zoom ?? 3;
  const cw = 46 * Z;
  const ch = 58 * Z;
  const cols = facings.length * poses.length;
  const canvas = freshCanvas(cols * cw, looks.length * ch);
  canvas.width = cols * cw;
  canvas.height = looks.length * ch;
  const c = canvas.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  c.fillStyle = '#e8dcc6';
  c.fillRect(0, 0, canvas.width, canvas.height);
  looks.forEach((L, r) =>
    facings.forEach((f, fi) =>
      poses.forEach((p, pi) => {
        const col = fi * poses.length + pi;
        c.setTransform(Z, 0, 0, Z, col * cw + cw / 2, r * ch + ch - 4 * Z);
        c.fillStyle = 'rgba(40,30,50,0.25)';
        c.beginPath();
        c.ellipse(0, 0, 8, 4, 0, 0, Math.PI * 2);
        c.fill();
        blit(c, avatarSprite(L, f, p), 0, 0);
      }),
    ),
  );
  c.setTransform(1, 0, 0, 1, 0, 0);
  return snap(canvas, o.name ?? 'avatars');
}

const ready = loadArt().then(clearSpriteCache);
const lab = {
  ready,
  room: async (id: string, o?: RoomOpts) => {
    await ready;
    return room(id, o);
  },
  sprites: async (o?: { scenes?: string[]; name?: string }) => {
    await ready;
    return sprites(o);
  },
  avatars: async (o?: AvatarOpts) => {
    await ready;
    return avatars(o);
  },
  /** Force the sky for renders, e.g. lab.sky({ phase: 'night', weather: 'rain' }); lab.sky(null) to follow the clock. */
  sky: (o: Partial<Sky> | null) => setSkyOverride(o),
  reloadArt: async () => {
    await loadArt();
    clearSpriteCache();
  },
  seed,
};
(window as unknown as { lab: typeof lab }).lab = lab;
document.title = 'Minglewood — sprite lab (ready)';
