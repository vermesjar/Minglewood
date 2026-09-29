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
import type { DirectoryEntry, KnockKind, KnockReply, Occupant, ServerMsg } from '@shared/protocol';
import type { EmoteId } from '@shared/presence';
import { STATUS_META } from '@shared/presence';
import { allScenes, buildingForRoom, getScene, TOWN_ID } from '@shared/world';
import { livedScene } from '@shared/world/lived';
import type { Facing, SceneDef } from '@shared/world/scene';
import { GROUND, isSeat } from '@shared/world/scene';
import { WalkGrid } from '@shared/world/walkGrid';
import { findPath, isValidPath, positionAlong, type Tile } from '@shared/world/pathfinding';
import { sanitizeLoadout } from '@shared/avatar';
import { distanceToObject, interactionFor, rollInteraction, type PropState } from '@shared/world/interactions';
import type { Store } from '../store/store';

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
  interacted: [memberId: string, objectId: string, sceneId: string];
  knock: [knock: Knock];
};

const facingFromDir = (dx: number, dy: number, prev: Facing): Facing => {
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return prev;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'se' : 'nw';
  return dy > 0 ? 'sw' : 'ne';
};

export class OrgHub extends EventEmitter<HubEvents> {
  private clients = new Map<string, HubClient>();
  private actors = new Map<string, Actor>();
  private presence = new Map<string, PresenceState>();
  private grids = new Map<string, WalkGrid>();
  private knocks = new Map<string, Knock>();
  private heldKnocks = new Map<string, Knock[]>();
  private beforeQuiet = new Map<string, Pick<PresenceState, 'status' | 'note'>>();
  private directoryDirty = true;
  private timer: NodeJS.Timeout;
  /** Live prop state per scene (wish counts, jukebox track, lamps). Ephemeral by design. */
  private props = new Map<string, Map<string, PropState>>();
  private lastInteract = new Map<string, number>();
  private pendingHighFive = new Map<string, { targetId: string; at: number }>();

  constructor(
    readonly orgId: string,
    private readonly store: Store,
  ) {
    super();
    this.rebuildGrids();
    this.timer = setInterval(() => this.tick(), 1000);
  }

