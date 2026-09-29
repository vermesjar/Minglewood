/**
 * WorldView renders one scene and turns pointer input into intents. It owns no product logic:
 * the Game controller decides what a click means (walk, open a profile, enter a building).
 */
import type { AvatarLoadout } from '@shared/domain/types';
import type { Occupant } from '@shared/protocol';
import { EMOTES, STATUS_META, type EmoteId } from '@shared/presence';
import { isoToScreen, screenToIso } from '@shared/iso';
import type { Facing, NpcDef, SceneDef, SceneObject } from '@shared/world/scene';
import type { BoardNote, MomentKind, NpcState } from '@shared/protocol';
import { carryMeta } from '@shared/carry';
import { footprint, isSeat } from '@shared/world/scene';
import { BACK_COVER_UP, SIT_DROP, SIT_POSE_OF, seatFacing, seatSpots, seenFromBehind, sitterLift, sitterPoint, type SeatProfile, type SeatSpot } from '@shared/world/seats';
import { pathLength, positionAlong, WALK_SPEED, type Tile } from '@shared/world/pathfinding';
import { Camera } from './camera';
import { behind, rectsOverlap, topoSort, type Box, type ScreenRect } from './depth';
import { Effects } from './effects';
import { renderOutdoorGround, type GroundLayer } from './ground';
import { renderInteriorShell, type InteriorLayer } from './interior';
import { skyAt, windowView, type Sky } from './weather';
import { drawSurroundings, skyColor } from './surroundings';
import { artLight, artSeatProfile } from './sprites/art';
import { backrestMask, mirrorLine } from './sprites/seatFit';
import { ObjectAnimations } from './animations';
import { INK_CSS, PAPER, UI_FONT, drawBubble, layoutBubbles, pill, roundRect, type BubbleSpec, type Rect } from './overlays';
import { AVATAR_CROPS, avatarSprite, usesWheelchair, type Expression, type Pose } from './sprites/avatar';
import { festiveFor, spriteFor } from './sprites/registry';
import { blit, highlightOf, spriteSize, type Sprite } from './sprites/painter';

export interface BuildingBadge {
  name: string;
  emoji: string;
  count: number;
  faces: AvatarLoadout[];
  event?: string;
  openCount: number;
}

export interface WorldCallbacks {
  onGroundClick(tile: Tile): void;
  onActorClick(memberId: string, screen: { x: number; y: number }): void;
  onObjectClick(obj: SceneObject, screen: { x: number; y: number }): void;
  onObjectActivate(obj: SceneObject): void;
  onHover?(label: string | null): void;
  onHoverTile?(tile: Tile | null): void;
  nameOf(memberId: string): string;
}

interface Static {
  obj: SceneObject;
  sprite: Sprite;
  dx: number; // art-space draw position
  dy: number;
  box: Box;
  rect: ScreenRect;
  festive: Sprite | null;
}

interface ActorView {
  occ: Occupant;
  x: number;
  y: number;
  facing: Facing;
  moving: boolean;
  walkClock: number;
  bubble?: { text: string; start: number; until: number };
  emotes: Array<{ emoji: string; start: number }>;
  waveUntil: number;
  /** Briefly working something they used (the jukebox, the cue, the watering can). */
  workUntil?: number;
  /** Set for a room NPC (a barista): who they are, what they're doing and what's in their hands. */
  npc?: { def: NpcDef; doing?: NpcState['doing']; holding?: string };
  /** Character life: an emote gesture playing, a quiet idle moment, and when the next one may come. */
  act?: { kind: ActKind; start: number; until: number };
  idle?: { kind: 'shift' | 'glance' | 'phone'; start: number; until: number; facing?: Facing };
  nextIdleAt: number;
  /** Per-person dance timing (a phase and a tempo), so a room never dances in unison. */
  groove: { phase: number; tempo: number; dances: boolean };
  /**
   * Into or out of a seat (the seat standard): which seat and cushion, and how far in — 0 standing … 1 seated —
   * easing from `from` to `to` since `start`. Set on arriving at a cushion (before the server confirms),
   * cleared once they've stood up.
   */
  seat?: {
    objId: string;
    spot: { x: number; y: number; facing: Facing };
    from: number;
    to: number;
    start: number;
  };
  /** How high the figure was lifted when last drawn (world px; a seat's lift, a stage's). */
  lift?: number;
  /** After standing up: the step from the seat's tile onto the floor where the server put them. */
  stepOff?: { x: number; y: number; start: number; objId: string };
  /** Moved along a seat without a walk (the server shifted them a cushion over): the slide from where they were. */
  glide?: { x: number; y: number; start: number; ms: number };
  /** Next idle blink (performance.now ms) and when the current one ends. */
  blinkAt: number;
  blinkUntil: number;
  rect: ScreenRect;
  sx: number;
  sy: number;
}

type ActKind = 'clap' | 'cheer' | 'laugh' | 'thumbs' | 'heart' | 'idea' | 'dance';

/** Which emotes the body acts out, and for how long (ms). */
const EMOTE_ACT: Partial<Record<EmoteId, { kind: ActKind; ms: number }>> = {
  clap: { kind: 'clap', ms: 1500 },
  celebrate: { kind: 'cheer', ms: 1500 },
  laugh: { kind: 'laugh', ms: 1300 },
  thumbs: { kind: 'thumbs', ms: 1300 },
  heart: { kind: 'heart', ms: 1500 },
  idea: { kind: 'idea', ms: 1300 },
  dance: { kind: 'dance', ms: 8000 },
};

/** A person's own groove, stable per member: most dance at a party, each at their own phase and tempo. */
function grooveOf(memberId: string) {
  let h = 2166136261;
  for (let i = 0; i < memberId.length; i++) h = Math.imul(h ^ memberId.charCodeAt(i), 16777619);
  const u = (k: number) => ((h >>> k) & 255) / 255;
  return { phase: u(0) * 4, tempo: 3.2 + u(8) * 1.4, dances: u(16) < 0.75 };
}

const facingFrom = (dx: number, dy: number, prev: Facing): Facing => {
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return prev;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'se' : 'nw';
  return dy > 0 ? 'sw' : 'ne';
};

/**
 * Getting into and out of a seat (the seat standard, src/shared/world/seats.ts): turn to the seat's facing,
 * crouch, then into the seat, settling the last couple of px; standing up is the reverse, then a step off onto
 * the floor. Milliseconds; the crouch holds the first part of the way in (the last part of the way out).
 */
const SIT_DOWN_MS = 180;
const STAND_UP_MS = 150;
const STEP_OFF_MS = 260;
const CROUCH_UNTIL = 0.35;
/** How far above the cushion (world px) a sitter is as they start to settle into it. */
const SETTLE = 2;
/**
 * A sit the server hasn't confirmed by now didn't happen (someone else took the cushion): stand back up.
 * (The sitter's own client walks them off the cushion a little before this — game.ts SIT_CONFIRM_MS.)
 */
const SIT_UNCONFIRMED_MS = 2200;

/**
 * Seen from behind, the part of a seat's drawing that covers its sitter — all of it but the cushion behind
 * them (seatFit.backrestMask) — worked out once per drawing.
 */
const backrests = new WeakMap<Sprite, HTMLCanvasElement | null>();
function backrestOverlay(sp: Sprite, o: SceneObject, facing: Facing, profile: SeatProfile): HTMLCanvasElement | null {
  if (backrests.has(sp)) return backrests.get(sp)!;
  let out: HTMLCanvasElement | null = null;
  // the seat maths works in the art's own px (2× density); a classic sprite just keeps its sitter in front
  if ((sp.scale ?? 1) === 2) {
    const W = sp.canvas.width;
    const H = sp.canvas.height;
    const src = sp.canvas.getContext('2d')!.getImageData(0, 0, W, H);
    // a backrest line is traced on the drawn back view; this drawing may be its mirror
    const partner = facing === 'ne' ? 'nw' : 'ne';
    const drawn = sp.mirrored ? profile.backLine?.[partner] : profile.backLine?.[facing as 'ne' | 'nw'];
    const line = drawn && sp.mirrored ? mirrorLine(drawn, W) : drawn;
    const mask = backrestMask({ px: { w: W, h: H, d: src.data }, ax: sp.ax, ay: sp.ay }, o.w ?? 1, o.d ?? 1, profile, facing as 'ne' | 'nw', line);
    const img = new ImageData(W, H);
    for (let i = 0; i < mask.length; i++) if (mask[i]) img.data.set(src.data.subarray(i * 4, i * 4 + 4), i * 4);
    out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    out.getContext('2d')!.putImageData(img, 0, 0);
  }
  backrests.set(sp, out);
  return out;
}
/**
 * The light by time of day and weather, indoors and out alike. The scene is multiplied by `mul` — nearly
 * neutral, so colours keep their hue and saturation and only their value drops — then the air's own colour,
 * `amb` (the blue-purple of a night sky, the rose of dusk), is screened over it, lifting the shadows toward it.
 * Lamps cut warm pools out of the dimming. Indoors the same light falls, less deep (INDOOR_DEPTH): the rooms
 * have their lamps on; outside at night the street lamps and lit windows carry the picture.
 */
interface Mood {
  mul: [number, number, number];
  amb?: [number, number, number];
}
const MOODS: Record<string, Mood | undefined> = {
  night: { mul: [0.4, 0.41, 0.5], amb: [18, 13, 42] },
  dusk: { mul: [0.9, 0.77, 0.72], amb: [22, 8, 30] },
  dawn: { mul: [1, 0.93, 0.9], amb: [8, 4, 12] },
  rain: { mul: [0.86, 0.88, 0.93] },
  clouds: { mul: [0.96, 0.96, 0.98] },
};
const INDOOR_DEPTH = 0.62;
/** How dark it is outside, by phase (effects: beacons, the lighthouse beam). */
const NIGHTNESS: Record<Sky['phase'], number> = { night: 1, dusk: 0.6, dawn: 0.3, day: 0 };
/** How strongly lit windows show outdoors, by phase. */
const GLOW_ALPHA: Record<Sky['phase'], number> = { night: 0.9, dusk: 0.6, dawn: 0.25, day: 0 };

/**
 * Trees (and potted plants near windows) sway in the breeze: the drawing is cut into three horizontal bands
 * and the upper ones shift by whole sprite pixels on a slow, per-object sine — the trunk never moves, the
 * crown leans by at most a pixel or two, so it stays crisp.
 */
function swayOf(o: SceneObject, t: number): number {
  if (!o.sprite.startsWith('tree')) return 0;
  const phase = o.x * 1.37 + o.y * 0.71;
  const v = Math.sin(t * 0.55 + phase) + 0.35 * Math.sin(t * 1.3 + phase * 2);
  return v > 0.75 ? 1 : v < -0.75 ? -1 : 0;
}

function drawSwaying(c: CanvasRenderingContext2D, sp: Sprite, x: number, y: number, dir: number) {
  const k = sp.scale ?? 1;
  const w = sp.canvas.width;
  const h = sp.canvas.height;
  const x0 = x - sp.ax / k;
  const y0 = y - sp.ay / k;
  const cut1 = Math.round(h * 0.34); // crown top: moves 2 px
  const cut2 = Math.round(h * 0.62); // crown middle: moves 1 px; below: the trunk, still
  c.drawImage(sp.canvas, 0, 0, w, cut1, x0 + (2 * dir) / k, y0, w / k, cut1 / k);
  c.drawImage(sp.canvas, 0, cut1, w, cut2 - cut1, x0 + dir / k, y0 + cut1 / k, w / k, (cut2 - cut1) / k);
  c.drawImage(sp.canvas, 0, cut2, w, h - cut2, x0, y0 + cut2 / k, w / k, (h - cut2) / k);
}

