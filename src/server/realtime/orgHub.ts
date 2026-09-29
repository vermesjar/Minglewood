/**
 * OrgHub: authoritative realtime state for one organization.
 *
 * - Actors (live users, simulated demo coworkers, and provider-present members such as people
 *   sitting in a Discord voice channel) occupy exactly one scene.
 * - Sockets subscribe to one scene and receive fine-grained updates only for it.
 * - Org-wide awareness is a coarse, throttled, per-viewer-filtered `directory`.
 *
 * Privacy: presence is current-state only. Nothing here records history, durations or activity.
 */
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { Member, OrgEvent, PresenceState, PresenceStatus } from '@shared/domain/types';
import { CARRYABLE, NOTES_PER_BOARD, type BoardNote, type DirectoryEntry, type KnockKind, type KnockReply, type Occupant, type ServerMsg } from '@shared/protocol';
import type { EmoteId } from '@shared/presence';
import { STATUS_META } from '@shared/presence';
import { allScenes, buildingForRoom, getScene, TOWN_ID } from '@shared/world';
import { livedScene } from '@shared/world/lived';
import type { Facing, SceneDef, SceneObject } from '@shared/world/scene';
import { footprint, isSeat, terrainAt } from '@shared/world/scene';
import { seatSpotAt, seatSpots, stepOffTiles } from '@shared/world/seats';
import { NpcDirector } from './npcs';
import { CLAW_DROP_MS, NOTE_GAP_MS, USE_COOLDOWN_MS, USE_PERSON_GAP_MS, cleanNote, outcomeOf } from './uses';
import { WalkGrid } from '@shared/world/walkGrid';
import { findPath, isValidPath, pathLength, positionAlong, WALK_SPEED, type Tile } from '@shared/world/pathfinding';
import { sanitizeLoadout } from '@shared/avatar';
import type { Store } from '../store/store';

/** A self-serve machine's moment: the scoop, the thunk of the can. */
export const SELF_SERVE_MS = 700;

/** How far back a client may date a path it is extending (a little more than one diagonal step plus latency). */
const MAX_PATH_BACKDATE_MS = 1500;
/** The ground a stroll keeps to: streets, the plaza, the pier and the footpaths. */
const STROLL_WAYS = new Set(['p', 'P', 'd', 't']);

export interface HubClient {
  id: string;
  memberId: string;
  sceneId: string | null;
  send(msg: ServerMsg): void;
}

interface Actor {
  memberId: string;
  sceneId: string;
  x: number;
  y: number;
  facing: Facing;
  path?: Tile[];
  pathStartedAt?: number;
  sittingOn?: string;
  via: Occupant['via'];
  speaking?: boolean;
}

interface Knock {
  id: string;
  fromId: string;
  targetId: string;
  kind: KnockKind;
  at: number;
}

export type HubEvents = {
  entered: [memberId: string, sceneId: string, via: Occupant['via']];
  emote: [memberId: string, emote: EmoteId, sceneId: string, targetId?: string];
  said: [memberId: string, text: string, sceneId: string];
  knock: [knock: Knock];
  /** A knock for someone who isn't in the world (providers may deliver it elsewhere, e.g. a Slack DM). */
  missedKnock: [knock: Knock];
};

const facingFromDir = (dx: number, dy: number, prev: Facing): Facing => {
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return prev;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'se' : 'nw';
  return dy > 0 ? 'sw' : 'ne';
};

export class OrgHub extends EventEmitter<HubEvents> {
  private clients = new Map<string, HubClient>();
  private actors = new Map<string, Actor>();
  /** What people are carrying (memberId → held item); live state, cleared when they leave. */
  private carrying = new Map<string, string>();
  /** Switchable things (lamps) per scene: objectId → on. Live room state, like a real room's lamps. */
  private objStates = new Map<string, Map<string, boolean>>();
  private presence = new Map<string, PresenceState>();
  private grids = new Map<string, WalkGrid>();
  private knocks = new Map<string, Knock>();
  private heldKnocks = new Map<string, Knock[]>();
  private beforeQuiet = new Map<string, Pick<PresenceState, 'status' | 'note'>>();
  private directoryDirty = true;
  private timer: NodeJS.Timeout;
  /** People who work in rooms (the café's barista). */
  readonly npcs: NpcDirector;
  /** Orders being made for someone (member → machine), so a second click doesn't order twice. */
  private ordering = new Map<string, string>();

  constructor(
    readonly orgId: string,
    private readonly store: Store,
  ) {
    super();
    this.rebuildGrids();
    this.npcs = new NpcDirector({
      scene: (id) => this.scene(id),
      toScene: (sceneId, msg) => this.toScene(sceneId, msg),
      nameOf: (id) => this.member(id)?.displayName,
    });
    this.timer = setInterval(() => this.tick(), 1000);
  }

  dispose() {
    clearInterval(this.timer);
    this.npcs.dispose();
    for (const t of this.selfServe) clearTimeout(t);
  }

  /* ------------------------------------------------------------------ state helpers */

  private get data() {
    return this.store.get(this.orgId);
  }

