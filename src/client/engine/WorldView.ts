/**
 * WorldView renders one scene and turns pointer input into intents. It owns no product logic:
 * the Game controller decides what a click means (walk, open a profile, enter a building).
 */
import type { AvatarLoadout } from '@shared/domain/types';
import type { Occupant } from '@shared/protocol';
import { EMOTES, STATUS_META, type EmoteId } from '@shared/presence';
import { isoToScreen, screenToIso } from '@shared/iso';
import type { Facing, SceneDef, SceneObject } from '@shared/world/scene';
import { footprint } from '@shared/world/scene';
import { positionAlong, type Tile } from '@shared/world/pathfinding';
import { Camera } from './camera';
import { behind, rectsOverlap, topoSort, type Box, type ScreenRect } from './depth';
import { Effects } from './effects';
import { renderInteriorGround, renderOutdoorGround, type GroundLayer } from './ground';
import { INK_CSS, PAPER, UI_FONT, pill, roundRect, speechBubble } from './overlays';
import { avatarSprite, type Pose } from './sprites/avatar';
import { festiveFor, spriteFor } from './sprites/registry';
import { highlightOf, type Sprite } from './sprites/painter';

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
  rect: ScreenRect;
  sx: number;
  sy: number;
}

const facingFrom = (dx: number, dy: number, prev: Facing): Facing => {
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return prev;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'se' : 'nw';
  return dy > 0 ? 'sw' : 'ne';
};

const SEAT_LIFT: Record<string, number> = { chair: 5, bench: 5, stool: 7, couch: 4, armchair: 4, beanbag: 1 };

