import type { WalkGrid } from './walkGrid';

export type Tile = [number, number];

const DIRS: Array<[number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/** Binary min-heap keyed by f-score. */
class Heap {
  private items: Array<{ i: number; f: number }> = [];
  get size() {
    return this.items.length;
  }
  push(i: number, f: number) {
    const a = this.items;
    a.push({ i, f });
    let n = a.length - 1;
    while (n > 0) {
      const p = (n - 1) >> 1;
      if (a[p].f <= a[n].f) break;
      [a[p], a[n]] = [a[n], a[p]];
      n = p;
    }
  }
  pop(): number {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let n = 0;
      for (;;) {
        const l = n * 2 + 1;
        const r = l + 1;
        let m = n;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === n) break;
        [a[m], a[n]] = [a[n], a[m]];
        n = m;
      }
    }
    return top.i;
  }
}

/**
 * 8-directional A* without corner cutting. Returns the path including start and goal,
 * or null if unreachable. `allowGoal` lets you path onto an otherwise-blocked goal. `cost`: how much
 * stepping onto a tile costs (1 or more), e.g. to keep a stroll to the paths rather than across the grass.
 */
export function findPath(
  grid: WalkGrid,
  start: Tile,
  goal: Tile,
  opts: { allowGoal?: boolean; maxNodes?: number; cost?: (x: number, y: number) => number } = {},
): Tile[] | null {
  const { width, height } = grid;
  const [sx, sy] = start;
  const [gx, gy] = goal;
  if (!grid.inBounds(gx, gy) || !grid.inBounds(sx, sy)) return null;
  const passable = (x: number, y: number) =>
    grid.walkable(x, y) || (opts.allowGoal && x === gx && y === gy) || (x === sx && y === sy);
  if (!passable(gx, gy)) return null;
  if (sx === gx && sy === gy) return [[sx, sy]];

  const idx = (x: number, y: number) => y * width + x;
  const g = new Float32Array(width * height).fill(Infinity);
  const came = new Int32Array(width * height).fill(-1);
  const closed = new Uint8Array(width * height);
  const h = (x: number, y: number) => {
    const dx = Math.abs(x - gx);
    const dy = Math.abs(y - gy);
    return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
  };
  const open = new Heap();
  g[idx(sx, sy)] = 0;
  open.push(idx(sx, sy), h(sx, sy));
  const maxNodes = opts.maxNodes ?? 20000;
  let expanded = 0;

  while (open.size) {
    const cur = open.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % width;
    const cy = (cur - cx) / width;
    if (cx === gx && cy === gy) {
      const path: Tile[] = [];
      for (let n = cur; n !== -1; n = came[n]) path.push([n % width, Math.floor(n / width)]);
      return path.reverse();
    }
    if (++expanded > maxNodes) return null;
    for (const [dx, dy, cost] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!grid.inBounds(nx, ny) || !passable(nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (!passable(cx + dx, cy) || !passable(cx, cy + dy))) continue;
      const ni = idx(nx, ny);
      const ng = g[cur] + cost * (opts.cost ? opts.cost(nx, ny) : 1);
      if (ng < g[ni]) {
        g[ni] = ng;
        came[ni] = cur;
        open.push(ni, ng + h(nx, ny));
      }
    }
  }
  return null;
}

/** Validates that a client-supplied path is contiguous and walkable (server authority). */
export function isValidPath(grid: WalkGrid, path: Tile[], allowLastBlocked = false): boolean {
  if (path.length === 0 || path.length > 400) return false;
  for (let i = 0; i < path.length; i++) {
    const [x, y] = path[i];
    if (!Number.isInteger(x) || !Number.isInteger(y)) return false;
    const last = i === path.length - 1;
    if (i !== 0 && !grid.walkable(x, y) && !(last && allowLastBlocked)) return false;
    if (i > 0) {
      const [px, py] = path[i - 1];
      if (Math.abs(px - x) > 1 || Math.abs(py - y) > 1) return false;
    }
  }
  return true;
}

export const WALK_SPEED = 4.2; // tiles per second

/** Total arc length of a path in tiles. */
export function pathLength(path: Tile[]): number {
  let len = 0;
  for (let i = 1; i < path.length; i++) {
    len += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  }
  return len;
}

/** Position along a path after `elapsedMs`. Pure: server and client compute the same result. */
export function positionAlong(
  path: Tile[],
  elapsedMs: number,
  speed = WALK_SPEED,
): { x: number; y: number; done: boolean; dir: [number, number] } {
  let remaining = (Math.max(0, elapsedMs) / 1000) * speed;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1];
    const [bx, by] = path[i];
    const seg = Math.hypot(bx - ax, by - ay);
    if (remaining <= seg) {
      const t = seg === 0 ? 1 : remaining / seg;
      return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, done: false, dir: [bx - ax, by - ay] };
    }
    remaining -= seg;
  }
  const last = path[path.length - 1];
  const prev = path[path.length - 2] ?? last;
  return { x: last[0], y: last[1], done: true, dir: [last[0] - prev[0], last[1] - prev[1]] };
}

/** A walk in progress: the path and the server-epoch ms at which the walker was at path[0]. */
export interface Walk {
  path: Tile[];
  startedAt: number;
}

/**
 * The step a walker is in the middle of at `now`: its two tiles, its index in the path, and when the walker
 * was at its start (the walk's own clock, so the position along [from, to] from `startedAt` is the position
 * along the whole path). Null once the path is done.
 */
export function currentStep(walk: Walk, now: number, speed = WALK_SPEED): { from: Tile; to: Tile; index: number; startedAt: number } | null {
  const walked = (Math.max(0, now - walk.startedAt) / 1000) * speed;
  let before = 0;
  for (let i = 1; i < walk.path.length; i++) {
    const seg = Math.hypot(walk.path[i][0] - walk.path[i - 1][0], walk.path[i][1] - walk.path[i - 1][1]);
    if (walked < before + seg) return { from: walk.path[i - 1], to: walk.path[i], index: i - 1, startedAt: walk.startedAt + (before / speed) * 1000 };
    before += seg;
  }
  return null;
}

/**
 * A new destination for someone who may already be walking. The step in progress is always finished and the
 * new route (`find`, from a tile) continues from its end, rebased so the walker's position is unchanged: a
 * figure never snaps back to a tile's centre and nobody's screen restarts the motion. From a standstill the
 * route starts on `tile`, now. `same`: the walk already goes exactly this way (nothing to send). Null: no way.
 */
export function reroute(
  cur: Walk | null,
  tile: Tile,
  now: number,
  find: (from: Tile) => Tile[] | null,
  speed = WALK_SPEED,
): { path: Tile[]; startedAt: number; same: boolean } | null {
  const step = cur ? currentStep(cur, now, speed) : null;
  const route = find(step ? step.to : tile);
  if (!route || route.length === 0) return null;
  if (!step) return { path: route, startedAt: now, same: false };
  const path = [step.from, ...route];
  const rest = cur!.path.slice(step.index);
  const same = path.length === rest.length && path.every((t, i) => t[0] === rest[i][0] && t[1] === rest[i][1]);
  return { path, startedAt: step.startedAt, same };
}