  activeEvents(now = Date.now()): OrgEvent[] {
    return this.data.events.filter((e) => Date.parse(e.startsAt) <= now && now < Date.parse(e.endsAt));
  }

  private activeDecor(): Set<string> {
    return new Set(this.activeEvents().map((e) => e.decor));
  }

  /** The scene as lived in: authored layout + memory-wall artifacts + team decorations. */
  scene(sceneId: string): SceneDef | undefined {
    const base = getScene(sceneId);
    return base && livedScene(base, this.data.artifacts, this.data.decorations);
  }

  rebuildGrids() {
    const decor = this.activeDecor();
    for (const id of allScenes().keys()) this.grids.set(id, new WalkGrid(this.scene(id)!, decor));
  }

  /** Teams changed their room: rebuild walkability and tell everyone. */
  decorChanged(roomId: string, by?: string) {
    this.rebuildGrids();
    this.broadcast({ t: 'decor', decorations: this.data.decorations, roomId, by });
  }

  grid(sceneId: string): WalkGrid | undefined {
    return this.grids.get(sceneId);
  }

  member(id: string): Member | undefined {
    return this.store.member(this.orgId, id);
  }

  actor(memberId: string): Actor | undefined {
    return this.actors.get(memberId);
  }

  actorsIn(sceneId: string): Actor[] {
    return [...this.actors.values()].filter((a) => a.sceneId === sceneId);
  }

  presenceOf(memberId: string): PresenceState {
    let p = this.presence.get(memberId);
    if (!p) {
      p = { memberId, status: 'offline', source: 'default' };
      this.presence.set(memberId, p);
    }
    return p;
  }

  isLive(memberId: string): boolean {
    for (const c of this.clients.values()) if (c.memberId === memberId) return true;
    return false;
  }

  /** Current interpolated tile position. */
  position(a: Actor, now = Date.now()): { x: number; y: number; moving: boolean } {
    if (!a.path || a.pathStartedAt === undefined) return { x: a.x, y: a.y, moving: false };
    const p = positionAlong(a.path, now - a.pathStartedAt);
    if (p.done) {
      a.x = p.x;
      a.y = p.y;
      a.facing = facingFromDir(p.dir[0], p.dir[1], a.facing);
      a.path = undefined;
      a.pathStartedAt = undefined;
      return { x: a.x, y: a.y, moving: false };
    }
    return { x: p.x, y: p.y, moving: true };
  }

  occupant(a: Actor): Occupant {
    const m = this.member(a.memberId);
    const p = this.presenceOf(a.memberId);
    this.position(a);
    return {
      memberId: a.memberId,
      x: a.x,
      y: a.y,
      facing: a.facing,
      path: a.path,
      pathStartedAt: a.pathStartedAt,
      sittingOn: a.sittingOn,
      carrying: this.carrying.get(a.memberId),
      status: p.status,
      note: p.note,
      avatar: m!.avatar,
      via: a.via,
      voice: p.voice,
      speaking: a.speaking,
    };
  }

  private toScene(sceneId: string, msg: ServerMsg, except?: string) {
    for (const c of this.clients.values()) if (c.sceneId === sceneId && c.id !== except) c.send(msg);
  }

  private toMember(memberId: string, msg: ServerMsg) {
    for (const c of this.clients.values()) if (c.memberId === memberId) c.send(msg);
  }

  broadcast(msg: ServerMsg) {
    for (const c of this.clients.values()) c.send(msg);
  }

  /* ------------------------------------------------------------------ connections */

  connect(client: HubClient) {
    this.clients.set(client.id, client);
    const p = this.presenceOf(client.memberId);
    if (p.status === 'offline') {
      p.status = 'available';
      p.source = 'default';
    }
    this.directoryDirty = true;
    client.send({
      t: 'welcome',
      you: client.memberId,
      serverTime: Date.now(),
      directory: this.directoryFor(client.memberId),
    });
    client.send({ t: 'events', events: this.data.events });
  }

  disconnect(client: HubClient) {
    this.clients.delete(client.id);
    if (this.isLive(client.memberId)) return;
    this.carrying.delete(client.memberId);
    const a = this.actors.get(client.memberId);
    if (a && a.via === 'live') this.removeActor(client.memberId);
    const p = this.presenceOf(client.memberId);
    if (!p.voice) p.status = 'offline';
    this.directoryDirty = true;
  }

  /* ------------------------------------------------------------------ scene membership */

