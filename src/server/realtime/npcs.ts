/**
 * NPC director: the people who work in rooms (the café's barista, HQ's receptionist, the arcade attendant,
 * the librarian). They live on the server so every client sees the same thing:
 *
 * - idle, they drift between their work spots, and at each one do what that spot is for — type at the desk,
 *   shelve books, sit in the reception chair (`spots[].doing` / `spots[].sit`);
 * - the ones with greetings turn to people who arrive or walk up to them, wave and say hello — once a visit,
 *   and never more than one hello every few seconds;
 * - the ones who run a machine make what guests order there: step to it, work it (a moment everyone sees),
 *   turn and hand it over.
 *
 * NPCs never enter the presence directory or people lists; they are scene furniture that happens to move.
 */
import type { NpcState, ServerMsg } from '@shared/protocol';
import type { Facing, NpcDef, SceneDef, SceneObject } from '@shared/world/scene';
import { WALK_SPEED, type Tile } from '@shared/world/pathfinding';

/** How long making an order takes, once they're at the machine. */
export const BREW_MS = 1600;
/** The moment of handing it over, after the brew. */
export const HANDOFF_MS = 500;
/** How long a hello lasts (the wave and the bubble). */
export const GREET_MS = 1600;
/** Someone who walks up again gets another hello only after this long. */
const REGREET_MS = 45_000;
/** However busy the door, an NPC says hello at most this often. */
const GREET_GAP_MS = 6_000;
/** Walking up to within this many tiles counts as coming over. */
const NEAR_TILES = 2.2;

type Spot = NpcDef['spots'][number];

interface Live {
  def: NpcDef;
  state: NpcState;
  /** Free again at (epoch ms). */
  busyUntil: number;
  nextIdle: number;
  queue: Array<{ machine: SceneObject; forId: string; item: string; done: () => void }>;
  /** Who they've said hello to this visit, and when. */
  greeted: Map<string, number>;
  lastGreet: number;
}

interface Host {
  scene(id: string): SceneDef | undefined;
  toScene(sceneId: string, msg: ServerMsg): void;
}

const walkMs = (path: Tile[]) => {
  let len = 0;
  for (let i = 1; i < path.length; i++) len += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return (len / WALK_SPEED) * 1000;
};

/** A straight walk along a staff lane (one axis at a time). */
function lane(from: Tile, to: Tile): Tile[] {
  const path: Tile[] = [from];
  let [x, y] = from;
  while (x !== to[0]) path.push([(x += Math.sign(to[0] - x)), y]);
  while (y !== to[1]) path.push([x, (y += Math.sign(to[1] - y))]);
  return path;
}

/** What someone is doing when they're simply at a spot. */
const atSpot = (id: string, s: Spot): NpcState => ({ id, x: s.x, y: s.y, facing: s.facing, doing: s.doing, sittingOn: s.sit });

export class NpcDirector {
  private scenes = new Map<string, Live[]>();
  private timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(
    private readonly host: Host,
    private readonly clock: () => number = Date.now,
    /** Picks one of several lines (tests pass a fixed one). */
    private readonly pick: <T>(xs: readonly T[]) => T = (xs) => xs[Math.floor(Math.random() * xs.length)],
  ) {}

  private live(sceneId: string): Live[] {
    let l = this.scenes.get(sceneId);
    if (!l) {
      const defs = this.host.scene(sceneId)?.npcs ?? [];
      const now = this.clock();
      l = defs.map((def, i) => ({
        def,
        state: atSpot(def.id, def.spots[0]),
        busyUntil: 0,
        nextIdle: now + 6000 + i * 1700,
        queue: [],
        greeted: new Map(),
        lastGreet: 0,
      }));
      this.scenes.set(sceneId, l);
    }
    return l;
  }

  /** The NPCs of a scene as they are now (for a newcomer's scene snapshot). */
  statesIn(sceneId: string): NpcState[] {
    const now = this.clock();
    return this.live(sceneId).map((n) => this.settle(n, now).state);
  }

