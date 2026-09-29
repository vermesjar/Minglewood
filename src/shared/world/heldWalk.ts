/**
 * Walking with held keys (arrows / WASD). Movement stays tile-based and path-based — the same wire
 * format as click-to-walk — but the path is steered continuously: the segment in progress is always
 * finished, one more tile is queued shortly before it ends while a key is held, and releasing drops
 * whatever hasn't started, so the walker stops at the very next tile. Pure: unit-tested, no DOM.
 */
import { WALK_SPEED, type Tile } from './pathfinding';

export type ScreenDir = 'up' | 'down' | 'left' | 'right';

/** Screen directions as tile deltas on the 2:1 isometric grid (screen-up is −x −y). */
const SCREEN: Record<ScreenDir, Tile> = { up: [-1, -1], down: [1, 1], left: [-1, 1], right: [1, -1] };

/** Physical keys (KeyboardEvent.code, so WASD is ZQSD on AZERTY) → screen direction. */
export const KEY_DIRS: Record<string, ScreenDir> = {
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
};

/** One held key walks straight up/down/left/right on screen; two adjacent keys walk the diagonals. */
export function heldDelta(held: Iterable<ScreenDir>): Tile | null {
  let x = 0;
  let y = 0;
  for (const d of held) {
    x += SCREEN[d][0];
    y += SCREEN[d][1];
  }
  const dx = Math.sign(x);
  const dy = Math.sign(y);
  return dx || dy ? [dx, dy] : null;
}

interface Walkable {
  walkable(x: number, y: number): boolean;
}

/**
 * The tile one step from `from` along `d`. A blocked diagonal (or one that would cut a corner, which
 * pathfinding forbids too) slides along the wall instead, preferring the axis we were already moving on.
 */
export function stepFrom(grid: Walkable, from: Tile, d: Tile, prev?: Tile | null): Tile | null {
  const [x, y] = from;
  const [dx, dy] = d;
  const ok = (tx: number, ty: number) => grid.walkable(tx, ty);
  if (dx && dy) {
    if (ok(x + dx, y + dy) && ok(x + dx, y) && ok(x, y + dy)) return [x + dx, y + dy];
    const slides: Tile[] = [
      [dx, 0],
      [0, dy],
    ];
    if (prev && prev[0] === 0 && prev[1] !== 0) slides.reverse();
    for (const [sx, sy] of slides) if (ok(x + sx, y + sy)) return [x + sx, y + sy];
    return null;
  }
  return ok(x + dx, y + dy) ? [x + dx, y + dy] : null;
}

export interface WalkState {
  path: Tile[];
  /** Server epoch ms at which the walker was at path[0]. */
  startedAt: number;
}

const dist = (a: Tile, b: Tile) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const samePath = (a: Tile[], b: Tile[]) => a.length === b.length && a.every((t, i) => t[0] === b[i][0] && t[1] === b[i][1]);

/**
 * Next path for a walker steered by held keys, or null when the current one is already right.
 * `cur` is the path being walked (null when standing on `tile`); `d` is the held delta (null once
 * released). Returned paths start at the segment in progress, with `startedAt` re-based so the
 * walker's position is unchanged — observers see one continuous motion.
 */
export function planHeldWalk(
  cur: WalkState | null,
  tile: Tile,
  now: number,
  d: Tile | null,
  grid: Walkable,
  lookahead = 0.6,
  speed = WALK_SPEED,
): WalkState | null {
  if (cur && cur.path.length >= 2) {
    const { path, startedAt } = cur;
    const walked = (Math.max(0, now - startedAt) / 1000) * speed;
    let before = 0;
    for (let k = 0; k < path.length - 1; k++) {
      const a = path[k];
      const b = path[k + 1];
      const seg = dist(a, b);
      if (walked >= before + seg) {
        before += seg;
        continue;
      }
      const left = seg - (walked - before);
      const segD: Tile = [b[0] - a[0], b[1] - a[1]];
      // Turning straight around doesn't have to wait for the tile ahead.
      if (d && d[0] === -segD[0] && d[1] === -segD[1]) return { path: [b, a], startedAt: now - (left / speed) * 1000 };
      const want: Tile[] = [a, b];
      if (d && left < lookahead) {
        const n = stepFrom(grid, b, d, segD);
        if (n) want.push(n);
      }
      if (samePath(path.slice(k), want)) return null;
      return { path: want, startedAt: startedAt + (before / speed) * 1000 };
    }
  }
  if (!d) return null;
  const n = stepFrom(grid, tile, d, null);
  return n ? { path: [tile, n], startedAt: now } : null;
}