/** Lights that are flames, not bulbs: they flicker on their own. */
const FIRE_LIGHTS = new Set(['fireplace', 'heirloom-dragonlamp', 'fire-ring', 'garden-lantern']);

export class WorldView {
  readonly camera = new Camera();
  readonly effects = new Effects();
  /** Living furniture: steam, koi, flames, LEDs (animations.ts). */
  private readonly anims = new ObjectAnimations(this.effects, (id) => this.isOn(id));
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private vw = 0;
  private vh = 0;
  private scene: SceneDef | null = null;
  private ground: GroundLayer | InteriorLayer | null = null;
  /** Scratch layer for the room's dimness with lamp-shaped holes. */
  private shade: HTMLCanvasElement | null = null;
  /** Switch states of toggleable things in this scene (lamps); absent = the object's default. */
  private objStates = new Map<string, boolean>();

  setObjStates(states: Record<string, boolean> | undefined) {
    this.objStates = new Map(Object.entries(states ?? {}));
  }

  setObjState(id: string, on: boolean) {
    this.objStates.set(id, on);
  }

  isOn(id: string): boolean {
    const known = this.objStates.get(id);
    if (known !== undefined) return known;
    const o = this.scene?.objects.find((x) => x.id === id);
    const t = o?.actions?.find((a) => a.kind === 'toggle');
    return t && t.kind === 'toggle' ? (t.on ?? true) : true;
  }
  private statics: Static[] = [];
  private actors = new Map<string, ActorView>();
  private meId = '';
  private serverOffset = 0;
  private hover: { kind: 'actor' | 'object'; id: string } | null = null;
  private selectedActor: string | null = null;
  private dest: { x: number; y: number; t: number } | null = null;
  private badges = new Map<string, BuildingBadge>();
  private badgeRects: Array<{ r: { x: number; y: number; w: number; h: number }; obj: SceneObject }> = [];
  private festiveRooms = new Set<string>();
  private stageBoxes: Box[] = [];
  /** A party is on in this room: people standing about dance. */
  private party = false;
  private raf = 0;
  private last = performance.now();
  private pointer = { down: false, x: 0, y: 0, sx: 0, sy: 0, moved: false, id: -1 };
  private hoverTile: Tile | null = null;
  private ghost: { obj: SceneObject; valid: boolean } | null = null;
  private transition: { phase: 'close' | 'hold' | 'open'; t: number; mid?: () => void | Promise<unknown> } | null = null;
  private resizeObs: ResizeObserver;
  reducedMotion = false;
  showAllNames = false;
  /** Screen space covered by UI panels, so framing centers on what's actually visible. */
  private insets = { left: 0, right: 0, top: 60, bottom: 80 };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly cb: WorldCallbacks,
  ) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(canvas);
    this.resize();
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointerleave', this.onLeave);
    canvas.addEventListener('dblclick', this.onDbl);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    // The world isn't an image to save: no browser context menu over it.
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointerleave', this.onLeave);
    this.canvas.removeEventListener('dblclick', this.onDbl);
    this.canvas.removeEventListener('wheel', this.onWheel);
  }

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.vw = r.width;
    this.vh = r.height;
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
    if (this.scene?.kind === 'interior') this.fitInterior(true);
  }

  /* ------------------------------------------------------------------ scene setup */

  setServerOffset(ms: number) {
    this.serverOffset = ms;
  }

  private now() {
    return Date.now() + this.serverOffset;
  }

  loadScene(
    scene: SceneDef,
    occupants: Occupant[],
    opts: { meId: string; activeDecor: Set<string>; bannerText?: string; festiveRooms: Set<string>; party: boolean },
  ) {
    this.scene = scene;
    this.meId = opts.meId;
    this.festiveRooms = opts.festiveRooms;
    this.party = opts.party;
    this.hover = null;
    this.selectedActor = null;
    this.dest = null;
    this.ground =
      scene.kind === 'outdoor'
        ? renderOutdoorGround(scene, window.devicePixelRatio > 1 || window.innerWidth > 1200 ? 2 : 1)
        : renderInteriorShell(scene, { theme: scene.interior!, activeDecor: opts.activeDecor, bannerText: opts.bannerText });
    const statics: Static[] = [];
    this.stageBoxes = [];
    for (const o of scene.objects) {
      if (o.flat) {
        if (o.sprite === 'stage') this.stageBoxes.push(footprint(o));
        continue;
      }
      if (o.wall) continue;
      if (o.eventDecor && !opts.activeDecor.has(o.eventDecor)) continue;
      // a seat without a facing of its own is drawn the way it's sat in (toward its table, else the room)
      const sprite = spriteFor(isSeat(o) && !o.facing ? { ...o, facing: seatFacing(o, scene) } : o);
      if (!sprite) continue;
      const p = isoToScreen(o.x, o.y, o.z ?? 0);
      const size = spriteSize(sprite);
      const dx = p.x - sprite.ax / (sprite.scale ?? 1);
      const dy = p.y - sprite.ay / (sprite.scale ?? 1);
      statics.push({
        obj: o,
        sprite,
        dx,
        dy,
        box: { ...footprint(o), z: o.z ?? 0 },
        rect: { l: dx, t: dy, r: dx + size.w, b: dy + size.h },
        festive: o.building && o.roomId && this.festiveRooms.has(o.roomId) ? festiveFor(o) : null,
      });
    }
    this.statics = topoSort(statics);
    this.anims.load(this.statics, scene);
    this.anims.loadWalls(scene);
    this.actors.clear();
    for (const o of occupants) this.upsert(o);
    this.effects.reducedMotion = this.reducedMotion;
    this.effects.load(scene, { party: opts.party }, this.statics);
    // the ground's own moving water already sparkles; don't add a second set of glints
    this.effects.glints = !('water' in this.ground && this.ground.water);

    const W = scene.width;
    const H = scene.height;
    const top = isoToScreen(0, 0);
    const left = isoToScreen(0, H);
    const right = isoToScreen(W, 0);
    const bottom = isoToScreen(W, H);
    this.camera.bounds = { l: left.x, r: right.x, t: top.y - 40, b: bottom.y };
    if (scene.kind === 'interior') {
      this.fitInterior(true);
    } else {
      this.camera.minZoom = 1;
      this.camera.maxZoom = 4;
      this.camera.pixelStep = 1 / this.dpr;
      const me = this.actors.get(this.meId);
      const c = me ? isoToScreen(me.x + 0.5, me.y + 0.5) : isoToScreen(scene.spawn.x, scene.spawn.y);
      const z = this.camera.snap(this.vw < 700 ? 1.5 : 2);
      const [sx, sy] = this.insetShift(z);
      this.camera.jump(c.x + sx, c.y - 20 + sy, z);
    }
  }

  setInsets(insets: Partial<{ left: number; right: number; top: number; bottom: number }>) {
    const before = JSON.stringify(this.insets);
    this.insets = { ...this.insets, ...insets };
    if (before !== JSON.stringify(this.insets) && this.scene?.kind === 'interior') this.fitInterior(false);
  }

  /** Horizontal/vertical shift (in art px) that centers content in the uncovered area. */
  private insetShift(z = this.camera.tzoom): [number, number] {
    const { left, right, top, bottom } = this.insets;
    return [(right - left) / 2 / z, (bottom - top) / 2 / z];
  }

  private fitInterior(jump: boolean) {
    const s = this.scene;
    if (!s || s.kind !== 'interior') return;
    const left = isoToScreen(0, s.height).x;
    const right = isoToScreen(s.width, 0).x;
    const top = -62;
    const bottom = isoToScreen(s.width, s.height).y + 10;
    const availW = this.vw - this.insets.left - this.insets.right - 40;
    const availH = this.vh - this.insets.top - this.insets.bottom - 30;
    const zx = availW / (right - left);
    const zy = availH / (bottom - top);
    const fit = Math.max(1, Math.min(4, Math.min(zx, zy)));
    // Rooms are 64-px-per-tile art: pick a zoom where each art pixel is a whole number of device pixels,
    // falling back to half steps only when the crisp choice would leave the room far too small.
    const crisp = 2 / this.dpr;
    const half = 1 / this.dpr;
    this.camera.pixelStep = Math.floor(fit / crisp) * crisp >= fit * 0.72 ? crisp : half;
    const z = this.camera.snap(fit);
    this.camera.minZoom = this.camera.pixelStep;
    this.camera.maxZoom = Math.max(z, 5);
    const [sx, sy] = this.insetShift(z);
    const cx = (left + right) / 2 + sx;
    const cy = (top + bottom) / 2 + sy;
    if (jump) this.camera.jump(cx, cy, z);
    else {
      this.camera.tzoom = z;
      this.camera.panTo(cx, cy);
    }
  }

  setFestive(rooms: Set<string>) {
    this.festiveRooms = rooms;
    for (const s of this.statics) {
      s.festive = s.obj.building && s.obj.roomId && rooms.has(s.obj.roomId) ? festiveFor(s.obj) : null;
    }
  }

  /** Placement preview for decorate mode. */
  setGhost(g: { obj: SceneObject; valid: boolean } | null) {
    this.ghost = g;
  }

  setBadges(b: Map<string, BuildingBadge>) {
    this.badges = b;
  }

  /* ------------------------------------------------------------------ actors */

  upsert(o: Occupant) {
    const existing = this.actors.get(o.memberId);
    if (existing) {
      const was = { on: existing.occ.sittingOn, x: existing.x, y: existing.y };
      existing.occ = { ...existing.occ, ...o };
      if (!o.path) {
        existing.x = o.x;
        existing.y = o.y;
      }
      if (o.facing) existing.facing = o.facing;
      this.seatChanged(existing, was);
      return;
    }
    this.actors.set(o.memberId, {
      occ: o,
      x: o.x,
      y: o.y,
      facing: o.facing,
      moving: false,
      walkClock: 0,
      emotes: [],
      waveUntil: 0,
      blinkAt: performance.now() + 1000 + Math.random() * 5000,
      blinkUntil: 0,
      nextIdleAt: performance.now() + 5000 + Math.random() * 12000,
      groove: grooveOf(o.memberId),
      rect: { l: 0, t: 0, r: 0, b: 0 },
      sx: 0,
      sy: 0,
    });
    // already seated when we arrive: seated, no motion
    const spot = o.sittingOn && !o.path ? this.cushion(o.sittingOn, o.x, o.y) : null;
    if (spot) this.actors.get(o.memberId)!.seat = { objId: o.sittingOn!, spot, from: 1, to: 1, start: 0 };
  }

  remove(memberId: string) {
    this.actors.delete(memberId);
    if (this.selectedActor === memberId) this.selectedActor = null;
  }

  patch(memberId: string, patch: Partial<Occupant>) {
    const a = this.actors.get(memberId);
    if (!a) return;
    const hasPath = 'path' in patch;
    const was = { on: a.occ.sittingOn, x: a.x, y: a.y };
    a.occ = { ...a.occ, ...patch };
    if (hasPath && !patch.path) {
      a.occ.path = undefined;
      a.occ.pathStartedAt = undefined;
    }
    // settled where their walk was going (the server ends the last step when someone orders on arrival)
    const end = a.occ.path?.[a.occ.path.length - 1];
    if (end && end[0] === patch.x && end[1] === patch.y) {
      a.occ.path = undefined;
      a.occ.pathStartedAt = undefined;
      a.moving = false;
    }
    if (patch.x !== undefined && patch.y !== undefined && !a.occ.path) {
      a.x = patch.x;
      a.y = patch.y;
    }
    if (patch.facing) a.facing = patch.facing;
    this.seatChanged(a, was);
  }

  move(memberId: string, path: Tile[], startedAt: number) {
    const a = this.actors.get(memberId);
    if (!a) return;
    const was = { on: a.occ.sittingOn, x: a.x, y: a.y };
    a.occ = { ...a.occ, path, pathStartedAt: startedAt, sittingOn: undefined };
    this.seatChanged(a, was);
  }

  /* ------------------------------------------------------------------ seats */

  private objIndex: { of: SceneObject[]; byId: Map<string, SceneObject> } | null = null;
  private objById(id: string): SceneObject | undefined {
    const list = this.scene?.objects;
    if (!list) return undefined;
    if (this.objIndex?.of !== list) this.objIndex = { of: list, byId: new Map(list.map((o) => [o.id, o])) };
    return this.objIndex.byId.get(id);
  }

  /** Every cushion in the scene by its tile (a couch has one per tile). */
  private spotIndex: { of: SceneObject[]; at: Map<string, { seat: SceneObject; spot: SeatSpot }> } | null = null;
  private seatSpotAt(x: number, y: number): { seat: SceneObject; spot: SeatSpot } | null {
    const scene = this.scene;
    if (!scene) return null;
    if (this.spotIndex?.of !== scene.objects) {
      const at = new Map<string, { seat: SceneObject; spot: SeatSpot }>();
      for (const o of scene.objects) for (const spot of seatSpots(o, scene)) at.set(`${spot.x},${spot.y}`, { seat: o, spot });
      this.spotIndex = { of: scene.objects, at };
    }
    return this.spotIndex.at.get(`${x},${y}`) ?? null;
  }

  /** The cushion of a seat object at a tile, facing the seat's way. */
  private cushion(objId: string, x: number, y: number): { x: number; y: number; facing: Facing } | null {
    const at = this.seatSpotAt(Math.round(x), Math.round(y));
    return at && at.seat.id === objId ? { x: at.spot.x, y: at.spot.y, facing: at.spot.facing } : null;
  }

  /**
   * The seat someone is in, or whose cushion their feet are on (stepping onto it, getting up, stepping
   * off): from the moment they're on its tile until they've left it, they're drawn as its sitter.
   */
  private seatOf(a: ActorView, foot = this.footPoint(a)): { obj: SceneObject; facing: Facing } | null {
    const sat = this.seated(a);
    if (sat?.ownSeat) return { obj: sat.obj, facing: sat.facing };
    if (usesWheelchair(a.occ.avatar)) return null;
    const at = this.seatSpotAt(Math.floor(foot.x), Math.floor(foot.y));
    return at ? { obj: at.seat, facing: at.spot.facing } : null;
  }

  /**
   * Someone's seat changed — the server's word, or a walk they started: sit down or stand up, the same for
   * everyone watching. `was`: what they sat on and where they were before the change.
   */
  private seatChanged(a: ActorView, was: { on?: string; x: number; y: number }) {
    const now = performance.now();
    const on = a.occ.sittingOn;
    if (on && !a.occ.path) {
      const spot = this.cushion(on, a.x, a.y);
      if (!spot) return;
      a.facing = spot.facing;
      a.stepOff = undefined;
      const s = a.seat;
      // already settling onto this cushion (they arrived on it): carry on
      if (s && s.objId === on && s.spot.x === spot.x && s.spot.y === spot.y && s.to === 1) return;
      // put on another cushion of the seat they're in, without a walk: slide over, still seated
      if (s && s.objId === on && s.to === 1 && (was.x !== a.x || was.y !== a.y))
        a.glide = { x: was.x, y: was.y, start: now, ms: (Math.hypot(a.x - was.x, a.y - was.y) / WALK_SPEED) * 1000 };
      a.seat = { objId: on, spot, from: this.seatK(a, now), to: 1, start: now };
      return;
    }
    if (!on && a.seat && a.seat.to === 1 && (was.on !== undefined || a.occ.path)) {
      a.seat = { ...a.seat, from: this.seatK(a, now), to: 0, start: now };
      // put on the floor beside the seat: up first, then the step off (a walk away starts from the seat itself)
      if (!a.occ.path && (a.x !== was.x || a.y !== was.y)) a.stepOff = { x: was.x, y: was.y, start: now + STAND_UP_MS, objId: a.seat.objId };
    }
  }

  /**
   * On the last step of a walk onto a cushion: turn the way the seat faces and sit down into it as the step
   * finishes (the server confirms once they're there) — never walking into the furniture and turning inside
   * it. A step along a couch to the next cushion slides over without getting up.
   */
  private approachSeat(a: ActorView, path: Tile[], elapsedMs: number) {
    if (!this.scene || path.length < 2 || usesWheelchair(a.occ.avatar)) return;
    const [lx, ly] = path[path.length - 1];
    if (a.seat?.to === 1 && a.seat.spot.x === lx && a.seat.spot.y === ly) return;
    const [px, py] = path[path.length - 2];
    const last = Math.hypot(lx - px, ly - py);
    // (from the moment their feet are on the seat's tile: past the middle of the last step)
    if ((elapsedMs / 1000) * WALK_SPEED < pathLength(path) - last / 2) return;
    const at = this.seatSpotAt(lx, ly);
    if (!at) return;
    const spot = { x: at.spot.x, y: at.spot.y, facing: at.spot.facing };
    a.stepOff = undefined;
    a.seat = { objId: at.seat.id, spot, from: this.seatK(a), to: 1, start: performance.now() };
  }

  /** A walk ended on a cushion: sitting down, if the last step didn't already start it. */
  private arrive(a: ActorView) {
    if (!this.scene || a.occ.sittingOn || usesWheelchair(a.occ.avatar)) return;
    const at = this.seatSpotAt(Math.round(a.x), Math.round(a.y));
    if (!at) return;
    a.facing = at.spot.facing;
    a.stepOff = undefined;
    if (a.seat?.to === 1 && a.seat.spot.x === at.spot.x && a.seat.spot.y === at.spot.y) return;
    a.seat = { objId: at.seat.id, spot: { x: at.spot.x, y: at.spot.y, facing: at.spot.facing }, from: this.seatK(a), to: 1, start: performance.now() };
  }

  private tickSeat(a: ActorView, now: number) {
    const s = a.seat;
    if (s && s.to === 1 && !a.occ.sittingOn && !a.occ.path && now - s.start > SIT_UNCONFIRMED_MS) a.seat = { ...s, from: this.seatK(a, now), to: 0, start: now };
    else if (s && s.to === 0 && this.seatK(a, now) <= 0) a.seat = undefined;
    if (a.stepOff && now > a.stepOff.start + STEP_OFF_MS) a.stepOff = undefined;
    if (a.glide && now > a.glide.start + a.glide.ms) a.glide = undefined;
  }

  /** How far into their seat someone is: 0 standing … 1 seated. */
  private seatK(a: ActorView, now = performance.now()): number {
    const s = a.seat;
    if (!s) return 0;
    const ms = (s.to > s.from ? SIT_DOWN_MS : STAND_UP_MS) * Math.abs(s.to - s.from);
    const u = ms > 0 ? Math.min(1, Math.max(0, (now - s.start) / ms)) : 1;
    return s.from + (s.to - s.from) * u;
  }

  /** Where someone stands or walks, mid-step off a seat or sliding along one (tile coordinates of their feet). */
  private footPoint(a: ActorView, now = performance.now()): { x: number; y: number; stepping: boolean } {
    const g = a.stepOff ? { ...a.stepOff, ms: STEP_OFF_MS } : a.glide;
    if (g) {
      const u = Math.min(1, Math.max(0, (now - g.start) / g.ms));
      const e = u * u * (3 - 2 * u);
      return { x: g.x + (a.x - g.x) * e + 0.5, y: g.y + (a.y - g.y) * e + 0.5, stepping: !!a.stepOff && u > 0 && u < 1 };
    }
    return { x: a.x + 0.5, y: a.y + 0.5, stepping: false };
  }

  /**
   * Someone in a seat, or on their way into or out of one: where their figure stands (the seat standard's
   * hip point, lifted so the thighs rest on the cushion) and in what pose — a crouch with the feet on the
   * floor, then the seat's sitting style.
   */
  private seated(a: ActorView, now = performance.now()) {
    const s = a.seat;
    if (!s || usesWheelchair(a.occ.avatar)) return null;
    const k = this.seatK(a, now);
    if (k <= 0) return null;
    const obj = this.objById(s.objId);
    if (!obj) return null;
    const profile = artSeatProfile(obj);
    // (getting up to step off, the feet stay on the seat's tile until the step starts)
    const foot = this.footPoint(a, now);
    // the hip point of the cushion under their feet: sliding along a couch, it slides with them
    const hip = sitterPoint({ x: foot.x - 0.5, y: foot.y - 0.5, facing: s.spot.facing }, profile);
    const inSeat = k >= CROUCH_UNTIL;
    const u = inSeat ? (k - CROUCH_UNTIL) / (1 - CROUCH_UNTIL) : 0;
    const lift = sitterLift(profile, s.spot.facing);
    // sitting down: up out of the crouch into the seat (from about where the seated feet meet the floor), a
    // touch past it, and settling; getting up: lifted off the cushion a touch, then down into the crouch
    const rise = Math.min(1, u / 0.6);
    const settle = Math.max(0, (u - 0.6) / 0.4);
    const seatLift =
      s.to > s.from
        ? 0.6 * lift + (0.4 * lift + SETTLE) * (1 - (1 - rise) * (1 - rise)) - SETTLE * settle * settle * (3 - 2 * settle)
        : lift + SETTLE * (1 - u * (2 - u));
    return {
      obj,
      profile,
      facing: s.spot.facing,
      // sorted as its sitter from the moment their feet are on the seat's tile (past the middle of the step
      // onto it) or they're down in it: drawn after it, a backrest seen from behind drawn back over them
      ownSeat: inSeat || (Math.floor(foot.x) === s.spot.x && Math.floor(foot.y) === s.spot.y),
      x: foot.x + (hip.x - foot.x) * k,
      y: foot.y + (hip.y - foot.y) * k,
      lift: inSeat ? seatLift : 0,
      pose: (inSeat ? SIT_POSE_OF[profile.sitStyle] : 'crouch') as Pose,
    };
  }

  /** The pose for getting into, sitting in or stepping off a seat; null when none of that is happening. */
  private seatPose(a: ActorView): Pose | null {
    const sat = this.seated(a);
    if (sat) return sat.pose;
    if (usesWheelchair(a.occ.avatar) && a.occ.sittingOn && !a.moving) return 'sit';
    if (a.stepOff && this.footPoint(a).stepping) return Math.floor(performance.now() / 125) % 2 ? 'walk1' : 'walk2';
    return null;
  }

  /**
   * Seen from behind, the seat is drawn back over its sitter — all of it but the cushion behind them: the
   * backrest, and the cushion's near lip their hips sink behind — from the moment their feet are on its
   * tile until they've left it, up to a little above their hips (their head, shoulders and upper back show).
   */
  private drawBackrest(a: ActorView) {
    const on = this.seatOf(a);
    if (!on || !seenFromBehind(on.facing)) return;
    const st = this.statics.find((x) => x.obj.id === on.obj.id);
    if (!st) return;
    const profile = artSeatProfile(on.obj);
    const over = backrestOverlay(st.sprite, st.obj, on.facing, profile);
    if (!over) return;
    const pose = this.pose(a);
    const drop = pose === 'crouch' ? 3 : pose.startsWith('sit') ? SIT_DROP[profile.sitStyle] : 0;
    const cut = a.sy - (104 - (82 + drop)) / 2 - BACK_COVER_UP;
    const c = this.ctx;
    c.save();
    c.beginPath();
    c.rect(-1e5, -1e5, 2e5, 2e5);
    c.rect(a.rect.l, cut - 200, a.rect.r - a.rect.l, 200);
    c.clip('evenodd');
    const k = st.sprite.scale ?? 1;
    const [nx, ny] = this.anims.offset(st.obj.id, this.reducedMotion);
    blit(c, st.sprite, st.dx + st.sprite.ax / k + nx, st.dy + st.sprite.ay / k + ny, over);
    c.restore();
  }

  hasActor(id: string) {
    return this.actors.has(id);
  }

  /** Position from the path itself, independent of whether frames are being rendered. */
  private livePos(a: ActorView): { x: number; y: number; moving: boolean } {
    const path = a.occ.path;
    if (path && a.occ.pathStartedAt !== undefined) {
      const p = positionAlong(path, this.now() - a.occ.pathStartedAt);
      return { x: p.x, y: p.y, moving: !p.done };
    }
    return { x: a.x, y: a.y, moving: false };
  }

  /**
   * The cushion of a couch or bench a click (canvas CSS px) meant: the one whose seat — where you'd sit, at
   * sitting height — is drawn nearest the click. (The floor tile under the click is a tile further back than
   * the cushion drawn there, so it picked the near cushion for half the far one's pixels.)
   */
  cushionAt(o: SceneObject, spots: SeatSpot[], sx: number, sy: number): SeatSpot | undefined {
    const profile = artSeatProfile(o);
    let best: { s: SeatSpot; d: number } | undefined;
    for (const s of spots) {
      const hip = sitterPoint(s, profile);
      const p = isoToScreen(hip.x, hip.y, sitterLift(profile, s.facing));
      const [x, y] = this.camera.toScreen(p.x, p.y, this.vw, this.vh);
      const d = Math.hypot(x - sx, y - sy);
      if (!best || d < best.d) best = { s, d };
    }
    return best?.s;
  }

  /** The floor tile under a canvas point (CSS px), e.g. where a click landed. */
  tileAt(sx: number, sy: number): Tile {
    const [ax, ay] = this.camera.toWorld(sx, sy, this.vw, this.vh);
    const g = screenToIso(ax, ay);
    return [Math.floor(g.x), Math.floor(g.y)];
  }

  actorTile(id: string): Tile | null {
    const a = this.actors.get(id);
    if (!a) return null;
    const p = this.livePos(a);
    return [Math.round(p.x), Math.round(p.y)];
  }

  /** The path an actor is walking right now (server-time start), or null when standing still. */
  actorPath(id: string): { path: Tile[]; startedAt: number } | null {
    const a = this.actors.get(id);
    if (!a?.occ.path || a.occ.pathStartedAt === undefined || !this.livePos(a).moving) return null;
    return { path: a.occ.path, startedAt: a.occ.pathStartedAt };
  }

  isMoving(id: string): boolean {
    const a = this.actors.get(id);
    return !!a && this.livePos(a).moving;
  }

  say(memberId: string, text: string) {
    const a = this.actors.get(memberId);
    if (!a) return;
    const now = performance.now();
    a.bubble = { text, start: now, until: now + 3500 + text.length * 55 };
  }

  emote(memberId: string, emote: EmoteId) {
    const a = this.actors.get(memberId);
    if (!a) return;
    const now = performance.now();
    a.emotes.push({ emoji: EMOTES[emote].emoji, start: now });
    if (emote === 'wave') a.waveUntil = now + 1400;
    // the body acts it out (standing, hands free); the emoji still floats up
    const act = EMOTE_ACT[emote];
    if (act && !a.occ.sittingOn && !a.occ.carrying) a.act = { kind: act.kind, start: now, until: now + act.ms };
    a.idle = undefined;
    const p = isoToScreen(a.x + 0.5, a.y + 0.5, 30);
    if (emote === 'celebrate') this.effects.burst(p.x, p.y, 'confetti', 30);
    if (emote === 'heart') this.effects.burst(p.x, p.y, 'hearts', 8);
    if (emote === 'clap' || emote === 'idea') this.effects.burst(p.x, p.y, 'sparkle', 8);
  }

  /** Something landed in someone's hands: the item pops up over their head with a little sparkle. */
  gotItem(memberId: string, emoji: string) {
    const a = this.actors.get(memberId);
    if (!a) return;
    a.emotes.push({ emoji, start: performance.now() });
    const p = isoToScreen(a.x + 0.5, a.y + 0.5, 30);
    this.effects.burst(p.x, p.y, 'sparkle', 10);
  }

  /** The room's NPCs as the server has them (a newcomer's snapshot). */
  setNpcs(scene: SceneDef, states: NpcState[]) {
    for (const id of [...this.actors.keys()]) if (id.startsWith('npc:')) this.actors.delete(id);
    for (const st of states) this.updateNpc(scene, st);
  }

  /** One NPC moved or started doing something. */
  updateNpc(scene: SceneDef, st: NpcState) {
    const def = scene.npcs?.find((n) => n.id === st.id);
    if (!def) return;
    const id = `npc:${def.id}`;
    const occ: Occupant = {
      memberId: id,
      x: st.x,
      y: st.y,
      facing: st.facing,
      path: st.path,
      pathStartedAt: st.pathStartedAt,
      sittingOn: st.path ? undefined : st.sittingOn,
      status: 'available',
      avatar: def.avatar,
      via: 'sim',
    };
    this.upsert(occ);
    const a = this.actors.get(id)!;
    const was = { on: a.occ.sittingOn, x: a.x, y: a.y };
    if (!st.path) {
      a.occ = { ...a.occ, path: undefined, pathStartedAt: undefined, sittingOn: st.sittingOn };
      a.x = st.x;
      a.y = st.y;
    } else a.occ = { ...a.occ, sittingOn: undefined };
    a.facing = st.facing;
    this.seatChanged(a, was);
    a.npc = { def, doing: st.doing, holding: st.holding };
    if (st.say) this.say(id, st.say);
  }

  /** A one-off moment on a piece of furniture: an espresso machine pulling a shot, the bell being rung. */
  playObject(objectId: string, what: MomentKind, by?: string, detail?: string) {
    this.anims.trigger(objectId, what, detail);
    const a = by ? this.actors.get(by) : undefined;
    if (what === 'toast') {
      // a toast: glasses up round the room — whoever's standing nearby cheers, a beat apart
      const o = this.scene?.objects.find((x) => x.id === objectId);
      const now = performance.now();
      for (const [id, p] of this.actors) {
        if (p.npc || p.occ.sittingOn || p.occ.carrying || (o && Math.hypot(p.x - o.x, p.y - o.y) > 9)) continue;
        const start = now + (id === by ? 0 : 250 + Math.random() * 600);
        p.act = { kind: 'cheer', start, until: start + 1500 };
        p.emotes.push({ emoji: '🥂', start });
        p.idle = undefined;
      }
      return;
    }
    // whoever used it works it for a moment (hands on the machine, the cue, the keys)
    if (a && !a.occ.sittingOn && what !== 'brew' && what !== 'ring') a.workUntil = performance.now() + 900;
  }

  /** The notes pinned on the room's boards; `pop` when one was just pinned (it pops on). */
  setNotes(notes: BoardNote[], pop = false) {
    this.anims.setNotes(notes, pop);
  }

  /** Turn someone standing still toward an object's footprint (you face what you use). */
  faceObject(memberId: string, o: SceneObject) {
    const a = this.actors.get(memberId);
    if (!a || a.moving) return;
    const cx = o.x + (o.w ?? 1) / 2 - 0.5;
    const cy = o.y + (o.d ?? 1) / 2 - 0.5;
    a.facing = facingFrom(cx - a.x, cy - a.y, a.facing);
    a.occ = { ...a.occ, facing: a.facing };
  }

  setSelected(memberId: string | null) {
    this.selectedActor = memberId;
  }

  showDestination(tile: Tile) {
    this.dest = { x: tile[0], y: tile[1], t: performance.now() };
  }

  /** Screen (CSS px) position of an actor's head, for anchoring React popovers. */
  actorScreen(memberId: string): { x: number; y: number } | null {
    const a = this.actors.get(memberId);
    if (!a) return null;
    const p = isoToScreen(a.x + 0.5, a.y + 0.5, 40);
    const [x, y] = this.camera.toScreen(p.x, p.y, this.vw, this.vh);
    return { x, y };
  }

  focusOn(tile: Tile) {
    const p = isoToScreen(tile[0] + 0.5, tile[1] + 0.5);
    const [sx, sy] = this.insetShift();
    this.camera.panTo(p.x + sx, p.y - 20 + sy);
  }

  zoomBy(f: number) {
    this.camera.zoomAt(f, this.vw / 2, this.vh / 2, this.vw, this.vh);
  }

  /** Iris transition. `mid` runs when the screen is covered. */
  transitionTo(mid: () => void | Promise<unknown>) {
    if (document.hidden) {
      // No frames are rendered in background tabs; don't let navigation wait for an animation.
      this.runMid(mid);
      return;
    }
    const tr = { phase: 'close' as const, t: this.reducedMotion ? 0.7 : 0, mid };
    this.transition = tr;
    setTimeout(() => {
      if (this.transition === tr) this.runMid(mid);
    }, 900);
  }

  private runMid(mid?: () => void | Promise<unknown>) {
    const r = mid?.();
    if (r instanceof Promise) {
      this.transition = { phase: 'hold', t: 0 };
      const open = () => {
        if (this.transition?.phase === 'hold') this.transition = { phase: 'open', t: 0 };
      };
      r.then(open, open);
      setTimeout(open, 4000);
    } else {
      this.transition = { phase: 'open', t: 0 };
    }
  }

  /* ------------------------------------------------------------------ loop */

  private frame = (t: number) => {
    // the next frame is booked first: one bad frame must never stop the world (a throw used to end the loop)
    this.raf = requestAnimationFrame(this.frame);
    // a rAF timestamp is when its frame began, which can be before `last` (set at construction): never negative
    const dt = Math.max(0, Math.min(0.05, (t - this.last) / 1000));
    this.last = t;
    try {
      this.update(dt);
      this.draw();
    } catch (e) {
      if (!this.frameError) console.error('[world] frame failed; carrying on', e);
      this.frameError = true;
    }
  };
  /** A frame has thrown (reported once, not every frame). */
  private frameError = false;

  private update(dt: number) {
    const now = this.now();
    for (const a of this.actors.values()) {
      const path = a.occ.path;
      if (path && a.occ.pathStartedAt !== undefined) {
        const p = positionAlong(path, now - a.occ.pathStartedAt);
        a.x = p.x;
        a.y = p.y;
        a.facing = facingFrom(p.dir[0], p.dir[1], a.facing);
        a.moving = !p.done;
        if (!p.done) this.approachSeat(a, path, now - a.occ.pathStartedAt);
        // on the way into a seat they've turned the way it faces, their back to it
        if (a.seat?.to === 1) a.facing = a.seat.spot.facing;
        if (p.done) {
          a.occ.path = undefined;
          a.occ.pathStartedAt = undefined;
          a.occ.x = p.x;
          a.occ.y = p.y;
          this.arrive(a);
        }
      } else {
        a.moving = false;
        if (a.occ.sittingOn) a.facing = a.occ.facing;
      }
      a.walkClock = a.moving ? a.walkClock + dt : 0;
      this.tickSeat(a, performance.now());
      this.tickLife(a, performance.now());
      a.emotes = a.emotes.filter((e) => performance.now() - e.start < 1800);
      if (a.bubble && performance.now() > a.bubble.until) a.bubble = undefined;
    }
    // gentle follow
    const me = this.actors.get(this.meId);
    if (me?.moving && this.scene?.kind === 'outdoor' && performance.now() - this.camera.lastManual > 2500) {
      const p = isoToScreen(me.x + 0.5, me.y + 0.5);
      this.camera.panTo(p.x, p.y - 20);
    }
    this.camera.update(dt, this.reducedMotion);
    this.effects.update(dt);
    this.anims.update(dt, this.reducedMotion);
    if (this.transition && this.transition.phase !== 'hold') {
      this.transition.t += dt / (this.transition.phase === 'close' ? 0.32 : 0.42);
      if (this.transition.t >= 1) {
        if (this.transition.phase === 'close') this.runMid(this.transition.mid);
        else this.transition = null;
      }
    }
  }

  private actorLift(a: ActorView): number {
    if (usesWheelchair(a.occ.avatar)) return 0;
    const sat = this.seated(a);
    if (sat) return sat.lift;
    for (const b of this.stageBoxes) {
      if (a.x + 0.5 >= b.x0 && a.x + 0.5 < b.x1 && a.y + 0.5 >= b.y0 && a.y + 0.5 < b.y1) return 6;
    }
    return 0;
  }

  private pose(a: ActorView): Pose {
    const doing = a.moving ? undefined : a.npc?.doing;
    if ((doing === 'serve' || doing === 'greet') && !a.occ.sittingOn) return 'wave';
    const seatPose = this.seatPose(a);
    if (seatPose) return seatPose;
    if (doing === 'brew' || doing === 'work') return 'work';
    if (performance.now() < a.waveUntil) return 'wave';
    if (!a.moving && !a.occ.sittingOn && a.workUntil && performance.now() < a.workUntil) return 'work';
    if (a.moving) {
      // contact, passing, contact, passing: arms swing through, the body bobs on each stride
      const f = Math.floor(a.walkClock * 8) % 4;
      return (['walk1', 'pass1', 'walk2', 'pass2'] as const)[f];
    }
    return this.lifePose(a) ?? 'stand';
  }

  /**
   * Standing still: an emote gesture while it plays, a dance at a party (or after the dance emote), else now
   * and then a quiet idle moment. Never while carrying something or mid-sentence.
   */
  private lifePose(a: ActorView): Pose | null {
    const now = performance.now();
    if (a.act && now < a.act.until) {
      const t = (now - a.act.start) / 1000;
      const alt = (x: Pose, y: Pose, fps: number): Pose => (Math.floor(t * fps) % 2 ? y : x);
      switch (a.act.kind) {
        case 'clap':
          return alt('clap1', 'clap2', 6);
        case 'cheer':
          return alt('cheer1', 'cheer2', 4);
        case 'laugh':
          return alt('laugh1', 'laugh2', 7);
        case 'thumbs':
          return 'thumbs';
        case 'heart':
          return 'heart';
        case 'idea':
          return 'idea';
        case 'dance':
          return this.dancePose(a, now);
      }
    }
    if (this.reducedMotion || a.npc) return null;
    if (this.party && a.groove.dances && !a.occ.carrying && !a.bubble) return this.dancePose(a, now);
    if (a.idle && now < a.idle.until && a.idle.kind !== 'glance') return a.idle.kind;
    return null;
  }

  private dancePose(a: ActorView, now: number): Pose {
    const f = Math.floor((now / 1000) * a.groove.tempo + a.groove.phase) % 4;
    return (['dance1', 'dance2', 'dance3', 'dance4'] as const)[f];
  }

  /** Idle moments come and go on each person's own clock; anything that needs them cancels one. */
  private tickLife(a: ActorView, now: number) {
    const busy = a.moving || !!a.occ.sittingOn || !!a.occ.carrying || !!a.bubble || !!a.npc || (!!a.act && now < a.act.until);
    if (busy || this.reducedMotion) {
      a.idle = undefined;
      if (now >= a.nextIdleAt) a.nextIdleAt = now + 4000 + Math.random() * 8000;
      return;
    }
    if (a.idle && now >= a.idle.until) a.idle = undefined;
    if (a.idle || now < a.nextIdleAt) return;
    const r = Math.random();
    if (r < 0.45) a.idle = { kind: 'shift', start: now, until: now + 2500 + Math.random() * 2500 };
    else if (r < 0.8) {
      // a glance to one side: the next facing round, for a moment
      const order: Facing[] = ['se', 'sw', 'nw', 'ne'];
      const i = order.indexOf(a.facing);
      const facing = order[(i + (Math.random() < 0.5 ? 1 : 3)) % 4];
      a.idle = { kind: 'glance', start: now, until: now + 1100 + Math.random() * 900, facing };
    } else a.idle = { kind: 'phone', start: now, until: now + 3000 + Math.random() * 2500 };
    a.nextIdleAt = a.idle.until + 7000 + Math.random() * 14000;
  }

  /** The facing to draw: the way they face, or the way they glanced for a moment. */
  private viewFacing(a: ActorView): Facing {
    return a.idle?.kind === 'glance' && performance.now() < a.idle.until && a.idle.facing ? a.idle.facing : a.facing;
  }

  private draw() {
    const c = this.ctx;
    const { dpr, vw, vh } = this;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.imageSmoothingEnabled = false;
    const outdoor = this.scene?.kind === 'outdoor';
    const bg = c.createLinearGradient(0, 0, 0, this.canvas.height);
    bg.addColorStop(0, '#2d2538');
    bg.addColorStop(1, '#1b1623');
    // outdoors: the sky (the sea, the horizon and the hills are drawn in the world, below)
    c.fillStyle = outdoor ? skyColor(skyAt()) : bg;
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.scene || !this.ground) return;

    const z = this.camera.zoom;
    const s = z * dpr;
    const tx = dpr * (vw / 2 - this.camera.x * z);
    const ty = dpr * (vh / 2 - this.camera.y * z);
    c.setTransform(s, 0, 0, s, Math.round(tx), Math.round(ty));
    c.imageSmoothingEnabled = false;
    const sky = skyAt();
    const shell = 'windows' in this.ground ? this.ground : null;
    if (shell) this.drawWindowViews(c, shell, sky);
    if (outdoor) drawSurroundings(c, this.scene.width, this.scene.height, sky, this.visibleArt(), performance.now() / 1000, this.reducedMotion);
    const gk = this.ground.scale ?? 1;
    c.drawImage(this.ground.canvas, this.ground.minX, this.ground.minY, this.ground.canvas.width / gk, this.ground.canvas.height / gk);
    if ('water' in this.ground && this.ground.water) this.drawWaterMotion(c, this.ground.water);
    // a town ground still streaming in fills in where the camera is first
    if (outdoor && 'pending' in this.ground && this.ground.pending) this.ground.focusY = this.camera.y;
    if (shell) {
      // Sunlight through the windows follows the weather; passing clouds make it breathe a little.
      c.save();
      c.globalCompositeOperation = 'screen';
      const breathe = sky.weather === 'clouds' ? 0.8 + 0.2 * Math.sin(performance.now() / 2600) : 1;
      c.globalAlpha = Math.min(1, sky.sun * breathe);
      if (c.globalAlpha > 0.02) c.drawImage(shell.sun, shell.minX, shell.minY, shell.sun.width / gk, shell.sun.height / gk);
      c.globalAlpha = sky.lamp;
      for (const l of shell.lamps) if (this.isOn(l.id)) c.drawImage(l.pool, l.ax, l.ay, l.pool.width / gk, l.pool.height / gk);
      c.restore();
    }

    // the life on the walls (a countdown, lanterns, neon) — behind everything standing in the room
    this.anims.drawWalls(c, this.reducedMotion);

    // hover tile + destination marker
    if (this.hoverTile && !this.hover) this.diamond(this.hoverTile[0], this.hoverTile[1], 'rgba(255,255,255,0.35)', 1);
    if (this.dest) {
      const age = (performance.now() - this.dest.t) / 1000;
      if (age > 1.2) this.dest = null;
      else this.diamond(this.dest.x, this.dest.y, `rgba(255,236,140,${1 - age / 1.2})`, 1 - age * 0.3);
    }
    this.effects.drawUnder(c);

    // actor shadows, selection and speaking rings
    const t = performance.now() / 1000;
    for (const a of this.actors.values()) {
      const sat = this.seated(a);
      const foot = this.footPoint(a);
      const p = sat ? isoToScreen(sat.x, sat.y, sat.lift) : isoToScreen(foot.x, foot.y, this.actorLift(a));
      c.fillStyle = 'rgba(40,30,50,0.25)';
      c.beginPath();
      c.ellipse(p.x, p.y, 8, 4, 0, 0, Math.PI * 2);
      c.fill();
      if (a.occ.memberId === this.selectedActor || a.occ.memberId === this.meId) {
        c.strokeStyle = a.occ.memberId === this.meId ? 'rgba(255,210,63,0.9)' : 'rgba(255,255,255,0.95)';
        c.lineWidth = 1.2;
        c.beginPath();
        c.ellipse(p.x, p.y, 11, 5.5, 0, 0, Math.PI * 2);
        c.stroke();
      }
      if (a.occ.speaking) {
        const k = (t * 1.6) % 1;
        c.strokeStyle = `rgba(47,191,113,${1 - k})`;
        c.lineWidth = 1.2;
        c.beginPath();
        c.ellipse(p.x, p.y, 9 + k * 8, 4.5 + k * 4, 0, 0, Math.PI * 2);
        c.stroke();
      }
    }

    this.effects.night = NIGHTNESS[sky.phase];
    this.effects.people = outdoor ? [...this.actors.values()].map((a) => ({ x: a.x, y: a.y })) : [];
    // Lit windows and lanterns (outdoors, dusk to dawn): collected in depth order on their own layer — each
    // thing drawn in front erases what it covers — and added over the dimmed town at the end.
    const glowAlpha = outdoor ? GLOW_ALPHA[sky.phase] : 0;
    const gl = glowAlpha > 0 ? this.glowLayer(s, Math.round(tx), Math.round(ty)) : null;

    // depth-sorted statics + actors
    const order = this.buildDrawOrder();
    const now = performance.now() / 1000;
    const view = this.visibleArt();
    for (const d of order) {
      if ('obj' in d) {
        // off-screen things aren't drawn (the town has ~1,000 of them; a view shows a fraction)
        if (d.rect.r < view.l || d.rect.l > view.r || d.rect.b < view.t || d.rect.t > view.b) continue;
        const hovered = this.hover?.kind === 'object' && this.hover.id === d.obj.id;
        const [nx, ny] = this.anims.offset(d.obj.id, this.reducedMotion);
        const ox = d.dx + d.sprite.ax / (d.sprite.scale ?? 1) + nx;
        const oy = d.dy + d.sprite.ay / (d.sprite.scale ?? 1) + ny;
        const sway = this.reducedMotion ? 0 : swayOf(d.obj, now);
        if (hovered) blit(c, d.sprite, ox, oy, highlightOf(d.sprite), 2);
        else if (sway) drawSwaying(c, d.sprite, ox, oy, sway);
        else if (!this.anims.drawSprite(c, d.obj.id, ox, oy, this.reducedMotion)) blit(c, d.sprite, ox, oy);
        this.anims.drawFor(c, d.obj.id, this.reducedMotion);
        if (d.festive) c.drawImage(d.festive.canvas, d.dx, d.dy);
        if (gl) {
          gl.globalCompositeOperation = 'destination-out';
          blit(gl, d.sprite, ox, oy);
          if (d.sprite.glow) {
            gl.globalCompositeOperation = 'source-over';
            blit(gl, d.sprite, ox, oy, d.sprite.glow);
          }
        }
      } else {
        this.drawActor(d);
        if (gl) {
          gl.globalCompositeOperation = 'destination-out';
          blit(gl, avatarSprite(this.look(d), this.viewFacing(d), this.pose(d)), Math.round(d.sx), Math.round(d.sy));
        }
      }
    }
    if (this.ghost) {
      const g = this.ghost;
      this.diamond(g.obj.x, g.obj.y, g.valid ? 'rgba(47,191,113,0.95)' : 'rgba(224,80,63,0.95)', 1.5);
      const sprite = spriteFor(g.obj);
      if (sprite) {
        const p = isoToScreen(g.obj.x, g.obj.y);
        c.globalAlpha = g.valid ? 0.75 : 0.35;
        blit(c, sprite, p.x, p.y);
        c.globalAlpha = 1;
      }
    }
    this.drawGlints(c);
    this.effects.drawOver(c);
    this.drawAmbience(c, sky, s, Math.round(tx), Math.round(ty));
    this.effects.drawLights(c);
    if (gl && this.glow) {
      // lit glass over the dimmed town: warm, a touch of flicker per window row
      c.save();
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = glowAlpha;
      c.drawImage(this.glow, 0, 0);
      c.restore();
    }

    // People can tuck themselves behind furniture — no see-through silhouettes. The one exception: in
    // town a whole building can swallow you, so your own avatar keeps a faint outline there.
    const me = outdoor ? order.find((d): d is ActorView => !('obj' in d) && d.occ.memberId === this.meId) : undefined;
    if (me) {
      c.globalAlpha = 0.45;
      blit(c, avatarSprite(this.look(me), this.viewFacing(me), this.pose(me)), Math.round(me.sx), Math.round(me.sy));
      c.globalAlpha = 1;
    }

    // screen-space overlays
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.imageSmoothingEnabled = false;
    this.badgeRects = [];
    if (outdoor) this.drawBadges();
    this.drawActorOverlays();
    this.drawTransition();
  }

  private diamond(x: number, y: number, color: string, lw: number) {
    const c = this.ctx;
    const a = isoToScreen(x, y);
    const b = isoToScreen(x + 1, y);
    const d = isoToScreen(x + 1, y + 1);
    const e = isoToScreen(x, y + 1);
    c.strokeStyle = color;
    c.lineWidth = lw;
    c.beginPath();
    c.moveTo(a.x, a.y);
    c.lineTo(b.x, b.y);
    c.lineTo(d.x, d.y);
    c.lineTo(e.x, e.y);
    c.closePath();
    c.stroke();
  }

  private buildDrawOrder(): Array<Static | ActorView> {
    const statics = this.statics;
    const slots: Array<ActorView[]> = Array.from({ length: statics.length + 1 }, () => []);
    for (const a of this.actors.values()) {
      // a sitter's figure stands on the seat standard's hip point, lifted onto the cushion
      const sat = this.seated(a);
      const foot = this.footPoint(a);
      a.lift = sat ? sat.lift : this.actorLift(a);
      const p = sat ? isoToScreen(sat.x, sat.y, sat.lift) : isoToScreen(foot.x, foot.y, a.lift);
      a.sx = p.x;
      a.sy = p.y;
      a.rect = { l: p.x - 12, t: p.y - 42, r: p.x + 12, b: p.y + 2 };
      // the seat they're in, or whose tile their feet are on: drawn after it (and seen from behind, its back
      // drawn over them); otherwise sorted by the tile they're on — walking, the one they're leaving until
      // they're past the middle of a step
      const on = this.seatOf(a, foot);
      const own = on?.obj.id ?? a.occ.sittingOn;
      const tile = sat?.ownSeat ? { x: a.seat!.spot.x, y: a.seat!.spot.y } : { x: Math.floor(foot.x), y: Math.floor(foot.y) };
      const box: Box = { x0: tile.x, y0: tile.y, x1: tile.x + 1, y1: tile.y + 1 };
      let slot = 0;
      for (let i = 0; i < statics.length; i++) {
        const s = statics[i];
        if (!rectsOverlap(s.rect, a.rect)) continue;
        let isBehind: boolean;
        // Your own seat: you're drawn after it, and a backrest between you and us is drawn back over you
        // (drawBackrest)
        if (own === s.obj.id) isBehind = true;
        else isBehind = behind(s.box, box);
        if (isBehind) slot = i + 1;
      }
      slots[slot].push(a);
    }
    const out: Array<Static | ActorView> = [];
    for (let i = 0; i <= statics.length; i++) {
      const list = slots[i];
      if (list.length > 1) list.sort((p, q) => p.x + p.y - (q.x + q.y));
      out.push(...list);
      if (i < statics.length) out.push(statics[i]);
    }
    return out;
  }

  /**
   * The look to draw: whatever someone picked up in the world goes in their hand. A pet is left out while its
   * person is seated — drawn with them it would float at seat height inside the furniture.
   */
  private look(a: ActorView): AvatarLoadout {
    // an NPC holds what they're making; anyone holds what they picked up (carryable ids → held items)
    if (a.npc?.holding) return { ...a.occ.avatar, held: `held.${a.npc.holding}` };
    const seated = !!a.occ.sittingOn && !a.moving;
    if (!a.occ.carrying && !seated) return a.occ.avatar;
    return { ...a.occ.avatar, ...(a.occ.carrying ? { held: `held.${a.occ.carrying}` } : {}), ...(seated ? { pet: 'pet.none' } : {}) };
  }

  /**
   * A momentary expression: an idle blink every few seconds (each person on their own rhythm), and a moving
   * mouth while their speech bubble is up.
   */
  private expression(a: ActorView): Expression | undefined {
    const now = performance.now();
    if (a.bubble && now < a.bubble.until) return Math.floor(now / 140) % 2 ? 'talk' : undefined;
    if (now >= a.blinkAt) {
      a.blinkUntil = now + 120;
      a.blinkAt = now + 2500 + Math.random() * 3500;
    }
    return now < a.blinkUntil ? 'blink' : undefined;
  }

  private drawActor(a: ActorView) {
    const c = this.ctx;
    const sprite = avatarSprite(this.look(a), this.viewFacing(a), this.pose(a), this.reducedMotion ? undefined : this.expression(a));
    const hovered = this.hover?.kind === 'actor' && this.hover.id === a.occ.memberId;
    const x = Math.round(a.sx);
    const y = Math.round(a.sy);
    if (a.occ.via === 'provider') c.globalAlpha = 0.72;
    if (hovered) blit(c, sprite, x, y, highlightOf(sprite), 2);
    else blit(c, sprite, x, y);
    c.globalAlpha = 1;
    this.drawBackrest(a);
  }

  private headScreen(a: ActorView): [number, number] {
    const top = a.occ.sittingOn ? 36 : 42;
    return this.camera.toScreen(a.sx, a.sy - top, this.vw, this.vh);
  }

  /**
   * Heads-up over the people in the scene, Habbo-style: quiet by default. Names show for whoever you hover or
   * select (or everyone, with the "show all names" preference); your own figure always carries a small "You"
   * tag; presence dots only where they say something (open to chat, heads-down, away — not plain available).
   * Speech bubbles carry the speaker's head and name, and are laid out together so they never overlap: the
   * newest sits over its speaker, older ones rise and fade.
   */
  private bubbleMemory = new Map<string, { dx: number; dy: number }>();

  private drawActorOverlays() {
    const c = this.ctx;
    const z = this.camera.zoom;
    const now = performance.now();
    const list = [...this.actors.values()].sort((p, q) => p.sy - q.sy);
    const obstacles: Rect[] = [];
    const bubbles: BubbleSpec[] = [];
    const emotes: Array<{ a: ActorView; x: number; top: number }> = [];
    // the bubble's little head: a 24 × 24 crop of the sprite at 1:1, crown to chin
    const headCrop = { x: 33, y: 33, w: 24, h: 24 };
    for (const a of list) {
      const [hx, hy] = this.headScreen(a);
      if (hx < -100 || hy < -100 || hx > this.vw + 100 || hy > this.vh + 200) continue;
      const id = a.occ.memberId;
      const isMe = id === this.meId;
      const hovered = this.hover?.kind === 'actor' && this.hover.id === id;
      const focus = hovered || id === this.selectedActor;
      const showName = focus || this.showAllNames;
      let top = hy - 4;
      if (a.npc) {
        // a room NPC: "Name · Role" and an NPC tag when you look at them — never a presence dot
        if (showName) {
          const r = pill(c, hx, top, `${a.npc.def.name} · ${a.npc.def.role}`, { size: 11, bg: hovered ? '#ffffff' : 'rgba(255,248,236,0.96)', padX: 6 });
          const tag = pill(c, hx, r.y - 3, 'NPC', { size: 9, bg: '#2f5d46', fg: '#f4efe6', padX: 4 });
          obstacles.push(r, tag);
          top = tag.y - 3;
        }
      } else {
        const meta = STATUS_META[a.occ.status];
        if (a.occ.status !== 'available' || focus || this.showAllNames) {
          const dx = hx + (9 * Math.min(z, 3)) / 2;
          c.fillStyle = INK_CSS;
          c.beginPath();
          c.arc(dx, hy + 4, 4.5, 0, Math.PI * 2);
          c.fill();
          c.fillStyle = meta.color;
          c.beginPath();
          c.arc(dx, hy + 4, 3, 0, Math.PI * 2);
          c.fill();
        }
        if (showName || isMe) {
          const name = isMe ? 'You' : this.cb.nameOf(id).split(' ')[0];
          const voice = a.occ.voice || a.occ.via === 'provider' ? ' 🎧' : '';
          // what they're holding rides along on the tag ("You ☕")
          const held = carryMeta(a.occ.carrying);
          const r = pill(c, hx, top, name + voice + (held ? ` ${held.emoji}` : ''), {
            size: isMe && !focus ? 10 : 11,
            bg: isMe ? '#ffd23f' : hovered ? '#ffffff' : 'rgba(255,248,236,0.96)',
            padX: isMe && !focus ? 5 : 6,
          });
          obstacles.push(r);
          top = r.y - 3;
        }
      }
      if (a.bubble && now < a.bubble.until) {
        const age = now - a.bubble.start;
        const spr = avatarSprite(this.look(a), 'se', 'stand');
        bubbles.push({
          key: id,
          anchorX: hx,
          anchorY: top,
          name: a.npc ? a.npc.def.name : isMe ? 'You' : this.cb.nameOf(id).split(' ')[0],
          text: a.bubble.text,
          start: a.bubble.start,
          alpha: Math.max(0, Math.min(1, age / 150, (a.bubble.until - now) / 400)),
          accent: a.npc ? '#2f5d46' : undefined,
          head: { img: spr.canvas, sx: headCrop.x, sy: headCrop.y, sw: headCrop.w, sh: headCrop.h },
        });
      }
      if (a.emotes.length) emotes.push({ a, x: hx, top });
    }
    // every bubble placed at once (so none covers another), drawn oldest first so the newest reads on top
    const placed = layoutBubbles(c, bubbles, obstacles, this.vw, this.bubbleMemory);
    for (const b of placed.sort((p, q) => p.start - q.start)) drawBubble(c, b);
    for (const { a, x, top } of emotes)
      for (const e of a.emotes) {
        const k = (now - e.start) / 1800;
        if (k < 0) continue; // not yet (a toast's glasses go up a beat apart)
        const rise = (this.reducedMotion ? 0.3 : k) * 34;
        const pop = k < 0.12 ? 0.6 + (k / 0.12) * 0.6 : 1.2 - Math.min(0.2, (k - 0.12) * 0.4);
        c.globalAlpha = Math.max(0, 1 - Math.max(0, k - 0.6) / 0.4);
        c.font = `${Math.round(20 * pop)}px ${UI_FONT}`;
        c.textAlign = 'center';
        c.textBaseline = 'bottom';
        c.fillText(e.emoji, x, top - rise);
        c.globalAlpha = 1;
      }
  }

  private glintCanvas: HTMLCanvasElement | null = null;
  /** Night-glow layer (outdoors): lit windows in depth order, see draw(). */
  private glow: HTMLCanvasElement | null = null;

  /** A cleared glow layer the size of the canvas, set to the world transform for this frame. */
  private glowLayer(s: number, tx: number, ty: number): CanvasRenderingContext2D {
    const W = this.canvas.width;
    const H = this.canvas.height;
    if (!this.glow || this.glow.width !== W || this.glow.height !== H) {
      this.glow = document.createElement('canvas');
      this.glow.width = W;
      this.glow.height = H;
    }
    const g = this.glow.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, W, H);
    g.setTransform(s, 0, 0, s, tx, ty);
    g.imageSmoothingEnabled = false;
    return g;
  }

  /**
   * Heirlooms catch the light: every few seconds a bright diagonal glint sweeps across each one, and now
   * and then it gives off a little sparkle.
   */
  private drawGlints(c: CanvasRenderingContext2D) {
    const t = performance.now() / 1000;
    for (const st of this.statics) {
      if (!st.obj.sprite.startsWith('heirloom')) continue;
      const seed = (st.obj.x * 7 + st.obj.y * 13) % 10;
      const period = 7 + (seed % 3);
      const phase = ((t + seed * 1.3) % period) / 0.9; // 0..1 during the sweep
      const sp = st.sprite;
      const k = sp.scale ?? 1;
      const w = sp.canvas.width;
      const h = sp.canvas.height;
      if (!this.reducedMotion && phase < 1) {
        if (!this.glintCanvas) this.glintCanvas = document.createElement('canvas');
        const g = this.glintCanvas;
        g.width = w;
        g.height = h;
        const gc = g.getContext('2d')!;
        const pos = -h + phase * (w + h * 2);
        const grad = gc.createLinearGradient(pos, 0, pos + h * 0.6, h * 0.6);
        grad.addColorStop(0, 'rgba(255,255,240,0)');
        grad.addColorStop(0.5, 'rgba(255,252,225,0.3)');
        grad.addColorStop(1, 'rgba(255,255,240,0)');
        gc.fillStyle = grad;
        gc.fillRect(0, 0, w, h);
        gc.globalCompositeOperation = 'destination-in';
        gc.drawImage(sp.canvas, 0, 0);
        c.save();
        c.globalCompositeOperation = 'lighter';
        c.drawImage(g, st.dx, st.dy, w / k, h / k);
        c.restore();
      }
      if (!this.reducedMotion && Math.random() < 0.004) {
        const x = st.dx + (0.3 + Math.random() * 0.4) * (w / k);
        const y = st.dy + (0.15 + Math.random() * 0.4) * (h / k);
        this.effects.burst(x, y, 'sparkle', 3);
      }
    }
  }

  /** The live view outside each window, painted before the room so it shows through the glass. */
  private drawWindowViews(c: CanvasRenderingContext2D, shell: InteriorLayer, sky: Sky) {
    const t = performance.now() / 1000;
    shell.windows.forEach((w, i) => {
      const view = windowView(w, `${this.scene?.id}:${i}`, t, sky);
      c.save();
      if (w.face === 'right') c.transform(16, 8, 0, -1, 0, 0);
      else c.transform(-16, 8, 0, -1, 0, 0);
      c.translate(w.u0, w.v1);
      c.scale((w.u1 - w.u0) / view.width, -(w.v1 - w.v0) / view.height);
      c.imageSmoothingEnabled = false;
      c.drawImage(view, 0, 0);
      c.restore();
    });
  }

  /**
   * Time of day and weather over the room. Dusk, night and rain dim the room; every lamp cuts a warm pool
   * out of that dimness (so it visibly lights the floor, furniture and people near it), then glows.
   */
  private drawAmbience(c: CanvasRenderingContext2D, sky: Sky, s: number, tx: number, ty: number) {
    const outdoor = this.scene?.kind === 'outdoor';
    const base = MOODS[sky.phase] ?? (sky.weather === 'rain' ? MOODS.rain : sky.weather === 'clouds' || sky.weather === 'snow' ? MOODS.clouds : undefined);
    const k = outdoor ? 1 : INDOOR_DEPTH;
    const mood = base && {
      mul: base.mul.map((v) => Math.round((1 - (1 - v) * k) * 255)),
      amb: base.amb?.map((v) => Math.round(v * k)),
    };
    const now = performance.now();
    const flicker = 0.95 + 0.05 * Math.sin(now / 170) * Math.sin(now / 530);
    // indoors lamps glow whenever they're on; street lamps only once the light goes
    const outdoorK = this.scene?.kind === 'outdoor' ? NIGHTNESS[sky.phase] : 1;
    const lamps = this.statics
      .filter((st) => (st.obj.sprite === 'lamp' || !!artLight(st.obj)) && this.isOn(st.obj.id))
      .map((st) => {
        const L = artLight(st.obj) ?? { dx: 0, dy: -30, r: 22 };
        const p = isoToScreen(st.obj.x, st.obj.y, st.obj.z ?? 0);
        // a fire or a candle-lit lantern breathes on its own (±10 %); electric lamps just hum
        const fire = FIRE_LIGHTS.has(st.obj.sprite);
        const seed = st.obj.x * 3.1 + st.obj.y * 1.7;
        const own = fire ? 0.9 + 0.1 * Math.sin(now / 90 + seed) * Math.sin(now / 237 + seed * 2) : flicker;
        return { x: p.x + L.dx, y: p.y + L.dy, fx: p.x + L.dx * 0.5, fy: p.y + 12, r: L.r, k: own * outdoorK };
      })
      .filter((p) => p.k > 0.01);
    if (mood) {
      const W = this.canvas.width;
      const H = this.canvas.height;
      if (!this.shade || this.shade.width !== W || this.shade.height !== H) {
        this.shade = document.createElement('canvas');
        this.shade.width = W;
        this.shade.height = H;
      }
      const l = this.shade.getContext('2d')!;
      l.setTransform(1, 0, 0, 1, 0, 0);
      l.globalCompositeOperation = 'source-over';
      l.clearRect(0, 0, W, H);
      l.fillStyle = `rgb(${mood.mul.join(',')})`;
      l.fillRect(0, 0, W, H);
      l.globalCompositeOperation = 'destination-out';
      l.setTransform(s, 0, 0, s, tx, ty);
      for (const p of lamps) {
        const R = Math.max(78, p.r * 2.2);
        const g = l.createRadialGradient(p.fx, p.fy - 6, 2, p.fx, p.fy - 6, R);
        const a = Math.min(1, sky.lamp * p.k);
        g.addColorStop(0, `rgba(0,0,0,${0.95 * a})`);
        g.addColorStop(0.45, `rgba(0,0,0,${0.6 * a})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        l.fillStyle = g;
        l.fillRect(p.fx - R, p.fy - 6 - R, R * 2, R * 2);
      }
      c.save();
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalCompositeOperation = 'multiply';
      c.drawImage(this.shade, 0, 0);
      if (mood.amb) {
        c.globalCompositeOperation = 'screen';
        c.fillStyle = `rgb(${mood.amb.join(',')})`;
        c.fillRect(0, 0, W, H);
      }
      c.restore();
    }
    // Warm light: a broad spill over everything nearby, and a bright core at the shade.
    c.save();
    c.globalCompositeOperation = 'lighter';
    for (const p of lamps) {
      const k = sky.lamp * p.k;
      const spill = c.createRadialGradient(p.fx, p.fy - 10, 2, p.fx, p.fy - 10, 64);
      spill.addColorStop(0, `rgba(255,170,90,${0.2 * k})`);
      spill.addColorStop(1, 'rgba(255,150,80,0)');
      c.fillStyle = spill;
      c.fillRect(p.fx - 64, p.fy - 74, 128, 128);
      const core = c.createRadialGradient(p.x, p.y, 1, p.x, p.y, p.r);
      core.addColorStop(0, `rgba(255,236,190,${0.75 * k})`);
      core.addColorStop(0.35, `rgba(255,196,120,${0.32 * k})`);
      core.addColorStop(1, 'rgba(255,170,90,0)');
      c.fillStyle = core;
      c.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
    }
    c.restore();
  }

  /** The part of the world on screen (art space), with a margin for sway, smoke and overhangs. */
  private visibleArt(): { l: number; t: number; r: number; b: number } {
    const [l, t] = this.camera.toWorld(0, 0, this.vw, this.vh);
    const [r, b] = this.camera.toWorld(this.vw, this.vh, this.vw, this.vh);
    const m = 24;
    return { l: l - m, t: t - m, r: r + m, b: b + m };
  }

  /**
   * The lake moves: its ripple crests travel slowly across the water (cross-fading between the ground's
   * pre-rendered phases), sparkles winking on and off along them. Still when motion is reduced.
   */
  private drawWaterMotion(c: CanvasRenderingContext2D, water: NonNullable<GroundLayer['water']>) {
    const n = water.frames.length;
    const t = this.reducedMotion ? 0 : (performance.now() / 1000) * 0.55;
    const f = Math.floor(t) % n;
    const k = t - Math.floor(t);
    c.save();
    c.globalAlpha = 1 - k;
    c.drawImage(water.frames[f], water.x, water.y);
    if (k > 0.01) {
      c.globalAlpha = k;
      c.drawImage(water.frames[(f + 1) % n], water.x, water.y);
    }
    c.restore();
  }

  /** Whether a world point is covered by the drawing of any building other than `own`. */
  private onOtherBuilding(own: Static, wx: number, wy: number): boolean {
    for (const st of this.statics) {
      if (st === own || !st.obj.building) continue;
      const k = st.sprite.scale ?? 1;
      const px = Math.floor((wx - st.dx) * k);
      const py = Math.floor((wy - st.dy) * k);
      const { width: W, height: H } = st.sprite.canvas;
      if (px < 0 || py < 0 || px >= W || py >= H) continue;
      if (st.sprite.mask[py * W + px]) return true;
    }
    return false;
  }

  /**
   * Where a building's place label goes (screen px; its bottom-centre). Preferably just above its own roof;
   * when that spot is over another building (the arcade stands in front of HQ), the label comes down onto its
   * own roof or sign instead — never over a different building, never over another label — so it always
   * reads as belonging to the building under it, at every zoom and camera position.
   */
  private labelSpot(st: Static, w: number, h: number, placed: Array<{ x: number; y: number; w: number; h: number }>): [number, number] {
    const o = st.obj;
    const z = this.camera.zoom;
    const k = st.sprite.scale ?? 1;
    const { width: W, height: H } = st.sprite.canvas;
    const cx = isoToScreen(o.x + (o.w ?? 1) / 2, o.y + (o.d ?? 1) / 2).x;
    // the roof's top above the footprint's centre (skip thin masts: need a few solid pixels in the row)
    const col = Math.floor((cx - st.dx) * k);
    let top = 0;
    for (let y = 0; y < H; y++) {
      let n = 0;
      for (let x = Math.max(0, col - 12); x < Math.min(W, col + 12); x++) n += st.sprite.mask[y * W + x];
      if (n >= 8) {
        top = y;
        break;
      }
    }
    const roofY = st.dy + top / k;
    const [sx0, sy0] = this.camera.toScreen(cx, roofY, this.vw, this.vh);
    const clear = (bx: number, by: number) => {
      const x0 = bx - w / 2;
      const y0 = by - h;
      for (const r of placed) if (x0 < r.x + r.w + 4 && r.x < x0 + w + 4 && y0 < r.y + r.h + 3 && r.y < y0 + h + 3) return false;
      for (let i = 0; i <= 6; i++)
        for (let j = 0; j <= 3; j++) {
          const [wx, wy] = this.camera.toWorld(x0 + (w * i) / 6, y0 + (h * j) / 3, this.vw, this.vh);
          if (this.onOtherBuilding(st, wx, wy)) return false;
        }
      return true;
    };
    const drop = (H / k) * 0.6 * z; // how far down its own drawing a label may come
    for (let dy = -4; dy <= drop; dy += 6)
      for (const dx of [0, -0.25, 0.25, -0.5, 0.5]) {
        const bx = Math.round(sx0 + dx * w);
        const by = Math.round(sy0 + dy);
        if (clear(bx, by)) return [bx, by];
      }
    return [Math.round(sx0), Math.round(sy0 + drop * 0.3)];
  }

  private drawBadges() {
    const c = this.ctx;
    const z = this.camera.zoom;
    const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
    // front-most buildings choose first (they hide the ones behind them)
    const buildings = this.statics.filter((st) => st.obj.building && st.obj.roomId).sort((a, b) => b.obj.x + b.obj.y - (a.obj.x + a.obj.y));
    for (const s of buildings) {
      const o = s.obj;
      if (!o.roomId) continue;
      const b = this.badges.get(o.roomId);
      const hovered = this.hover?.kind === 'object' && this.hover.id === o.id;
      const name = `${b?.emoji ?? ''} ${b?.name ?? o.label ?? ''}`.trim();
      const occupied = !!b && b.count > 0;
      // Zoomed out, a badge only says who's where: an empty building shows nothing (its name on hover), never
      // a "0". Closer in, every building carries its name as a sign, with faces and a count when occupied.
      if (z < 1.4 && !occupied && !hovered && !b?.event) continue;
      const label = z < 1.4 && !hovered && occupied ? `${b.emoji} ${b.count}`.trim() : name;
      const size = z < 1.4 ? 11 : 12;
      c.font = `800 ${size}px ${UI_FONT}`;
      const lw = Math.ceil(c.measureText(label).width) + 14 + (b && b.count > 0 && z >= 1.4 ? Math.min(4, b.faces.length) * 13 + 22 : 0);
      const lh = size + 9 + (b?.event ? size + 13 : 0);
      const [sx, sy] = this.labelSpot(s, lw, lh, placed);
      if (sx < -200 || sx > this.vw + 200 || sy < -60 || sy > this.vh + 100) continue;
      placed.push({ x: sx - lw / 2, y: sy - lh, w: lw, h: lh });
      const main = pill(c, sx, sy, label, { size, bg: hovered ? '#ffffff' : PAPER });
      this.badgeRects.push({ r: main, obj: o });
      let right = main.x + main.w - 4;
      if (b && b.count > 0 && z >= 1.4) {
        // faces
        const faces = b.faces.slice(0, 4);
        const fw = faces.length * 13 + 26;
        const fx = right;
        const fy = main.y + 1;
        c.fillStyle = b.openCount ? '#2fbf71' : '#5fb0ff';
        roundRect(c, fx, fy, fw, main.h - 2, (main.h - 2) / 2);
        c.fill();
        c.lineWidth = 2;
        c.strokeStyle = INK_CSS;
        c.stroke();
        faces.forEach((L, i) => {
          const spr = avatarSprite(L, 'se', 'stand');
          const fc = AVATAR_CROPS.face;
          c.drawImage(spr.canvas, fc.x, fc.y, fc.w, fc.h, fx + 5 + i * 13, fy + 1, 14, 14);
        });
        c.font = `800 11px ${UI_FONT}`;
        c.fillStyle = '#ffffff';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(String(b.count), fx + fw - 11, fy + (main.h - 2) / 2 + 1);
        this.badgeRects.push({ r: { x: fx, y: fy, w: fw, h: main.h }, obj: o });
        right = fx + fw;
      }
      if (b?.event) {
        const bob = this.reducedMotion ? 0 : Math.sin(performance.now() / 300) * 2;
        const ev = pill(c, sx, main.y - 4 + bob, b.event, { size: 11, bg: '#e24c9c', fg: '#ffffff' });
        this.badgeRects.push({ r: ev, obj: o });
      }
    }
  }

  private drawTransition() {
    const tr = this.transition;
    if (!tr) return;
    const c = this.ctx;
    const maxR = Math.hypot(this.vw, this.vh) / 2 + 20;
    const e = (k: number) => k * k * (3 - 2 * k);
    if (tr.phase === 'hold') {
      c.fillStyle = '#1b1623';
      c.fillRect(0, 0, this.vw, this.vh);
      return;
    }
    const k = Math.min(1, tr.t);
    if (this.reducedMotion) {
      c.fillStyle = `rgba(27,22,35,${tr.phase === 'close' ? e(k) : 1 - e(k)})`;
      c.fillRect(0, 0, this.vw, this.vh);
      return;
    }
    const r = tr.phase === 'close' ? maxR * (1 - e(k)) : maxR * e(k);
    c.fillStyle = '#1b1623';
    c.beginPath();
    c.rect(0, 0, this.vw, this.vh);
    c.arc(this.vw / 2, this.vh / 2, Math.max(0, r), 0, Math.PI * 2, true);
    c.fill('evenodd');
  }

  /* ------------------------------------------------------------------ input */

  private toArt(ev: PointerEvent | MouseEvent): { sx: number; sy: number; ax: number; ay: number } {
    const r = this.canvas.getBoundingClientRect();
    const sx = ev.clientX - r.left;
    const sy = ev.clientY - r.top;
    const [ax, ay] = this.camera.toWorld(sx, sy, this.vw, this.vh);
    return { sx, sy, ax, ay };
  }

  private hitTest(sx: number, sy: number, ax: number, ay: number):
    | { kind: 'actor'; id: string }
    | { kind: 'object'; obj: SceneObject }
    | { kind: 'tile'; tile: Tile }
    | null {
    for (let i = this.badgeRects.length - 1; i >= 0; i--) {
      const { r, obj } = this.badgeRects[i];
      if (sx >= r.x && sx <= r.x + r.w && sy >= r.y && sy <= r.y + r.h) return { kind: 'object', obj };
    }
    const order = this.buildDrawOrder();
    for (let i = order.length - 1; i >= 0; i--) {
      const d = order[i];
      if ('obj' in d) {
        const o = d.obj;
        const interactive = !!(o.actions?.length || o.building || o.artifactId);
        if (!interactive) continue;
        const k = d.sprite.scale ?? 1;
        const px = Math.floor((ax - d.dx) * k);
        const py = Math.floor((ay - d.dy) * k);
        const w = d.sprite.canvas.width;
        if (px < 0 || py < 0 || px >= w || py >= d.sprite.canvas.height) continue;
        if (d.sprite.mask[py * w + px]) return { kind: 'object', obj: o };
      } else {
        const r = d.rect;
        if (ax >= r.l + 3 && ax <= r.r - 3 && ay >= r.t + 2 && ay <= r.b) return { kind: 'actor', id: d.occ.memberId };
      }
    }
    for (const h of this.ground?.wallHits ?? []) {
      if (pointInPoly(ax, ay, h.poly)) return { kind: 'object', obj: h.obj };
    }
    const g = screenToIso(ax, ay);
    const tile: Tile = [Math.floor(g.x), Math.floor(g.y)];
    if (this.scene && tile[0] >= 0 && tile[1] >= 0 && tile[0] < this.scene.width && tile[1] < this.scene.height)
      return { kind: 'tile', tile };
    return null;
  }

  private onDown = (ev: PointerEvent) => {
    this.pointer = { down: true, x: ev.clientX, y: ev.clientY, sx: ev.clientX, sy: ev.clientY, moved: false, id: ev.pointerId };
    this.canvas.setPointerCapture(ev.pointerId);
  };

  private onMove = (ev: PointerEvent) => {
    if (this.pointer.down) {
      const dx = ev.clientX - this.pointer.x;
      const dy = ev.clientY - this.pointer.y;
      if (!this.pointer.moved && Math.hypot(ev.clientX - this.pointer.sx, ev.clientY - this.pointer.sy) > 5) this.pointer.moved = true;
      if (this.pointer.moved) {
        this.camera.panBy(dx, dy);
        this.canvas.style.cursor = 'grabbing';
      }
      this.pointer.x = ev.clientX;
      this.pointer.y = ev.clientY;
      return;
    }
    const { sx, sy, ax, ay } = this.toArt(ev);
    const hit = this.hitTest(sx, sy, ax, ay);
    const prev = this.hover;
    if (hit?.kind === 'actor') this.hover = { kind: 'actor', id: hit.id };
    else if (hit?.kind === 'object') this.hover = { kind: 'object', id: hit.obj.id };
    else this.hover = null;
    const nextTile = hit?.kind === 'tile' ? hit.tile : null;
    if (nextTile?.join() !== this.hoverTile?.join()) this.cb.onHoverTile?.(nextTile);
    this.hoverTile = nextTile;
    this.canvas.style.cursor = this.hover ? 'pointer' : 'default';
    if (prev?.id !== this.hover?.id) {
      const label =
        hit?.kind === 'actor' ? this.cb.nameOf(hit.id) : hit?.kind === 'object' ? (hit.obj.label ?? null) : null;
      this.cb.onHover?.(label);
    }
  };

  private onUp = (ev: PointerEvent) => {
    const wasDrag = this.pointer.moved;
    this.pointer.down = false;
    this.canvas.style.cursor = 'default';
    try {
      this.canvas.releasePointerCapture(ev.pointerId);
    } catch {
      /* noop */
    }
    if (wasDrag || this.transition) return;
    const { sx, sy, ax, ay } = this.toArt(ev);
    const hit = this.hitTest(sx, sy, ax, ay);
    if (!hit) return;
    if (hit.kind === 'actor') this.cb.onActorClick(hit.id, { x: sx, y: sy });
    else if (hit.kind === 'object') this.cb.onObjectClick(hit.obj, { x: sx, y: sy });
    else this.cb.onGroundClick(hit.tile);
  };

  private onLeave = () => {
    this.hover = null;
    this.hoverTile = null;
  };

  private onDbl = (ev: MouseEvent) => {
    const { sx, sy, ax, ay } = this.toArt(ev);
    const hit = this.hitTest(sx, sy, ax, ay);
    if (hit?.kind === 'object') this.cb.onObjectActivate(hit.obj);
  };

  private wheelAcc = 0;

  private onWheel = (ev: WheelEvent) => {
    ev.preventDefault();
    const { sx, sy } = this.toArt(ev);
    if (!this.camera.pixelStep) {
      this.camera.zoomAt(Math.exp(-ev.deltaY * 0.0015), sx, sy, this.vw, this.vh);
      return;
    }
    // Pixel-perfect zoom moves in whole steps: collect wheel motion until it amounts to one.
    this.wheelAcc += ev.deltaY;
    if (Math.abs(this.wheelAcc) < 90) return;
    this.camera.zoomAt(this.wheelAcc < 0 ? 2 : 0.5, sx, sy, this.vw, this.vh);
    this.wheelAcc = 0;
  };
}

function pointInPoly(x: number, y: number, poly: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