  /** The NPC who makes what this machine hands out, if any. */
  serverFor(sceneId: string, machine: SceneObject): NpcDef | undefined {
    return this.live(sceneId).find((n) => n.def.serves === machine.sprite)?.def;
  }

  /* ------------------------------------------------------------------ hellos */

  /** A person came into the room: a new visit, so a fresh hello from whoever greets people here. */
  arrived(sceneId: string, memberId: string, at: Tile) {
    for (const list of this.scenes.values()) for (const n of list) n.greeted.delete(memberId);
    // after a beat, so they've seen the room appear
    this.later(900, () => {
      for (const n of this.live(sceneId)) this.greet(sceneId, n, memberId, at, false);
    });
  }

  /** A person finished a walk at `at`: if that's next to someone who greets, they turn and say hello. */
  approached(sceneId: string, memberId: string, at: Tile) {
    for (const n of this.live(sceneId)) {
      const s = this.settle(n, this.clock()).state;
      if (Math.hypot(s.x - at[0], s.y - at[1]) <= NEAR_TILES) this.greet(sceneId, n, memberId, at, true);
    }
  }

  /** A person set off for `to`, arriving in `inMs`: check for a hello when they get there (a new walk replaces it). */
  walking(sceneId: string, memberId: string, to: Tile, inMs: number) {
    const token = (this.walks.get(memberId) ?? 0) + 1;
    this.walks.set(memberId, token);
    this.later(Math.max(0, inMs), () => {
      if (this.walks.get(memberId) === token) this.approached(sceneId, memberId, to);
    });
  }

  private walks = new Map<string, number>();

  /** A person left: forget them (their next visit gets a fresh hello). */
  left(memberId: string) {
    for (const list of this.scenes.values()) for (const n of list) n.greeted.delete(memberId);
  }

  private greet(sceneId: string, n: Live, memberId: string, at: Tile, near: boolean) {
    const lines = n.def.greeting;
    if (!lines?.length) return;
    const now = this.clock();
    const last = n.greeted.get(memberId);
    if (last !== undefined && (!near || now - last < REGREET_MS)) return;
    if (n.queue.length || now < n.busyUntil || now - n.lastGreet < GREET_GAP_MS) return;
    this.settle(n, now);
    const s = n.state;
    if (s.path) return;
    n.greeted.set(memberId, now);
    n.lastGreet = now;
    n.busyUntil = now + GREET_MS;
    const home = { ...s };
    // seated, they stay seated and just speak; standing, they turn to you and wave
    const facing = s.sittingOn ? s.facing : towards([s.x, s.y], { x: at[0], y: at[1] });
    this.update(sceneId, n, { ...s, facing, doing: s.sittingOn ? s.doing : 'greet', say: this.pick(lines) });
    this.later(GREET_MS, () => {
      // back to what they were doing, unless an order has taken them off since
      const cur = n.state;
      if (!n.queue.length && !cur.path && cur.x === home.x && cur.y === home.y) this.update(sceneId, n, { ...home, say: undefined });
    });
  }

  /* ------------------------------------------------------------------ service */

  /**
   * Make an order: the NPC walks to the machine, works it and hands it over, then `done` runs (the guest gets
   * it). Orders queue if they're busy.
   */
  serve(sceneId: string, machine: SceneObject, forId: string, done: () => void, item = 'coffee'): boolean {
    const n = this.live(sceneId).find((x) => x.def.serves === machine.sprite);
    if (!n) return false;
    n.queue.push({ machine, forId, item, done });
    if (n.queue.length === 1) this.next(sceneId, n);
    return true;
  }