  dispose() {
    clearInterval(this.timer);
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
        c.send({ t: 'scene', sceneId, occupants: this.actorsIn(sceneId).map((x) => this.occupant(x)), props: this.propsOf(sceneId) });
      }
    }
    this.toScene(sceneId, { t: 'joined', sceneId, occupant: this.occupant(actor) });
    this.directoryDirty = true;
    this.emit('entered', memberId, sceneId, via);
    return actor;
  }

  private arrivalSpot(scene: SceneDef, grid: WalkGrid, fromScene: string | undefined, at?: Tile) {
    if (at && grid.walkable(at[0], at[1])) return { x: at[0], y: at[1] };
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
    this.toScene(a.sceneId, { t: 'left', sceneId: a.sceneId, memberId, toSceneId });
    const p = this.presenceOf(memberId);
    if (!toSceneId) p.sceneId = undefined;
    this.directoryDirty = true;
  }

  /* ------------------------------------------------------------------ movement */

  /** Client-proposed path (validated). */
  move(memberId: string, path: Tile[]): boolean {
    const a = this.actors.get(memberId);
    if (!a) return false;
    const grid = this.grids.get(a.sceneId)!;
    const pos = this.position(a);
    const [sx, sy] = path[0];
    if (Math.hypot(sx - pos.x, sy - pos.y) > 1.6) return false;
    const last = path[path.length - 1];
    const seatAtEnd = this.seatAt(a.sceneId, last[0], last[1]);
    if (!isValidPath(grid, path, !!seatAtEnd)) return false;
    this.startPath(a, path);
    return true;
  }

  /** Server-computed path (for simulated coworkers). */
  walkTo(memberId: string, goal: Tile): boolean {
    const a = this.actors.get(memberId);
    if (!a) return false;
    const grid = this.grids.get(a.sceneId)!;
    const pos = this.position(a);
    const start: Tile = [Math.round(pos.x), Math.round(pos.y)];
    const path = findPath(grid, start, goal, { allowGoal: !!this.seatAt(a.sceneId, goal[0], goal[1]) });
    if (!path || path.length < 2) return false;
    this.startPath(a, path);
    return true;
  }

  private startPath(a: Actor, path: Tile[]) {
    a.path = path;
    a.pathStartedAt = Date.now();
    a.sittingOn = undefined;
    a.x = path[0][0];
    a.y = path[0][1];
    this.toScene(a.sceneId, { t: 'moved', memberId: a.memberId, path, startedAt: a.pathStartedAt });
  }

  seatAt(sceneId: string, x: number, y: number) {
    return this.scene(sceneId)?.objects.find((o) => isSeat(o) && o.x === x && o.y === y);
  }

  seatTaken(sceneId: string, objectId: string, except?: string): boolean {
    return this.actorsIn(sceneId).some((a) => a.sittingOn === objectId && a.memberId !== except);
  }

  sit(memberId: string, objectId: string): boolean {
    const a = this.actors.get(memberId);
    if (!a) return false;
    if (objectId === GROUND) {
      // Sit right where you are: on the grass, the sand, the floor.
      const pos = this.position(a);
      if (pos.moving) return false;
      a.sittingOn = GROUND;
      this.toScene(a.sceneId, { t: 'updated', memberId, patch: { x: a.x, y: a.y, sittingOn: GROUND, facing: a.facing, path: undefined } });
      return true;
    }
    const seat = this.scene(a.sceneId)?.objects.find((o) => o.id === objectId && isSeat(o));
    if (!seat || this.seatTaken(a.sceneId, objectId, memberId)) return false;
    const pos = this.position(a);
    if (Math.hypot(pos.x - seat.x, pos.y - seat.y) > 1.6) return false;
    a.path = undefined;
    a.pathStartedAt = undefined;
    a.x = seat.x;
    a.y = seat.y;
    a.sittingOn = seat.id;
    a.facing = seat.facing ?? a.facing;
    this.toScene(a.sceneId, {
      t: 'updated',
      memberId,
      patch: { x: a.x, y: a.y, sittingOn: seat.id, facing: a.facing, path: undefined },
    });
    return true;
  }

  stand(memberId: string) {
    const a = this.actors.get(memberId);
    if (!a?.sittingOn) return;
    a.sittingOn = undefined;
    // '' rather than undefined: JSON drops undefined fields, and clients must see the change.
    this.toScene(a.sceneId, { t: 'updated', memberId, patch: { sittingOn: '' } });
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

  emote(memberId: string, emote: EmoteId, targetId?: string) {
    const a = this.actors.get(memberId);
    if (!a) return;
    if (targetId === memberId) targetId = undefined;
    const target = targetId ? this.actors.get(targetId) : undefined;
    const from = this.member(memberId);
    const first = from?.displayName.split(' ')[0] ?? 'Someone';
    // A high five needs two hands: the second one within a few seconds completes it.
    if (emote === 'highfive' && targetId && target?.sceneId === a.sceneId) {
      const waiting = this.pendingHighFive.get(targetId);
      if (waiting && waiting.targetId === memberId && Date.now() - waiting.at < 10_000) {
        this.pendingHighFive.delete(targetId);
        this.toScene(a.sceneId, { t: 'combo', kind: 'highfive', a: targetId, b: memberId });
        this.emit('emote', memberId, emote, a.sceneId, targetId);
        return;
      }
      this.pendingHighFive.set(memberId, { targetId, at: Date.now() });
      this.toMember(targetId, { t: 'toast', text: `${first} is holding up a high five 🙌 — click them and high-five back!`, tone: 'social' });
    }
    this.toScene(a.sceneId, { t: 'emote', memberId, emote, targetId: target?.sceneId === a.sceneId ? targetId : undefined });
    if (from && targetId && target?.sceneId === a.sceneId) {
      if (emote === 'wave') this.toMember(targetId, { t: 'toast', text: `${first} waved at you 👋`, tone: 'social' });
      if (emote === 'plane') this.toMember(targetId, { t: 'toast', text: `✈️ A paper plane from ${first} landed on your head`, tone: 'social' });
    }
    this.emit('emote', memberId, emote, a.sceneId, targetId);
  }

  propsOf(sceneId: string): Record<string, PropState> {
    return Object.fromEntries(this.props.get(sceneId) ?? []);
  }

  /** Poke a prop. Reach and rate are checked here; the outcome is shared with the whole scene. */
  interact(memberId: string, objectId: string): boolean {
    const a = this.actors.get(memberId);
    if (!a) return false;
    const o = this.scene(a.sceneId)?.objects.find((x) => x.id === objectId);
    const it = o && interactionFor(o);
    if (!o || !it) return false;
    const now = Date.now();
    if (now - (this.lastInteract.get(memberId) ?? 0) < 900) return false;
    const pos = this.position(a, now);
    if (distanceToObject(o, Math.round(pos.x), Math.round(pos.y)) > it.reach + 0.6) return false;
    this.lastInteract.set(memberId, now);
    let scene = this.props.get(a.sceneId);
    if (!scene) this.props.set(a.sceneId, (scene = new Map()));
    const state = scene.get(objectId) ?? {};
    scene.set(objectId, state);
    const name = this.member(memberId)?.displayName.split(' ')[0] ?? 'Someone';
    const result = rollInteraction(o, state, name, now);
    this.toScene(a.sceneId, { t: 'interacted', memberId, objectId, result });
    this.emit('interacted', memberId, objectId, a.sceneId);
    return true;
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
