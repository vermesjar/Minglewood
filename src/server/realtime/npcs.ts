/**
 * NPC director: the people who work in rooms (the café's barista). They live on the server so every client
 * sees the same thing: they drift between their work spots while idle, and they make what guests order —
 * step to the machine, brew (a moment everyone sees), turn and hand it over.
 *
 * NPCs never enter the presence directory or people lists; they are scene furniture that happens to move.
 */
import type { NpcState, ServerMsg } from '@shared/protocol';
import type { Facing, NpcDef, SceneDef, SceneObject } from '@shared/world/scene';
import { WALK_SPEED, type Tile } from '@shared/world/pathfinding';

/** How long a shot takes, once the barista is at the machine. */
export const BREW_MS = 1600;
/** The moment of handing it over, after the brew. */
export const HANDOFF_MS = 500;

interface Live {
  def: NpcDef;
  state: NpcState;
  /** Free again at (epoch ms). */
  busyUntil: number;
  nextIdle: number;
  queue: Array<{ machine: SceneObject; forId: string; done: () => void }>;
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

export class NpcDirector {
  private scenes = new Map<string, Live[]>();
  private timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(
    private readonly host: Host,
    private readonly clock: () => number = Date.now,
  ) {}

  private live(sceneId: string): Live[] {
    let l = this.scenes.get(sceneId);
    if (!l) {
      const defs = this.host.scene(sceneId)?.npcs ?? [];
      const now = this.clock();
      l = defs.map((def, i) => {
        const home = def.spots[0];
        return { def, state: { id: def.id, x: home.x, y: home.y, facing: home.facing }, busyUntil: 0, nextIdle: now + 6000 + i * 1700, queue: [] };
      });
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

  /**
   * Make an order: the NPC walks to the machine, brews and hands it over, then `done` runs (the guest gets it).
   * Orders queue if they're busy.
   */
  serve(sceneId: string, machine: SceneObject, forId: string, done: () => void): boolean {
    const n = this.live(sceneId).find((x) => x.def.serves === machine.sprite);
    if (!n) return false;
    n.queue.push({ machine, forId, done });
    if (n.queue.length === 1) this.next(sceneId, n);
    return true;
  }

  private next(sceneId: string, n: Live) {
    const job = n.queue[0];
    if (!job) return;
    const now = this.clock();
    this.settle(n, now);
    // the spot behind the machine: its column (or row), on the NPC's side of it
    const spot = n.def.spots.reduce((best, s) =>
      Math.hypot(s.x - job.machine.x, s.y - job.machine.y) < Math.hypot(best.x - job.machine.x, best.y - job.machine.y) ? s : best,
    );
    const path = lane([n.state.x, n.state.y], [spot.x, spot.y]);
    const walk = path.length > 1 ? walkMs(path) : 0;
    if (path.length > 1) this.update(sceneId, n, { ...n.state, path, pathStartedAt: now, doing: undefined });
    const facing = towards([spot.x, spot.y], job.machine);
    n.busyUntil = now + walk + BREW_MS + HANDOFF_MS;
    this.later(walk, () => {
      this.update(sceneId, n, { id: n.def.id, x: spot.x, y: spot.y, facing, doing: 'brew' });
      this.host.toScene(sceneId, { t: 'moment', sceneId, objectId: job.machine.id, what: 'brew', by: `npc:${n.def.id}` });
    });
    this.later(walk + BREW_MS, () => {
      this.update(sceneId, n, { id: n.def.id, x: spot.x, y: spot.y, facing: spot.facing, doing: 'serve' });
      job.done();
    });
    this.later(walk + BREW_MS + HANDOFF_MS, () => {
      this.update(sceneId, n, { id: n.def.id, x: spot.x, y: spot.y, facing: spot.facing });
      n.queue.shift();
      n.nextIdle = this.clock() + 7000;
      this.next(sceneId, n);
    });
  }

  /** Idle life: every so often an NPC with nothing to do drifts to another of their spots. */
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
        n.nextIdle = n.busyUntil + 8000 + Math.random() * 9000;
        this.later(walkMs(path), () => this.update(sceneId, n, { id: n.def.id, x: to.x, y: to.y, facing: to.facing }));
      }
  }

  /** Finish a walk that has already ended (so snapshots never replay stale paths). */
  private settle(n: Live, now: number): Live {
    const s = n.state;
    if (s.path && s.pathStartedAt !== undefined && now - s.pathStartedAt >= walkMs(s.path)) {
      const [x, y] = s.path[s.path.length - 1];
      n.state = { id: s.id, x, y, facing: s.facing, doing: s.doing };
    }
    return n;
  }

  private update(sceneId: string, n: Live, state: NpcState) {
    n.state = state;
    this.host.toScene(sceneId, { t: 'npc', sceneId, npc: state });
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

function towards(from: Tile, o: SceneObject): Facing {
  const dx = o.x + (o.w ?? 1) / 2 - 0.5 - from[0];
  const dy = o.y + (o.d ?? 1) / 2 - 0.5 - from[1];
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'se' : 'nw';
  return dy > 0 ? 'sw' : 'ne';
}