  /** Places an actor in a scene (live user, sim, or provider). Returns the actor. */
  enter(memberId: string, sceneId: string, via: Occupant['via'], at?: Tile): Actor | null {
    const scene = this.scene(sceneId);
    const grid = this.grids.get(sceneId);
    if (!scene || !grid || !this.member(memberId)) return null;
    const prev = this.actors.get(memberId);
    const fromScene = prev?.sceneId;
    if (prev) this.removeActor(memberId, sceneId);

    const spot = this.arrivalSpot(scene, grid, fromScene, at);
    const actor: Actor = {
      memberId,
      sceneId,
      x: spot.x,
      y: spot.y,
      facing: scene.kind === 'interior' ? 'se' : 'sw',
      via,
    };
    this.actors.set(memberId, actor);
    const p = this.presenceOf(memberId);
    p.sceneId = sceneId;
    if (p.status === 'offline') p.status = 'available';
    // Quiet rooms mean focus; leaving one restores whatever you had before.
    const room = this.data.rooms.find((r) => r.id === sceneId);
    const prevRoom = this.data.rooms.find((r) => r.id === fromScene);
    if (via === 'live' && room?.quiet && !prevRoom?.quiet && p.status !== 'meeting') {
      this.beforeQuiet.set(memberId, { status: p.status, note: p.note });
      p.status = 'focused';
      p.source = 'default';
    } else if (via === 'live' && prevRoom?.quiet && !room?.quiet) {
      const before = this.beforeQuiet.get(memberId);
      this.beforeQuiet.delete(memberId);
      if (p.status === 'focused' && p.source === 'default') {
        p.status = before?.status && before.status !== 'offline' ? before.status : 'available';
        p.note = before?.note;
      }
    }

    for (const c of this.clients.values()) {
      if (c.memberId === memberId) {
        c.sceneId = sceneId;
        c.send({
          t: 'scene',
          sceneId,
          occupants: this.actorsIn(sceneId).map((x) => this.occupant(x)),
          states: this.statesIn(sceneId),
          npcs: this.npcs.statesIn(sceneId),
          notes: this.data.notes.filter((n) => n.sceneId === sceneId),
        });
      }
    }
    this.toScene(sceneId, { t: 'joined', sceneId, occupant: this.occupant(actor) });
    this.directoryDirty = true;
    // whoever works here says hello to people who come in
    if (via === 'live') this.npcs.arrived(sceneId, memberId, [actor.x, actor.y]);
    this.emit('entered', memberId, sceneId, via);
    return actor;
  }

  private arrivalSpot(scene: SceneDef, grid: WalkGrid, fromScene: string | undefined, at?: Tile) {
    // a seat is furniture, but you may arrive straight onto one to sit down (sims, voice channels)
    if (at && (grid.walkable(at[0], at[1]) || seatSpotAt(scene, at[0], at[1]))) return { x: at[0], y: at[1] };
    if (scene.id === TOWN_ID && fromScene && fromScene !== TOWN_ID) {
      const door = buildingForRoom(fromScene)?.door;
      if (door) return this.freeNear(scene.id, grid, door.x, door.y);
    }
    return this.freeNear(scene.id, grid, scene.spawn.x, scene.spawn.y);
  }

  /** A free tile next to another member, if they're in that scene and share their location. */
  spotNear(sceneId: string, memberId?: string): Tile | undefined {
    if (!memberId) return undefined;
    const a = this.actors.get(memberId);
    const m = this.member(memberId);
    if (!a || a.sceneId !== sceneId || m?.settings.locationVisibility !== 'everyone') return undefined;
    const pos = this.position(a);
    const grid = this.grids.get(sceneId)!;
    const s = this.freeNear(sceneId, grid, Math.round(pos.x) + 1, Math.round(pos.y));
    return [s.x, s.y];
  }