export class WorldView {
  readonly camera = new Camera();
  readonly effects = new Effects();
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private vw = 0;
  private vh = 0;
  private scene: SceneDef | null = null;
  private ground: GroundLayer | null = null;
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
    this.hover = null;
    this.selectedActor = null;
    this.dest = null;
    this.ground =
      scene.kind === 'outdoor'
        ? renderOutdoorGround(scene)
        : renderInteriorGround(scene, { activeDecor: opts.activeDecor, bannerText: opts.bannerText });
    const statics: Static[] = [];
    this.stageBoxes = [];
    for (const o of scene.objects) {
      if (o.flat) {
        if (o.sprite === 'stage') this.stageBoxes.push(footprint(o));
        continue;
      }
      if (o.wall) continue;
      if (o.eventDecor && !opts.activeDecor.has(o.eventDecor)) continue;
      const sprite = spriteFor(o);
      if (!sprite) continue;
      const p = isoToScreen(o.x, o.y);
      const dx = p.x - sprite.ax;
      const dy = p.y - sprite.ay;
      statics.push({
        obj: o,
        sprite,
        dx,
        dy,
        box: footprint(o),
        rect: { l: dx, t: dy, r: dx + sprite.canvas.width, b: dy + sprite.canvas.height },
        festive: o.building && o.roomId && this.festiveRooms.has(o.roomId) ? festiveFor(o) : null,
      });
    }
    this.statics = topoSort(statics);
    this.actors.clear();
    for (const o of occupants) this.upsert(o);
    this.effects.reducedMotion = this.reducedMotion;
    this.effects.load(scene, { party: opts.party });

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
      const me = this.actors.get(this.meId);
      const c = me ? isoToScreen(me.x + 0.5, me.y + 0.5) : isoToScreen(scene.spawn.x, scene.spawn.y);
      const z = this.vw < 700 ? 1.5 : 2;
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
    const z = Math.floor(fit * 4) / 4 || fit;
    this.camera.minZoom = Math.max(1, z * 0.75);
    this.camera.maxZoom = 5;
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
      existing.occ = { ...existing.occ, ...o };
      if (!o.path) {
        existing.x = o.x;
        existing.y = o.y;
      }
      if (o.facing) existing.facing = o.facing;
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
      rect: { l: 0, t: 0, r: 0, b: 0 },
      sx: 0,
      sy: 0,
    });
  }

  remove(memberId: string) {
    this.actors.delete(memberId);
    if (this.selectedActor === memberId) this.selectedActor = null;
  }

  patch(memberId: string, patch: Partial<Occupant>) {
    const a = this.actors.get(memberId);
    if (!a) return;
    const hasPath = 'path' in patch;
    a.occ = { ...a.occ, ...patch };
    if (hasPath && !patch.path) {
      a.occ.path = undefined;
      a.occ.pathStartedAt = undefined;
    }
    if (patch.x !== undefined && patch.y !== undefined && !a.occ.path) {
      a.x = patch.x;
      a.y = patch.y;
    }
    if (patch.facing) a.facing = patch.facing;
  }

  move(memberId: string, path: Tile[], startedAt: number) {
    const a = this.actors.get(memberId);
    if (!a) return;
    a.occ = { ...a.occ, path, pathStartedAt: startedAt, sittingOn: undefined };
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

  actorTile(id: string): Tile | null {
    const a = this.actors.get(id);
    if (!a) return null;
    const p = this.livePos(a);
    return [Math.round(p.x), Math.round(p.y)];
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
    const p = isoToScreen(a.x + 0.5, a.y + 0.5, 30);
    if (emote === 'celebrate') this.effects.burst(p.x, p.y, 'confetti', 30);
    if (emote === 'heart') this.effects.burst(p.x, p.y, 'hearts', 8);
    if (emote === 'clap' || emote === 'idea') this.effects.burst(p.x, p.y, 'sparkle', 8);
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
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    this.update(dt);
    this.draw();
    this.raf = requestAnimationFrame(this.frame);
  };

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
        if (p.done) {
          a.occ.path = undefined;
          a.occ.pathStartedAt = undefined;
          a.occ.x = p.x;
          a.occ.y = p.y;
        }
      } else {
        a.moving = false;
        if (a.occ.sittingOn) a.facing = a.occ.facing;
      }
      a.walkClock = a.moving ? a.walkClock + dt : 0;
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
    if (this.transition && this.transition.phase !== 'hold') {
      this.transition.t += dt / (this.transition.phase === 'close' ? 0.32 : 0.42);
      if (this.transition.t >= 1) {
        if (this.transition.phase === 'close') this.runMid(this.transition.mid);
        else this.transition = null;
      }
    }
  }

  private actorLift(a: ActorView): number {
    if (a.occ.sittingOn && this.scene) {
      const o = this.scene.objects.find((x) => x.id === a.occ.sittingOn);
      if (o) return SEAT_LIFT[o.sprite] ?? 4;
    }
    for (const b of this.stageBoxes) {
      if (a.x + 0.5 >= b.x0 && a.x + 0.5 < b.x1 && a.y + 0.5 >= b.y0 && a.y + 0.5 < b.y1) return 6;
    }
    return 0;
  }

  private pose(a: ActorView): Pose {
    if (a.occ.sittingOn && !a.moving) return 'sit';
    if (performance.now() < a.waveUntil) return 'wave';
    if (a.moving) {
      const f = Math.floor(a.walkClock * 8) % 4;
      return f === 0 ? 'walk1' : f === 2 ? 'walk2' : 'stand';
    }
    return 'stand';
  }

  private draw() {
    const c = this.ctx;
    const { dpr, vw, vh } = this;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.imageSmoothingEnabled = false;
    const outdoor = this.scene?.kind === 'outdoor';
    const bg = c.createLinearGradient(0, 0, 0, this.canvas.height);
    if (outdoor) {
      bg.addColorStop(0, '#bfe7ef');
      bg.addColorStop(1, '#f7ecd9');
    } else {
      bg.addColorStop(0, '#2d2538');
      bg.addColorStop(1, '#1b1623');
    }
    c.fillStyle = bg;
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.scene || !this.ground) return;

    const z = this.camera.zoom;
    const s = z * dpr;
    const tx = dpr * (vw / 2 - this.camera.x * z);
    const ty = dpr * (vh / 2 - this.camera.y * z);
    c.setTransform(s, 0, 0, s, Math.round(tx), Math.round(ty));
    c.imageSmoothingEnabled = false;
    c.drawImage(this.ground.canvas, this.ground.minX, this.ground.minY);

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
      const p = isoToScreen(a.x + 0.5, a.y + 0.5, this.actorLift(a));
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

    // depth-sorted statics + actors
    const order = this.buildDrawOrder();
    for (const d of order) {
      if ('obj' in d) {
        const hovered = this.hover?.kind === 'object' && this.hover.id === d.obj.id;
        if (hovered) c.drawImage(highlightOf(d.sprite), d.dx - 2, d.dy - 2);
        else c.drawImage(d.sprite.canvas, d.dx, d.dy);
        if (d.festive) c.drawImage(d.festive.canvas, d.dx, d.dy);
      } else {
        this.drawActor(d);
      }
    }
    if (this.ghost) {
      const g = this.ghost;
      this.diamond(g.obj.x, g.obj.y, g.valid ? 'rgba(47,191,113,0.95)' : 'rgba(224,80,63,0.95)', 1.5);
      const sprite = spriteFor(g.obj);
      if (sprite) {
        const p = isoToScreen(g.obj.x, g.obj.y);
        c.globalAlpha = g.valid ? 0.75 : 0.35;
        c.drawImage(sprite.canvas, p.x - sprite.ax, p.y - sprite.ay);
        c.globalAlpha = 1;
      }
    }
    this.effects.drawOver(c);

    // X-ray: faint silhouettes where buildings hide people, so nobody gets lost behind a roof.
    for (const d of order) {
      if ('obj' in d) continue;
      const sprite = avatarSprite(d.occ.avatar, d.facing, this.pose(d));
      c.globalAlpha = d.occ.memberId === this.meId ? 0.5 : 0.28;
      c.drawImage(sprite.canvas, Math.round(d.sx - sprite.ax), Math.round(d.sy - sprite.ay));
    }
    c.globalAlpha = 1;

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
      const lift = this.actorLift(a);
      const p = isoToScreen(a.x + 0.5, a.y + 0.5, lift);
      a.sx = p.x;
      a.sy = p.y;
      a.rect = { l: p.x - 12, t: p.y - 42, r: p.x + 12, b: p.y + 2 };
      const box: Box = { x0: a.x, y0: a.y, x1: a.x + 1, y1: a.y + 1 };
      let slot = 0;
      for (let i = 0; i < statics.length; i++) {
        const s = statics[i];
        if (!rectsOverlap(s.rect, a.rect)) continue;
        let isBehind: boolean;
        if (a.occ.sittingOn === s.obj.id) isBehind = !(a.facing === 'ne' || a.facing === 'nw');
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

  private drawActor(a: ActorView) {
    const c = this.ctx;
    const sprite = avatarSprite(a.occ.avatar, a.facing, this.pose(a));
    const hovered = this.hover?.kind === 'actor' && this.hover.id === a.occ.memberId;
    const x = Math.round(a.sx - sprite.ax);
    const y = Math.round(a.sy - sprite.ay);
    if (a.occ.via === 'provider') c.globalAlpha = 0.72;
    if (hovered) c.drawImage(highlightOf(sprite), x - 2, y - 2);
    else c.drawImage(sprite.canvas, x, y);
    c.globalAlpha = 1;
  }

  private headScreen(a: ActorView): [number, number] {
    const top = a.occ.sittingOn ? 36 : 42;
    return this.camera.toScreen(a.sx, a.sy - top, this.vw, this.vh);
  }

  private drawActorOverlays() {
    const c = this.ctx;
    const z = this.camera.zoom;
    const interior = this.scene?.kind === 'interior';
    const now = performance.now();
    const list = [...this.actors.values()].sort((p, q) => p.sy - q.sy);
    for (const a of list) {
      const [hx, hy] = this.headScreen(a);
      if (hx < -100 || hy < -100 || hx > this.vw + 100 || hy > this.vh + 200) continue;
      const id = a.occ.memberId;
      const isMe = id === this.meId;
      const hovered = this.hover?.kind === 'actor' && this.hover.id === id;
      const showName = hovered || id === this.selectedActor || this.showAllNames || (interior ? z >= 1.5 : z >= 2.6) || !!a.bubble;
      let top = hy - 4;
      // status dot
      const meta = STATUS_META[a.occ.status];
      c.fillStyle = INK_CSS;
      c.beginPath();
      c.arc(hx + 9 * Math.min(z, 3) / 2, hy + 4, 4.5, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = meta.color;
      c.beginPath();
      c.arc(hx + 9 * Math.min(z, 3) / 2, hy + 4, 3, 0, Math.PI * 2);
      c.fill();

      if (showName) {
        const name = isMe ? 'You' : this.cb.nameOf(id).split(' ')[0];
        const voice = a.occ.voice ? ' 🎧' : a.occ.via === 'provider' ? ' 🎧' : '';
        const r = pill(c, hx, top, name + voice, {
          size: 11,
          bg: isMe ? '#ffd23f' : hovered ? '#ffffff' : 'rgba(255,248,236,0.94)',
          padX: 6,
        });
        top = r.y - 3;
      } else if (isMe) {
        const bob = this.reducedMotion ? 0 : Math.sin(now / 250) * 2;
        c.fillStyle = '#ffd23f';
        c.strokeStyle = INK_CSS;
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(hx - 6, top - 10 + bob);
        c.lineTo(hx + 6, top - 10 + bob);
        c.lineTo(hx, top - 2 + bob);
        c.closePath();
        c.fill();
        c.stroke();
        top -= 12;
      }
      if (a.bubble) {
        const age = now - a.bubble.start;
        const alpha = Math.min(1, age / 150, (a.bubble.until - now) / 400);
        top = speechBubble(c, hx, top, a.bubble.text, Math.max(0, alpha)) - 2;
      }
      for (const e of a.emotes) {
        const k = (now - e.start) / 1800;
        const rise = (this.reducedMotion ? 0.3 : k) * 34;
        const pop = k < 0.12 ? 0.6 + (k / 0.12) * 0.6 : 1.2 - Math.min(0.2, (k - 0.12) * 0.4);
        c.globalAlpha = Math.max(0, 1 - Math.max(0, k - 0.6) / 0.4);
        c.font = `${Math.round(20 * pop)}px ${UI_FONT}`;
        c.textAlign = 'center';
        c.textBaseline = 'bottom';
        c.fillText(e.emoji, hx, top - rise);
        c.globalAlpha = 1;
      }
    }
  }

  private drawBadges() {
    const c = this.ctx;
    const z = this.camera.zoom;
    for (const s of this.statics) {
      const o = s.obj;
      if (!o.building || !o.roomId) continue;
      const b = this.badges.get(o.roomId);
      const cxArt = isoToScreen(o.x + (o.w ?? 1) / 2, o.y + (o.d ?? 1) / 2).x;
      const [sx, sy] = this.camera.toScreen(cxArt, s.dy + 8, this.vw, this.vh);
      if (sx < -200 || sx > this.vw + 200 || sy < -60 || sy > this.vh + 100) continue;
      const hovered = this.hover?.kind === 'object' && this.hover.id === o.id;
      const label = z < 1.4 ? `${b?.emoji ?? ''} ${b?.count ?? 0}` : `${b?.emoji ?? ''} ${o.label ?? ''}`;
      const main = pill(c, sx, sy, label, { size: z < 1.4 ? 11 : 12, bg: hovered ? '#ffffff' : PAPER });
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
          c.drawImage(spr.canvas, 6, 4, 14, 14, fx + 5 + i * 13, fy + 1, 14, 14);
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
        const px = Math.floor(ax - d.dx);
        const py = Math.floor(ay - d.dy);
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

  private onWheel = (ev: WheelEvent) => {
    ev.preventDefault();
    const { sx, sy } = this.toArt(ev);
    const f = Math.exp(-ev.deltaY * 0.0015);
    this.camera.zoomAt(f, sx, sy, this.vw, this.vh);
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
