/**
 * Seat shots (dev only): one seat kind in all four facings with someone on every cushion, drawn through the real
 * WorldView, one PNG per facing, so seating can be judged the way it's played. Driven by scripts/seat-shots.ts:
 *   await lab.seatShots({ key: 'couch.green', zoom: 2 })  // → { se: dataURL, sw: …, ne: …, nw: … }
 */
import type { AvatarLoadout } from '@shared/domain/types';
import type { Occupant } from '@shared/protocol';
import { getScene } from '@shared/world';
import { isSeat, type Facing } from '@shared/world/scene';
import { seatSpots } from '@shared/world/seats';
import { WorldView } from '../engine/WorldView';
import { setSeatModelsEnabled } from '../engine/sprites/art';
import { avatarSprite, type Pose } from '../engine/sprites/avatar';
import { blit } from '../engine/sprites/painter';

export interface SeatShotOpts {
  key: string;
  /** CSS px per art px: 2 is play scale (one drawing px per screen px). */
  zoom?: number;
  /** Looks, one per sitter in turn (cycled). */
  looks: AvatarLoadout[];
  /** The member ids to seat under those looks (cycled with them). */
  ids: string[];
  /** Canvas size per shot, CSS px. */
  size?: [number, number];
  /** Empty seats (no sitters), to compare. */
  empty?: boolean;
  /** Which cushions to fill (default all). */
  cushions?: number[];
  /** Only these facings. */
  facings?: Facing[];
  /** Stand everyone on their cushion's tile instead of seating them (the moment before sitting or stepping off). */
  standing?: boolean;
  /** Draw seats by their 3D models (on) or their rigs (off); default: as the game does. */
  models?: boolean;
  /** Freeze optional game effects through the real accessibility setting for repeatable pixel capture. */
  reducedMotion?: boolean;
}

const noop = () => undefined;

/** Kit figures (looks × facings × poses) on a plain ground at an integer zoom, as one PNG data URL. */
export function figureSheet(o: { looks: AvatarLoadout[]; facings?: Facing[]; poses: Pose[]; zoom?: number }): string {
  const Z = o.zoom ?? 4;
  const facings = o.facings ?? ['se', 'sw', 'ne', 'nw'];
  const cw = 50 * Z;
  const ch = 60 * Z;
  const cols = facings.length * o.poses.length;
  const canvas = document.createElement('canvas');
  canvas.width = cols * cw;
  canvas.height = o.looks.length * ch;
  const c = canvas.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  c.fillStyle = '#cdb89a';
  c.fillRect(0, 0, canvas.width, canvas.height);
  o.looks.forEach((L, r) =>
    o.poses.forEach((p, pi) =>
      facings.forEach((f, fi) => {
        const col = pi * facings.length + fi;
        c.setTransform(Z, 0, 0, Z, col * cw + cw / 2, r * ch + ch - 6 * Z);
        c.fillStyle = 'rgba(40,30,50,0.25)';
        c.beginPath();
        c.ellipse(0, 0, 8, 4, 0, 0, Math.PI * 2);
        c.fill();
        blit(c, avatarSprite(L, f, p), 0, 0);
      }),
    ),
  );
  return canvas.toDataURL('image/png');
}

/**
 * A real room with someone on every cushion of every seat (`fill` of them, 0…1, spread evenly) and nobody else,
 * drawn by the real WorldView at `zoom`, centred on the room (or on tile `at`), `size` CSS px.
 */
export function roomShot(o: {
  sceneId: string;
  looks: AvatarLoadout[];
  ids: string[];
  zoom?: number;
  size?: [number, number];
  at?: [number, number];
  fill?: number;
  /** Also crop the picture round every seat (CSS px): returns { images: { name: dataURL } }. */
  crops?: [number, number];
}): string | { images: Record<string, string> } {
  const scene = getScene(o.sceneId);
  if (!scene) throw new Error(`no scene ${o.sceneId}`);
  const [cw, ch] = o.size ?? [1400, 900];
  const canvas = document.createElement('canvas');
  canvas.style.width = `${cw}px`;
  canvas.style.height = `${ch}px`;
  document.body.replaceChildren(canvas);
  const occupants: Occupant[] = [];
  const fill = o.fill ?? 1;
  let n = 0;
  let k = 0;
  for (const s of scene.objects.filter(isSeat))
    for (const spot of seatSpots(s, scene)) {
      k++;
      if (Math.floor(k * fill) === Math.floor((k - 1) * fill)) continue;
      const i = n++;
      occupants.push({ memberId: o.ids[i % o.ids.length] + (i >= o.ids.length ? `-${i}` : ''), x: spot.x, y: spot.y, facing: spot.facing, sittingOn: s.id, status: 'available', avatar: o.looks[i % o.looks.length], via: 'sim' });
    }
  const view = new WorldView(canvas, { onGroundClick: noop, onActorClick: noop, onObjectClick: noop, onObjectActivate: noop, nameOf: () => '' });
  view.loadScene(scene, occupants, { meId: '', activeDecor: new Set(), festiveRooms: new Set(), party: false });
  view.destroy();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v = view as any;
  v.drawActorOverlays = noop;
  v.update(0.016);
  if (o.zoom) {
    const [tx, ty] = o.at ?? [scene.width / 2, scene.height / 2];
    v.camera.x = v.camera.tx = Math.round((tx - ty) * 16);
    v.camera.y = v.camera.ty = Math.round((tx + ty) * 8 - 16);
    v.camera.zoom = v.camera.tzoom = o.zoom;
  }
  v.draw();
  if (!o.crops) return canvas.toDataURL('image/png');
  const images: Record<string, string> = { room: canvas.toDataURL('image/png') };
  const [w, h] = o.crops;
  const z = v.camera.zoom;
  for (const s of scene.objects.filter(isSeat)) {
    const cx = s.x + (s.w ?? 1) / 2;
    const cy = s.y + (s.d ?? 1) / 2;
    // centred on the seat and drawn again (a town is bigger than one picture)
    v.camera.x = v.camera.tx = Math.round((cx - cy) * 16);
    v.camera.y = v.camera.ty = Math.round((cx + cy) * 8 - 14);
    v.draw();
    const sx = cw / 2 + ((cx - cy) * 16 - v.camera.x) * z;
    const sy = ch / 2 + ((cx + cy) * 8 - 14 - v.camera.y) * z;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d')!.drawImage(canvas, Math.round(sx - w / 2), Math.round(sy - h / 2), w, h, 0, 0, w, h);
    images[`${s.id}.${s.sprite}${s.variant ? '.' + s.variant : ''}.${s.facing ?? 'auto'}`] = c.toDataURL('image/png');
  }
  return { images };
}