  /** A walkable, unoccupied tile near (x,y). */
  freeNear(sceneId: string, grid: WalkGrid, x: number, y: number): { x: number; y: number } {
    const taken = new Set(this.actorsIn(sceneId).map((a) => `${Math.round(a.x)},${Math.round(a.y)}`));
    for (let r = 0; r <= 4; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (grid.walkable(nx, ny) && !taken.has(`${nx},${ny}`)) return { x: nx, y: ny };
        }
      }
    }
    return grid.nearestWalkable(x, y) ?? { x, y };
  }

  removeActor(memberId: string, toSceneId?: string) {
    const a = this.actors.get(memberId);
    if (!a) return;
    this.actors.delete(memberId);
    this.npcs.left(memberId);
    this.toScene(a.sceneId, { t: 'left', sceneId: a.sceneId, memberId, toSceneId });
    const p = this.presenceOf(memberId);
    if (!toSceneId) p.sceneId = undefined;
    this.directoryDirty = true;
  }

  /* ------------------------------------------------------------------ movement */

  /**
   * Client-proposed path (validated). A client walking with held keys extends its path as it goes and
   * sends the time the path started, so everyone keeps interpolating the same motion without a restart.
   * The claimed start is only honoured if it is recent and puts the actor where the server has it now.
   */
  move(memberId: string, path: Tile[], startedAt?: number): boolean {
    const a = this.actors.get(memberId);
    if (!a) return false;
    const grid = this.grids.get(a.sceneId)!;
    const now = Date.now();
    const start = startedAt !== undefined && startedAt >= now - MAX_PATH_BACKDATE_MS && startedAt <= now + 250 ? Math.min(startedAt, now) : now;
    // A walk is judged where it began: its first step against where we had you at the moment it was stamped. (Judged
    // where it has got to by now, a message ~0.4 s late — a slow connection, a busy server — was refused as a jump
    // and snapped you back.) How late it may be is bounded by MAX_PATH_BACKDATE_MS.
    // …but never from before the walk you're already on began (claiming that would skip you ahead along it)
    if (a.path && a.pathStartedAt !== undefined && start < a.pathStartedAt) return false;
    const then = this.position(a, start);
    const from = positionAlong(path, 0);
    if (Math.hypot(from.x - then.x, from.y - then.y) > 1.6) return false;
    const last = path[path.length - 1];
    const seatAtEnd = this.seatAt(a.sceneId, last[0], last[1]);
    if (!isValidPath(grid, path, !!seatAtEnd)) return false;
    this.startPath(a, path, start);
    // walking up to someone who works here: they turn and say hello when you get there
    if (a.via === 'live') this.npcs.walking(a.sceneId, memberId, last, start + pathLength(path) / WALK_SPEED * 1000 - Date.now());
    return true;
  }

  /** Server-computed path (for simulated coworkers). */
  /**
   * Walk someone to a tile. `stroll`: the way a person out for a walk goes — by the streets and footpaths
   * where they lead the right way, cutting across the grass only when that's much shorter (the sims do).
   */
  walkTo(memberId: string, goal: Tile, opts: { stroll?: boolean } = {}): boolean {
    const a = this.actors.get(memberId);
    if (!a) return false;
    const grid = this.grids.get(a.sceneId)!;
    const pos = this.position(a);
    const start: Tile = [Math.round(pos.x), Math.round(pos.y)];
    const scene = opts.stroll ? this.scene(a.sceneId) : undefined;
    const cost = scene?.kind === 'outdoor' ? (x: number, y: number) => (STROLL_WAYS.has(terrainAt(scene, x, y)) ? 1 : 1.45) : undefined;
    const path = findPath(grid, start, goal, { allowGoal: !!this.seatAt(a.sceneId, goal[0], goal[1]), cost });
    if (!path || path.length < 2) return false;
    this.startPath(a, path);
    return true;
  }

  private startPath(a: Actor, path: Tile[], startedAt = Date.now()) {
    a.path = path;
    a.pathStartedAt = startedAt;
    a.sittingOn = undefined;
    a.x = path[0][0];
    a.y = path[0][1];
    this.toScene(a.sceneId, { t: 'moved', memberId: a.memberId, path, startedAt: a.pathStartedAt });
  }

  /** The seat whose spot (any cushion) is at this tile. */
  seatAt(sceneId: string, x: number, y: number) {
    const scene = this.scene(sceneId);
    return scene ? seatSpotAt(scene, x, y)?.seat : undefined;
  }

  /** Whether every spot on a seat is taken by someone else (a couch seats one per cushion). */
  seatTaken(sceneId: string, objectId: string, except?: string): boolean {
    return this.freeSpots(sceneId, objectId, except).length === 0;
  }

  private freeSpots(sceneId: string, objectId: string, except?: string) {
    const scene = this.scene(sceneId);
    const seat = scene?.objects.find((o) => o.id === objectId);
    if (!scene || !seat) return [];
    const sitters = this.actorsIn(sceneId).filter((a) => a.sittingOn === objectId && a.memberId !== except);
    return seatSpots(seat, scene).filter((s) => !sitters.some((a) => a.x === s.x && a.y === s.y));
  }

  /**
   * Sit on the nearest free spot of a seat. You must be at it: standing next to it, or arriving on it as the
   * last step of a walk.
   */
  sit(memberId: string, objectId: string, at?: Tile): boolean {
    const a = this.actors.get(memberId);
    if (!a) return false;
    const seat = this.scene(a.sceneId)?.objects.find((o) => o.id === objectId && isSeat(o));
    if (!seat) return false;
    // already on this cushion: nothing to do (re-clicking your own seat never moves you)
    if (a.sittingOn === seat.id && (!at || (a.x === at[0] && a.y === at[1]))) return true;
    const pos = this.position(a);
    const free = this.freeSpots(a.sceneId, objectId, memberId);
    // The cushion you walked to is yours if it's free and you're at it, or your walk ends on it (the client
    // sends this as it arrives, a moment before the server's own clock gets there).
    const last = a.path?.[a.path.length - 1];
    const asked = at ? free.find((s) => s.x === at[0] && s.y === at[1]) : undefined;
    const arriving = !!asked && !!last && last[0] === asked.x && last[1] === asked.y;
    // on this couch already: any free cushion of it is a slide along the seat, however long the couch
    const sliding = !!asked && a.sittingOn === seat.id;
    const spot =
      asked && (arriving || sliding || Math.hypot(pos.x - asked.x, pos.y - asked.y) <= 1.6)
        ? { s: asked, d: 0 }
        : free.map((s) => ({ s, d: Math.hypot(pos.x - s.x, pos.y - s.y) })).sort((p, q) => p.d - q.d)[0];
    if (!spot || spot.d > 1.6) return false;
    a.path = undefined;
    a.pathStartedAt = undefined;
    a.x = spot.s.x;
    a.y = spot.s.y;
    a.sittingOn = seat.id;
    a.facing = spot.s.facing;
    this.toScene(a.sceneId, {
      t: 'updated',
      memberId,
      patch: { x: a.x, y: a.y, sittingOn: seat.id, facing: a.facing, path: undefined },
    });
    return true;
  }

  /**
   * Pick something up from an object that hands things out (you must be standing at it), or put down
   * what you're carrying (objectId null). Carrying follows you between rooms until you put it down.
   */
  carry(memberId: string, objectId: string | null): boolean {
    const a = this.actors.get(memberId);
    if (!a) return false;
    if (!objectId) {
      this.carrying.delete(memberId);
      this.toScene(a.sceneId, { t: 'updated', memberId, patch: { carrying: null } });
      return true;
    }
    const o = this.scene(a.sceneId)?.objects.find((x) => x.id === objectId);
    const vend = o?.actions?.find((x) => x.kind === 'vend');
    if (!o || !vend || vend.kind !== 'vend' || !(CARRYABLE as readonly string[]).includes(vend.item)) return false;
    const pos = this.position(a);
    const f = footprint(o);
    const dx = Math.max(f.x0 - pos.x, 0, pos.x - (f.x1 - 1));
    const dy = Math.max(f.y0 - pos.y, 0, pos.y - (f.y1 - 1));
    if (Math.hypot(dx, dy) > 1.6) return false;
    if (this.ordering.has(memberId)) return true; // already being made
    this.faceToward(a, o);
    this.toScene(a.sceneId, { t: 'updated', memberId, patch: { x: a.x, y: a.y, facing: a.facing, path: undefined } });
    const item = vend.item;
    const handOver = () => {
      this.ordering.delete(memberId);
      const now = this.actors.get(memberId);
      if (!now) return;
      this.carrying.set(memberId, item);
      this.toScene(now.sceneId, { t: 'updated', memberId, patch: { carrying: item } });
    };
    // Someone works this machine (the café's barista): they make it, then hand it over.
    if (this.npcs.serverFor(a.sceneId, o)) {
      this.ordering.set(memberId, o.id);
      this.npcs.serve(a.sceneId, o, memberId, handOver, item);
      return true;
    }
    // self-serve (the popcorn cart, the snack machine): a brief moment at the machine, then it's yours
    this.ordering.set(memberId, o.id);
    this.toScene(a.sceneId, { t: 'moment', sceneId: a.sceneId, objectId: o.id, what: 'brew', by: memberId });
    const t = setTimeout(() => {
      this.selfServe.delete(t);
      handOver();
    }, SELF_SERVE_MS);
    this.selfServe.add(t);
    return true;
  }

  /** Self-serve hand-overs in flight (cleared on dispose). */
  private selfServe = new Set<ReturnType<typeof setTimeout>>();

  /** Turn a standing actor toward an object (you face the machine you order from). */
  private faceToward(a: Actor, o: { x: number; y: number; w?: number; d?: number }) {
    if (a.sittingOn) return;
    // Someone who orders the moment they arrive may still be finishing the last step here (their own client
    // got there first): they've arrived — settle them on the tile, or the walk's last step would turn them
    // back round when it ends.
    if (this.position(a).moving && a.path) {
      const [x, y] = a.path[a.path.length - 1];
      a.path = undefined;
      a.pathStartedAt = undefined;
      a.x = x;
      a.y = y;
    }
    const dx = o.x + (o.w ?? 1) / 2 - 0.5 - a.x;
    const dy = o.y + (o.d ?? 1) / 2 - 0.5 - a.y;
    a.facing = facingFromDir(dx, dy, a.facing);
  }

  statesIn(sceneId: string): Record<string, boolean> {
    return Object.fromEntries(this.objStates.get(sceneId) ?? []);
  }

  /** Flip a lamp (or anything with a toggle action) for everyone in the room. */
  toggle(memberId: string, objectId: string): boolean {
    const a = this.actors.get(memberId);
    if (!a) return false;
    const o = this.scene(a.sceneId)?.objects.find((x) => x.id === objectId);
    const t = o?.actions?.find((x) => x.kind === 'toggle');
    if (!o || !t || t.kind !== 'toggle') return false;
    let states = this.objStates.get(a.sceneId);
    if (!states) this.objStates.set(a.sceneId, (states = new Map()));
    const on = !(states.get(objectId) ?? t.on ?? true);
    states.set(objectId, on);
    this.toScene(a.sceneId, { t: 'objstate', sceneId: a.sceneId, objectId, on });
    return true;
  }

  /** Ring something you're standing at (the launch bell): everyone in the room sees it swing. */
  ring(memberId: string, objectId: string): boolean {
    const a = this.actors.get(memberId);
    if (!a) return false;
    const o = this.scene(a.sceneId)?.objects.find((x) => x.id === objectId && x.actions?.some((k) => k.kind === 'ring'));
    if (!o) return false;
    const pos = this.position(a);
    const f = footprint(o);
    const dx = Math.max(f.x0 - pos.x, 0, pos.x - (f.x1 - 1));
    const dy = Math.max(f.y0 - pos.y, 0, pos.y - (f.y1 - 1));
    if (Math.hypot(dx, dy) > 1.6) return false;
    this.toScene(a.sceneId, { t: 'moment', sceneId: a.sceneId, objectId, what: 'ring', by: memberId });
    return true;
  }

  /**
   * Use a thing you're standing at (play the jukebox, feed the fish, water a plant — see uses.ts): the server
   * decides the outcome and everyone in the room sees the moment. Rate-limited per person and per thing.
   */
  use(memberId: string, objectId: string): boolean {
    const a = this.actors.get(memberId);
    if (!a) return false;
    const o = this.scene(a.sceneId)?.objects.find((x) => x.id === objectId);
    const act = o?.actions?.find((k) => k.kind === 'use');
    if (!o || !act || act.kind !== 'use' || !this.standingAt(a, o)) return false;
    const now = Date.now();
    const key = `${a.sceneId}:${o.id}`;
    if (now - (this.lastUse.get(memberId) ?? -Infinity) < USE_PERSON_GAP_MS || now < (this.useCooldown.get(key) ?? 0)) return false;
    this.lastUse.set(memberId, now);
    this.useCooldown.set(key, now + USE_COOLDOWN_MS[act.use]);
    this.faceToward(a, o);
    this.toScene(a.sceneId, { t: 'updated', memberId, patch: { x: a.x, y: a.y, facing: a.facing, path: undefined } });
    const out = outcomeOf(act.use, { rand: Math.random, best: this.highScores.get(key), org: this.data.org.name });
    if (act.use === 'arcade' && out.detail) {
      const score = Number(out.detail.replace(/,/g, ''));
      const best = this.highScores.get(key);
      if (!best || score > best.score) this.highScores.set(key, { score, name: this.member(memberId)?.displayName.split(' ')[0] ?? 'Someone' });
    }
    this.toScene(a.sceneId, { t: 'moment', sceneId: a.sceneId, objectId: o.id, what: act.use, by: memberId, detail: out.detail });
    // a quiet room keeps quiet: the moment plays, nobody announces it
    const quiet = !!this.data.rooms.find((r) => r.id === a.sceneId)?.quiet;
    if (out.line && !quiet) this.toScene(a.sceneId, { t: 'said', memberId, text: out.line });
    if (act.use === 'claw') {
      // the claw drops, closes, rises: then you learn whether it grabbed anything
      const t = setTimeout(() => {
        this.selfServe.delete(t);
        const still = this.actors.get(memberId);
        if (!still || still.sceneId !== a.sceneId) return;
        if (out.win && !this.carrying.has(memberId)) {
          this.carrying.set(memberId, 'plush');
          this.toScene(still.sceneId, { t: 'updated', memberId, patch: { carrying: 'plush' } });
          if (!quiet) this.toScene(still.sceneId, { t: 'said', memberId, text: '🧸 Got one!' });
        } else if (!quiet) this.toScene(still.sceneId, { t: 'said', memberId, text: out.win ? '🧸 Got one — but my hands are full' : '🦾 So close…' });
      }, CLAW_DROP_MS);
      this.selfServe.add(t);
    }
    return true;
  }

  /** Whether someone is standing at a thing (on a tile touching it), where they can use it. */
  private standingAt(a: Actor, o: SceneObject): boolean {
    const pos = this.position(a);
    const f = footprint(o);
    const dx = Math.max(f.x0 - pos.x, 0, pos.x - (f.x1 - 1));
    const dy = Math.max(f.y0 - pos.y, 0, pos.y - (f.y1 - 1));
    return Math.hypot(dx, dy) <= 1.6;
  }

  /**
   * Leave a note on a board you're standing at, for the room to read. Short, one every NOTE_GAP_MS per person;
   * a board holds NOTES_PER_BOARD and the oldest comes down to make room.
   */
  note(memberId: string, objectId: string, text: string): boolean {
    const a = this.actors.get(memberId);
    if (!a) return false;
    const o = this.scene(a.sceneId)?.objects.find((x) => x.id === objectId);
    if (!o?.actions?.some((k) => k.kind === 'note')) return false;
    if (!this.standingAt(a, o)) {
      this.toMember(memberId, { t: 'toast', text: 'Walk up to the board to leave a note.' });
      return false;
    }
    const clean = cleanNote(text);
    if (!clean) return false;
    const now = Date.now();
    if (now - (this.lastNote.get(memberId) ?? -Infinity) < NOTE_GAP_MS) {
      this.toMember(memberId, { t: 'toast', text: 'One note at a time — give the board a minute.' });
      return false;
    }
    this.lastNote.set(memberId, now);
    const n: BoardNote = { id: randomUUID(), sceneId: a.sceneId, objectId: o.id, by: memberId, text: clean, at: new Date(now).toISOString() };
    this.store.addNote(this.orgId, n);
    const on = this.notesOn(a.sceneId, o.id);
    for (const old of on.slice(0, Math.max(0, on.length - NOTES_PER_BOARD))) this.store.removeNote(this.orgId, old.id);
    this.faceToward(a, o);
    this.toScene(a.sceneId, { t: 'updated', memberId, patch: { x: a.x, y: a.y, facing: a.facing, path: undefined } });
    this.toScene(a.sceneId, { t: 'notes', sceneId: a.sceneId, objectId: o.id, notes: this.notesOn(a.sceneId, o.id) });
    return true;
  }

  /** Take a note down: your own, or anyone's if you're an admin. */
  unnote(memberId: string, noteId: string): boolean {
    const n = this.data.notes.find((x) => x.id === noteId);
    const m = this.member(memberId);
    if (!n || !m || (n.by !== memberId && m.role !== 'admin' && m.role !== 'owner')) return false;
    this.store.removeNote(this.orgId, n.id);
    this.toScene(n.sceneId, { t: 'notes', sceneId: n.sceneId, objectId: n.objectId, notes: this.notesOn(n.sceneId, n.objectId) });
    return true;
  }

  private notesOn(sceneId: string, objectId: string): BoardNote[] {
    return this.data.notes.filter((n) => n.sceneId === sceneId && n.objectId === objectId);
  }

  /** When each person last left a note. */
  private lastNote = new Map<string, number>();

  /** When each person last used something, and when each thing can be used again (per scene). */
  private lastUse = new Map<string, number>();
  private useCooldown = new Map<string, number>();
  /** Best arcade scores, per cabinet. */
  private highScores = new Map<string, { score: number; name: string }>();

  /** Stand up and step off the seat onto the floor in front of it (never left standing in furniture). */
  stand(memberId: string) {
    const a = this.actors.get(memberId);
    if (!a?.sittingOn) return;
    const scene = this.scene(a.sceneId);
    const grid = this.grids.get(a.sceneId);
    const here = scene ? seatSpotAt(scene, a.x, a.y) : null;
    a.sittingOn = undefined;
    if (scene && grid && here) {
      const step = stepOffTiles(here.spot).find(([x, y]) => grid.walkable(x, y));
      const off = step ? { x: step[0], y: step[1] } : grid.nearestWalkable(a.x, a.y, 2);
      if (off) {
        a.x = off.x;
        a.y = off.y;
      }
    }
    this.toScene(a.sceneId, { t: 'updated', memberId, patch: { sittingOn: undefined, x: a.x, y: a.y } });
  }

  /* ------------------------------------------------------------------ presence & social */

  setStatus(memberId: string, status: PresenceStatus, note: string | undefined, source: PresenceState['source'] = 'manual', until?: string) {
    const p = this.presenceOf(memberId);
    const wasInterruptible = STATUS_META[p.status].interruptible;
    p.status = status;
    p.note = note?.trim() || undefined;
    p.source = source;
    p.until = until;
    const a = this.actors.get(memberId);
    if (a) this.toScene(a.sceneId, { t: 'updated', memberId, patch: { status, note: p.note } });
    this.directoryDirty = true;
    if (!wasInterruptible && STATUS_META[status].interruptible) this.releaseHeldKnocks(memberId);
  }

  setSpeaking(memberId: string, speaking: boolean) {
    const a = this.actors.get(memberId);
    if (!a || !!a.speaking === speaking) return;
    a.speaking = speaking;
    this.toScene(a.sceneId, { t: 'updated', memberId, patch: { speaking } });
  }

  setVoice(memberId: string, voice: PresenceState['voice']) {
    const p = this.presenceOf(memberId);
    p.voice = voice;
    const a = this.actors.get(memberId);
    if (a) this.toScene(a.sceneId, { t: 'updated', memberId, patch: { voice } });
    this.directoryDirty = true;
  }

  /** A short social note to someone in the world (a wave from Slack). */
  notify(memberId: string, text: string) {
    this.toMember(memberId, { t: 'toast', text, tone: 'social' });
  }

  emote(memberId: string, emote: EmoteId, targetId?: string) {
    const a = this.actors.get(memberId);
    if (!a) return;
    this.toScene(a.sceneId, { t: 'emote', memberId, emote, targetId });
    if (targetId && targetId !== memberId) {
      const from = this.member(memberId);
      const target = this.actors.get(targetId);
      if (from && target?.sceneId === a.sceneId && emote === 'wave') {
        this.toMember(targetId, { t: 'toast', text: `${from.displayName.split(' ')[0]} waved at you 👋`, tone: 'social' });
      }
    }
    this.emit('emote', memberId, emote, a.sceneId, targetId);
  }

  say(memberId: string, text: string): boolean {
    const a = this.actors.get(memberId);
    if (!a) return false;
    const room = this.data.rooms.find((r) => r.id === a.sceneId);
    if (room?.quiet) {
      this.toMember(memberId, { t: 'toast', text: `${room.name} is a quiet space — try an emote instead 🤫` });
      return false;
    }
    this.toScene(a.sceneId, { t: 'said', memberId, text });
    this.emit('said', memberId, text, a.sceneId);
    return true;
  }

  setAvatar(memberId: string, loadout: Member['avatar']) {
    const m = this.member(memberId);
    if (!m) return;
    const clean = sanitizeLoadout(loadout, m.unlockedItems);
    this.store.setAvatar(this.orgId, memberId, clean);
    const a = this.actors.get(memberId);
    if (a) this.toScene(a.sceneId, { t: 'updated', memberId, patch: { avatar: clean } });
    this.broadcast({ t: 'member', memberId, avatar: clean, unlockedItems: m.unlockedItems });
  }

  claimReward(memberId: string, eventId: string) {
    const ev = this.activeEvents().find((e) => e.id === eventId);
    const a = this.actors.get(memberId);
    if (!ev?.rewardItemId || !a || a.sceneId !== ev.roomId) return;
    const m = this.member(memberId)!;
    if (this.store.grantItem(this.orgId, memberId, ev.rewardItemId)) {
      this.broadcast({ t: 'member', memberId, avatar: m.avatar, unlockedItems: m.unlockedItems });
      this.toMember(memberId, { t: 'toast', text: `You got a keepsake from ${ev.title}! Find it in your wardrobe.`, tone: 'celebrate' });
    }
  }

  /* ------------------------------------------------------------------ knocks */

  knock(fromId: string, targetId: string, kind: KnockKind): void {
    const target = this.member(targetId);
    const from = this.member(fromId);
    if (!target || !from || fromId === targetId) return;
    const k: Knock = { id: randomUUID(), fromId, targetId, kind, at: Date.now() };
    this.knocks.set(k.id, k);
    const tp = this.presenceOf(targetId);
    const reachable = this.isLive(targetId) || this.actors.get(targetId)?.via === 'sim';
    const first = target.displayName.split(' ')[0];
    if (!reachable || tp.status === 'offline') {
      this.toMember(fromId, { t: 'toast', text: `${first} isn’t around right now.` });
      this.emit('missedKnock', k);
      return;
    }
    if (target.simulated) {
      this.emit('knock', k);
      return;
    }
    const interruptible = STATUS_META[tp.status].interruptible || (tp.status === 'focused' && target.settings.knocksWhileFocused);
    if (!interruptible) {
      this.heldKnocks.set(targetId, [...(this.heldKnocks.get(targetId) ?? []), k]);
      this.toMember(fromId, {
        t: 'toast',
        text: `${first} is ${STATUS_META[tp.status].label.toLowerCase()} — your knock will reach them when they’re free.`,
      });
      return;
    }
    this.deliverKnock(k);
  }

  private deliverKnock(k: Knock) {
    this.toMember(k.targetId, { t: 'knock', knockId: k.id, fromId: k.fromId, kind: k.kind, sceneId: this.actors.get(k.fromId)?.sceneId });
  }

  private releaseHeldKnocks(memberId: string) {
    const held = this.heldKnocks.get(memberId);
    if (!held?.length) return;
    this.heldKnocks.delete(memberId);
    for (const k of held) if (Date.now() - k.at < 60 * 60_000) this.deliverKnock(k);
  }

  knockReply(knockId: string, responderId: string, reply: KnockReply, message?: string, meetAt?: string) {
    const k = this.knocks.get(knockId);
    if (!k || k.targetId !== responderId) return;
    this.knocks.delete(knockId);
    const sceneId = reply === 'join' ? (meetAt ?? this.actors.get(responderId)?.sceneId) : undefined;
    this.toMember(k.fromId, { t: 'knock-result', knockId, targetId: responderId, reply, message, sceneId });
  }

  /* ------------------------------------------------------------------ directory */

  directoryFor(viewerId: string): DirectoryEntry[] {
    const viewer = this.member(viewerId);
    const out: DirectoryEntry[] = [];
    for (const m of this.data.members.values()) {
      const p = this.presenceOf(m.id);
      const online = p.status !== 'offline' && (this.actors.has(m.id) || this.isLive(m.id) || !!p.voice);
      const vis = m.settings.locationVisibility;
      const canSeeLocation =
        m.id === viewerId || vis === 'everyone' || (vis === 'team' && viewer?.teamId === m.teamId);
      out.push({
        memberId: m.id,
        status: online ? p.status : 'offline',
        note: online ? p.note : undefined,
        until: online ? p.until : undefined,
        sceneId: online && canSeeLocation ? this.actors.get(m.id)?.sceneId : undefined,
        voice: online ? p.voice : undefined,
        online,
      });
    }
    return out;
  }

  markDirectoryDirty() {
    this.directoryDirty = true;
  }

  private tick() {
    const now = Date.now();
    this.npcs.tick();
    // Settle finished paths so snapshots stay compact.
    for (const a of this.actors.values()) this.position(a, now);
    if (this.directoryDirty) {
      this.directoryDirty = false;
      const seen = new Set<string>();
      for (const c of this.clients.values()) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        c.send({ t: 'directory', entries: this.directoryFor(c.memberId) });
      }
    }
  }

  /** A member joined the org or edited their profile: share the public version. */
  profileChanged(memberId: string) {
    const m = this.member(memberId);
    if (!m) return;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { settings, outfits, ...pub } = m;
    this.broadcast({ t: 'profile', member: pub });
    this.directoryDirty = true;
  }

  /** Organizational memory grew: everyone's world gets the new artifact. */
  artifactsChanged(addedId?: string) {
    this.broadcast({ t: 'artifacts', artifacts: this.data.artifacts, added: addedId });
  }

  /** Notify everyone that events changed (admin created one, one started/ended). */
  eventsChanged() {
    this.rebuildGrids();
    this.broadcast({ t: 'events', events: this.data.events });
  }
}
