/**
 * Furniture lab (dev only): renders furniture through the real WorldView and saves each render to
 * art/review/<name>.png via the dev snapshot endpoint.
 *
 *   await flab.seats({ zoom: 4 })          every seat type in all four facings, each occupied
 *   await flab.room('cafe', { zoom: 4 })   a real room with someone on every seat
 *   await flab.sitFilm('couch', 'purple', 'ne')   walk up, sit down, stand up and step off, frame by frame
 */
import type { AvatarLoadout } from '@shared/domain/types';
import type { NpcState, Occupant } from '@shared/protocol';
import { getScene } from '@shared/world';
import { isSeat, type Facing, type SceneDef, type SceneObject } from '@shared/world/scene';
import { seatSpots } from '@shared/world/seats';
import { buildSeed } from '@shared/seed/northstar';
import { isoToScreen } from '@shared/iso';
import { WorldView } from '../engine/WorldView';
import { loadArt } from '../engine/sprites/art';
import { clearSpriteCache } from '../engine/sprites/registry';
import { setSkyOverride } from '../engine/weather';

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

const FACINGS: Facing[] = ['se', 'sw', 'ne', 'nw'];

/** Seat kinds to test: sprite, variant, footprint along its facing (long couches). */
/** Every kind of seat that appears in any room (a new seat can never slip past the sheet). */
const ROOMS = ['cafe', 'hq', 'eng', 'launch', 'events', 'focus', 'arcade', 'design', 'town'];
const SEATS: Array<{ sprite: string; variant?: string; long?: boolean }> = (() => {
  const out = new Map<string, { sprite: string; variant?: string; long?: boolean }>();
  for (const id of ROOMS)
    for (const o of getScene(id)?.objects ?? [])
      if (isSeat(o)) {
        const key = `${o.sprite}.${o.variant ?? ''}`;
        const long = (o.w ?? 1) > 1 || (o.d ?? 1) > 1;
        const had = out.get(key);
        out.set(key, { sprite: o.sprite, variant: o.variant, long: long || had?.long });
      }
  return [...out.values()];
})();

function seatScene(): SceneDef {
  const objects: SceneObject[] = [];
  SEATS.forEach((s, row) => {
    FACINGS.forEach((f, col) => {
      const across = f === 'ne' || f === 'sw'; // a long seat runs along x when it faces ±y
      objects.push({
        id: `seat-${row}-${col}`,
        sprite: s.sprite,
        variant: s.variant,
        facing: f,
        x: 1 + col * 4,
        y: 1 + row * 3,
        w: s.long && across ? 2 : 1,
        d: s.long && !across ? 2 : 1,
        actions: [{ kind: 'sit' }],
      });
    });
  });
  const width = 17;
  const height = 1 + SEATS.length * 3 + 1;
  return {
    id: 'seat-test',
    kind: 'interior',
    name: 'Seat test',
    width,
    height,
    tiles: Array.from({ length: height }, () => '.'.repeat(width)),
    spawn: { x: 0, y: 1 },
    objects,
    interior: { floor: '#b98256', floorAlt: '#a87148', floorPattern: 'planks', wall: '#f3dcb8', wallTop: '#8a5a3b', trim: '#6b3f2a', doorY: 1, ambient: 'bright' },
  };
}

/** Someone on every seat spot (every cushion of a couch). */
function sitters(scene: SceneDef, looks: AvatarLoadout[]): Occupant[] {
  const out: Occupant[] = [];
  let k = 0;
  for (const o of scene.objects.filter(isSeat))
    for (const spot of seatSpots(o, scene)) {
      const m = seed.members[k % seed.members.length];
      out.push({
        memberId: `${m.id}-${k}`,
        x: spot.x,
        y: spot.y,
        facing: spot.facing,
        sittingOn: o.id,
        status: 'available',
        avatar: looks[k % looks.length] ?? m.avatar,
        via: 'sim',
      });
      k++;
    }
  return out;
}

interface Opts {
  zoom?: number;
  w?: number;
  h?: number;
  name?: string;
  looks?: AvatarLoadout[];
  footprints?: boolean;
  /** Extra occupants (standing people). */
  extra?: Occupant[];
  /** Room NPCs as the server would have them. */
  npcs?: NpcState[];
  /** Crop to tiles [x0, y0, x1, y1] (with headroom), at the render zoom. */
  crop?: [number, number, number, number];
  /** Centre the camera on this tile. */
  center?: [number, number];
  /** Seconds of simulated time before the shot (effects settle: smoke, ducks, clouds). */
  settle?: number;
}