  private next(sceneId: string, n: Live) {
    const job = n.queue[0];
    if (!job) return;
    const now = this.clock();
    this.settle(n, now);
    // mid-stroll: finish the step they're on first, then go (a new walk from where the last one started
    // would snap them back across the bar)
    const s = n.state;
    if (s.path && s.pathStartedAt !== undefined) {
      this.later(Math.max(0, s.pathStartedAt + walkMs(s.path) - now) + 20, () => this.next(sceneId, n));
      return;
    }
    // the spot nearest the machine, on the NPC's side of it
    const spot = n.def.spots.reduce((best, s) =>
      Math.hypot(s.x - job.machine.x, s.y - job.machine.y) < Math.hypot(best.x - job.machine.x, best.y - job.machine.y) ? s : best,
    );
    const path = lane([n.state.x, n.state.y], [spot.x, spot.y]);
    const walk = path.length > 1 ? walkMs(path) : 0;
    if (path.length > 1) this.update(sceneId, n, { id: n.def.id, x: n.state.x, y: n.state.y, facing: n.state.facing, path, pathStartedAt: now });
    const facing = towards([spot.x, spot.y], job.machine);
    n.busyUntil = now + walk + BREW_MS + HANDOFF_MS;
    this.later(walk, () => {
      this.update(sceneId, n, { id: n.def.id, x: spot.x, y: spot.y, facing, doing: 'brew', holding: job.item });
      this.host.toScene(sceneId, { t: 'moment', sceneId, objectId: job.machine.id, what: 'brew', by: `npc:${n.def.id}` });
    });
    this.later(walk + BREW_MS, () => {
      this.update(sceneId, n, { id: n.def.id, x: spot.x, y: spot.y, facing: spot.facing, doing: 'serve', holding: job.item });
      job.done();
    });
    this.later(walk + BREW_MS + HANDOFF_MS, () => {
      this.update(sceneId, n, { ...atSpot(n.def.id, spot), sittingOn: undefined, doing: spot.sit ? undefined : spot.doing });
      n.queue.shift();
      n.nextIdle = this.clock() + 7000;
      this.next(sceneId, n);
    });
  }

  /* ------------------------------------------------------------------ idle life */

  /** Every so often an NPC with nothing to do drifts to another of their spots and gets on with it there. */
  tick() {
    const now = this.clock();
    for (const [sceneId, list] of this.scenes)
      for (const n of list) {
        if (n.queue.length || now < n.busyUntil || now < n.nextIdle || n.def.spots.length < 2) continue;
        this.settle(n, now);
        const others = n.def.spots.filter((s) => s.x !== n.state.x || s.y !== n.state.y);
        const to = others[Math.floor(Math.random() * others.length)];
        const path = lane([n.state.x, n.state.y], [to.x, to.y]);
        this.update(sceneId, n, { id: n.def.id, x: n.state.x, y: n.state.y, facing: n.state.facing, path, pathStartedAt: now });
        n.busyUntil = now + walkMs(path);
        // a seated or working spot holds them a while longer
        n.nextIdle = n.busyUntil + (to.sit || to.doing ? 14000 : 8000) + Math.random() * 9000;
        this.later(walkMs(path), () => this.update(sceneId, n, atSpot(n.def.id, to)));
      }
  }

  /** Finish a walk that has already ended (so snapshots never replay stale paths). */
  private settle(n: Live, now: number): Live {
    const s = n.state;
    if (s.path && s.pathStartedAt !== undefined && now - s.pathStartedAt >= walkMs(s.path)) {
      const [x, y] = s.path[s.path.length - 1];
      const spot = n.def.spots.find((p) => p.x === x && p.y === y);
      n.state = spot ? atSpot(s.id, spot) : { id: s.id, x, y, facing: s.facing };
    }
    return n;
  }

  private update(sceneId: string, n: Live, state: NpcState) {
    n.state = state;
    this.host.toScene(sceneId, { t: 'npc', sceneId, npc: state });
    // a line is said once; the stored state doesn't keep repeating it to newcomers
    if (state.say) n.state = { ...state, say: undefined };
  }

  private later(ms: number, fn: () => void) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  dispose() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }
}

function towards(from: Tile, o: { x: number; y: number; w?: number; d?: number }): Facing {
  const dx = o.x + (o.w ?? 1) / 2 - 0.5 - from[0];
  const dy = o.y + (o.d ?? 1) / 2 - 0.5 - from[1];
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'se' : 'nw';
  return dy > 0 ? 'sw' : 'ne';
}