/** What the renderer works out for each sitter of a seat lab room (debugging the seat pipeline). */
export function seatDebug(o: SeatShotOpts): unknown {
  const scene = getScene(`seatlab-${o.key}`)!;
  const canvas = document.createElement('canvas');
  canvas.style.width = '400px';
  canvas.style.height = '300px';
  document.body.replaceChildren(canvas);
  const occupants: Occupant[] = [];
  let n = 0;
  for (const s of scene.objects.filter(isSeat))
    for (const spot of seatSpots(s, scene)) {
      const i = n++;
      occupants.push({ memberId: o.ids[i % o.ids.length], x: spot.x, y: spot.y, facing: spot.facing, sittingOn: s.id, status: 'available', avatar: o.looks[i % o.looks.length], via: 'sim' });
    }
  const view = new WorldView(canvas, { onGroundClick: noop, onActorClick: noop, onObjectClick: noop, onObjectActivate: noop, nameOf: () => '' });
  view.loadScene(scene, occupants, { meId: '', activeDecor: new Set(), festiveRooms: new Set(), party: false });
  view.destroy();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v = view as any;
  v.update(0.016);
  v.buildDrawOrder();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return [...v.actors.values()].map((a: any) => {
    const st = a.onSeat ? v.staticOf(a.onSeat.id) : null;
    return { id: a.occ.memberId, pose: v.pose(a), legs: v.legsOf(a), lift: a.lift, at: a.at, onSeat: a.onSeat, st: st && { dx: st.dx, dy: st.dy }, model: !!(a.onSeat && v.modelOf(v.objById(a.onSeat.id), a.onSeat.facing)) };
  });
}

export async function seatShots(o: SeatShotOpts, capture?: (view: WorldView, objectId: string) => void): Promise<Partial<Record<Facing, string>>> {
  const scene = getScene(`seatlab-${o.key}`);
  if (!scene) throw new Error(`no seat lab for ${o.key}`);
  const zoom = o.zoom ?? 2;
  const [cw, ch] = o.size ?? [96 * zoom, 90 * zoom];
  document.body.replaceChildren();
  const canvas = document.createElement('canvas');
  canvas.style.width = `${cw}px`;
  canvas.style.height = `${ch}px`;
  document.body.append(canvas);
  const occupants: Occupant[] = [];
  if (!o.empty) {
    let n = 0;
    for (const s of scene.objects.filter(isSeat))
      for (const spot of seatSpots(s, scene)) {
        if (o.facings && !o.facings.includes(s.facing!)) continue;
        if (o.cushions && !o.cushions.includes(spot.index)) continue;
        const i = n++;
        occupants.push({
          memberId: o.ids[i % o.ids.length],
          x: spot.x,
          y: spot.y,
          facing: spot.facing,
          sittingOn: o.standing ? undefined : s.id,
          status: 'available',
          avatar: o.looks[i % o.looks.length],
          via: 'sim',
        });
      }
  }
  if (o.models !== undefined) setSeatModelsEnabled(o.models);
  const view = new WorldView(canvas, { onGroundClick: noop, onActorClick: noop, onObjectClick: noop, onObjectActivate: noop, nameOf: () => '' });
  view.loadScene(scene, occupants, { meId: '', activeDecor: new Set(), festiveRooms: new Set(), party: false });
  const v = view as unknown as {
    camera: { x: number; y: number; zoom: number; tx: number; ty: number; tzoom: number };
    reducedMotion: boolean;
    update(dt: number): void;
    draw(): void;
    drawActorOverlays(): void;
  };
  if (o.reducedMotion !== undefined) v.reducedMotion = o.reducedMotion;
  v.drawActorOverlays = noop;
  // no frame loop: every shot is drawn on demand
  view.destroy();
  const out: Partial<Record<Facing, string>> = {};
  for (const s of scene.objects.filter(isSeat)) {
    if (o.facings && !o.facings.includes(s.facing!)) continue;
    const cx = s.x + (s.w ?? 1) / 2;
    const cy = s.y + (s.d ?? 1) / 2;
    const ax = (cx - cy) * 16;
    const ay = (cx + cy) * 8 - 14;
    v.camera.x = v.camera.tx = Math.round(ax);
    v.camera.y = v.camera.ty = Math.round(ay);
    v.camera.zoom = v.camera.tzoom = zoom;
    v.update(0.016);
    v.camera.x = v.camera.tx = Math.round(ax);
    v.camera.y = v.camera.ty = Math.round(ay);
    v.camera.zoom = v.camera.tzoom = zoom;
    v.draw();
    out[s.facing!] = canvas.toDataURL('image/png');
    capture?.(view, s.id);
  }
  return out;
}