async function render(scene: SceneDef, occupants: Occupant[], o: Opts, name: string) {
  const canvas = freshCanvas(o.w ?? 1600, o.h ?? 1000);
  const view = new WorldView(canvas, {
    onGroundClick: noop,
    onActorClick: noop,
    onObjectClick: noop,
    onObjectActivate: noop,
    nameOf: () => '',
  });
  view.loadScene(scene, [...occupants, ...(o.extra ?? [])], { meId: '', activeDecor: new Set(), festiveRooms: new Set(), party: false });
  view.setNpcs(scene, o.npcs ?? (scene.npcs ?? []).map((n) => ({ id: n.id, x: n.spots[0].x, y: n.spots[0].y, facing: n.spots[0].facing })));
  const v = view as unknown as { camera: { zoom: number; tzoom: number; x: number; y: number; tx: number; ty: number }; update(dt: number): void; draw(): void; drawActorOverlays(): void };
  if (o.zoom) v.camera.zoom = v.camera.tzoom = o.zoom;
  v.drawActorOverlays = noop;
  for (let t = 0; t < (o.settle ?? 0); t += 0.1) v.update(0.1);
  v.update(0.016);
  if (o.center) {
    const p = isoToScreen(o.center[0], o.center[1]);
    v.camera.x = v.camera.tx = p.x;
    v.camera.y = v.camera.ty = p.y;
  }
  v.draw();
  if (o.crop) {
    const [x0, y0, x1, y1] = o.crop;
    const cam = v.camera;
    const dpr = window.devicePixelRatio || 1;
    const vw = canvas.width / dpr;
    const vh = canvas.height / dpr;
    const S = (x: number, y: number, z = 0) => {
      const p = isoToScreen(x, y, z);
      return [dpr * (vw / 2 + (p.x - cam.x) * cam.zoom), dpr * (vh / 2 + (p.y - cam.y) * cam.zoom)];
    };
    const pts = [S(x0, y0, 70), S(x1, y0, 70), S(x1, y1), S(x0, y1)];
    const L = Math.min(...pts.map((p) => p[0]));
    const R = Math.max(...pts.map((p) => p[0]));
    const T = Math.min(...pts.map((p) => p[1]));
    const B = Math.max(...pts.map((p) => p[1]));
    const out = document.createElement('canvas');
    out.width = R - L;
    out.height = B - T;
    out.getContext('2d')!.drawImage(canvas, L, T, R - L, B - T, 0, 0, R - L, B - T);
    const r = await snap(out, o.name ?? name);
    view.destroy();
    return r;
  }
  if (o.footprints) {
    const cam = v.camera;
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
  const r = await snap(canvas, o.name ?? name);
  view.destroy();
  return r;
}

/** One seat, alone in a small room, centred at a zoom, drawn into `into` at (ox, oy). */
function seatCell(into: CanvasRenderingContext2D, seat: SceneObject, occupied: boolean, ox: number, oy: number, cw: number, ch: number, zoom: number, looks: AvatarLoadout[]) {
  const holder = document.createElement('canvas');
  holder.style.width = `${cw}px`;
  holder.style.height = `${ch}px`;
  holder.style.position = 'absolute';
  holder.style.left = '-9999px';
  document.body.append(holder);
  const scene: SceneDef = {
    id: 'cell',
    kind: 'interior',
    name: 'cell',
    width: 5,
    height: 5,
    tiles: Array.from({ length: 5 }, () => '.....'),
    spawn: { x: 0, y: 0 },
    objects: [{ ...seat, x: 2, y: 2 }],
    interior: { floor: '#c9a47e', floorAlt: '#bf9872', floorPattern: 'planks', wall: '#f3dcb8', wallTop: '#8a5a3b', trim: '#6b3f2a', doorY: 0, ambient: 'bright' },
  };
  const occ: Occupant[] = occupied
    ? seatSpots(scene.objects[0], scene).map((spot, k) => ({
        memberId: `m${k}`,
        x: spot.x,
        y: spot.y,
        facing: spot.facing,
        sittingOn: seat.id,
        status: 'available',
        avatar: looks[k % looks.length],
        via: 'sim',
      }))
    : [];
  const view = new WorldView(holder, { onGroundClick: noop, onActorClick: noop, onObjectClick: noop, onObjectActivate: noop, nameOf: () => '' });
  view.loadScene(scene, occ, { meId: '', activeDecor: new Set(), festiveRooms: new Set(), party: false });
  const v = view as unknown as { camera: { zoom: number; tzoom: number; x: number; y: number; tx: number; ty: number }; update(dt: number): void; draw(): void; drawActorOverlays(): void };
  const w = seat.w ?? 1;
  const d = seat.d ?? 1;
  const c = isoToScreen(2 + w / 2, 2 + d / 2);
  v.camera.zoom = v.camera.tzoom = zoom;
  v.camera.x = v.camera.tx = c.x;
  v.camera.y = v.camera.ty = c.y - 18;
  v.drawActorOverlays = noop;
  v.update(0);
  v.camera.x = c.x;
  v.camera.y = c.y - 18;
  v.draw();
  into.drawImage(holder, ox, oy, cw, ch);
  view.destroy();
  holder.remove();
}

/** Seat sheet: every seat kind (rows) × facing (columns), occupied, plus the empty seat. */
async function seatSheet(o: { zoom?: number; name?: string; looks?: AvatarLoadout[] } = {}) {
  const zoom = o.zoom ?? 4;
  const cw = 200;
  const ch = 220;
  const cols = FACINGS.length * 2;
  const canvas = freshCanvas(cw * cols, ch * SEATS.length + 30);
  canvas.width = cw * cols;
  canvas.height = ch * SEATS.length + 30;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#1b1623';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#f6ead6';
  ctx.font = '14px system-ui';
  FACINGS.forEach((f, i) => {
    ctx.fillText(`${f} (sitting)`, i * 2 * cw + 8, 20);
    ctx.fillText(`${f} (empty)`, (i * 2 + 1) * cw + 8, 20);
  });
  const looks = o.looks ?? seed.members.map((m) => m.avatar);
  SEATS.forEach((s, row) => {
    FACINGS.forEach((f, col) => {
      const across = f === 'ne' || f === 'sw';
      const seat: SceneObject = { id: `s-${row}-${col}`, sprite: s.sprite, variant: s.variant, facing: f, x: 2, y: 2, w: s.long && across ? 2 : 1, d: s.long && !across ? 2 : 1, actions: [{ kind: 'sit' }] };
      // a different sitter per row: rotate the cast (a slice runs dry once there are more rows than people)
      const r = (row * 3) % looks.length;
      seatCell(ctx, seat, true, col * 2 * cw, 30 + row * ch, cw, ch, zoom, [...looks.slice(r), ...looks.slice(0, r)]);
      seatCell(ctx, seat, false, (col * 2 + 1) * cw, 30 + row * ch, cw, ch, zoom, looks);
      ctx.fillStyle = '#f6ead6';
      ctx.fillText(`${s.sprite}${s.variant ? '.' + s.variant : ''}`, col * 2 * cw + 6, 30 + row * ch + 16);
    });
  });
  return snap(canvas, o.name ?? 'seat-sheet');
}

/**
 * Film strip: a real room stepped through time, one frame every `dt` seconds, cropped around an object —
 * to judge animation in a single image.
 */
async function film(sceneId: string, objectId: string, o: { frames?: number; dt?: number; zoom?: number; size?: number; name?: string; before?: (v: unknown) => void } = {}) {
  const scene = getScene(sceneId);
  const ob = scene?.objects.find((x) => x.id === objectId || x.sprite === objectId);
  if (!scene || !ob) throw new Error(`no ${objectId} in ${sceneId}`);
  const frames = o.frames ?? 6;
  const zoom = o.zoom ?? 4;
  const size = o.size ?? 60; // world px around the object
  const cell = size * zoom;
  const canvas = freshCanvas(900, 700);
  const sheet = document.createElement('canvas');
  sheet.width = cell * frames;
  sheet.height = cell;
  const sc = sheet.getContext('2d')!;
  sc.imageSmoothingEnabled = false;
  const view = new WorldView(canvas, { onGroundClick: noop, onActorClick: noop, onObjectClick: noop, onObjectActivate: noop, nameOf: () => '' });
  view.loadScene(scene, [], { meId: '', activeDecor: new Set(), festiveRooms: new Set(), party: false });
  const v = view as unknown as { camera: { zoom: number; tzoom: number; x: number; y: number; tx: number; ty: number }; update(dt: number): void; draw(): void; drawActorOverlays(): void; dpr: number };
  v.drawActorOverlays = noop;
  o.before?.(view);
  const c = isoToScreen(ob.x + (ob.w ?? 1) / 2, ob.y + (ob.d ?? 1) / 2, (ob.z ?? 0) + 18);
  for (let f = 0; f < frames; f++) {
    for (let k = 0; k < 6; k++) v.update((o.dt ?? 0.5) / 6);
    v.camera.zoom = v.camera.tzoom = zoom;
    v.camera.x = v.camera.tx = c.x;
    v.camera.y = v.camera.ty = c.y;
    v.draw();
    const dpr = window.devicePixelRatio || 1;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    sc.drawImage(canvas, cx - (cell * dpr) / 2, cy - (cell * dpr) / 2, cell * dpr, cell * dpr, f * cell, 0, cell, cell);
  }
  view.destroy();
  return snap(sheet, o.name ?? `film-${sceneId}-${ob.sprite}`);
}

/**
 * The sit-down / stand-up motion, filmed: someone walks up to a seat and onto its cushion, the server's "sat"
 * arrives a moment later, they sit a while, then stand and step off onto the floor. One frame every `dt` ms
 * on a fake clock (the lab tab may be hidden, so nothing waits on real frames).
 */
async function sitFilm(
  sprite: string,
  variant: string | undefined,
  facing: Facing,
  o: { zoom?: number; dt?: number; name?: string; look?: AvatarLoadout; long?: boolean; from?: 'front' | 'behind' | 'side' } = {},
) {
  const zoom = o.zoom ?? 4;
  const dt = o.dt ?? 40;
  const across = facing === 'ne' || facing === 'sw';
  const seat: SceneObject = { id: 'seat', sprite, variant, facing, x: 3, y: 3, w: o.long && across ? 2 : 1, d: o.long && !across ? 2 : 1, actions: [{ kind: 'sit' }] };
  const scene: SceneDef = {
    id: 'film',
    kind: 'interior',
    name: 'film',
    width: 8,
    height: 8,
    tiles: Array.from({ length: 8 }, () => '........'),
    spawn: { x: 0, y: 0 },
    objects: [seat],
    interior: { floor: '#c9a47e', floorAlt: '#bf9872', floorPattern: 'planks', wall: '#f3dcb8', wallTop: '#8a5a3b', trim: '#6b3f2a', doorY: 0, ambient: 'bright' },
  };
  const spot = seatSpots(seat, scene)[0];
  const v4: Record<Facing, [number, number]> = { se: [1, 0], sw: [0, 1], ne: [0, -1], nw: [-1, 0] };
  const [fx, fy] = v4[facing];
  // the way up to the cushion: from in front of it, from behind it, or along its side (a couch's free end)
  const [sx, sy] = o.from === 'behind' ? [-fx, -fy] : o.from === 'side' ? ((seat.w ?? 1) > 1 ? [-1, 0] : (seat.d ?? 1) > 1 ? [0, -1] : [fy, fx]) : [fx, fy];
  const path: Array<[number, number]> = [[spot.x + 2 * sx, spot.y + 2 * sy], [spot.x + sx, spot.y + sy], [spot.x, spot.y]];
  const realNow = performance.now.bind(performance);
  const realDate = Date.now;
  let t = 1_000_000;
  performance.now = () => t;
  Date.now = () => t;
  const frames: HTMLCanvasElement[] = [];
  const cellW = 90 * zoom;
  const cellH = 110 * zoom;
  const canvas = freshCanvas(900, 700);
  try {
    const view = new WorldView(canvas, { onGroundClick: noop, onActorClick: noop, onObjectClick: noop, onObjectActivate: noop, nameOf: () => '' });
    const look = o.look ?? seed.members[0].avatar;
    view.loadScene(scene, [{ memberId: 'm', x: path[0][0], y: path[0][1], facing, status: 'available', avatar: look, via: 'sim' }], { meId: '', activeDecor: new Set(), festiveRooms: new Set(), party: false });
    const v = view as unknown as { camera: { zoom: number; tzoom: number; x: number; y: number; tx: number; ty: number }; update(dt: number): void; draw(): void; drawActorOverlays(): void };
    v.drawActorOverlays = noop;
    const c = isoToScreen(spot.x + 0.5, spot.y + 0.5, 16);
    const shoot = () => {
      v.update(dt / 1000);
      v.camera.zoom = v.camera.tzoom = zoom;
      v.camera.x = v.camera.tx = c.x;
      v.camera.y = v.camera.ty = c.y;
      v.draw();
      const f = document.createElement('canvas');
      f.width = cellW;
      f.height = cellH;
      const dpr = window.devicePixelRatio || 1;
      f.getContext('2d')!.drawImage(canvas, canvas.width / 2 - (cellW * dpr) / 2, canvas.height / 2 - (cellH * dpr) / 2, cellW * dpr, cellH * dpr, 0, 0, cellW, cellH);
      frames.push(f);
    };
    const walkMs = ((path.length - 1) / 4.2) * 1000;
    view.move('m', path, t);
    const run = (ms: number) => {
      for (const end = t + ms; t < end; ) {
        t += dt;
        shoot();
      }
    };
    run(walkMs - 3 * dt); // the last steps of the walk
    run(3 * dt + 80); // arrived: crouch, into the seat (the server hasn't said yet)
    view.patch('m', { x: spot.x, y: spot.y, sittingOn: seat.id, facing: spot.facing, path: undefined });
    run(240); // seated
    let at = spot;
    const next = seatSpots(seat, scene)[1];
    if (next) {
      // shift over to the next cushion
      view.move('m', [[spot.x, spot.y], [next.x, next.y]], t);
      run(280);
      view.patch('m', { x: next.x, y: next.y, sittingOn: seat.id, facing: next.facing, path: undefined });
      run(160);
      at = next;
    }
    view.patch('m', { sittingOn: undefined, x: at.x + fx, y: at.y + fy }); // stood up, put on the floor in front
    run(520);
    view.destroy();
  } finally {
    performance.now = realNow;
    Date.now = realDate;
  }
  const cols = Math.min(frames.length, 10);
  const rows = Math.ceil(frames.length / cols);
  const sheet = document.createElement('canvas');
  sheet.width = cols * cellW;
  sheet.height = rows * cellH;
  const sc = sheet.getContext('2d')!;
  sc.fillStyle = '#1b1623';
  sc.fillRect(0, 0, sheet.width, sheet.height);
  frames.forEach((f, i) => sc.drawImage(f, (i % cols) * cellW, Math.floor(i / cols) * cellH));
  return snap(sheet, o.name ?? `sitfilm-${sprite}${variant ? '.' + variant : ''}-${facing}${o.from && o.from !== 'front' ? '-' + o.from : ''}`);
}


const ready = loadArt().then(clearSpriteCache);
const flab = {
  ready,
  sky: setSkyOverride,
  seatScene,
  /** Every seat type × facing, occupied. */
  seats: async (o: Opts = {}) => {
    await ready;
    const scene = seatScene();
    return render(scene, sitters(scene, o.looks ?? seed.members.map((m) => m.avatar)), o, 'seats');
  },
  /** Every seat kind × facing in its own cell, occupied and empty. */
  seatSheet: async (o?: Parameters<typeof seatSheet>[0]) => {
    await ready;
    return seatSheet(o);
  },
  /** Walk up, sit down, stand up, step off: the seat motion frame by frame. */
  sitFilm: async (sprite: string, variant: string | undefined, facing: Facing, o?: Parameters<typeof sitFilm>[3]) => {
    await ready;
    return sitFilm(sprite, variant, facing, o);
  },
  /** One seat with its rig looks on every cushion, at zoom 2, for diffing against the rig compositor. */
  /** Film strip of an object's animation in a room. */
  film: async (sceneId: string, objectId: string, o?: Parameters<typeof film>[2]) => {
    await ready;
    return film(sceneId, objectId, o);
  },
  /** A real room with someone on every seat. */
  room: async (id: string, o: Opts = {}) => {
    await ready;
    const scene = getScene(id);
    if (!scene) throw new Error(`no scene ${id}`);
    return render(scene, sitters(scene, o.looks ?? seed.members.map((m) => m.avatar)), o, `seats-${id}`);
  },
  /** An arbitrary scene with given occupants. */
  scene: async (scene: SceneDef, occupants: Occupant[], o: Opts = {}) => {
    await ready;
    return render(scene, occupants, o, scene.id);
  },
  getScene,
  reloadArt: async () => {
    await loadArt();
    clearSpriteCache();
  },
  seed,
};
(window as unknown as { flab: typeof flab }).flab = flab;
document.title = 'Minglewood — furniture lab (ready)';
